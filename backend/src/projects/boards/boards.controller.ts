import { Controller, Get, Post, Put, Delete, Body, Param, ParseIntPipe, Req, UseGuards } from '@nestjs/common';
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
    return this.boardsService.createColumn(req.user.companyId, projectId, data);
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
    return this.boardsService.updateColumn(req.user.companyId, projectId, columnId, data);
  }

  @Delete('columns/:columnId')
  deleteColumn(
    @Req() req,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('columnId', ParseIntPipe) columnId: number
  ) {
    return this.boardsService.deleteColumn(req.user.companyId, projectId, columnId);
  }
}
