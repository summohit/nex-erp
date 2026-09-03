import { Routes } from '@angular/router';
import { AuthComponent } from './auth/auth.component';
import { DashboardComponent } from './dashboard/dashboard.component';
import { MainLayoutComponent } from './layout/main-layout/main-layout';
import { authGuard } from './guards/auth.guard';
import { permissionGuard } from './guards/permission.guard';
import { EmployeeListComponent } from './employees/employee-list/employee-list';
import { OnboardingComponent } from './employees/onboarding/onboarding';
import { TimesheetsComponent } from './timesheets/timesheets.component';

export const routes: Routes = [
  // Public marketing site. Sign in / sign up live on their own routes so they can be
  // linked to directly (and so permissionGuard's existing '/login' redirect resolves).
  { path: '', pathMatch: 'full', loadComponent: () => import('./public/landing/landing').then(m => m.LandingComponent) },
  { path: 'login', component: AuthComponent, data: { view: 'login' } },
  { path: 'signup', component: AuthComponent, data: { view: 'register' } },
  { path: 'auth/check-email', loadComponent: () => import('./auth/check-email/check-email').then(m => m.CheckEmailComponent) },
  { path: 'auth/verify-email', loadComponent: () => import('./auth/verify-email/verify-email').then(m => m.VerifyEmailComponent) },
  { path: 'auth/forgot-password', loadComponent: () => import('./auth/forgot-password/forgot-password').then(m => m.ForgotPasswordComponent) },
  { path: 'kiosk/:companyId', loadComponent: () => import('./kiosk/kiosk').then(m => m.Kiosk) },
  { path: 'onboarding', loadComponent: () => import('./onboarding/onboarding.component').then(m => m.OnboardingComponent) },
  { path: 'careers/:companyId', loadComponent: () => import('./public/careers/careers').then(m => m.CareersComponent) },
  { path: 'lead-form/:formId', loadComponent: () => import('./public/lead-form/lead-form.component').then(m => m.PublicLeadFormComponent) },
  { path: 'careers', loadComponent: () => import('./public/careers/careers').then(m => m.CareersComponent) },
  { path: 'offer/:token', loadComponent: () => import('./public/offer-letter/offer-letter').then(m => m.OfferLetterComponent) },
  { 
    path: 'projects/onboarding/:id', 
    canActivate: [authGuard, permissionGuard],
    data: { module: 'projects' },
    loadComponent: () => import('./projects/project-wizard/project-wizard').then(m => m.ProjectWizardComponent) 
  },
  { 
    path: 'projects/:id', 
    canActivate: [authGuard, permissionGuard],
    data: { module: 'projects' },
    loadComponent: () => import('./projects/project-detail/project-detail').then(m => m.ProjectDetailComponent) 
  },
  { 
    path: '', 
    component: MainLayoutComponent, 
    canActivate: [authGuard],
    children: [
      { path: 'dashboard', component: DashboardComponent },
      { 
        path: 'timesheets',
        canActivate: [permissionGuard],
        data: { module: 'timesheets' },
        loadComponent: () => import('./timesheets/timesheets.component').then(m => m.TimesheetsComponent)
      },
      { 
        path: 'settings/master-data', 
        canActivate: [permissionGuard],
        data: { module: 'settings/master-data' },
        loadComponent: () => import('./settings/master-data/master-data').then(m => m.MasterDataComponent) 
      },
      {
        path: 'employees/directory',
        canActivate: [permissionGuard],
        data: { module: 'employees/directory' },
        component: EmployeeListComponent
      },
      {
        path: 'employees/onboarding',
        canActivate: [permissionGuard],
        data: { module: 'employees/onboarding' },
        component: OnboardingComponent
      },
      {
        path: 'employees/org-chart',
        canActivate: [permissionGuard],
        data: { module: 'employees/org-chart' },
        loadComponent: () => import('./employees/org-chart/org-chart').then(m => m.OrgChart)
      },
      {
        path: 'employees/documents',
        canActivate: [permissionGuard],
        data: { module: 'employees/documents' },
        loadComponent: () => import('./employees/documents/documents').then(m => m.EmployeeDocumentsComponent)
      },
      {
        path: 'performance',
        canActivate: [permissionGuard],
        data: { module: 'performance' },
        loadComponent: () => import('./performance/performance').then(m => m.PerformanceComponent)
      },
      {
        path: 'offboarding',
        canActivate: [permissionGuard],
        data: { module: 'offboarding' },
        loadComponent: () => import('./offboarding/offboarding').then(m => m.OffboardingComponent)
      },
      {
        path: 'employees/:id/profile',
        canActivate: [permissionGuard],
        data: { module: 'employees/me/profile' },
        loadComponent: () => import('./employees/employee-profile/employee-profile').then(m => m.EmployeeProfileComponent)
      },
      {
        path: 'settings/company',
        canActivate: [permissionGuard],
        data: { module: 'settings/company' },
        loadComponent: () => import('./settings/company-profile/company-profile').then(m => m.CompanyProfileComponent)
      },
      {
        path: 'settings/permissions',
        canActivate: [permissionGuard],
        data: { module: 'settings/permissions' },
        loadComponent: () => import('./settings/permissions/permissions.component').then(m => m.PermissionsComponent)
      },
      {
        path: 'settings/system',
        canActivate: [permissionGuard],
        data: { module: 'settings/system' },
        loadComponent: () => import('./settings/system-settings/system-settings').then(m => m.SystemSettingsComponent)
      },
      {
        path: 'settings/payroll',
        canActivate: [permissionGuard],
        data: { module: 'settings/company' }, // Re-using company permission for now
        loadComponent: () => import('./settings/payroll-settings/payroll-settings').then(m => m.PayrollSettingsComponent)
      },
      {
        path: 'attendance',
        redirectTo: 'attendance/my-attendance',
        pathMatch: 'full'
      },
      {
        path: 'attendance/all',
        canActivate: [permissionGuard],
        data: { module: 'attendance/all' },
        loadComponent: () => import('./attendance/all-attendance/all-attendance').then(m => m.AllAttendanceComponent)
      },
      {
        path: 'attendance/:tab',
        canActivate: [permissionGuard],
        data: { module: 'attendance' },
        loadComponent: () => import('./attendance-leave/attendance-leave').then(m => m.AttendanceLeaveComponent)
      },
      {
        path: 'payroll',
        redirectTo: 'payroll/processing',
        pathMatch: 'full'
      },
      {
        path: 'payroll/:tab',
        canActivate: [permissionGuard],
        data: { module: 'payroll' },
        loadComponent: () => import('./payroll/payroll').then(m => m.PayrollComponent)
      },
      {
        path: 'appreciation',
        canActivate: [permissionGuard],
        data: { module: 'appreciation' },
        loadComponent: () => import('./appreciation/appreciation').then(m => m.AppreciationComponent)
      },
      {
        path: 'appreciation/:tab',
        canActivate: [permissionGuard],
        data: { module: 'appreciation' },
        loadComponent: () => import('./appreciation/appreciation').then(m => m.AppreciationComponent)
      },
      {
        path: 'assets',
        redirectTo: 'assets/inventory',
        pathMatch: 'full'
      },
      {
        path: 'assets/:tab',
        canActivate: [permissionGuard],
        data: { module: 'assets' },
        loadComponent: () => import('./assets/assets').then(m => m.AssetsComponent)
      },
      {
        path: 'recruitment',
        redirectTo: 'recruitment/jobs',
        pathMatch: 'full'
      },
      {
        path: 'recruitment/jobs',
        canActivate: [permissionGuard],
        data: { module: 'recruitment/jobs' },
        loadComponent: () => import('./recruitment/job-postings/job-postings').then(m => m.JobPostingsComponent)
      },
      {
        path: 'recruitment/jobs/:id',
        canActivate: [permissionGuard],
        data: { module: 'recruitment/jobs' },
        loadComponent: () => import('./recruitment/job-detail/job-detail').then(m => m.JobDetailComponent)
      },
      {
        path: 'recruitment/candidates',
        canActivate: [permissionGuard],
        data: { module: 'recruitment/candidates' },
        loadComponent: () => import('./recruitment/candidates/candidates').then(m => m.CandidatesComponent)
      },
      {
        path: 'recruitment/interviews',
        canActivate: [permissionGuard],
        data: { module: 'recruitment/interviews' },
        loadComponent: () => import('./recruitment/interviews/interviews').then(m => m.InterviewsComponent)
      },
      {
        path: 'recruitment/reports',
        canActivate: [permissionGuard],
        data: { module: 'recruitment/candidates' },
        loadComponent: () => import('./recruitment/reports/reports').then(m => m.HiringReportsComponent)
      },
      {
        path: 'projects',
        canActivate: [permissionGuard],
        data: { module: 'projects' },
        loadComponent: () => import('./projects/projects').then(m => m.ProjectsComponent)
      },
      {
        // Shares the projects permission — field visits are always logged
        // against a project, so anyone who can see projects can see the visits.
        path: 'field-visits',
        canActivate: [permissionGuard],
        data: { module: 'projects' },
        loadComponent: () => import('./field-visits/field-visits-page').then(m => m.FieldVisitsPageComponent)
      },
      {
        path: 'clients',
        canActivate: [permissionGuard],
        data: { module: 'clients' },
        loadComponent: () => import('./clients/clients-list/clients-list.component').then(m => m.ClientsListComponent)
      },
      {
        path: 'clients/:id',
        canActivate: [permissionGuard],
        data: { module: 'clients' },
        loadComponent: () => import('./clients/client-profile/client-profile.component').then(m => m.ClientProfileComponent)
      },
      {
        // Open to every authenticated user — notifications are personal.
        path: 'notifications',
        loadComponent: () => import('./notifications/notifications-page').then(m => m.NotificationsPageComponent)
      },
      {
        // Open to every authenticated employee — anyone can raise a ticket.
        // Which tickets they actually see is scoped server-side.
        path: 'crm/tickets',
        loadComponent: () => import('./crm/tickets/tickets').then(m => m.TicketsComponent)
      },
      {
        path: 'crm/leads',
        canActivate: [permissionGuard],
        data: { module: 'crm/leads' },
        loadComponent: () => import('./crm/leads/leads').then(m => m.LeadsComponent)
      },
      {
        path: 'crm/leads/dashboard',
        canActivate: [permissionGuard],
        data: { module: 'crm/leads' },
        loadComponent: () => import('./crm/leads-dashboard/leads-dashboard').then(m => m.LeadsDashboardComponent)
      },
      {
        path: 'crm/lead-forms',
        canActivate: [permissionGuard],
        data: { module: 'crm/leads' },
        loadComponent: () => import('./crm/lead-forms/lead-forms.component').then(m => m.LeadFormsComponent)
      },
      {
        path: 'crm/lead-forms/:id',
        canActivate: [permissionGuard],
        data: { module: 'crm/leads' },
        loadComponent: () => import('./crm/lead-forms/lead-forms.component').then(m => m.LeadFormsComponent)
      },
      {
        path: 'crm/leads/:id',
        canActivate: [permissionGuard],
        data: { module: 'crm/leads' },
        loadComponent: () => import('./crm/lead-profile/lead-profile.component').then(m => m.LeadProfileComponent)
      },
      {
        path: 'crm/lead-contacts/:id',
        canActivate: [permissionGuard],
        data: { module: 'crm/leads' },
        loadComponent: () => import('./crm/lead-contact-profile/lead-contact-profile.component').then(m => m.LeadContactProfileComponent)
      },
      {
        path: 'sales/quotations',
        canActivate: [permissionGuard],
        data: { module: 'sales/quotations' },
        loadComponent: () => import('./sales/quotations/quotations').then(m => m.QuotationsComponent)
      },
      {
        path: 'sales/orders',
        canActivate: [permissionGuard],
        data: { module: 'sales/orders' },
        loadComponent: () => import('./sales/orders/orders').then(m => m.OrdersComponent)
      },
      {
        path: 'sales/pos',
        canActivate: [permissionGuard],
        data: { module: 'sales/pos' },
        loadComponent: () => import('./sales/pos/pos').then(m => m.PosComponent)
      },
      {
        path: 'sales/follow-ups',
        canActivate: [permissionGuard],
        data: { module: 'sales/follow-ups' },
        loadComponent: () => import('./sales/follow-ups/follow-ups').then(m => m.FollowUpsComponent)
      }
    ]
  },
  { path: '**', redirectTo: '' }
];
