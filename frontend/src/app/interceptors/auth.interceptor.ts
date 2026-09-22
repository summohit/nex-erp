import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError, EMPTY } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { Router } from '@angular/router';
import { getAccessToken } from '../core/token-storage';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = getAccessToken();
  
  // Skip interceptor for refresh endpoint to prevent infinite loop
  if (req.url.includes('/auth/refresh')) {
    return next(req);
  }

  if (token) {
    req = req.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`
      }
    });
  }
  
  const authService = inject(AuthService);
  const router = inject(Router);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      // The 2fa/challenge routes are excluded because a wrong code legitimately
      // answers 401 there, and popping the session-expired modal mid sign-in
      // would strand the user. The AUTHENTICATED /auth/2fa routes are NOT
      // excluded: they answer 403 for a wrong code, so a 401 from them really
      // does mean an expired token worth refreshing.
      if (error.status === 401 && !req.url.includes('/auth/login') && !req.url.includes('/auth/signup') && !req.url.includes('/auth/forgot-password') && !req.url.includes('/auth/reset-password') && !req.url.includes('/auth/reset-password-email') && !req.url.includes('/auth/2fa/challenge')) {
        /**
         * Renew silently. Do not ask.
         *
         * The access token lasts an hour, the refresh token a week, so a 401
         * here almost always means "away from the tab for a while" rather than
         * "signed out". This used to open a red Session Expired dialog offering
         * Continue or Log Out, and people reasonably read that as having been
         * signed out already and clicked Log Out -- landing them back at the
         * password screen and a fresh two-factor code, with a week of valid
         * session still sitting unused in storage.
         *
         * The prompt now only appears when renewal genuinely fails, which is
         * the case where signing in again is the actual answer.
         */
        return authService.refreshSession().pipe(
          switchMap(() => {
            /**
             * Reload rather than retry the one request that failed.
             *
             * A screen usually fires several requests at once, and an expired
             * token fails all of them. Retrying only the one that happened to
             * trigger this leaves the rest of the page holding the errors they
             * already got -- empty lists, missing counts, a board with no
             * cards -- which reads as a broken app even though the session is
             * now perfectly good.
             */
            window.location.reload();
            return EMPTY;
          }),
          catchError((refreshErr) => {
            authService.logout();
            router.navigate(['/login']);
            return throwError(() => refreshErr);
          }),
        );
      }
      return throwError(() => error);
    })
  );
};
