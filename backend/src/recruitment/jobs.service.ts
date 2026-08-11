import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JobsService {
  constructor(private prisma: PrismaService) {}

  async findAll(companyId: number) {
    const jobs = await this.prisma.job.findMany({
      where: { companyId },
      include: {
        department: true,
        designation: true,
        branch: true,
        recruiter: {
          select: { firstName: true, lastName: true }
        },
        _count: {
          select: { applications: true }
        },
        applications: {
          where: { status: { in: ['HIRED', 'ONBOARDED'] } },
          select: { id: true }
        }
      },
      orderBy: { postedDate: 'desc' },
    });

    // Auto-close logic
    let needsRefetch = false;
    for (const job of jobs) {
      if (job.status !== 'Closed') {
        let shouldClose = false;
        
        // 1. Check end date
        if (job.endDate && new Date(job.endDate) < new Date()) {
          shouldClose = true;
        }
        
        // 2. Check total openings
        const filled = job.applications.length;
        if (job.totalOpenings > 0 && filled >= job.totalOpenings) {
          shouldClose = true;
        }

        if (shouldClose) {
          await this.prisma.job.update({ where: { id: job.id }, data: { status: 'Closed' } });
          job.status = 'Closed';
        }
      }
    }

    return jobs;
  }

  async findOne(id: number, companyId: number) {
    const job = await this.prisma.job.findFirst({
      where: { id, companyId },
      include: {
        department: true,
        designation: true,
        branch: true,
      },
    });
    if (!job) {
      throw new NotFoundException(`Job #${id} not found`);
    }
    return job;
  }

  async create(companyId: number, data: any) {
    const { minSalary, maxSalary, startDate, endDate, totalOpenings, recruiterId, discloseSalary, ...rest } = data;
    return this.prisma.job.create({
      data: {
        ...rest,
        minSalary: minSalary ? parseFloat(minSalary) : null,
        maxSalary: maxSalary ? parseFloat(maxSalary) : null,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        totalOpenings: totalOpenings ? parseInt(totalOpenings, 10) : 1,
        recruiterId: recruiterId ? parseInt(recruiterId, 10) : null,
        discloseSalary: discloseSalary === true || discloseSalary === 'true',
        companyId,
        postedDate: new Date(),
      },
    });
  }

  async update(id: number, companyId: number, data: any) {
    const job = await this.findOne(id, companyId);
    const { minSalary, maxSalary, startDate, endDate, totalOpenings, recruiterId, discloseSalary, ...rest } = data;
    
    const updateData = { ...rest };
    if (minSalary !== undefined) updateData.minSalary = minSalary ? parseFloat(minSalary) : null;
    if (maxSalary !== undefined) updateData.maxSalary = maxSalary ? parseFloat(maxSalary) : null;
    if (startDate !== undefined) updateData.startDate = startDate ? new Date(startDate) : null;
    if (endDate !== undefined) updateData.endDate = endDate ? new Date(endDate) : null;
    if (totalOpenings !== undefined) updateData.totalOpenings = totalOpenings ? parseInt(totalOpenings, 10) : 1;
    if (recruiterId !== undefined) updateData.recruiterId = recruiterId ? parseInt(recruiterId, 10) : null;
    if (discloseSalary !== undefined) updateData.discloseSalary = discloseSalary === true || discloseSalary === 'true';
    
    return this.prisma.job.update({
      where: { id: job.id },
      data: updateData,
    });
  }

  async remove(id: number, companyId: number) {
    const job = await this.findOne(id, companyId);
    return this.prisma.job.delete({
      where: { id: job.id },
    });
  }
}
