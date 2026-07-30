import { Module } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { AttendanceController } from './attendance.controller';
import { ShiftsService } from './shifts.service';
import { ShiftsController } from './shifts.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AttendanceController, ShiftsController],
  providers: [AttendanceService, ShiftsService],
  exports: [AttendanceService, ShiftsService]
})
export class AttendanceModule {}
