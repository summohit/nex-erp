import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FieldVisitsService {
  constructor(private prisma: PrismaService) {}

  async startVisit(userId: number, companyId: number, data: {
    projectId: number;
    startLat: number;
    startLng: number;
    startAddress?: string;
    purpose?: string;
  }) {
    // Resolve employeeId from userId
    const employee = await this.prisma.employee.findFirst({ where: { userId } });
    if (!employee) throw new NotFoundException('Employee not found');

    // One active visit per employee — the client hides the start button while a
    // visit is running, but enforce it here so a stale client cannot double-start.
    const existing = await this.prisma.fieldVisit.findFirst({
      where: { employeeId: employee.id, status: 'IN_PROGRESS' },
      include: { project: { select: { name: true } } },
    });
    if (existing) {
      throw new ConflictException(
        `You already have a field visit in progress for ${existing.project?.name ?? 'another project'}. End it before starting a new one.`,
      );
    }

    return this.prisma.fieldVisit.create({
      data: {
        employeeId: employee.id,
        projectId: data.projectId,
        companyId,
        startTime: new Date(),
        startLat: data.startLat,
        startLng: data.startLng,
        startAddress: data.startAddress,
        purpose: data.purpose,
        status: 'IN_PROGRESS',
      },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        project: { select: { id: true, name: true, key: true, color: true } },
        photos: true,
      },
    });
  }

  async endVisit(userId: number, visitId: number, data: {
    endLat: number;
    endLng: number;
    endAddress?: string;
    distanceKm: number;
    durationMins: number;
    routePoints?: number[][];
    notes?: string;
  }) {
    const employee = await this.prisma.employee.findFirst({ where: { userId } });
    if (!employee) throw new NotFoundException('Employee not found');

    const visit = await this.prisma.fieldVisit.findUnique({ where: { id: visitId } });
    if (!visit) throw new NotFoundException('Field visit not found');
    if (visit.employeeId !== employee.id) throw new BadRequestException('Not your visit');
    if (visit.status !== 'IN_PROGRESS') throw new BadRequestException('Visit is not in progress');

    return this.prisma.fieldVisit.update({
      where: { id: visitId },
      data: {
        endTime: new Date(),
        endLat: data.endLat,
        endLng: data.endLng,
        endAddress: data.endAddress,
        distanceKm: data.distanceKm,
        durationMins: data.durationMins,
        routePoints: data.routePoints ?? [],
        notes: data.notes,
        status: 'COMPLETED',
      },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        project: { select: { id: true, name: true, key: true, color: true } },
        photos: true,
      },
    });
  }

  async cancelVisit(userId: number, visitId: number) {
    const employee = await this.prisma.employee.findFirst({ where: { userId } });
    if (!employee) throw new NotFoundException('Employee not found');

    const visit = await this.prisma.fieldVisit.findUnique({ where: { id: visitId } });
    if (!visit) throw new NotFoundException('Field visit not found');
    if (visit.employeeId !== employee.id) throw new BadRequestException('Not your visit');
    if (visit.status !== 'IN_PROGRESS') throw new BadRequestException('Visit is not in progress');

    return this.prisma.fieldVisit.update({
      where: { id: visitId },
      data: { status: 'CANCELLED' },
    });
  }

  async addPhoto(userId: number, visitId: number, data: {
    url: string;
    takenAt: string;
    caption?: string;
  }) {
    const employee = await this.prisma.employee.findFirst({ where: { userId } });
    if (!employee) throw new NotFoundException('Employee not found');

    const visit = await this.prisma.fieldVisit.findUnique({ where: { id: visitId } });
    if (!visit) throw new NotFoundException('Field visit not found');
    if (visit.employeeId !== employee.id) throw new BadRequestException('Not your visit');

    return this.prisma.fieldVisitPhoto.create({
      data: {
        fieldVisitId: visitId,
        url: data.url,
        takenAt: new Date(data.takenAt),
        caption: data.caption,
      },
    });
  }

  async getActiveVisit(userId: number) {
    const employee = await this.prisma.employee.findFirst({ where: { userId } });
    if (!employee) return null;

    return this.prisma.fieldVisit.findFirst({
      where: { employeeId: employee.id, status: 'IN_PROGRESS' },
      include: {
        project: { select: { id: true, name: true, key: true, color: true } },
        photos: true,
      },
    });
  }

  async getMyVisits(userId: number) {
    const employee = await this.prisma.employee.findFirst({ where: { userId } });
    if (!employee) return [];

    return this.prisma.fieldVisit.findMany({
      where: { employeeId: employee.id },
      orderBy: { startTime: 'desc' },
      include: {
        project: { select: { id: true, name: true, key: true, color: true } },
        photos: { select: { id: true, url: true, takenAt: true, caption: true } },
      },
    });
  }

  async getProjectVisits(projectId: number, companyId: number) {
    // Scope by companyId too — projectId alone would let one company's user read
    // another company's field visits by guessing an id.
    return this.prisma.fieldVisit.findMany({
      where: { projectId, companyId },
      orderBy: { startTime: 'desc' },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        photos: { select: { id: true, url: true, takenAt: true, caption: true } },
      },
    });
  }

  /** Everyone currently out on a visit, company-wide — powers the CRM "who's travelling" widget. */
  async getCompanyActiveVisits(companyId: number) {
    return this.prisma.fieldVisit.findMany({
      where: { companyId, status: 'IN_PROGRESS' },
      orderBy: { startTime: 'desc' },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        project: { select: { id: true, name: true, key: true, color: true } },
      },
    });
  }

  /** Most recently finished visits company-wide, for the same widget's activity feed. */
  async getCompanyRecentVisits(companyId: number, limit: number) {
    return this.prisma.fieldVisit.findMany({
      where: { companyId, status: { in: ['COMPLETED', 'CANCELLED'] } },
      orderBy: { startTime: 'desc' },
      take: Math.min(Math.max(limit, 1), 50),
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        project: { select: { id: true, name: true, key: true, color: true } },
        photos: { select: { id: true } },
      },
    });
  }

  /**
   * Company-wide visit log with filters, for the web Field Visits page.
   * Returns the rows plus a summary computed over the SAME filter set, so the
   * KPI cards always describe what the table is showing.
   */
  async getCompanyVisits(
    companyId: number,
    filters: {
      from?: string;
      to?: string;
      employeeId?: number;
      projectId?: number;
      status?: string;
    },
  ) {
    const where: any = { companyId };

    if (filters.employeeId) where.employeeId = filters.employeeId;
    if (filters.projectId) where.projectId = filters.projectId;
    if (filters.status) where.status = filters.status;

    if (filters.from || filters.to) {
      where.startTime = {};
      if (filters.from) where.startTime.gte = new Date(filters.from);
      if (filters.to) {
        // `to` arrives as a plain date; include the whole of that day.
        const end = new Date(filters.to);
        end.setHours(23, 59, 59, 999);
        where.startTime.lte = end;
      }
    }

    const visits = await this.prisma.fieldVisit.findMany({
      where,
      orderBy: { startTime: 'desc' },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        project: { select: { id: true, name: true, key: true, color: true } },
        photos: { select: { id: true, url: true, takenAt: true, caption: true } },
      },
    });

    const completed = visits.filter((v) => v.status === 'COMPLETED');

    return {
      visits,
      summary: {
        total: visits.length,
        active: visits.filter((v) => v.status === 'IN_PROGRESS').length,
        completed: completed.length,
        cancelled: visits.filter((v) => v.status === 'CANCELLED').length,
        totalDistanceKm: completed.reduce((sum, v) => sum + (v.distanceKm ?? 0), 0),
        totalDurationMins: completed.reduce((sum, v) => sum + (v.durationMins ?? 0), 0),
        photoCount: visits.reduce((sum, v) => sum + v.photos.length, 0),
        // Distinct people who actually went out in this window.
        employeesOut: new Set(visits.map((v) => v.employeeId)).size,
      },
    };
  }

  async getVisitById(visitId: number, companyId: number) {
    const visit = await this.prisma.fieldVisit.findUnique({
      where: { id: visitId },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        project: { select: { id: true, name: true, key: true, color: true } },
        photos: { orderBy: { takenAt: 'asc' } },
      },
    });
    // Same 404 for "missing" and "another company's" — an id probe should not be
    // able to tell the two apart.
    if (!visit || visit.companyId !== companyId) throw new NotFoundException('Field visit not found');
    return visit;
  }
}
