import { lockJobCapacity, closeFilledJobs } from './job-capacity';
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JobsService {
  constructor(private prisma: PrismaService) {}

  async findAll(companyId: number) {
    await this.prisma.$transaction(async tx => {
      await lockJobCapacity(tx, companyId);
      await closeFilledJobs(tx, companyId);
    });
    const jobs = await this.prisma.job.findMany({
      where: { companyId },
      include: {
        department: true,
        designation: true,
        branch: true,
        recruiter: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true }
        },
        _count: {
          select: { applications: true }
        },
        // Filled openings = candidates marked Hired (or already onboarded), 13 Nov 2026.
        applications: {
          where: { status: { in: ['HIRED', 'ONBOARDED'] } },
          select: { id: true, updatedAt: true }
        }
      },
      orderBy: [
        { createdAt: 'desc' },
        { id: 'desc' },
      ],
    });

    // Openings filled vs closing date (13 Nov 2026):
    //  - every opening has a Hired candidate -> the posting is Closed;
    //  - the closing date has passed with openings still unfilled -> Overdue
    //    (it stays Open so recruiting can continue). No closing date = never Overdue.
    const now = new Date();
    const result: any[] = [];
    for (const job of jobs) {
      const hiredCount = job.applications.length;
      const openings = job.totalOpenings || 1;
      if (job.status === 'Open' && hiredCount >= openings) {
        await this.prisma.job.update({ where: { id: job.id }, data: { status: 'Closed' } });
        job.status = 'Closed';
      }
      const isOverdue = job.status === 'Open' && !!job.endDate && new Date(job.endDate) < now && hiredCount < openings;
      result.push({ ...job, hiredCount, isOverdue });
    }

    return result;
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

  async getJobDetail(id: number, companyId: number) {
    const job = await this.prisma.job.findFirst({
      where: { id, companyId },
      include: {
        department: true,
        designation: true,
        branch: true,
        recruiter: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        applications: { select: { status: true } },
      },
    });
    if (!job) {
      throw new NotFoundException(`Job #${id} not found`);
    }

    const { applications, ...jobFields } = job;
    const statusCounts: Record<string, number> = {};
    for (const app of applications) {
      statusCounts[app.status] = (statusCounts[app.status] || 0) + 1;
    }

    return {
      ...jobFields,
      totalApplications: applications.length,
      statusCounts,
    };
  }

  async create(companyId: number, data: any) {
    const { minSalary, maxSalary, startDate, endDate, totalOpenings, recruiterId, discloseSalary, ...rest } = data;
    if (!rest.title || !String(rest.title).trim()) {
      throw new BadRequestException('Job title is required');
    }
    return this.prisma.job.create({
      data: {
        ...rest,
        minSalary: minSalary ? parseFloat(minSalary) : null,
        maxSalary: maxSalary ? parseFloat(maxSalary) : null,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        totalOpenings: totalOpenings === undefined || totalOpenings === null || totalOpenings === ''
          ? 1
          : parseInt(totalOpenings, 10),
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
    if (data.title !== undefined && (!data.title || !String(data.title).trim())) {
      throw new BadRequestException('Job title cannot be empty');
    }
    
    const updateData = { ...rest };
    if (minSalary !== undefined) updateData.minSalary = minSalary ? parseFloat(minSalary) : null;
    if (maxSalary !== undefined) updateData.maxSalary = maxSalary ? parseFloat(maxSalary) : null;
    if (startDate !== undefined) updateData.startDate = startDate ? new Date(startDate) : null;
    if (endDate !== undefined) updateData.endDate = endDate ? new Date(endDate) : null;
    // 0 is a real value here, not a missing one: the drawer offers it to mean
    // "keep this posting open indefinitely", so it has to survive the write
    // instead of collapsing back to a single opening.
    if (totalOpenings !== undefined && totalOpenings !== null && totalOpenings !== '') {
      updateData.totalOpenings = parseInt(totalOpenings, 10);
    }
    if (recruiterId !== undefined) updateData.recruiterId = recruiterId ? parseInt(recruiterId, 10) : null;
    if (discloseSalary !== undefined) updateData.discloseSalary = discloseSalary === true || discloseSalary === 'true';
    
    return this.prisma.$transaction(async tx => {
      await lockJobCapacity(tx, companyId);
      await tx.job.update({ where: { id: job.id }, data: updateData });
      await closeFilledJobs(tx, companyId);
      return tx.job.findUniqueOrThrow({ where: { id: job.id } });
    });
  }

  async remove(id: number, companyId: number) {
    const job = await this.findOne(id, companyId);
    return this.prisma.job.delete({
      where: { id: job.id },
    });
  }
}
