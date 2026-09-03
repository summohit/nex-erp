import { Module } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { AttendanceController } from './attendance.controller';
import { ShiftsService } from './shifts.service';
import { ShiftsController } from './shifts.controller';
import { AutoClockoutCron } from './auto-clockout.cron';
import { PrismaModule } from '../prisma/prisma.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, PermissionsModule, NotificationsModule],
  controllers: [AttendanceController, ShiftsController],
  providers: [AttendanceService, ShiftsService, AutoClockoutCron],
  exports: [AttendanceService, ShiftsService]
})
export class AttendanceModule {}
