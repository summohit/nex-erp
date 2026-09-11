import { Module } from '@nestjs/common';
import { LeavesController } from './leaves.controller';
import { LeavesService } from './leaves.service';
import { LeaveAccrualCron } from './leave-accrual.cron';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [LeavesController],
  providers: [LeavesService, LeaveAccrualCron],
  exports: [LeavesService]
})
export class LeavesModule {}
