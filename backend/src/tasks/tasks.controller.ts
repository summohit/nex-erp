import {
  Controller, Get, Post, Body, Query, Request, UseGuards, ParseIntPipe, Param, Delete,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { TasksService } from './tasks.service';

/**
 * Tasks live outside `projects/:projectId` on purpose: the whole point is work
 * that spans projects, deals and neither. The project-nested issue routes stay
 * exactly as they are for everything a board does.
 */
@Controller('tasks')
@UseGuards(AuthGuard)
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  /** What the current user may do — so the UI does not re-implement the rule. */
  @Get('capabilities')
  async capabilities(@Request() req) {
    return this.tasks.getCapabilities(req.user.companyId, req.user.employeeId, req.user.role);
  }

  /**
   * `scope=all` is the administrator's company-wide view. It is not rejected
   * for anyone else — the service downgrades it to 'mine' and says so in the
   * response — because the toggle is only rendered for admins and a 403 here
   * would be an error page for a query string nobody typed.
   */
  @Get('my')
  async myTasks(
    @Request() req,
    @Query('includeReported') includeReported?: string,
    @Query('includeDone') includeDone?: string,
    @Query('scope') scope?: string,
  ) {
    return this.tasks.getMyTasks(req.user.companyId, req.user.employeeId, req.user.role, {
      includeReported: includeReported === 'true',
      includeDone: includeDone === 'true',
      scope: scope === 'all' ? 'all' : 'mine',
    });
  }

  @Post()
  async create(@Request() req, @Body() body: any) {
    return this.tasks.createTask(req.user.companyId, req.user.employeeId, req.user.role, body);
  }

  @Post(':id/dependencies')
  async addDependency(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { dependsOnIssueId: number },
  ) {
    return this.tasks.addDependency(
      req.user.companyId, req.user.employeeId, req.user.role, id, Number(body?.dependsOnIssueId),
    );
  }

  @Delete(':id/dependencies/:dependencyId')
  async removeDependency(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Param('dependencyId', ParseIntPipe) dependencyId: number,
  ) {
    return this.tasks.removeDependency(req.user.companyId, id, dependencyId);
  }
}
