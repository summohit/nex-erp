import { Module } from '@nestjs/common';
import { CompanySeederService } from './company-seeder.service';

@Module({
  providers: [CompanySeederService],
  exports: [CompanySeederService],
})
export class CompanySeederModule {}
