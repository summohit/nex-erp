import {
  Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException, Optional,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { isHrAdmin } from '../common/company-roles';
import { cleanRichHtml, hasRichText } from '../common/rich-text';

/** Who a notice is addressed to, as the sender picked it. */
export interface NoticeAudience {
  departmentIds?: number[];
  roles?: string[];
  designationIds?: number[];
  /** People the department/role/designation picks matched, taken back out. */
  excludeUserIds?: number[];
  /** People picked by name — always in. */
  userIds?: number[];
}

/** Notice bodies are editor HTML; see common/rich-text. */
export const cleanNoticeHtml = cleanRichHtml;
const hasText = hasRichText;

/** Live: active, published and not expired. */
function liveWhere(now: Date) {
  return {
    isActive: true,
    publishedAt: { lte: now },
    OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
  };
}

/**
 * The notices one person may see: those addressed to them, and those from
 * before targeting, which have no recipients and went to everybody.
 */
function addressedTo(userId: number) {
  return { OR: [{ recipients: { some: { userId } } }, { recipients: { none: {} } }] };
}

/**
 * The company notice board.
 *
 * A notice is the company talking to everybody at once, which is what makes it
 * different from a notification: notifications are about something that
 * happened to you and are read once in a feed, while a notice stays in front
 * of every person until that person has seen it.
 */
/**
 * The instant a notice stops showing, from the date somebody picked.
 *
 * A date input yields midnight, so "stop showing on the 18th" stored as-is
 * means the notice dies the moment the 18th begins -- posting one on the 18th
 * to run until the 18th made it invisible to everybody immediately, while the
 * board still listed it to whoever posted it.
 *
 * A person choosing a date means the end of that day. A caller sending a full
 * timestamp means exactly that, and is left alone.
 */
function endOfDayIfDateOnly(value: string): Date {
  const parsed = new Date(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    parsed.setHours(23, 59, 59, 999);
  }
  return parsed;
}

@Injectable()
export class NoticesService {
  private readonly logger = new Logger(NoticesService.name);
  

  constructor(
    private prisma: PrismaService,
    private mail: MailService,
    @Optional() private realtime?: NotificationsGateway,
  ) {}

  private assertMayPublish(role: string) {
    if (!isHrAdmin(role)) {
      throw new ForbiddenException('Only an administrator or HR can post a notice');
    }
  }

  private readonly SELECT = {
    id: true, title: true, body: true, priority: true,
    publishedAt: true, expiresAt: true, isActive: true, emailSentAt: true,
    createdAt: true, updatedAt: true, audience: true,
    _count: { select: { recipients: true, reads: true } },
    createdBy: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
    attachments: {
      select: { id: true, fileName: true, fileUrl: true, fileSize: true },
      orderBy: { id: 'asc' as const },
    },
  } as const;

  /** Everything, for the admin screen. */
  /**
   * The notice board itself, which everybody may read.
   *
   * Posting is restricted; reading is the entire point. An announcement only
   * the people who wrote it can open is not a notice board.
   *
   * What differs by role is how much is shown. Whoever may post sees
   * everything, including retired notices and ones scheduled for next week,
   * because they are managing the board. Everybody else sees what is
   * currently live -- a notice written today for Monday is not an
   * announcement yet, and a retired one is no longer being made.
   */
  async list(companyId: number, role: string, userId?: number) {
    if (isHrAdmin(role)) {
      return this.prisma.notice.findMany({
        where: { companyId },
        orderBy: [{ publishedAt: 'desc' }],
        select: this.SELECT,
      });
    }

    const now = new Date();
    const notices = await this.prisma.notice.findMany({
      where: {
        companyId,
        AND: [liveWhere(now), ...(userId ? [addressedTo(userId)] : [])],
      },
      orderBy: [{ publishedAt: 'desc' }],
      select: { ...this.SELECT, reads: { where: { userId: userId ?? -1 }, select: { id: true } } },
    });
    // Read counts and audience are the sender's business.
    return notices.map(({ reads, _count, audience, ...n }) => ({ ...n, isRead: reads.length > 0 }));
  }

  /** Whether this role may post, so the page knows what to offer. */
  canPost(role: string): boolean {
    return isHrAdmin(role);
  }

  /**
   * What the person in front of the dashboard should see.
   *
   * Live means active, published, and not expired -- a notice written today
   * for Monday should not appear on Friday, and one that expired last week
   * should not linger. `unread` drives the popup; the full list stays
   * available so somebody can re-read what they dismissed.
   */
  async forDashboard(companyId: number, userId: number) {
    const now = new Date();
    const notices = await this.prisma.notice.findMany({
      where: { companyId, AND: [liveWhere(now), addressedTo(userId)] },
      orderBy: [{ priority: 'desc' }, { publishedAt: 'desc' }],
      select: { ...this.SELECT, reads: { where: { userId }, select: { id: true } } },
    });

    return notices.map(({ reads, _count, audience, ...n }) => ({ ...n, isRead: reads.length > 0 }));
  }

  async create(
    companyId: number,
    employeeId: number,
    role: string,
    data: {
      title?: string; body?: string; priority?: string;
      publishedAt?: string; expiresAt?: string; sendEmail?: boolean;
      attachments?: { fileName: string; fileUrl: string; fileSize?: number }[];
      audience?: NoticeAudience | null;
    },
  ) {
    this.assertMayPublish(role);

    const title = (data.title || '').trim();
    if (!title) throw new BadRequestException('A notice needs a title');
    const body = cleanNoticeHtml(data.body || '');
    if (!hasText(body)) throw new BadRequestException('A notice needs something to say');

    const audience = this.normaliseAudience(data.audience);
    const recipientIds = await this.resolveRecipients(companyId, audience);
    if (!recipientIds.length) {
      throw new BadRequestException('Nobody matches the departments, roles, designations and people you picked');
    }

    const publishedAt = data.publishedAt ? new Date(data.publishedAt) : new Date();
    const expiresAt = data.expiresAt ? endOfDayIfDateOnly(data.expiresAt) : null;
    if (expiresAt && expiresAt < publishedAt) {
      throw new BadRequestException('A notice cannot expire before it is published');
    }

    const notice = await this.prisma.notice.create({
      data: {
        title, body,
        priority: (data.priority || 'NORMAL').toUpperCase(),
        publishedAt, expiresAt,
        companyId,
        createdById: employeeId,
        audience: (audience ?? undefined) as any,
        recipients: { create: recipientIds.map((userId) => ({ userId })) },
        // Written with the notice so a half-posted announcement with orphaned
        // files is not a state this can end up in.
        attachments: {
          create: (data.attachments || [])
            .filter((a) => a?.fileUrl && a?.fileName)
            .map((a) => ({
              fileName: a.fileName,
              fileUrl: a.fileUrl,
              fileSize: a.fileSize ?? null,
            })),
        },
      },
      select: this.SELECT,
    });

    // A HIGH notice that is live now opens over whatever page its recipients
    // are on. One scheduled for later is picked up by the popup's own
    // periodic look once it goes live.
    if (notice.priority === 'HIGH' && publishedAt <= new Date()) {
      this.realtime?.sendNotice(recipientIds, notice.id);
    }

    if (data.sendEmail !== false) {
      // Not awaited, and never fatal: the notice is posted either way, and a
      // mail server having a bad afternoon must not lose the announcement.
      this.emailRecipients(notice.id, recipientIds, title, body, notice.attachments?.length ?? 0).catch((err) =>
        this.logger.error(`Notice ${notice.id} posted but not emailed: ${err}`),
      );
    }

    return notice;
  }

  /**
   * The picked audience, tidied. Null — nothing picked — means everybody.
   */
  private normaliseAudience(a?: NoticeAudience | null): NoticeAudience | null {
    if (!a) return null;
    const ints = (xs?: any[]) => [...new Set((xs || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    const out: NoticeAudience = {
      departmentIds: ints(a.departmentIds),
      roles: [...new Set((a.roles || []).map((r) => String(r).trim().toUpperCase()).filter(Boolean))],
      designationIds: ints(a.designationIds),
      excludeUserIds: ints(a.excludeUserIds),
      userIds: ints(a.userIds),
    };
    const hasGroup = !!(out.departmentIds!.length || out.roles!.length || out.designationIds!.length);
    if (!hasGroup) out.excludeUserIds = [];
    return hasGroup || out.userIds!.length ? out : null;
  }

  /**
   * Everybody the notice goes to, among active people in the company.
   *
   * Departments, roles and designations narrow each other: picking more
   * than one kind means people who match each of them. Anyone the sender
   * unticked from that group is taken out. People picked by name are always
   * added. One row each, however many picks they match.
   */
  private async resolveRecipients(companyId: number, audience: NoticeAudience | null): Promise<number[]> {
    const group: any[] = [];
    if (audience?.departmentIds?.length) group.push({ employee: { departmentId: { in: audience.departmentIds } } });
    if (audience?.roles?.length) group.push({ role: { in: audience.roles } });
    if (audience?.designationIds?.length) group.push({ employee: { designationId: { in: audience.designationIds } } });
    if (group.length && audience?.excludeUserIds?.length) group.push({ id: { notIn: audience.excludeUserIds } });

    const or: any[] = [];
    if (group.length) or.push(group.length === 1 ? group[0] : { AND: group });
    if (audience?.userIds?.length) or.push({ id: { in: audience.userIds } });

    const users = await this.prisma.user.findMany({
      where: { companyId, status: 'ACTIVE', ...(or.length ? { OR: or } : {}) },
      select: { id: true },
    });
    return [...new Set(users.map((u) => u.id))];
  }

  /**
   * Email the notice to the people it was addressed to.
   *
   * Sequential rather than parallel: ninety simultaneous sends is how a
   * provider starts refusing them, and nobody is waiting on this.
   */
  private async emailRecipients(noticeId: number, userIds: number[], title: string, body: string, attachmentCount = 0) {
    const recipients = await this.prisma.user.findMany({
      where: { id: { in: userIds }, email: { not: '' } },
      select: { email: true },
    });

    let sent = 0;
    for (const r of recipients) {
      try {
        await this.mail.sendNoticeEmail(r.email, title, body, attachmentCount);
        sent++;
      } catch (err) {
        this.logger.warn(`Notice ${noticeId}: could not email ${r.email}`);
      }
    }

    await this.prisma.notice.update({
      where: { id: noticeId },
      data: { emailSentAt: new Date() },
    });
    this.logger.log(`Notice ${noticeId} emailed to ${sent}/${recipients.length} people.`);
  }

  async update(
    companyId: number,
    role: string,
    noticeId: number,
    data: { title?: string; body?: string; priority?: string; publishedAt?: string; expiresAt?: string; isActive?: boolean },
  ) {
    this.assertMayPublish(role);
    const existing = await this.prisma.notice.findFirst({
      where: { id: noticeId, companyId }, select: { id: true },
    });
    if (!existing) throw new NotFoundException('Notice not found');

    const patch: any = {};
    if (data.title !== undefined) {
      const t = data.title.trim();
      if (!t) throw new BadRequestException('A notice needs a title');
      patch.title = t;
    }
    if (data.body !== undefined) {
      const b = cleanNoticeHtml(data.body);
      if (!hasText(b)) throw new BadRequestException('A notice needs something to say');
      patch.body = b;
    }
    if (data.priority !== undefined) patch.priority = data.priority.toUpperCase();
    if (data.publishedAt !== undefined) patch.publishedAt = new Date(data.publishedAt);
    if (data.expiresAt !== undefined) patch.expiresAt = data.expiresAt ? endOfDayIfDateOnly(data.expiresAt) : null;
    if (data.isActive !== undefined) patch.isActive = data.isActive;

    return this.prisma.notice.update({
      where: { id: noticeId }, data: patch, select: this.SELECT,
    });
  }

  /**
   * Retire rather than delete.
   *
   * A notice that has been read and acted on is a record of what the company
   * was told and when; removing the row removes the answer to "were we told".
   */
  async retire(companyId: number, role: string, noticeId: number) {
    this.assertMayPublish(role);
    const existing = await this.prisma.notice.findFirst({
      where: { id: noticeId, companyId }, select: { id: true },
    });
    if (!existing) throw new NotFoundException('Notice not found');

    return this.prisma.notice.update({
      where: { id: noticeId }, data: { isActive: false }, select: this.SELECT,
    });
  }

  /** One person marking one notice as seen. Idempotent. */
  async markRead(companyId: number, userId: number, noticeId: number) {
    const notice = await this.prisma.notice.findFirst({
      where: { id: noticeId, companyId, ...addressedTo(userId) }, select: { id: true },
    });
    if (!notice) throw new NotFoundException('Notice not found');

    await this.prisma.noticeRead.upsert({
      where: { noticeId_userId: { noticeId, userId } },
      create: { noticeId, userId },
      update: {},
    });
    return { success: true };
  }

  /**
   * Who has seen a notice and who has not, for whoever posted it.
   *
   * Read from the recipients stored at posting, with each person's current
   * name and department for display. A notice from before targeting has no
   * recipients; for it, everybody active in the company stands in.
   */
  async views(companyId: number, role: string, noticeId: number) {
    this.assertMayPublish(role);
    const notice = await this.prisma.notice.findFirst({
      where: { id: noticeId, companyId },
      select: { id: true, title: true, audience: true },
    });
    if (!notice) throw new NotFoundException('Notice not found');

    const stored = await this.prisma.noticeRecipient.findMany({
      where: { noticeId }, select: { userId: true },
    });
    const userIds = stored.length
      ? stored.map((r) => r.userId)
      : await this.resolveRecipients(companyId, null);

    const [users, reads] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: {
          id: true, email: true, role: true,
          employee: {
            select: {
              firstName: true, lastName: true, avatarUrl: true, designation: { select: { name: true } },
              department: { select: { name: true } },
            },
          },
        },
      }),
      this.prisma.noticeRead.findMany({
        where: { noticeId, userId: { in: userIds } },
        select: { userId: true, readAt: true },
      }),
    ]);

    const readAt = new Map(reads.map((r) => [r.userId, r.readAt]));
    const people = users
      .map((u) => ({
        userId: u.id,
        name: u.employee ? `${u.employee.firstName} ${u.employee.lastName}`.trim() : u.email,
        email: u.email,
        role: u.role,
        avatarUrl: u.employee?.avatarUrl ?? null,
        designation: u.employee?.designation?.name ?? null,
        department: u.employee?.department?.name ?? null,
        viewed: readAt.has(u.id),
        viewedAt: readAt.get(u.id) ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const viewed = people.filter((p) => p.viewed)
      .sort((a, b) => +new Date(b.viewedAt!) - +new Date(a.viewedAt!));
    const pending = people.filter((p) => !p.viewed);
    return {
      noticeId, title: notice.title, audience: notice.audience,
      total: people.length, viewedCount: viewed.length, pendingCount: pending.length,
      viewed, pending,
    };
  }

  /** What a sender can address a notice to: departments, roles and people. */
  async audienceOptions(companyId: number, role: string) {
    this.assertMayPublish(role);
    const [departments, designations, users] = await Promise.all([
      this.prisma.department.findMany({
        where: { companyId }, select: { id: true, name: true }, orderBy: { name: 'asc' },
      }),
      this.prisma.designation.findMany({
        where: { companyId }, select: { id: true, name: true }, orderBy: { name: 'asc' },
      }),
      this.prisma.user.findMany({
        where: { companyId, status: 'ACTIVE' },
        select: {
          id: true, email: true, role: true,
          employee: {
            select: {
              firstName: true, lastName: true, departmentId: true, designationId: true,
              designation: { select: { name: true } },
            },
          },
        },
      }),
    ]);
    const people = users
      .map((u) => ({
        userId: u.id,
        name: u.employee ? `${u.employee.firstName} ${u.employee.lastName}`.trim() : u.email,
        email: u.email,
        role: u.role,
        departmentId: u.employee?.departmentId ?? null,
        designationId: u.employee?.designationId ?? null,
        designation: u.employee?.designation?.name ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const roles = [...new Set(users.map((u) => u.role).filter(Boolean))].sort();
    // Only designations somebody holds — an empty one is a dead chip.
    const held = new Set(people.map((p) => p.designationId).filter((x) => x != null));
    return { departments, roles, designations: designations.filter((d) => held.has(d.id)), people };
  }
}
