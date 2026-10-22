import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CrmService } from '../crm/crm.service';
import { TicketsService } from '../tickets/tickets.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PermissionsService } from '../permissions/permissions.service';
import { MailService } from '../mail/mail.service';
import { storeUploadedFile } from '../upload/store-uploaded-file';
import { ChatBotService } from './chat-bot.service';
import { cleanOfficeHours, officeStatus } from './office-hours';

const MAX_MESSAGE = 4000;
const OPEN_STATUSES = ['BOT', 'OPEN'];
/** The widget stops polling once the visitor ends a chat, so nothing an agent sends after that would reach them. */
export const VISITOR_ENDED_MESSAGE = 'The visitor ended the conversation.';

/** Fields a visitor's browser is allowed to see — never assignee internals. */
const PUBLIC_MESSAGE_SELECT = {
  id: true, senderType: true, senderName: true, message: true, metadata: true, createdAt: true,
} as const;

/** What visitors and agents may share in a chat. No SVG/HTML: those can carry script when opened. */
export const CHAT_ATTACHMENT_EXTENSIONS = [
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt',
];
export const MAX_CHAT_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

export interface ChatAttachment {
  url: string;
  name: string;
  size: number;
  isImage: boolean;
}

/** Shape a stored upload into message metadata. */
export function chatAttachment(file: Express.Multer.File, url: string): ChatAttachment {
  const name = (file.originalname || 'file').replace(/[\\/\r\n]/g, '_').slice(0, 160);
  const ext = (name.match(/\.[^.]+$/)?.[0] || '').toLowerCase();
  return { url, name, size: file.size, isImage: IMAGE_EXTENSIONS.includes(ext) };
}

/** Multer options for chat uploads: allowlisted extensions, 10 MB. */
export const chatAttachmentUpload = {
  limits: { fileSize: MAX_CHAT_ATTACHMENT_BYTES, files: 1 },
  fileFilter: (_req: any, file: Express.Multer.File, cb: (error: Error | null, accept: boolean) => void) => {
    const ext = (file.originalname.match(/\.[^.]+$/)?.[0] || '').toLowerCase();
    if (!CHAT_ATTACHMENT_EXTENSIONS.includes(ext)) {
      return cb(new BadRequestException('Send an image, PDF, Word, Excel, CSV or text file.'), false);
    }
    cb(null, true);
  },
};

function clean(value: any, max = 200): string | null {
  const s = typeof value === 'string' ? value.trim() : '';
  return s ? s.slice(0, max) : null;
}

/** "ces-pl.com, *.ces-pl.com" → does `host` match one of them. Empty list = any host. */
export function hostAllowed(allowedDomains: string | null | undefined, host: string | null): boolean {
  const rules = (allowedDomains || '').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
  if (!rules.length) return true;
  if (!host) return false;
  host = host.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1') return true;
  return rules.some((rule) => {
    if (rule === '*') return true;
    if (rule.startsWith('*.')) {
      const base = rule.slice(2);
      return host === base || host!.endsWith(`.${base}`);
    }
    return host === rule || host === `www.${rule}`;
  });
}

@Injectable()
export class ChatWidgetService {
  constructor(
    private prisma: PrismaService,
    private bot: ChatBotService,
    private crm: CrmService,
    private tickets: TicketsService,
    private notifications: NotificationsService,
    private permissions: PermissionsService,
    private mail: MailService,
  ) {}

  // In-memory, so per backend process — fine while one instance serves the API.
  /** companyId → when an agent's inbox last polled (it polls every 5s while the tab is visible). */
  private inboxSeenAt = new Map<number, number>();
  /** conversationId → when its last offline email went out. */
  private emailedAt = new Map<number, number>();
  private static readonly INBOX_ONLINE_MS = 45_000;
  private static readonly EMAIL_GAP_MS = 15 * 60_000;

  // ═══ Widget configuration (admin) ═══════════════════════════════════════════

