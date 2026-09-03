import { Module } from '@nestjs/common';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';

import { PrismaModule } from '../prisma/prisma.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, PermissionsModule, NotificationsModule],
  controllers: [SalesController],
  providers: [SalesService],
  exports: [SalesService]
})
export class SalesModule {}
