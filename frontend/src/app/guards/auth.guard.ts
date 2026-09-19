import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { HotToastService } from '@ngneat/hot-toast';
import { getAccessToken } from '../core/token-storage';

export const authGuard: CanActivateFn = (route, state) => {
  const router = inject(Router);
  const toast = inject(HotToastService);
  const token = getAccessToken();

  if (token) {
    return true;
  }

  toast.error('You must be logged in to access the dashboard.');
  return router.parseUrl('/login');
};
