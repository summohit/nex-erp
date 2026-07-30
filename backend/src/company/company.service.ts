import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CompanyService {
  constructor(private prisma: PrismaService) {}

  async getCompanyProfile(companyId: number) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        name: true,
        domain: true,
        industry: true,
        size: true,
        timezone: true,
        logoUrl: true,
      }
    });

    if (!company) {
      throw new NotFoundException('Company not found');
    }

    return company;
  }

  async updateCompanyProfile(companyId: number, data: { name?: string, domain?: string, industry?: string, size?: string, timezone?: string, logoUrl?: string }) {
    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.domain !== undefined) updateData.domain = data.domain;
    if (data.industry !== undefined) updateData.industry = data.industry;
    if (data.size !== undefined) updateData.size = data.size;
    if (data.timezone !== undefined) updateData.timezone = data.timezone;
    if (data.logoUrl !== undefined) updateData.logoUrl = data.logoUrl;

    return this.prisma.company.update({
      where: { id: companyId },
      data: updateData,
      select: {
        id: true,
        name: true,
        domain: true,
        industry: true,
        size: true,
        timezone: true,
        logoUrl: true,
      }
    });
  }
}
