import { Module } from '@nestjs/common';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';
import { TicketTimerSweepCron } from './ticket-timer-sweep.cron';
import { PrismaModule } from '../prisma/prisma.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { MailModule } from '../mail/mail.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, PermissionsModule, MailModule, NotificationsModule],
  controllers: [TicketsController],
  providers: [TicketsService, TicketTimerSweepCron],
  exports: [TicketsService],
})
export class TicketsModule {}
