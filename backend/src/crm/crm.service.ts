import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
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
    if (out.proposalDate === '' || out.proposalDate === null) delete out.proposalDate;
    else if (out.proposalDate) out.proposalDate = new Date(out.proposalDate);
    
    if (out.expectedCloseDate === '' || out.expectedCloseDate === null) delete out.expectedCloseDate;
    else if (out.expectedCloseDate) out.expectedCloseDate = new Date(out.expectedCloseDate);

    if (out.value !== undefined) out.value = out.value ? parseFloat(out.value) : null;
    return out;
  }

  /**
   * Builds the next human-readable reference, e.g. L0926-001 / LC0926-001:
   * prefix + MMYY + a sequence that restarts each month.
   *
   * The sequence comes from the highest existing code for this month rather than
   * a counter table, so it stays correct if rows are deleted or backfilled. Two
   * simultaneous creates can still compute the same number, which is why the
   * column is UNIQUE and the caller retries — the constraint is the real guard,
   * not this read.
   */
  private async nextEntityCode(
    kind: 'LEAD' | 'CONTACT',
    companyId: number,
  ): Promise<string> {
    const prefix = kind === 'LEAD' ? 'L' : 'LC';
    const now = new Date();
    const mmyy = `${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getFullYear()).slice(-2)}`;
    const stem = `${prefix}${mmyy}-`;

    // Scoped by company: two companies each get their own -001 for the month.
    const latest =
      kind === 'LEAD'
        ? await this.prisma.lead.findFirst({
            where: { companyId, leadCode: { startsWith: stem } },
            orderBy: { leadCode: 'desc' },
            select: { leadCode: true },
          })
        : await this.prisma.leadContact.findFirst({
            where: { companyId, contactCode: { startsWith: stem } },
            orderBy: { contactCode: 'desc' },
            select: { contactCode: true },
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
    kind: 'LEAD' | 'CONTACT',
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
    return create(`${kind === 'LEAD' ? 'L' : 'LC'}-${Date.now()}`);
  }

  async createLead(companyId: number, data: any, creatorEmployeeId?: number | null) {
    const sanitized = this.sanitizeLead(data);
    const lead = await this.withEntityCode('LEAD', companyId, (leadCode) =>
      this.prisma.lead.create({
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
      }),
    );

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

  async getLeads(companyId: number, user: { role?: string; employeeId?: number | null }) {
    const where: any = { companyId };

    const isUnrestricted = user.role === 'SUPERADMIN' || user.role === 'ADMIN';
    if (!isUnrestricted) {
      const canViewAll = await this.permissionsService.hasPermission(
        companyId, user.role || 'EMPLOYEE', 'crm/leads', 'VIEW_ALL',
      );
      if (!canViewAll) {
        where.OR = [
          { addedById: user.employeeId ?? -1 },
          { assignedToId: user.employeeId ?? -1 },
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
      },
      orderBy: { createdAt: 'desc' },
    });
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
        quotations: true,
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
      if (!canViewAll) {
        const scoped =
          (lead.addedById !== null && lead.addedById === user.employeeId) ||
          (lead.assignedToId !== null && lead.assignedToId === user.employeeId);
        if (!scoped) throw new NotFoundException('Lead not found');
      }
    }

    return lead;
  }

  async updateLeadStatus(companyId: number, leadId: number, status: string) {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, companyId } });
    if (!lead) throw new NotFoundException('Lead not found');

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
    if (status === 'WON' && !lead.clientId && lead.companyName) {
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
  
  async updateLead(companyId: number, leadId: number, data: any, actorEmployeeId?: number | null) {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, companyId } });
    if (!lead) throw new NotFoundException('Lead not found');

    const updatedLead = await this.prisma.lead.update({
      where: { id: leadId },
      data: this.sanitizeLead(data),
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

    const leadFile = await this.prisma.leadFile.create({
      data: {
        leadId,
        companyId,
        fileName: file.originalname || 'file',
        fileUrl: file.url,
        fileType: file.mimetype || null,
        fileSize: file.size || null,
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
      { fileId: leadFile.id, fileName: leadFile.fileName },
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

  async createLeadContact(companyId: number, userId: number | null, data: any) {
    let addedById: number | null = data.addedById || null;
    // Public form submissions have no signed-in user. Without this guard the
    // lookup would run with userId undefined and attach an arbitrary employee.
    if (!addedById && userId) {
      const employee = await this.prisma.employee.findFirst({ where: { userId, companyId } });
      addedById = employee?.id || null;
    }

    return this.withEntityCode('CONTACT', companyId, (contactCode) =>
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

    return this.prisma.leadContact.update({
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
  }

  async deleteLeadContact(companyId: number, id: number) {
    const contact = await this.prisma.leadContact.findFirst({ where: { id, companyId } });
    if (!contact) throw new NotFoundException('Lead Contact not found');

    return this.prisma.leadContact.delete({
      where: { id },
    });
  }

  async convertLeadContactToClient(companyId: number, id: number) {
    const contact = await this.prisma.leadContact.findFirst({ where: { id, companyId } });
    if (!contact) throw new NotFoundException('Lead Contact not found');

    const clientName = (contact.companyName || contact.name || '').trim();
    if (!clientName) throw new BadRequestException('Cannot convert: contact has no company or name.');

    const existing = await this.prisma.client.findFirst({
      where: { companyId, name: clientName },
    });
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
}
