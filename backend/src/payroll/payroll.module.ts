import { Module } from '@nestjs/common';
import { PayrollService } from './payroll.service';
import { PayrollController } from './payroll.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { ApprovalsModule } from '../approvals/approvals.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PdfService } from './pdf.service';
import { EmailService } from './email.service';
import { PayrollSettingsService } from './payroll-settings.service';
import { PayrollSettingsController } from './payroll-settings.controller';
import { PayrollMastersService } from './masters/payroll-masters.service';
import { PayrollMastersController } from './masters/payroll-masters.controller';
import { PayProfilesService } from './pay-profiles/pay-profiles.service';
import { PayProfilesController } from './pay-profiles/pay-profiles.controller';

@Module({
  imports: [PrismaModule, ApprovalsModule, NotificationsModule],
  controllers: [PayrollController, PayrollSettingsController, PayrollMastersController, PayProfilesController],
  providers: [PayrollService, PdfService, EmailService, PayrollSettingsService, PayrollMastersService, PayProfilesService],
  exports: [PayrollService, PdfService, EmailService, PayrollSettingsService, PayrollMastersService, PayProfilesService]
})
export class PayrollModule {}
