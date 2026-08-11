import { Module } from '@nestjs/common';
import { PayrollService } from './payroll.service';
import { PayrollController } from './payroll.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { PdfService } from './pdf.service';
import { EmailService } from './email.service';
import { PayrollSettingsService } from './payroll-settings.service';
import { PayrollSettingsController } from './payroll-settings.controller';

@Module({
  imports: [PrismaModule],
  controllers: [PayrollController, PayrollSettingsController],
  providers: [PayrollService, PdfService, EmailService, PayrollSettingsService],
  exports: [PayrollService, PdfService, EmailService, PayrollSettingsService]
})
export class PayrollModule {}
