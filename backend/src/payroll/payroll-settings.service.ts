import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PayrollSettingsService {
  constructor(private prisma: PrismaService) {}

  async getSettings(companyId: number) {
    let settings = await this.prisma.payrollSetting.findUnique({
      where: { companyId },
    });

    if (!settings) {
      settings = await this.prisma.payrollSetting.create({
        data: { companyId },
      });
    }

    return settings;
  }

  async updateSettings(companyId: number, data: any) {
    return this.prisma.payrollSetting.upsert({
      where: { companyId },
      create: {
        companyId,
        basicPercent: data.basicPercent ?? 50.0,
        hraPercent: data.hraPercent ?? 20.0,
        pfPercent: data.pfPercent ?? 12.0,
        gratuityPercent: data.gratuityPercent ?? 4.81,
      },
      update: {
        basicPercent: data.basicPercent,
        hraPercent: data.hraPercent,
        pfPercent: data.pfPercent,
        gratuityPercent: data.gratuityPercent,
      },
    });
  }
}
