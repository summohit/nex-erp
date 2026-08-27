import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { AuthGuard } from '../auth/auth.guard';

@Controller('recruitment/jobs')
@UseGuards(AuthGuard)
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Get()
  findAll(@Request() req) {
    return this.jobsService.findAll(req.user.companyId);
  }

  @Get(':id/detail')
  getJobDetail(@Request() req, @Param('id') id: string) {
    return this.jobsService.getJobDetail(+id, req.user.companyId);
  }

  @Post()
  create(@Request() req, @Body() data: any) {
    return this.jobsService.create(req.user.companyId, data);
  }

  @Put(':id')
  update(@Request() req, @Param('id') id: string, @Body() data: any) {
    return this.jobsService.update(+id, req.user.companyId, data);
  }

  @Delete(':id')
  remove(@Request() req, @Param('id') id: string) {
    return this.jobsService.remove(+id, req.user.companyId);
  }
}

