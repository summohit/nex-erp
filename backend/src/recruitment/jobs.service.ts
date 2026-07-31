import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JobsService {
  constructor(private prisma: PrismaService) {}

  async findAll(companyId: number) {
    return this.prisma.job.findMany({
      where: { companyId },
      include: {
        department: true,
        designation: true,
        branch: true,
        _count: {
          select: { applications: true }
        }
      },
      orderBy: { postedDate: 'desc' },
    });
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
    return this.prisma.job.create({
      data: {
        ...data,
        companyId,
        postedDate: new Date(),
      },
    });
  }

  async update(id: number, companyId: number, data: any) {
    const job = await this.findOne(id, companyId);
    return this.prisma.job.update({
      where: { id: job.id },
      data,
    });
  }

  async remove(id: number, companyId: number) {
    const job = await this.findOne(id, companyId);
    return this.prisma.job.delete({
      where: { id: job.id },
    });
  }
}
