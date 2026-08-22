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
import { AppreciationModule } from './appreciation/appreciation.module';
import { AssetsModule } from './assets/assets.module';
import { AiModule } from './ai/ai.module';
import { PublicJobsModule } from './public-jobs/public-jobs.module';
import { RecruitmentModule } from './recruitment/recruitment.module';
import { ProjectsModule } from './projects/projects.module';
import { MailModule } from './mail/mail.module';
import { CompanySeederModule } from './company-seeder/company-seeder.module';
import { NotificationsModule } from './notifications/notifications.module';
import { EventsModule } from './events/events.module';
import { MenusModule } from './menus/menus.module';
import { PerformanceModule } from './performance/performance.module';
import { OffboardingModule } from './offboarding/offboarding.module';
import { KioskModule } from './kiosk/kiosk.module';
import { ClientsModule } from './clients/clients.module';
import { CrmModule } from './crm/crm.module';
import { SalesModule } from './sales/sales.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { FieldVisitsModule } from './field-visits/field-visits.module';

@Module({
  imports: [AuthModule, UsersModule, PrismaModule, UploadModule, MasterDataModule, CompanyModule, PermissionsModule, EmployeesModule, OnboardingModule, AttendanceModule, LeavesModule, PayrollModule, AppreciationModule, AssetsModule, AiModule, PublicJobsModule, RecruitmentModule, ProjectsModule, MailModule, CompanySeederModule, NotificationsModule, EventsModule, MenusModule, PerformanceModule, OffboardingModule, KioskModule, ClientsModule, CrmModule, SalesModule, DashboardModule, FieldVisitsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
