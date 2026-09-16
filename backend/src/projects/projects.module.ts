import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { ProjectAiService } from './project-ai.service';
import { IssuesController } from './issues/issues.controller';
import { IssuesService } from './issues/issues.service';
import { BoardsController } from './boards/boards.controller';
import { BoardsService } from './boards/boards.service';
import { LabelsController } from './labels/labels.controller';
import { LabelsService } from './labels/labels.service';
import { MilestonesController } from './milestones/milestones.controller';
import { MilestonesService } from './milestones/milestones.service';
import { IssueRemindersCron } from './issues/issue-reminders.cron';

import { PrismaModule } from '../prisma/prisma.module';
import { EventsModule } from '../events/events.module';
import { NotificationsModule } from '../notifications/notifications.module';
// For resolving a chosen lead contact to the Client a project is saved against.
import { CrmModule } from '../crm/crm.module';

@Module({
  imports: [PrismaModule, EventsModule, NotificationsModule, CrmModule],
  controllers: [ProjectsController, IssuesController, BoardsController, LabelsController, MilestonesController],
  providers: [ProjectsService, ProjectAiService, IssuesService, BoardsService, LabelsService, MilestonesService, IssueRemindersCron]
})
export class ProjectsModule {}
