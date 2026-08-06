import { Module } from '@nestjs/common';
import { CompanySeederService } from './company-seeder.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [CompanySeederService],
  exports: [CompanySeederService],
})
export class CompanySeederModule {}
