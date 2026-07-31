import { Module } from '@nestjs/common';
import { AppreciationController } from './appreciation.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AppreciationController],
})
export class AppreciationModule {}
