import { inject } from '@angular/core';
import { Router, CanActivateFn, UrlTree } from '@angular/router';
import { of, catchError, map, switchMap } from 'rxjs';
import { AuthService } from '../services/auth.service';

/**
 * The Attendance tab is one screen, and who it shows depends on the role.
 *
 * "My attendance" and "All People Attendance" used to be two pages the person
 * chose between. They are now the same page: click Attendance and a Super Admin
 * or HR lands on everybody's attendance, while everyone else lands on their own
 * and never sees another person's record.
 *
 * This guard is what decides that. It only acts on the self-service attendance
 * tabs — the other tabs under Attendance & Leave (leaves, approvals,
 * balances, shifts, timeline, holidays) are unchanged and are deliberately not
 * rewritten here: hiding a role from its own leave request would be a
 * different decision.
 */

/** The route segments that mean "the attendance screen itself". */
const SELF_SERVICE_TABS = ['attendance', 'my-attendance', 'timesheets'];

/**
 * This deliberately does not mirror backend `isHrAdmin`: that helper includes
 * ADMIN, while the product rule for attendance is stricter — only Super Admin
 * and HR may see everybody's records.
 */
function seesEveryonesAttendance(role: string | null | undefined): boolean {
  // This is intentionally narrower than general administration. The merged
  // Attendance screen contains every employee's attendance, so only the
  // company owner and HR may enter it.
  return role === 'SUPERADMIN' || role === 'SUPER_ADMIN' || role === 'HR';
}

/** Blocks direct navigation to the company-wide route for every other role. */
export const companyAttendanceGuard: CanActivateFn = () => {
  const router = inject(Router);
  const authService = inject(AuthService);

  const decide = (user: any): boolean | UrlTree =>
    seesEveryonesAttendance(user?.role)
      ? true
      : router.parseUrl('/attendance/timesheets');

  const currentUser = authService.currentUser();
  if (currentUser) return decide(currentUser);
  if (!authService.getToken()) return router.parseUrl('/login');

  return authService.getMe().pipe(
    map(decide),
    catchError(() => of(router.parseUrl('/login'))),
  );
};

export const attendanceLandingGuard: CanActivateFn = (route) => {
  const router = inject(Router);
  const authService = inject(AuthService);

  const tab = route.paramMap.get('tab') ?? '';
  if (!SELF_SERVICE_TABS.includes(tab)) return true;

  const decide = (user: any): boolean | UrlTree => {
    if (!seesEveryonesAttendance(user?.role)) return true;
    return router.parseUrl('/attendance/all');
  };

  const currentUser = authService.currentUser();
  if (currentUser) return decide(currentUser);

  // Token exists but the user has not loaded yet — a hard refresh on a deep link.
  if (!authService.getToken()) return router.parseUrl('/login');

  return authService.getMe().pipe(
    map(decide),
    catchError(() => of(router.parseUrl('/login'))),
  );
};

/**
 * The bare `/attendance` entry point, for the sidebar group heading. Sends the
 * same roles to the same place as attendanceLandingGuard, and everyone else to
 * their own attendance.
 */
export const attendanceHomeGuard: CanActivateFn = () => {
  const router = inject(Router);
  const authService = inject(AuthService);

  const decide = (user: any): UrlTree =>
    router.parseUrl(seesEveryonesAttendance(user?.role) ? '/attendance/all' : '/attendance/timesheets');

  const currentUser = authService.currentUser();
  if (currentUser) return decide(currentUser);

  if (!authService.getToken()) return router.parseUrl('/login');

  return authService.getMe().pipe(
    map(decide),
    catchError(() => of(router.parseUrl('/login'))),
  );
};
