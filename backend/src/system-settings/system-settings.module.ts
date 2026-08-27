import { Module } from '@nestjs/common';
import { SystemSettingsService } from './system-settings.service';
import { SystemSettingsController } from './system-settings.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { RecruitmentModule } from '../recruitment/recruitment.module';

@Module({
  // RecruitmentModule exports OfferLettersService, which owns the template
  // rendering used by the offer-letter preview endpoint below.
  imports: [PrismaModule, RecruitmentModule],
  controllers: [SystemSettingsController],
  providers: [SystemSettingsService],
  exports: [SystemSettingsService]
})
export class SystemSettingsModule {}
