import { describeChanges, diffFields, recordApprovalEdit, requireEditReason } from '../../common/approval-edits';
import {
  Injectable, BadRequestException, ForbiddenException, NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { isCompanyAdmin } from '../../common/company-roles';
import { sanitiseRichText, hasVisibleText } from './rich-text';

/** The requester's own reading of whose problem this is. */
export const SCOPE = { IN_SCOPE: 'IN_SCOPE', OUT_OF_SCOPE: 'OUT_OF_SCOPE' } as const;
export const SCOPE_VALUES = Object.values(SCOPE) as string[];

export const SCOPE_REQUEST_STATUS = {
  PENDING: 'PENDING', APPROVED: 'APPROVED', REJECTED: 'REJECTED',
} as const;

/**
 * Anything on a project that needs a decision and is not a task or a budget
 * increase.
 *
 * Raised from the project's Fix button. Unlike a task or a budget request it
 * goes straight to an administrator: those two carry a technical question the
 * architect is the right person to read first, and this does not.
 */
@Injectable()
export class ScopeRequestsService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  private readonly SELECT = {
    id: true, projectId: true, title: true, scope: true, body: true,
    status: true, decisionNote: true, reviewedAt: true, createdAt: true,
    project: { select: { id: true, name: true, key: true } },
    raisedBy: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
    reviewedBy: { select: { id: true, firstName: true, lastName: true } },
    attachments: { select: { id: true, url: true, name: true, sizeBytes: true } },
  };

  async create(
    companyId: number,
    projectId: number,
    raisedById: number,
    data: {
      title: string; scope: string; body: string;
      attachments?: { url: string; name: string; sizeBytes?: number }[];
    },
  ) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, companyId },
      select: { id: true, name: true },
    });
    if (!project) throw new NotFoundException('Project not found');

    const title = data.title?.trim();
    if (!title) throw new BadRequestException('Give the request a title.');

    // Required, not a note in the body: that one answer is what turns an
    // argument about who pays into a decision somebody can make.
    if (!SCOPE_VALUES.includes(data.scope)) {
      throw new BadRequestException('Say whether this is in scope or out of scope.');
    }

    const body = sanitiseRichText(data.body ?? '');
    if (!hasVisibleText(body)) {
      throw new BadRequestException('Describe what needs deciding.');
    }

    const created = await this.prisma.projectScopeRequest.create({
      data: {
        projectId, companyId, raisedById,
        title, scope: data.scope, body,
        attachments: data.attachments?.length
          ? {
              create: data.attachments.map((a) => ({
                url: a.url, name: a.name, sizeBytes: a.sizeBytes ?? null,
              })),
            }
          : undefined,
      },
      select: this.SELECT,
    });

    // Administrators decide these, so administrators are who hears about them.
    await this.notifications.notifyApprovers({
      companyId,
      roles: ['SUPERADMIN', 'ADMIN'],
      title: 'New project request',
      message: `${title} — ${project.name} (${data.scope === SCOPE.OUT_OF_SCOPE ? 'out of scope' : 'in scope'})`,
      type: 'PROJECT',
      linkUrl: `/projects/${projectId}`,
    });

    return created;
  }

  /** Everything raised on one project, newest first. */
  listForProject(companyId: number, projectId: number) {
    return this.prisma.projectScopeRequest.findMany({
      where: { companyId, projectId },
      select: this.SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * The queue. Oldest first — a request nobody has answered is somebody
   * waiting, and the one that has waited longest is the one to answer.
   */
  pending(companyId: number) {
    return this.prisma.projectScopeRequest.findMany({
      where: { companyId, status: SCOPE_REQUEST_STATUS.PENDING },
      select: this.SELECT,
      orderBy: { createdAt: 'asc' },
    });
  }

  async review(
    companyId: number,
    requestId: number,
    decision: 'APPROVED' | 'REJECTED',
    role: string | undefined,
    reviewerEmployeeId: number | null,
    note?: string,
    edits?: { title?: string; scope?: string; body?: string },
    editReason?: string,
  ) {
    if (!isCompanyAdmin(role)) {
      throw new ForbiddenException('Only an administrator decides project requests.');
    }

    const trimmed = note?.trim() || '';
    // A refusal has to say why; an approval need not.
    if (decision === 'REJECTED' && !trimmed) {
      throw new BadRequestException('Say why this request is being rejected.');
    }

    const request = await this.prisma.projectScopeRequest.findFirst({
      where: { id: requestId, companyId },
      select: {
        id: true, title: true, status: true, raisedById: true, projectId: true,
        scope: true, body: true,
      },
    });
    if (!request) throw new NotFoundException('Request not found');
    if (request.status !== SCOPE_REQUEST_STATUS.PENDING) {
      throw new BadRequestException(`This request is already ${request.status.toLowerCase()}.`);
    }

    // Edit & approve: only on an approval, and only the fields sent.
    const next: { title?: string; scope?: string; body?: string } = {};
    if (decision === 'APPROVED' && edits) {
      if (edits.title !== undefined) {
        next.title = String(edits.title).trim();
        if (!next.title) throw new BadRequestException('The title cannot be empty.');
      }
      if (edits.scope !== undefined) {
        if (!['IN_SCOPE', 'OUT_OF_SCOPE'].includes(edits.scope)) {
          throw new BadRequestException('Scope must be IN_SCOPE or OUT_OF_SCOPE.');
        }
        next.scope = edits.scope;
      }
      if (edits.body !== undefined) {
        next.body = sanitiseRichText(String(edits.body));
        if (!hasVisibleText(next.body)) {
          throw new BadRequestException('The description cannot be empty.');
        }
      }
    }
    const changes = diffFields(request, next);
    requireEditReason(changes, editReason);

    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.projectScopeRequest.update({
        where: { id: requestId },
        data: {
          ...Object.fromEntries(Object.keys(changes).map((k) => [k, (next as any)[k]])),
          status: decision,
          decisionNote: trimmed || null,
          reviewedById: reviewerEmployeeId,
          reviewedAt: new Date(),
        },
        select: this.SELECT,
      });
      await recordApprovalEdit(tx, {
        companyId, actorEmployeeId: reviewerEmployeeId,
        entityType: 'ProjectScopeRequest', entityId: requestId,
        changes, reason: editReason,
      });
      return saved;
    });
    const edited = Object.keys(changes).length
      ? ` with changes (${describeChanges(changes, { title: 'title', scope: 'scope', body: 'description' })}): ${editReason!.trim()}`
      : '';

    if (request.raisedById !== reviewerEmployeeId) {
      await this.notifications.notifyEmployees([request.raisedById], {
        companyId,
        title: decision === 'APPROVED' ? 'Request approved' : 'Request rejected',
        message: decision === 'APPROVED'
          ? `"${request.title}" was approved${edited}.`
          : `"${request.title}" was rejected: ${trimmed}`,
        type: 'PROJECT',
        linkUrl: `/projects/${request.projectId}`,
      });
    }

    return updated;
  }
}
