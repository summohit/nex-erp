import { Module } from '@nestjs/common';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';
import { QuotationPdfService } from './quotation-pdf.service';

import { PrismaModule } from '../prisma/prisma.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [PrismaModule, PermissionsModule, NotificationsModule, MailModule],
  controllers: [SalesController],
  providers: [SalesService, QuotationPdfService],
  exports: [SalesService]
})
export class SalesModule {}
