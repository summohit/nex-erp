import { Module } from '@nestjs/common';
import { OffboardingController } from './offboarding.controller';
import { OffboardingService } from './offboarding.service';
import { OffboardingSeparationCron } from './offboarding-separation.cron';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { LettersModule } from '../letters/letters.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [PrismaModule, NotificationsModule, LettersModule, MailModule],
  controllers: [OffboardingController],
  providers: [OffboardingService, OffboardingSeparationCron],
  exports: [OffboardingService]
})
export class OffboardingModule {}
