import { Controller, Get, Post, Param, Body, ParseIntPipe } from '@nestjs/common';
import { PublicJobsService, CandidateApplicationDto } from './public-jobs.service';
import { Buffer } from 'buffer';

@Controller('public')
export class PublicJobsController {
  constructor(private readonly publicJobsService: PublicJobsService) {}

  @Get('jobs')
  async getOpenJobs() {
    return await this.publicJobsService.getOpenJobs();
  }

  // New endpoint: get jobs for a specific company (companyId is base64‑encoded)
  @Get('jobs/:encryptedId')
  async getJobsByCompany(@Param('encryptedId') encryptedId: string) {
    const companyId = Buffer.from(encryptedId, 'base64').toString('utf-8');
    return await this.publicJobsService.getJobsByCompanyId(companyId);
  }

  @Get('jobs/:id')
  async getJobById(@Param('id', ParseIntPipe) id: number) {
    return await this.publicJobsService.getJobById(id);
  }

  @Post('applications')
  async submitApplication(@Body() dto: CandidateApplicationDto) {
    return await this.publicJobsService.submitApplication(dto);
  }

  @Get('applications')
  async getApplications() {
    return await this.publicJobsService.getApplications();
  }
}
