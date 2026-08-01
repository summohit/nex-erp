import { Routes } from '@angular/router';
import { AuthComponent } from './auth/auth.component';
import { DashboardComponent } from './dashboard/dashboard.component';
import { MainLayoutComponent } from './layout/main-layout/main-layout';
import { authGuard } from './guards/auth.guard';
import { EmployeeListComponent } from './employees/employee-list/employee-list';
import { OnboardingComponent } from './employees/onboarding/onboarding';

export const routes: Routes = [
  { path: '', component: AuthComponent },
  { path: 'onboarding', loadComponent: () => import('./onboarding/onboarding.component').then(m => m.OnboardingComponent) },
  { path: 'careers/:companyId', loadComponent: () => import('./public/careers/careers').then(m => m.CareersComponent) },
  { path: 'careers', loadComponent: () => import('./public/careers/careers').then(m => m.CareersComponent) },
  { 
    path: 'projects/:id', 
    canActivate: [authGuard],
    loadComponent: () => import('./projects/project-detail/project-detail').then(m => m.ProjectDetailComponent) 
  },
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
        path: 'employees/org-chart',
        loadComponent: () => import('./employees/org-chart/org-chart').then(m => m.OrgChart)
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
      },
      {
        path: 'appreciation',
        loadComponent: () => import('./appreciation/appreciation').then(m => m.AppreciationComponent)
      },
      {
        path: 'appreciation/:tab',
        loadComponent: () => import('./appreciation/appreciation').then(m => m.AppreciationComponent)
      },
      {
        path: 'assets',
        redirectTo: 'assets/inventory',
        pathMatch: 'full'
      },
      {
        path: 'assets/:tab',
        loadComponent: () => import('./assets/assets').then(m => m.AssetsComponent)
      },
      {
        path: 'recruitment',
        redirectTo: 'recruitment/jobs',
        pathMatch: 'full'
      },
      {
        path: 'recruitment/jobs',
        loadComponent: () => import('./recruitment/job-postings/job-postings').then(m => m.JobPostingsComponent)
      },
      {
        path: 'recruitment/candidates',
        loadComponent: () => import('./recruitment/candidates/candidates').then(m => m.CandidatesComponent)
      },
      {
        path: 'recruitment/interviews',
        loadComponent: () => import('./recruitment/interviews/interviews').then(m => m.InterviewsComponent)
      },
      {
        path: 'projects',
        loadComponent: () => import('./projects/projects').then(m => m.ProjectsComponent)
      }
    ]
  },
  { path: '**', redirectTo: '' }
];
