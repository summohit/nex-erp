import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError, from, EMPTY } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { SessionModalService } from '../services/session-modal.service';
import { Router } from '@angular/router';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = localStorage.getItem('access_token');
  
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
  const sessionModal = inject(SessionModalService);
  const router = inject(Router);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      // The 2fa/challenge routes are excluded because a wrong code legitimately
      // answers 401 there, and popping the session-expired modal mid sign-in
      // would strand the user. The AUTHENTICATED /auth/2fa routes are NOT
      // excluded: they answer 403 for a wrong code, so a 401 from them really
      // does mean an expired token worth refreshing.
      if (error.status === 401 && !req.url.includes('/auth/login') && !req.url.includes('/auth/signup') && !req.url.includes('/auth/forgot-password') && !req.url.includes('/auth/reset-password') && !req.url.includes('/auth/reset-password-email') && !req.url.includes('/auth/2fa/challenge')) {
        return from(sessionModal.prompt()).pipe(
          switchMap((shouldContinue) => {
            if (shouldContinue) {
              return authService.refreshToken().pipe(
                switchMap(() => {
                  /**
                   * Reload rather than retry the one request that failed.
                   *
                   * A screen usually fires several requests at once, and an
                   * expired token fails all of them. Retrying only the one
                   * that happened to trigger this modal leaves the rest of the
                   * page holding the errors they already got -- empty lists,
                   * missing counts, a board with no cards -- which reads as a
                   * broken app even though the session is now perfectly good.
                   *
                   * The token has already been refreshed and stored, so the
                   * reload comes back authenticated. EMPTY completes without
                   * emitting, so nothing downstream acts on a response while
                   * the page is being torn down.
                   */
                  window.location.reload();
                  return EMPTY;
                }),
                catchError((refreshErr) => {
                  authService.logout();
                  router.navigate(['/login']);
                  return throwError(() => refreshErr);
                })
              );
            } else {
              authService.logout();
              router.navigate(['/login']);
              return throwError(() => new Error('User chose to logout'));
            }
          })
        );
      }
      return throwError(() => error);
    })
  );
};
