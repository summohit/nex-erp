import { Injectable, NotFoundException, ConflictException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsService } from '../permissions/permissions.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class CrmService {
  constructor(
    private prisma: PrismaService,
    private permissionsService: PermissionsService,
    private notificationsService: NotificationsService,
  ) {}

  private async logActivity(
    companyId: number,
    leadId: number,
    action: string,
    description: string,
    actorId?: number | null,
    metadata?: any,
  ) {
    return this.prisma.leadActivity.create({
      data: {
        companyId,
        leadId,
        action,
        description,
        actorId: actorId ?? null,
        metadata: metadata || undefined,
      },
      include: {
        actor: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true, designation: { select: { name: true } } },
        },
      },
    });
  }

  private sanitizeLead(data: any) {
    const out = { ...data };
    if (typeof out.leadCode === 'string') {
      out.leadCode = out.leadCode.trim() || undefined;
    }
    if (out.proposalDate === '' || out.proposalDate === null) delete out.proposalDate;
    else if (out.proposalDate) out.proposalDate = new Date(out.proposalDate);
    
    if (out.expectedCloseDate === '' || out.expectedCloseDate === null) delete out.expectedCloseDate;
    else if (out.expectedCloseDate) out.expectedCloseDate = new Date(out.expectedCloseDate);

    if (out.value !== undefined) out.value = out.value ? parseFloat(out.value) : null;

    // Pipeline discriminator — only the two known flows are stored; anything
    // else falls back to the column default (SALES).
    if (out.flow !== undefined && out.flow !== 'SALES' && out.flow !== 'PRE_SALES') {
      delete out.flow;
    }
    return out;
  }

  private normalizeIdentity(value: any): string {
    return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  // CSV exports often leave stray commas on email addresses; strip them so
  // "a@b.com," and "a@b.com" compare as equal.
  private normalizeEmail(value: any): string {
    return this.normalizeIdentity(value).replace(/[,;]+$/, '');
  }

  // Compare phone numbers by digits only (+91 / spaces / dashes all collapse).
  private normalizePhone(value: any): string {
    return this.normalizeIdentity(value).replace(/[^0-9]/g, '');
  }

  /**
   * Backfills the contact linkage for deals that were created without pointing
   * at a Lead Contact (older/imported rows). Matching is deliberately
   * conservative so unrelated deals are never attached. A deal matches when:
   *   - email or phone is identical, OR
   *   - name AND company agree, OR
   *   - a multi-word name agrees exactly.
   * Imports sometimes put the phone into the name field, so a match is decided
   * by any signal, not by requiring the name to agree too. It only ever writes
   * the link (plus the contact's canonical name/company onto unlabeled deals);
   * no deal data is deleted.
   */
  private async linkLeadsToContact(companyId: number, contact: any): Promise<number> {
    const name = this.normalizeIdentity(contact?.name);
    if (!name) return 0;

    const email = this.normalizeEmail(contact?.email);
    const phone = this.normalizePhone(contact?.phone || contact?.mobile);
    const company = this.normalizeIdentity(contact?.companyName);
    const multiWord = name.includes(' ');

    const unlinked = await this.prisma.lead.findMany({
      where: { companyId, broughtByContactId: null, contactName: { not: null } },
      select: { id: true, contactName: true, email: true, phone: true, companyName: true },
    });

    const toLink: number[] = [];
    for (const lead of unlinked) {
      const lName = this.normalizeIdentity(lead.contactName);
      const lEmail = this.normalizeEmail(lead.email);
      const lPhone = this.normalizePhone(lead.phone);
      const lCompany = this.normalizeIdentity(lead.companyName);

      const sameName = !!lName && lName === name;
      const sameEmail = !!email && !!lEmail && lEmail === email;
      const samePhone = !!phone && !!lPhone && lPhone === phone;
      const sameCompany = !!company && !!lCompany && lCompany === company;

      const confident =
        sameEmail ||
        samePhone ||
        (sameName && sameCompany) ||
        (sameName && multiWord && lName.includes(' '));
      if (confident) toLink.push(lead.id);
    }

    if (!toLink.length) return 0;

    // The contact profile is the source of truth for the person, so deals that
    // were only identifiable by phone/email also get the real name/company.
    const syncData: any = { broughtByContactId: contact.id };
    if (contact.name) syncData.contactName = contact.name;
    if (contact.companyName) syncData.companyName = contact.companyName;

    const result = await this.prisma.lead.updateMany({
      where: { id: { in: toLink } },
      data: syncData,
    });
    return result.count;
  }

  /**
   * When a deal is saved without an explicit Lead Contact, tries to link it to
   * an existing contact by identity (email/phone, name + company, or a
   * multi-word name). Only ever writes `broughtByContactId` and returns null
   * when no confident match exists.
   */
  private async findContactForLead(companyId: number, leadData: any): Promise<{ id: number } | null> {
    const name = this.normalizeIdentity(leadData?.contactName);
    const email = this.normalizeEmail(leadData?.email);
    const phone = this.normalizePhone(leadData?.phone);
    const company = this.normalizeIdentity(leadData?.companyName);
    const multiWord = name.includes(' ');

    const or: any[] = [];
    if (email) or.push({ email: { equals: email } });
    if (phone) or.push({ phone: { equals: phone } });
    if (name) {
      if (multiWord) or.push({ name: { equals: name } });
      if (company) or.push({ name: { equals: name }, companyName: { equals: company } });
    }
    if (!or.length) return null;

    const contact = await this.prisma.leadContact.findFirst({
      where: { companyId, OR: or },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    return contact ?? null;
  }

  /**
   * Builds the next human-readable reference, e.g. L0926-001 / LC-0926-001 /
   * PS-0926-001: prefix + MMYY + a sequence that restarts each month.
   *
   * The sequence comes from the highest existing code for this month rather than
   * a counter table, so it stays correct if rows are deleted or backfilled. Two
   * simultaneous creates can still compute the same number, which is why the
   * column is UNIQUE and the caller retries — the constraint is the real guard,
   * not this read.
   */
  private async nextEntityCode(
    kind: 'LEAD' | 'CONTACT' | 'PRESALES',
    companyId: number,
  ): Promise<string> {
    const isContact = kind === 'CONTACT';
    const prefix = kind === 'LEAD' ? 'L' : isContact ? 'LC-' : 'PS-';
    const now = new Date();
    const mmyy = `${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getFullYear()).slice(-2)}`;
    const stem = `${prefix}${mmyy}-`;

    // Scoped by company: two companies each get their own -001 for the month.
    const latest =
      isContact
        ? await this.prisma.leadContact.findFirst({
            where: { companyId, contactCode: { startsWith: stem } },
            orderBy: { contactCode: 'desc' },
            select: { contactCode: true },
          })
        : await this.prisma.lead.findFirst({
            where: { companyId, leadCode: { startsWith: stem } },
            orderBy: { leadCode: 'desc' },
            select: { leadCode: true },
          });

    const current = (latest as any)?.leadCode ?? (latest as any)?.contactCode ?? null;
    const seq = current ? parseInt(String(current).slice(stem.length), 10) : 0;
    const next = (Number.isFinite(seq) ? seq : 0) + 1;
    return `${stem}${String(next).padStart(3, '0')}`;
  }

  /**
   * Retries on a unique-constraint clash so two concurrent creates can't both
   * fail — the second simply recomputes and takes the next number.
   */
  private async withEntityCode<T>(
    kind: 'LEAD' | 'CONTACT' | 'PRESALES',
    companyId: number,
    create: (code: string) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = await this.nextEntityCode(kind, companyId);
      try {
        return await create(code);
      } catch (error: any) {
        // P2002 = unique constraint violation; anything else is a real failure.
        if (error?.code !== 'P2002') throw error;
      }
    }
    // Never block the record itself on the label.
    return create(`${kind === 'LEAD' ? 'L' : kind === 'PRESALES' ? 'PS' : 'LC'}-${Date.now()}`);
  }

  async createLead(companyId: number, data: any, creatorEmployeeId?: number | null) {
    const sanitized = this.sanitizeLead(data);
    const requestedLeadCode = sanitized.leadCode;
    const flow = sanitized.flow === 'PRE_SALES' ? 'PRE_SALES' : 'SALES';
    const codeKind = flow === 'PRE_SALES' ? 'PRESALES' : 'LEAD';

    // No explicit contact chosen — link by identity so the new deal shows up
    // under its Lead Contact profile immediately.
    if (!sanitized.broughtByContactId) {
      const contact = await this.findContactForLead(companyId, sanitized);
      if (contact) sanitized.broughtByContactId = contact.id;
    }

    const create = (leadCode: string) => this.prisma.lead.create({
      data: {
        ...sanitized,
        leadCode,
        addedById: sanitized.addedById ?? creatorEmployeeId ?? null,
        companyId,
      },
      include: {
        assignedTo: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true, designation: { select: { name: true } } },
        },
        addedBy: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true, designation: { select: { name: true } } },
        },
        broughtByContact: true,
      },
    });

    let lead: any;
    try {
      lead = requestedLeadCode
        ? await create(requestedLeadCode)
        : await this.withEntityCode(codeKind, companyId, create);
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new ConflictException(`Lead ID "${requestedLeadCode}" already exists. Please enter a different unique ID.`);
      }
      throw error;
    }

    await this.logActivity(
      companyId,
      lead.id,
      'DEAL_CREATED',
      `Deal "${lead.title}" created`,
      lead.addedById ?? creatorEmployeeId,
      { title: lead.title, status: lead.status, value: lead.value, companyName: lead.companyName },
    );

    if (lead.assignedToId) {
      await this.notificationsService.notifyEmployees([lead.assignedToId], {
        companyId,
        excludeEmployeeId: creatorEmployeeId,
        title: 'New Deal Assigned to You',
        message: `"${lead.title}"${lead.companyName ? ` — ${lead.companyName}` : ''} is now yours.`,
        type: 'ASSIGNMENT',
        linkUrl: `/crm/leads/${lead.id}`,
      });
    }

    return lead;
  }

  async getLeads(
    companyId: number,
    user: { role?: string; employeeId?: number | null },
    flow?: string,
  ) {
    const where: any = { companyId };
    if (flow) where.flow = flow;

    const isUnrestricted = user.role === 'SUPERADMIN' || user.role === 'ADMIN';
    if (!isUnrestricted) {
      const canViewAll = await this.permissionsService.hasPermission(
        companyId, user.role || 'EMPLOYEE', 'crm/leads', 'VIEW_ALL',
      );
      if (!canViewAll) {
        where.OR = [
          { addedById: user.employeeId ?? -1 },
          { assignedToId: user.employeeId ?? -1 },
          // Being on a deal's pre-sales team is what lets you see the deal.
          // Without this the assignment grants nothing and the employee cannot
          // find the work they have been given.
          { preSalesMembers: { some: { employeeId: user.employeeId ?? -1, status: 'ACTIVE' } } },
        ];
      }
    }

    return this.prisma.lead.findMany({
      where,
      include: {
        assignedTo: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true, designation: { select: { name: true } } },
        },
        addedBy: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true, designation: { select: { name: true } } },
        },
        broughtByContact: true,
        // id-only / minimal-field selects — just enough for the board's Quotation Status
        // and Follow-Up Status filters, without shipping full quotation or follow-up rows.
        quotations: { select: { id: true } },
        followUps: { select: { id: true, scheduledAt: true }, orderBy: { scheduledAt: 'asc' } },
        // Pre-sales engagement overview for the pre-sales board list (empty for SALES).
        // Enough for the board's team chips and task counts; the full picture
        // comes from getPreSalesInfo, which also applies the financial masking.
        preSalesMembers: {
          where: { status: 'ACTIVE' },
          select: {
            id: true,
            employeeId: true,
            status: true,
            employee: {
              select: { id: true, firstName: true, lastName: true, avatarUrl: true, designation: { select: { name: true } } },
            },
          },
        },
        preSalesTasks: {
          select: { id: true, assignedToId: true, title: true, status: true, scheduledAt: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    }).then((leads) => this.maskLeadsForPreSales(leads, user));
  }

  /**
   * Remove the commercial fields from any lead the caller can only see because
   * they are on its pre-sales team.
   *
   * Done here, on the way out of the service, rather than in the template: a
   * field hidden by *ngIf is still in the JSON, and anyone can open devtools.
   * A caller who reaches the lead another way — they created it, they own it,
   * they have VIEW_ALL, they are an admin — keeps the full row.
   */
  /**
   * Pre-sales tasks shaped for the My Tasks list — one person's by default,
   * or the whole company's when `everyone` is set for an administrator.
   *
   * This lives here rather than in TasksService because the CRM module owns what
   * a pre-sales viewer may see. Crucially the lead `select` below is minimal —
   * id and names only — so `value`, `currency`, `expectedClosure` and every
   * other commercial field are physically absent from the result rather than
   * stripped afterwards. maskLeadsForPreSales is subtractive: it removes fields
   * from a lead that was already fully loaded. Calling it here would work today
   * and quietly stop working the first time somebody widened the select.
   *
   * ⚠️ If this select ever grows beyond identity fields, route the result
   * through maskLeadsForPreSales — or better, do not grow it.
   */
  async getMyPreSalesTasks(
    companyId: number,
    employeeId: number,
    opts: { includeDone?: boolean; take?: number; everyone?: boolean; isAdmin?: boolean } = {},
  ): Promise<any[]> {
    const tasks = await this.prisma.preSalesTask.findMany({
      where: {
        companyId,
        // `everyone` is the administrator's company-wide view. The caller is
        // responsible for having checked the role — this method is not a
        // permission boundary, it is the CRM's shaping of the rows.
        ...(opts.everyone ? {} : { assignedToId: employeeId }),
        ...(opts.includeDone ? {} : { status: { not: 'COMPLETED' } }),
      },
      select: {
        id: true,
        title: true,
        description: true,
        taskType: true,
        status: true,
        createdAt: true,
        scheduledAt: true,
        estimatedMinutes: true,
        assignedToId: true,
        assignedById: true,
        lead: { select: { id: true, title: true, leadCode: true, companyName: true, contactName: true, flow: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: opts.take ?? 200,
    });

    // NEW/WORKING/ON_HOLD/COMPLETED is this module's ladder; the task list uses
    // a shared one. rawStatus is carried through so the badge still reads
    // "On Hold" rather than the normalised "Blocked".
    const LADDER: Record<string, string> = {
      NEW: 'TODO',
      WORKING: 'IN_PROGRESS',
      ON_HOLD: 'BLOCKED',
      COMPLETED: 'DONE',
    };
    const now = new Date();
    const isAdmin = opts.isAdmin === true;

    return tasks.map((t) => {
      const dealName = t.lead?.title
        ? (t.lead.companyName ? `${t.lead.title} (${t.lead.companyName})` : t.lead.title)
        : (t.lead?.companyName || t.lead?.contactName || (t.lead?.leadCode ? `Deal ${t.lead.leadCode}` : 'Deal'));

      return {
        source: 'PRE_SALES' as const,
        id: t.id,
        refKey: `PS-${t.id}`,
        title: t.title,
        status: (LADDER[t.status] ?? 'TODO') as any,
        rawStatus: t.status,
        // A pre-sales task has no priority. Left null rather than defaulted,
        // because inventing one would sort real priorities against a guess.
        priority: null,
        taskType: t.taskType ?? null,
        startDate: null,
        dueDate: t.scheduledAt,
        estimatedHours: t.estimatedMinutes != null ? t.estimatedMinutes / 60 : null,
        createdAt: t.createdAt ?? null,
        projectId: null,
        assignees: t.assignedTo ? [t.assignedTo] : [],
        parent: {
          kind: 'LEAD' as const,
          id: t.lead.id,
          name: dealName,
        },
        blockedBy: [],
        isOverdue: !!t.scheduledAt && t.scheduledAt < now,
        // My Tasks is where a pre-sales task is worked now that the deal page
        // no longer carries the table, so a row links back to this list rather
        // than to the lead.
        link: {
          route: '/projects',
          queryParams: { tab: 'my-tasks', psTask: String(t.id) },
        },
        // Everything the My Tasks row needs to act on the task without a second
        // request. The flags mirror what changePreSalesTaskStatus,
        // updatePreSalesTask and deletePreSalesTask will actually allow — the
        // server still re-checks, so tampering with them changes nothing.
        preSales: {
          leadId: t.lead.id,
          assignedToId: t.assignedToId,
          assignedById: t.assignedById,
          description: t.description ?? null,
          scheduledAt: t.scheduledAt,
          estimatedMinutes: t.estimatedMinutes,
          canChangeStatus:
            isAdmin || t.assignedToId === employeeId || t.assignedById === employeeId,
          canManage: isAdmin || t.assignedById === employeeId,
        },
      };
    });
  }

  private async maskLeadsForPreSales<T extends { id: number; addedById: number | null; assignedToId: number | null }>(
    leads: T[],
    user: { role?: string; employeeId?: number | null },
  ): Promise<T[]> {
    if (this.isPreSalesAdmin(user.role) || !user.employeeId || !leads.length) return leads;

    // Deliberately NOT short-circuited by VIEW_ALL. That permission grants
    // breadth — which leads you may see — not depth. Whether you may see a
    // given deal's money depends on your relationship to that deal, and being
    // on its pre-sales team and nothing else is exactly the relationship the
    // brief says must not include commercial figures.
    const memberships = await this.prisma.preSalesTeamMember.findMany({
      where: { employeeId: user.employeeId, status: 'ACTIVE', leadId: { in: leads.map((l) => l.id) } },
      select: { leadId: true },
    });
    if (!memberships.length) return leads;
    const preSalesOnly = new Set(memberships.map((m) => m.leadId));

    return leads.map((lead) =>
      preSalesOnly.has(lead.id) && lead.addedById !== user.employeeId && lead.assignedToId !== user.employeeId
        ? this.maskLeadFinancials(lead)
        : lead,
    );
  }

  async getLeadById(companyId: number, id: number, user: { role?: string; employeeId?: number | null }) {
    const lead = await this.prisma.lead.findFirst({
      where: { id, companyId },
      include: {
        assignedTo: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true, designation: { select: { name: true } }, department: { select: { name: true } } },
        },
        addedBy: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true, designation: { select: { name: true } }, department: { select: { name: true } } },
        },
        broughtByContact: true,
        client: true,
        // Items and attachments are relations, so `quotations: true` alone
        // returns the scalars and nothing else — which is why reopening a
        // proposal to edit it came up with an empty line-items table.
        quotations: {
          include: {
            items: { orderBy: { id: 'asc' } },
            attachments: true,
          },
        },
        followUps: {
          orderBy: { scheduledAt: 'desc' },
          include: {
            assignedTo: {
              select: { id: true, firstName: true, lastName: true, avatarUrl: true, designation: { select: { name: true } } },
            },
          },
        },
      },
    });
    if (!lead) throw new NotFoundException('Lead not found');

    const isUnrestricted = user.role === 'SUPERADMIN' || user.role === 'ADMIN';
    if (!isUnrestricted) {
      const canViewAll = await this.permissionsService.hasPermission(
        companyId, user.role || 'EMPLOYEE', 'crm/leads', 'VIEW_ALL',
      );
      const owns =
        (lead.addedById !== null && lead.addedById === user.employeeId) ||
        (lead.assignedToId !== null && lead.assignedToId === user.employeeId);

      // A pre-sales member reaches the deal through their assignment.
      const onPreSalesTeam = !!user.employeeId && await this.prisma.preSalesTeamMember.findFirst({
        where: { leadId: id, employeeId: user.employeeId, status: 'ACTIVE' },
        select: { id: true },
      });

      if (!canViewAll && !owns && !onPreSalesTeam) throw new NotFoundException('Lead not found');

      // Same rule as the list: VIEW_ALL decides which deals you reach, not
      // whether you see the money on a deal you only touch as pre-sales.
      if (!owns && onPreSalesTeam) return this.maskLeadFinancials(lead);
    }

    return lead;
  }

  async updateLeadStatus(companyId: number, leadId: number, status: string) {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, companyId } });
    if (!lead) throw new NotFoundException('Lead not found');

    const isWinningStage = ['WIN', 'WON'].includes(String(status || '').trim().toUpperCase());
    if (isWinningStage) {
      const purchaseOrder = await this.prisma.leadFile.findFirst({
        where: { leadId, companyId, purpose: 'PURCHASE_ORDER' },
        select: { id: true },
      });
      if (!purchaseOrder) {
        throw new BadRequestException('Upload the purchase order before moving this deal to Win and sending it to Finance.');
      }
    }

    const updatedLead = await this.prisma.lead.update({
      where: { id: leadId },
      data: { status },
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, designation: { select: { name: true } } } },
        addedBy: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, designation: { select: { name: true } } } },
        broughtByContact: true,
      }
    });

    await this.logActivity(
      companyId,
      leadId,
      'STAGE_CHANGED',
      `Deal stage changed from "${lead.status}" to "${status}"`,
      updatedLead.addedById,
      { from: lead.status, to: status, title: lead.title },
    );

    // Automatically create a client if status changed to WON
    if (isWinningStage && !lead.clientId && lead.companyName) {
      const newClient = await this.prisma.client.create({
        data: {
          name: lead.companyName,
          companyId,
          contacts: lead.contactName && lead.email ? {
            create: [{
              firstName: lead.contactName.split(' ')[0] || 'Unknown',
              lastName: lead.contactName.split(' ')[1] || '',
              email: lead.email,
              phone: lead.phone,
              isPrimary: true
            }]
          } : undefined
        }
      });
      
      await this.prisma.lead.update({
        where: { id: leadId },
        data: { clientId: newClient.id }
      });
    }

    return updatedLead;
  }

  /**
   * Hand a PRE_SALES deal over to the main sales pipeline. A sales lead is
   * created from the pre-sale record (status New) and the pre-sale is marked
   * 'Converted / Won' with a link to the new lead. Engagement history
   * (follow-ups, notes, files, quotations) moves across with it.
   */
  async convertPreSaleToSales(
    companyId: number,
    preSaleId: number,
    actorEmployeeId?: number | null,
  ) {
    const preSale = await this.prisma.lead.findFirst({
      where: { id: preSaleId, companyId },
    });
    if (!preSale) throw new NotFoundException('Pre-sales lead not found');
    if (preSale.flow !== 'PRE_SALES') {
      throw new BadRequestException('This record is not a pre-sales lead.');
    }
    if (preSale.convertedToSalesId) {
      throw new BadRequestException('This pre-sales deal has already been converted to a sales lead.');
    }

    // Quotations already raised during evaluation move to the new lead so the
    // Quote Status filter on the sales board sees them from day one.
    const quotations = await this.prisma.quotation.findMany({
      where: { leadId: preSale.id },
      select: { id: true },
    });
    const followUps = await this.prisma.leadFollowUp.findMany({
      where: { leadId: preSale.id },
      select: {
        title: true, contactPerson: true, contactPhone: true, contactEmail: true,
        type: true, scheduledAt: true, notes: true, status: true, assignedToId: true,
      },
    });
    const notes = await this.prisma.leadNote.findMany({
      where: { leadId: preSale.id },
      select: { content: true, createdById: true },
    });
    const files = await this.prisma.leadFile.findMany({
      where: { leadId: preSale.id },
      select: { fileName: true, fileUrl: true, fileType: true, fileSize: true, purpose: true, uploadedById: true },
    });

    const create = (leadCode: string) => this.prisma.lead.create({
      data: {
        title: preSale.title,
        subjectLine: preSale.subjectLine,
        dealCategory: preSale.dealCategory,
        companyName: preSale.companyName,
        contactName: preSale.contactName,
        email: preSale.email,
        phone: preSale.phone,
        value: preSale.value,
        currency: preSale.currency,
        source: preSale.source,
        status: 'New',
        description: preSale.description,
        qualificationReason: preSale.qualificationReason,
        assignedToId: preSale.assignedToId,
        addedById: actorEmployeeId ?? preSale.addedById,
        broughtByContactId: preSale.broughtByContactId,
        expectedCloseDate: preSale.expectedCloseDate,
        website: preSale.website,
        address: preSale.address,
        clientId: preSale.clientId,
        companyId,
        flow: 'SALES',
        leadCode,
      },
    });

    const salesLead = await this.withEntityCode('LEAD', companyId, create);

    if (followUps.length) {
      await this.prisma.leadFollowUp.createMany({
        data: followUps.map((fu) => ({ ...fu, leadId: salesLead.id, companyId })),
      });
    }
    if (notes.length) {
      await this.prisma.leadNote.createMany({
        data: notes.map((n) => ({ ...n, leadId: salesLead.id, companyId })),
      });
    }
    if (files.length) {
      await this.prisma.leadFile.createMany({
        data: files.map((f) => ({ ...f, leadId: salesLead.id, companyId })),
      });
    }
    if (quotations.length) {
      await this.prisma.quotation.updateMany({
        where: { leadId: preSale.id, companyId },
        data: { leadId: salesLead.id },
      });
    }

    // Carry the pre-sales engagement (team members, requests, tasks, MoMs) over
    // to the sales deal so the evaluation history stays on the record.
    await this.prisma.preSalesTeamMember.updateMany({ where: { leadId: preSale.id }, data: { leadId: salesLead.id } });
    await this.prisma.preSalesRequest.updateMany({ where: { leadId: preSale.id }, data: { leadId: salesLead.id } });
    await this.prisma.preSalesTask.updateMany({ where: { leadId: preSale.id }, data: { leadId: salesLead.id } });
    await this.prisma.preSalesMoM.updateMany({ where: { leadId: preSale.id }, data: { leadId: salesLead.id } });

    await this.prisma.lead.update({
      where: { id: preSale.id },
      data: { status: 'Converted / Won', convertedToSalesId: salesLead.id },
    });

    await this.logActivity(
      companyId,
      preSale.id,
      'CONVERTED_TO_SALES',
      `Pre-sales deal converted to sales lead ${salesLead.leadCode}`,
      actorEmployeeId ?? preSale.addedById,
      { salesLeadId: salesLead.id, salesLeadCode: salesLead.leadCode },
    );
    await this.logActivity(
      companyId,
      salesLead.id,
      'DEAL_CREATED',
      `Deal "${salesLead.title}" created from pre-sales hand-off`,
      actorEmployeeId || salesLead.addedById,
      { fromPreSaleId: preSale.id },
    );

    return {
      preSale: { ...preSale, status: 'Converted / Won', convertedToSalesId: salesLead.id },
      salesLead,
    };
  }
  
  async updateLead(companyId: number, leadId: number, data: any, actorEmployeeId?: number | null) {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, companyId } });
    if (!lead) throw new NotFoundException('Lead not found');

    const requestedStatus = data.status;
    if (requestedStatus !== undefined && ['WIN', 'WON'].includes(String(requestedStatus).trim().toUpperCase())) {
      const purchaseOrder = await this.prisma.leadFile.findFirst({
        where: { leadId, companyId, purpose: 'PURCHASE_ORDER' },
        select: { id: true },
      });
      if (!purchaseOrder) {
        throw new BadRequestException('Upload the purchase order before moving this deal to Win and sending it to Finance.');
      }
    }

    const sanitized = this.sanitizeLead(data);
    // Lead references are immutable after creation, so all integrations keep a
    // stable identifier even when the opportunity details change.
    delete sanitized.leadCode;

    const updatedLead = await this.prisma.lead.update({
      where: { id: leadId },
      data: sanitized,
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, designation: { select: { name: true } } } },
        addedBy: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, designation: { select: { name: true } } } },
        broughtByContact: true,
      }
    });

    await this.logActivity(
      companyId,
      leadId,
      'DEAL_EDITED',
      `Deal "${lead.title}" updated`,
      updatedLead.addedById,
      { title: lead.title },
    );

    // Deals saved without a contact get linked by identity (email/phone/name)
    // so the contact profile and the table/Kanban always show the same deals.
    if (!updatedLead.broughtByContactId) {
      const contact = await this.findContactForLead(companyId, {
        contactName: updatedLead.contactName,
        email: updatedLead.email,
        phone: updatedLead.phone,
        companyName: updatedLead.companyName,
      });
      if (contact) {
        await this.prisma.lead.update({
          where: { id: leadId },
          data: { broughtByContactId: contact.id },
        });
        updatedLead.broughtByContactId = contact.id;
      }
    }

    // Only on a genuine handover — an edit that leaves the owner alone should
    // not re-notify them, or every field change becomes a ping.
    if (
      data.assignedToId !== undefined &&
      Number(data.assignedToId) !== lead.assignedToId &&
      updatedLead.assignedToId
    ) {
      await this.notificationsService.notifyEmployees([updatedLead.assignedToId], {
        companyId,
        excludeEmployeeId: actorEmployeeId,
        title: 'Deal Assigned to You',
        message: `You are now the owner of "${updatedLead.title}".`,
        type: 'ASSIGNMENT',
        linkUrl: `/crm/leads/${leadId}`,
      });
    }

    return updatedLead;
  }

  async deleteLead(companyId: number, leadId: number) {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, companyId } });
    if (!lead) throw new NotFoundException('Lead not found');

    return this.prisma.lead.delete({
      where: { id: leadId },
    });
  }

  // ═══════════════════════════════════════════
  // DEAL FILES
  // ═══════════════════════════════════════════

  async getLeadFiles(companyId: number, leadId: number) {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, companyId } });
    if (!lead) throw new NotFoundException('Lead not found');

    return this.prisma.leadFile.findMany({
      where: { leadId, companyId },
      include: {
        uploadedBy: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true, designation: { select: { name: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async addLeadFile(companyId: number, leadId: number, file: any, uploaderEmployeeId?: number | null) {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, companyId } });
    if (!lead) throw new NotFoundException('Lead not found');

    if (file.followUpId) {
      const followUp = await this.prisma.leadFollowUp.findFirst({
        where: { id: Number(file.followUpId), leadId, companyId },
        select: { id: true },
      });
      if (!followUp) throw new NotFoundException('Follow-up not found');
    }

    const leadFile = await this.prisma.leadFile.create({
      data: {
        leadId,
        companyId,
        fileName: file.originalname || 'file',
        fileUrl: file.url,
        fileType: file.mimetype || null,
        fileSize: file.size || null,
        purpose: file.purpose === 'PURCHASE_ORDER' ? 'PURCHASE_ORDER' : null,
        followUpId: file.followUpId ? Number(file.followUpId) : null,
        uploadedById: uploaderEmployeeId || null,
      },
      include: {
        uploadedBy: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true, designation: { select: { name: true } } },
        },
      },
    });

    await this.logActivity(
      companyId,
      leadId,
      'FILE_UPLOADED',
      `File "${leadFile.fileName}" uploaded`,
      uploaderEmployeeId,
      { fileId: leadFile.id, fileName: leadFile.fileName, purpose: leadFile.purpose, followUpId: leadFile.followUpId },
    );

    return leadFile;
  }

  async deleteLeadFile(companyId: number, leadId: number, fileId: number) {
    const file = await this.prisma.leadFile.findFirst({ where: { id: fileId, leadId, companyId } });
    if (!file) throw new NotFoundException('File not found');

    const deleted = await this.prisma.leadFile.delete({ where: { id: fileId } });

    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, companyId } });
    await this.logActivity(
      companyId,
      leadId,
      'FILE_DELETED',
      `File "${deleted.fileName}" deleted`,
      lead?.addedById,
      { fileId, fileName: deleted.fileName },
    );

    return deleted;
  }

  async renameLeadFile(companyId: number, leadId: number, fileId: number, fileName: string) {
    const file = await this.prisma.leadFile.findFirst({ where: { id: fileId, leadId, companyId } });
    if (!file) throw new NotFoundException('File not found');

    const name = String(fileName || '').trim();
    if (!name) throw new BadRequestException('File name is required.');
    if (name.length > 200) throw new BadRequestException('File name must be 200 characters or fewer.');

    const updated = await this.prisma.leadFile.update({
      where: { id: fileId },
      data: { fileName: name },
    });

    await this.logActivity(
      companyId,
      leadId,
      'FILE_RENAMED',
      `File renamed from "${file.fileName}" to "${updated.fileName}"`,
      null,
      { fileId, from: file.fileName, to: updated.fileName },
    );

    return updated;
  }

  // ═══════════════════════════════════════════
  // DEAL NOTES
  // ═══════════════════════════════════════════

  async getLeadNotes(companyId: number, leadId: number) {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, companyId } });
    if (!lead) throw new NotFoundException('Lead not found');

    return this.prisma.leadNote.findMany({
      where: { leadId, companyId },
      include: {
        createdBy: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true, designation: { select: { name: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createLeadNote(companyId: number, leadId: number, data: any, creatorEmployeeId?: number | null) {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, companyId } });
    if (!lead) throw new NotFoundException('Lead not found');

    const note = await this.prisma.leadNote.create({
      data: {
        leadId,
        companyId,
        content: data.content,
        createdById: creatorEmployeeId || null,
      },
      include: {
        createdBy: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true, designation: { select: { name: true } } },
        },
      },
    });

    await this.logActivity(
      companyId,
      leadId,
      'NOTE_ADDED',
      `Note added by ${note.createdBy ? `${note.createdBy.firstName} ${note.createdBy.lastName}`.trim() : 'user'}`,
      creatorEmployeeId,
      { noteId: note.id },
    );

    return note;
  }

  async updateLeadNote(companyId: number, leadId: number, noteId: number, data: any, actorEmployeeId?: number | null) {
    const note = await this.prisma.leadNote.findFirst({ where: { id: noteId, leadId, companyId } });
    if (!note) throw new NotFoundException('Note not found');

    const updated = await this.prisma.leadNote.update({
      where: { id: noteId },
      data: { content: data.content },
      include: {
        createdBy: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true, designation: { select: { name: true } } },
        },
      },
    });

    await this.logActivity(companyId, leadId, 'NOTE_UPDATED', `Note updated`, actorEmployeeId, { noteId });

    return updated;
  }

  async deleteLeadNote(companyId: number, leadId: number, noteId: number, actorEmployeeId?: number | null) {
    const note = await this.prisma.leadNote.findFirst({ where: { id: noteId, leadId, companyId } });
    if (!note) throw new NotFoundException('Note not found');

    const deleted = await this.prisma.leadNote.delete({ where: { id: noteId } });

    await this.logActivity(companyId, leadId, 'NOTE_DELETED', `Note deleted`, actorEmployeeId, { noteId });

    return deleted;
  }

  // ═══════════════════════════════════════════
  // DEAL HISTORY / ACTIVITY
  // ═══════════════════════════════════════════

  async getLeadHistory(companyId: number, leadId: number) {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, companyId } });
    if (!lead) throw new NotFoundException('Lead not found');

    return this.prisma.leadActivity.findMany({
      where: { leadId, companyId },
      include: {
        actor: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true, designation: { select: { name: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ═══════════════════════════════════════════
  // LEAD ANALYTICS DASHBOARD (Admin/SuperAdmin only)
  // ═══════════════════════════════════════════

  private resolveDashboardRange(range: string, startDate?: string, endDate?: string): { start: Date; end: Date; prevStart: Date; prevEnd: Date } {
    const now = new Date();
    let start: Date;
    let end: Date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    if (range === 'this_quarter') {
      const qStartMonth = Math.floor(now.getMonth() / 3) * 3;
      start = new Date(now.getFullYear(), qStartMonth, 1, 0, 0, 0, 0);
    } else if (range === 'this_year') {
      start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
    } else if (range === 'custom' && startDate && endDate) {
      start = new Date(startDate + 'T00:00:00');
      end = new Date(endDate + 'T23:59:59.999');
    } else {
      // 'this_month' default
      start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    }

    // Prior period of equal length, immediately before `start`, for trend comparison.
    const spanMs = end.getTime() - start.getTime();
    const prevEnd = new Date(start.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - spanMs);

    return { start, end, prevStart, prevEnd };
  }

  async getLeadsAnalyticsDashboard(companyId: number, query: any = {}) {
    const range = query.range || 'this_month';
    const { start, end, prevStart, prevEnd } = this.resolveDashboardRange(range, query.startDate, query.endDate);

    const WON = 'Converted';
    const LOST = 'Lost';

    const [periodLeads, prevPeriodLeadsCount, openLeads, periodFollowUps] = await Promise.all([
      // Leads created within the selected period — drives the breakdowns, leaderboard, and trend.
      this.prisma.lead.findMany({
        where: { companyId, createdAt: { gte: start, lte: end } },
        select: {
          id: true, status: true, source: true, dealCategory: true, value: true,
          contactName: true, companyName: true, email: true,
          createdAt: true, updatedAt: true, qualificationReason: true,
          assignedToId: true,
          assignedTo: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
          broughtByContact: { select: { id: true, name: true, email: true, companyName: true } },
        },
      }),
      this.prisma.lead.count({ where: { companyId, createdAt: { gte: prevStart, lte: prevEnd } } }),
      // Current pipeline snapshot — not period-bound, since "open pipeline" is a point-in-time figure.
      this.prisma.lead.findMany({
        where: { companyId, status: { notIn: [WON, LOST, 'Junk'] } },
        select: { id: true, value: true, createdAt: true, status: true, companyName: true, title: true, assignedTo: { select: { id: true, firstName: true, lastName: true } } },
      }),
      // Follow-up activity within the period, for the leaderboard's activity column.
      this.prisma.leadFollowUp.findMany({
        where: { companyId, createdAt: { gte: start, lte: end } },
        select: { id: true, assignedToId: true, leadId: true },
      }),
    ]);

    // --- KPI strip ---
    const won = periodLeads.filter(l => l.status === WON);
    const lost = periodLeads.filter(l => l.status === LOST);
    const totalDecided = won.length + lost.length;
    const winRate = totalDecided > 0 ? (won.length / totalDecided) * 100 : 0;
    const totalValueWon = won.reduce((sum, l) => sum + (Number(l.value) || 0), 0);
    const avgDealSize = won.length > 0 ? totalValueWon / won.length : 0;
    const avgSalesCycleDays = won.length > 0
      ? won.reduce((sum, l) => sum + Math.max(0, (new Date(l.updatedAt).getTime() - new Date(l.createdAt).getTime()) / 86400000), 0) / won.length
      : 0;
    const pipelineValue = openLeads.reduce((sum, l) => sum + (Number(l.value) || 0), 0);

    const kpis = {
      totalPipelineValue: pipelineValue,
      openLeadsCount: openLeads.length,
      leadsCreatedThisPeriod: periodLeads.length,
      leadsCreatedPrevPeriod: prevPeriodLeadsCount,
      leadsCreatedTrendPct: prevPeriodLeadsCount > 0
        ? ((periodLeads.length - prevPeriodLeadsCount) / prevPeriodLeadsCount) * 100
        : null,
      winRate,
      avgDealSize,
      avgSalesCycleDays,
      totalValueWon,
    };

    // --- Funnel: leads by stage (period-created leads) ---
    const funnel: Record<string, number> = {};
    for (const l of periodLeads) {
      funnel[l.status] = (funnel[l.status] || 0) + 1;
    }

    // --- Best lead profile: by source & by category ---
    const bucketBy = (key: 'source' | 'dealCategory') => {
      const groups = new Map<string, { label: string; count: number; won: number; lost: number; valueWon: number }>();
      for (const l of periodLeads) {
        const label = (l[key] && String(l[key]).trim()) || 'Unknown';
        if (!groups.has(label)) groups.set(label, { label, count: 0, won: 0, lost: 0, valueWon: 0 });
        const g = groups.get(label)!;
        g.count++;
        if (l.status === WON) { g.won++; g.valueWon += Number(l.value) || 0; }
        if (l.status === LOST) g.lost++;
      }
      return Array.from(groups.values())
        .map(g => ({ ...g, winRate: (g.won + g.lost) > 0 ? (g.won / (g.won + g.lost)) * 100 : 0 }))
        .sort((a, b) => b.valueWon - a.valueWon);
    };
    const bySource = bucketBy('source');
    const byCategory = bucketBy('dealCategory');

    // --- Top lead contacts: lead contact persons with the most / best deals ---
    const contactBucket = new Map<string, { name: string; email: string | null; count: number; won: number; lost: number; valueWon: number }>();
    for (const l of periodLeads) {
      const name = (l.contactName && String(l.contactName).trim()) || 'Unknown';
      if (!contactBucket.has(name)) contactBucket.set(name, { name, email: l.email || null, count: 0, won: 0, lost: 0, valueWon: 0 });
      const g = contactBucket.get(name)!;
      g.count++;
      if (l.status === WON) { g.won++; g.valueWon += Number(l.value) || 0; }
      if (l.status === LOST) g.lost++;
    }
    const topContacts = Array.from(contactBucket.values())
      .map(g => ({
        name: g.name,
        email: g.email,
        leadsOwned: g.count,
        leadsWon: g.won,
        winRate: (g.won + g.lost) > 0 ? (g.won / (g.won + g.lost)) * 100 : 0,
        valueWon: g.valueWon,
        avgDealSize: g.won > 0 ? g.valueWon / g.won : 0,
      }))
      .sort((a, b) => b.valueWon - a.valueWon)
      .slice(0, 8);

    // --- Top companies: which companies have given the most / best deals ---
    const companyBucket = new Map<string, { name: string; count: number; won: number; lost: number; valueWon: number }>();
    for (const l of periodLeads) {
      const name = (l.companyName && String(l.companyName).trim()) || 'Unknown';
      if (!companyBucket.has(name)) companyBucket.set(name, { name, count: 0, won: 0, lost: 0, valueWon: 0 });
      const g = companyBucket.get(name)!;
      g.count++;
      if (l.status === WON) { g.won++; g.valueWon += Number(l.value) || 0; }
      if (l.status === LOST) g.lost++;
    }
    const topCompanies = Array.from(companyBucket.values())
      .map(g => ({
        name: g.name,
        deals: g.count,
        leadsWon: g.won,
        winRate: (g.won + g.lost) > 0 ? (g.won / (g.won + g.lost)) * 100 : 0,
        valueWon: g.valueWon,
        avgDealSize: g.won > 0 ? g.valueWon / g.won : 0,
      }))
      .sort((a, b) => b.valueWon - a.valueWon)
      .slice(0, 8);

    // --- Top performers leaderboard ---
    const followUpCountByRep = new Map<number, number>();
    for (const f of periodFollowUps) {
      if (f.assignedToId) followUpCountByRep.set(f.assignedToId, (followUpCountByRep.get(f.assignedToId) || 0) + 1);
    }
    const repMap = new Map<number, { rep: any; owned: number; won: number; lost: number; valueWon: number }>();
    for (const l of periodLeads) {
      if (!l.assignedToId || !l.assignedTo) continue;
      if (!repMap.has(l.assignedToId)) {
        repMap.set(l.assignedToId, { rep: l.assignedTo, owned: 0, won: 0, lost: 0, valueWon: 0 });
      }
      const r = repMap.get(l.assignedToId)!;
      r.owned++;
      if (l.status === WON) { r.won++; r.valueWon += Number(l.value) || 0; }
      if (l.status === LOST) r.lost++;
    }
    const leaderboard = Array.from(repMap.entries())
      .map(([repId, r]) => ({
        rep: r.rep,
        leadsOwned: r.owned,
        leadsWon: r.won,
        winRate: (r.won + r.lost) > 0 ? (r.won / (r.won + r.lost)) * 100 : 0,
        valueWon: r.valueWon,
        avgDealSize: r.won > 0 ? r.valueWon / r.won : 0,
        followUpsLogged: followUpCountByRep.get(repId) || 0,
      }))
      .sort((a, b) => b.valueWon - a.valueWon);

    // --- Lead aging: open leads stalled for 14+ days ---
    const now = new Date();
    const staleThresholdMs = 14 * 86400000;
    const agingLeads = openLeads
      .filter(l => (now.getTime() - new Date(l.createdAt).getTime()) > staleThresholdMs)
      .map(l => ({
        id: l.id, companyName: l.companyName, title: l.title, status: l.status,
        value: l.value, assignedTo: l.assignedTo,
        daysOpen: Math.floor((now.getTime() - new Date(l.createdAt).getTime()) / 86400000),
      }))
      .sort((a, b) => b.daysOpen - a.daysOpen)
      .slice(0, 15);

    // --- Trend: new leads vs won leads, bucketed weekly across the period ---
    const trend: { weekStart: string; created: number; won: number }[] = [];
    {
      const bucketStart = new Date(start);
      bucketStart.setHours(0, 0, 0, 0);
      while (bucketStart <= end) {
        const bucketEnd = new Date(bucketStart);
        bucketEnd.setDate(bucketEnd.getDate() + 7);
        const created = periodLeads.filter(l => l.createdAt >= bucketStart && l.createdAt < bucketEnd).length;
        const wonInBucket = won.filter(l => l.updatedAt >= bucketStart && l.updatedAt < bucketEnd).length;
        trend.push({ weekStart: bucketStart.toISOString().slice(0, 10), created, won: wonInBucket });
        bucketStart.setDate(bucketStart.getDate() + 7);
      }
    }

    // --- Lost reasons (from qualificationReason, when populated) ---
    const lostReasons = new Map<string, number>();
    for (const l of lost) {
      const reason = (l.qualificationReason && l.qualificationReason.trim()) || 'Not specified';
      lostReasons.set(reason, (lostReasons.get(reason) || 0) + 1);
    }

    return {
      range: { key: range, start, end },
      kpis,
      funnel,
      bySource,
      byCategory,
      topContacts,
      topCompanies,
      leaderboard,
      agingLeads,
      trend,
      lostReasons: Array.from(lostReasons.entries()).map(([reason, count]) => ({ reason, count })),
    };
  }

  async getDashboardSummary(companyId: number) {
    const [byStatus, recentLeads] = await Promise.all([
      this.prisma.lead.groupBy({
        by: ['status'],
        where: { companyId },
        _count: true,
        _sum: { value: true }
      }),
      this.prisma.lead.findMany({
        where: { companyId },
        select: { id: true, companyName: true, contactName: true, status: true, value: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 5
      })
    ]);

    return { byStatus, recentLeads };
  }

  // ═══════════════════════════════════════════
  // FOLLOW-UP OPERATIONS
  // ═══════════════════════════════════════════

  async getFollowUps(companyId: number, leadId: number) {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, companyId } });
    if (!lead) throw new NotFoundException('Lead not found');

    return this.prisma.leadFollowUp.findMany({
      where: { leadId, companyId },
      include: {
        assignedTo: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true, designation: { select: { name: true } } },
        },
        files: { orderBy: { createdAt: 'desc' } },
      },
      orderBy: { scheduledAt: 'desc' },
    });
  }

  async createFollowUp(companyId: number, leadId: number, data: any) {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, companyId } });
    if (!lead) throw new NotFoundException('Lead not found');

    const scheduledAt = data.scheduledAt ? new Date(data.scheduledAt) : new Date();
    // No manual rep picker on creation — default to the lead's own owner.
    const assignedToId = data.assignedToId ? parseInt(data.assignedToId, 10) : (lead.assignedToId || null);

    const followUp = await this.prisma.leadFollowUp.create({
      data: {
        leadId,
        companyId,
        title: data.title || 'Follow-up Call',
        contactPerson: data.contactPerson || lead.contactName || null,
        contactPhone: data.contactPhone || lead.phone || null,
        contactEmail: data.contactEmail || lead.email || null,
        type: data.type || 'CALL',
        scheduledAt,
        notes: data.notes || null,
        status: data.status || 'PENDING',
        assignedToId,
      },
      include: {
        assignedTo: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true, designation: { select: { name: true } } },
        },
        files: { orderBy: { createdAt: 'desc' } },
      },
    });

    await this.logActivity(
      companyId,
      leadId,
      'FOLLOW_UP_CREATED',
      `Follow-up "${followUp.title}" created`,
      lead.addedById,
      { followUpId: followUp.id, scheduledAt: followUp.scheduledAt, title: followUp.title },
    );

    return followUp;
  }

  async updateFollowUp(companyId: number, leadId: number, followUpId: number, data: any) {
    const followUp = await this.prisma.leadFollowUp.findFirst({
      where: { id: followUpId, leadId, companyId },
    });
    if (!followUp) throw new NotFoundException('Follow-up not found');

    const updateData: any = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.contactPerson !== undefined) updateData.contactPerson = data.contactPerson;
    if (data.contactPhone !== undefined) updateData.contactPhone = data.contactPhone;
    if (data.contactEmail !== undefined) updateData.contactEmail = data.contactEmail;
    if (data.type !== undefined) updateData.type = data.type;
    if (data.scheduledAt !== undefined) updateData.scheduledAt = new Date(data.scheduledAt);
    if (data.notes !== undefined) updateData.notes = data.notes;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.assignedToId !== undefined) {
      updateData.assignedToId = data.assignedToId ? parseInt(data.assignedToId, 10) : null;
    }

    const updatedFollowUp = await this.prisma.leadFollowUp.update({
      where: { id: followUpId },
      data: updateData,
      include: {
        assignedTo: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true, designation: { select: { name: true } } },
        },
        files: { orderBy: { createdAt: 'desc' } },
      },
    });

    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, companyId } });
    await this.logActivity(
      companyId,
      leadId,
      'FOLLOW_UP_UPDATED',
      `Follow-up "${updatedFollowUp.title}" updated`,
      lead?.addedById,
      { followUpId, status: data.status, title: updatedFollowUp.title },
    );

    return updatedFollowUp;
  }

  async deleteFollowUp(companyId: number, leadId: number, followUpId: number) {
    const followUp = await this.prisma.leadFollowUp.findFirst({
      where: { id: followUpId, leadId, companyId },
    });
    if (!followUp) throw new NotFoundException('Follow-up not found');

    const deleted = await this.prisma.leadFollowUp.delete({
      where: { id: followUpId },
    });

    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, companyId } });
    await this.logActivity(
      companyId,
      leadId,
      'FOLLOW_UP_DELETED',
      `Follow-up "${deleted.title}" deleted`,
      lead?.addedById,
      { followUpId, title: deleted.title },
    );

    return deleted;
  }
  
  // A user sees a follow-up if they're unrestricted (admin/superadmin or granted
  // VIEW_ALL on crm/leads), the follow-up is assigned to them, or they own/created
  // the lead it belongs to.
  private async buildFollowUpScope(companyId: number, user: { role?: string; employeeId?: number | null }): Promise<any> {
    const isUnrestricted = user.role === 'SUPERADMIN' || user.role === 'ADMIN';
    if (isUnrestricted) return {};

    const canViewAll = await this.permissionsService.hasPermission(
      companyId, user.role || 'EMPLOYEE', 'crm/leads', 'VIEW_ALL',
    );
    if (canViewAll) return {};

    const employeeId = user.employeeId ?? -1;
    return {
      OR: [
        { assignedToId: employeeId },
        { lead: { addedById: employeeId } },
        { lead: { assignedToId: employeeId } },
      ],
    };
  }

  async getFollowUpStats(companyId: number, user: { role?: string; employeeId?: number | null }) {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const scope = await this.buildFollowUpScope(companyId, user);

    const [today, upcoming, past, total, overdue] = await Promise.all([
      this.prisma.leadFollowUp.count({
        where: { companyId, ...scope, scheduledAt: { gte: startOfToday, lte: endOfToday } }
      }),
      this.prisma.leadFollowUp.count({
        where: { companyId, ...scope, scheduledAt: { gt: endOfToday } }
      }),
      this.prisma.leadFollowUp.count({
        where: { companyId, ...scope, scheduledAt: { lt: startOfToday } }
      }),
      this.prisma.leadFollowUp.count({
        where: { companyId, ...scope }
      }),
      this.prisma.leadFollowUp.count({
        where: { companyId, ...scope, scheduledAt: { lt: startOfToday } }
      }),
    ]);

    return { today, upcoming, past, total, overdue };
  }

  async getAllCompanyFollowUps(companyId: number, query: any = {}, user?: { role?: string; employeeId?: number | null }) {
    const scope = user ? await this.buildFollowUpScope(companyId, user) : {};
    const where: any = { companyId, ...scope };

    if (query.assignedToId) {
      where.assignedToId = parseInt(query.assignedToId, 10);
    }
    if (query.dateFilter && query.dateFilter !== 'all') {
      const now = new Date();
      now.setHours(0, 0, 0, 0); // start of today
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const nextWeek = new Date(now);
      nextWeek.setDate(nextWeek.getDate() + 7);

      // 'thisWeek' — Monday of the current week through end of the week (Sunday)
      const weekStart = new Date(now);
      const day = (weekStart.getDay() + 6) % 7; // ISO weekday (Mon=0 ... Sun=6)
      weekStart.setDate(weekStart.getDate() - day);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 7);

      // 'lastMonth' — first day of previous calendar month through its last day
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 1);

      // 'lastQuarter' — previous calendar quarter (inclusive)
      const quarterIndex = Math.floor(now.getMonth() / 3); // 0,1,2,3
      const lastQuarterStart = new Date(now.getFullYear(), (quarterIndex - 1) * 3, 1);
      const lastQuarterEnd = new Date(now.getFullYear(), quarterIndex * 3, 1);

      // 'lastYear' — previous calendar year (inclusive)
      const lastYearStart = new Date(now.getFullYear() - 1, 0, 1);
      const lastYearEnd = new Date(now.getFullYear(), 0, 1);

      if (query.dateFilter === 'today') {
        where.scheduledAt = { gte: now, lt: tomorrow };
      } else if (query.dateFilter === 'thisWeek') {
        where.scheduledAt = { gte: weekStart, lt: weekEnd };
      } else if (query.dateFilter === 'lastMonth') {
        where.scheduledAt = { gte: lastMonthStart, lt: lastMonthEnd };
      } else if (query.dateFilter === 'lastQuarter') {
        where.scheduledAt = { gte: lastQuarterStart, lt: lastQuarterEnd };
      } else if (query.dateFilter === 'lastYear') {
        where.scheduledAt = { gte: lastYearStart, lt: lastYearEnd };
      } else if (query.dateFilter === 'tomorrow') {
        const dayAfter = new Date(tomorrow);
        dayAfter.setDate(dayAfter.getDate() + 1);
        where.scheduledAt = { gte: tomorrow, lt: dayAfter };
      } else if (query.dateFilter === 'upcoming') {
        where.scheduledAt = { gte: now, lt: nextWeek };
      } else if (query.dateFilter === 'past' || query.dateFilter === 'overdue') {
        where.scheduledAt = { lt: now };
      } else if (query.dateFilter === 'custom' && (query.startDate || query.endDate)) {
        const range: any = {};
        if (query.startDate) {
          const start = new Date(query.startDate);
          start.setHours(0, 0, 0, 0);
          range.gte = start;
        }
        if (query.endDate) {
          const end = new Date(query.endDate);
          end.setHours(23, 59, 59, 999);
          range.lte = end;
        }
        where.scheduledAt = range;
      }
    }

    return this.prisma.leadFollowUp.findMany({
      where,
      orderBy: { scheduledAt: 'asc' },
      include: {
        lead: {
          include: {
            assignedTo: {
              select: { id: true, firstName: true, lastName: true, avatarUrl: true, designation: { select: { name: true } } },
            },
            addedBy: {
              select: { id: true, firstName: true, lastName: true, avatarUrl: true, designation: { select: { name: true } } },
            },
            broughtByContact: true,
            followUps: {
              orderBy: { scheduledAt: 'desc' },
              include: {
                assignedTo: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, designation: { select: { name: true } } } }
              }
            }
          }
        },
        assignedTo: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true, designation: { select: { name: true } } }
        }
      }
    });
  }

  // ═══════════════════════════════════════════
  // LEAD CONTACT OPERATIONS
  // ═══════════════════════════════════════════

  /**
   * Scoped the same way as getLeads: a sales rep sees only the contacts they
   * added, while SUPERADMIN/ADMIN and anyone with VIEW_ALL see everything.
   * LeadContact has no assignee, so ownership is `addedById` alone.
   */
  async getLeadContacts(companyId: number, user?: { role?: string; employeeId?: number | null }) {
    const where: any = { companyId };

    // No user means an internal caller (e.g. the public lead form) — unscoped.
    if (user) {
      const isUnrestricted = user.role === 'SUPERADMIN' || user.role === 'ADMIN';
      if (!isUnrestricted) {
        const canViewAll = await this.permissionsService.hasPermission(
          companyId, user.role || 'EMPLOYEE', 'crm/leads', 'VIEW_ALL',
        );
        if (!canViewAll) where.addedById = user.employeeId ?? -1;
      }
    }

    return this.prisma.leadContact.findMany({
      where,
      include: {
        addedBy: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true, designation: { select: { name: true } }, department: { select: { name: true } } },
        },
        _count: {
          select: { leadsBrought: true }
        }
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getLeadContactById(companyId: number, id: number) {
    const contact = await this.prisma.leadContact.findFirst({
      where: { id, companyId },
      include: {
        addedBy: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true, designation: { select: { name: true } }, department: { select: { name: true } } },
        },
        leadsBrought: {
          orderBy: { createdAt: 'desc' },
          include: {
            assignedTo: {
              select: { id: true, firstName: true, lastName: true, avatarUrl: true, designation: { select: { name: true } }, department: { select: { name: true } } },
            },
            addedBy: {
              select: { id: true, firstName: true, lastName: true, avatarUrl: true, designation: { select: { name: true } }, department: { select: { name: true } } },
            },
            followUps: {
              orderBy: { scheduledAt: 'desc' },
              include: {
                assignedTo: {
                  select: { id: true, firstName: true, lastName: true, avatarUrl: true, designation: { select: { name: true } } },
                },
              },
            },
          },
        },
        _count: { select: { leadsBrought: true } },
      },
    });
    if (!contact) throw new NotFoundException('Lead Contact not found');
    return contact;
  }

  /**
   * Mirror of frontend/src/app/shared/constants/contact-validation.ts. Keep the
   * two in step.
   *
   * Format only — presence is not checked here. A lead created without an email
   * can still spawn its contact (leads.ts does exactly that), and 12 contacts
   * predating this rule have no address at all; refusing them at the API would
   * make those records uneditable. The form is where "email is required" is
   * enforced, in front of the person who can actually supply one.
   *
   * Blank is accepted and stored as null. Anything non-blank has to be real:
   * a half-typed number looks dialable right up until someone tries it.
   */
  private assertContactFormats(data: any) {
    const email = String(data?.email ?? '').trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(email)) {
      throw new BadRequestException(`"${email}" is not a valid email address.`);
    }

    const phones: [string, string][] = [
      ['phone', 'Phone'],
      ['mobile', 'Primary phone number'],
      ['officePhoneNumber', 'Secondary phone number'],
    ];
    for (const [field, label] of phones) {
      const raw = String(data?.[field] ?? '').trim();
      if (!raw) continue;
      const digits = raw.replace(/\D/g, '');
      if (!/^\+?[0-9\s\-().]{6,25}$/.test(raw) || digits.length < 10 || digits.length > 15) {
        throw new BadRequestException(`${label} must be 10 to 15 digits. Spaces, dashes and a country code are fine.`);
      }
    }
  }

  async createLeadContact(companyId: number, userId: number | null, data: any) {
    this.assertContactFormats(data);

    let addedById: number | null = data.addedById || null;
    // Public form submissions have no signed-in user. Without this guard the
    // lookup would run with userId undefined and attach an arbitrary employee.
    if (!addedById && userId) {
      const employee = await this.prisma.employee.findFirst({ where: { userId, companyId } });
      addedById = employee?.id || null;
    }

    const created = await this.withEntityCode('CONTACT', companyId, (contactCode) =>
      this.prisma.leadContact.create({
      data: {
        companyId,
        contactCode,
        salutation: data.salutation || null,
        name: data.name,
        email: data.email || null,
        phone: data.phone || null,
        leadSource: data.leadSource || null,
        companyName: data.companyName || null,
        website: data.website || null,
        mobile: data.mobile || null,
        officePhoneNumber: data.officePhoneNumber || null,
        country: data.country || null,
        state: data.state || null,
        city: data.city || null,
        postalCode: data.postalCode || null,
        address: data.address || null,
        addedById,
      },
      include: {
        addedBy: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true, designation: { select: { name: true } }, department: { select: { name: true } } },
        },
        _count: {
          select: { leadsBrought: true }
        }
      },
      }),
    );

    // Attach any existing deals already carrying this contact's identity so
    // the table/Kanban and the contact profile stay in sync (covers CSV import).
    await this.linkLeadsToContact(companyId, created);
    return created;
  }

  async importLeadContacts(companyId: number, userId: number, contacts: any[], addedById: number | null) {
    if (!Array.isArray(contacts) || contacts.length === 0) {
      throw new BadRequestException('A non-empty contacts array is required.');
    }
    const created: any[] = [];
    let skipped = 0;
    for (const raw of contacts) {
      const name = raw && raw.name ? String(raw.name).trim() : '';
      if (!name) { skipped++; continue; }
      created.push(await this.createLeadContact(companyId, userId, { ...raw, name, addedById }));
    }
    return { created: created.length, skipped, total: created.length + skipped };
  }

  async updateLeadContact(companyId: number, id: number, data: any) {
    const contact = await this.prisma.leadContact.findFirst({ where: { id, companyId } });
    if (!contact) throw new NotFoundException('Lead Contact not found');

    this.assertContactFormats(data);

    const updateData: any = {};
    if (data.salutation !== undefined) updateData.salutation = data.salutation;
    if (data.name !== undefined) updateData.name = data.name;
    if (data.email !== undefined) updateData.email = data.email;
    if (data.phone !== undefined) updateData.phone = data.phone;
    if (data.leadSource !== undefined) updateData.leadSource = data.leadSource;
    if (data.companyName !== undefined) updateData.companyName = data.companyName;
    if (data.website !== undefined) updateData.website = data.website;
    if (data.mobile !== undefined) updateData.mobile = data.mobile;
    if (data.officePhoneNumber !== undefined) updateData.officePhoneNumber = data.officePhoneNumber;
    if (data.country !== undefined) updateData.country = data.country;
    if (data.state !== undefined) updateData.state = data.state;
    if (data.city !== undefined) updateData.city = data.city;
    if (data.postalCode !== undefined) updateData.postalCode = data.postalCode;
    if (data.address !== undefined) updateData.address = data.address;
    if (data.addedById !== undefined) {
      updateData.addedById = data.addedById ? parseInt(data.addedById, 10) : null;
    }

    const updated = await this.prisma.leadContact.update({
      where: { id },
      data: updateData,
      include: {
        addedBy: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true, designation: { select: { name: true } }, department: { select: { name: true } } },
        },
        _count: {
          select: { leadsBrought: true }
        }
      },
    });

    // A linked LeadContact is the source of truth for the contact fields on
    // every deal it brought in. Keep Kanban, table and contact-profile views
    // consistent when its profile is edited.
    await this.prisma.lead.updateMany({
      where: { companyId, broughtByContactId: id },
      data: {
        contactName: updated.name,
        companyName: updated.companyName,
        email: updated.email,
        phone: updated.phone || updated.mobile,
        website: updated.website,
        address: updated.address,
      },
    });

    // Also pick up deals that match under the contact's (possibly new)
    // identity but were never linked, so both views stay in sync.
    await this.linkLeadsToContact(companyId, updated);
    return updated;
  }

  async deleteLeadContact(companyId: number, id: number) {
    const contact = await this.prisma.leadContact.findFirst({ where: { id, companyId } });
    if (!contact) throw new NotFoundException('Lead Contact not found');

    return this.prisma.leadContact.delete({
      where: { id },
    });
  }

  /**
   * One-time admin backfill: links every deal that matches an existing
   * Lead Contact by identity but has not been attached yet. Non-destructive —
   * only writes `broughtByContactId`, never removes or edits deal data.
   */
  async syncLeadContactLinks(companyId: number) {
    const contacts = await this.prisma.leadContact.findMany({
      where: { companyId },
      select: { id: true, name: true, email: true, phone: true, mobile: true, companyName: true },
    });

    let matched = 0;
    for (const contact of contacts) {
      matched += await this.linkLeadsToContact(companyId, contact);
    }

    return {
      contacts: contacts.length,
      dealsLinked: matched,
      message: matched
        ? `${matched} deal${matched === 1 ? '' : 's'} linked to their lead contact${matched === 1 ? '' : 's'}.`
        : 'All deals are already linked to their lead contacts.',
    };
  }

  /**
   * Minimal lead-contact list for pickers (the project form's Client field).
   *
   * Separate from getLeadContacts because that one scopes a non-admin without
   * VIEW_ALL to contacts they personally added — right for the CRM board,
   * wrong for a dropdown, where it would show a project manager an empty list
   * and no way to say who the work is for. This returns identity only: no
   * owner, no note counts, nothing a CRM permission is protecting. It mirrors
   * employees/basic-list, which exists for the same reason.
   */
  async getLeadContactOptions(companyId: number) {
    return this.prisma.leadContact.findMany({
      where: { companyId },
      select: { id: true, name: true, companyName: true, email: true, contactCode: true },
      orderBy: [{ companyName: 'asc' }, { name: 'asc' }],
    });
  }

  /**
   * The Client a lead contact corresponds to, creating one if there isn't one.
   *
   * Used when a project is saved against a lead contact (§4, "lead contacts —
   * add as clients"). Project.clientId still points at Client, so every client
   * filter, column and future invoice keeps working; this is what turns the
   * chosen contact into that row.
   *
   * Unlike convertLeadContactToClient, an existing client of the same name is
   * returned rather than rejected. Picking the same contact for a second
   * project is an ordinary thing to do, and it must attach to the client that
   * already exists instead of failing or creating a duplicate.
   */
  async findOrCreateClientFromLeadContact(companyId: number, id: number) {
    const contact = await this.prisma.leadContact.findFirst({ where: { id, companyId } });
    if (!contact) throw new NotFoundException('Lead Contact not found');

    const clientName = (contact.companyName || contact.name || '').trim();
    if (!clientName) {
      throw new BadRequestException('That contact has no company or name to use as a client.');
    }

    const existing = await this.prisma.client.findFirst({ where: { companyId, name: clientName } });
    if (existing) return existing;

    return this.prisma.client.create({ data: this.clientDataFromLeadContact(companyId, contact) });
  }

  /**
   * The lead-contact → client field mapping, in one place so the CRM's
   * explicit Convert button and the project form's implicit one cannot drift
   * into producing different clients from the same contact.
   */
  private clientDataFromLeadContact(companyId: number, contact: any) {
    const clientName = (contact.companyName || contact.name || '').trim();
    return {
      companyId,
      name: clientName,
      website: contact.website || null,
      status: 'LEAD',
      currency: 'INR',
      billingAddressLine1: contact.address || null,
      billingCity: contact.city || null,
      billingState: contact.state || null,
      billingZipCode: contact.postalCode || null,
      billingCountry: contact.country || null,
      contacts: contact.email ? {
        create: [{
          firstName: (contact.name || '').split(' ')[0] || 'Unknown',
          lastName: (contact.name || '').split(' ').slice(1).join(' ') || null,
          email: contact.email,
          phone: contact.phone || null,
          mobile: contact.mobile || null,
          isPrimary: true,
        }],
      } : undefined,
    };
  }

  async convertLeadContactToClient(companyId: number, id: number) {
    const contact = await this.prisma.leadContact.findFirst({ where: { id, companyId } });
    if (!contact) throw new NotFoundException('Lead Contact not found');

    const clientName = (contact.companyName || contact.name || '').trim();
    if (!clientName) throw new BadRequestException('Cannot convert: contact has no company or name.');

    const existing = await this.prisma.client.findFirst({
      where: { companyId, name: clientName },
    });
    // Still a conflict here, deliberately: the CRM's Convert button is an
    // explicit "make this a client", and silently handing back one that
    // already exists would look like it had done nothing.
    if (existing) {
      throw new ConflictException(
        `A client named "${clientName}" already exists.`,
      );
    }

    return this.prisma.client.create({
      data: {
        companyId,
        name: clientName,
        website: contact.website || null,
        status: 'LEAD',
        currency: 'INR',
        billingAddressLine1: contact.address || null,
        billingCity: contact.city || null,
        billingState: contact.state || null,
        billingZipCode: contact.postalCode || null,
        billingCountry: contact.country || null,
        contacts: contact.email ? {
          create: [{
            firstName: (contact.name || '').split(' ')[0] || 'Unknown',
            lastName: (contact.name || '').split(' ').slice(1).join(' ') || null,
            email: contact.email,
            phone: contact.phone || null,
            mobile: contact.mobile || null,
            isPrimary: true,
          }],
        } : undefined,
      },
      include: {
        contacts: true,
      },
    });
  }

  // ═══════════════════════════════════════════
  // LEAD CONTACT NOTES
  // ═══════════════════════════════════════════

  private leadContactNoteInclude = {
    createdBy: {
      select: { id: true, firstName: true, lastName: true, avatarUrl: true, designation: { select: { name: true } } },
    },
  } as const;

  async getLeadContactNotes(companyId: number, contactId: number) {
    const contact = await this.prisma.leadContact.findFirst({ where: { id: contactId, companyId } });
    if (!contact) throw new NotFoundException('Lead Contact not found');

    return this.prisma.leadContactNote.findMany({
      where: { contactId, companyId },
      include: this.leadContactNoteInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  async createLeadContactNote(companyId: number, contactId: number, data: any, creatorEmployeeId?: number | null) {
    const contact = await this.prisma.leadContact.findFirst({ where: { id: contactId, companyId } });
    if (!contact) throw new NotFoundException('Lead Contact not found');
    if (!data.title || !data.title.trim()) throw new BadRequestException('Note title is required');

    return this.prisma.leadContactNote.create({
      data: {
        contactId,
        companyId,
        title: data.title,
        type: data.type || 'GENERAL',
        content: data.content || '',
        createdById: creatorEmployeeId || null,
      },
      include: this.leadContactNoteInclude,
    });
  }

  async updateLeadContactNote(companyId: number, contactId: number, noteId: number, data: any) {
    const note = await this.prisma.leadContactNote.findFirst({ where: { id: noteId, contactId, companyId } });
    if (!note) throw new NotFoundException('Note not found');
    if (data.title !== undefined && !data.title.trim()) throw new BadRequestException('Note title is required');

    return this.prisma.leadContactNote.update({
      where: { id: noteId },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.type !== undefined ? { type: data.type } : {}),
        ...(data.content !== undefined ? { content: data.content } : {}),
      },
      include: this.leadContactNoteInclude,
    });
  }

  async deleteLeadContactNote(companyId: number, contactId: number, noteId: number) {
    const note = await this.prisma.leadContactNote.findFirst({ where: { id: noteId, contactId, companyId } });
    if (!note) throw new NotFoundException('Note not found');

    return this.prisma.leadContactNote.delete({ where: { id: noteId } });
  }

  // ═══════════════════════════════════════════
  // PRE-SALES ENGAGEMENT
  // ═══════════════════════════════════════════
  // Sales person requests a pre-sales person (hours / on-demand) → admin
  // approves/rejects with remarks → an approved member with hours joins the
  // deal. Tasks are assigned on an hourly basis and the pre-sales person uploads
  // the minutes of meeting (MoM) into the task when done.
  // ═══════════════════════════════════════════

  private presalesEmployeeSelect = {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      avatarUrl: true,
      designation: { select: { name: true } },
      department: { select: { name: true } },
    },
  } as const;

  // ══════════════════════════════════════════════════════════════════════════
  // PRE-SALES
  //
  // An admin puts employees on a deal; whoever put them there (or an admin)
  // raises tasks for them; each task walks NEW → WORKING → ON_HOLD → COMPLETED
  // leaving an append-only trail.
  //
  // Two rules here are security, not presentation, and are enforced on every
  // path rather than in the UI:
  //
  //   1. Membership is what lets a pre-sales employee see the deal at all.
  //   2. A pre-sales employee sees the deal WITHOUT its money. The masking
  //      happens before the row leaves this service — hiding the field in a
  //      template would still ship it over the wire to anyone with devtools.
  // ══════════════════════════════════════════════════════════════════════════

  /** Roles that may add members directly and approve requests. */
  private isPreSalesAdmin(role?: string): boolean {
    return role === 'SUPERADMIN' || role === 'ADMIN';
  }

  /**
   * Commercial fields a pre-sales employee must never receive.
   *
   * Listed here rather than picked at each call site so that a new money field
   * on Lead has exactly one place to be added.
   */
  private static readonly LEAD_FINANCIAL_FIELDS = [
    'value', 'currency', 'expectedRevenue', 'budget', 'margin',
  ] as const;

  /**
   * Strip the money out of a lead.
   *
   * `quotations` goes too: a quotation carries subtotal, tax and total, so
   * leaving the relation in place would hand back the deal value by another
   * route — the kind of gap that makes field-level masking look done when it
   * is not.
   */
  private maskLeadFinancials<T extends Record<string, any>>(lead: T): T {
    const masked: any = { ...lead };
    for (const field of CrmService.LEAD_FINANCIAL_FIELDS) delete masked[field];
    delete masked.quotations;
    masked.financialsHidden = true;
    return masked;
  }

  /**
   * Everything a caller is allowed to do with one lead's pre-sales, resolved
   * once from the database.
   *
   * Nothing here reads a role or an id from the request body — only from the
   * authenticated user and the stored rows.
   */
  private async resolvePreSalesAccess(
    companyId: number,
    leadId: number,
    user: { role?: string; employeeId?: number | null },
  ) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, companyId },
      include: {
        preSalesMembers: {
          include: { employee: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
        },
      },
    });
    if (!lead) throw new NotFoundException('Lead not found');

    const employeeId = user.employeeId ?? null;
    const admin = this.isPreSalesAdmin(user.role);
    const isCreator = !!employeeId && lead.addedById === employeeId;
    const isOwner = !!employeeId && lead.assignedToId === employeeId;
    const membership = employeeId
      ? lead.preSalesMembers.find((m) => m.employeeId === employeeId && m.status === 'ACTIVE') ?? null
      : null;

    if (!admin && !isCreator && !isOwner && !membership) {
      const canViewAll = await this.permissionsService.hasPermission(
        companyId, user.role || 'EMPLOYEE', 'crm/leads', 'VIEW_ALL',
      );
      if (!canViewAll) throw new NotFoundException('Lead not found');
    }

    return {
      lead,
      admin,
      isCreator,
      isOwner,
      membership,
      /** Only an admin adds or removes members without approval. */
      canManageMembers: admin,
      /** A non-admin with a stake in the deal asks instead. */
      canRequestMembers: !admin && (isCreator || isOwner),
      /**
       * Seeing the deal only because you are on its pre-sales team means seeing
       * it without its money.
       */
      financialsHidden: !admin && !isCreator && !isOwner && !!membership,
    };
  }

  /** May this caller raise tasks for this member? Admin, or whoever added them. */
  private canCreateTaskFor(
    member: { assignedById: number | null },
    access: { admin: boolean },
    employeeId: number | null,
  ): boolean {
    return access.admin || (!!employeeId && member.assignedById === employeeId);
  }

  /** The whole pre-sales picture for one lead, shaped by who is asking. */
  async getPreSalesInfo(
    companyId: number,
    leadId: number,
    user: { role?: string; employeeId?: number | null },
  ) {
    const access = await this.resolvePreSalesAccess(companyId, leadId, user);
    const employeeId = user.employeeId ?? null;

    const employeeSelect = {
      select: { id: true, firstName: true, lastName: true, avatarUrl: true, designation: { select: { name: true } } },
    };

    const [members, requests, tasks] = await Promise.all([
      this.prisma.preSalesTeamMember.findMany({
        where: { companyId, leadId },
        include: { employee: employeeSelect, assignedBy: employeeSelect },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.preSalesRequest.findMany({
        where: { companyId, leadId },
        include: {
          items: { include: { employee: employeeSelect } },
          requestedBy: employeeSelect,
          approvedBy: employeeSelect,
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.preSalesTask.findMany({
        where: {
          companyId,
          leadId,
          // A pre-sales employee sees their own tasks; everyone else with
          // access to the lead sees all of them.
          ...(access.financialsHidden && employeeId ? { assignedToId: employeeId } : {}),
        },
        include: {
          assignedTo: employeeSelect,
          assignedBy: employeeSelect,
          attachments: true,
          _count: { select: { history: true } },
        },
        orderBy: [{ scheduledAt: 'asc' }, { id: 'desc' }],
      }),
    ]);

    const lead: any = access.financialsHidden
      ? this.maskLeadFinancials(access.lead)
      : access.lead;

    // Each member's budget, computed from their tasks rather than stored — a
    // stored counter would drift the first time a task was edited or deleted.
    const usageByEmployee = new Map<number, { used: number }>();
    for (const t of tasks) {
      const row = usageByEmployee.get(t.assignedToId) ?? { used: 0 };
      row.used += t.estimatedMinutes || 0;
      usageByEmployee.set(t.assignedToId, row);
    }

    const membersWithUsage = members.map((m) => {
      const allocatedMinutes = m.hours != null ? Math.round(m.hours * 60) : null;
      const usedMinutes = usageByEmployee.get(m.employeeId)?.used ?? 0;
      return {
        ...m,
        allocatedMinutes,
        usedMinutes,
        remainingMinutes: allocatedMinutes === null ? null : allocatedMinutes - usedMinutes,
        capped: allocatedMinutes !== null,
      };
    });

    return {
      lead: {
        id: lead.id, title: lead.title, companyName: lead.companyName,
        contactName: lead.contactName, status: lead.status,
        ...(access.financialsHidden ? { financialsHidden: true } : { value: lead.value, currency: lead.currency }),
      },
      members: membersWithUsage,
      // A pre-sales member has no business reading the debate about who else
      // should join the deal.
      requests: access.financialsHidden ? [] : requests,
      tasks: tasks.map((t) => ({ ...t, canChangeStatus: !!employeeId && t.assignedToId === employeeId })),
      permissions: {
        canAddMembers: access.canManageMembers,
        canRequestMembers: access.canRequestMembers,
        canCreateTasks: access.admin || members.some((m) => this.canCreateTaskFor(m, access, employeeId)),
        financialsHidden: access.financialsHidden,
      },
    };
  }

  /**
   * Admin only, and the one path that puts someone on a deal without approval.
   *
   * Re-adding a previously removed member reactivates their row rather than
   * inserting a second one — the unique constraint on (leadId, employeeId) is
   * what actually prevents duplicate active assignments.
   */
  async addPreSalesMembers(
    companyId: number,
    leadId: number,
    user: { role?: string; employeeId?: number | null },
    data: { employeeIds?: any; members?: any[]; remark?: string },
  ) {
    const access = await this.resolvePreSalesAccess(companyId, leadId, user);
    if (!access.canManageMembers) {
      throw new ForbiddenException('Only an administrator can add pre-sales members directly. Raise a request instead.');
    }

    const membersData = data.members || (Array.isArray(data.employeeIds) ? data.employeeIds.map(id => ({ employeeId: id })) : []);
    const ids = [...new Set(membersData.map((m: any) => Number(m.employeeId)).filter((v: number) => Number.isFinite(v)))];
    
    if (!ids.length) throw new BadRequestException('Select at least one employee.');

    const employees = await this.prisma.employee.findMany({
      where: { id: { in: ids }, companyId },
      select: { id: true, firstName: true, lastName: true },
    });
    if (employees.length !== ids.length) {
      throw new BadRequestException('One or more selected employees do not belong to this company.');
    }

    const remark = (data?.remark || '').trim() || null;
    const added: number[] = [];
    for (const m of membersData) {
      const id = Number(m.employeeId);
      if (!ids.includes(id)) continue;
      
      const technology = (m.technology || '').trim() || null;
      const engagementType = m.engagementType === 'ONSITE' ? 'ONSITE' : 'VIRTUAL';
      const location = (m.location || '').trim() || null;
      const hours = m.hours ? Number(m.hours) : null;

      const row = await this.prisma.preSalesTeamMember.upsert({
        where: { leadId_employeeId: { leadId, employeeId: id } },
        create: { companyId, leadId, employeeId: id, assignedById: user.employeeId ?? null, remark, status: 'ACTIVE', technology, engagementType, location, hours },
        update: { status: 'ACTIVE', removedAt: null, assignedById: user.employeeId ?? null, remark, technology, engagementType, location, hours },
      });
      added.push(row.employeeId);
    }

    await this.notifyPreSalesAssigned(companyId, access.lead, added, user.employeeId ?? null);
    await this.logActivity(
      companyId, leadId, 'PRE_SALES_ADDED',
      `Added ${employees.map((e) => `${e.firstName} ${e.lastName}`.trim()).join(', ')} to pre-sales`,
      user.employeeId ?? null,
    );

    return this.getPreSalesInfo(companyId, leadId, user);
  }

  /** Admin only. Keeps the row so the history of who worked the deal survives. */
  async removePreSalesMember(
    companyId: number,
    leadId: number,
    memberId: number,
    user: { role?: string; employeeId?: number | null },
  ) {
    const access = await this.resolvePreSalesAccess(companyId, leadId, user);
    if (!access.canManageMembers) {
      throw new ForbiddenException('Only an administrator can remove pre-sales members.');
    }

    const member = await this.prisma.preSalesTeamMember.findFirst({ where: { id: memberId, companyId, leadId } });
    if (!member) throw new NotFoundException('Pre-sales member not found');

    await this.prisma.preSalesTeamMember.update({
      where: { id: memberId },
      data: { status: 'REMOVED', removedAt: new Date() },
    });

    return this.getPreSalesInfo(companyId, leadId, user);
  }

  private async notifyPreSalesAssigned(
    companyId: number,
    lead: { id: number; title: string | null; companyName: string | null },
    employeeIds: number[],
    actorEmployeeId: number | null,
  ) {
    const name = lead.companyName || lead.title || 'a deal';
    await this.notificationsService.notifyEmployees(employeeIds, {
      companyId,
      excludeEmployeeId: actorEmployeeId,
      title: 'Added to pre-sales',
      message: `You have been added as a Pre-Sales member for Lead ${name}.`,
      type: 'INFO',
      linkUrl: `/crm/leads/${lead.id}`,
    });
  }

  // ── requests ───────────────────────────────────────────────────────────────

  /**
   * A non-admin asks for someone to be put on the deal.
   *
   * The employee is not added here. Nothing about the team changes until an
   * administrator approves.
   */
  private static readonly ENGAGEMENT_TYPES = ['ONSITE', 'VIRTUAL'];

  /**
   * Normalise and validate one requested person's terms.
   *
   * Hours are the thing most likely to arrive as "8 hrs" or "" from a form, so
   * they are parsed rather than trusted; a non-numeric value is rejected instead
   * of being silently stored as NaN.
   */
  private normalisePreSalesItem(raw: any, opts: { requireDetails?: boolean } = {}) {
    const employeeId = Number(raw?.employeeId);
    if (!Number.isFinite(employeeId)) throw new BadRequestException('Select an employee.');

    const engagementType = String(raw?.engagementType || 'VIRTUAL').toUpperCase();
    if (!CrmService.ENGAGEMENT_TYPES.includes(engagementType)) {
      throw new BadRequestException('Engagement type must be ONSITE or VIRTUAL.');
    }

    let hours: number | null = null;
    if (raw?.hours !== undefined && raw?.hours !== null && String(raw.hours).trim() !== '') {
      hours = Number(raw.hours);
      if (!Number.isFinite(hours) || hours <= 0) {
        throw new BadRequestException('Hours must be a number greater than zero.');
      }
    }

    const technology = String(raw?.technology || '').trim() || null;
    const location = String(raw?.location || '').trim() || null;

    // Hours are a budget once the person is on the deal — tasks are measured
    // against them — so a request that omits them is asking for an open-ended
    // commitment. Technology is what the admin is actually approving.
    if (opts.requireDetails) {
      if (!technology) throw new BadRequestException('Say what technology each person is needed for.');
      if (hours === null) throw new BadRequestException('Give the hours needed for each person.');
      if (engagementType === 'ONSITE' && !location) throw new BadRequestException('Give a location for onsite engagement.');
    }

    return { employeeId, technology, engagementType, location, hours };
  }

  // ── hours budget ───────────────────────────────────────────────────────────
  //
  // A member is engaged for a number of hours and the tasks raised for them are
  // measured against it. A member with NULL hours is UNCAPPED, not capped at
  // zero: members who predate this must stay assignable.

  /** Allocated, used and remaining minutes for one member on one deal. */
  private async memberHoursUsage(companyId: number, leadId: number, employeeId: number) {
    const [member, tasks] = await Promise.all([
      this.prisma.preSalesTeamMember.findFirst({
        where: { companyId, leadId, employeeId, status: 'ACTIVE' },
        select: { hours: true },
      }),
      this.prisma.preSalesTask.findMany({
        where: { companyId, leadId, assignedToId: employeeId },
        select: { id: true, estimatedMinutes: true },
      }),
    ]);

    const allocatedMinutes = member?.hours != null ? Math.round(member.hours * 60) : null;
    const usedMinutes = tasks.reduce((sum, t) => sum + (t.estimatedMinutes || 0), 0);

    return {
      allocatedMinutes,
      usedMinutes,
      remainingMinutes: allocatedMinutes === null ? null : allocatedMinutes - usedMinutes,
      capped: allocatedMinutes !== null,
    };
  }

  private static formatMinutes(minutes: number): string {
    const h = Math.floor(Math.abs(minutes) / 60);
    const m = Math.abs(minutes) % 60;
    return [h ? `${h}h` : '', m ? `${m}m` : ''].filter(Boolean).join(' ') || '0m';
  }

  /**
   * A non-admin asks for one or more people to be put on the deal.
   *
   * Nobody is added here. Nothing about the team changes until an administrator
   * approves — and they may approve a different set than was asked for.
   */
  async createPreSalesRequest(
    companyId: number,
    leadId: number,
    user: { role?: string; employeeId?: number | null; sub?: number },
    data: { items?: any[]; reason?: string },
  ) {
    const access = await this.resolvePreSalesAccess(companyId, leadId, user);
    if (access.admin) {
      throw new BadRequestException('An administrator can add pre-sales members directly — no request is needed.');
    }
    if (!access.canRequestMembers) {
      throw new ForbiddenException('Only the person who created this deal, or its owner, can request pre-sales support.');
    }

    const reason = (data?.reason || '').trim();
    if (!reason) throw new BadRequestException('Give a reason — an administrator has to approve this without knowing the deal.');

    const raw = Array.isArray(data?.items) ? data.items : [];
    if (!raw.length) throw new BadRequestException('Add at least one person to the request.');

    const items = raw.map((r) => this.normalisePreSalesItem(r, { requireDetails: true }));
    const unique = new Set(items.map((i) => i.employeeId));
    if (unique.size !== items.length) {
      throw new BadRequestException('The same person appears twice on this request.');
    }

    const employees = await this.prisma.employee.findMany({
      where: { id: { in: [...unique] }, companyId },
      select: { id: true, firstName: true, lastName: true },
    });
    if (employees.length !== unique.size) {
      throw new BadRequestException('One or more selected employees do not belong to this company.');
    }

    const alreadyOn = await this.prisma.preSalesTeamMember.findMany({
      where: { leadId, employeeId: { in: [...unique] }, status: 'ACTIVE' },
      select: { employeeId: true },
    });
    if (alreadyOn.length) {
      const names = employees
        .filter((e) => alreadyOn.some((a) => a.employeeId === e.id))
        .map((e) => `${e.firstName} ${e.lastName}`.trim());
      throw new BadRequestException(`${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} already on this deal's pre-sales team.`);
    }

    const pending = await this.prisma.preSalesRequestItem.findMany({
      where: { employeeId: { in: [...unique] }, request: { leadId, status: 'PENDING' } },
      select: { employeeId: true },
    });
    if (pending.length) {
      throw new BadRequestException('A request for one or more of those people is already awaiting approval.');
    }

    const request = await this.prisma.preSalesRequest.create({
      data: {
        companyId, leadId, requestedById: user.employeeId ?? 0, reason, status: 'PENDING',
        items: { create: items.map((i) => ({ companyId, ...i, status: 'REQUESTED' })) },
      },
      include: { items: { include: { employee: { select: { id: true, firstName: true, lastName: true } } } } },
    });

    const who = employees.map((e) => `${e.firstName} ${e.lastName}`.trim()).join(', ');
    const leadName = access.lead.companyName || access.lead.title || 'a deal';
    await this.notificationsService.notifyApprovers({
      companyId,
      roles: ['SUPERADMIN', 'ADMIN'],
      excludeUserId: user.sub ?? null,
      title: 'Pre-sales request',
      message: `A request to add ${who} as Pre-Sales for Lead ${leadName} is awaiting approval.`,
      type: 'ACTION_REQUIRED',
      linkUrl: `/crm/leads/${leadId}`,
    });

    return request;
  }

  /**
   * Ask for more of an existing member's time.
   *
   * Deliberately the same request model as asking for a person: it is the same
   * decision by the same approver, and giving it its own table would mean two
   * queues, two notification paths and two places to get the permissions wrong.
   * The type tells approve() which of the two it is settling.
   */
  async createPreSalesHoursRequest(
    companyId: number,
    leadId: number,
    user: { role?: string; employeeId?: number | null; sub?: number },
    data: { employeeId?: any; hours?: any; reason?: string },
  ) {
    const access = await this.resolvePreSalesAccess(companyId, leadId, user);
    if (!access.admin && !access.canRequestMembers) {
      throw new ForbiddenException('Only the person who created this deal, or its owner, can request more hours.');
    }

    const employeeId = Number(data?.employeeId);
    if (!Number.isFinite(employeeId)) throw new BadRequestException('Select the person who needs more time.');

    const hours = Number(data?.hours);
    if (!Number.isFinite(hours) || hours <= 0) {
      throw new BadRequestException('Enter how many additional hours are needed.');
    }

    const reason = (data?.reason || '').trim();
    if (!reason) throw new BadRequestException('Say why the extra time is needed.');

    const member = await this.prisma.preSalesTeamMember.findFirst({
      where: { companyId, leadId, employeeId, status: 'ACTIVE' },
      include: { employee: { select: { firstName: true, lastName: true } } },
    });
    if (!member) throw new BadRequestException('That person is not on this deal\'s pre-sales team.');

    const pending = await this.prisma.preSalesRequestItem.findFirst({
      where: { employeeId, request: { leadId, status: 'PENDING', type: 'ADDITIONAL_HOURS' } },
    });
    if (pending) throw new BadRequestException('A request for more of their time is already awaiting approval.');

    // An admin asking is an admin deciding; there is nobody above them to ask.
    if (access.admin) {
      const updated = await this.prisma.preSalesTeamMember.update({
        where: { id: member.id },
        data: { hours: (member.hours ?? 0) + hours },
      });
      await this.logActivity(
        companyId, leadId, 'PRE_SALES_HOURS_ADDED',
        `Added ${hours}h for ${member.employee.firstName} ${member.employee.lastName}`.trim(),
        user.employeeId ?? null,
      );
      return updated;
    }

    const request = await this.prisma.preSalesRequest.create({
      data: {
        companyId, leadId, type: 'ADDITIONAL_HOURS',
        requestedById: user.employeeId ?? 0, reason, status: 'PENDING',
        items: {
          create: [{
            companyId, employeeId, hours, status: 'REQUESTED',
            technology: member.technology, engagementType: member.engagementType || 'VIRTUAL',
          }],
        },
      },
      include: { items: { include: { employee: { select: { id: true, firstName: true, lastName: true } } } } },
    });

    const who = `${member.employee.firstName} ${member.employee.lastName}`.trim();
    const leadName = access.lead.companyName || access.lead.title || 'a deal';
    await this.notificationsService.notifyApprovers({
      companyId, roles: ['SUPERADMIN', 'ADMIN'], excludeUserId: user.sub ?? null,
      title: 'Additional pre-sales hours requested',
      message: `${hours} more hours are requested for ${who} on Lead ${leadName}.`,
      type: 'ACTION_REQUIRED', linkUrl: `/crm/leads/${leadId}`,
    });

    return request;
  }

  /** The administrator's queue. */
  async listPreSalesRequests(
    companyId: number,
    user: { role?: string },
    status?: string,
  ) {
    if (!this.isPreSalesAdmin(user.role)) {
      throw new ForbiddenException('Only an administrator can review pre-sales requests.');
    }
    const employeeSelect = { select: { id: true, firstName: true, lastName: true, avatarUrl: true } };
    const requests = await this.prisma.preSalesRequest.findMany({
      where: { companyId, ...(status ? { status } : {}) },
      include: {
        items: { include: { employee: employeeSelect } },
        requestedBy: employeeSelect,
        approvedBy: employeeSelect,
        lead: { select: { id: true, title: true, companyName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Waiting first, newest within each group.
    //
    // Not an orderBy: the database can only sort the status alphabetically, and
    // no direction of that puts PENDING first — ascending leads with APPROVED,
    // descending with REJECTED. Priority is not something the string encodes,
    // so it is expressed here. The query above has already ordered by recency
    // and Array.sort is stable, which is what preserves it inside each group.
    return requests.sort((a, b) => {
      const pending = (r: { status: string }) => (r.status === 'PENDING' ? 0 : 1);
      return pending(a) - pending(b);
    });
  }

  /**
   * Approve a request — not necessarily as it was asked for.
   *
   * The admin may trim people from it and substitute others in, so the decided
   * set arrives in `items` and is what gets added. Lines that were asked for
   * but not approved are kept and marked REMOVED, and anyone the admin brought
   * in is marked ADDED: what was asked for and what was granted are different
   * facts, and a substitution is exactly the thing worth looking back at.
   *
   * Omitting `items` approves the request exactly as submitted.
   */
  async approvePreSalesRequest(
    companyId: number,
    requestId: number,
    user: { role?: string; employeeId?: number | null },
    data?: { items?: any[] },
  ) {
    const request = await this.loadPendingRequest(companyId, requestId, user);

    // Topping up an existing member's time rather than adding people.
    if (request.type === 'ADDITIONAL_HOURS') {
      return this.approveHoursRequest(companyId, request, user, data);
    }

    const decided = Array.isArray(data?.items) && data!.items!.length
      ? data!.items!.map((r) => this.normalisePreSalesItem(r))
      : request.items.map((i) => ({
          employeeId: i.employeeId, technology: i.technology,
          engagementType: i.engagementType, hours: i.hours,
        }));

    if (!decided.length) {
      throw new BadRequestException('Approve at least one person, or reject the request.');
    }
    if (new Set(decided.map((d) => d.employeeId)).size !== decided.length) {
      throw new BadRequestException('The same person appears twice.');
    }

    const valid = await this.prisma.employee.findMany({
      where: { id: { in: decided.map((d) => d.employeeId) }, companyId },
      select: { id: true, firstName: true, lastName: true },
    });
    if (valid.length !== decided.length) {
      throw new BadRequestException('One or more selected employees do not belong to this company.');
    }

    const requestedIds = new Set(request.items.map((i) => i.employeeId));
    const decidedIds = new Set(decided.map((d) => d.employeeId));

    await this.prisma.$transaction(async (tx) => {
      for (const d of decided) {
        await tx.preSalesTeamMember.upsert({
          where: { leadId_employeeId: { leadId: request.leadId, employeeId: d.employeeId } },
          create: {
            companyId, leadId: request.leadId, employeeId: d.employeeId,
            assignedById: request.requestedById, remark: request.reason, status: 'ACTIVE',
            technology: d.technology, engagementType: d.engagementType, hours: d.hours,
          },
          update: {
            status: 'ACTIVE', removedAt: null, assignedById: request.requestedById,
            remark: request.reason,
            technology: d.technology, engagementType: d.engagementType, hours: d.hours,
          },
        });

        if (requestedIds.has(d.employeeId)) {
          // Asked for and granted — possibly on terms the admin adjusted.
          await tx.preSalesRequestItem.updateMany({
            where: { requestId, employeeId: d.employeeId },
            data: {
              status: 'APPROVED',
              technology: d.technology, engagementType: d.engagementType, hours: d.hours,
            },
          });
        } else {
          // Substituted in by the admin; never asked for.
          await tx.preSalesRequestItem.create({
            data: {
              companyId, requestId, employeeId: d.employeeId, status: 'ADDED',
              technology: d.technology, engagementType: d.engagementType, hours: d.hours,
            },
          });
        }
      }

      // Asked for, not granted.
      await tx.preSalesRequestItem.updateMany({
        where: { requestId, employeeId: { notIn: Array.from(decidedIds) }, status: 'REQUESTED' },
        data: { status: 'REMOVED' },
      });

      await tx.preSalesRequest.update({
        where: { id: requestId },
        data: { status: 'APPROVED', approvedById: user.employeeId ?? null, approvedAt: new Date() },
      });
    });

    const names = valid.map((e) => `${e.firstName} ${e.lastName}`.trim()).join(', ');
    const leadName = request.lead.companyName || request.lead.title || 'a deal';
    const link = `/crm/leads/${request.leadId}`;

    await this.notificationsService.notifyEmployees([request.requestedById], {
      companyId, excludeEmployeeId: user.employeeId ?? null,
      title: 'Pre-sales request approved',
      // Says who was approved rather than "your request was approved", because
      // the admin may have granted a different set than was asked for.
      message: `Your pre-sales request for ${leadName} was approved for ${names}.`,
      type: 'SUCCESS', linkUrl: link,
    });
    await this.notifyPreSalesAssigned(
      companyId, request.lead, decided.map((d) => d.employeeId), user.employeeId ?? null,
    );

    return this.prisma.preSalesRequest.findUnique({
      where: { id: requestId },
      include: { items: { include: { employee: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } } } },
    });
  }

  /**
   * Grant extra time, optionally less than was asked for — an admin may decide
   * four hours is enough where eight were requested.
   */
  private async approveHoursRequest(
    companyId: number,
    request: any,
    user: { role?: string; employeeId?: number | null },
    data?: { items?: any[] },
  ) {
    const line = request.items[0];
    if (!line) throw new BadRequestException('This request has no line to approve.');

    const grantedRaw = data?.items?.[0]?.hours ?? line.hours;
    const granted = Number(grantedRaw);
    if (!Number.isFinite(granted) || granted <= 0) {
      throw new BadRequestException('Enter how many hours to grant.');
    }

    const member = await this.prisma.preSalesTeamMember.findFirst({
      where: { companyId, leadId: request.leadId, employeeId: line.employeeId, status: 'ACTIVE' },
    });
    if (!member) throw new BadRequestException('That person is no longer on this deal\'s pre-sales team.');

    await this.prisma.$transaction([
      this.prisma.preSalesTeamMember.update({
        where: { id: member.id },
        data: { hours: (member.hours ?? 0) + granted },
      }),
      this.prisma.preSalesRequestItem.update({
        where: { id: line.id },
        data: { status: 'APPROVED', hours: granted },
      }),
      this.prisma.preSalesRequest.update({
        where: { id: request.id },
        data: { status: 'APPROVED', approvedById: user.employeeId ?? null, approvedAt: new Date() },
      }),
    ]);

    const who = `${line.employee.firstName} ${line.employee.lastName}`.trim();
    const leadName = request.lead.companyName || request.lead.title || 'a deal';
    await this.notificationsService.notifyEmployees([request.requestedById, line.employeeId], {
      companyId, excludeEmployeeId: user.employeeId ?? null,
      title: 'Additional hours approved',
      message: `${granted} more hours approved for ${who} on ${leadName}.`,
      type: 'SUCCESS', linkUrl: `/crm/leads/${request.leadId}`,
    });

    return this.prisma.preSalesRequest.findUnique({
      where: { id: request.id },
      include: { items: { include: { employee: { select: { id: true, firstName: true, lastName: true } } } } },
    });
  }

  async rejectPreSalesRequest(
    companyId: number,
    requestId: number,
    user: { role?: string; employeeId?: number | null },
    data: { adminRemark?: string },
  ) {
    const request = await this.loadPendingRequest(companyId, requestId, user);
    const adminRemark = (data?.adminRemark || '').trim() || null;

    const updated = await this.prisma.$transaction(async (tx) => {
      // Every line goes down with the request; none of these people join.
      await tx.preSalesRequestItem.updateMany({
        where: { requestId, status: 'REQUESTED' },
        data: { status: 'REMOVED' },
      });
      return tx.preSalesRequest.update({
        where: { id: requestId },
        data: { status: 'REJECTED', approvedById: user.employeeId ?? null, approvedAt: new Date(), adminRemark },
      });
    });

    const who = request.items
      .map((i) => `${i.employee.firstName} ${i.employee.lastName}`.trim())
      .join(', ');
    const leadName = request.lead.companyName || request.lead.title || 'a deal';
    await this.notificationsService.notifyEmployees([request.requestedById], {
      companyId, excludeEmployeeId: user.employeeId ?? null,
      title: 'Pre-sales request rejected',
      message: `Your request to add ${who} as Pre-Sales for ${leadName} was rejected.`
        + (adminRemark ? ` Reason: ${adminRemark}` : ''),
      type: 'WARNING', linkUrl: `/crm/leads/${request.leadId}`,
    });

    return updated;
  }

  private async loadPendingRequest(
    companyId: number,
    requestId: number,
    user: { role?: string; employeeId?: number | null },
  ) {
    if (!this.isPreSalesAdmin(user.role)) {
      throw new ForbiddenException('Only an administrator can decide pre-sales requests.');
    }
    const request = await this.prisma.preSalesRequest.findFirst({
      where: { id: requestId, companyId },
      include: {
        items: { include: { employee: { select: { id: true, firstName: true, lastName: true } } } },
        lead: { select: { id: true, title: true, companyName: true, addedById: true } },
      },
    });
    if (!request) throw new NotFoundException('Pre-sales request not found');
    if (request.status !== 'PENDING') {
      throw new BadRequestException(`This request has already been ${request.status.toLowerCase()}.`);
    }
    // Belt and braces: an admin who happens to be the requester still must not
    // wave their own request through.
    if (user.employeeId && request.requestedById === user.employeeId) {
      throw new ForbiddenException('You cannot approve or reject your own pre-sales request.');
    }
    return request;
  }

  // ── tasks ──────────────────────────────────────────────────────────────────

  private static readonly TASK_STATUSES = ['NEW', 'WORKING', 'ON_HOLD', 'COMPLETED'];

  /**
   * Tasks are created by whoever put the employee on the deal, or by an admin.
   * A pre-sales employee executes tasks; they never raise them.
   */
  async createPreSalesTask(
    companyId: number,
    leadId: number,
    user: { role?: string; employeeId?: number | null },
    data: any,
  ) {
    const access = await this.resolvePreSalesAccess(companyId, leadId, user);
    const employeeId = user.employeeId ?? null;

    const assignedToId = Number(data?.assignedToId);
    if (!Number.isFinite(assignedToId)) throw new BadRequestException('Choose who the task is for.');

    const member = await this.prisma.preSalesTeamMember.findFirst({
      where: { companyId, leadId, employeeId: assignedToId, status: 'ACTIVE' },
    });
    if (!member) throw new BadRequestException('That employee is not on this deal’s pre-sales team.');
    if (!this.canCreateTaskFor(member, access, employeeId)) {
      throw new ForbiddenException('Only an administrator, or the person who added this pre-sales member, can create tasks for them.');
    }

    const title = (data?.title || '').trim();
    if (!title) throw new BadRequestException('Give the task a title.');

    const estimatedMinutes = this.parseDurationMinutes(data);
    const scheduledAt = this.parseScheduledAt(data);

    // The member is engaged for a fixed number of hours; the tasks raised for
    // them may not exceed it. Someone with no allocation is uncapped — those
    // members predate the budget and refusing them would be a regression.
    if (estimatedMinutes) {
      const usage = await this.memberHoursUsage(companyId, leadId, assignedToId);
      if (usage.capped && estimatedMinutes > (usage.remainingMinutes ?? 0)) {
        throw new BadRequestException(
          `That is more time than is left for this person. `
          + `${CrmService.formatMinutes(usage.allocatedMinutes ?? 0)} allocated, `
          + `${CrmService.formatMinutes(usage.usedMinutes)} already planned, `
          + `${CrmService.formatMinutes(Math.max(0, usage.remainingMinutes ?? 0))} remaining. `
          + `Request more hours if this task needs them.`,
        );
      }
    }

    const files = Array.isArray(data?.attachments)
      ? data.attachments.filter((a: any) => a?.fileUrl)
      : [];

    const task = await this.prisma.$transaction(async (tx) => {
      const created = await tx.preSalesTask.create({
        data: {
          companyId, leadId,
          assignedById: employeeId ?? 0,
          assignedToId,
          title,
          taskType: (data?.taskType || '').trim() || null,
          description: (data?.description || data?.remark || '').trim() || null,
          scheduledAt,
          estimatedMinutes,
          status: 'NEW',
        },
        include: { assignedTo: { select: { id: true, firstName: true, lastName: true } }, attachments: true },
      });

      // The opening entry of the trail, and the owner of the files attached at
      // creation: without a historyId the files would never reach the timeline,
      // so "what was handed over when the task was raised" would stay invisible.
      const history = await tx.preSalesTaskStatusHistory.create({
        data: {
          companyId, taskId: created.id, newStatus: 'NEW', previousStatus: null,
          remark: 'Task created', changedById: employeeId ?? 0,
        },
      });

      if (files.length) {
        await tx.preSalesTaskAttachment.createMany({
          data: files.map((a: any) => ({
            companyId, taskId: created.id, historyId: history.id,
            fileName: a.fileName || 'attachment',
            fileUrl: a.fileUrl,
            fileSize: a.fileSize ? Number(a.fileSize) : null,
            uploadedById: employeeId ?? 0,
          })),
        });
      }

      return created;
    });

    // The files were written after the task row existed, so pull the finished
    // shape back out for the caller — otherwise the freshly attached files
    // would be missing from the response.
    if (files.length) {
      const withAttachments = await this.prisma.preSalesTask.findUnique({
        where: { id: task.id },
        include: { assignedTo: { select: { id: true, firstName: true, lastName: true } }, attachments: true },
      });
      return withAttachments ?? task;
    }

    const leadName = access.lead.companyName || access.lead.title || 'a deal';
    await this.notificationsService.notifyEmployees([assignedToId], {
      companyId, excludeEmployeeId: employeeId,
      title: 'New pre-sales task',
      message: `New task assigned: ${title} (${leadName}).`,
      // My Tasks, not the deal page: the deal page no longer lists tasks, and
      // the assignee may not be allowed to see the deal's commercials anyway.
      type: 'ACTION_REQUIRED', linkUrl: `/projects?tab=my-tasks&psTask=${task.id}`,
    });

    return task;
  }

  /** "2 hours 30 minutes" has to become 150 before it is stored. */
  private parseDurationMinutes(data: any): number | null {
    if (data?.estimatedMinutes != null && data.estimatedMinutes !== '') {
      const n = Number(data.estimatedMinutes);
      if (!Number.isFinite(n) || n < 0) throw new BadRequestException('Estimated duration is not a valid number of minutes.');
      return Math.round(n);
    }
    const hours = Number(data?.durationHours ?? 0);
    const minutes = Number(data?.durationMinutes ?? 0);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours < 0 || minutes < 0) {
      throw new BadRequestException('Estimated duration is not valid.');
    }
    const total = Math.round(hours * 60 + minutes);
    return total > 0 ? total : null;
  }

  /** Date and time arrive as separate inputs and are stored as one instant. */
  private parseScheduledAt(data: any): Date | null {
    const date = (data?.scheduledDate || '').toString().trim();
    if (!date) {
      if (!data?.scheduledAt) return null;
      const direct = new Date(data.scheduledAt);
      if (Number.isNaN(direct.getTime())) throw new BadRequestException('The scheduled date is not valid.');
      return direct;
    }
    const time = (data?.scheduledTime || '00:00').toString().trim();
    const parsed = new Date(`${date}T${time.length === 5 ? time : '00:00'}:00`);
    if (Number.isNaN(parsed.getTime())) throw new BadRequestException('The scheduled date or time is not valid.');
    return parsed;
  }

  /** Title, schedule and duration — never the status, which has its own path. */
  async updatePreSalesTask(
    companyId: number,
    leadId: number,
    taskId: number,
    user: { role?: string; employeeId?: number | null },
    data: any,
  ) {
    const access = await this.resolvePreSalesAccess(companyId, leadId, user);
    const task = await this.prisma.preSalesTask.findFirst({ where: { id: taskId, companyId, leadId } });
    if (!task) throw new NotFoundException('Task not found');

    const employeeId = user.employeeId ?? null;
    if (!access.admin && task.assignedById !== employeeId) {
      throw new ForbiddenException('Only an administrator, or the person who created this task, can edit it.');
    }

    // Without this the cap is bypassed by creating a one-minute task and
    // editing it to forty hours.
    if (data?.estimatedMinutes !== undefined || data?.durationHours !== undefined) {
      const minutes = this.parseDurationMinutes(data);
      const assignee = data?.assignedToId !== undefined ? Number(data.assignedToId) : task.assignedToId;
      if (minutes) {
        const usage = await this.memberHoursUsage(companyId, leadId, assignee);
        // This task's own current estimate is not competing with itself.
        const otherUsed = usage.usedMinutes - (assignee === task.assignedToId ? (task.estimatedMinutes || 0) : 0);
        const remaining = usage.allocatedMinutes === null ? null : usage.allocatedMinutes - otherUsed;
        if (remaining !== null && minutes > remaining) {
          throw new BadRequestException(
            `That is more time than is left for this person — `
            + `${CrmService.formatMinutes(Math.max(0, remaining))} remaining. Request more hours first.`,
          );
        }
      }
    }

    const files = Array.isArray(data?.attachments)
      ? data.attachments.filter((a: any) => a?.fileUrl)
      : [];

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.preSalesTask.update({
        where: { id: taskId },
        data: {
          ...(data?.title !== undefined ? { title: String(data.title).trim() } : {}),
          ...(data?.taskType !== undefined ? { taskType: String(data.taskType).trim() || null } : {}),
          ...(data?.description !== undefined ? { description: String(data.description).trim() || null } : {}),
          ...(data?.assignedToId !== undefined ? { assignedToId: Number(data.assignedToId) } : {}),
          ...(data?.scheduledDate !== undefined || data?.scheduledAt !== undefined
            ? { scheduledAt: this.parseScheduledAt(data) } : {}),
          ...(data?.estimatedMinutes !== undefined || data?.durationHours !== undefined
            ? { estimatedMinutes: this.parseDurationMinutes(data) } : {}),
        },
        include: { assignedTo: { select: { id: true, firstName: true, lastName: true } }, attachments: true },
      });

      // Files attached while editing the task are pinned to a history entry too,
      // so they show up in the timeline exactly like the ones from a status
      // change — otherwise an attachment added mid-edit would vanish.
      if (files.length) {
        const history = await tx.preSalesTaskStatusHistory.create({
          data: {
            companyId, taskId: row.id, newStatus: row.status, previousStatus: row.status,
            remark: 'Task edited — file(s) attached', changedById: employeeId ?? 0,
          },
        });
        await tx.preSalesTaskAttachment.createMany({
          data: files.map((a: any) => ({
            companyId, taskId: row.id, historyId: history.id,
            fileName: a.fileName || 'attachment',
            fileUrl: a.fileUrl,
            fileSize: a.fileSize ? Number(a.fileSize) : null,
            uploadedById: employeeId ?? 0,
          })),
        });
      }

      return row;
    });

    if (files.length) {
      const withAttachments = await this.prisma.preSalesTask.findUnique({
        where: { id: updated.id },
        include: { assignedTo: { select: { id: true, firstName: true, lastName: true } }, attachments: true },
      });
      return withAttachments ?? updated;
    }

    return updated;
  }

  /**
   * Delete a task outright.
   *
   * Separate from a COMPLETED status: completing is a record of work done,
   * deleting is for a task that should never have existed. Its history and
   * attachments go with it (cascade), which is why only the person who raised
   * it or an admin may do it — an assignee who dislikes a task must not be able
   * to erase the fact it was assigned.
   */
  async deletePreSalesTask(
    companyId: number,
    leadId: number,
    taskId: number,
    user: { role?: string; employeeId?: number | null },
  ) {
    const access = await this.resolvePreSalesAccess(companyId, leadId, user);
    const task = await this.prisma.preSalesTask.findFirst({ where: { id: taskId, companyId, leadId } });
    if (!task) throw new NotFoundException('Task not found');

    const employeeId = user.employeeId ?? null;
    if (!access.admin && task.assignedById !== employeeId) {
      throw new ForbiddenException('Only an administrator, or the person who created this task, can delete it.');
    }

    await this.prisma.preSalesTask.delete({ where: { id: taskId } });
    return { success: true };
  }

  /**
   * The only way a task's status moves, and the only writer of its history.
   *
   * The assignee drives their own task; an admin or the task's creator can also
   * move it, because someone has to be able to unstick an abandoned one.
   */
  async changePreSalesTaskStatus(
    companyId: number,
    leadId: number,
    taskId: number,
    user: { role?: string; employeeId?: number | null },
    data: { status?: string; remark?: string; attachments?: any[] },
  ) {
    const access = await this.resolvePreSalesAccess(companyId, leadId, user);
    const employeeId = user.employeeId ?? null;

    const task = await this.prisma.preSalesTask.findFirst({ where: { id: taskId, companyId, leadId } });
    if (!task) throw new NotFoundException('Task not found');

    const isAssignee = !!employeeId && task.assignedToId === employeeId;
    const isCreator = !!employeeId && task.assignedById === employeeId;
    if (!isAssignee && !isCreator && !access.admin) {
      throw new ForbiddenException('Only the person this task is assigned to can update it.');
    }

    const status = String(data?.status || '').toUpperCase();
    if (!CrmService.TASK_STATUSES.includes(status)) {
      throw new BadRequestException(`Status must be one of ${CrmService.TASK_STATUSES.join(', ')}.`);
    }
    if (status === task.status) {
      throw new BadRequestException(`This task is already ${status.replace('_', ' ').toLowerCase()}.`);
    }

    const remark = (data?.remark || '').trim() || null;
    // Going on hold or completing is a handover; saying why is the point of the
    // trail, so it is required rather than encouraged.
    if ((status === 'ON_HOLD' || status === 'COMPLETED') && !remark) {
      throw new BadRequestException(
        status === 'ON_HOLD'
          ? 'Say why the task is on hold.'
          : 'Add a completion remark before marking the task complete.',
      );
    }

    const files = Array.isArray(data?.attachments) ? data.attachments.filter((a: any) => a?.fileUrl) : [];

    const updated = await this.prisma.$transaction(async (tx) => {
      const history = await tx.preSalesTaskStatusHistory.create({
        data: {
          companyId, taskId, previousStatus: task.status, newStatus: status,
          remark, changedById: employeeId ?? 0,
        },
      });

      if (files.length) {
        await tx.preSalesTaskAttachment.createMany({
          data: files.map((a: any) => ({
            companyId, taskId, historyId: history.id,
            fileName: a.fileName || 'attachment',
            fileUrl: a.fileUrl,
            fileSize: a.fileSize ? Number(a.fileSize) : null,
            uploadedById: employeeId ?? 0,
          })),
        });
      }

      return tx.preSalesTask.update({
        where: { id: taskId },
        data: { status, completedAt: status === 'COMPLETED' ? new Date() : null },
        include: {
          assignedTo: { select: { id: true, firstName: true, lastName: true } },
          attachments: true,
        },
      });
    });

    if (status === 'COMPLETED') await this.notifyTaskCompleted(companyId, access.lead, updated, employeeId);

    return updated;
  }

  /** Everyone with a stake: the admins, the deal's creator, the task's creator
   *  and the rest of the deal's pre-sales team. */
  private async notifyTaskCompleted(
    companyId: number,
    lead: { id: number; title: string | null; companyName: string | null; addedById: number | null },
    task: { id: number; title: string; assignedById: number; assignedTo: { firstName: string; lastName: string } },
    actorEmployeeId: number | null,
  ) {
    const team = await this.prisma.preSalesTeamMember.findMany({
      where: { companyId, leadId: lead.id, status: 'ACTIVE' },
      select: { employeeId: true },
    });

    const who = `${task.assignedTo.firstName} ${task.assignedTo.lastName}`.trim();
    const leadName = lead.companyName || lead.title || 'a deal';
    const payload = {
      companyId,
      excludeEmployeeId: actorEmployeeId,
      title: 'Pre-sales task completed',
      message: `Pre-Sales task "${task.title}" has been completed by ${who} (${leadName}).`,
      type: 'SUCCESS',
      linkUrl: `/crm/leads/${lead.id}`,
    };

    const employeeIds = [lead.addedById, task.assignedById, ...team.map((t) => t.employeeId)];
    await this.notificationsService.notifyEmployees(employeeIds, payload);
    await this.notificationsService.notifyApprovers({
      companyId, roles: ['SUPERADMIN', 'ADMIN'],
      title: payload.title, message: payload.message, type: 'INFO', linkUrl: payload.linkUrl,
    });
  }

  /** The append-only trail for one task. */
  async getPreSalesTaskHistory(
    companyId: number,
    leadId: number,
    taskId: number,
    user: { role?: string; employeeId?: number | null },
  ) {
    await this.resolvePreSalesAccess(companyId, leadId, user);
    const task = await this.prisma.preSalesTask.findFirst({ where: { id: taskId, companyId, leadId } });
    if (!task) throw new NotFoundException('Task not found');

    return this.prisma.preSalesTaskStatusHistory.findMany({
      where: { companyId, taskId },
      include: {
        changedBy: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        attachments: true,
      },
      orderBy: { changedAt: 'asc' },
    });
  }
}
