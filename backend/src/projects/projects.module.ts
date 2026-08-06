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
import { EventsModule } from '../events/events.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, EventsModule, NotificationsModule],
  controllers: [ProjectsController, IssuesController, BoardsController, LabelsController],
  providers: [ProjectsService, IssuesService, BoardsService, LabelsService]
})
export class ProjectsModule {}
