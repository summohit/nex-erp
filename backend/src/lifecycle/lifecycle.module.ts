import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { LifecycleController } from './lifecycle.controller';
import { LifecycleService } from './lifecycle.service';

@Module({ imports: [NotificationsModule], controllers: [LifecycleController], providers: [LifecycleService] })
export class LifecycleModule {}
