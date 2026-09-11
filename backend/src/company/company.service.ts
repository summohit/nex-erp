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
        mobile: true,
        email: true,
        address: true,
        gstin: true,
        panNumber: true,
        udyamRegNo: true,
        quotationPrefix: true,
        bankAccountName: true,
        bankName: true,
        bankBranch: true,
        bankIfsc: true,
        bankAccountNumber: true,
      }
    });

    if (!company) {
      throw new NotFoundException('Company not found');
    }

    return company;
  }

  async updateCompanyProfile(companyId: number, data: { name?: string, domain?: string, industry?: string, size?: string, timezone?: string, logoUrl?: string, mobile?: string, email?: string, address?: string, gstin?: string, panNumber?: string, udyamRegNo?: string, quotationPrefix?: string, bankAccountName?: string, bankName?: string, bankBranch?: string, bankIfsc?: string, bankAccountNumber?: string }) {
    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.domain !== undefined) updateData.domain = data.domain;
    if (data.industry !== undefined) updateData.industry = data.industry;
    if (data.size !== undefined) updateData.size = data.size;
    if (data.timezone !== undefined) updateData.timezone = data.timezone;
    if (data.logoUrl !== undefined) updateData.logoUrl = data.logoUrl;
    // Statutory, contact and bank details — same explicit allow-list, so an
    // unexpected key in the body can never reach Prisma.
    if (data.mobile !== undefined) updateData.mobile = data.mobile;
    if (data.email !== undefined) updateData.email = data.email;
    if (data.address !== undefined) updateData.address = data.address;
    if (data.gstin !== undefined) updateData.gstin = data.gstin;
    if (data.panNumber !== undefined) updateData.panNumber = data.panNumber;
    if (data.udyamRegNo !== undefined) updateData.udyamRegNo = data.udyamRegNo;
    if (data.quotationPrefix !== undefined) updateData.quotationPrefix = data.quotationPrefix;
    if (data.bankAccountName !== undefined) updateData.bankAccountName = data.bankAccountName;
    if (data.bankName !== undefined) updateData.bankName = data.bankName;
    if (data.bankBranch !== undefined) updateData.bankBranch = data.bankBranch;
    if (data.bankIfsc !== undefined) updateData.bankIfsc = data.bankIfsc;
    if (data.bankAccountNumber !== undefined) updateData.bankAccountNumber = data.bankAccountNumber;

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
        mobile: true,
        email: true,
        address: true,
        gstin: true,
        panNumber: true,
        udyamRegNo: true,
        quotationPrefix: true,
        bankAccountName: true,
        bankName: true,
        bankBranch: true,
        bankIfsc: true,
        bankAccountNumber: true,
      }
    });
  }
}
