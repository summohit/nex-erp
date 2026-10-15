import {
  BadRequestException, ForbiddenException, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { isSuperAdmin } from '../../common/company-roles';
import { istDateKey } from '../../common/timezone.util';
import { FIELD_VISIT_STATUS } from '../field-visit-status';

export const TRAVEL_ZONE = { NCR: 'DELHI_NCR', OUTSTATION: 'OUTSTATION' } as const;
export type TravelZone = typeof TRAVEL_ZONE[keyof typeof TRAVEL_ZONE];

export interface TravelRate { vehicle: string; ratePerKm: number }
export interface TravelConfig { ncrRadiusKm: number; rates: TravelRate[] }

const DEFAULT_CONFIG: TravelConfig = { ncrRadiusKm: 60, rates: [] };

/** Straight-line km between two points. */
export function straightKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat), dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * Field visit travel allowance (decided 15 Oct 2026).
 *
 * A Delhi NCR visit is paid per km for each day the person reached the site
 * (clocked in there). Going is from where they tapped Start journey, which may
 * be the office, home or anywhere; without a tap, from their office. Return is
 * the same distance unless they tapped End journey, when it is site → end
 * point. One location read per tap and nothing in between, so no background
 * tracking. Outstation visits get no allowance; their costs go through normal
 * expense claims. Rates and the NCR radius are the super admin's.
 *
 * The claim is created once the visit is COMPLETED, by an hourly sweep rather
 * than at each of the places a visit can be completed, and is approved by
 * finance or the super admin like any expense. The unique (visit, person) on
 * ExpenseClaim makes the sweep safe to run any number of times.
 */
