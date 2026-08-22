import { Module } from '@nestjs/common';
import { FieldVisitsController } from './field-visits.controller';
import { FieldVisitsService } from './field-visits.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [FieldVisitsController],
  providers: [FieldVisitsService, PrismaService],
})
export class FieldVisitsModule {}
