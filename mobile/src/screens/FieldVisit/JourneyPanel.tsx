import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, Alert, ActivityIndicator, Platform, PermissionsAndroid,
} from 'react-native';
import { Navigation, MapPin, Camera } from 'lucide-react-native';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import { fieldVisitRequestService as fv, FvDay, TravelConfig } from '../../api/fieldVisitRequestService';
import { getCurrentLocation, requestLocationPermission } from '../../store/dashboardStore';
import { fieldVisitLocation, isFieldVisitLocationAvailable } from '../../native/fieldVisitLocation';
import { clockAt } from './fvFormat';

/**
 * Travel allowance on a Delhi NCR visit day (decided 15 Oct 2026).
 *
 * Start journey records where they set off and, on Android, starts the route
 * recorder: a foreground service with a "Field visit in progress"
 * notification that saves a point every ~30 s until End journey. Nothing is
 * recorded before Start or after End. The points are uploaded at End journey
 * (and whenever this screen opens mid-journey), and are shown to finance on
 * the claim; payment stays on the road estimate.
 */
export default function JourneyPanel({ day, onChanged }: { day: FvDay; onChanged: () => void }) {
  const [config, setConfig] = useState<TravelConfig | null>(null);
  const [vehicle, setVehicle] = useState('');
  const [busy, setBusy] = useState(false);
  const [fare, setFare] = useState('');
  const [receipt, setReceipt] = useState<{ url: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    fv.travelSettings().then((c) => {
      setConfig(c);
      setVehicle((v) => v || c.rates?.[0]?.vehicle || '');
    }).catch(() => setConfig({ ncrRadiusKm: 60, rates: [] }));
  }, []);

  // Mid-journey: send what the phone has recorded so far.
  useEffect(() => {
    if (day.journeyStartAt && !day.journeyEndAt) flushPoints(day.request.id).catch(() => undefined);
  }, [day.journeyStartAt, day.journeyEndAt, day.request.id]);

  const rate = config?.rates.find((r) => r.vehicle.toLowerCase() === String(day.journeyVehicle || '').toLowerCase());
  const actualFare = rate?.kind === 'ACTUAL_FARE';

  const locate = async () => {
    if (!(await requestLocationPermission())) throw new Error('Allow location for MIRA to record your journey.');
    return getCurrentLocation();
  };

  const start = async () => {
    setBusy(true);
    try {
      const fix = await locate();
      await fv.startJourney({ requestId: day.request.id, lat: fix.lat, lng: fix.lng, vehicle: vehicle || undefined });
      // Android: record the route. Android 13+ shows the notification only
      // with permission; the recorder still runs without it.
      if (Platform.OS === 'android' && isFieldVisitLocationAvailable) {
        if (Platform.Version >= 33) {
          await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).catch(() => undefined);
        }
        await fieldVisitLocation.clearBufferedPoints();
        await fieldVisitLocation.startTracking(day.id);
      }
      onChanged();
    } catch (e: any) {
      Alert.alert('Could not start the journey', e?.response?.data?.message || e?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const pickReceipt = async (source: 'camera' | 'gallery') => {
    const opts = { mediaType: 'photo' as const, quality: 0.8 as const, maxWidth: 1600, maxHeight: 1600 };
    const result = source === 'camera' ? await launchCamera(opts) : await launchImageLibrary(opts);
    const asset = result.assets?.[0];
    if (result.didCancel || !asset?.uri) return;
    setUploading(true);
    try {
      const name = asset.fileName || `receipt-${Date.now()}.jpg`;
      const fd = new FormData();
      fd.append('file', { uri: asset.uri, name, type: asset.type || 'image/jpeg' } as any);
      const up = await fv.uploadReceipt(fd);
      setReceipt({ url: up.url, name });
    } catch {
      Alert.alert('Upload failed', 'Could not upload the photo. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const end = async () => {
    if (actualFare) {
      if (!(Number(fare) > 0)) { Alert.alert('Enter the fare', `How much did you pay for ${rate!.vehicle} today?`); return; }
      if (rate!.receiptRequired && !receipt) { Alert.alert('Receipt needed', `Attach the ${rate!.vehicle} receipt or app screenshot.`); return; }
    }
    setBusy(true);
    try {
      const fix = await locate();
      await stopAndFlush(day.request.id);
      await fv.endJourney({
        requestId: day.request.id, lat: fix.lat, lng: fix.lng,
        ...(actualFare ? { fare: Number(fare), receiptUrl: receipt?.url } : {}),
      });
      onChanged();
    } catch (e: any) {
      Alert.alert('Could not end the journey', e?.response?.data?.message || e?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (!config) return null;

  return (
    <View style={styles.panel}>
      <View style={styles.head}>
        <Navigation size={16} color="#1E3A8A" strokeWidth={2.2} />
        <Text style={styles.title}>Travel allowance</Text>
        <Text style={styles.zone}>Delhi NCR</Text>
      </View>

      {!day.journeyStartAt ? (
        day.clockInTime ? (
          <Text style={styles.note}>No journey was started today, so your trip is counted from your office.</Text>
        ) : (
          <>
            <Text style={styles.note}>
              Tap when you set off — office, home or anywhere.
              {Platform.OS === 'android' ? ' Your route is recorded until End journey, with a notification while it runs.' : ''}
            </Text>
            <View style={styles.chips}>
              {config.rates.map((r) => (
                <TouchableOpacity key={r.vehicle} style={[styles.chip, vehicle === r.vehicle && styles.chipOn]} onPress={() => setVehicle(r.vehicle)}>
                  <Text style={[styles.chipText, vehicle === r.vehicle && styles.chipTextOn]}>
                    {r.vehicle} · {r.kind === 'ACTUAL_FARE' ? 'fare' : `₹${r.ratePerKm}/km`}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={styles.primary} disabled={busy} onPress={start}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Start journey</Text>}
            </TouchableOpacity>
          </>
        )
      ) : (
        <>
          <Text style={styles.note}>
            Started {clockAt(day.journeyStartAt)}{day.journeyVehicle ? ` · ${day.journeyVehicle}` : ''}.
            {day.journeyEndAt ? ` Ended ${clockAt(day.journeyEndAt)}.` : ' Tap End journey where you finish; otherwise the return counts as the same distance.'}
          </Text>
          {!day.journeyEndAt && actualFare && (
            <View style={styles.fareBox}>
              <Text style={styles.label}>{rate!.vehicle} fare for today (₹)</Text>
              <TextInput style={styles.input} keyboardType="numeric" value={fare} onChangeText={setFare} placeholder="e.g. 60" placeholderTextColor="#94A3B8" />
              <Text style={styles.label}>{rate!.receiptRequired ? 'Receipt or app screenshot (required)' : 'Ticket photo (optional)'}</Text>
              <View style={styles.row}>
                <TouchableOpacity style={styles.outline} onPress={() => pickReceipt('camera')} disabled={uploading}>
                  <Camera size={14} color="#334155" /><Text style={styles.outlineText}>Camera</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.outline} onPress={() => pickReceipt('gallery')} disabled={uploading}>
                  <Text style={styles.outlineText}>Gallery</Text>
                </TouchableOpacity>
                {uploading ? <ActivityIndicator /> : receipt ? <Text style={styles.attached} numberOfLines={1}>Attached</Text> : null}
              </View>
            </View>
          )}
          {!day.journeyEndAt && (
            <TouchableOpacity style={styles.outlineWide} disabled={busy || uploading} onPress={end}>
              {busy ? <ActivityIndicator /> : (
                <View style={styles.row}><MapPin size={16} color="#334155" /><Text style={styles.outlineText}>End journey</Text></View>
              )}
            </TouchableOpacity>
          )}
        </>
      )}
    </View>
  );
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
  panel: { borderWidth: 1, borderColor: '#DBEAFE', backgroundColor: '#F8FBFF', borderRadius: 12, padding: 14, marginTop: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontWeight: '700', color: '#1E3A8A', fontSize: 14 },
  zone: { marginLeft: 'auto', fontSize: 11, fontWeight: '700', color: '#1D4ED8', backgroundColor: '#DBEAFE', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: 'hidden' },
  note: { marginTop: 8, fontSize: 13, color: '#475569', lineHeight: 18 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: '#CBD5E1', backgroundColor: '#fff' },
  chipOn: { backgroundColor: '#1373E5', borderColor: '#1373E5' },
  chipText: { fontSize: 12, color: '#334155', fontWeight: '600' },
  chipTextOn: { color: '#fff' },
  primary: { marginTop: 12, backgroundColor: '#1373E5', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  primaryText: { color: '#fff', fontWeight: '700' },
  fareBox: { marginTop: 10, gap: 6 },
  label: { fontSize: 12, color: '#334155', fontWeight: '600' },
  input: { borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: '#fff', color: '#0F172A' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  outline: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: '#fff' },
  outlineWide: { marginTop: 12, borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 10, paddingVertical: 11, alignItems: 'center', backgroundColor: '#fff' },
  outlineText: { color: '#334155', fontWeight: '600', fontSize: 13 },
  attached: { color: '#15803D', fontSize: 12, fontWeight: '600' },
});
