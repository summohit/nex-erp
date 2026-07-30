import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ShiftsService {
  constructor(private prisma: PrismaService) {}

  async findAll(companyId: number) {
    return this.prisma.shift.findMany({
      where: { companyId },
      orderBy: { name: 'asc' },
      include: {
        _count: {
          select: { employees: true }
        }
      }
    });
  }

  async create(companyId: number, data: { name: string, startTime: string, endTime: string, bufferTimeMinutes?: number }) {
    if (!data.name || !data.startTime || !data.endTime) {
      throw new BadRequestException('Name, startTime, and endTime are required');
    }

    return this.prisma.shift.create({
      data: {
        name: data.name,
        startTime: data.startTime,
        endTime: data.endTime,
        bufferTimeMinutes: data.bufferTimeMinutes || 15,
        companyId
      }
    });
  }

  async update(companyId: number, id: number, data: { name?: string, startTime?: string, endTime?: string, bufferTimeMinutes?: number }) {
    const existing = await this.prisma.shift.findUnique({ where: { id } });
    if (!existing || existing.companyId !== companyId) {
      throw new BadRequestException('Shift not found');
    }

    return this.prisma.shift.update({
      where: { id },
      data
    });
  }

  async delete(companyId: number, id: number) {
    const existing = await this.prisma.shift.findUnique({ where: { id } });
    if (!existing || existing.companyId !== companyId) {
      throw new BadRequestException('Shift not found');
    }

    return this.prisma.shift.delete({ where: { id } });
  }
}
