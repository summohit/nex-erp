import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CrmService {
  constructor(private prisma: PrismaService) {}

  private sanitizeLead(data: any) {
    const out = { ...data };
    if (out.proposalDate === '' || out.proposalDate === null) delete out.proposalDate;
    else if (out.proposalDate) out.proposalDate = new Date(out.proposalDate);
    if (out.value !== undefined) out.value = out.value ? parseFloat(out.value) : null;
    return out;
  }

  async createLead(companyId: number, data: any) {
    return this.prisma.lead.create({
      data: {
        ...this.sanitizeLead(data),
        companyId,
      },
    });
  }

  async getLeads(companyId: number) {
    return this.prisma.lead.findMany({
      where: { companyId },
      include: {
        assignedTo: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true },
        },
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
    });
  }

  async deleteLead(companyId: number, leadId: number) {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, companyId } });
    if (!lead) throw new NotFoundException('Lead not found');

    return this.prisma.lead.delete({
      where: { id: leadId },
    });
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
}
