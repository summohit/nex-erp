import { Platform, PermissionsAndroid } from 'react-native';
import { getApp } from '@react-native-firebase/app';
import {
  getMessaging,
  getToken as getFcmToken,
  onMessage,
  onNotificationOpenedApp,
  onTokenRefresh,
  getInitialNotification,
  requestPermission,
  registerDeviceForRemoteMessages,
  AuthorizationStatus,
} from '@react-native-firebase/messaging';
import type { RemoteMessage } from '@react-native-firebase/messaging';
import { apiClient } from '../api/apiClient';

/**
 * Push registration for the mobile app.
 *
 * Written against @react-native-firebase v26's MODULAR api — `getMessaging(app)`
 * plus free functions — not the `messaging().foo()` namespaced form. The
 * namespaced calls still run in v26 but are deprecated and untyped against the
 * shipped declarations, so they compile only by way of `any`.
 *
 * WHY IT EXISTS
 *
 * Notifications already arrive over the socket, which requires the app to be
 * open and foregrounded. A shift reminder is sent to someone whose phone is in
 * their pocket, so it needs FCM — the only channel that wakes a killed app.
 *
 * EVERY FUNCTION HERE SWALLOWS ITS ERRORS
 *
 * A device without Google Play Services, a simulator with no APNs token, a
 * build whose google-services.json has not been added yet: all of these throw,
 * and none of them is a reason to stop someone signing in or clocking in. Push
 * is an enhancement; the app has to work without it.
 */

const CHANNEL_ID = 'shift-reminders';

/**
 * Ask for notification permission.
 *
 * Android 13+ needs the runtime POST_NOTIFICATIONS grant, which did not exist
 * before — on older Android the permission is implicit and requesting it
 * returns a value that must not be treated as a refusal. iOS has always needed
 * an explicit ask, and Firebase's own requestPermission is the one that
 * registers with APNs at the same time.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  try {
    if (Platform.OS === 'android') {
      if (Platform.Version >= 33) {
        const result = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
        );
        return result === PermissionsAndroid.RESULTS.GRANTED;
      }
      return true;
    }

    const status = await requestPermission(getMessaging(getApp()));
    return (
      status === AuthorizationStatus.AUTHORIZED ||
      status === AuthorizationStatus.PROVISIONAL
    );
  } catch {
    return false;
  }
}

/**
 * Hand this device's token to the server.
 *
 * Called on every sign-in and every launch, not only the first. FCM rotates
 * registration tokens on its own schedule, and a device that registers once and
 * never again silently stops receiving anything — with no error to notice.
 */
export async function registerDeviceToken(): Promise<string | null> {
  try {
    const granted = await requestNotificationPermission();
    if (!granted) return null;

    // iOS will not issue a token until the device has registered with APNs.
    // On a simulator this never completes, which is why it is tolerated rather
    // than awaited into a failure.
    const app = getMessaging(getApp());
    if (Platform.OS === 'ios') {
      await registerDeviceForRemoteMessages(app).catch(() => {});
    }

    const token = await getFcmToken(app);
    if (!token) return null;

    await apiClient.post('/notifications/devices', {
      token,
      platform: Platform.OS === 'ios' ? 'IOS' : 'ANDROID',
      deviceName: `${Platform.OS === 'ios' ? 'iPhone' : 'Android'} app`,
    });
    return token;
  } catch (err) {
    console.warn('[push] register failed', err);
    return null;
  }
}

/**
 * On sign-out. Without it the next person to sign in on this handset keeps
 * receiving the previous user's shift reminders until the token rotates.
 */
export async function unregisterDeviceToken(): Promise<void> {
  try {
    const token = await getFcmToken(getMessaging(getApp()));
    if (!token) return;
    await apiClient.delete('/notifications/devices', { data: { token } });
  } catch {
    // Signing out must never fail because a cleanup call did.
  }
}

/**
 * Wire up the listeners, once, at app start.
 *
 * Returns an unsubscribe for the two that need one. The token-refresh listener
 * is the important one: it is the only notice the app gets that its token has
 * changed, and without re-registering the device goes quiet.
 */
export function initPushListeners(opts: {
  onForegroundMessage?: (title: string, body: string, data: Record<string, string>) => void;
  onOpenedFromNotification?: (data: Record<string, string>) => void;
}): () => void {
  const unsubscribers: Array<() => void> = [];

  try {
    const app = getMessaging(getApp());

    // A token can change at any time — app restore, reinstall, cache clear.
    unsubscribers.push(
      onTokenRefresh(app, async (token: string) => {
        try {
          await apiClient.post('/notifications/devices', {
            token,
            platform: Platform.OS === 'ios' ? 'IOS' : 'ANDROID',
            deviceName: `${Platform.OS === 'ios' ? 'iPhone' : 'Android'} app`,
          });
        } catch {
          // Next launch re-registers.
        }
      }),
    );

    // Foreground messages are NOT shown by the OS — the app is on screen, so
    // displaying them is the app's job.
    unsubscribers.push(
      onMessage(app, async (remote: RemoteMessage) => {
        opts.onForegroundMessage?.(
          remote.notification?.title ?? 'MIRA',
          remote.notification?.body ?? '',
          (remote.data ?? {}) as Record<string, string>,
        );
      }),
    );

    // Tapped while the app was backgrounded.
    unsubscribers.push(
      onNotificationOpenedApp(app, (remote: RemoteMessage) => {
        opts.onOpenedFromNotification?.((remote.data ?? {}) as Record<string, string>);
      }),
    );

    // Tapped while the app was killed. This resolves once, at startup, with
    // the notification that launched the app — or null if something else did.
    getInitialNotification(app)
      .then((remote: RemoteMessage | null) => {
        if (remote) opts.onOpenedFromNotification?.((remote.data ?? {}) as Record<string, string>);
      })
      .catch(() => {});
  } catch (err) {
    console.warn('[push] listeners unavailable', err);
  }

  return () => unsubscribers.forEach((fn) => { try { fn(); } catch {} });
}

/** The Android channel id the server sends against — see PushService. */
export const SHIFT_REMINDER_CHANNEL_ID = CHANNEL_ID;
