import { inject } from '@angular/core';
import { Router, CanActivateFn, ActivatedRouteSnapshot } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { PermissionsService } from '../services/permissions.service';
import { HotToastService } from '@ngneat/hot-toast';
import { of, map, catchError } from 'rxjs';

export const permissionGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
  const router = inject(Router);
  const authService = inject(AuthService);
  const permissionsService = inject(PermissionsService);
  const toast = inject(HotToastService);

  const targetModule = route.data['module'] as string;
  const targetAction = (route.data['action'] as string) || 'VIEW';

  if (!targetModule) {
    return true; // No module restriction set on route
  }

  const currentUser = authService.currentUser();

  // SUPERADMIN always has access
  if (currentUser?.role === 'SUPERADMIN') {
    return true;
  }

  const userRole = currentUser?.role || 'EMPLOYEE';

  return permissionsService.getAllPermissions(userRole).pipe(
    map(perms => {
      // Check if user role has explicit VIEW or requested action permission for targetModule
      const hasAccess = perms && perms.some(p => p.module === targetModule && (p.action === targetAction || p.action === 'VIEW'));

      if (hasAccess) {
        return true;
      }

      // Hardcoded fallback checks for standard roles if database matrix is unseeded
      if (userRole === 'ADMIN') {
        return true; // Admin has fallback access to all standard management routes
      }

      if (userRole === 'HR' && ['employees', 'attendance', 'recruitment', 'appreciation', 'overview'].includes(targetModule)) {
        return true;
      }

      if (userRole === 'FINANCE' && ['payroll', 'expenses', 'appreciation', 'assets', 'overview'].includes(targetModule)) {
        return true;
      }

      if (userRole === 'EMPLOYEE' && ['overview', 'employees/me/profile', 'attendance/my-attendance', 'payroll/my-payslips'].includes(targetModule)) {
        return true;
      }

      // Access Denied
      toast.error('Access Denied: You do not have permission to view this page.');
      router.navigate(['/overview']);
      return false;
    }),
    catchError(() => {
      toast.error('Permission check failed');
      router.navigate(['/overview']);
      return of(false);
    })
  );
};
