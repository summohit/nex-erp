import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { AuthGuard } from '../auth/auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';

/**
 * Creating, editing and deleting job postings needs recruitment/jobs. Reading
 * them is also allowed to people who schedule or run interviews, whose forms
 * list the open jobs. Until now any signed-in employee could change them.
 */
@Controller('recruitment/jobs')
@UseGuards(AuthGuard, PermissionsGuard)
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Get()
  @Permissions('recruitment/jobs', 'recruitment/candidates', 'recruitment/interviews')
  findAll(@Request() req) {
    return this.jobsService.findAll(req.user.companyId);
  }

  @Get(':id/detail')
  @Permissions('recruitment/jobs', 'recruitment/candidates', 'recruitment/interviews')
  getJobDetail(@Request() req, @Param('id') id: string) {
    return this.jobsService.getJobDetail(+id, req.user.companyId);
  }

  @Post()
  @Permissions('recruitment/jobs')
  create(@Request() req, @Body() data: any) {
    return this.jobsService.create(req.user.companyId, data);
  }

  @Put(':id')
  @Permissions('recruitment/jobs')
  update(@Request() req, @Param('id') id: string, @Body() data: any) {
    return this.jobsService.update(+id, req.user.companyId, data);
  }

  @Delete(':id')
  @Permissions('recruitment/jobs')
  remove(@Request() req, @Param('id') id: string) {
    return this.jobsService.remove(+id, req.user.companyId);
  }
}

