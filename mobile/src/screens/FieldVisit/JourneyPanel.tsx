import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, Platform, PermissionsAndroid,
} from 'react-native';
import { Navigation, MapPin } from 'lucide-react-native';
import { fieldVisitRequestService as fv, FvDay, TravelConfig } from '../../api/fieldVisitRequestService';
import { getCurrentLocation, requestLocationPermission } from '../../store/dashboardStore';
import { fieldVisitLocation, isFieldVisitLocationAvailable } from '../../native/fieldVisitLocation';
import { clockAt } from './fvFormat';
import { API_URL } from '../../api/apiClient';
import { useAuthStore } from '../../store/authStore';

/**
 * Live view for finance (16 Oct 2026): the Android recorder sends its points
 * every 90 s itself, so it needs the server, the login and the visit. Set at
 * Start journey, again whenever the screen opens mid-journey, and whenever
 * the login token is refreshed, so an 8-hour token never strands a journey.
 */
let liveRequestId: number | null = null;
function armLiveUpload(requestId: number) {
  liveRequestId = requestId;
  const token = useAuthStore.getState().token;
  if (token) fieldVisitLocation.setUploadConfig?.(API_URL, token, requestId).catch(() => undefined);
}
useAuthStore.subscribe((state, prev) => {
  if (liveRequestId != null && state.token && state.token !== prev.token) armLiveUpload(liveRequestId);
});

/**
 * Travel allowance on a Delhi NCR visit day.
 *
 * Compact, clean layout matching the card design: shows "Delhi NCR · ₹X/km"
 * in the header pill and Start / End journey without vehicle selection.
 */
