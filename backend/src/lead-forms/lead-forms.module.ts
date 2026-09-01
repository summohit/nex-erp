import { Module } from '@nestjs/common';
import { LeadFormsController } from './lead-forms.controller';
import { PublicLeadFormController } from './public-lead-form.controller';
import { LeadFormsService } from './lead-forms.service';
import { PrismaModule } from '../prisma/prisma.module';
import { CrmModule } from '../crm/crm.module';
import { PermissionsModule } from '../permissions/permissions.module';

@Module({
  imports: [PrismaModule, CrmModule, PermissionsModule],
  controllers: [LeadFormsController, PublicLeadFormController],
  providers: [LeadFormsService],
  exports: [LeadFormsService],
})
export class LeadFormsModule {}
