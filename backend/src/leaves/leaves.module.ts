import { Module } from '@nestjs/common';
import { LeavesController } from './leaves.controller';
import { LeavesService } from './leaves.service';
import { LeaveAccrualCron } from './leave-accrual.cron';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { FieldVisitsModule } from '../field-visits/field-visits.module';

@Module({
  imports: [PrismaModule, NotificationsModule, FieldVisitsModule],
  controllers: [LeavesController],
  providers: [LeavesService, LeaveAccrualCron],
  exports: [LeavesService]
})
export class LeavesModule {}
