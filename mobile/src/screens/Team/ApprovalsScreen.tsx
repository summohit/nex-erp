import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator, Alert,
  Modal, TextInput, Image, KeyboardAvoidingView, Platform, Linking, ScrollView,
} from 'react-native';
import AppScreen from '../../components/AppScreen';
import { workService, Regularization, AttendanceApproval, PersonLite } from '../../api/workService';
import { teamService, TeamLeaveRequest } from '../../api/teamService';
import { theme } from '../../theme/theme';

type Kind = 'LEAVE' | 'REG' | 'CLOCKOUT' | 'OUTSIDE';
type Item =
  | { kind: 'LEAVE'; id: number; row: TeamLeaveRequest }
  | { kind: 'REG'; id: number; row: Regularization }
  | { kind: 'CLOCKOUT'; id: number; row: AttendanceApproval }
  | { kind: 'OUTSIDE'; id: number; row: AttendanceApproval };

const TABS: { kind: Kind; label: string }[] = [
  { kind: 'LEAVE', label: 'Leave' },
  { kind: 'REG', label: 'Regularization' },
  { kind: 'CLOCKOUT', label: 'Late clock-out' },
  { kind: 'OUTSIDE', label: 'Out of office' },
];

const day = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' }) : '';
const time = (d?: string | null) =>
  d ? new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '—';
const nameOf = (p?: PersonLite) => (p ? `${p.firstName} ${p.lastName || ''}`.trim() : '');
const km = (v?: number | null) => (v == null ? 'no GPS' : `${v < 10 ? v.toFixed(2) : Math.round(v)} km`);

/**
 * One inbox for everything waiting on the signed-in person's decision.
 *
 * Each queue is asked for separately and only shown if it answered: the
 * server decides who may see what (HR / admins the company, a manager their
 * team), so a tab simply does not appear for someone who cannot act on it.
 */