export default function JourneyPanel({ day, onChanged }: { day: FvDay; onChanged: () => void }) {
  const [config, setConfig] = useState<TravelConfig | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fv.travelSettings()
      .then((c) => setConfig(c))
      .catch(() => setConfig({ ncrRadiusKm: 60, rates: [] }));
  }, []);

  // Mid-journey: send what the phone has recorded so far.
  useEffect(() => {
    flushJourneyPoints(day);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per journey change, not on every refresh
  }, [day.journeyStartAt, day.journeyEndAt, day.request.id]);

  const start = async () => {
    setBusy(true);
    try {
      await startJourneyFor(day);
      onChanged();
    } catch (e: any) {
      Alert.alert('Could not start the journey', e?.response?.data?.message || e?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const end = async () => {
    setBusy(true);
    try {
      await endJourneyFor(day);
      onChanged();
    } catch (e: any) {
      Alert.alert('Could not end the journey', e?.response?.data?.message || e?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (!config) return null;

  const effectiveRate = config.myRatePerKm ?? config.defaultRatePerKm ?? null;

  return (
    <View style={styles.panel}>
      <View style={styles.head}>
        <Navigation size={15} color="#1E3A8A" strokeWidth={2.2} />
        <Text style={styles.title}>Travel allowance</Text>
        <Text style={styles.zone}>Delhi NCR{effectiveRate != null ? ` · ₹${effectiveRate}/km` : ''}</Text>
      </View>

      {!day.journeyStartAt ? (
        day.clockInTime ? (
          <Text style={styles.note}>
            No journey was started today, so your trip is counted from your office{effectiveRate != null ? ` at ₹${effectiveRate}/km` : ''}.
          </Text>
        ) : (
          <>
            <Text style={styles.note}>
              Tap when you set off — office, home or anywhere.
              {Platform.OS === 'android' ? ' From then until End journey, your route is recorded and finance can see it live.' : ''}
            </Text>
            <TouchableOpacity style={styles.primary} disabled={busy} activeOpacity={0.85} onPress={start}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Start journey</Text>}
            </TouchableOpacity>
          </>
        )
      ) : (
        <>
          <Text style={styles.note}>
            Started {clockAt(day.journeyStartAt)}.
            {day.journeyEndAt
              ? ` Ended ${clockAt(day.journeyEndAt)}.`
              : ' Tap End journey where you finish; otherwise the return counts as the same distance.'}
            {!day.journeyEndAt && Platform.OS === 'android' ? ' Finance can see your route live until then.' : ''}
          </Text>
          {!day.journeyEndAt && (
            <TouchableOpacity style={styles.outlineWide} disabled={busy} activeOpacity={0.85} onPress={end}>
              {busy ? (
                <ActivityIndicator />
              ) : (
                <View style={styles.row}>
                  <MapPin size={15} color="#334155" />
                  <Text style={styles.outlineText}>End journey</Text>
                </View>
              )}
            </TouchableOpacity>
          )}
        </>
      )}
    </View>
  );
}

async function locate() {
  if (!(await requestLocationPermission())) throw new Error('Allow location for MIRA to record your journey.');
  return getCurrentLocation();
}

/**
 * Start journey, shared by this panel and the Home screen: records where
 * they set off and, on Android, starts the route recorder. No vehicle: every
 * journey is paid per km at the person's grade rate.
 */
export async function startJourneyFor(day: FvDay) {
  const fix = await locate();
  await fv.startJourney({ requestId: day.request.id, lat: fix.lat, lng: fix.lng });
  if (Platform.OS === 'android' && isFieldVisitLocationAvailable) {
    if (Platform.Version >= 33) {
      await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).catch(() => undefined);
    }
    await fieldVisitLocation.clearBufferedPoints();
    armLiveUpload(day.request.id);
    await fieldVisitLocation.startTracking(day.id);
    askBatteryUnrestricted();
  }
}

/**
 * After Start journey: if Android may restrict MIRA in the background, ask
 * the person to set Battery → Unrestricted, so the phone does not stop the
 * route recorder mid-trip. The journey has already started either way.
 */
async function askBatteryUnrestricted() {
  try {
    const ok = await fieldVisitLocation.isBatteryUnrestricted?.();
    if (ok !== false) return;
    Alert.alert(
      'Keep MIRA recording your route',
      'Your phone may stop MIRA in the background and lose part of your journey.\n\nOpen settings, tap Battery (or App battery usage) and choose Unrestricted.',
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open settings', onPress: () => { fieldVisitLocation.openAppSettings?.().catch(() => undefined); } },
      ],
    );
  } catch {
    // Never block a journey on this.
  }
}

/** End journey: stop recording, send the route, record where they finished. */
export async function endJourneyFor(day: FvDay) {
  liveRequestId = null;
  const fix = await locate();
  await stopAndFlush(day.request.id);
  await fv.endJourney({ requestId: day.request.id, lat: fix.lat, lng: fix.lng });
}

/** Mid-journey (screen opened): send what the phone has recorded so far. */
export function flushJourneyPoints(day: FvDay) {
  if (day.journeyStartAt && !day.journeyEndAt) {
    armLiveUpload(day.request.id);
    resumeRecorder(day).catch(() => undefined);
    flushPoints(day.request.id).catch(() => undefined);
  }
}

/**
 * A journey is running but the recorder is not: the app was reinstalled or
 * updated, or the phone's battery saver stopped it. Start it again, so one
 * interruption does not leave the rest of the trip unrecorded (17 Oct 2026:
 * a 3:07–8:53 PM journey kept only its first 30 minutes).
 */
async function resumeRecorder(day: FvDay) {
  if (Platform.OS !== 'android' || !isFieldVisitLocationAvailable) return;
  if (await fieldVisitLocation.isTracking(day.id)) return;
  await fieldVisitLocation.startTracking(day.id);
}

/** Send the recorded points, then clear them on the phone. */
async function flushPoints(requestId: number) {
  if (!isFieldVisitLocationAvailable) return;
  const points = await fieldVisitLocation.getBufferedPoints();
  if (!points?.length) return;
  await fv.sendRoutePoints(requestId, points);
  await fieldVisitLocation.clearBufferedPoints();
}

/** End of the journey: stop recording and send the last points. */
async function stopAndFlush(requestId: number) {
  if (!isFieldVisitLocationAvailable) return;
  await fieldVisitLocation.stopTracking().catch(() => undefined);
  await flushPoints(requestId).catch(() => undefined);
}

const styles = StyleSheet.create({
  panel: {
    borderWidth: 1,
    borderColor: '#DBEAFE',
    backgroundColor: '#F8FBFF',
    borderRadius: 12,
    padding: 14,
    marginTop: 12,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontWeight: '700',
    color: '#1E3A8A',
    fontSize: 14,
  },
  zone: {
    marginLeft: 'auto',
    fontSize: 11.5,
    fontWeight: '700',
    color: '#1D4ED8',
    backgroundColor: '#DBEAFE',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },
  note: {
    marginTop: 8,
    fontSize: 13,
    color: '#475569',
    lineHeight: 18,
  },
  primary: {
    marginTop: 10,
    backgroundColor: '#1373E5',
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  primaryText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13.5,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  outlineWide: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  outlineText: {
    color: '#334155',
    fontWeight: '600',
    fontSize: 13,
  },
});
