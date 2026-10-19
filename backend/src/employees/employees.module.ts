import { ProfileCompletenessService } from './profile-completeness/profile-completeness.service';
import { Module } from '@nestjs/common';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { EmployeesImportService } from './employees-import.service';
import { PrismaModule } from '../prisma/prisma.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { MailModule } from '../mail/mail.module';
import { PayrollModule } from '../payroll/payroll.module';

@Module({
  imports: [PrismaModule, PermissionsModule, MailModule, PayrollModule],
  controllers: [EmployeesController],
  providers: [EmployeesService, EmployeesImportService, ProfileCompletenessService],
  exports: [EmployeesService]
})
export class EmployeesModule {}
