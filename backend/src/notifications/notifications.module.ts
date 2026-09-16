import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsController } from './notifications.controller';
import { PushService } from './push/push.service';
import { DeviceTokensService } from './push/device-tokens.service';
import { PrismaModule } from '../prisma/prisma.module';
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [PrismaModule, JwtModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsGateway, PushService, DeviceTokensService],
  // PushService is exported so a caller with something to say that is NOT a
  // stored notification can still reach a device. Everything that should be
  // recorded must go through NotificationsService instead.
  exports: [NotificationsService, NotificationsGateway, PushService],
})
export class NotificationsModule {}
