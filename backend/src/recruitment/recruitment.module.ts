import { Module } from '@nestjs/common';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';

import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [JobsController, ApplicationsController],
  providers: [JobsService, ApplicationsService]
})
export class RecruitmentModule {}
