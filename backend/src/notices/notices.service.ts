import {
  Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

/**
 * The company notice board.
 *
 * A notice is the company talking to everybody at once, which is what makes it
 * different from a notification: notifications are about something that
 * happened to you and are read once in a feed, while a notice stays in front
 * of every person until that person has seen it.
 */
@Injectable()
export class NoticesService {
  private readonly logger = new Logger(NoticesService.name);
  private readonly ADMIN_ROLES = ['SUPERADMIN', 'SUPER_ADMIN', 'ADMIN', 'HR'];

  constructor(
    private prisma: PrismaService,
    private mail: MailService,
  ) {}

  private assertMayPublish(role: string) {
    if (!this.ADMIN_ROLES.includes(role)) {
      throw new ForbiddenException('Only an administrator or HR can post a notice');
    }
  }

  private readonly SELECT = {
    id: true, title: true, body: true, priority: true,
    publishedAt: true, expiresAt: true, isActive: true, emailSentAt: true,
    createdAt: true, updatedAt: true,
    createdBy: { select: { id: true, firstName: true, lastName: true } },
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
  async list(companyId: number, role: string) {
    if (this.ADMIN_ROLES.includes(role)) {
      return this.prisma.notice.findMany({
        where: { companyId },
        orderBy: [{ publishedAt: 'desc' }],
        select: this.SELECT,
      });
    }

    const now = new Date();
    return this.prisma.notice.findMany({
      where: {
        companyId,
        isActive: true,
        publishedAt: { lte: now },
        OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
      },
      orderBy: [{ publishedAt: 'desc' }],
      select: this.SELECT,
    });
  }

  /** Whether this role may post, so the page knows what to offer. */
  canPost(role: string): boolean {
    return this.ADMIN_ROLES.includes(role);
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
      where: {
        companyId,
        isActive: true,
        publishedAt: { lte: now },
        OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
      },
      orderBy: [{ priority: 'desc' }, { publishedAt: 'desc' }],
      select: { ...this.SELECT, reads: { where: { userId }, select: { id: true } } },
    });

    return notices.map(({ reads, ...n }) => ({ ...n, isRead: reads.length > 0 }));
  }

  async create(
    companyId: number,
    employeeId: number,
    role: string,
    data: {
      title?: string; body?: string; priority?: string;
      publishedAt?: string; expiresAt?: string; sendEmail?: boolean;
      attachments?: { fileName: string; fileUrl: string; fileSize?: number }[];
    },
  ) {
    this.assertMayPublish(role);

    const title = (data.title || '').trim();
    if (!title) throw new BadRequestException('A notice needs a title');
    const body = (data.body || '').trim();
    if (!body) throw new BadRequestException('A notice needs something to say');

    const publishedAt = data.publishedAt ? new Date(data.publishedAt) : new Date();
    const expiresAt = data.expiresAt ? new Date(data.expiresAt) : null;
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

    if (data.sendEmail !== false) {
      // Not awaited, and never fatal: the notice is posted either way, and a
      // mail server having a bad afternoon must not lose the announcement.
      this.emailEveryone(companyId, notice.id, title, body, notice.attachments?.length ?? 0).catch((err) =>
        this.logger.error(`Notice ${notice.id} posted but not emailed: ${err}`),
      );
    }

    return notice;
  }

  /**
   * Email the notice to every active person in the company.
   *
   * Sequential rather than parallel: ninety simultaneous sends is how a
   * provider starts refusing them, and nobody is waiting on this.
   */
  private async emailEveryone(companyId: number, noticeId: number, title: string, body: string, attachmentCount = 0) {
    const recipients = await this.prisma.user.findMany({
      where: { companyId, status: 'ACTIVE', email: { not: '' } },
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
      const b = data.body.trim();
      if (!b) throw new BadRequestException('A notice needs something to say');
      patch.body = b;
    }
    if (data.priority !== undefined) patch.priority = data.priority.toUpperCase();
    if (data.publishedAt !== undefined) patch.publishedAt = new Date(data.publishedAt);
    if (data.expiresAt !== undefined) patch.expiresAt = data.expiresAt ? new Date(data.expiresAt) : null;
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
      where: { id: noticeId, companyId }, select: { id: true },
    });
    if (!notice) throw new NotFoundException('Notice not found');

    await this.prisma.noticeRead.upsert({
      where: { noticeId_userId: { noticeId, userId } },
      create: { noticeId, userId },
      update: {},
    });
    return { success: true };
  }
}
