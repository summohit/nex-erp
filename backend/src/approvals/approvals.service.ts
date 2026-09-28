import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { isSuperAdmin } from '../common/company-roles';
import {
  ApprovalWorkflow,
  APPROVAL_WORKFLOWS,
  APPROVAL_WORKFLOW_LABELS,
  isApprovalWorkflow,
} from './approval-workflows';

/**
 * Who may rule on the decisions that have no natural owner.
 *
 * Deliberately additive. A workflow's own service still decides what its
 * context implies — a task's extra hours go to the project's managers, and
 * that rule stays where it is. This answers only the other half: who else the
 * company owner has put on the queue.
 *
 * The company owner is never in the table and never needs to be. They can
 * approve everything by virtue of being the owner, which means no edit here,
 * however careless, can lock a workflow away from the one person who could fix
 * it.
 */
@Injectable()
export class ApprovalsService {
  constructor(private prisma: PrismaService) {}

  private assertWorkflow(workflow: string): ApprovalWorkflow {
    if (!isApprovalWorkflow(workflow)) {
      throw new BadRequestException(
        `Unknown approval workflow "${workflow}". Expected one of: ${APPROVAL_WORKFLOWS.join(', ')}.`,
      );
    }
    return workflow;
  }

  /**
   * May this person rule on this workflow?
   *
   * The company owner always may. Everybody else has to have been put on it.
   * Callers combine this with their own contextual rule rather than replacing
   * it — `mayApprove(...) || this.managesProject(...)`.
   */
  async mayApprove(
    companyId: number,
    workflow: ApprovalWorkflow,
    role?: string | null,
    employeeId?: number | null,
  ): Promise<boolean> {
    if (isSuperAdmin(role)) return true;
    if (employeeId == null) return false;

    const delegate = await this.prisma.approvalDelegate.findFirst({
      where: { companyId, workflow, employeeId },
      select: { id: true },
    });
    return !!delegate;
  }

  /**
   * The employees a decision on this workflow should actually be put in front
   * of.
   *
   * Delegates only — not every Super Admin. A Super Admin can approve anything
   * in the company, and notifying all of them about every forgotten clock-out
   * is a broadcast rather than a queue. The same reasoning the task-hours flow
   * already uses for administrators.
   *
   * When nobody has been delegated, the caller should fall back to notifying
   * the company owners, or the decision sits in a queue nobody is watching.
   */
  async approverEmployeeIds(companyId: number, workflow: ApprovalWorkflow): Promise<number[]> {
    const rows = await this.prisma.approvalDelegate.findMany({
      where: { companyId, workflow },
      select: { employeeId: true },
    });
    return rows.map((r) => r.employeeId);
  }

  /** Every workflow and who is on it, for the settings screen. */
  async listAll(companyId: number) {
    const rows = await this.prisma.approvalDelegate.findMany({
      where: { companyId },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        grantedBy: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: [{ workflow: 'asc' }, { createdAt: 'asc' }],
    });

    return APPROVAL_WORKFLOWS.map((workflow) => ({
      workflow,
      label: APPROVAL_WORKFLOW_LABELS[workflow],
      delegates: rows.filter((r) => r.workflow === workflow),
    }));
  }

  /**
   * Put somebody on a workflow's queue. The company owner's call alone —
   * anyone who could delegate their own approval could grant it to themselves.
   */
  async grant(
    companyId: number,
    workflow: string,
    employeeId: number,
    actorRole?: string | null,
    actorEmployeeId?: number | null,
  ) {
    if (!isSuperAdmin(actorRole)) {
      throw new ForbiddenException('Only a Super Admin can choose who approves.');
    }
    const flow = this.assertWorkflow(workflow);

    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId },
      select: { id: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    // Idempotent: granting twice is the same state, and should not be an error
    // somebody has to read.
    return this.prisma.approvalDelegate.upsert({
      where: { companyId_workflow_employeeId: { companyId, workflow: flow, employeeId } },
      create: { companyId, workflow: flow, employeeId, grantedById: actorEmployeeId ?? null },
      update: {},
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
      },
    });
  }

  /** Take somebody off a queue. Also the company owner's call alone. */
  async revoke(
    companyId: number,
    workflow: string,
    employeeId: number,
    actorRole?: string | null,
  ) {
    if (!isSuperAdmin(actorRole)) {
      throw new ForbiddenException('Only a Super Admin can choose who approves.');
    }
    const flow = this.assertWorkflow(workflow);

    await this.prisma.approvalDelegate.deleteMany({
      where: { companyId, workflow: flow, employeeId },
    });
    return { revoked: true, workflow: flow, employeeId };
  }
}
