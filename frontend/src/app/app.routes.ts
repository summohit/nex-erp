import { Routes } from '@angular/router';
import { AuthComponent } from './auth/auth.component';
import { DashboardComponent } from './dashboard/dashboard.component';
import { MainLayoutComponent } from './layout/main-layout/main-layout';
import { authGuard } from './guards/auth.guard';
import { EmployeeListComponent } from './employees/employee-list/employee-list';
import { OnboardingComponent } from './employees/onboarding/onboarding';

export const routes: Routes = [
  { path: '', component: AuthComponent },
  { 
    path: '', 
    component: MainLayoutComponent, 
    canActivate: [authGuard],
    children: [
      { path: 'dashboard', component: DashboardComponent },
      { 
        path: 'settings/master-data', 
        loadComponent: () => import('./settings/master-data/master-data').then(m => m.MasterDataComponent) 
      },
      {
        path: 'employees/directory',
        component: EmployeeListComponent
      },
      {
        path: 'employees/onboarding',
        component: OnboardingComponent
      },
      {
        path: 'employees/:id/profile',
        loadComponent: () => import('./employees/employee-profile/employee-profile').then(m => m.EmployeeProfileComponent)
      },
      {
        path: 'settings/company',
        loadComponent: () => import('./settings/company-profile/company-profile').then(m => m.CompanyProfileComponent)
      },
      {
        path: 'settings/permissions',
        loadComponent: () => import('./settings/permissions/permissions.component').then(m => m.PermissionsComponent)
      },
      {
        path: 'attendance/:tab',
        loadComponent: () => import('./attendance-leave/attendance-leave').then(m => m.AttendanceLeaveComponent)
      },
      {
        path: 'payroll',
        redirectTo: 'payroll/processing',
        pathMatch: 'full'
      },
      {
        path: 'payroll/:tab',
        loadComponent: () => import('./payroll/payroll').then(m => m.PayrollComponent)
      }
    ]
  },
  { path: '**', redirectTo: '' }
];
