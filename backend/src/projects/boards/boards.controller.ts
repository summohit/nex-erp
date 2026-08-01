import { Controller, Get, Param, ParseIntPipe, Req, UseGuards } from '@nestjs/common';
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
}