@Injectable()
export class TravelAllowanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TravelAllowanceService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      this.sweep().catch((err) => this.logger.error(`Travel allowance sweep failed: ${err.message}`));
    }, 60 * 60 * 1000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ─── Settings (super admin) ──────────────────────────────────────────────

  async getConfig(companyId: number): Promise<TravelConfig> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { companyId }, select: { travelAllowanceConfig: true },
    });
    const raw: any = row?.travelAllowanceConfig ?? {};
    return {
      ncrRadiusKm: Number(raw.ncrRadiusKm) > 0 ? Number(raw.ncrRadiusKm) : DEFAULT_CONFIG.ncrRadiusKm,
      rates: Array.isArray(raw.rates)
        ? raw.rates.filter((r: any) => r?.vehicle && Number(r.ratePerKm) >= 0)
          .map((r: any) => ({ vehicle: String(r.vehicle).trim(), ratePerKm: Number(r.ratePerKm) }))
        : [],
    };
  }

  async setConfig(companyId: number, role: string, body: Partial<TravelConfig>): Promise<TravelConfig> {
    if (!isSuperAdmin(role)) throw new ForbiddenException('Only the super admin sets travel allowance rates');
    const radius = Number(body?.ncrRadiusKm);
    if (!(radius > 0 && radius <= 500)) throw new BadRequestException('The Delhi NCR radius must be between 1 and 500 km');
    const rates = (Array.isArray(body?.rates) ? body.rates : []).map((r: any) => ({
      vehicle: String(r?.vehicle ?? '').trim(), ratePerKm: Number(r?.ratePerKm),
    }));
    if (rates.some((r) => !r.vehicle || !(r.ratePerKm >= 0) || r.ratePerKm > 1000)) {
      throw new BadRequestException('Each rate needs a vehicle name and a rate per km between 0 and 1000');
    }
    if (new Set(rates.map((r) => r.vehicle.toLowerCase())).size !== rates.length) {
      throw new BadRequestException('Each vehicle can be listed once');
    }
    const config: TravelConfig = { ncrRadiusKm: radius, rates };
    await this.prisma.systemSetting.upsert({
      where: { companyId },
      create: { companyId, travelAllowanceConfig: config as any },
      update: { travelAllowanceConfig: config as any },
    });
    return config;
  }

  // ─── Zone ────────────────────────────────────────────────────────────────

  /** Where trips are measured from when nobody tapped Start journey. */
  private async officeOf(companyId: number, employeeId?: number): Promise<{ lat: number; lng: number } | null> {
    if (employeeId) {
      const emp = await this.prisma.employee.findUnique({
        where: { id: employeeId }, select: { branch: { select: { latitude: true, longitude: true } } },
      });
      if (emp?.branch?.latitude != null && emp.branch.longitude != null) {
        return { lat: emp.branch.latitude, lng: emp.branch.longitude };
      }
    }
    const branch = await this.prisma.branch.findFirst({
      where: { companyId, latitude: { not: null }, longitude: { not: null } },
      orderBy: { id: 'asc' }, select: { latitude: true, longitude: true },
    });
    return branch ? { lat: branch.latitude as number, lng: branch.longitude as number } : null;
  }

  /** What the form pre-selects for a site: Delhi NCR inside the radius of the head office. */
  async suggestZone(companyId: number, lat: number, lng: number) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new BadRequestException('A site location is needed');
    const [config, office] = await Promise.all([this.getConfig(companyId), this.officeOf(companyId)]);
    if (!office) return { zone: null, distanceKm: null, ncrRadiusKm: config.ncrRadiusKm };
    const distanceKm = Math.round(straightKm(office.lat, office.lng, lat, lng) * 10) / 10;
    return {
      zone: distanceKm <= config.ncrRadiusKm ? TRAVEL_ZONE.NCR : TRAVEL_ZONE.OUTSTATION,
      distanceKm, ncrRadiusKm: config.ncrRadiusKm,
    };
  }

  // ─── Journey taps (employee) ─────────────────────────────────────────────

  private async todaysNcrDay(userId: number, requestId?: number) {
    const employee = await this.prisma.employee.findFirst({ where: { userId }, select: { id: true } });
    if (!employee) throw new BadRequestException('No employee profile');
    const days = await this.prisma.fieldVisitAttendance.findMany({
      where: {
        employeeId: employee.id,
        visitDate: istDateKey(new Date()),
        request: { status: FIELD_VISIT_STATUS.APPROVED, ...(requestId ? { id: Number(requestId) } : {}) },
      },
      select: {
        id: true, companyId: true, journeyStartAt: true, journeyEndAt: true, clockInTime: true,
        request: { select: { id: true, requestNumber: true, travelZone: true } },
      },
    });
    if (!days.length) throw new BadRequestException('You are not scheduled on an approved field visit today.');
    if (days.length > 1) {
      throw new BadRequestException(`You are on ${days.length} field visits today — say which one you are travelling for.`);
    }
    const day = days[0];
    if (day.request.travelZone !== TRAVEL_ZONE.NCR) {
      throw new BadRequestException(`${day.request.requestNumber} is not a Delhi NCR visit, so there is no km allowance to track.`);
    }
    return day;
  }

  private coords(lat: any, lng: any) {
    const la = Number(lat), lo = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180 || (la === 0 && lo === 0)) {
      throw new BadRequestException('Your location could not be read — turn on location and try again');
    }
    return { la, lo };
  }

  async startJourney(userId: number, body: { requestId?: number; lat: number; lng: number; vehicle?: string }) {
    const day = await this.todaysNcrDay(userId, body?.requestId);
    if (day.journeyStartAt) throw new BadRequestException('You already started your journey today.');
    if (day.clockInTime) throw new BadRequestException('You have already reached the site today, so the journey cannot start now.');
    const { la, lo } = this.coords(body?.lat, body?.lng);
    const config = await this.getConfig(day.companyId);
    const vehicle = String(body?.vehicle ?? '').trim();
    if (config.rates.length && !config.rates.some((r) => r.vehicle.toLowerCase() === vehicle.toLowerCase())) {
      throw new BadRequestException(`Pick how you are travelling: ${config.rates.map((r) => r.vehicle).join(', ')}`);
    }
    return this.prisma.fieldVisitAttendance.update({
      where: { id: day.id },
      data: { journeyStartAt: new Date(), journeyStartLat: la, journeyStartLng: lo, journeyVehicle: vehicle || null },
      select: { id: true, journeyStartAt: true, journeyVehicle: true },
    });
  }

  async endJourney(userId: number, body: { requestId?: number; lat: number; lng: number }) {
    const day = await this.todaysNcrDay(userId, body?.requestId);
    if (!day.journeyStartAt) throw new BadRequestException('Start your journey first.');
    if (day.journeyEndAt) throw new BadRequestException('You already ended your journey today.');
    const { la, lo } = this.coords(body?.lat, body?.lng);
    return this.prisma.fieldVisitAttendance.update({
      where: { id: day.id },
      data: { journeyEndAt: new Date(), journeyEndLat: la, journeyEndLng: lo },
      select: { id: true, journeyEndAt: true },
    });
  }

  // ─── Distance ────────────────────────────────────────────────────────────

  /**
   * Road km. With ROUTING_URL set (an OSRM server, e.g. OpenStreetMap's), the
   * driving distance; otherwise straight line × 1.3, a common road factor for
   * a city. Either way it is a claim a person approves, not a meter reading.
   */
  async roadKm(aLat: number, aLng: number, bLat: number, bLng: number): Promise<number> {
    const base = process.env.ROUTING_URL?.replace(/\/+$/, '');
    if (base) {
      try {
        const res = await fetch(`${base}/route/v1/driving/${aLng},${aLat};${bLng},${bLat}?overview=false`, {
          signal: AbortSignal.timeout(8000),
        });
        const json: any = await res.json();
        const m = json?.routes?.[0]?.distance;
        if (Number.isFinite(m)) return Math.round((m / 1000) * 10) / 10;
      } catch (err: any) {
        this.logger.warn(`Routing failed, using straight line × 1.3: ${err?.message}`);
      }
    }
    return Math.round(straightKm(aLat, aLng, bLat, bLng) * 1.3 * 10) / 10;
  }

  // ─── Claims ──────────────────────────────────────────────────────────────

  /** Create the missing claims for completed Delhi NCR visits. Safe to repeat. */
  async sweep(): Promise<{ created: number }> {
    const requests = await this.prisma.fieldVisitRequest.findMany({
      where: { status: FIELD_VISIT_STATUS.COMPLETED, travelZone: TRAVEL_ZONE.NCR },
      select: {
        id: true, requestNumber: true, companyId: true, projectId: true, location: true,
        latitude: true, longitude: true, endDate: true,
        attendances: {
          where: { clockInTime: { not: null } },
          select: {
            employeeId: true, visitDate: true, journeyVehicle: true,
            journeyStartLat: true, journeyStartLng: true, journeyEndLat: true, journeyEndLng: true,
          },
          orderBy: { visitDate: 'asc' },
        },
      },
    });
    let created = 0;
    for (const r of requests) {
      const existing = await this.prisma.expenseClaim.findMany({
        where: { fieldVisitRequestId: r.id }, select: { employeeId: true },
      });
      const done = new Set(existing.map((e) => e.employeeId));
      const people = [...new Set(r.attendances.map((a) => a.employeeId))].filter((id) => !done.has(id));
      if (!people.length) continue;
      const config = await this.getConfig(r.companyId);
      if (!config.rates.length) {
        this.logger.warn(`No travel rates set for company ${r.companyId}; ${r.requestNumber} waits`);
        continue;
      }
      for (const employeeId of people) {
        if (await this.createClaim(r, employeeId, config)) created++;
      }
    }
    return { created };
  }

  private async createClaim(r: any, employeeId: number, config: TravelConfig): Promise<boolean> {
    const office = await this.officeOf(r.companyId, employeeId);
    const days: any[] = [];
    for (const a of r.attendances.filter((x: any) => x.employeeId === employeeId)) {
      const from = a.journeyStartLat != null
        ? { lat: a.journeyStartLat, lng: a.journeyStartLng, label: 'Start journey' }
        : office ? { ...office, label: 'Office (no Start journey)' } : null;
      if (!from) continue;
      const goingKm = await this.roadKm(from.lat, from.lng, r.latitude, r.longitude);
      const returnKm = a.journeyEndLat != null
        ? await this.roadKm(r.latitude, r.longitude, a.journeyEndLat, a.journeyEndLng)
        : goingKm;
      const rate = config.rates.find((x) => x.vehicle.toLowerCase() === String(a.journeyVehicle ?? '').toLowerCase())
        ?? config.rates[0];
      const km = Math.round((goingKm + returnKm) * 10) / 10;
      days.push({
        date: a.visitDate.toISOString().slice(0, 10), from: from.label,
        returnTo: a.journeyEndLat != null ? 'End journey' : 'Same as going',
        goingKm, returnKm, km, vehicle: rate.vehicle, ratePerKm: rate.ratePerKm,
        amount: Math.round(km * rate.ratePerKm * 100) / 100,
      });
    }
    if (!days.length) return false;
    const amount = Math.round(days.reduce((s, d) => s + d.amount, 0) * 100) / 100;
    const totalKm = Math.round(days.reduce((s, d) => s + d.km, 0) * 10) / 10;
    const end = new Date(r.endDate);
    try {
      await this.prisma.expenseClaim.create({
        data: {
          companyId: r.companyId, employeeId, projectId: r.projectId, fieldVisitRequestId: r.id,
          title: `Travel allowance — ${r.requestNumber}`,
          description: `${days.length} day(s) to ${r.location}, ${totalKm} km. Calculated from the field visit; check before approving.`,
          amount, category: 'TRAVEL', status: 'PENDING',
          month: end.getUTCMonth() + 1, year: end.getUTCFullYear(),
          travelDetail: { site: r.location, days } as any,
        },
      });
      // Best-effort: finance decides, as with any expense claim.
      await this.notifications?.notifyApprovers({
        companyId: r.companyId, roles: ['FINANCE'],
        title: 'Travel allowance claim to review',
        message: `${r.requestNumber}: ${totalKm} km, ₹${amount} — calculated from the field visit.`,
        type: 'ACTION_REQUIRED', linkUrl: '/payroll/expenses',
      }).catch(() => undefined);
      return true;
    } catch (err: any) {
      // Another sweep got there first: the unique (visit, person) held.
      if (err?.code === 'P2002') return false;
      throw err;
    }
  }
}
