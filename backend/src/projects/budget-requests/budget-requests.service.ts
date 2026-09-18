import {
  Injectable, NotFoundException, ForbiddenException, BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { canViewProjectFinancials } from '../project-visibility';

/**
 * Project budget and hours increase requests (§25).
 *
 * A project manager asks for more hours, more money, or both, with a reason
 * and a supporting document. An administrator approves, and the project itself
 * changes.
 *
 * ── Why this is not just editing the project ─────────────────────────────
 * A PM can see the budget; they cannot move it. Scope growing is the moment a
 * project stops being the one that was agreed to, and somebody other than the
 * person delivering it has to say yes. The approval is the feature; the row is
 * the evidence.
 *
 * ── Visibility ───────────────────────────────────────────────────────────
 * A budget request contains the budget. Rule 1 says a normal employee never
 * sees what a project costs, so every read here goes through the same test as
 * the project's own money fields. Nothing is stripped field by field: if you
 * may not see the money you may not see the request, because the request is
 * nothing but money.
 */
@Injectable()
export class BudgetRequestsService {
  constructor(private prisma: PrismaService) {}

  private readonly ADMIN_ROLES = ['SUPERADMIN', 'ADMIN'];

  private readonly SELECT = {
    id: true, additionalHours: true, additionalBudget: true,
    reason: true, attachmentUrl: true, attachmentName: true,
    status: true, reviewedAt: true, rejectionReason: true,
    hoursBefore: true, hoursAfter: true, budgetBefore: true, budgetAfter: true,
    createdAt: true,
    requestedBy: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
    reviewedBy: { select: { id: true, firstName: true, lastName: true } },
  } as const;

  /** The project, with what the financial-visibility test needs. */
  private async loadProject(companyId: number, projectId: number) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, companyId },
      select: {
        id: true, leadId: true, estimatedHours: true, budgetAmount: true, currency: true,
        members: { select: { employeeId: true, role: true } },
      },
    });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  private assertMaySeeMoney(project: any, role: string, employeeId: number | null) {
    if (!canViewProjectFinancials({ role, employeeId }, project)) {
      throw new ForbiddenException('You do not have access to this project’s budget');
    }
  }

  /**
   * Raising is narrower than reading. Finance may read a project's money
   * without having any business asking for more of it — that is the delivery
   * manager's request to make.
   */
  private managesProject(project: any, employeeId: number | null): boolean {
    if (employeeId == null) return false;
    if (project.leadId === employeeId) return true;
    return (project.members || []).some(
      (m: any) => m.employeeId === employeeId && m.role === 'PROJECT_MANAGER',
    );
  }

  async list(companyId: number, projectId: number, role: string, employeeId: number | null) {
    const project = await this.loadProject(companyId, projectId);
    this.assertMaySeeMoney(project, role, employeeId);

    const requests = await this.prisma.projectBudgetRequest.findMany({
      where: { companyId, projectId },
      select: this.SELECT,
      orderBy: { createdAt: 'desc' },
    });

    return {
      currency: project.currency,
      /// What a new request would be measured against, so the form can show
      /// "Current = 2,000 hrs" without a second call.
      current: { estimatedHours: project.estimatedHours, budgetAmount: project.budgetAmount },
      canRequest: this.managesProject(project, employeeId) || this.ADMIN_ROLES.includes(role),
      canApprove: this.ADMIN_ROLES.includes(role),
      requests,
    };
  }

  /** Everything waiting on an administrator, across projects. */
  async pending(companyId: number, role: string) {
    if (!this.ADMIN_ROLES.includes(role)) {
      throw new ForbiddenException('Only an administrator reviews budget requests');
    }
    return this.prisma.projectBudgetRequest.findMany({
      where: { companyId, status: 'REQUESTED' },
      select: {
        ...this.SELECT,
        project: {
          select: {
            id: true, name: true, key: true, currency: true,
            estimatedHours: true, budgetAmount: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(
    companyId: number,
    employeeId: number | null,
    role: string,
    projectId: number,
    data: {
      additionalHours?: number | null; additionalBudget?: number | null;
      reason?: string; attachmentUrl?: string; attachmentName?: string;
    },
  ) {
    const project = await this.loadProject(companyId, projectId);

    if (!this.managesProject(project, employeeId) && !this.ADMIN_ROLES.includes(role)) {
      throw new ForbiddenException('Only a project manager can request more budget or hours');
    }

    const hours = this.positiveOrNull(data.additionalHours);
    const budget = this.positiveOrNull(data.additionalBudget);
    if (hours == null && budget == null) {
      throw new BadRequestException('Ask for additional hours, additional budget, or both');
    }

    const reason = (data.reason || '').trim();
    if (!reason) {
      throw new BadRequestException('A reason is required — it is what the approver rules on');
    }

    return this.prisma.projectBudgetRequest.create({
      data: {
        projectId, companyId,
        requestedById: employeeId as number,
        additionalHours: hours,
        additionalBudget: budget,
        reason,
        attachmentUrl: data.attachmentUrl?.trim() || null,
        attachmentName: data.attachmentName?.trim() || null,
      },
      select: this.SELECT,
    });
  }

  /**
   * Null means "not asked for"; zero collapses to null and a negative is
   * refused, because a request to add nothing is not a request and a request
   * to subtract is not this form.
   */
  private positiveOrNull(value: unknown): number | null {
    if (value == null || value === '') return null;
    const n = Number(value);
    if (!Number.isFinite(n)) throw new BadRequestException('Amounts must be numbers');
    if (n < 0) throw new BadRequestException('Ask for an increase, not a reduction');
    return n > 0 ? n : null;
  }

  /**
   * Approve or reject (§25).
   *
   * Approving applies the increase to the project and records both sides of
   * the move in one transaction. Applying without recording would leave a
   * budget that grew for reasons nobody can reconstruct; recording without
   * applying would leave an approval nobody honoured.
   */
  async review(
    companyId: number,
    reviewerEmployeeId: number | null,
    role: string,
    requestId: number,
    decision: 'APPROVED' | 'REJECTED',
    reason?: string,
  ) {
    if (!this.ADMIN_ROLES.includes(role)) {
      throw new ForbiddenException('Only an administrator approves budget requests');
    }
    if (decision === 'REJECTED' && !reason?.trim()) {
      throw new BadRequestException('A reason is required when rejecting a request');
    }

    const request = await this.prisma.projectBudgetRequest.findFirst({
      where: { id: requestId, companyId },
      select: {
        id: true, projectId: true, status: true,
        additionalHours: true, additionalBudget: true,
      },
    });
    if (!request) throw new NotFoundException('Request not found');
    if (request.status !== 'REQUESTED') {
      throw new BadRequestException(`This request is already ${request.status.toLowerCase()}`);
    }

    if (decision === 'REJECTED') {
      return this.prisma.projectBudgetRequest.update({
        where: { id: requestId },
        data: {
          status: 'REJECTED',
          reviewedById: reviewerEmployeeId,
          reviewedAt: new Date(),
          rejectionReason: reason!.trim(),
        },
        select: this.SELECT,
      });
    }

    return this.prisma.$transaction(async (tx) => {
      // Read inside the transaction: the figures recorded must be the ones
      // actually moved, not what the project held when the request was raised
      // a week ago.
      const project = await tx.project.findUnique({
        where: { id: request.projectId },
        select: { estimatedHours: true, budgetAmount: true },
      });

      const hoursBefore = project?.estimatedHours ?? null;
      const budgetBefore = project?.budgetAmount ?? null;

      // A null "before" with an increase asked for starts from zero, which is
      // the only sensible reading of "add 500 to nothing".
      const hoursAfter =
        request.additionalHours == null
          ? hoursBefore
          : (hoursBefore ?? 0) + request.additionalHours;
      const budgetAfter =
        request.additionalBudget == null
          ? budgetBefore
          : (budgetBefore ?? 0) + request.additionalBudget;

      await tx.project.update({
        where: { id: request.projectId },
        data: {
          ...(request.additionalHours != null && { estimatedHours: hoursAfter }),
          ...(request.additionalBudget != null && { budgetAmount: budgetAfter }),
        },
      });

      return tx.projectBudgetRequest.update({
        where: { id: requestId },
        data: {
          status: 'APPROVED',
          reviewedById: reviewerEmployeeId,
          reviewedAt: new Date(),
          rejectionReason: null,
          hoursBefore, hoursAfter, budgetBefore, budgetAfter,
        },
        select: this.SELECT,
      });
    });
  }

  /** A PM withdrawing their own request before anybody has ruled on it. */
  async cancel(companyId: number, employeeId: number | null, role: string, requestId: number) {
    const request = await this.prisma.projectBudgetRequest.findFirst({
      where: { id: requestId, companyId },
      select: { id: true, projectId: true, status: true },
    });
    if (!request) throw new NotFoundException('Request not found');
    if (request.status !== 'REQUESTED') {
      throw new BadRequestException('Only a request still awaiting review can be cancelled');
    }

    const project = await this.loadProject(companyId, request.projectId);
    if (!this.managesProject(project, employeeId) && !this.ADMIN_ROLES.includes(role)) {
      throw new ForbiddenException('Only a project manager can cancel this request');
    }

    return this.prisma.projectBudgetRequest.update({
      where: { id: requestId },
      data: { status: 'CANCELLED' },
      select: this.SELECT,
    });
  }
}
