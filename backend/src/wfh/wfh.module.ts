import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { WfhController } from './wfh.controller';
import { WfhService } from './wfh.service';

@Module({ imports: [NotificationsModule], controllers: [WfhController], providers: [WfhService], exports: [WfhService] })
export class WfhModule {}
