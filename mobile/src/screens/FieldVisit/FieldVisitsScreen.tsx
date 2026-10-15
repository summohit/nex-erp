import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator, Alert, Linking,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import AppScreen from '../../components/AppScreen';
import { fieldVisitRequestService as fv, FieldVisitRequest, FvDay } from '../../api/fieldVisitRequestService';
import { getCurrentLocation, requestLocationPermission } from '../../store/dashboardStore';
import { theme } from '../../theme/theme';
import { fvStatus, timeLabel, clockAt, range, mapsUrl } from './fvFormat';

type Tab = 'TODAY' | 'MINE';

export default function FieldVisitsScreen() {
  const navigation = useNavigation<any>();
  const [tab, setTab] = useState<Tab>('TODAY');
  const [days, setDays] = useState<FvDay[]>([]);
  const [mine, setMine] = useState<FieldVisitRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [taskFor, setTaskFor] = useState<Record<number, number | undefined>>({});

  const load = useCallback(async () => {
    const [t, m] = await Promise.allSettled([fv.today(), fv.list()]);
    if (t.status === 'fulfilled') setDays(t.value);
    if (m.status === 'fulfilled') setMine(m.value);
    setLoading(false);
    setRefreshing(false);
  }, []);

  // Back from the request form: show what was just raised.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const locate = async () => {
    if (!(await requestLocationPermission())) throw new Error('Allow location for MIRA to clock in at the site.');
    return getCurrentLocation();
  };

  const clock = async (day: FvDay, direction: 'in' | 'out') => {
    if (direction === 'in' && day.tasks.length > 1 && !taskFor[day.request.id]) {
      Alert.alert('Pick a task', 'Choose the task you are working on at the site first.');
      return;
    }
    setBusy(day.id);
    try {
      const fix = await locate();
      const body = { requestId: day.request.id, lat: fix.lat, lng: fix.lng, accuracy: Math.round(fix.accuracy) };
      if (direction === 'in') {
        await fv.clockIn({ ...body, issueId: taskFor[day.request.id] ?? day.tasks[0]?.id });
      } else {
        await fv.clockOut(body);
      }
      Alert.alert(direction === 'in' ? 'Clocked in' : 'Clocked out', `${day.request.location}`);
      load();
    } catch (e: any) {
      // The server's own sentence: "You are outside the approved Field Visit
      // location… You are 1.4km from …" is the useful part.
      Alert.alert(direction === 'in' ? 'Could not clock in' : 'Could not clock out', e?.response?.data?.message || e?.message || 'Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const mineSorted = useMemo(() => [...mine].sort((a, b) => b.startDate.localeCompare(a.startDate)), [mine]);

  const renderDay = ({ item: d }: { item: FvDay }) => {
    const inside = !!d.clockInTime && !d.clockOutTime;
    const done = !!d.clockOutTime;
    return (
      <View style={styles.card}>
        <Text style={styles.reqNo}>{d.request.requestNumber}{d.request.project ? ` · ${d.request.project.name}` : ''}</Text>
        <Text style={styles.site}>{d.request.location}</Text>
        <Text style={styles.meta}>
          {timeLabel(d.request.startTime)} – {timeLabel(d.request.endTime)} · within {d.request.geofenceRadiusM >= 1000 ? `${d.request.geofenceRadiusM / 1000} km` : `${d.request.geofenceRadiusM} m`} of the site
        </Text>
        <Text style={styles.link} onPress={() => Linking.openURL(mapsUrl(d.request.latitude, d.request.longitude))}>
          Open site in Maps
        </Text>

        {!d.clockInTime && d.tasks.length > 0 && (
          <View style={styles.taskPick}>
            <Text style={styles.label}>Task you are working on</Text>
            {d.tasks.map((t) => {
              const on = (taskFor[d.request.id] ?? (d.tasks.length === 1 ? t.id : undefined)) === t.id;
              return (
                <TouchableOpacity key={t.id} style={[styles.taskOpt, on && styles.taskOn]} onPress={() => setTaskFor((p) => ({ ...p, [d.request.id]: t.id }))}>
                  <Text style={[styles.taskText, on && styles.taskTextOn]}>{on ? '● ' : '○ '}{t.key} · {t.title}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {!!d.clockInTime && (
          <Text style={styles.done}>
            In {clockAt(d.clockInTime)}{d.clockInDistanceKm != null ? ` (${Math.round(d.clockInDistanceKm * 1000)} m from site)` : ''}
            {d.clockOutTime ? `  ·  Out ${clockAt(d.clockOutTime)}` : ''}
          </Text>
        )}

        {!done && (
          <TouchableOpacity style={[styles.clockBtn, inside && styles.clockOut]} disabled={busy === d.id} onPress={() => clock(d, inside ? 'out' : 'in')}>
            {busy === d.id ? <ActivityIndicator color="#fff" /> : <Text style={styles.clockText}>{inside ? 'Clock out at site' : 'Clock in at site'}</Text>}
          </TouchableOpacity>
        )}
        {done && <Text style={styles.complete}>✓ Day complete</Text>}
      </View>
    );
  };

  const renderRequest = ({ item: r }: { item: FieldVisitRequest }) => {
    const s = fvStatus(r.status);
    return (
      <TouchableOpacity style={styles.card} onPress={() => navigation.navigate('FieldVisitDetail', { id: r.id })}>
        <View style={styles.headRow}>
          <Text style={styles.reqNo}>{r.requestNumber}</Text>
          <View style={[styles.badge, { backgroundColor: s.bg }]}><Text style={[styles.badgeText, { color: s.fg }]}>{s.label}</Text></View>
        </View>
        <Text style={styles.site} numberOfLines={2}>{r.location}</Text>
        <Text style={styles.meta}>{range(r)} · {r.visitDays} day{r.visitDays === 1 ? '' : 's'} · {r.members.length} {r.members.length === 1 ? 'person' : 'people'}</Text>
        <Text style={styles.meta}>{r.project?.isSystem ? 'General visit' : r.project?.name}</Text>
        {r.status === 'REJECTED' && !!r.rejectionReason && <Text style={styles.rejected}>Rejected: {r.rejectionReason}</Text>}
      </TouchableOpacity>
    );
  };

  return (
    <AppScreen title="Field Visits" subtitle="Requests and on-site attendance">
      <View style={styles.top}>
        <View style={styles.segment}>
          {(['TODAY', 'MINE'] as Tab[]).map((t) => (
            <TouchableOpacity key={t} style={[styles.segBtn, tab === t && styles.segOn]} onPress={() => setTab(t)}>
              <Text style={[styles.segText, tab === t && styles.segTextOn]}>{t === 'TODAY' ? `Today (${days.length})` : `My visits (${mine.length})`}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity style={styles.newBtn} onPress={() => navigation.navigate('FieldVisitRequestForm')}>
          <Text style={styles.newText}>+ New request</Text>
        </TouchableOpacity>
      </View>

      {loading ? <ActivityIndicator style={styles.loader} color={theme.colors.primary} /> : tab === 'TODAY' ? (
        <FlatList
          data={days}
          keyExtractor={(d) => String(d.id)}
          renderItem={renderDay}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListEmptyComponent={<Text style={styles.empty}>No approved field visit today. Raise a request, and once it is approved you clock in here at the site.</Text>}
        />
      ) : (
        <FlatList
          data={mineSorted}
          keyExtractor={(r) => String(r.id)}
          renderItem={renderRequest}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListEmptyComponent={<Text style={styles.empty}>No field visits yet.</Text>}
        />
      )}

    </AppScreen>
  );
}

const styles = StyleSheet.create({
  top: { paddingHorizontal: 16, paddingTop: 8, gap: 10 },
  segment: { flexDirection: 'row', backgroundColor: '#F1F5F9', borderRadius: 10, padding: 3 },
  segBtn: { flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center' },
  segOn: { backgroundColor: '#fff' },
  segText: { fontSize: 13, fontWeight: '600', color: '#64748B' },
  segTextOn: { color: theme.colors.primary },
  newBtn: { height: 42, borderRadius: 10, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' },
  newText: { color: '#fff', fontWeight: '700' },
  loader: { marginTop: 40 },
  list: { padding: 16, paddingBottom: 120, gap: 12 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: theme.colors.border },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  reqNo: { fontSize: 12, fontWeight: '700', color: theme.colors.textMuted },
  site: { fontSize: 16, fontWeight: '700', color: theme.colors.textPrimary, marginTop: 4 },
  meta: { fontSize: 12.5, color: theme.colors.textSecondary, marginTop: 3 },
  link: { color: theme.colors.primary, fontWeight: '600', marginTop: 6 },
  label: { fontSize: 12.5, fontWeight: '600', color: theme.colors.textPrimary, marginBottom: 6 },
  taskPick: { marginTop: 12 },
  taskOpt: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border, marginBottom: 6 },
  taskOn: { borderColor: theme.colors.primary, backgroundColor: '#EFF6FF' },
  taskText: { fontSize: 13, color: theme.colors.textPrimary },
  taskTextOn: { color: theme.colors.primaryText, fontWeight: '600' },
  done: { marginTop: 10, fontSize: 13, color: '#15803D', fontWeight: '600' },
  clockBtn: { marginTop: 12, height: 46, borderRadius: 12, backgroundColor: '#16A34A', alignItems: 'center', justifyContent: 'center' },
  clockOut: { backgroundColor: '#DC2626' },
  clockText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  complete: { marginTop: 12, textAlign: 'center', color: '#15803D', fontWeight: '700' },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  rejected: { marginTop: 6, fontSize: 12.5, color: '#B91C1C' },
  empty: { textAlign: 'center', color: theme.colors.textSecondary, marginTop: 40, paddingHorizontal: 24, lineHeight: 20 },
});
