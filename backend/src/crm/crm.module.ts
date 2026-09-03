import { Module } from '@nestjs/common';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';

import { PrismaModule } from '../prisma/prisma.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, PermissionsModule, NotificationsModule],
  controllers: [CrmController],
  providers: [CrmService],
  exports: [CrmService]
})
export class CrmModule {}
