import {
  Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { FieldVisitActivationService } from './field-visit-activation.service';
import { FIELD_VISIT_STATUS } from '../field-visit-status';

// Re-exported so callers that already import it from here keep working.
export { FIELD_VISIT_STATUS };

const DAY_MS = 24 * 60 * 60 * 1000;

export interface FieldVisitRequestInput {
  projectId: number;
  location: string;
  latitude: number;
  longitude: number;
  startDate: string;
  endDate: string;
  /** Optional: checked against the dates rather than believed. */
  visitDays?: number;
  startTime: string;
  endTime: string;
  remarks?: string;
  employeeIds: number[];
  tasks: { name: string; description?: string }[];
  attachments?: { fileName: string; fileUrl: string; fileSize?: number }[];
  /** Raise and submit in one go, which is what the form's Submit button does. */
  submit?: boolean;
}

/**
 * Field Visit Requests: a project manager asks to take named people to a
 * client site for named days, and an administrator rules on it (§1–§3).
 *
 * Shaped like TaskHoursRequestsService — raise, review, and a record of both —
 * because the company already reads approvals that way. What differs is who
 * decides. A trip commits other people's working days and the attendance they
 * will then be held to, so it is an administrator's call and never the
 * manager's own, even when that manager is an administrator.
 *
 * Approval is where this stops being paperwork: the tasks and the per-day
 * attendance schedule are built from what was approved, which is why the
 * people named here are the source of truth for both (§14). This class owns
 * the lifecycle that fan-out hangs off.
 */
@Injectable()
export class FieldVisitRequestsService {
  private readonly logger = new Logger(FieldVisitRequestsService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private activation: FieldVisitActivationService,
  ) {}

  /** Who rules on a trip. SUPER_ADMIN is the older spelling, still in tokens. */
  private readonly APPROVER_ROLES = ['SUPERADMIN', 'SUPER_ADMIN', 'ADMIN'];

  /** Where a request is actioned, for the notification links. */
  private readonly LINK = '/field-visits/requests';

  private readonly PERSON = {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      avatarUrl: true,
      department: { select: { id: true, name: true } },
      designation: { select: { id: true, name: true } },
      user: { select: { email: true } },
    },
  } as const;

  private readonly SELECT = {
    id: true, requestNumber: true, location: true,
    latitude: true, longitude: true, geofenceRadiusM: true,
    startDate: true, endDate: true, visitDays: true,
    startTime: true, endTime: true, remarks: true,
    status: true, rejectionReason: true,
    pendingChange: true, pendingChangeAt: true,
    submittedAt: true, reviewedAt: true, createdAt: true, updatedAt: true,
    project: { select: { id: true, name: true, key: true, color: true } },
    raisedBy: this.PERSON,
    reviewedBy: { select: { id: true, firstName: true, lastName: true } },
    members: { select: { id: true, employee: this.PERSON } },
    tasks: {
      select: { id: true, name: true, description: true, position: true },
      orderBy: { position: 'asc' as const },
    },
    attachments: {
      select: { id: true, fileName: true, fileUrl: true, fileSize: true, createdAt: true },
    },
  };

  // ─── Reading the input ─────────────────────────────────────────────────────

  /**
   * A calendar day, pinned to UTC midnight.
   *
   * Visit days are days on a site, not instants: "22 September" has to be the
   * same row whether it is written by a phone in IST or a server in UTC. UTC
   * midnight is also what the rows already in the table hold, so this keeps
   * new requests comparable with the ones that predate this code.
   */
  private parseDay(value: unknown, field: string): Date {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? '').trim());
    if (!match) throw new BadRequestException(`${field} must be a date (YYYY-MM-DD)`);

    const [, y, m, d] = match;
    const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    // Date.UTC rolls 31 February forward into March rather than refusing it,
    // so the only way to catch an impossible date is to read it back.
    if (date.getUTCMonth() !== Number(m) - 1 || date.getUTCDate() !== Number(d)) {
      throw new BadRequestException(`${field} is not a real date`);
    }
    return date;
  }

  private day(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  /** "09:00" — a wall-clock time, like Shift, not an instant. */
  private parseTime(value: unknown, field: string): string {
    const text = String(value ?? '').trim();
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) {
      throw new BadRequestException(`${field} must be a 24-hour time (HH:mm)`);
    }
    return text;
  }

  private parseCoordinate(value: unknown, field: string, limit: number): number {
    const n = Number(value);
    if (!Number.isFinite(n) || Math.abs(n) > limit) {
      throw new BadRequestException(`${field} must be between -${limit} and ${limit}`);
    }
    return n;
  }

  /** Days from the first to the last inclusive: 22nd–24th is three days. */
  private spanInDays(start: Date, end: Date): number {
    return Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;
  }

  private async loadProject(companyId: number, projectId: unknown) {
    const project = await this.prisma.project.findFirst({
      where: { id: Number(projectId), companyId },
      select: {
        id: true, name: true, key: true, leadId: true,
        members: { select: { employeeId: true, role: true } },
      },
    });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  /**
   * Everything the request needs, checked before anything is written.
   *
   * The checks that look fussy are the ones the rest of the feature rests on:
   * bad coordinates make a geofence that either blocks everybody or nobody,
   * and a day count that disagrees with the dates leaves "how long is this
   * visit" with two answers.
   */
  private async normalize(companyId: number, data: FieldVisitRequestInput) {
    const project = await this.loadProject(companyId, data?.projectId);

    const location = String(data?.location ?? '').trim();
    if (!location) {
      throw new BadRequestException('Name the site — it is what everyone reads on the schedule');
    }

    const latitude = this.parseCoordinate(data?.latitude, 'Latitude', 90);
    const longitude = this.parseCoordinate(data?.longitude, 'Longitude', 180);
    // 0°, 0° is in the Atlantic. It is what an unset map picker leaves behind,
    // and every clock-in on this trip is measured from here.
    if (latitude === 0 && longitude === 0) {
      throw new BadRequestException('Pick the site on the map — every clock-in is measured from these coordinates');
    }

    const startDate = this.parseDay(data?.startDate, 'Start date');
    const endDate = this.parseDay(data?.endDate, 'End date');
    if (endDate < startDate) {
      throw new BadRequestException('The visit cannot end before it starts');
    }

    // Derived, never taken on trust. If the form sent a number it has to be
    // this one, so a mismatch is a disagreement worth showing rather than
    // silently resolving.
    const visitDays = this.spanInDays(startDate, endDate);
    if (data?.visitDays != null && Number(data.visitDays) !== visitDays) {
      throw new BadRequestException(
        `${this.day(startDate)} to ${this.day(endDate)} is ${visitDays} day(s), not ${Number(data.visitDays)}`,
      );
    }

    const startTime = this.parseTime(data?.startTime, 'Expected clock-in');
    const endTime = this.parseTime(data?.endTime, 'Expected clock-out');
    if (endTime <= startTime) {
      throw new BadRequestException(
        'The expected clock-out has to be after the clock-in — a visit running past midnight is raised as two days',
      );
    }

    const employeeIds = [
      ...new Set((data?.employeeIds ?? []).map(Number).filter(Number.isInteger)),
    ];
    if (employeeIds.length === 0) {
      throw new BadRequestException('Pick who is going — the tasks and the attendance are created for these people');
    }
    const found = await this.prisma.employee.findMany({
      where: { id: { in: employeeIds }, companyId },
      select: { id: true },
    });
    if (found.length !== employeeIds.length) {
      throw new BadRequestException('One of the selected people is not an employee of this company');
    }

    const tasks = (data?.tasks ?? [])
      .map((t, i) => ({
        name: String(t?.name ?? '').trim(),
        description: String(t?.description ?? '').trim() || null,
        position: i,
      }))
      .filter((t) => t.name.length > 0);
    if (tasks.length === 0) {
      throw new BadRequestException('Add at least one task — after approval these are what each person is assigned');
    }

    const attachments = (data?.attachments ?? [])
      .map((a) => ({
        fileName: String(a?.fileName ?? '').trim(),
        fileUrl: String(a?.fileUrl ?? '').trim(),
        fileSize: a?.fileSize == null ? null : Number(a.fileSize),
      }))
      .filter((a) => a.fileName && a.fileUrl);

    return {
      project,
      fields: {
        projectId: project.id,
        location, latitude, longitude,
        startDate, endDate, visitDays,
        startTime, endTime,
        remarks: String(data?.remarks ?? '').trim() || null,
      },
      employeeIds,
      tasks,
      attachments,
    };
  }

  // ─── Who may do what ───────────────────────────────────────────────────────

  private isApprover(role: string): boolean {
    return this.APPROVER_ROLES.includes(role);
  }

  private managesProject(project: any, employeeId: number | null): boolean {
    if (employeeId == null) return false;
    if (project?.leadId === employeeId) return true;
    return (project?.members ?? []).some(
      (m: any) => m.employeeId === employeeId && m.role === 'PROJECT_MANAGER',
    );
  }

  /** Whoever runs the project asks; an administrator may raise one anywhere. */
  private mayRaise(project: any, role: string, employeeId: number | null): boolean {
    return this.isApprover(role) || this.managesProject(project, employeeId);
  }

  /**
   * What a non-administrator is entitled to see: their own trips, the ones
   * they are going on, and the ones on projects they run.
   */
  private visibilityWhere(companyId: number, role: string, employeeId: number | null) {
    if (this.isApprover(role)) return { companyId };
    const me = employeeId ?? -1;
    return {
      companyId,
      OR: [
        { raisedById: me },
        { members: { some: { employeeId: me } } },
        { project: { leadId: me } },
        { project: { members: { some: { employeeId: me, role: 'PROJECT_MANAGER' } } } },
      ],
    };
  }

  // ─── Reading ───────────────────────────────────────────────────────────────

  async list(
    companyId: number, role: string, employeeId: number | null,
    filter: { status?: string; projectId?: string | number } = {},
  ) {
    const projectId = Number(filter?.projectId);
    return this.prisma.fieldVisitRequest.findMany({
      where: {
        ...this.visibilityWhere(companyId, role, employeeId),
        ...(filter?.status ? { status: filter.status } : {}),
        ...(Number.isInteger(projectId) ? { projectId } : {}),
      },
      orderBy: [{ createdAt: 'desc' }],
      select: this.SELECT,
    });
  }

  /**
   * One request, or nothing.
   *
   * Someone who may not see it gets the same NotFound as a request that does
   * not exist: a 403 here would confirm that trip FVR-0009 is real, which is
   * more than the caller is entitled to know.
   */
  async getOne(companyId: number, role: string, employeeId: number | null, id: number) {
    const request = await this.prisma.fieldVisitRequest.findFirst({
      where: { id, ...this.visibilityWhere(companyId, role, employeeId) },
      select: {
        ...this.SELECT,
        attendances: {
          select: {
            id: true, visitDate: true, isHoliday: true, status: true,
            // §11 asks Delivery for the coordinates, not only how far off they
            // were: "0.6km away" is a number, while a point on a map is where
            // somebody actually stood.
            clockInTime: true, clockInDistanceKm: true, clockInLat: true, clockInLng: true,
            clockOutTime: true, clockOutDistanceKm: true, clockOutLat: true, clockOutLng: true,
            // Which task the day was clocked against (§5).
            issue: { select: { id: true, key: true, title: true } },
            employee: this.PERSON,
          },
          orderBy: [{ visitDate: 'asc' }],
        },
      },
    });
    if (!request) throw new NotFoundException('Field visit request not found');

    const project = await this.loadProject(companyId, request.project.id);
    return {
      ...request,
      canEdit: request.status === FIELD_VISIT_STATUS.DRAFT
        && this.mayRaise(project, role, employeeId),
      canSubmit: request.status === FIELD_VISIT_STATUS.DRAFT
        && this.mayRaise(project, role, employeeId),
      canReview: request.status === FIELD_VISIT_STATUS.PENDING
        && this.isApprover(role)
        && employeeId !== (request.raisedBy?.id ?? null),
      canWithdraw: request.status === FIELD_VISIT_STATUS.PENDING
        && (request.raisedBy?.id === employeeId || this.isApprover(role)),
      // §10: an approved trip is changed by asking, not by editing.
      canRequestChange: request.status === FIELD_VISIT_STATUS.APPROVED
        && !request.pendingChange
        && this.mayRaise(project, role, employeeId),
      canReviewChange: !!request.pendingChange && this.isApprover(role),
    };
  }

  /** The §11 audit trail: who created, approved, rejected or cancelled it. */
  async timeline(companyId: number, role: string, employeeId: number | null, id: number) {
    await this.getOne(companyId, role, employeeId, id);
    return this.prisma.fieldVisitRequestActivity.findMany({
      where: { requestId: id },
      orderBy: [{ createdAt: 'asc' }],
      select: {
        id: true, action: true, detail: true, oldValue: true, newValue: true,
        createdAt: true, actor: this.PERSON,
      },
    });
  }

  // ─── Raising ───────────────────────────────────────────────────────────────

  /**
   * FVR-0001, per company.
   *
   * Counting rows is how the rest of the app numbers things, and it is racy in
   * one way: two requests raised in the same instant compute the same number.
   * The unique index on (companyId, requestNumber) is what actually decides,
   * so `create` retries with the next number up rather than taking a lock.
   */
  private async nextRequestNumber(tx: any, companyId: number, offset = 0): Promise<string> {
    const count = await tx.fieldVisitRequest.count({ where: { companyId } });
    return `FVR-${String(count + 1 + offset).padStart(4, '0')}`;
  }

  private isDuplicateNumber(error: any): boolean {
    return error?.code === 'P2002'
      && String(error?.meta?.target ?? '').includes('requestNumber');
  }

  async create(
    companyId: number, employeeId: number | null, role: string,
    data: FieldVisitRequestInput,
  ) {
    const { project, fields, employeeIds, tasks, attachments } =
      await this.normalize(companyId, data);

    if (!this.mayRaise(project, role, employeeId)) {
      throw new ForbiddenException('Only the project manager raises a field visit for this project');
    }
    if (employeeId == null) {
      throw new ForbiddenException('Your login is not linked to an employee record');
    }

    const submitting = data?.submit === true;
    const now = new Date();

    let created: any;
    for (let attempt = 0; ; attempt++) {
      try {
        created = await this.prisma.$transaction(async (tx) => {
          const request = await tx.fieldVisitRequest.create({
            data: {
              ...fields,
              companyId,
              raisedById: employeeId,
              requestNumber: await this.nextRequestNumber(tx, companyId, attempt),
              status: submitting ? FIELD_VISIT_STATUS.PENDING : FIELD_VISIT_STATUS.DRAFT,
              submittedAt: submitting ? now : null,
              members: { create: employeeIds.map((id) => ({ employeeId: id })) },
              tasks: { create: tasks },
              attachments: {
                create: attachments.map((a) => ({ ...a, uploadedById: employeeId })),
              },
            },
            select: this.SELECT,
          });

          await tx.fieldVisitRequestActivity.create({
            data: {
              requestId: request.id,
              action: 'CREATED',
              detail: `${fields.location}, ${this.day(fields.startDate)} to ${this.day(fields.endDate)}`
                + ` — ${employeeIds.length} person(s), ${tasks.length} task(s)`,
              actorId: employeeId,
            },
          });
          if (submitting) {
            await tx.fieldVisitRequestActivity.create({
              data: { requestId: request.id, action: 'SUBMITTED', actorId: employeeId },
            });
          }
          return request;
        });
        break;
      } catch (error) {
        if (this.isDuplicateNumber(error) && attempt < 4) continue;
        throw error;
      }
    }

    // After the commit, never inside it — a push round trip has no business
    // holding a transaction open, and a notification for a request that then
    // rolled back would point at nothing.
    if (submitting) {
      await this.notifyAwaitingApproval(companyId, created, employeeId);
      await this.notifyMembersNamed(companyId, created, employeeId);
    }
    return created;
  }

  /**
   * Edit a draft.
   *
   * Only a draft: once it is with an approver the request is what they are
   * ruling on, and once approved the members, dates, site and tasks are what
   * people have been assigned against (§10). Those changes go back through
   * approval instead.
   */
  async update(
    companyId: number, employeeId: number | null, role: string,
    id: number, data: FieldVisitRequestInput,
  ) {
    const existing = await this.prisma.fieldVisitRequest.findFirst({
      where: { id, companyId },
      select: {
        id: true, status: true, raisedById: true, projectId: true,
        location: true, startDate: true, endDate: true,
        latitude: true, longitude: true, startTime: true, endTime: true,
        members: { select: { employeeId: true } },
        tasks: { select: { name: true } },
      },
    });
    if (!existing) throw new NotFoundException('Field visit request not found');

    if (existing.status !== FIELD_VISIT_STATUS.DRAFT) {
      throw new BadRequestException(
        existing.status === FIELD_VISIT_STATUS.PENDING
          ? 'This request is with an approver — withdraw it to a draft before editing'
          : `A ${existing.status.toLowerCase().replace('_', ' ')} request cannot be edited`,
      );
    }

    const { project, fields, employeeIds, tasks, attachments } =
      await this.normalize(companyId, data);
    if (!this.mayRaise(project, role, employeeId) && existing.raisedById !== employeeId) {
      throw new ForbiddenException('You cannot edit this field visit request');
    }

    const changed = this.describeChanges(existing, fields, employeeIds, tasks);

    return this.prisma.$transaction(async (tx) => {
      // Members and tasks are replaced wholesale rather than diffed: the form
      // sends the whole list, and matching rows by name would rename a task
      // instead of replacing it whenever two happen to share one.
      await tx.fieldVisitRequestMember.deleteMany({ where: { requestId: id } });
      await tx.fieldVisitRequestTask.deleteMany({ where: { requestId: id } });

      const updated = await tx.fieldVisitRequest.update({
        where: { id },
        data: {
          ...fields,
          members: { create: employeeIds.map((e) => ({ employeeId: e })) },
          tasks: { create: tasks },
          ...(attachments.length
            ? { attachments: { create: attachments.map((a) => ({ ...a, uploadedById: employeeId as number })) } }
            : {}),
        },
        select: this.SELECT,
      });

      if (changed.length) {
        await tx.fieldVisitRequestActivity.create({
          data: {
            requestId: id, action: 'UPDATED',
            detail: changed.join(', '),
            actorId: employeeId as number,
          },
        });
      }
      return updated;
    });
  }

  /** Which of the things an approver cares about actually moved. */
  private describeChanges(
    existing: any, fields: any, employeeIds: number[], tasks: { name: string }[],
  ): string[] {
    const changed: string[] = [];
    if (existing.location !== fields.location) changed.push('site');
    if (existing.latitude !== fields.latitude || existing.longitude !== fields.longitude) {
      changed.push('coordinates');
    }
    if (this.day(existing.startDate) !== this.day(fields.startDate)
      || this.day(existing.endDate) !== this.day(fields.endDate)) {
      changed.push('dates');
    }
    if (existing.startTime !== fields.startTime || existing.endTime !== fields.endTime) {
      changed.push('hours');
    }
    const before = (existing.members ?? []).map((m: any) => m.employeeId).sort().join(',');
    if (before !== [...employeeIds].sort().join(',')) changed.push('people');
    const beforeTasks = (existing.tasks ?? []).map((t: any) => t.name).join('|');
    if (beforeTasks !== tasks.map((t) => t.name).join('|')) changed.push('tasks');
    return changed;
  }

  // ─── Deciding ──────────────────────────────────────────────────────────────

  private async loadForDecision(companyId: number, id: number) {
    const request = await this.prisma.fieldVisitRequest.findFirst({
      where: { id, companyId },
      select: {
        id: true, requestNumber: true, status: true, raisedById: true,
        companyId: true, projectId: true,
        location: true, latitude: true, longitude: true,
        startDate: true, endDate: true, visitDays: true,
        startTime: true, endTime: true,
        pendingChange: true,
        project: { select: { id: true, name: true } },
        members: { select: { employeeId: true } },
        tasks: {
          select: { id: true, name: true, description: true, position: true },
          orderBy: { position: 'asc' },
        },
      },
    });
    if (!request) throw new NotFoundException('Field visit request not found');
    return request;
  }

  async submit(companyId: number, employeeId: number | null, role: string, id: number) {
    const request = await this.loadForDecision(companyId, id);
    const project = await this.loadProject(companyId, request.project.id);

    if (!this.mayRaise(project, role, employeeId) && request.raisedById !== employeeId) {
      throw new ForbiddenException('You cannot submit this field visit request');
    }
    if (request.status !== FIELD_VISIT_STATUS.DRAFT) {
      throw new BadRequestException(`This request is already ${this.spoken(request.status)}`);
    }

    const submitted = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.fieldVisitRequest.update({
        where: { id },
        data: { status: FIELD_VISIT_STATUS.PENDING, submittedAt: new Date() },
        select: this.SELECT,
      });
      await tx.fieldVisitRequestActivity.create({
        data: { requestId: id, action: 'SUBMITTED', actorId: employeeId as number },
      });
      return updated;
    });

    await this.notifyAwaitingApproval(companyId, submitted, employeeId);
    await this.notifyMembersNamed(companyId, submitted, employeeId);
    return submitted;
  }

  /**
   * Tell the people named on a trip that they are on it (§12).
   *
   * At submission, not approval: being put down for three days at a client
   * site is worth knowing while there is still time to say "I cannot make
   * that", and the approver is often not the person who would hear it first.
   * INFO rather than ACTION_REQUIRED — nothing is being asked of them yet.
   */
  private async notifyMembersNamed(companyId: number, request: any, actorId: number | null) {
    const memberIds = (request.members ?? []).map((m: any) => m.employee?.id ?? m.employeeId);
    if (!memberIds.length) return;

    await this.notifications.notifyEmployees(memberIds, {
      companyId,
      excludeEmployeeId: actorId,
      title: 'You are on a field visit',
      message: `${this.who(request.raisedBy)} has put you on ${request.requestNumber} —`
        + ` ${request.visitDays} day(s) at ${request.location} from ${this.day(request.startDate)},`
        + ' pending approval.',
      type: 'INFO',
      linkUrl: this.LINK,
    });
  }

  /**
   * An administrator approves the trip.
   *
   * Not the person who raised it, even when they are an administrator: a field
   * visit commits other people's days, and approving your own is not an
   * approval. The same rule the additional-hours flow applies to its own
   * requester.
   */
  async approve(companyId: number, reviewerId: number | null, role: string, id: number) {
    const request = await this.requireDecidable(companyId, reviewerId, role, id);

    // The decision and what it commits people to are one write. A trip that
    // was approved but whose tasks and schedule failed to appear is worse than
    // one that was never approved: the manager has already been told it is on.
    const { approved, fanOut } = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.fieldVisitRequest.update({
        where: { id },
        data: {
          status: FIELD_VISIT_STATUS.APPROVED,
          reviewedById: reviewerId,
          reviewedAt: new Date(),
          rejectionReason: null,
        },
        select: this.SELECT,
      });

      const result = await this.activation.activate(tx, request as any, reviewerId);

      await tx.fieldVisitRequestActivity.create({
        data: {
          requestId: id, action: 'APPROVED',
          detail: `${request.visitDays} day(s) at ${request.location}`
            + ` — ${result.issues} task(s) assigned, ${result.attendanceDays} attendance day(s) scheduled`,
          actorId: reviewerId as number,
        },
      });
      return { approved: updated, fanOut: result };
    });

    await this.notifyDecided(companyId, request, approved, 'APPROVED', reviewerId, undefined, fanOut);
    return approved;
  }

  async reject(
    companyId: number, reviewerId: number | null, role: string,
    id: number, reason?: string,
  ) {
    const request = await this.requireDecidable(companyId, reviewerId, role, id);

    const text = String(reason ?? '').trim();
    if (!text) {
      throw new BadRequestException('A reason is required when rejecting — it is what the manager acts on');
    }

    const rejected = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.fieldVisitRequest.update({
        where: { id },
        data: {
          status: FIELD_VISIT_STATUS.REJECTED,
          reviewedById: reviewerId,
          reviewedAt: new Date(),
          rejectionReason: text,
        },
        select: this.SELECT,
      });
      await tx.fieldVisitRequestActivity.create({
        data: { requestId: id, action: 'REJECTED', detail: text, actorId: reviewerId as number },
      });
      return updated;
    });

    await this.notifyDecided(companyId, request, rejected, 'REJECTED', reviewerId, text);
    return rejected;
  }

  private async requireDecidable(
    companyId: number, reviewerId: number | null, role: string, id: number,
  ) {
    const request = await this.loadForDecision(companyId, id);
    if (!this.isApprover(role)) {
      throw new ForbiddenException('Only an administrator approves a field visit request');
    }
    if (reviewerId != null && request.raisedById === reviewerId) {
      throw new ForbiddenException('You cannot approve your own field visit request');
    }
    if (request.status !== FIELD_VISIT_STATUS.PENDING) {
      throw new BadRequestException(`This request is ${this.spoken(request.status)}, so there is nothing to decide`);
    }
    return request;
  }

  /**
   * Called off, by whoever raised it or an administrator.
   *
   * Allowed after approval too — a trip that is no longer happening should not
   * have to be lived with — but anyone already told about it has to be told
   * again, which is why the members are notified from here.
   */
  async cancel(
    companyId: number, employeeId: number | null, role: string,
    id: number, reason?: string,
  ) {
    const request = await this.loadForDecision(companyId, id);

    const mine = request.raisedById === employeeId;
    if (!mine && !this.isApprover(role)) {
      throw new ForbiddenException('Only the person who raised this, or an administrator, can cancel it');
    }
    const finished: string[] = [
      FIELD_VISIT_STATUS.CANCELLED, FIELD_VISIT_STATUS.REJECTED, FIELD_VISIT_STATUS.COMPLETED,
    ];
    if (finished.includes(request.status)) {
      throw new BadRequestException(`This request is already ${this.spoken(request.status)}`);
    }

    const wasApproved = request.status === FIELD_VISIT_STATUS.APPROVED;
    const text = String(reason ?? '').trim() || null;

    const cancelled = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.fieldVisitRequest.update({
        where: { id },
        data: { status: FIELD_VISIT_STATUS.CANCELLED },
        select: this.SELECT,
      });

      // Only an approved trip claimed anything to give back.
      const undone = wasApproved
        ? await this.activation.deactivate(tx, request as any, employeeId)
        : null;

      await tx.fieldVisitRequestActivity.create({
        data: {
          requestId: id, action: 'CANCELLED',
          detail: [
            text,
            undone && `${undone.issues} task(s) archived, ${undone.attendanceDays} unclocked day(s) released`,
          ].filter(Boolean).join(' — ') || null,
          oldValue: request.status, newValue: FIELD_VISIT_STATUS.CANCELLED,
          actorId: employeeId as number,
        },
      });
      return updated;
    });

    if (wasApproved) {
      await this.notifications.notifyEmployees(
        [request.raisedById, ...request.members.map((m) => m.employeeId)],
        {
          companyId,
          excludeEmployeeId: employeeId,
          title: 'Field visit cancelled',
          message: `${request.requestNumber} — ${request.location} is off${text ? `: ${text}` : '.'}`,
          type: 'WARNING',
          linkUrl: this.LINK,
        },
      );
    }
    return cancelled;
  }

  private spoken(status: string): string {
    return status.toLowerCase().replace(/_/g, ' ');
  }

  // ─── Telling people ────────────────────────────────────────────────────────

  private who(person: any): string {
    return `${person?.firstName ?? ''} ${person?.lastName ?? ''}`.trim() || 'Someone';
  }

  /**
   * ACTION_REQUIRED, because the trip cannot happen until somebody rules on
   * it — precisely the notification a mute must not swallow.
   */
  private async notifyAwaitingApproval(companyId: number, request: any, raiserId: number | null) {
    const reached = await this.notifications.notifyApprovers({
      companyId,
      roles: this.APPROVER_ROLES,
      title: 'Field visit awaiting approval',
      message: `${this.who(request.raisedBy)} raised ${request.requestNumber} — `
        + `${request.visitDays} day(s) at ${request.location} for ${request.project?.name ?? 'a project'}.`,
      type: 'ACTION_REQUIRED',
      linkUrl: this.LINK,
    });

    // A company with no administrator other than the requester leaves the trip
    // in a queue nobody is watching. It still has to be approved, so say so
    // here rather than let it age silently.
    if (reached === 0) {
      this.logger.warn(
        `Field visit ${request.requestNumber} reached no approver — `
        + `company ${companyId} has no administrator other than employee ${raiserId}.`,
      );
    }
  }

  /** Tell the manager and everyone named on the trip what was decided (§12). */
  private async notifyDecided(
    companyId: number, request: any, updated: any,
    decision: 'APPROVED' | 'REJECTED', reviewerId: number | null, reason?: string,
    fanOut?: { issues: number },
  ) {
    const approved = decision === 'APPROVED';
    const audience = approved
      ? [request.raisedById, ...request.members.map((m: any) => m.employeeId)]
      : [request.raisedById];

    await this.notifications.notifyEmployees(audience, {
      companyId,
      excludeEmployeeId: reviewerId,
      title: approved ? 'Field visit approved' : 'Field visit rejected',
      // The task count rides on this message rather than arriving as its own
      // notification per task: a three-person trip with four tasks would
      // otherwise send twelve, which is noise, not news.
      message: approved
        ? `${updated.requestNumber} — ${request.visitDays} day(s) at ${request.location} from ${this.day(request.startDate)}.`
          + `${fanOut?.issues ? ` ${fanOut.issues} task(s) are on your board.` : ''}`
        : `${updated.requestNumber} — ${request.location} was declined: ${reason}`,
      type: approved ? 'SUCCESS' : 'WARNING',
      linkUrl: this.LINK,
    });
  }

  // ─── Changing a trip that is already approved (§10) ────────────────────────

  /**
   * Pull a submitted request back to a draft.
   *
   * `update` tells people to do this, so it has to exist. Only before anybody
   * has ruled on it: once approved, changes go through `requestModification`
   * below.
   */
  async withdraw(companyId: number, employeeId: number | null, role: string, id: number) {
    const request = await this.loadForDecision(companyId, id);
    if (request.raisedById !== employeeId && !this.isApprover(role)) {
      throw new ForbiddenException('Only the person who raised this, or an administrator, can withdraw it');
    }
    if (request.status !== FIELD_VISIT_STATUS.PENDING) {
      throw new BadRequestException(`This request is ${this.spoken(request.status)}, so there is nothing to withdraw`);
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.fieldVisitRequest.update({
        where: { id },
        data: { status: FIELD_VISIT_STATUS.DRAFT, submittedAt: null },
        select: this.SELECT,
      });
      await tx.fieldVisitRequestActivity.create({
        data: {
          requestId: id, action: 'WITHDRAWN',
          oldValue: FIELD_VISIT_STATUS.PENDING, newValue: FIELD_VISIT_STATUS.DRAFT,
          actorId: employeeId as number,
        },
      });
      return updated;
    });
  }

  /**
   * Propose a change to an approved trip (§10).
   *
   * The proposal is stored, not applied. The trip goes on running on the terms
   * it was approved with — people are at the site today, clocking against
   * those coordinates — and an administrator decides whether the new terms
   * replace them. That is the whole point of §10: nobody is added to or
   * removed from a trip without the authorisation that put them there.
   */
  async requestModification(
    companyId: number, employeeId: number | null, role: string,
    id: number, data: FieldVisitRequestInput,
  ) {
    const request = await this.loadForDecision(companyId, id);
    if (request.status !== FIELD_VISIT_STATUS.APPROVED) {
      throw new BadRequestException(
        `Only an approved field visit is changed this way — this one is ${this.spoken(request.status)}`,
      );
    }
    if (request.pendingChange) {
      throw new BadRequestException('There is already a change waiting for a decision on this trip');
    }

    // Validated now rather than at approval, so an impossible change is
    // refused while the person proposing it is still looking at it.
    const { project, fields, employeeIds, tasks } = await this.normalize(companyId, data);
    if (!this.mayRaise(project, role, employeeId) && request.raisedById !== employeeId) {
      throw new ForbiddenException('You cannot change this field visit request');
    }
    if (project.id !== request.projectId) {
      throw new BadRequestException(
        'A trip cannot be moved to another project — raise it against that project instead',
      );
    }

    const changed = this.describeChanges(request, fields, employeeIds, tasks);
    if (!changed.length) {
      throw new BadRequestException('Nothing in this request would change');
    }

    const proposal = {
      ...fields,
      startDate: fields.startDate.toISOString(),
      endDate: fields.endDate.toISOString(),
      employeeIds,
      tasks,
    };

    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.fieldVisitRequest.update({
        where: { id },
        data: { pendingChange: proposal, pendingChangeAt: new Date() },
        select: this.SELECT,
      });
      await tx.fieldVisitRequestActivity.create({
        data: {
          requestId: id, action: 'MODIFICATION_REQUESTED',
          detail: `Proposed changes to ${changed.join(', ')}`,
          actorId: employeeId as number,
        },
      });
      return saved;
    });

    await this.notifications.notifyApprovers({
      companyId,
      roles: this.APPROVER_ROLES,
      title: 'Field visit change awaiting approval',
      message: `${this.who(updated.raisedBy)} asked to change ${request.requestNumber}`
        + ` (${changed.join(', ')}) at ${request.location}.`,
      type: 'ACTION_REQUIRED',
      linkUrl: this.LINK,
    });
    return updated;
  }

  /**
   * Approve the change, and make the work match it.
   *
   * The fan-out is reconciled rather than rebuilt: somebody dropped from the
   * trip loses their days and has their tasks archived, somebody added gets
   * both, and a day already clocked survives whatever the change did to the
   * range around it.
   */
  async approveModification(
    companyId: number, reviewerId: number | null, role: string, id: number,
  ) {
    const request = await this.requirePendingChange(companyId, reviewerId, role, id);
    const proposal: any = request.pendingChange;

    const { result, applied } = await this.prisma.$transaction(async (tx) => {
      await tx.fieldVisitRequestMember.deleteMany({ where: { requestId: id } });
      await tx.fieldVisitRequestTask.deleteMany({ where: { requestId: id } });

      const saved = await tx.fieldVisitRequest.update({
        where: { id },
        data: {
          location: proposal.location,
          latitude: proposal.latitude,
          longitude: proposal.longitude,
          startDate: new Date(proposal.startDate),
          endDate: new Date(proposal.endDate),
          visitDays: proposal.visitDays,
          startTime: proposal.startTime,
          endTime: proposal.endTime,
          remarks: proposal.remarks ?? null,
          members: { create: (proposal.employeeIds ?? []).map((e: number) => ({ employeeId: e })) },
          tasks: { create: proposal.tasks ?? [] },
          // DbNull, not null: to Prisma a plain null on a Json column means
          // the JSON value `null`, which is a proposal that exists and says
          // nothing. DbNull is the empty column.
          pendingChange: Prisma.DbNull,
          pendingChangeAt: null,
          reviewedById: reviewerId,
          reviewedAt: new Date(),
        },
        select: this.SELECT,
      });

      const reconciled = await this.activation.reconcile(
        tx,
        {
          id: saved.id,
          requestNumber: saved.requestNumber,
          companyId,
          projectId: request.projectId,
          raisedById: request.raisedById,
          location: saved.location,
          startDate: saved.startDate,
          endDate: saved.endDate,
          startTime: saved.startTime,
          endTime: saved.endTime,
          members: saved.members.map((m: any) => ({ employeeId: m.employee.id })),
          tasks: saved.tasks.map((t: any) => ({
            id: t.id, name: t.name, description: t.description, position: t.position,
          })),
        },
        reviewerId,
      );

      await tx.fieldVisitRequestActivity.create({
        data: {
          requestId: id, action: 'MODIFICATION_APPROVED',
          detail: `${reconciled.issues} task(s) assigned, ${reconciled.attendanceDays} day(s) scheduled`
            + `, ${reconciled.archivedTasks} task(s) archived, ${reconciled.releasedDays} day(s) released`,
          actorId: reviewerId as number,
        },
      });
      return { result: saved, applied: reconciled };
    });

    await this.notifications.notifyEmployees(
      [request.raisedById, ...result.members.map((m: any) => m.employee.id)],
      {
        companyId,
        excludeEmployeeId: reviewerId,
        title: 'Field visit changed',
        message: `${result.requestNumber} — ${result.visitDays} day(s) at ${result.location}`
          + ` from ${this.day(result.startDate)}.`
          + `${applied.archivedTasks ? ` ${applied.archivedTasks} task(s) no longer apply.` : ''}`,
        type: 'INFO',
        linkUrl: this.LINK,
      },
    );
    return result;
  }

  /** Turn the change down. The trip carries on exactly as approved. */
  async rejectModification(
    companyId: number, reviewerId: number | null, role: string,
    id: number, reason?: string,
  ) {
    const request = await this.requirePendingChange(companyId, reviewerId, role, id);

    const text = String(reason ?? '').trim();
    if (!text) {
      throw new BadRequestException('A reason is required when turning down a change');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.fieldVisitRequest.update({
        where: { id },
        data: { pendingChange: Prisma.DbNull, pendingChangeAt: null },
        select: this.SELECT,
      });
      await tx.fieldVisitRequestActivity.create({
        data: {
          requestId: id, action: 'MODIFICATION_REJECTED', detail: text,
          actorId: reviewerId as number,
        },
      });
      return saved;
    });

    await this.notifications.notifyEmployees([request.raisedById], {
      companyId,
      excludeEmployeeId: reviewerId,
      title: 'Field visit change declined',
      message: `${request.requestNumber} stays as approved: ${text}`,
      type: 'WARNING',
      linkUrl: this.LINK,
    });
    return updated;
  }

  private async requirePendingChange(
    companyId: number, reviewerId: number | null, role: string, id: number,
  ) {
    const request = await this.loadForDecision(companyId, id);
    if (!this.isApprover(role)) {
      throw new ForbiddenException('Only an administrator rules on a change to an approved field visit');
    }
    if (!request.pendingChange) {
      throw new BadRequestException('There is no change waiting on this trip');
    }
    return request;
  }
}
