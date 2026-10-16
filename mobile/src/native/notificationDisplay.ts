import notifee, { AndroidImportance, AndroidStyle, EventType, Event } from '@notifee/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { RemoteMessage } from '@react-native-firebase/messaging';
import { API_URL } from '../api/apiClient';

/**
 * Draws MIRA's push notifications on Android (16 Oct 2026).
 *
 * The server sends Android a data-only message, so the app draws it here
 * instead of Android showing a plain one. That is what gives us:
 *  - Approve / Reject buttons on leave and field visit requests, with a typed
 *    reason for Reject, acted on without opening the app;
 *  - the photo of the person it is about;
 *  - grouping, so ten task updates stack under one "MIRA" summary;
 *  - the unread count as the app icon badge.
 *
 * Runs both in the app and in the background (index.js), so it reads the
 * login token straight from storage rather than the in-memory store.
 */

const TOKEN_KEY = 'userToken'; // same key authStore writes
const COLOR = '#1373E5';

type Data = Record<string, string | undefined>;

/** Which stack a notification joins, and its summary text. */
function groupOf(d: Data): { id: string; label: string } {
  if (d.actionKind || d.type === 'ACTION_REQUIRED') return { id: 'mira-approvals', label: 'Approvals waiting' };
  const link = d.linkUrl ?? '';
  if (link.startsWith('/projects') || link.startsWith('/tasks')) return { id: 'mira-tasks', label: 'Task updates' };
  if (link.startsWith('/attendance')) return { id: 'mira-attendance', label: 'Attendance' };
  return { id: 'mira-updates', label: 'Updates' };
}

async function ensureChannels() {
  await notifee.createChannel({
    id: 'shift-reminders', name: 'Shift reminders', importance: AndroidImportance.HIGH, vibration: true,
  });
  await notifee.createChannel({
    id: 'mira-updates', name: 'Tasks & approvals', importance: AndroidImportance.HIGH, vibration: true,
  });
}

/** Show a push that arrived as data (background, or in the app). */
export async function displayRemote(remote: RemoteMessage): Promise<void> {
  const d = (remote.data ?? {}) as Data;
  const title = d.title ?? remote.notification?.title ?? 'MIRA';
  const body = d.body ?? remote.notification?.body ?? '';
  try {
    await ensureChannels();
    const channelId = d.channelId === 'shift-reminders' ? 'shift-reminders' : 'mira-updates';
    const group = groupOf(d);
    const canAct = (d.actionKind === 'LEAVE' || d.actionKind === 'FIELD_VISIT') && !!d.actionId;

    await notifee.displayNotification({
      id: d.notificationId ? `n-${d.notificationId}` : undefined,
      title,
      body,
      data: d as Record<string, string>,
      android: {
        channelId,
        smallIcon: 'ic_notification',
        color: COLOR,
        groupId: group.id,
        ...(d.avatarUrl ? { largeIcon: d.avatarUrl, circularLargeIcon: true } : {}),
        style: { type: AndroidStyle.BIGTEXT, text: body },
        pressAction: { id: 'default', launchActivity: 'default' },
        ...(canAct ? {
          actions: [
            { title: 'Approve', pressAction: { id: 'approve' } },
            {
              title: 'Reject',
              pressAction: { id: 'reject' },
              input: { placeholder: 'Reason for rejecting', allowFreeFormInput: true },
            },
          ],
        } : {}),
      },
    });

    // The summary that holds the stack together once there are several.
    await notifee.displayNotification({
      id: `summary-${group.id}`,
      title: group.label,
      subtitle: group.label,
      android: {
        channelId,
        smallIcon: 'ic_notification',
        color: COLOR,
        groupId: group.id,
        groupSummary: true,
        pressAction: { id: 'default', launchActivity: 'default' },
      },
    });

    const badge = Number(d.badge);
    if (Number.isFinite(badge)) await notifee.setBadgeCount(badge);
  } catch {
    // A drawing failure must never crash the background handler.
  }
}

async function call(method: string, path: string, body?: unknown): Promise<{ ok: boolean; message?: string }> {
  const token = await AsyncStorage.getItem(TOKEN_KEY);
  if (!token) return { ok: false, message: 'Sign in to MIRA first.' };
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.ok) return { ok: true };
    const json: any = await res.json().catch(() => ({}));
    const msg = Array.isArray(json?.message) ? json.message.join(', ') : json?.message;
    return { ok: false, message: msg || `Failed (${res.status})` };
  } catch {
    return { ok: false, message: 'No connection. Open MIRA to try again.' };
  }
}

/**
 * Approve or Reject straight from the notification. The result replaces the
 * notification, so the person can see it worked (or why it did not).
 */
async function act(kind: string, id: string, approve: boolean, reason: string) {
  if (!approve && !reason.trim()) return { ok: false, message: 'A reason is needed to reject. Open MIRA to reject.' };
  if (kind === 'LEAVE') {
    return call('PUT', `/leaves/requests/${id}/status`,
      approve ? { status: 'APPROVED' } : { status: 'REJECTED', rejectionReason: reason.trim() });
  }
  if (kind === 'FIELD_VISIT') {
    return approve
      ? call('POST', `/field-visit-requests/${id}/approve`, {})
      : call('POST', `/field-visit-requests/${id}/reject`, { reason: reason.trim() });
  }
  return { ok: false, message: 'Open MIRA to act on this.' };
}

/**
 * Button and tap events, in the app and in the background. Returns the
 * notification's data when the person tapped the body, so the app can open
 * the right screen.
 */
export async function handleNotificationEvent(
  { type, detail }: Event,
  onOpen?: (data: Record<string, string>) => void,
): Promise<void> {
  const n = detail.notification;
  const d = (n?.data ?? {}) as Record<string, string>;

  if (type === EventType.PRESS) {
    onOpen?.(d);
    return;
  }
  if (type !== EventType.ACTION_PRESS || !n) return;
  const actionId = detail.pressAction?.id;
  if (actionId !== 'approve' && actionId !== 'reject') return;

  const approve = actionId === 'approve';
  const result = await act(d.actionKind ?? '', d.actionId ?? '', approve, detail.input ?? '');
  await notifee.displayNotification({
    id: n.id,
    title: result.ok ? (approve ? 'Approved' : 'Rejected') : 'Could not complete',
    body: result.ok ? n.body ?? '' : result.message ?? 'Open MIRA to try again.',
    data: d,
    android: {
      channelId: n.android?.channelId ?? 'mira-updates',
      smallIcon: 'ic_notification',
      color: COLOR,
      groupId: n.android?.groupId,
      pressAction: { id: 'default', launchActivity: 'default' },
      ...(result.ok ? { timeoutAfter: 8000 } : {}),
    },
  });
}

/** A tap that launched the app from closed: its data, or null. */
export async function initialNotificationData(): Promise<Record<string, string> | null> {
  try {
    const initial = await notifee.getInitialNotification();
    return (initial?.notification?.data as Record<string, string>) ?? null;
  } catch {
    return null;
  }
}
