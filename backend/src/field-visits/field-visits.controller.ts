import { Controller, Get, Post, Body, Param, UseGuards, Request, ParseIntPipe } from '@nestjs/common';
import { FieldVisitsService } from './field-visits.service';
import { AuthGuard } from '../auth/auth.guard';

@Controller('field-visits')
@UseGuards(AuthGuard)
export class FieldVisitsController {
  constructor(private readonly fieldVisitsService: FieldVisitsService) {}

  @Post('start')
  start(@Request() req, @Body() body: {
    projectId: number;
    startLat: number;
    startLng: number;
    startAddress?: string;
    purpose?: string;
  }) {
    return this.fieldVisitsService.startVisit(req.user.sub, req.user.companyId, body);
  }

  @Post(':id/end')
  end(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: {
      endLat: number;
      endLng: number;
      endAddress?: string;
      distanceKm: number;
      durationMins: number;
      routePoints?: number[][];
      notes?: string;
    },
  ) {
    return this.fieldVisitsService.endVisit(req.user.sub, id, body);
  }

  @Post(':id/cancel')
  cancel(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.fieldVisitsService.cancelVisit(req.user.sub, id);
  }

  @Post(':id/photos')
  addPhoto(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { url: string; takenAt: string; caption?: string },
  ) {
    return this.fieldVisitsService.addPhoto(req.user.sub, id, body);
  }

  @Get('active')
  getActive(@Request() req) {
    return this.fieldVisitsService.getActiveVisit(req.user.sub);
  }

  @Get('me')
  getMine(@Request() req) {
    return this.fieldVisitsService.getMyVisits(req.user.sub);
  }

  @Get('project/:projectId')
  getByProject(@Param('projectId', ParseIntPipe) projectId: number) {
    return this.fieldVisitsService.getProjectVisits(projectId);
  }

  @Get(':id')
  getOne(@Param('id', ParseIntPipe) id: number) {
    return this.fieldVisitsService.getVisitById(id);
  }
}
