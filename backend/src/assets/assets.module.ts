import { Module } from '@nestjs/common';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PermissionsModule } from '../permissions/permissions.module';

@Module({
  imports: [PrismaModule, NotificationsModule, PermissionsModule],
  controllers: [AssetsController],
  providers: [AssetsService],
  exports: [AssetsService]
})
export class AssetsModule {}
