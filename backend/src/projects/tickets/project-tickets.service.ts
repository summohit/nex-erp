import {
  Injectable, NotFoundException, ForbiddenException, BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Project tickets (§29, §30).
 *
 * A ticket is a PROPOSED TASK. A project manager raises one — usually a new
 * requirement from the client — naming who would do it, how urgent it is, when
 * it should run and how long it should take. An administrator approves, and
 * only then does it become a real task.
 *
 * ── Why a ticket at all, when a PM can already create tasks ──────────────
 * Because these are the ones that need somebody else's yes first. A PM adding
 * a task inside the agreed scope is just delivery; a client asking for
 * something new changes what the project is, and that is an administrator's
 * decision. The approval IS the feature — everything else here is bookkeeping
 * around it.
 *
 * ── The link is not decoration ───────────────────────────────────────────
 * §30 asks that the ticket's history stay attached to the task it becomes.
 * `convertedIssueId` is that link, and it is what stops a ticket and its task
 * becoming two accounts of the same work: the ticket stops being a thing you
 * separately update, and starts being a record of why the task exists.
 */

export type TicketStatus =
  | 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'CONVERTED' | 'COMPLETED' | 'CANCELLED';

const PRIORITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

@Injectable()
export class ProjectTicketsService {
  constructor(private prisma: PrismaService) {}

  private readonly ADMIN_ROLES = ['SUPERADMIN', 'ADMIN'];

  private readonly LIST_SELECT = {
    id: true, ticketNumber: true, title: true, description: true,
    priority: true, startDate: true, dueDate: true, estimatedHours: true,
    status: true, reviewedAt: true, rejectionReason: true, convertedAt: true,
    createdAt: true,
    raisedBy: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
    proposedAssignee: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
    reviewedBy: { select: { id: true, firstName: true, lastName: true } },
    convertedIssue: { select: { id: true, key: true, title: true, status: true } },
  } as const;

  /**
   * Whether this person manages the project — the PM test used throughout the
   * Delivery module. The project lead counts, as they do everywhere else.
   */
  private async managesProject(projectId: number, employeeId: number | null): Promise<boolean> {
    if (employeeId == null) return false;
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { leadId: true },
    });
    if (project?.leadId === employeeId) return true;

    const member = await this.prisma.projectMember.findFirst({
      where: { projectId, employeeId, role: 'PROJECT_MANAGER' },
      select: { id: true },
    });
    return !!member;
  }

  /** Per company, so two companies both starting at 1 is correct. */
  private async nextTicketNumber(companyId: number): Promise<string> {
    const count = await this.prisma.projectTicket.count({ where: { companyId } });
    return `TKT-${String(count + 1).padStart(4, '0')}`;
  }

  async list(companyId: number, projectId: number, status?: string) {
    const where: any = { companyId, projectId };
    if (status && status !== 'ALL') where.status = status;

    return this.prisma.projectTicket.findMany({
      where,
      select: this.LIST_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Everything waiting on an administrator, across projects (§30). */
  async pending(companyId: number, role: string) {
    if (!this.ADMIN_ROLES.includes(role)) {
      throw new ForbiddenException('Only an administrator reviews project tickets');
    }
    return this.prisma.projectTicket.findMany({
      where: { companyId, status: 'REQUESTED' },
      select: { ...this.LIST_SELECT, project: { select: { id: true, name: true, key: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(
    companyId: number,
    actorEmployeeId: number | null,
    role: string,
    projectId: number,
    data: {
      title?: string; description?: string; proposedAssigneeId?: number;
      priority?: string; startDate?: string; dueDate?: string; estimatedHours?: number;
    },
  ) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, companyId },
      select: { id: true },
    });
    if (!project) throw new NotFoundException('Project not found');

    if (!this.ADMIN_ROLES.includes(role) && !(await this.managesProject(projectId, actorEmployeeId))) {
      throw new ForbiddenException('Only a project manager raises tickets on this project');
    }

    const title = (data.title || '').trim();
    if (!title) throw new BadRequestException('A ticket needs a title');

    const priority = (data.priority || 'MEDIUM').toUpperCase();
    if (!PRIORITIES.includes(priority)) {
      throw new BadRequestException(`Priority must be one of ${PRIORITIES.join(', ')}`);
    }

    const startDate = data.startDate ? new Date(data.startDate) : null;
    const dueDate = data.dueDate ? new Date(data.dueDate) : null;
    if (startDate && dueDate && dueDate < startDate) {
      throw new BadRequestException('The due date cannot be before the start date');
    }

    // A proposed assignee has to be on the project. The whole point of the
    // field is "who on this team would do it", and a name from outside it is
    // a promise the PM cannot keep.
    if (data.proposedAssigneeId) {
      const member = await this.prisma.projectMember.findFirst({
        where: { projectId, employeeId: Number(data.proposedAssigneeId) },
        select: { id: true },
      });
      if (!member) {
        throw new BadRequestException('That person is not a member of this project');
      }
    }

    /**
     * An administrator's ticket becomes a task immediately (§6).
     *
     * The approval step exists so somebody senior rules on whether the work
     * should happen. An administrator IS that person, so routing their own
     * ticket into a queue for their own approval is a round trip that answers
     * nothing -- and leaves real work sitting as a request nobody thinks to
     * look at. A project manager's ticket still waits, which is the whole
     * point of the distinction.
     *
     * The ticket row is still written, and still says CONVERTED with the
     * admin as its reviewer: the paper trail is the same, only the waiting is
     * skipped.
     */
    if (this.ADMIN_ROLES.includes(role)) {
      return this.prisma.$transaction(async (tx) => {
        const ticket = await tx.projectTicket.create({
          data: {
            ticketNumber: await this.nextTicketNumber(companyId),
            title,
            description: data.description?.trim() || null,
            projectId,
            companyId,
            raisedById: actorEmployeeId as number,
            proposedAssigneeId: data.proposedAssigneeId ? Number(data.proposedAssigneeId) : null,
            priority,
            startDate,
            dueDate,
            // Same coercion as the ordinary create path below, deliberately.
            estimatedHours:
              data.estimatedHours != null && Number.isFinite(Number(data.estimatedHours))
                ? Number(data.estimatedHours)
                : null,
          },
          include: { project: { select: { id: true, key: true } } },
        });

        return this.convertTicketToTask(tx, ticket, actorEmployeeId, companyId);
      });
    }

    return this.prisma.projectTicket.create({
      data: {
        ticketNumber: await this.nextTicketNumber(companyId),
        title,
        description: data.description?.trim() || null,
        projectId,
        companyId,
        raisedById: actorEmployeeId as number,
        proposedAssigneeId: data.proposedAssigneeId ? Number(data.proposedAssigneeId) : null,
        priority,
        startDate,
        dueDate,
        estimatedHours:
          data.estimatedHours != null && Number.isFinite(Number(data.estimatedHours))
            ? Number(data.estimatedHours)
            : null,
      },
      select: this.LIST_SELECT,
    });
  }

  /**
   * The PM's estimate step (§30), and any correction before review.
   *
   * Only while REQUESTED. Editing a ticket after somebody approved it would
   * change what they agreed to without their knowing — the approval would
   * still be there, attached to different work.
   */
  async update(
    companyId: number,
    actorEmployeeId: number | null,
    role: string,
    ticketId: number,
    data: any,
  ) {
    const ticket = await this.prisma.projectTicket.findFirst({
      where: { id: ticketId, companyId },
      select: { id: true, projectId: true, status: true },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');

    if (ticket.status !== 'REQUESTED') {
      throw new BadRequestException(
        'This ticket has already been reviewed, so it can no longer be edited.',
      );
    }
    if (!this.ADMIN_ROLES.includes(role) && !(await this.managesProject(ticket.projectId, actorEmployeeId))) {
      throw new ForbiddenException('Only a project manager edits tickets on this project');
    }

    const patch: any = {};
    if (data.title !== undefined) {
      const t = String(data.title).trim();
      if (!t) throw new BadRequestException('A ticket needs a title');
      patch.title = t;
    }
    if (data.description !== undefined) patch.description = String(data.description).trim() || null;
    if (data.priority !== undefined) {
      const p = String(data.priority).toUpperCase();
      if (!PRIORITIES.includes(p)) throw new BadRequestException('Unknown priority');
      patch.priority = p;
    }
    if (data.startDate !== undefined) patch.startDate = data.startDate ? new Date(data.startDate) : null;
    if (data.dueDate !== undefined) patch.dueDate = data.dueDate ? new Date(data.dueDate) : null;
    if (data.estimatedHours !== undefined) {
      patch.estimatedHours =
        data.estimatedHours == null || data.estimatedHours === ''
          ? null
          : Number(data.estimatedHours);
    }
    if (data.proposedAssigneeId !== undefined) {
      patch.proposedAssigneeId = data.proposedAssigneeId ? Number(data.proposedAssigneeId) : null;
    }

    return this.prisma.projectTicket.update({
      where: { id: ticketId },
      data: patch,
      select: this.LIST_SELECT,
    });
  }

  /**
   * Approve or reject (§30).
   *
   * Approving converts in the same breath rather than leaving an APPROVED
   * ticket that somebody still has to remember to turn into a task. A ticket
   * approved and never converted is the failure mode this flow exists to
   * prevent — the requirement agreed to and then quietly lost.
   */
  async review(
    companyId: number,
    reviewerEmployeeId: number | null,
    role: string,
    ticketId: number,
    decision: 'APPROVED' | 'REJECTED',
    reason?: string,
  ) {
    if (!this.ADMIN_ROLES.includes(role)) {
      throw new ForbiddenException('Only an administrator approves project tickets');
    }
    if (decision === 'REJECTED' && !reason?.trim()) {
      throw new BadRequestException('A reason is required when rejecting a ticket');
    }

    const ticket = await this.prisma.projectTicket.findFirst({
      where: { id: ticketId, companyId },
      include: { project: { select: { id: true, key: true } } },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.status !== 'REQUESTED') {
      throw new BadRequestException(`This ticket is already ${ticket.status.toLowerCase()}`);
    }

    if (decision === 'REJECTED') {
      return this.prisma.projectTicket.update({
        where: { id: ticketId },
        data: {
          status: 'REJECTED',
          reviewedById: reviewerEmployeeId,
          reviewedAt: new Date(),
          rejectionReason: reason!.trim(),
        },
        select: this.LIST_SELECT,
      });
    }

    // Approved: create the task and link it, in one transaction. Half of this
    // is worse than none -- an approved ticket with no task, or a task no
    // ticket admits to.
    return this.prisma.$transaction((tx) =>
      this.convertTicketToTask(tx, ticket, reviewerEmployeeId, companyId),
    );
  }

  /**
   * Turn an approved ticket into a real task, and mark the ticket converted.
   *
   * Shared by the approval path and the administrator fast-path below, so the
   * two cannot drift: a task raised by an admin and one approved by an admin
   * should be the same task, made the same way.
   */
  private async convertTicketToTask(
    tx: any,
    ticket: any,
    reviewerEmployeeId: number | null,
    companyId: number,
  ) {
    // The task's number comes from the project counter, the same allocation
    // every other writer uses. A `count + 1` here would reuse a number after
    // a deletion or collide with the board the moment the two raced — both on
    // @@unique([key, companyId]). We are already inside a transaction, so the
    // increment commits or rolls back with the task it allocates.
    const { issueSeq } = await tx.project.update({
      where: { id: ticket.projectId },
      data: { issueSeq: { increment: 1 } },
      select: { issueSeq: true },
    });

    /**
     * The board column, without which the task exists but renders nowhere.
     *
     * A task with a null columnId is invisible on the board while showing up
     * in the list -- which is exactly what an approved ticket looked like
     * before this: converted, linked, and apparently lost.
     */
    const board = await tx.board.findFirst({
      where: { projectId: ticket.projectId },
      include: { columns: { orderBy: { position: 'asc' } } },
    });
    const columnId = board?.columns?.[0]?.id ?? null;

    // Top of the column, as a freshly created task is everywhere else.
    const firstIssue = columnId
      ? await tx.issue.findFirst({ where: { columnId }, orderBy: { position: 'asc' } })
      : null;
    const position = firstIssue ? firstIssue.position - 1 : 0;

    const issue = await tx.issue.create({
      data: {
        key: `${ticket.project?.key || 'TASK'}-${issueSeq}`,
        title: ticket.title,
        description: ticket.description,
        projectId: ticket.projectId,
        companyId,
        priority: ticket.priority,
        assigneeId: ticket.proposedAssigneeId,
        reporterId: ticket.raisedById,
        startDate: ticket.startDate,
        dueDate: ticket.dueDate,
        estimatedHours: ticket.estimatedHours,
        status: 'TODO',
        columnId,
        position,
      },
      select: { id: true, key: true, title: true, status: true },
    });

    return tx.projectTicket.update({
      where: { id: ticket.id },
      data: {
        status: 'CONVERTED',
        reviewedById: reviewerEmployeeId,
        reviewedAt: new Date(),
        rejectionReason: null,
        convertedIssueId: issue.id,
        convertedAt: new Date(),
      },
      select: this.LIST_SELECT,
    });
  }

  /** A PM withdrawing their own request before anybody has ruled on it. */
  async cancel(
    companyId: number,
    actorEmployeeId: number | null,
    role: string,
    ticketId: number,
  ) {
    const ticket = await this.prisma.projectTicket.findFirst({
      where: { id: ticketId, companyId },
      select: { id: true, projectId: true, status: true },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.status !== 'REQUESTED') {
      throw new BadRequestException('Only a ticket still awaiting review can be cancelled');
    }
    if (!this.ADMIN_ROLES.includes(role) && !(await this.managesProject(ticket.projectId, actorEmployeeId))) {
      throw new ForbiddenException('Only a project manager cancels tickets on this project');
    }

    return this.prisma.projectTicket.update({
      where: { id: ticketId },
      data: { status: 'CANCELLED' },
      select: this.LIST_SELECT,
    });
  }

  /**
   * "Task Completed → Ticket Automatically Updated" (§30).
   *
   * Called by IssuesService when a task's status changes. Nothing here throws:
   * a ticket bookkeeping step must never be able to fail somebody's attempt to
   * close a task, and a missing ticket is the ordinary case — most tasks were
   * never tickets.
   */
  async onIssueStatusChanged(issueId: number, status: string): Promise<void> {
    try {
      const ticket = await this.prisma.projectTicket.findUnique({
        where: { convertedIssueId: issueId },
        select: { id: true, status: true },
      });
      if (!ticket) return;

      // Only ever between these two, so a reopened task pulls its ticket back
      // rather than leaving it claiming work that is no longer finished.
      const next =
        status === 'DONE' ? 'COMPLETED' : ticket.status === 'COMPLETED' ? 'CONVERTED' : null;
      if (!next || next === ticket.status) return;

      await this.prisma.projectTicket.update({ where: { id: ticket.id }, data: { status: next } });
    } catch {
      // Deliberately swallowed — see the note above.
    }
  }
}
