import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator, Alert, Linking,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import AppScreen from '../../components/AppScreen';
import {
  fieldVisitRequestService as fv, FieldVisitRequest, FvDay, FvCapabilities, VisitLocationRequest, ROSTER_DAY_OFF_CLASH,
} from '../../api/fieldVisitRequestService';
import ReasonSheet from './ReasonSheet';
import { getCurrentLocation, requestLocationPermission } from '../../store/dashboardStore';
import { theme } from '../../theme/theme';
import { fvStatus, timeLabel, clockAt, range, mapsUrl, who } from './fvFormat';

type Tab = 'TODAY' | 'MINE' | 'APPROVALS';

export default function FieldVisitsScreen() {
  const navigation = useNavigation<any>();
  const [tab, setTab] = useState<Tab>('TODAY');
  const [days, setDays] = useState<FvDay[]>([]);
  const [mine, setMine] = useState<FieldVisitRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [taskFor, setTaskFor] = useState<Record<number, number | undefined>>({});
  // Administrators: what waits on them, and bulk decisions on it.
  const [caps, setCaps] = useState<FvCapabilities | null>(null);
  const [siteRequests, setSiteRequests] = useState<VisitLocationRequest[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [sheet, setSheet] = useState<null | { kind: 'bulkReject' } | { kind: 'siteReject'; id: number }>(null);

  const load = useCallback(async () => {
    const [t, m, c] = await Promise.allSettled([fv.today(), fv.list(), fv.capabilities()]);
    if (t.status === 'fulfilled') setDays(t.value);
    if (m.status === 'fulfilled') setMine(m.value);
    if (c.status === 'fulfilled') {
      setCaps(c.value);
      if (c.value.isApprover) {
        fv.locationRequests().then((rows) => setSiteRequests(rows.filter((r) => r.status === 'PENDING'))).catch(() => {});
      }
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  const approver = !!caps?.isApprover;
  /** Waiting on an administrator: new requests, and changes to approved ones. */
  const awaiting = useMemo(
    () => mine.filter((r) => r.status === 'PENDING_APPROVAL' || !!r.pendingChange)
      .sort((a, b) => a.startDate.localeCompare(b.startDate)),
    [mine],
  );
  const pendingIds = awaiting.filter((r) => r.status === 'PENDING_APPROVAL').map((r) => r.id);
  const toggle = (id: number) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  /** Approve several; any that land on a rostered day off are offered the same override as one at a time. */
  const bulkApprove = async (ids: number[], override = false) => {
    setBulkBusy(true);
    try {
      const results = await fv.bulkStatus(ids, 'APPROVED', undefined, override);
      const ok = results.filter((r) => r.success).length;
      const dayOff = results.filter((r) => !r.success && r.code === ROSTER_DAY_OFF_CLASH);
      const other = results.filter((r) => !r.success && r.code !== ROSTER_DAY_OFF_CLASH);
      await load();
      setSelected([]);
      if (dayOff.length && !override) {
        Alert.alert(
          `${dayOff.length} visit${dayOff.length > 1 ? 's fall' : ' falls'} on rostered days off`,
          dayOff.map((f) => f.error).join('\n\n'),
          [{ text: 'Leave them', style: 'cancel' },
            { text: 'Approve and override days off', onPress: () => bulkApprove(dayOff.map((f) => f.id), true) }],
        );
      } else {
        Alert.alert(`${ok} of ${results.length} approved`, other.map((f) => f.error).filter(Boolean).join('\n\n') || undefined);
      }
    } catch (e: any) {
      Alert.alert('Could not approve', e?.response?.data?.message || 'Please try again.');
    } finally {
      setBulkBusy(false);
    }
  };

  const onReason = async (reason: string) => {
    if (!sheet) return;
    setBulkBusy(true);
    try {
      if (sheet.kind === 'bulkReject') {
        const results = await fv.bulkStatus(selected, 'REJECTED', reason);
        const failed = results.filter((r) => !r.success);
        Alert.alert(`${results.length - failed.length} of ${results.length} rejected`, failed.map((f) => f.error).join('\n\n') || undefined);
        setSelected([]);
      } else {
        await fv.reviewLocation(sheet.id, 'REJECTED', reason);
      }
      setSheet(null);
      await load();
    } catch (e: any) {
      Alert.alert('Could not do that', e?.response?.data?.message || 'Please try again.');
    } finally {
      setBulkBusy(false);
    }
  };

  const approveSite = (r: VisitLocationRequest) =>
    Alert.alert('Approve this site?', `${r.name} becomes a saved site everyone can pick.`, [
      { text: 'Back', style: 'cancel' },
      { text: 'Approve', onPress: async () => {
        try { await fv.reviewLocation(r.id, 'APPROVED'); await load(); } catch (e: any) {
          Alert.alert('Could not approve', e?.response?.data?.message || 'Please try again.');
        }
      } },
    ]);

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

  const renderAwaiting = ({ item: r }: { item: FieldVisitRequest }) => {
    const isPending = r.status === 'PENDING_APPROVAL';
    const on = selected.includes(r.id);
    return (
      <TouchableOpacity style={[styles.card, on && styles.cardOn]} onPress={() => navigation.navigate('FieldVisitDetail', { id: r.id })}
        onLongPress={() => isPending && toggle(r.id)}>
        <View style={styles.headRow}>
          <View style={styles.headLeft}>
            {isPending && (
              <TouchableOpacity onPress={() => toggle(r.id)} hitSlop={10}><Text style={styles.check}>{on ? '☑' : '☐'}</Text></TouchableOpacity>
            )}
            <Text style={styles.reqNo}>{r.requestNumber}</Text>
          </View>
          <View style={[styles.badge, { backgroundColor: isPending ? '#FEF3C7' : '#FFEDD5' }]}>
            <Text style={[styles.badgeText, { color: isPending ? '#92400E' : '#9A3412' }]}>{isPending ? 'New request' : 'Change requested'}</Text>
          </View>
        </View>
        <Text style={styles.site} numberOfLines={2}>{r.location}</Text>
        <Text style={styles.meta}>{range(r)} · {r.members.length} {r.members.length === 1 ? 'person' : 'people'} · {r.project?.isSystem ? 'General' : r.project?.name}</Text>
        {!!r.raisedBy && <Text style={styles.meta}>Raised by {who(r.raisedBy)}</Text>}
      </TouchableOpacity>
    );
  };

  const siteRequestsFooter = siteRequests.length > 0 ? (
    <View>
      <Text style={styles.sectionHead}>New site requests ({siteRequests.length})</Text>
      {siteRequests.map((r) => (
        <View key={r.id} style={[styles.card, styles.siteCard]}>
          <Text style={styles.site}>{r.name}</Text>
          {!!r.address && <Text style={styles.meta}>{r.address}</Text>}
          {!!r.requestedBy && <Text style={styles.meta}>Requested by {who(r.requestedBy)}</Text>}
          {r.latitude != null && r.longitude != null && (
            <Text style={styles.link} onPress={() => Linking.openURL(mapsUrl(r.latitude!, r.longitude!))}>See the pin in Maps</Text>
          )}
          <View style={styles.rowBtns}>
            <TouchableOpacity style={[styles.halfBtn, styles.approveBtn]} onPress={() => approveSite(r)}><Text style={styles.clockText}>Approve</Text></TouchableOpacity>
            <TouchableOpacity style={[styles.halfBtn, styles.rejectBtn]} onPress={() => setSheet({ kind: 'siteReject', id: r.id })}>
              <Text style={styles.rejectText}>Reject</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}
    </View>
  ) : null;

  const tabs: Tab[] = approver ? ['TODAY', 'MINE', 'APPROVALS'] : ['TODAY', 'MINE'];
  const tabLabel = (t: Tab) => (t === 'TODAY' ? `Today (${days.length})`
    : t === 'MINE' ? `${approver ? 'All' : 'My visits'} (${mine.length})`
      : `Approvals (${awaiting.length + siteRequests.length})`);

  return (
    <AppScreen title="Field Visits" subtitle="Requests and on-site attendance">
      <View style={styles.top}>
        <View style={styles.segment}>
          {tabs.map((t) => (
            <TouchableOpacity key={t} style={[styles.segBtn, tab === t && styles.segOn]} onPress={() => setTab(t)}>
              <Text style={[styles.segText, tab === t && styles.segTextOn]} numberOfLines={1}>{tabLabel(t)}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity style={styles.newBtn} onPress={() => navigation.navigate('FieldVisitRequestForm')}>
          <Text style={styles.newText}>+ New request</Text>
        </TouchableOpacity>
      </View>

      {tab === 'APPROVALS' && selected.length > 0 && (
        <View style={styles.bulkBar}>
          <Text style={styles.bulkText}>{selected.length} selected</Text>
          <TouchableOpacity style={[styles.bulkBtn, styles.approveBtn]} disabled={bulkBusy} onPress={() => bulkApprove(selected)}>
            {bulkBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.clockText}>Approve</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={[styles.bulkBtn, styles.rejectBtn]} disabled={bulkBusy} onPress={() => setSheet({ kind: 'bulkReject' })}>
            <Text style={styles.rejectText}>Reject</Text>
          </TouchableOpacity>
        </View>
      )}

      {loading ? <ActivityIndicator style={styles.loader} color={theme.colors.primary} /> : tab === 'APPROVALS' ? (
        <FlatList
          data={awaiting}
          keyExtractor={(r) => `a${r.id}`}
          renderItem={renderAwaiting}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListHeaderComponent={pendingIds.length > 1 ? (
            <TouchableOpacity onPress={() => setSelected(selected.length === pendingIds.length ? [] : pendingIds)}>
              <Text style={styles.selectAll}>{selected.length === pendingIds.length ? 'Clear selection' : `Select all ${pendingIds.length} new requests`}</Text>
            </TouchableOpacity>
          ) : undefined}
          ListFooterComponent={siteRequestsFooter ?? undefined}
          ListEmptyComponent={siteRequests.length ? undefined : <Text style={styles.empty}>Nothing is waiting for approval.</Text>}
        />
      ) : tab === 'TODAY' ? (
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

      <ReasonSheet
        visible={!!sheet}
        title={sheet?.kind === 'bulkReject' ? `Reject ${selected.length} request${selected.length === 1 ? '' : 's'}` : 'Reject this site'}
        message="The person who raised it sees this reason."
        confirmLabel="Reject"
        danger
        busy={bulkBusy}
        onSubmit={onReason}
        onClose={() => setSheet(null)}
      />
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
  cardOn: { borderColor: theme.colors.primary, backgroundColor: '#F8FBFF' },
  headLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  check: { fontSize: 18, color: theme.colors.primary },
  selectAll: { color: theme.colors.primary, fontWeight: '700', marginBottom: 4 },
  sectionHead: { fontSize: 12.5, fontWeight: '700', color: theme.colors.textSecondary, textTransform: 'uppercase', marginTop: 12, marginBottom: 8 },
  siteCard: { marginBottom: 12 },
  rowBtns: { flexDirection: 'row', gap: 10, marginTop: 12 },
  halfBtn: { flex: 1, height: 42, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  approveBtn: { backgroundColor: '#16A34A' },
  rejectBtn: { borderWidth: 1, borderColor: '#FECACA', backgroundColor: '#FEF2F2' },
  rejectText: { color: '#DC2626', fontWeight: '700' },
  bulkBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginTop: 10, padding: 10, borderRadius: 12, backgroundColor: '#EFF6FF' },
  bulkText: { flex: 1, fontWeight: '700', color: theme.colors.textPrimary },
  bulkBtn: { height: 38, paddingHorizontal: 16, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
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
