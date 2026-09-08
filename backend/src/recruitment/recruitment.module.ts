import { Module } from '@nestjs/common';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';
import { OfferLettersService } from './offer-letters.service';

import { LettersModule } from '../letters/letters.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PayrollModule } from '../payroll/payroll.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [PrismaModule, PayrollModule, NotificationsModule, MailModule, LettersModule],
  controllers: [JobsController, ApplicationsController],
  providers: [JobsService, ApplicationsService, OfferLettersService],
  exports: [ApplicationsService, OfferLettersService]
})
export class RecruitmentModule {}
