import { Module } from '@nestjs/common';
import { FieldVisitsController } from './field-visits.controller';
import { FieldVisitsService } from './field-visits.service';
import { FieldVisitRequestsController } from './requests/field-visit-requests.controller';
import { FieldVisitRequestsService } from './requests/field-visit-requests.service';
import { FieldVisitActivationService } from './requests/field-visit-activation.service';
import { PrismaService } from '../prisma/prisma.service';
import { FieldVisitClockController } from './requests/field-visit-clock.controller';
import { FieldVisitClockService } from './requests/field-visit-clock.service';
import { NotificationsModule } from '../notifications/notifications.module';
// The field visit clock delegates the attendance record itself rather than
// keeping a second implementation of open sessions, lateness and half days.
import { AttendanceModule } from '../attendance/attendance.module';

@Module({
  imports: [NotificationsModule, AttendanceModule],
  controllers: [FieldVisitsController, FieldVisitRequestsController, FieldVisitClockController],
  providers: [
    FieldVisitsService, FieldVisitRequestsService, FieldVisitActivationService,
    FieldVisitClockService, PrismaService,
  ],
  // Exported for LeavesService: approving leave over a trip has to give those
  // days back, and the logic for what that means lives with the fan-out that
  // created them.
  exports: [FieldVisitActivationService],
})
export class FieldVisitsModule {}
