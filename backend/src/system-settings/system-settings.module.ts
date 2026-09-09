import { Module } from '@nestjs/common';
import { SystemSettingsService } from './system-settings.service';
import { SystemSettingsController } from './system-settings.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { RecruitmentModule } from '../recruitment/recruitment.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  // RecruitmentModule exports OfferLettersService, which owns the template
  // rendering used by the offer-letter preview endpoint below.
  // AuthModule exports TwoFactorService, used to refuse enabling company-wide
  // 2FA while the SuperAdmin doing it has none of their own.
  imports: [PrismaModule, RecruitmentModule, AuthModule],
  controllers: [SystemSettingsController],
  providers: [SystemSettingsService],
  exports: [SystemSettingsService]
})
export class SystemSettingsModule {}
