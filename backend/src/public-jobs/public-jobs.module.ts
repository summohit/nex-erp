import { Module } from '@nestjs/common';
import { PublicJobsController } from './public-jobs.controller';
import { PublicJobsService } from './public-jobs.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [PublicJobsController],
  providers: [PublicJobsService],
  exports: [PublicJobsService],
})
export class PublicJobsModule {}
