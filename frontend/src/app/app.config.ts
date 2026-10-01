import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withNavigationErrorHandler } from '@angular/router';
import { routes } from './app.routes';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { authInterceptor } from './interceptors/auth.interceptor';
import { provideHotToastConfig } from '@ngneat/hot-toast';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';

/**
 * A deploy replaces the hashed code files. A tab opened before it still names
 * the old ones, and the first lazy screen it opens (e.g. the 2FA step) fails
 * with "Failed to fetch dynamically imported module". Reload once to pick up
 * the new build; the timestamp stops a genuinely broken file from looping.
 */
function reloadOnStaleBuild(error: unknown): void {
  const msg = String((error as any)?.message ?? error ?? '');
  if (!/dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk/i.test(msg)) return;
  const KEY = 'stale_build_reload_at';
  const last = Number(sessionStorage.getItem(KEY) || 0);
  if (Date.now() - last < 30_000) return;
  sessionStorage.setItem(KEY, String(Date.now()));
  window.location.reload();
}

if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (e) => reloadOnStaleBuild(e.reason));
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withNavigationErrorHandler((e) => reloadOnStaleBuild(e.error))),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideAnimationsAsync(),
    provideHotToastConfig({
      position: 'top-right',
      duration: 5000,
      autoClose: true,
      dismissible: true,
      success: {
        duration: 5000,
        dismissible: true,
      },
      error: {
        duration: 5000,
        dismissible: true,
      },
      warning: {
        duration: 5000,
        dismissible: true,
      },
      info: {
        duration: 5000,
        dismissible: true,
      }
    })
  ]
};
