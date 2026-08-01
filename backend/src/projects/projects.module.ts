import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { IssuesController } from './issues/issues.controller';
import { IssuesService } from './issues/issues.service';
import { BoardsController } from './boards/boards.controller';
import { BoardsService } from './boards/boards.service';

import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ProjectsController, IssuesController, BoardsController],
  providers: [ProjectsService, IssuesService, BoardsService]
})
export class ProjectsModule {}
