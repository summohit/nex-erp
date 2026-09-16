import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { canViewProjectFinancials, FinancialViewer } from '../project-visibility';

/**
 * Project milestones (§13, §14).
 *
 * A milestone is the join between delivery and finance: a dated chunk of the
 * contract with an amount against it, which completing makes eligible to
 * invoice. Invoicing itself is a later phase — this owns the delivery half and
 * the money the invoice will be written for.
 */
@Injectable()
export class MilestonesService {
  constructor(private prisma: PrismaService) {}

  private readonly STATUSES = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

  /**
   * The viewer's standing on one project — resolved once per request rather
   * than per milestone, since every method needs it.
   */
  private async viewerFor(employeeId: number | null, role: string, projectId: number, companyId: number) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, companyId },
      select: {
        id: true,
        leadId: true,
        currency: true,
        budgetAmount: true,
        members: { select: { employeeId: true, role: true } },
      },
    });
    if (!project) throw new NotFoundException('Project not found');

    // AuthGuard already resolves employeeId onto the token, including for old
    // tokens issued before it carried one, so there is nothing to look up.
    const viewer: FinancialViewer = { role, employeeId };

    const isMember = employeeId != null && project.members.some((m) => m.employeeId === employeeId);
    const isAdmin = ['SUPERADMIN', 'ADMIN'].includes(role);
    if (!isAdmin && !isMember && role !== 'FINANCE') {
      throw new ForbiddenException('You do not have access to this project');
    }

    return {
      project,
      viewer,
      canSeeMoney: canViewProjectFinancials(viewer, project),
      /** Who may add, edit and reorder milestones: admins and the project's PMs. */
      canManage:
        isAdmin ||
        project.leadId === viewer.employeeId ||
        project.members.some((m) => m.employeeId === viewer.employeeId && m.role === 'PROJECT_MANAGER'),
    };
  }

  /**
   * Milestones for a project, with their task counts.
   *
   * `amount` and `percentage` are stripped for anyone who may not see the
   * project's money — the name, dates and status are delivery facts everyone
   * on the project needs, the contract value is not.
   */
  async list(companyId: number, employeeId: number | null, role: string, projectId: number) {
    const { canSeeMoney, canManage, project } = await this.viewerFor(employeeId, role, projectId, companyId);

    const milestones = await this.prisma.projectMilestone.findMany({
      where: { projectId, companyId },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      include: {
        owner: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        _count: { select: { issues: true } },
        issues: { select: { status: true } },
      },
    });

    const rows = milestones.map(({ issues, _count, ...m }) => {
      const done = issues.filter((i) => i.status === 'DONE').length;
      const base = {
        ...m,
        taskTotal: _count.issues,
        taskDone: done,
        // A milestone's own progress, from the work booked against it. Zero
        // tasks means zero percent rather than a hundred: an empty milestone
        // is not a finished one.
        progress: _count.issues ? Math.round((done / _count.issues) * 100) : 0,
      };
      if (canSeeMoney) return base;
      const { amount, percentage, ...withoutMoney } = base;
      return withoutMoney;
    });

    const totals = canSeeMoney
      ? {
          milestoneValue: rows.reduce((sum, m: any) => sum + (m.amount ?? 0), 0),
          // What the milestones add up to against what the project is worth.
          // A gap either way is a planning error worth seeing early.
          budgetAmount: project.budgetAmount,
          unallocated:
            project.budgetAmount == null
              ? null
              : Math.round((project.budgetAmount - rows.reduce((s, m: any) => s + (m.amount ?? 0), 0)) * 100) / 100,
        }
      : null;

    return { milestones: rows, totals, canManage, canViewFinancials: canSeeMoney, currency: project.currency };
  }

  async create(companyId: number, employeeId: number | null, role: string, projectId: number, data: any) {
    const { canManage, canSeeMoney } = await this.viewerFor(employeeId, role, projectId, companyId);
    if (!canManage) throw new ForbiddenException('Only a project manager or administrator can add milestones');

    if (!data?.name?.trim()) throw new BadRequestException('Milestone name is required');

    // Somebody who cannot see the project's money cannot set it either —
    // otherwise the create form becomes a way to write a figure you are not
    // allowed to read back.
    const money = canSeeMoney
      ? {
          amount: data.amount != null && data.amount !== '' ? parseFloat(data.amount) : null,
          percentage: data.percentage != null && data.percentage !== '' ? parseFloat(data.percentage) : null,
        }
      : {};

    const last = await this.prisma.projectMilestone.findFirst({
      where: { projectId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    return this.prisma.projectMilestone.create({
      data: {
        projectId,
        companyId,
        name: data.name.trim(),
        description: data.description || null,
        startDate: data.startDate ? new Date(data.startDate) : null,
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        status: this.STATUSES.includes(data.status) ? data.status : 'PENDING',
        ownerId: data.ownerId ? parseInt(data.ownerId, 10) : null,
        position: (last?.position ?? -1) + 1,
        ...money,
      },
    });
  }

  async update(companyId: number, employeeId: number | null, role: string, milestoneId: number, data: any) {
    const existing = await this.prisma.projectMilestone.findFirst({
      where: { id: milestoneId, companyId },
      select: { id: true, projectId: true, status: true },
    });
    if (!existing) throw new NotFoundException('Milestone not found');

    const { canManage, canSeeMoney } = await this.viewerFor(employeeId, role, existing.projectId, companyId);
    if (!canManage) throw new ForbiddenException('Only a project manager or administrator can edit milestones');

    const patch: any = {};
    if (data.name !== undefined) {
      if (!data.name?.trim()) throw new BadRequestException('Milestone name is required');
      patch.name = data.name.trim();
    }
    if (data.description !== undefined) patch.description = data.description || null;
    if (data.startDate !== undefined) patch.startDate = data.startDate ? new Date(data.startDate) : null;
    if (data.dueDate !== undefined) patch.dueDate = data.dueDate ? new Date(data.dueDate) : null;
    if (data.ownerId !== undefined) patch.ownerId = data.ownerId ? parseInt(data.ownerId, 10) : null;

    if (data.status !== undefined) {
      if (!this.STATUSES.includes(data.status)) throw new BadRequestException('Unknown milestone status');
      patch.status = data.status;
      // Stamped on the transition, not on every save of an already-completed
      // milestone — the date a milestone was met is what makes an invoice
      // eligible, and it must not move because somebody fixed a typo.
      if (data.status === 'COMPLETED' && existing.status !== 'COMPLETED') {
        patch.completedAt = new Date();
      }
      if (data.status !== 'COMPLETED') patch.completedAt = null;
    }

    if (canSeeMoney) {
      if (data.amount !== undefined) {
        patch.amount = data.amount === null || data.amount === '' ? null : parseFloat(data.amount);
      }
      if (data.percentage !== undefined) {
        patch.percentage = data.percentage === null || data.percentage === '' ? null : parseFloat(data.percentage);
      }
    }

    return this.prisma.projectMilestone.update({ where: { id: milestoneId }, data: patch });
  }

  async remove(companyId: number, employeeId: number | null, role: string, milestoneId: number) {
    const existing = await this.prisma.projectMilestone.findFirst({
      where: { id: milestoneId, companyId },
      select: { id: true, projectId: true },
    });
    if (!existing) throw new NotFoundException('Milestone not found');

    const { canManage } = await this.viewerFor(employeeId, role, existing.projectId, companyId);
    if (!canManage) throw new ForbiddenException('Only a project manager or administrator can delete milestones');

    // Tasks survive: Issue.milestoneId is SetNull, so deleting a milestone
    // unlinks the work rather than destroying it.
    await this.prisma.projectMilestone.delete({ where: { id: milestoneId } });
    return { success: true };
  }

  /** Persist a drag-reorder as one transaction, so the list never half-moves. */
  async reorder(companyId: number, employeeId: number | null, role: string, projectId: number, orderedIds: number[]) {
    const { canManage } = await this.viewerFor(employeeId, role, projectId, companyId);
    if (!canManage) throw new ForbiddenException('Only a project manager or administrator can reorder milestones');

    const owned = await this.prisma.projectMilestone.findMany({
      where: { projectId, companyId },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map((m) => m.id));
    if (orderedIds.some((id) => !ownedIds.has(id))) {
      throw new BadRequestException('Milestone list does not belong to this project');
    }

    await this.prisma.$transaction(
      orderedIds.map((id, index) =>
        this.prisma.projectMilestone.update({ where: { id }, data: { position: index } }),
      ),
    );
    return { success: true };
  }
}
