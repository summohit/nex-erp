import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
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
          select: { firstName: true, lastName: true, avatarUrl: true }
        },
        _count: {
          select: { applications: true }
        },
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

    // Auto-close logic.
    //
    // A posting closes itself when it expires or when every opening is taken.
    // What it must never do is overrule a recruiter who deliberately set the
    // status by hand: the edit drawer saves the whole form and the client
    // immediately re-reads this list, so an unconditional rule here would
    // revert the choice within the same click — the save reports success and
    // the status silently snaps back.
    //
    // So each trigger only counts while the posting has not been edited since
    // the trigger became true. `updatedAt` moves on every explicit save, so
    // reopening a filled or expired posting pins it open, and a later hire
    // pushes the application's own timestamp past the posting's again and
    // closes it as before. Unattended postings still close on their own.
    for (const job of jobs) {
      // Only a live posting can lapse. A draft is not published, so flipping it
      // to Closed would be a state change nobody asked for.
      if (job.status !== 'Open') continue;

      // Nothing has touched this posting since...
      const untouchedSince = job.updatedAt;

      // ...its end date passed.
      const expiredUntouched =
        !!job.endDate &&
        new Date(job.endDate) < new Date() &&
        untouchedSince <= new Date(job.endDate);

      // ...its last opening was taken. A posting with 0 openings is unlimited
      // and never fills, matching the drawer's "0 = unlimited" hint.
      const filled = job.applications.length;
      const lastFilledAt = job.applications.reduce<Date | null>(
        (latest, app) => (!latest || app.updatedAt > latest ? app.updatedAt : latest),
        null,
      );
      const filledUntouched =
        job.totalOpenings > 0 &&
        filled >= job.totalOpenings &&
        lastFilledAt !== null &&
        untouchedSince <= lastFilledAt;

      if (expiredUntouched || filledUntouched) {
        await this.prisma.job.update({ where: { id: job.id }, data: { status: 'Closed' } });
        job.status = 'Closed';
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
