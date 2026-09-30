import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { isCompanyAdmin } from '../../common/company-roles';

export interface VisitLocationRequestInput {
  name: string;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  leadContactId?: number | null;
  position?: number | null;
}

@Injectable()
export class VisitLocationRequestsService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  private readonly SELECT = {
    id: true,
    name: true,
    address: true,
    latitude: true,
    longitude: true,
    position: true,
    status: true,
    reviewedAt: true,
    rejectionReason: true,
    createdAt: true,
    updatedAt: true,
    requestedBy: {
      select: { id: true, firstName: true, lastName: true, avatarUrl: true },
    },
    reviewedBy: {
      select: { id: true, firstName: true, lastName: true },
    },
    leadContact: {
      select: { id: true, name: true, companyName: true },
    },
    visitLocation: {
      select: { id: true, name: true, isActive: true },
    },
  } as const;

  private async isProjectManager(companyId: number, employeeId: number | null) {
    if (employeeId == null) return false;
    const count = await this.prisma.project.count({
      where: {
        companyId,
        OR: [
          { leadId: employeeId },
          { members: { some: { employeeId, role: 'PROJECT_MANAGER' } } },
        ],
      },
    });
    return count > 0;
  }

  async capabilities(
    companyId: number,
    employeeId: number | null,
    role: string,
  ) {
    const isAdmin = isCompanyAdmin(role);
    const isPm = await this.isProjectManager(companyId, employeeId);
    return {
      isAdmin,
      isProjectManager: isPm,
      canAdd: isAdmin || isPm,
      canReview: isAdmin,
    };
  }

  async list(companyId: number, employeeId: number | null, role: string) {
    const admin = isCompanyAdmin(role);
    if (!admin && !(await this.isProjectManager(companyId, employeeId))) {
      throw new ForbiddenException(
        'Only an administrator or project manager can view location requests',
      );
    }

    return this.prisma.visitLocationRequest.findMany({
      where: {
        companyId,
        ...(admin ? {} : { requestedById: employeeId as number }),
      },
      select: this.SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(
    companyId: number,
    employeeId: number | null,
    role: string,
    input: VisitLocationRequestInput,
  ) {
    if (
      employeeId == null ||
      !(await this.isProjectManager(companyId, employeeId))
    ) {
      throw new ForbiddenException(
        'Only a project manager can request a new visit location',
      );
    }
    if (isCompanyAdmin(role)) {
      throw new BadRequestException(
        'Administrators add visit locations directly from Master Data',
      );
    }

    const data = this.normalise(input);
    await this.assertLeadContact(companyId, data.leadContactId);

    const existing = await this.prisma.visitLocation.findFirst({
      where: { companyId, name: { equals: data.name, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existing) throw new BadRequestException('That location already exists');

    const pending = await this.prisma.visitLocationRequest.findFirst({
      where: {
        companyId,
        status: 'PENDING',
        name: { equals: data.name, mode: 'insensitive' },
      },
      select: { id: true },
    });
    if (pending)
      throw new BadRequestException(
        'That location is already awaiting approval',
      );

    const created = await this.prisma.visitLocationRequest.create({
      data: { ...data, companyId, requestedById: employeeId },
      select: this.SELECT,
    });

    await this.notifications.notifyApprovers({
      companyId,
      roles: ['SUPERADMIN', 'ADMIN'],
      title: 'Visit location awaiting approval',
      message: `${created.requestedBy.firstName} ${created.requestedBy.lastName} requested “${created.name}”.`,
      linkUrl: '/task-requests?type=VISIT_LOCATIONS',
    });

    return created;
  }

  async review(
    companyId: number,
    reviewerId: number | null,
    role: string,
    requestId: number,
    decision: 'APPROVED' | 'REJECTED',
    reason?: string,
  ) {
    if (!isCompanyAdmin(role)) {
      throw new ForbiddenException(
        'Only an administrator can review visit location requests',
      );
    }
    if (decision !== 'APPROVED' && decision !== 'REJECTED') {
      throw new BadRequestException('Decision must be APPROVED or REJECTED');
    }

    const request = await this.prisma.visitLocationRequest.findFirst({
      where: { id: requestId, companyId },
      select: {
        id: true,
        name: true,
        address: true,
        latitude: true,
        longitude: true,
        position: true,
        leadContactId: true,
        status: true,
        requestedById: true,
      },
    });
    if (!request)
      throw new NotFoundException('Visit location request not found');
    if (request.status !== 'PENDING') {
      throw new BadRequestException(
        `This request is already ${request.status.toLowerCase()}`,
      );
    }

    if (decision === 'REJECTED') {
      const rejectionReason = String(reason ?? '').trim();
      if (!rejectionReason) {
        throw new BadRequestException(
          'A reason is required when rejecting a location request',
        );
      }
      const rejected = await this.prisma.visitLocationRequest.update({
        where: { id: requestId },
        data: {
          status: 'REJECTED',
          reviewedById: reviewerId,
          reviewedAt: new Date(),
          rejectionReason,
        },
        select: this.SELECT,
      });
      await this.notifyRequester(
        companyId,
        request.requestedById,
        reviewerId,
        rejected.name,
        false,
        rejectionReason,
      );
      return rejected;
    }

    const approved = await this.prisma.$transaction(async (tx) => {
      const duplicate = await tx.visitLocation.findFirst({
        where: {
          companyId,
          name: { equals: request.name, mode: 'insensitive' },
        },
        select: { id: true },
      });
      if (duplicate)
        throw new BadRequestException('That location already exists');

      const location = await tx.visitLocation.create({
        data: {
          name: request.name,
          address: request.address,
          latitude: request.latitude,
          longitude: request.longitude,
          position: request.position,
          leadContactId: request.leadContactId,
          companyId,
        },
        select: { id: true },
      });

      return tx.visitLocationRequest.update({
        where: { id: requestId },
        data: {
          status: 'APPROVED',
          reviewedById: reviewerId,
          reviewedAt: new Date(),
          rejectionReason: null,
          visitLocationId: location.id,
        },
        select: this.SELECT,
      });
    });

    await this.notifyRequester(
      companyId,
      request.requestedById,
      reviewerId,
      approved.name,
      true,
    );
    return approved;
  }

  private normalise(input: VisitLocationRequestInput) {
    const name = String(input?.name ?? '').trim();
    if (!name) throw new BadRequestException('A location needs a name');

    const latitude = this.coordinate(input.latitude, 'latitude', -90, 90);
    const longitude = this.coordinate(input.longitude, 'longitude', -180, 180);
    if ((latitude == null) !== (longitude == null)) {
      throw new BadRequestException(
        'A pin needs both a latitude and a longitude',
      );
    }

    return {
      name,
      address: String(input.address ?? '').trim() || null,
      latitude,
      longitude,
      leadContactId:
        input.leadContactId == null ? null : Number(input.leadContactId),
      position: Number.isFinite(Number(input.position))
        ? Number(input.position)
        : 0,
    };
  }

  private coordinate(
    value: unknown,
    label: string,
    min: number,
    max: number,
  ): number | null {
    if (value == null || value === '') return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number < min || number > max) {
      throw new BadRequestException(`Invalid ${label}`);
    }
    return number;
  }

  private async assertLeadContact(
    companyId: number,
    leadContactId: number | null,
  ) {
    if (leadContactId == null) return;
    const contact = await this.prisma.leadContact.findFirst({
      where: { id: leadContactId, companyId },
      select: { id: true },
    });
    if (!contact) throw new BadRequestException('Client or contact not found');
  }

  private async notifyRequester(
    companyId: number,
    requesterId: number,
    reviewerId: number | null,
    name: string,
    approved: boolean,
    reason?: string,
  ) {
    await this.notifications.notifyEmployees([requesterId], {
      companyId,
      excludeEmployeeId: reviewerId,
      title: approved ? 'Visit location approved' : 'Visit location declined',
      message: approved
        ? `“${name}” is now available for field visits.`
        : `“${name}” was declined — ${reason}`,
      type: approved ? 'INFO' : 'ACTION_REQUIRED',
      linkUrl: '/task-requests?type=VISIT_LOCATIONS',
    });
  }
}
