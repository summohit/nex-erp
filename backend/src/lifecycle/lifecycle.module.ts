import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { LifecycleController } from './lifecycle.controller';
import { LifecycleService } from './lifecycle.service';
import { ProbationReminderCron } from './probation-reminder.cron';

@Module({ imports: [NotificationsModule], controllers: [LifecycleController], providers: [LifecycleService, ProbationReminderCron] })
export class LifecycleModule {}
