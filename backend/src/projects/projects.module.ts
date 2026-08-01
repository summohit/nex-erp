import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { IssuesController } from './issues/issues.controller';
import { IssuesService } from './issues/issues.service';
import { BoardsController } from './boards/boards.controller';
import { BoardsService } from './boards/boards.service';
import { LabelsController } from './labels/labels.controller';
import { LabelsService } from './labels/labels.service';

import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ProjectsController, IssuesController, BoardsController, LabelsController],
  providers: [ProjectsService, IssuesService, BoardsService, LabelsService]
})
export class ProjectsModule {}
