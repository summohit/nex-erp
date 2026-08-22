import { Controller, Get, Post, Put, Delete, Patch, Body, Param, ParseIntPipe, Req, UseGuards } from '@nestjs/common';
import { BoardsService } from './boards.service';
import { AuthGuard } from '../../auth/auth.guard';

@UseGuards(AuthGuard)
@Controller('projects/:projectId/boards')
export class BoardsController {
  constructor(private readonly boardsService: BoardsService) {}

  @Get()
  getBoard(@Req() req, @Param('projectId', ParseIntPipe) projectId: number) {
    return this.boardsService.getBoard(req.user.companyId, projectId);
  }

  @Post('columns')
  createColumn(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() data: { name: string, color?: string }
  ) {
    const employeeId = req.user.employeeId ?? req.user.sub;
    return this.boardsService.createColumn(req.user.companyId, projectId, data, employeeId, req.user.role);
  }

  @Put('columns/reorder')
  reorderColumns(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() body: { columnIds: number[] }
  ) {
    return this.boardsService.reorderColumns(req.user.companyId, projectId, body.columnIds);
  }

  @Put('columns/:columnId')
  updateColumn(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('columnId', ParseIntPipe) columnId: number,
    @Body() data: { color?: string, name?: string, position?: number }
  ) {
    const employeeId = req.user.employeeId ?? req.user.sub;
    return this.boardsService.updateColumn(req.user.companyId, projectId, columnId, data, employeeId, req.user.role);
  }

  @Delete('columns/:columnId')
  deleteColumn(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('columnId', ParseIntPipe) columnId: number,
    @Req() req: any
  ) {
    return this.boardsService.deleteColumn(req.user.companyId, projectId, columnId);
  }

  @Get('columns/archived')
  getArchivedColumns(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Req() req: any
  ) {
    return this.boardsService.getArchivedColumns(req.user.companyId, projectId);
  }

  @Patch('columns/:columnId/unarchive')
  unarchiveColumn(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('columnId', ParseIntPipe) columnId: number,
    @Req() req: any
  ) {
    return this.boardsService.unarchiveColumn(req.user.companyId, projectId, columnId);
  }
}
