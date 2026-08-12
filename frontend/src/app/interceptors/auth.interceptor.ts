import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError, from } from 'rxjs';
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
      if (error.status === 401 && !req.url.includes('/auth/login') && !req.url.includes('/auth/signup') && !req.url.includes('/auth/forgot-password') && !req.url.includes('/auth/reset-password') && !req.url.includes('/auth/reset-password-email')) {
        return from(sessionModal.prompt()).pipe(
          switchMap((shouldContinue) => {
            if (shouldContinue) {
              return authService.refreshToken().pipe(
                switchMap(() => {
                  // Retry original request with new token
                  const newToken = localStorage.getItem('access_token');
                  const clonedReq = req.clone({
                    setHeaders: { Authorization: `Bearer ${newToken}` }
                  });
                  return next(clonedReq);
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
