import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
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

  async getProjectVisits(projectId: number) {
    return this.prisma.fieldVisit.findMany({
      where: { projectId },
      orderBy: { startTime: 'desc' },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        photos: { select: { id: true, url: true, takenAt: true, caption: true } },
      },
    });
  }

  async getVisitById(visitId: number) {
    const visit = await this.prisma.fieldVisit.findUnique({
      where: { id: visitId },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        project: { select: { id: true, name: true, key: true, color: true } },
        photos: { orderBy: { takenAt: 'asc' } },
      },
    });
    if (!visit) throw new NotFoundException('Field visit not found');
    return visit;
  }
}