  listWidgets(companyId: number) {
    return this.prisma.chatWidgetConfig.findMany({
      where: { companyId },
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { conversations: true } } },
    });
  }

  createWidget(companyId: number, data: any) {
    return this.prisma.chatWidgetConfig.create({ data: { companyId, ...this.widgetFields(data) } });
  }

  async updateWidget(companyId: number, id: number, data: any) {
    const widget = await this.prisma.chatWidgetConfig.findFirst({ where: { id, companyId } });
    if (!widget) throw new NotFoundException('Widget not found');
    return this.prisma.chatWidgetConfig.update({ where: { id }, data: this.widgetFields(data) });
  }

  /** Removes the widget and, by cascade, its conversations and messages. Lead contacts and tickets made from them stay. */
  async deleteWidget(companyId: number, id: number) {
    const widget = await this.prisma.chatWidgetConfig.findFirst({ where: { id, companyId } });
    if (!widget) throw new NotFoundException('Widget not found');
    await this.prisma.chatWidgetConfig.delete({ where: { id } });
    return { success: true };
  }

  private widgetFields(data: any) {
    const color = clean(data.primaryColor, 9);
    if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) throw new BadRequestException('Primary colour must be a hex value like #2563EB.');
    return {
      name: clean(data.name, 80) ?? undefined,
      primaryColor: color ?? undefined,
      headerTitle: clean(data.headerTitle, 80) ?? undefined,
      headerSubtitle: data.headerSubtitle !== undefined ? clean(data.headerSubtitle, 120) : undefined,
      greetingMessage: clean(data.greetingMessage, 500) ?? undefined,
      botName: clean(data.botName, 60) ?? undefined,
      botAvatarUrl: data.botAvatarUrl !== undefined ? clean(data.botAvatarUrl, 500) : undefined,
      position: data.position === 'bl' ? 'bl' : data.position === 'br' ? 'br' : undefined,
      enableAi: typeof data.enableAi === 'boolean' ? data.enableAi : undefined,
      allowedDomains: data.allowedDomains !== undefined ? clean(data.allowedDomains, 500) : undefined,
      isEnabled: typeof data.isEnabled === 'boolean' ? data.isEnabled : undefined,
      officeHours: data.officeHours !== undefined ? (cleanOfficeHours(data.officeHours) as any) ?? Prisma.DbNull : undefined,
      offlineMessage: data.offlineMessage !== undefined ? clean(data.offlineMessage, 300) : undefined,
    };
  }

  // ═══ Public (visitor) ═══════════════════════════════════════════════════════

  async resolveWidget(widgetKey: string, originHost: string | null) {
    const widget = await this.prisma.chatWidgetConfig.findUnique({
      where: { widgetKey },
      include: { company: { select: { name: true, logoUrl: true } } },
    });
    if (!widget || !widget.isEnabled) throw new NotFoundException('Chat widget not found');
    if (!hostAllowed(widget.allowedDomains, originHost)) {
      throw new ForbiddenException('This chat widget is not enabled for this website.');
    }
    return widget;
  }

  async publicConfig(widgetKey: string, originHost: string | null) {
    const w = await this.resolveWidget(widgetKey, originHost);
    return {
      widgetKey: w.widgetKey,
      companyName: w.company.name,
      primaryColor: w.primaryColor,
      headerTitle: w.headerTitle,
      headerSubtitle: w.headerSubtitle,
      greetingMessage: w.greetingMessage,
      botName: w.botName,
      botAvatarUrl: w.botAvatarUrl || w.company.logoUrl,
      position: w.position,
      ...this.offlineInfo(w),
    };
  }

  /** online flag plus what to tell visitors when the team is out of office. */
  private offlineInfo(w: { officeHours: any; offlineMessage: string | null }) {
    const { online, backAt } = officeStatus(cleanOfficeHours(w.officeHours));
    return {
      online,
      backAt,
      offlineMessage: online
        ? null
        : w.offlineMessage || `We're offline right now${backAt ? ` and back ${backAt}` : ''}. Leave a message and we'll get back to you.`,
    };
  }

  /** Resume the visitor's open conversation, or start one with the greeting. */
  async startConversation(widgetKey: string, originHost: string | null, body: any, userAgent?: string) {
    const widget = await this.resolveWidget(widgetKey, originHost);
    const visitorId = this.visitorId(body);

    if (body.forceNew) {
      // Leave a trail in the chats being replaced so an agent mid-reply knows why it closed.
      const previous = await this.prisma.chatConversation.findMany({
        where: { widgetConfigId: widget.id, visitorId, status: { in: OPEN_STATUSES } },
        select: { id: true },
      });
      if (previous.length) {
        const ids = previous.map((c) => c.id);
        await this.prisma.chatConversation.updateMany({ where: { id: { in: ids } }, data: { status: 'RESOLVED' } });
        await this.prisma.chatMessage.createMany({
          data: ids.map((conversationId) => ({
            conversationId,
            senderType: 'SYSTEM',
            senderName: 'System',
            message: 'The visitor started a new conversation, so this one was closed.',
            isRead: true,
          })),
        });
      }
    }

    let conversation = body.forceNew ? null : await this.prisma.chatConversation.findFirst({
      where: { widgetConfigId: widget.id, visitorId, status: { in: OPEN_STATUSES } },
      orderBy: { createdAt: 'desc' },
    });
    // Page loads only resume — a chat is created when the visitor opens the widget.
    if (!conversation && body.resumeOnly) return { conversation: null, messages: [] };
    if (!conversation) {
      conversation = await this.prisma.chatConversation.create({
        data: {
          widgetConfigId: widget.id,
          visitorId,
          source: body.source === 'CAREERS' ? 'CAREERS' : 'WEBSITE',
          pageUrl: clean(body.pageUrl, 1000),
          referrer: clean(body.referrer, 1000),
          userAgent: clean(userAgent, 500),
          messages: {
            create: { senderType: 'BOT', senderName: widget.botName, message: widget.greetingMessage, isRead: true },
          },
        },
      });
    }
    const messages = await this.prisma.chatMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { id: 'asc' },
      select: PUBLIC_MESSAGE_SELECT,
      take: 200,
    });
    return { conversation: this.publicConversation(conversation), messages };
  }

  async pollMessages(widgetKey: string, originHost: string | null, conversationId: number, visitorId: string, afterId: number) {
    const { conversation } = await this.visitorConversation(widgetKey, originHost, conversationId, visitorId);
    const messages = await this.prisma.chatMessage.findMany({
      where: { conversationId, id: { gt: afterId || 0 } },
      orderBy: { id: 'asc' },
      select: PUBLIC_MESSAGE_SELECT,
      take: 100,
    });
    return { conversation: this.publicConversation(conversation), messages };
  }

  /** A file from the visitor: checked against the conversation before anything is stored. */
  async visitorAttachment(widgetKey: string, originHost: string | null, conversationId: number, body: any, file: Express.Multer.File, req: any) {
    if (!file) throw new BadRequestException('No file received.');
    const { conversation } = await this.visitorConversation(widgetKey, originHost, conversationId, this.visitorId(body));
    if (!OPEN_STATUSES.includes(conversation.status)) throw new BadRequestException('This chat has ended — start a new one to send files.');
    const { url } = await storeUploadedFile(file, '/chat_attachments', req);
    return this.visitorMessage(widgetKey, originHost, conversationId, body, chatAttachment(file, url));
  }

  async visitorMessage(widgetKey: string, originHost: string | null, conversationId: number, body: any, attachment?: ChatAttachment) {
    const { widget, conversation } = await this.visitorConversation(widgetKey, originHost, conversationId, this.visitorId(body));
    const text = clean(body.message, MAX_MESSAGE) || (attachment ? attachment.name : null);
    if (!text) throw new BadRequestException('Message is empty.');
    if (!OPEN_STATUSES.includes(conversation.status)) {
      // A visitor writing into a resolved chat reopens it. The bot picks it back up
      // unless an agent still owns it — then it goes straight to them.
      const status = conversation.assignedToId ? 'OPEN' : 'BOT';
      await this.prisma.chatConversation.update({ where: { id: conversationId }, data: { status } });
      conversation.status = status;
    }

    const visitorMsg = await this.prisma.chatMessage.create({
      data: {
        conversationId,
        senderType: 'VISITOR',
        senderName: conversation.visitorName || 'Visitor',
        message: text,
        metadata: attachment ? { attachment } as any : undefined,
      },
    });
    await this.touch(conversationId);

    // The bot can't read files — pass them on rather than guessing at an answer.
    if (attachment && conversation.status === 'BOT') {
      const hasContact = !!(conversation.visitorEmail || conversation.visitorPhone);
      await this.prisma.chatMessage.create({
        data: {
          conversationId,
          senderType: 'BOT',
          senderName: widget.botName,
          message: hasContact
            ? "Thanks for the file! I can't open attachments myself, so I'll pass it to our team."
            : "Thanks for the file! I can't open attachments myself — leave your details and our team will take a look.",
          metadata: hasContact ? undefined : { intent: 'support', action: 'collect_contact' },
          isRead: true,
        },
      });
      if (hasContact) {
        // We already know who they are: hand the chat to the team now.
        await this.prisma.chatConversation.update({ where: { id: conversationId }, data: { status: 'OPEN' } });
        this.notifyTeam(widget.companyId, conversationId, `${conversation.visitorName || 'A visitor'} sent a file`, attachment.name);
      }
      await this.touch(conversationId);
      return this.pollMessages(widgetKey, originHost, conversationId, conversation.visitorId, visitorMsg.id - 1);
    }

    if (conversation.status !== 'BOT') {
      if (conversation.assignedToId) {
        this.notifications
          .notifyEmployees([conversation.assignedToId], {
            companyId: widget.companyId,
            title: `New chat message from ${conversation.visitorName || 'a visitor'}`,
            message: text.slice(0, 140),
            type: 'CHAT',
            linkUrl: `/website-chat/inbox?c=${conversationId}`,
          })
          .catch(() => {});
        this.emailAssigneeIfInboxClosed(widget.companyId, conversationId, conversation.assignedToId, `New chat message from ${conversation.visitorName || 'a visitor'}`, text);
      } else {
        // Nobody owns it yet: alert the team, but once per burst rather than per line.
        const previous = await this.prisma.chatMessage.findFirst({
          where: { conversationId, id: { lt: visitorMsg.id } },
          orderBy: { id: 'desc' },
          select: { senderType: true },
        });
        if (previous?.senderType !== 'VISITOR') {
          this.notifyTeam(widget.companyId, conversationId, `${conversation.visitorName || 'A visitor'} is waiting for a reply`, text);
        }
      }
      return this.pollMessages(widgetKey, originHost, conversationId, conversation.visitorId, visitorMsg.id - 1);
    }

    const history = await this.prisma.chatMessage.findMany({
      where: { conversationId, id: { lt: visitorMsg.id }, senderType: { in: ['VISITOR', 'BOT', 'AGENT'] } },
      orderBy: { id: 'desc' },
      take: 10,
      select: { senderType: true, message: true },
    });
    const reply = await this.bot.reply(
      widget.companyId,
      { botName: widget.botName, companyName: widget.company.name, source: conversation.source, useAi: widget.enableAi },
      history.reverse(),
      text,
    );

    const hasContact = !!(conversation.visitorEmail || conversation.visitorPhone);
    const metadata: any = {};
    if (reply.articles.length) metadata.articles = reply.articles;
    if (reply.intent !== 'none') {
      metadata.intent = reply.intent;
      // Ask for details once; after that the visitor can just keep chatting.
      if (!hasContact) metadata.action = 'collect_contact';
      else metadata.quickReplies = ['Talk to a person'];
    }

    await this.prisma.chatMessage.create({
      data: {
        conversationId,
        senderType: 'BOT',
        senderName: widget.botName,
        message: reply.message,
        metadata: Object.keys(metadata).length ? metadata : undefined,
        isRead: true,
      },
    });
    await this.touch(conversationId);
    return this.pollMessages(widgetKey, originHost, conversationId, conversation.visitorId, visitorMsg.id - 1);
  }

  /**
   * Visitor left their details (from the bot's prompt or "talk to a person").
   * Hands the chat to the team, and a sales enquiry also lands in Lead
   * Contacts — the same place public lead forms put enquiries.
   */
  async submitContact(widgetKey: string, originHost: string | null, conversationId: number, body: any) {
    const { widget, conversation } = await this.visitorConversation(widgetKey, originHost, conversationId, this.visitorId(body));
    const name = clean(body.name, 120);
    const email = clean(body.email, 160);
    const phone = clean(body.phone, 30);
    if (!name) throw new BadRequestException('Please tell us your name.');
    if (!email && !phone) throw new BadRequestException('Please leave an email or phone number so we can reach you.');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException('That email address does not look right.');

    const intent = ['sales', 'support', 'job', 'human'].includes(body.intent) ? body.intent : 'human';
    await this.prisma.chatConversation.update({
      where: { id: conversationId },
      data: { visitorName: name, visitorEmail: email, visitorPhone: phone, status: 'OPEN', lastMessageAt: new Date() },
    });

    if (intent === 'sales' && !conversation.leadContactId) {
      await this.createLeadContact(widget.companyId, conversationId, null).catch(() => {});
    }

    const who = `${name}${intent === 'sales' ? ' (sales enquiry)' : intent === 'job' ? ' (careers)' : intent === 'support' ? ' (support)' : ''}`;
    if (conversation.assignedToId) {
      this.notifications
        .notifyEmployees([conversation.assignedToId], {
          companyId: widget.companyId,
          title: `${who} left their details`,
          message: [email, phone].filter(Boolean).join(' · '),
          type: 'CHAT',
          linkUrl: `/website-chat/inbox?c=${conversationId}`,
        })
        .catch(() => {});
      this.emailAssigneeIfInboxClosed(widget.companyId, conversationId, conversation.assignedToId, `${who} left their details`, [email, phone].filter(Boolean).join(' · '));
    } else {
      this.notifyTeam(widget.companyId, conversationId, `${who} wants to talk to the team`, [email, phone].filter(Boolean).join(' · '));
    }

    const firstName = name.split(' ')[0];
    const { online, backAt } = this.offlineInfo(widget);
    await this.prisma.chatMessage.create({
      data: {
        conversationId,
        senderType: 'SYSTEM',
        senderName: widget.botName,
        message:
          intent === 'job'
            ? `Thanks ${firstName}! Our HR team will reply here${email ? ' and by email' : ''}. You can also apply directly to any open role on our careers page.`
            : online
              ? `Thanks ${firstName}! I've passed this to our team — they'll reply right here${email ? ` and at ${email}` : ''}.`
              : `Thanks ${firstName}! Our team is offline right now${backAt ? ` and back ${backAt}` : ''} — they'll reply ${email ? `at ${email}` : 'here'} as soon as they're in.`,
        isRead: true,
      },
    });
    return this.pollMessages(widgetKey, originHost, conversationId, conversation.visitorId, 0);
  }

  /**
   * Visitor ended/closed the conversation from the embedded widget.
   * Sets status to RESOLVED and adds an audit system message.
   */
  async visitorCloseConversation(widgetKey: string, originHost: string | null, conversationId: number, body: any) {
    const { conversation } = await this.visitorConversation(widgetKey, originHost, conversationId, this.visitorId(body));
    if (conversation.status !== 'RESOLVED' && conversation.status !== 'CLOSED') {
      await this.prisma.chatConversation.update({
        where: { id: conversationId },
        data: { status: 'RESOLVED', lastMessageAt: new Date() },
      });
      await this.prisma.chatMessage.create({
        data: {
          conversationId,
          senderType: 'SYSTEM',
          senderName: 'System',
          message: VISITOR_ENDED_MESSAGE,
          isRead: true,
        },
      });
    }
    return this.pollMessages(widgetKey, originHost, conversationId, conversation.visitorId, 0);
  }

  async publicVisitor(widgetKey: string, originHost: string | null, conversationId: number, visitorId: string) {
    const { conversation } = await this.visitorConversation(widgetKey, originHost, conversationId, visitorId);
    return this.publicConversation(conversation);
  }

  private async visitorConversation(widgetKey: string, originHost: string | null, conversationId: number, visitorId: string) {
    const widget = await this.resolveWidget(widgetKey, originHost);
    const conversation = await this.prisma.chatConversation.findFirst({
      where: { id: conversationId, widgetConfigId: widget.id, visitorId },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    return { widget, conversation };
  }

  private visitorId(body: any): string {
    const id = clean(body?.visitorId, 64);
    if (!id || !/^[A-Za-z0-9-]{16,64}$/.test(id)) throw new BadRequestException('Missing visitor id.');
    return id;
  }

  private publicConversation(c: any) {
    return {
      id: c.id,
      status: c.status,
      visitorName: c.visitorName,
      hasContact: !!(c.visitorEmail || c.visitorPhone),
    };
  }

  private touch(conversationId: number) {
    return this.prisma.chatConversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date() } });
  }

  // ═══ Agent inbox ════════════════════════════════════════════════════════════

  async inbox(companyId: number, status?: string, mine?: { employeeId: number | null }) {
    this.inboxSeenAt.set(companyId, Date.now());
    // Someone who opened the widget and left has nothing for an agent to read.
    const where: any = { widgetConfig: { companyId }, messages: { some: { senderType: 'VISITOR' } } };
    if (status === 'ACTIVE') where.status = { in: OPEN_STATUSES };
    else if (status) where.status = status;
    if (mine?.employeeId) where.assignedToId = mine.employeeId;

    const rows = await this.prisma.chatConversation.findMany({
      where,
      orderBy: { lastMessageAt: 'desc' },
      take: 100,
      include: {
        widgetConfig: { select: { name: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
        messages: { orderBy: { id: 'desc' }, take: 1, select: { message: true, senderType: true, createdAt: true } },
        _count: { select: { messages: { where: { senderType: 'VISITOR', isRead: false } } } },
      },
    });
    return rows.map(({ messages, _count, ...c }) => ({ ...c, lastMessage: messages[0] ?? null, unread: _count.messages }));
  }

  // ═══ Reports ════════════════════════════════════════════════════════════════

  /**
   * How the chat is doing over the last `days`: volume, how much the bot handled
   * alone, how fast people answered, and per-agent load. Chat volume is small,
   * so it's computed in memory from the conversations and their message times.
   */
  async reports(companyId: number, days: number) {
    const span = [7, 30, 90].includes(days) ? days : 30;
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - (span - 1));

    const conversations = await this.prisma.chatConversation.findMany({
      where: { widgetConfig: { companyId }, createdAt: { gte: since }, messages: { some: { senderType: 'VISITOR' } } },
      select: {
        id: true, status: true, source: true, createdAt: true, leadContactId: true, ticketId: true,
        visitorEmail: true, visitorPhone: true,
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
        messages: { select: { senderType: true, createdAt: true }, orderBy: { id: 'asc' } },
      },
      take: 5000,
    });

    const median = (xs: number[]) => {
      if (!xs.length) return null;
      const s = [...xs].sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return Math.round(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
    };

    // Server-local calendar days, matching how `since` was cut.
    const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const daily = new Map<string, number>();
    for (let i = 0; i < span; i++) {
      const d = new Date(since);
      d.setDate(since.getDate() + i);
      daily.set(dayKey(d), 0);
    }

    let botOnly = 0, handedOff = 0, answered = 0, leads = 0, tickets = 0, careers = 0;
    const firstResponse: number[] = [];
    const agents = new Map<number, { name: string; chats: number; replies: number; firstResponse: number[] }>();

    for (const c of conversations) {
      const day = dayKey(c.createdAt);
      daily.set(day, (daily.get(day) ?? 0) + 1);
      if (c.source === 'CAREERS') careers++;
      if (c.leadContactId) leads++;
      if (c.ticketId) tickets++;

      const agentMsgs = c.messages.filter((m) => m.senderType === 'AGENT');
      const wantedPerson = c.status === 'OPEN' || !!(c.visitorEmail || c.visitorPhone) || agentMsgs.length > 0;
      if (!wantedPerson) botOnly++;
      else handedOff++;

      if (agentMsgs.length) {
        answered++;
        // From the visitor's first message to the first human reply.
        const firstVisitor = c.messages.find((m) => m.senderType === 'VISITOR')!;
        const wait = (agentMsgs[0].createdAt.getTime() - firstVisitor.createdAt.getTime()) / 1000;
        if (wait >= 0) firstResponse.push(wait);
        if (c.assignedTo) {
          const a = agents.get(c.assignedTo.id) ?? {
            name: `${c.assignedTo.firstName} ${c.assignedTo.lastName ?? ''}`.trim(),
            chats: 0, replies: 0, firstResponse: [],
          };
          a.chats++;
          a.replies += agentMsgs.length;
          if (wait >= 0) a.firstResponse.push(wait);
          agents.set(c.assignedTo.id, a);
        }
      }
    }

    const total = conversations.length;
    return {
      days: span,
      total,
      careers,
      website: total - careers,
      botOnly,
      handedOff,
      answered,
      unanswered: handedOff - answered,
      botResolvedRate: total ? Math.round((botOnly / total) * 100) : 0,
      medianFirstResponseSec: median(firstResponse),
      leads,
      tickets,
      daily: [...daily.entries()].map(([date, count]) => ({ date, count })),
      agents: [...agents.values()]
        .map((a) => ({ name: a.name, chats: a.chats, replies: a.replies, medianFirstResponseSec: median(a.firstResponse) }))
        .sort((a, b) => b.chats - a.chats),
    };
  }

  async inboxConversation(companyId: number, id: number) {
    const conversation = await this.agentConversation(companyId, id);
    await this.prisma.chatMessage.updateMany({
      where: { conversationId: id, senderType: 'VISITOR', isRead: false },
      data: { isRead: true },
    });
    const messages = await this.prisma.chatMessage.findMany({ where: { conversationId: id }, orderBy: { id: 'asc' }, take: 500 });
    return { conversation, messages };
  }

  async agentAttachment(companyId: number, id: number, employeeId: number | null, body: any, file: Express.Multer.File, req: any) {
    if (!file) throw new BadRequestException('No file received.');
    const conversation = await this.agentConversation(companyId, id);
    if (!OPEN_STATUSES.includes(conversation.status) || (await this.endedByVisitor(id))) {
      throw new BadRequestException('This conversation has ended. Reopen it before sending files.');
    }
    const { url } = await storeUploadedFile(file, '/chat_attachments', req);
    return this.agentReply(companyId, id, employeeId, body, chatAttachment(file, url));
  }

  async agentReply(companyId: number, id: number, employeeId: number | null, body: any, attachment?: ChatAttachment) {
    const conversation = await this.agentConversation(companyId, id);
    if (!OPEN_STATUSES.includes(conversation.status)) {
      throw new BadRequestException('This conversation has ended. Reopen it before replying.');
    }
    if (await this.endedByVisitor(id)) {
      throw new BadRequestException('The visitor ended this conversation, so they will not see new replies.');
    }
    const text = clean(body.message, MAX_MESSAGE) || (attachment ? attachment.name : null);
    if (!text) throw new BadRequestException('Message is empty.');
    const agent = employeeId
      ? await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { firstName: true } })
      : null;

    await this.prisma.chatMessage.create({
      data: {
        conversationId: id,
        senderType: 'AGENT',
        senderName: agent?.firstName || 'Support',
        message: text,
        metadata: attachment ? { attachment } as any : undefined,
        isRead: true,
      },
    });
    // Once a person has spoken the bot steps aside; first responder owns the chat.
    await this.prisma.chatConversation.update({
      where: { id },
      data: {
        status: OPEN_STATUSES.includes(conversation.status) ? 'OPEN' : conversation.status,
        assignedToId: conversation.assignedToId ?? employeeId ?? undefined,
        lastMessageAt: new Date(),
      },
    });
    return this.inboxConversation(companyId, id);
  }

  async updateConversation(companyId: number, id: number, employeeId: number | null, body: any) {
    const conversation = await this.agentConversation(companyId, id);
    const data: any = {};
    if (body.status) {
      if (!['BOT', 'OPEN', 'RESOLVED', 'CLOSED'].includes(body.status)) throw new BadRequestException('Unknown status.');
      if (OPEN_STATUSES.includes(body.status) && !OPEN_STATUSES.includes(conversation.status) && (await this.endedByVisitor(id))) {
        throw new BadRequestException('The visitor ended this conversation. It reopens when they write again.');
      }
      data.status = body.status;
    }
    if (body.assignedToId !== undefined) {
      if (body.assignedToId === null) data.assignedToId = null;
      else if (body.assignedToId === 'me') {
        if (!employeeId) throw new BadRequestException('Only employees can take chats.');
        data.assignedToId = employeeId;
      }
      else {
        const emp = await this.prisma.employee.findFirst({ where: { id: Number(body.assignedToId), companyId }, select: { id: true } });
        if (!emp) throw new BadRequestException('Employee not found.');
        data.assignedToId = emp.id;
      }
    }
    await this.prisma.chatConversation.update({ where: { id }, data });
    if (data.status && data.status !== conversation.status && ['RESOLVED', 'CLOSED'].includes(data.status)) {
      await this.prisma.chatMessage.create({
        data: { conversationId: id, senderType: 'SYSTEM', senderName: 'System', message: 'This conversation was marked as resolved. Write again any time if you need more help.', isRead: true },
      });
    }
    if (data.assignedToId && data.assignedToId !== employeeId) {
      this.notifications
        .notifyEmployees([data.assignedToId], {
          companyId,
          title: 'Website chat assigned to you',
          message: `${conversation.visitorName || 'A visitor'} is waiting for a reply.`,
          type: 'CHAT',
          linkUrl: `/website-chat/inbox?c=${id}`,
          excludeEmployeeId: employeeId,
        })
        .catch(() => {});
    }
    return this.inboxConversation(companyId, id);
  }

  async convertToLead(companyId: number, id: number, employeeId: number | null) {
    const conversation = await this.agentConversation(companyId, id);
    if (conversation.leadContactId) return { leadContactId: conversation.leadContactId, existing: true };
    const leadContactId = await this.createLeadContact(companyId, id, employeeId);
    return { leadContactId, existing: false };
  }

  async convertToTicket(companyId: number, id: number, employeeId: number | null, body: any) {
    const conversation = await this.agentConversation(companyId, id);
    if (conversation.ticketId) return { ticketId: conversation.ticketId, existing: true };
    if (!employeeId) throw new BadRequestException('Only employees can raise tickets.');
    const transcript = await this.transcript(id);
    const ticket = await this.tickets.create(companyId, employeeId, {
      title: clean(body.title, 200) || `Website chat: ${conversation.visitorName || 'visitor'}`,
      description: [
        `Raised from website chat #${id}.`,
        `Visitor: ${conversation.visitorName || '-'} · ${conversation.visitorEmail || '-'} · ${conversation.visitorPhone || '-'}`,
        conversation.pageUrl ? `Page: ${conversation.pageUrl}` : null,
        '',
        transcript,
      ].filter((l) => l !== null).join('\n'),
      type: ['BUG', 'FEATURE_REQUEST', 'IMPROVEMENT', 'QUESTION'].includes(body.type) ? body.type : 'QUESTION',
      priority: body.priority,
    });
    await this.prisma.chatConversation.update({ where: { id }, data: { ticketId: ticket.id } });
    await this.prisma.chatMessage.create({
      data: { conversationId: id, senderType: 'SYSTEM', senderName: 'System', message: `Ticket ${ticket.ticketNumber} created.`, isRead: true },
    });
    return { ticketId: ticket.id, ticketNumber: ticket.ticketNumber, existing: false };
  }

  private async createLeadContact(companyId: number, conversationId: number, employeeId: number | null) {
    const c = await this.prisma.chatConversation.findUnique({ where: { id: conversationId } });
    if (!c) throw new NotFoundException('Conversation not found');
    if (!c.visitorName && !c.visitorEmail && !c.visitorPhone) {
      throw new BadRequestException('The visitor has not left a name, email or phone yet.');
    }
    const contact = await this.crm.createLeadContact(companyId, null, {
      name: c.visitorName || c.visitorEmail || c.visitorPhone,
      email: c.visitorEmail,
      phone: c.visitorPhone,
      leadSource: 'Website Chat',
      addedById: employeeId,
    });
    await this.crm
      .createLeadContactNote(
        companyId,
        contact.id,
        { title: `Website chat #${conversationId}`, type: 'GENERAL', content: await this.transcript(conversationId) },
        employeeId,
      )
      .catch(() => {});
    await this.prisma.chatConversation.update({ where: { id: conversationId }, data: { leadContactId: contact.id } });
    return contact.id;
  }

  /**
   * Fire-and-forget alert to everyone with Website Chat inbox access (in-app + push).
   * If no one has the inbox open, it also goes by email — push is not on every phone.
   */
  private notifyTeam(companyId: number, conversationId: number, title: string, message: string) {
    this.permissions
      .websiteChatInboxTeam(companyId)
      .then(async (team) => {
        await this.notifications.notifyEmployees(team.map((m) => m.employeeId), {
          companyId,
          title,
          message: message.slice(0, 140),
          type: 'CHAT',
          linkUrl: `/website-chat/inbox?c=${conversationId}`,
        });
        this.emailIfInboxClosed(companyId, conversationId, team.map((m) => m.email), title, message);
      })
      .catch(() => {});
  }

  /** The assigned agent's email, when nobody has the inbox open. */
  private emailAssigneeIfInboxClosed(companyId: number, conversationId: number, employeeId: number, title: string, message: string) {
    this.prisma.employee
      .findUnique({ where: { id: employeeId }, select: { user: { select: { email: true, status: true } } } })
      .then((e) => {
        if (e?.user?.email && e.user.status !== 'SUSPENDED') {
          this.emailIfInboxClosed(companyId, conversationId, [e.user.email], title, message);
        }
      })
      .catch(() => {});
  }

  private emailIfInboxClosed(companyId: number, conversationId: number, emails: string[], title: string, message: string) {
    const now = Date.now();
    if (now - (this.inboxSeenAt.get(companyId) ?? 0) < ChatWidgetService.INBOX_ONLINE_MS) return;
    if (now - (this.emailedAt.get(conversationId) ?? 0) < ChatWidgetService.EMAIL_GAP_MS) return;
    this.emailedAt.set(conversationId, now);
    const link = `/website-chat/inbox?c=${conversationId}`;
    for (const email of new Set(emails)) {
      void this.mail.sendWebsiteChatAlertEmail(email, title, message.slice(0, 500), link);
    }
  }

  /** True while the latest SYSTEM message is the visitor's own End Chat — a visitor writing again reopens it. */
  private async endedByVisitor(conversationId: number) {
    const lastSystem = await this.prisma.chatMessage.findFirst({
      where: { conversationId, senderType: 'SYSTEM' },
      orderBy: { id: 'desc' },
      select: { id: true, message: true },
    });
    if (lastSystem?.message !== VISITOR_ENDED_MESSAGE) return false;
    const visitorSince = await this.prisma.chatMessage.count({
      where: { conversationId, senderType: 'VISITOR', id: { gt: lastSystem.id } },
    });
    return visitorSince === 0;
  }

  private async transcript(conversationId: number) {
    const msgs = await this.prisma.chatMessage.findMany({
      where: { conversationId, senderType: { not: 'SYSTEM' } },
      orderBy: { id: 'asc' },
      take: 200,
    });
    return msgs.map((m) => `[${m.createdAt.toISOString().slice(0, 16).replace('T', ' ')}] ${m.senderName}: ${m.message}`).join('\n');
  }

  private async agentConversation(companyId: number, id: number) {
    const conversation = await this.prisma.chatConversation.findFirst({
      where: { id, widgetConfig: { companyId } },
      include: {
        widgetConfig: { select: { id: true, name: true, botName: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    return conversation;
  }
}
