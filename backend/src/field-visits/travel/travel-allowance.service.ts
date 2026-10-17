import {
  BadRequestException, ForbiddenException, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { isSuperAdmin, hasRole } from '../../common/company-roles';
import { istDateKey } from '../../common/timezone.util';
import { FIELD_VISIT_STATUS } from '../field-visit-status';

export const TRAVEL_ZONE = { NCR: 'DELHI_NCR', OUTSTATION: 'OUTSTATION' } as const;
export type TravelZone = typeof TRAVEL_ZONE[keyof typeof TRAVEL_ZONE];

export type TravelKind = 'PER_KM' | 'ACTUAL_FARE';
/**
 * PER_KM: own bike or car, distance × rate. ACTUAL_FARE: metro, bus, auto or
 * cab, where the person enters what they paid; `receiptRequired` says whether
 * a ticket or receipt photo must go with it.
 */
export interface TravelRate { vehicle: string; kind: TravelKind; ratePerKm: number; receiptRequired?: boolean }
/**
 * Per-km pay comes from the person's salary grade (Payroll → Grades);
 * `defaultRatePerKm` is used only when their grade, or interns, have no rate.
 * The vehicle list says what can be picked and how each is paid.
 */
export interface TravelConfig {
  ncrRadiusKm: number; maxFarePerDay: number; defaultRatePerKm: number; rates: TravelRate[]; isDefault?: boolean;
  /** Signed-in employee's resolved salary grade label (e.g. "G3", "Intern", "Standard"). */
  myGrade?: string;
  /** Signed-in employee's effective per-km rate from their salary grade (or default fallback). */
  myRatePerKm?: number;
}

/** Starting list for a company that has not set its own: all modes use salary grade per-km rate. */
export const DEFAULT_RATES: TravelRate[] = [
  { vehicle: 'Bike / Scooter', kind: 'PER_KM', ratePerKm: 0 },
  { vehicle: 'Car', kind: 'PER_KM', ratePerKm: 0 },
  { vehicle: 'Metro', kind: 'PER_KM', ratePerKm: 0 },
  { vehicle: 'Bus', kind: 'PER_KM', ratePerKm: 0 },
  { vehicle: 'Auto / Cab', kind: 'PER_KM', ratePerKm: 0 },
];
const DEFAULT_CONFIG: TravelConfig = { ncrRadiusKm: 60, maxFarePerDay: 500, defaultRatePerKm: 4, rates: DEFAULT_RATES };

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
    const raw: any = row?.travelAllowanceConfig;
    if (!raw) return { ...DEFAULT_CONFIG, rates: DEFAULT_RATES.map((r) => ({ ...r })), isDefault: true };
    return {
      ncrRadiusKm: Number(raw.ncrRadiusKm) > 0 ? Number(raw.ncrRadiusKm) : DEFAULT_CONFIG.ncrRadiusKm,
      maxFarePerDay: Number(raw.maxFarePerDay) >= 0 && raw.maxFarePerDay != null ? Number(raw.maxFarePerDay) : DEFAULT_CONFIG.maxFarePerDay,
      // Saved before grades set the rate: the first per-km vehicle's rate.
      defaultRatePerKm: raw.defaultRatePerKm != null && Number(raw.defaultRatePerKm) >= 0
        ? Number(raw.defaultRatePerKm)
        : Number((Array.isArray(raw.rates) ? raw.rates : []).find((r: any) => r?.kind !== 'ACTUAL_FARE' && Number(r?.ratePerKm) > 0)?.ratePerKm) || DEFAULT_CONFIG.defaultRatePerKm,
      rates: Array.isArray(raw.rates)
        ? raw.rates.filter((r: any) => r?.vehicle).map((r: any) => this.cleanRate(r))
        : [],
    };
  }

  /**
   * Settings enriched with the signed-in employee's salary grade & per-km rate,
   * so both own-vehicle and public-transport options display their grade rate in the UI.
   */
  async getSettingsForUser(companyId: number, userId?: number): Promise<TravelConfig> {
    const config = await this.getConfig(companyId);
    if (!userId) return config;
    const emp = await this.prisma.employee?.findFirst?.({
      where: { userId },
      select: { id: true },
    });
    if (!emp) {
      return { ...config, myGrade: 'Standard', myRatePerKm: config.defaultRatePerKm };
    }
    const graded = await this.gradeRate(companyId, emp.id);
    const myRatePerKm = graded.rate != null ? graded.rate : config.defaultRatePerKm;
    const myGrade = graded.label && graded.label !== 'No grade' ? graded.label : 'Standard';
    return {
      ...config,
      myGrade,
      myRatePerKm,
    };
  }

  private cleanRate(r: any): TravelRate {
    const kind: TravelKind = r?.kind === 'ACTUAL_FARE' ? 'ACTUAL_FARE' : 'PER_KM';
    return {
      vehicle: String(r?.vehicle ?? '').trim(), kind,
      ratePerKm: 0,
      ...(kind === 'ACTUAL_FARE' ? { receiptRequired: !!r?.receiptRequired } : {}),
    };
  }

  async setConfig(companyId: number, role: string, body: Partial<TravelConfig>): Promise<TravelConfig> {
    if (!isSuperAdmin(role)) throw new ForbiddenException('Only the super admin sets travel allowance rates');
    const radius = Number(body?.ncrRadiusKm);
    if (!(radius > 0 && radius <= 500)) throw new BadRequestException('The Delhi NCR radius must be between 1 and 500 km');
    const maxFare = Number(body?.maxFarePerDay ?? DEFAULT_CONFIG.maxFarePerDay);
    if (!(maxFare >= 0 && maxFare <= 100000)) throw new BadRequestException('The daily fare limit must be between 0 and 100000');
    const defaultRate = Number(body?.defaultRatePerKm ?? DEFAULT_CONFIG.defaultRatePerKm);
    if (!(defaultRate >= 0 && defaultRate <= 1000)) throw new BadRequestException('The default rate per km must be between 0 and 1000');
    const rates = (Array.isArray(body?.rates) ? body.rates : []).map((r: any) => this.cleanRate(r));
    if (rates.some((r) => !r.vehicle)) throw new BadRequestException('Each vehicle needs a name');
    if (new Set(rates.map((r) => r.vehicle.toLowerCase())).size !== rates.length) {
      throw new BadRequestException('Each vehicle can be listed once');
    }
    const config: TravelConfig = { ncrRadiusKm: radius, maxFarePerDay: maxFare, defaultRatePerKm: defaultRate, rates };
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
        id: true, companyId: true, journeyStartAt: true, journeyEndAt: true, clockInTime: true, journeyVehicle: true,
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
    // Optional and only a label: every journey is paid per km by grade.
    const vehicle = String(body?.vehicle ?? '').trim();
    return this.prisma.fieldVisitAttendance.update({
      where: { id: day.id },
      data: { journeyStartAt: new Date(), journeyStartLat: la, journeyStartLng: lo, journeyVehicle: vehicle || null },
      select: { id: true, journeyStartAt: true, journeyVehicle: true },
    });
  }

  async endJourney(
    userId: number,
    body: { requestId?: number; lat: number; lng: number; fare?: number; receiptUrl?: string },
  ) {
    const day = await this.todaysNcrDay(userId, body?.requestId);
    if (!day.journeyStartAt) throw new BadRequestException('Start your journey first.');
    if (day.journeyEndAt) throw new BadRequestException('You already ended your journey today.');
    const { la, lo } = this.coords(body?.lat, body?.lng);

    const config = await this.getConfig(day.companyId);
    const rate = config.rates.find((r) => r.vehicle.toLowerCase() === String(day.journeyVehicle ?? '').toLowerCase());
    let fare: number | null = null;
    let receiptUrl: string | null = null;
    if (rate?.kind === 'ACTUAL_FARE' && body?.fare != null && Number(body.fare) > 0) {
      fare = Number(body.fare);
      if (config.maxFarePerDay > 0 && fare > config.maxFarePerDay) {
        throw new BadRequestException(`That is more than the ₹${config.maxFarePerDay} daily limit — check the amount, or ask finance.`);
      }
      receiptUrl = String(body?.receiptUrl ?? '').trim() || null;
      if (rate.receiptRequired && !receiptUrl) {
        throw new BadRequestException(`Attach the ${rate.vehicle} receipt or app screenshot.`);
      }
      fare = Math.round(fare * 100) / 100;
    }
    // The End journey tap is a real location reading: add it to the route,
    // so a recording that stopped early (app reinstalled, phone killed it)
    // still counts the last stretch instead of showing 0 km.
    const endedAt = new Date();
    const row = await this.prisma.fieldVisitAttendance.findUnique({ where: { id: day.id }, select: { journeyRoute: true } });
    const route: number[][] = Array.isArray(row?.journeyRoute) ? [...(row!.journeyRoute as any)] : [];
    route.push([la, lo, endedAt.getTime()]);
    return this.prisma.fieldVisitAttendance.update({
      where: { id: day.id },
      data: {
        journeyEndAt: endedAt, journeyEndLat: la, journeyEndLng: lo, journeyFare: fare, journeyFareReceiptUrl: receiptUrl,
        journeyRoute: route as any, journeyTrackedKm: TravelAllowanceService.trackedKm(route),
      },
      select: { id: true, journeyEndAt: true, journeyFare: true },
    });
  }

  // ─── Route points (Android app) ──────────────────────────────────────────

  /**
   * Points the app recorded between Start and End journey, sent in batches.
   * Accepted for today's NCR day once the journey has started; duplicates (by
   * time) are dropped and the tracked km recomputed each time.
   */
  async addRoutePoints(userId: number, body: { requestId?: number; points?: unknown }) {
    const raw = Array.isArray(body?.points) ? body.points : [];
    const incoming = raw
      .map((p: any) => [Number(p?.[0]), Number(p?.[1]), Number(p?.[2])])
      .filter(([la, lo, t]) => Number.isFinite(la) && Number.isFinite(lo) && Number.isFinite(t)
        && Math.abs(la) <= 90 && Math.abs(lo) <= 180 && !(la === 0 && lo === 0));
    const day = await this.todaysNcrDay(userId, body?.requestId);
    if (!day.journeyStartAt) throw new BadRequestException('Start your journey first.');
    if (!incoming.length) return { accepted: 0, trackedKm: null };

    const row = await this.prisma.fieldVisitAttendance.findUnique({
      where: { id: day.id }, select: { journeyRoute: true },
    });
    const existing: number[][] = Array.isArray(row?.journeyRoute) ? (row!.journeyRoute as any) : [];
    const seen = new Set(existing.map((p) => p[2]));
    const startMs = new Date(day.journeyStartAt).getTime() - 60_000;
    const merged = [...existing, ...incoming.filter((p) => !seen.has(p[2]) && p[2] >= startMs)]
      .sort((a, b) => a[2] - b[2])
      .slice(0, 5000);
    const trackedKm = TravelAllowanceService.trackedKm(merged);
    await this.prisma.fieldVisitAttendance.update({
      where: { id: day.id },
      data: { journeyRoute: merged as any, journeyTrackedKm: trackedKm },
    });
    return { accepted: merged.length - existing.length, trackedKm };
  }

  /**
   * Length of a recorded path, ignoring GPS jumps: a step implying more than
   * 150 km/h is dropped as noise rather than counted.
   */
  static trackedKm(points: number[][]): number {
    let km = 0;
    let prev: number[] | null = null;
    for (const p of points) {
      if (prev) {
        const d = straightKm(prev[0], prev[1], p[0], p[1]);
        const hours = Math.max((p[2] - prev[2]) / 3_600_000, 1 / 3600);
        if (d / hours > 150) continue;
        km += d;
      }
      prev = p;
    }
    return Math.round(km * 10) / 10;
  }

  /** The route behind a travel claim, for the map: claimant or an expense approver. */
  async claimRoute(companyId: number, claimId: number, viewer: { employeeId: number | null; mayApprove: boolean }) {
    const claim = await this.prisma.expenseClaim.findFirst({
      where: { id: claimId, companyId },
      select: { employeeId: true, fieldVisitRequestId: true },
    });
    if (!claim?.fieldVisitRequestId) throw new BadRequestException('This is not a travel allowance claim');
    if (!viewer.mayApprove && claim.employeeId !== viewer.employeeId) {
      throw new ForbiddenException('You cannot see this route');
    }
    const req = await this.prisma.fieldVisitRequest.findUnique({
      where: { id: claim.fieldVisitRequestId },
      select: {
        location: true, latitude: true, longitude: true,
        attendances: {
          where: { employeeId: claim.employeeId ?? -1 },
          select: {
            visitDate: true, journeyVehicle: true, journeyTrackedKm: true, journeyRoute: true,
            journeyStartLat: true, journeyStartLng: true, journeyEndLat: true, journeyEndLng: true,
            clockInLat: true, clockInLng: true,
          },
          orderBy: { visitDate: 'asc' },
        },
      },
    });
    return {
      site: { name: req?.location, lat: req?.latitude, lng: req?.longitude },
      days: (req?.attendances ?? []).map((a) => ({
        date: a.visitDate.toISOString().slice(0, 10),
        vehicle: a.journeyVehicle,
        trackedKm: a.journeyTrackedKm,
        start: a.journeyStartLat != null ? { lat: a.journeyStartLat, lng: a.journeyStartLng } : null,
        end: a.journeyEndLat != null ? { lat: a.journeyEndLat, lng: a.journeyEndLng } : null,
        route: Array.isArray(a.journeyRoute) ? (a.journeyRoute as number[][]).map((p) => [p[0], p[1]]) : [],
      })),
    };
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

  // ─── Live view ───────────────────────────────────────────────────────────

  /** Finance and super admin watch journeys; nobody else (16 Oct 2026). */
  static mayWatch(role?: string | null): boolean {
    return hasRole(role, 'SUPERADMIN', 'FINANCE');
  }

  /**
   * Today's Delhi NCR journeys, for the live map. Only what the phone sends
   * between Start and End journey exists here; nothing is recorded outside a
   * journey. A journey whose phone has gone quiet shows its last position
   * and how long ago that was, rather than pretending to be live.
   */
  async liveJourneys(companyId: number, role?: string | null, date?: string) {
    if (!TravelAllowanceService.mayWatch(role)) throw new ForbiddenException('Only finance or the super admin can watch journeys');
    // ?date=YYYY-MM-DD looks back at a past day; nothing is live then.
    const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00.000Z`) : istDateKey(new Date());
    const rows = await this.prisma.fieldVisitAttendance.findMany({
      where: {
        companyId,
        visitDate: day,
        journeyStartAt: { not: null },
        request: { travelZone: TRAVEL_ZONE.NCR },
      },
      select: {
        id: true, journeyStartAt: true, journeyEndAt: true, journeyTrackedKm: true, journeyRoute: true,
        journeyStartLat: true, journeyStartLng: true, journeyEndLat: true, journeyEndLng: true,
        clockInTime: true, clockOutTime: true, clockInDistanceKm: true,
        employee: {
          select: {
            id: true, firstName: true, lastName: true, avatarUrl: true, employeeCode: true,
            department: { select: { name: true } },
            designation: { select: { name: true } },
          },
        },
        request: {
          select: { id: true, requestNumber: true, location: true, latitude: true, longitude: true, geofenceRadiusM: true },
        },
      },
      orderBy: { journeyStartAt: 'desc' },
    });
    const now = Date.now();
    return rows.map((r) => {
      const route: number[][] = Array.isArray(r.journeyRoute) ? (r.journeyRoute as any) : [];
      const last = route.length ? route[route.length - 1] : null;
      const stage = r.journeyEndAt ? 'DONE'
        : r.clockOutTime ? 'RETURNING'
          : r.clockInTime ? 'ON_SITE'
            : 'TRAVELLING';
      const lastAt = last ? last[2] : r.journeyStartAt ? new Date(r.journeyStartAt).getTime() : null;
      const position = last
        ? { lat: last[0], lng: last[1] }
        : r.journeyStartLat != null ? { lat: r.journeyStartLat, lng: r.journeyStartLng } : null;
      const toSiteKm = position && r.request.latitude != null
        ? Math.round(straightKm(position.lat, position.lng!, r.request.latitude, r.request.longitude) * 10) / 10
        : null;
      return {
        attendanceId: r.id,
        stage,
        employee: r.employee,
        request: r.request,
        startedAt: r.journeyStartAt,
        endedAt: r.journeyEndAt,
        clockInTime: r.clockInTime,
        clockOutTime: r.clockOutTime,
        trackedKm: r.journeyTrackedKm,
        start: r.journeyStartLat != null ? { lat: r.journeyStartLat, lng: r.journeyStartLng } : null,
        end: r.journeyEndLat != null ? { lat: r.journeyEndLat, lng: r.journeyEndLng } : null,
        position,
        lastSeenAt: lastAt ? new Date(lastAt).toISOString() : null,
        /** Minutes since the phone last sent a point; over ~5 while travelling means it went quiet. */
        lastSeenMinutes: lastAt ? Math.round((now - lastAt) / 60000) : null,
        toSiteKm,
        clockInDistanceKm: r.clockInDistanceKm,
        gap: TravelAllowanceService.longestGap(route),
        /** Minutes from Start journey to End journey (or to now, if still going). */
        durationMinutes: r.journeyStartAt
          ? Math.round(((r.journeyEndAt ? new Date(r.journeyEndAt).getTime() : now) - new Date(r.journeyStartAt).getTime()) / 60000)
          : null,
        route: route.map((p) => [p[0], p[1]]),
      };
    });
  }

  /**
   * The longest stretch with no points (over 15 minutes), so finance can see
   * when a route is incomplete — the phone stopped recording — instead of
   * trusting a short "km travelled".
   */
  static longestGap(route: number[][]): { from: string; to: string; minutes: number } | null {
    let best: { a: number; b: number } | null = null;
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1][2], b = route[i][2];
      if (b - a > 15 * 60000 && (!best || b - a > best.b - best.a)) best = { a, b };
    }
    return best
      ? { from: new Date(best.a).toISOString(), to: new Date(best.b).toISOString(), minutes: Math.round((best.b - best.a) / 60000) }
      : null;
  }

  /**
   * The employee's own map: the road from where they are to today's site,
   * with distance and time, plus the path recorded so far. Works for any
   * approved visit today (not only Delhi NCR), as it is only directions.
   */
  async routePreview(userId: number, q: { requestId?: string; lat?: string; lng?: string }) {
    const lat = Number(q.lat), lng = Number(q.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new BadRequestException('Your location is needed');
    const employee = await this.prisma.employee.findFirst({ where: { userId }, select: { id: true } });
    if (!employee) throw new BadRequestException('No employee profile');
    const day = await this.prisma.fieldVisitAttendance.findFirst({
      where: {
        employeeId: employee.id,
        visitDate: istDateKey(new Date()),
        request: { status: FIELD_VISIT_STATUS.APPROVED, ...(q.requestId ? { id: Number(q.requestId) } : {}) },
      },
      select: {
        journeyRoute: true, journeyTrackedKm: true, journeyStartAt: true, journeyEndAt: true,
        request: { select: { id: true, location: true, latitude: true, longitude: true, geofenceRadiusM: true } },
      },
      orderBy: { requestId: 'desc' },
    });
    if (!day) throw new BadRequestException('You are not scheduled on an approved field visit today.');
    const site = day.request;
    const road = await this.roadPath(lat, lng, site.latitude, site.longitude);
    const route: number[][] = Array.isArray(day.journeyRoute) ? (day.journeyRoute as any) : [];
    return {
      site: { name: site.location, lat: site.latitude, lng: site.longitude, radiusM: site.geofenceRadiusM },
      from: { lat, lng },
      ...road,
      straightKm: Math.round(straightKm(lat, lng, site.latitude, site.longitude) * 10) / 10,
      recorded: route.map((p) => [p[0], p[1]]),
      trackedKm: day.journeyTrackedKm,
      journeyActive: !!day.journeyStartAt && !day.journeyEndAt,
    };
  }

  /** Road path, distance and time via ROUTING_URL (OSRM); a straight line if it is not set or fails. */
  private async roadPath(aLat: number, aLng: number, bLat: number, bLng: number) {
    const base = process.env.ROUTING_URL?.replace(/\/+$/, '');
    if (base) {
      try {
        const res = await fetch(
          `${base}/route/v1/driving/${aLng},${aLat};${bLng},${bLat}?overview=full&geometries=geojson`,
          { signal: AbortSignal.timeout(8000) },
        );
        const json: any = await res.json();
        const r = json?.routes?.[0];
        if (r && Number.isFinite(r.distance)) {
          return {
            roadKm: Math.round((r.distance / 1000) * 10) / 10,
            minutes: Math.max(1, Math.round(r.duration / 60)),
            path: (r.geometry?.coordinates ?? []).map((c: number[]) => [c[1], c[0]]),
            routed: true,
          };
        }
      } catch (err: any) {
        this.logger.warn(`Route preview failed, using a straight line: ${err?.message}`);
      }
    }
    const km = Math.round(straightKm(aLat, aLng, bLat, bLng) * 1.3 * 10) / 10;
    // City traffic: about 25 km/h door to door.
    return { roadKm: km, minutes: Math.max(1, Math.round((km / 25) * 60)), path: [[aLat, aLng], [bLat, bLng]], routed: false };
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
            journeyFare: true, journeyFareReceiptUrl: true, journeyTrackedKm: true,
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

  /**
   * The per-km rate for own-vehicle trips, by salary grade (decided 15 Oct
   * 2026): one rate per grade whatever the vehicle. Consultants are graded by
   * salary like everyone else; interns (employment type Internship or
   * designation Intern) sit outside grades and get the ungraded rate. With no
   * rate set, the default rate per km from System Settings applies.
   */
  private async gradeRate(companyId: number, employeeId: number): Promise<{ rate: number | null; label: string }> {
    const emp = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        payType: true, employmentType: true, designation: { select: { name: true } },
        salaryStructures: { select: { amount: true, component: { select: { type: true } } } },
      },
    });
    if (!emp) return { rate: null, label: '' };
    const intern = /intern/i.test(emp.employmentType ?? '') || /intern/i.test(emp.designation?.name ?? '');
    if (intern) {
      const t = await this.prisma.salaryTemplate.findUnique({ where: { companyId }, select: { ungradedKmRate: true } });
      return { rate: t?.ungradedKmRate ?? null, label: 'Intern' };
    }
    const gross = emp.salaryStructures
      .filter((s) => s.component?.type === 'EARNING')
      .reduce((sum, s) => sum + (s.amount || 0), 0);
    const grades = await this.prisma.salaryGrade.findMany({
      where: { companyId }, orderBy: [{ position: 'asc' }, { minGross: 'asc' }],
      select: { name: true, minGross: true, maxGross: true, kmRate: true },
    });
    const grade = gross > 0
      ? grades.find((g) => gross >= g.minGross && (g.maxGross == null || gross <= g.maxGross))
      : undefined;
    return { rate: grade?.kmRate ?? null, label: grade?.name ?? 'No grade' };
  }

  private async createClaim(r: any, employeeId: number, config: TravelConfig): Promise<boolean> {
    const office = await this.officeOf(r.companyId, employeeId);
    const graded = await this.gradeRate(r.companyId, employeeId);
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
      // Both own vehicle and public transport are paid per km by the employee's
      // salary grade, unless an explicit actual fare was recorded.
      const rate = config.rates.find((x) => x.vehicle.toLowerCase() === String(a.journeyVehicle ?? '').toLowerCase())
        ?? config.rates.find((x) => x.kind === 'PER_KM')
        ?? config.rates[0]
        ?? { vehicle: a.journeyVehicle || 'Own Vehicle', kind: 'PER_KM' as const, ratePerKm: 0 };
      const km = Math.round((goingKm + returnKm) * 10) / 10;
      const actual = rate.kind === 'ACTUAL_FARE' && a.journeyFare != null && Number(a.journeyFare) > 0;
      const effectiveKind: TravelKind = actual ? 'ACTUAL_FARE' : 'PER_KM';
      const perKm = graded.rate != null ? graded.rate : config.defaultRatePerKm;
      days.push({
        date: a.visitDate.toISOString().slice(0, 10), from: from.label,
        returnTo: a.journeyEndLat != null ? 'End journey' : 'Same as going',
        goingKm, returnKm, km, vehicle: a.journeyVehicle || 'Per km (grade rate)', kind: effectiveKind,
        ratePerKm: actual ? null : perKm,
        grade: actual ? null : graded.rate != null ? graded.label : `${graded.label} · default rate`,
        fare: actual ? (a.journeyFare ?? 0) : null,
        receiptUrl: actual ? a.journeyFareReceiptUrl ?? null : null,
        trackedKm: a.journeyTrackedKm ?? null,
        // A recorded route much longer or shorter than the road estimate is
        // worth a look; it does not change the amount.
        ...(!actual && a.journeyTrackedKm != null && km > 0 && Math.abs(a.journeyTrackedKm - km) / km > 0.3
          ? { note: `Tracked route ${a.journeyTrackedKm} km vs ${km} km estimated — check the route` } : {}),
        amount: actual ? Math.round((a.journeyFare ?? 0) * 100) / 100 : Math.round(km * perKm * 100) / 100,
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