export default function ApprovalsScreen() {
  const [data, setData] = useState<Record<Kind, Item[] | null>>({ LEAVE: null, REG: null, CLOCKOUT: null, OUTSIDE: null });
  const [tab, setTab] = useState<Kind>('LEAVE');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<Item | null>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    const [leave, reg, coOk, outOk] = await Promise.allSettled([
      teamService.getTeamLeaveRequests(),
      workService.getPendingRegularizations(),
      workService.canApproveClockOuts(),
      workService.canApproveOutOfOffice(),
    ]);
    const [co, out] = await Promise.allSettled([
      coOk.status === 'fulfilled' && coOk.value ? workService.getPendingClockOuts() : Promise.resolve(null),
      outOk.status === 'fulfilled' && outOk.value ? workService.getPendingOutOfOffice() : Promise.resolve(null),
    ]);
    const next: Record<Kind, Item[] | null> = {
      LEAVE: leave.status === 'fulfilled'
        ? leave.value.filter((r) => r.status === 'PENDING').map((row) => ({ kind: 'LEAVE' as const, id: row.id, row })) : null,
      REG: reg.status === 'fulfilled' ? reg.value.map((row) => ({ kind: 'REG' as const, id: row.id, row })) : null,
      CLOCKOUT: co.status === 'fulfilled' && co.value ? co.value.map((row) => ({ kind: 'CLOCKOUT' as const, id: row.id, row })) : null,
      OUTSIDE: out.status === 'fulfilled' && out.value ? out.value.map((row) => ({ kind: 'OUTSIDE' as const, id: row.id, row })) : null,
    };
    setData(next);
    // Land on the first tab that has something waiting.
    setTab((cur) => (next[cur]?.length ? cur : (TABS.find((t) => next[t.kind]?.length)?.kind ?? cur)));
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // A queue the server refused (not this person's to decide) has no tab.
  const visibleTabs = TABS.filter((t) => data[t.kind] !== null);
  const items = data[tab] || [];
  const total = useMemo(() => TABS.reduce((n, t) => n + (data[t.kind]?.length || 0), 0), [data]);

  const decide = async (it: Item, approve: boolean, note?: string) => {
    const key = `${it.kind}-${it.id}`;
    setBusy(key);
    try {
      if (it.kind === 'LEAVE') await teamService.decideLeave(it.id, approve ? 'APPROVED' : 'REJECTED', note);
      if (it.kind === 'REG') await workService.decideRegularization(it.id, approve ? 'APPROVED' : 'REJECTED', note);
      if (it.kind === 'CLOCKOUT') await workService.decideClockOut(it.id, approve ? 'APPROVE' : 'REJECT', note);
      if (it.kind === 'OUTSIDE') await workService.decideOutOfOffice(it.id, approve ? 'APPROVE' : 'REJECT', note);
      setData((d) => ({ ...d, [it.kind]: (d[it.kind] || []).filter((x) => x.id !== it.id) }));
    } catch (e: any) {
      Alert.alert('Could not save', e?.response?.data?.message || 'Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const confirmApprove = (it: Item) =>
    Alert.alert('Approve?', `${nameOf(it.row.employee)} · ${summary(it)}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Approve', onPress: () => decide(it, true) },
    ]);

  const summary = (it: Item): string => {
    if (it.kind === 'LEAVE') {
      const r = it.row;
      return `${r.leaveType?.name}, ${day(r.startDate)}${r.startDate.slice(0, 10) !== r.endDate.slice(0, 10) ? ` → ${day(r.endDate)}` : ''}`;
    }
    if (it.kind === 'REG') return `${day(it.row.date)}: ${time(it.row.proposedClockIn)} – ${time(it.row.proposedClockOut)}`;
    if (it.kind === 'CLOCKOUT') return `${day(it.row.date)}: clocked out ${time(it.row.clockOut)}`;
    const r = it.row;
    return `${day(r.date)}: ${[r.clockInOutside && `in ${km(r.clockInDistanceKm)}`, r.clockOutOutside && `out ${km(r.clockOutDistanceKm)}`].filter(Boolean).join(' · ')} away`;
  };

  const reasons = (it: Item): string[] => {
    if (it.kind === 'LEAVE') return it.row.reason ? [it.row.reason] : [];
    if (it.kind === 'REG') return [it.row.reason];
    if (it.kind === 'CLOCKOUT') return it.row.clockOutReason ? [it.row.clockOutReason] : [];
    return [
      it.row.clockInOutsideReason && `Clock-in: ${it.row.clockInOutsideReason}`,
      it.row.clockOutOutsideReason && `Clock-out: ${it.row.clockOutOutsideReason}`,
    ].filter(Boolean) as string[];
  };

  const renderItem = ({ item: it }: { item: Item }) => {
    const p = it.row.employee;
    const key = `${it.kind}-${it.id}`;
    const proof = it.kind === 'CLOCKOUT' ? it.row.clockOutProofUrl : null;
    return (
      <View style={styles.card}>
        <View style={styles.row}>
          {p?.avatarUrl ? <Image source={{ uri: p.avatarUrl }} style={styles.avatar} />
            : <View style={[styles.avatar, styles.initials]}><Text style={styles.initialsText}>{(p?.firstName?.[0] || '') + (p?.lastName?.[0] || '')}</Text></View>}
          <View style={styles.flex}>
            <Text style={styles.name}>{nameOf(p)}</Text>
            <Text style={styles.meta} numberOfLines={1}>
              {[p?.employeeCode && `#${p.employeeCode}`, p?.designation?.name, p?.department?.name].filter(Boolean).join(' · ')}
            </Text>
          </View>
        </View>
        <Text style={styles.summary}>{summary(it)}</Text>
        {reasons(it).map((r, i) => <Text key={i} style={styles.reason}>“{r}”</Text>)}
        {!!proof && <Text style={styles.link} onPress={() => Linking.openURL(proof)}>View attachment</Text>}
        <View style={styles.actions}>
          <TouchableOpacity style={[styles.btn, styles.reject]} disabled={busy === key} onPress={() => { setReason(''); setRejecting(it); }}>
            <Text style={styles.rejectText}>Reject</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, styles.approve]} disabled={busy === key} onPress={() => confirmApprove(it)}>
            {busy === key ? <ActivityIndicator color="#fff" /> : <Text style={styles.approveText}>Approve</Text>}
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <AppScreen title="Approvals" subtitle={total ? `${total} waiting for you` : 'Nothing waiting'}>
      {loading ? <ActivityIndicator style={styles.loader} color={theme.colors.primary} /> : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
            {visibleTabs.map((t) => (
              <TouchableOpacity key={t.kind} style={[styles.tab, tab === t.kind && styles.tabOn]} onPress={() => setTab(t.kind)}>
                <Text style={[styles.tabText, tab === t.kind && styles.tabTextOn]}>{t.label} {data[t.kind]?.length ?? 0}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <FlatList
            data={items}
            keyExtractor={(it) => `${it.kind}-${it.id}`}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
            ListEmptyComponent={<Text style={styles.empty}>{total ? 'Nothing waiting here.' : 'All caught up — nothing is waiting for your approval.'}</Text>}
          />
        </>
      )}

      <Modal visible={!!rejecting} transparent animationType="fade" onRequestClose={() => setRejecting(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Reject</Text>
            <Text style={styles.meta}>{rejecting ? `${nameOf(rejecting.row.employee)} will see this reason.` : ''}</Text>
            <TextInput style={styles.input} placeholder="Reason" value={reason} onChangeText={setReason} multiline autoFocus />
            <View style={styles.actions}>
              <TouchableOpacity style={[styles.btn, styles.cancel]} onPress={() => setRejecting(null)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, styles.rejectSolid, !reason.trim() && styles.disabled]} disabled={!reason.trim()}
                onPress={() => { const it = rejecting!; setRejecting(null); decide(it, false, reason.trim()); }}>
                <Text style={styles.approveText}>Reject</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  loader: { marginTop: 40 },
  tabs: { paddingHorizontal: 16, paddingTop: 8, gap: 8 },
  tab: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: '#F1F5F9' },
  tabOn: { backgroundColor: theme.colors.primary },
  tabText: { fontSize: 13, fontWeight: '600', color: '#475569' },
  tabTextOn: { color: '#fff' },
  list: { padding: 16, paddingBottom: 120, gap: 12 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: theme.colors.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  initials: { backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' },
  initialsText: { color: '#fff', fontWeight: '700' },
  name: { fontSize: 15, fontWeight: '700', color: theme.colors.textPrimary },
  meta: { fontSize: 12, color: theme.colors.textSecondary, marginTop: 1 },
  summary: { marginTop: 10, fontSize: 14, fontWeight: '600', color: theme.colors.primaryText },
  reason: { marginTop: 4, fontSize: 13, color: theme.colors.textSecondary, fontStyle: 'italic' },
  link: { marginTop: 6, color: theme.colors.primary, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  btn: { flex: 1, height: 42, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  approve: { backgroundColor: '#16A34A' },
  approveText: { color: '#fff', fontWeight: '700' },
  reject: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#FECACA' },
  rejectText: { color: '#DC2626', fontWeight: '700' },
  rejectSolid: { backgroundColor: '#DC2626' },
  cancel: { backgroundColor: '#F1F5F9' },
  cancelText: { color: '#334155', fontWeight: '600' },
  disabled: { opacity: 0.5 },
  empty: { textAlign: 'center', color: theme.colors.textSecondary, marginTop: 40, paddingHorizontal: 24 },
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'center', padding: 20 },
  sheet: { backgroundColor: '#fff', borderRadius: 16, padding: 18 },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: theme.colors.textPrimary },
  input: { marginTop: 12, minHeight: 80, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, padding: 10, textAlignVertical: 'top', color: theme.colors.textPrimary },
});
