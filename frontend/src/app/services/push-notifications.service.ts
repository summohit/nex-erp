import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

/**
 * Web push registration.
 *
 * WHY THE APP NEEDS THIS AT ALL
 *
 * Notifications already arrive over Socket.IO, which reaches exactly one kind
 * of recipient: someone with the tab open. A shift reminder is by definition
 * sent to someone whose tab is closed, so it needs a channel the browser can
 * deliver without the page running. That is a service worker plus FCM.
 *
 * WHEN PERMISSION IS ASKED FOR
 *
 * Not on load. A permission prompt that appears before the user has done
 * anything is the one they reflexively dismiss, and `denied` is sticky — the
 * browser will not ask again, and the only cure is the site settings panel most
 * people never open. `enable()` is therefore called from an explicit action.
 * `resumeIfAlreadyGranted()` is the silent path for a user who has already said
 * yes, which is every subsequent visit.
 */
/** The public Firebase values a browser needs, served by the backend. */
export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  vapidKey: string;
}

@Injectable({ providedIn: 'root' })
export class PushNotificationsService {
  private http = inject(HttpClient);
  private registeredToken: string | null = null;
  private configPromise: Promise<FirebaseWebConfig | null> | null = null;

  /** Whether this browser can do web push at all (Safari < 16.4, http:, etc.). */
  get isSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'Notification' in window &&
      'PushManager' in window
    );
  }

  get permission(): NotificationPermission | 'unsupported' {
    return this.isSupported ? Notification.permission : 'unsupported';
  }

  /**
   * The Firebase config, fetched from the server rather than compiled in.
   *
   * environment.prod.ts would mean rebuilding and redeploying the bundle to
   * change Firebase project — or to set one up at all. Serving it keeps the
   * whole thing to one file on the server. Cached for the session because it
   * cannot change without a backend restart anyway.
   */
  private loadConfig(): Promise<FirebaseWebConfig | null> {
    if (!this.configPromise) {
      this.configPromise = firstValueFrom(
        this.http.get<{ enabled: boolean; config: FirebaseWebConfig | null }>(
          `${environment.apiUrl}/notifications/push-config`,
        ),
      )
        .then(res => (res?.enabled ? res.config : null))
        .catch(() => null);
    }
    return this.configPromise;
  }

  /**
   * Turn push on, asking permission if it has not been asked yet.
   *
   * Returns false rather than throwing for every "no": unsupported browser,
   * unconfigured project, user declined. A caller wiring this to a toggle wants
   * a boolean, not a try/catch.
   */
  async enable(): Promise<boolean> {
    if (!this.isSupported) return false;
    const config = await this.loadConfig();
    if (!config) return false;

    const permission = Notification.permission === 'granted'
      ? 'granted'
      : await Notification.requestPermission();
    if (permission !== 'granted') return false;

    return this.registerToken(config);
  }

  /**
   * Re-register on a visit where permission is already granted.
   *
   * Called on startup. This is not redundant: FCM rotates registration tokens
   * on its own schedule, so a browser that registered once and never again
   * quietly stops receiving anything weeks later, with no error anywhere.
   */
  async resumeIfAlreadyGranted(): Promise<boolean> {
    if (!this.isSupported) return false;
    // Permission checked BEFORE the config request, so a browser that has never
    // opted in does not make a call on every page load.
    if (Notification.permission !== 'granted') return false;
    const config = await this.loadConfig();
    if (!config) return false;
    return this.registerToken(config);
  }

  /**
   * On sign-out. Without it the next person to use this browser inherits the
   * previous user's shift reminders until their token happens to rotate.
   */
  async disable(): Promise<void> {
    const token = this.registeredToken;
    this.registeredToken = null;
    if (!token) return;
    try {
      await firstValueFrom(
        this.http.request('delete', `${environment.apiUrl}/notifications/devices`, { body: { token } }),
      );
    } catch {
      // Signing out must not fail because a cleanup call did.
    }
  }

  private async registerToken(config: FirebaseWebConfig): Promise<boolean> {
    try {
      // Imported lazily so the Firebase SDK is not in the initial bundle for
      // the majority of page loads, which never touch push.
      const { initializeApp, getApps, getApp } = await import('firebase/app');
      const { getMessaging, getToken, onMessage, isSupported } = await import('firebase/messaging');

      if (!(await isSupported())) return false;

      const app = getApps().length ? getApp() : initializeApp(config);

      // The config rides on the query string so the worker and the app cannot
      // disagree about which Firebase project this is — see the worker file.
      const params = new URLSearchParams({
        apiKey: config.apiKey ?? '',
        authDomain: config.authDomain ?? '',
        projectId: config.projectId ?? '',
        storageBucket: config.storageBucket ?? '',
        messagingSenderId: config.messagingSenderId ?? '',
        appId: config.appId ?? '',
      });
      const registration = await navigator.serviceWorker.register(
        `/firebase-messaging-sw.js?${params.toString()}`,
      );

      const messaging = getMessaging(app);
      const token = await getToken(messaging, {
        vapidKey: config.vapidKey,
        serviceWorkerRegistration: registration,
      });
      if (!token) return false;

      await firstValueFrom(
        this.http.post(`${environment.apiUrl}/notifications/devices`, {
          token,
          platform: 'WEB',
          deviceName: this.describeBrowser(),
        }),
      );
      this.registeredToken = token;

      // Foreground messages. FCM does NOT show a notification for these — the
      // page is visible, so it is the app's job. The existing socket already
      // updates the bell, so this deliberately does nothing beyond leaving the
      // hook in place rather than raising a second, duplicate toast.
      onMessage(messaging, () => {});

      return true;
    } catch (err) {
      console.warn('[push] registration failed', err);
      return false;
    }
  }

  /** Something a person would recognise in a "where am I signed in" list. */
  private describeBrowser(): string {
    const ua = navigator.userAgent;
    const browser =
      /Edg\//.test(ua) ? 'Edge'
      : /Chrome\//.test(ua) ? 'Chrome'
      : /Firefox\//.test(ua) ? 'Firefox'
      : /Safari\//.test(ua) ? 'Safari'
      : 'Browser';
    const os =
      /Windows/.test(ua) ? 'Windows'
      : /Mac OS X/.test(ua) ? 'Mac'
      : /Android/.test(ua) ? 'Android'
      : /iPhone|iPad/.test(ua) ? 'iOS'
      : /Linux/.test(ua) ? 'Linux'
      : '';
    return os ? `${browser} on ${os}` : browser;
  }
}
