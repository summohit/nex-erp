import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { PrismaModule } from './prisma/prisma.module';
import { UploadModule } from './upload/upload.module';
import { MasterDataModule } from './master-data/master-data.module';
import { CompanyModule } from './company/company.module';
import { PermissionsModule } from './permissions/permissions.module';
import { EmployeesModule } from './employees/employees.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { AttendanceModule } from './attendance/attendance.module';
import { LeavesModule } from './leaves/leaves.module';
import { PayrollModule } from './payroll/payroll.module';

@Module({
  imports: [AuthModule, UsersModule, PrismaModule, UploadModule, MasterDataModule, CompanyModule, PermissionsModule, EmployeesModule, OnboardingModule, AttendanceModule, LeavesModule, PayrollModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
