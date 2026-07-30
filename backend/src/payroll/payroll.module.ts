import { Module } from '@nestjs/common';
import { PayrollService } from './payroll.service';
import { PayrollController } from './payroll.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { PdfService } from './pdf.service';
import { EmailService } from './email.service';

@Module({
  imports: [PrismaModule],
  controllers: [PayrollController],
  providers: [PayrollService, PdfService, EmailService],
  exports: [PayrollService, PdfService, EmailService]
})
export class PayrollModule {}
