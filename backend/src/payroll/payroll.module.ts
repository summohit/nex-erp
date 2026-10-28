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

@Module({
  imports: [PrismaModule, ApprovalsModule, NotificationsModule],
  controllers: [PayrollController, PayrollSettingsController, PayrollMastersController],
  providers: [PayrollService, PdfService, EmailService, PayrollSettingsService, PayrollMastersService],
  exports: [PayrollService, PdfService, EmailService, PayrollSettingsService, PayrollMastersService]
})
export class PayrollModule {}
