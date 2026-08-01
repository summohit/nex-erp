import { Controller, Post, Get, Body, Req, UseGuards, Param, ParseIntPipe } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { AuthGuard } from '../auth/auth.guard';

@UseGuards(AuthGuard)
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  createProject(@Req() req, @Body() data: { name: string, description?: string, color?: string, icon?: string }) {
    return this.projectsService.createProject(req.user.companyId, req.user.sub, data);
  }

  @Get()
  getProjects(@Req() req) {
    return this.projectsService.getProjects(req.user.companyId, req.user.sub, req.user.role);
  }

  @Get(':id')
  getProjectDetails(@Req() req, @Param('id', ParseIntPipe) id: number) {
    return this.projectsService.getProjectDetails(req.user.companyId, id, req.user.sub, req.user.role);
  }
}
