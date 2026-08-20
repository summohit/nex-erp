import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { PrismaModule } from '../prisma/prisma.module';
import { LeavesModule } from '../leaves/leaves.module';
import { EmployeesModule } from '../employees/employees.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { PayrollModule } from '../payroll/payroll.module';
import { RecruitmentModule } from '../recruitment/recruitment.module';
import { CrmModule } from '../crm/crm.module';
import { SalesModule } from '../sales/sales.module';

@Module({
  imports: [PrismaModule, LeavesModule, EmployeesModule, OnboardingModule, PayrollModule, RecruitmentModule, CrmModule, SalesModule],
  controllers: [DashboardController],
  providers: [DashboardService]
})
export class DashboardModule {}
