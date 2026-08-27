import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsService } from '../permissions/permissions.service';

@Injectable()
export class CrmService {
  constructor(private prisma: PrismaService, private permissionsService: PermissionsService) {}

  private sanitizeLead(data: any) {
    const out = { ...data };
    if (out.proposalDate === '' || out.proposalDate === null) delete out.proposalDate;
    else if (out.proposalDate) out.proposalDate = new Date(out.proposalDate);
    
    if (out.expectedCloseDate === '' || out.expectedCloseDate === null) delete out.expectedCloseDate;
    else if (out.expectedCloseDate) out.expectedCloseDate = new Date(out.expectedCloseDate);

    if (out.value !== undefined) out.value = out.value ? parseFloat(out.value) : null;
    return out;
  }

  async createLead(companyId: number, data: any, creatorEmployeeId?: number | null) {
    const sanitized = this.sanitizeLead(data);
    return this.prisma.lead.create({
      data: {
        ...sanitized,
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
  
  async updateLead(companyId: number, leadId: number, data: any) {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, companyId } });
    if (!lead) throw new NotFoundException('Lead not found');

    return this.prisma.lead.update({
      where: { id: leadId },
      data: this.sanitizeLead(data),
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, designation: { select: { name: true } } } },
        addedBy: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, designation: { select: { name: true } } } },
        broughtByContact: true,
      }
    });
  }

  async deleteLead(companyId: number, leadId: number) {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, companyId } });
    if (!lead) throw new NotFoundException('Lead not found');

    return this.prisma.lead.delete({
      where: { id: leadId },
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
          createdAt: true, updatedAt: true, qualificationReason: true,
          assignedToId: true,
          assignedTo: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
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
      orderBy: { scheduledAt: 'asc' },
    });
  }

  async createFollowUp(companyId: number, leadId: number, data: any) {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, companyId } });
    if (!lead) throw new NotFoundException('Lead not found');

    const scheduledAt = data.scheduledAt ? new Date(data.scheduledAt) : new Date();
    // No manual rep picker on creation — default to the lead's own owner.
    const assignedToId = data.assignedToId ? parseInt(data.assignedToId, 10) : (lead.assignedToId || null);

    return this.prisma.leadFollowUp.create({
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
        assignedToId,
      },
      include: {
        assignedTo: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true, designation: { select: { name: true } } },
        },
      },
    });
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
    if (data.assignedToId !== undefined) {
      updateData.assignedToId = data.assignedToId ? parseInt(data.assignedToId, 10) : null;
    }

    return this.prisma.leadFollowUp.update({
      where: { id: followUpId },
      data: updateData,
      include: {
        assignedTo: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true, designation: { select: { name: true } } },
        },
      },
    });
  }

  async deleteFollowUp(companyId: number, leadId: number, followUpId: number) {
    const followUp = await this.prisma.leadFollowUp.findFirst({
      where: { id: followUpId, leadId, companyId },
    });
    if (!followUp) throw new NotFoundException('Follow-up not found');

    return this.prisma.leadFollowUp.delete({
      where: { id: followUpId },
    });
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
    if (query.dateFilter) {
      const now = new Date();
      now.setHours(0, 0, 0, 0); // start of today
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const nextWeek = new Date(now);
      nextWeek.setDate(nextWeek.getDate() + 7);

      if (query.dateFilter === 'today') {
        where.scheduledAt = { gte: now, lt: tomorrow };
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

  async getLeadContacts(companyId: number) {
    return this.prisma.leadContact.findMany({
      where: { companyId },
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

  async createLeadContact(companyId: number, userId: number, data: any) {
    let addedById: number | null = data.addedById || null;
    if (!addedById) {
      const employee = await this.prisma.employee.findFirst({ where: { userId, companyId } });
      addedById = employee?.id || null;
    }

    return this.prisma.leadContact.create({
      data: {
        companyId,
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
    });
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
}
