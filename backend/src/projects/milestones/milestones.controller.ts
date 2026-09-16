import { Controller, Get, Post, Put, Delete, Body, Param, Req, UseGuards, ParseIntPipe } from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard';
import { MilestonesService } from './milestones.service';

@UseGuards(AuthGuard)
@Controller('projects')
export class MilestonesController {
  constructor(private readonly milestones: MilestonesService) {}

  @Get(':projectId/milestones')
  list(@Req() req, @Param('projectId', ParseIntPipe) projectId: number) {
    return this.milestones.list(req.user.companyId, req.user.employeeId ?? null, req.user.role, projectId);
  }

  @Post(':projectId/milestones')
  create(@Req() req, @Param('projectId', ParseIntPipe) projectId: number, @Body() data: any) {
    return this.milestones.create(req.user.companyId, req.user.employeeId ?? null, req.user.role, projectId, data);
  }

  @Put(':projectId/milestones/reorder')
  reorder(@Req() req, @Param('projectId', ParseIntPipe) projectId: number, @Body() body: { orderedIds: number[] }) {
    return this.milestones.reorder(req.user.companyId, req.user.employeeId ?? null, req.user.role, projectId, body?.orderedIds || []);
  }

  // Milestone ids are unique company-wide, so these two do not need the
  // project segment to find the row — it stays for a readable URL, and the
  // service still checks the milestone's own project for authorisation.
  @Put(':projectId/milestones/:id')
  update(@Req() req, @Param('id', ParseIntPipe) id: number, @Body() data: any) {
    return this.milestones.update(req.user.companyId, req.user.employeeId ?? null, req.user.role, id, data);
  }

  @Delete(':projectId/milestones/:id')
  remove(@Req() req, @Param('id', ParseIntPipe) id: number) {
    return this.milestones.remove(req.user.companyId, req.user.employeeId ?? null, req.user.role, id);
  }
}
