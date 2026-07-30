import { Module } from '@nestjs/common';
import { MasterDataController } from './master-data.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [MasterDataController],
})
export class MasterDataModule {}
