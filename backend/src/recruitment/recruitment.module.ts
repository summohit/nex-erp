import { Module } from '@nestjs/common';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';

import { PrismaModule } from '../prisma/prisma.module';
import { PayrollModule } from '../payroll/payroll.module';

@Module({
  imports: [PrismaModule, PayrollModule],
  controllers: [JobsController, ApplicationsController],
  providers: [JobsService, ApplicationsService],
  exports: [ApplicationsService]
})
export class RecruitmentModule {}
