import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CrmService } from '../crm/crm.service';
import { TicketsService } from '../tickets/tickets.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ChatBotService } from './chat-bot.service';

const MAX_MESSAGE = 4000;
const OPEN_STATUSES = ['BOT', 'OPEN'];

/** Fields a visitor's browser is allowed to see — never assignee internals. */
const PUBLIC_MESSAGE_SELECT = {
  id: true, senderType: true, senderName: true, message: true, metadata: true, createdAt: true,
} as const;

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
  ) {}

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
    };
  }

  /** Resume the visitor's open conversation, or start one with the greeting. */
  async startConversation(widgetKey: string, originHost: string | null, body: any, userAgent?: string) {
    const widget = await this.resolveWidget(widgetKey, originHost);
    const visitorId = this.visitorId(body);

    let conversation = await this.prisma.chatConversation.findFirst({
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

  async visitorMessage(widgetKey: string, originHost: string | null, conversationId: number, body: any) {
    const { widget, conversation } = await this.visitorConversation(widgetKey, originHost, conversationId, this.visitorId(body));
    const text = clean(body.message, MAX_MESSAGE);
    if (!text) throw new BadRequestException('Message is empty.');
    if (!OPEN_STATUSES.includes(conversation.status)) {
      // A visitor writing into a resolved chat reopens it for the team.
      await this.prisma.chatConversation.update({ where: { id: conversationId }, data: { status: 'OPEN' } });
      conversation.status = 'OPEN';
    }

    const visitorMsg = await this.prisma.chatMessage.create({
      data: {
        conversationId,
        senderType: 'VISITOR',
        senderName: conversation.visitorName || 'Visitor',
        message: text,
      },
    });
    await this.touch(conversationId);

    if (conversation.status !== 'BOT') {
      if (conversation.assignedToId) {
        this.notifications
          .notifyEmployees([conversation.assignedToId], {
            companyId: widget.companyId,
            title: `New chat message from ${conversation.visitorName || 'a visitor'}`,
            message: text.slice(0, 140),
            type: 'CHAT',
            linkUrl: `/crm/chat-inbox?c=${conversationId}`,
          })
          .catch(() => {});
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

    const firstName = name.split(' ')[0];
    await this.prisma.chatMessage.create({
      data: {
        conversationId,
        senderType: 'SYSTEM',
        senderName: widget.botName,
        message:
          intent === 'job'
            ? `Thanks ${firstName}! Our HR team will reply here${email ? ' and by email' : ''}. You can also apply directly to any open role on our careers page.`
            : `Thanks ${firstName}! I've passed this to our team — they'll reply right here${email ? ` and at ${email}` : ''}.`,
        isRead: true,
      },
    });
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

  async inboxConversation(companyId: number, id: number) {
    const conversation = await this.agentConversation(companyId, id);
    await this.prisma.chatMessage.updateMany({
      where: { conversationId: id, senderType: 'VISITOR', isRead: false },
      data: { isRead: true },
    });
    const messages = await this.prisma.chatMessage.findMany({ where: { conversationId: id }, orderBy: { id: 'asc' }, take: 500 });
    return { conversation, messages };
  }

  async agentReply(companyId: number, id: number, employeeId: number | null, body: any) {
    const conversation = await this.agentConversation(companyId, id);
    const text = clean(body.message, MAX_MESSAGE);
    if (!text) throw new BadRequestException('Message is empty.');
    const agent = employeeId
      ? await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { firstName: true } })
      : null;

    await this.prisma.chatMessage.create({
      data: { conversationId: id, senderType: 'AGENT', senderName: agent?.firstName || 'Support', message: text, isRead: true },
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
          linkUrl: `/crm/chat-inbox?c=${id}`,
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
