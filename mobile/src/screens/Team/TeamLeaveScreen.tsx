import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Image,
  ActivityIndicator, Alert, Modal, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import AppScreen from '../../components/AppScreen';
import { teamService, TeamLeaveRequest } from '../../api/teamService';
import { theme } from '../../theme/theme';

type Tab = 'PENDING' | 'ALL';

const fmt = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

function days(r: TeamLeaveRequest): string {
  if (r.isHalfDay) return `Half day${r.halfDayPeriod ? ` (${r.halfDayPeriod})` : ''}`;
  const n = Math.round((Date.parse(r.endDate) - Date.parse(r.startDate)) / 86400000) + 1;
  return `${n} day${n === 1 ? '' : 's'}`;
}

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  PENDING: { bg: '#FEF3C7', fg: '#92400E', label: 'Pending' },
  APPROVED: { bg: '#DCFCE7', fg: '#166534', label: 'Approved' },
  REJECTED: { bg: '#FEE2E2', fg: '#991B1B', label: 'Rejected' },
  CANCELLED: { bg: '#F1F5F9', fg: '#475569', label: 'Cancelled' },
};

/**
 * Leave from the people who report to you, with Approve / Reject.
 *
 * Managers in MIRA hold ordinary roles and manage through the reporting line,
 * which is exactly what /leaves/requests/managers returns. The server checks
 * the line again on every decision, so this screen cannot overreach.
 */
export default function TeamLeaveScreen() {
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <AppScreen title="Team Leave" subtitle="Approve your team's leave">
      <ScrollView
        contentContainerStyle={styles.screenBody}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => setRefreshKey((k) => k + 1)} />}
      >
        <TeamLeavePanel refreshKey={refreshKey} />
      </ScrollView>
    </AppScreen>
  );
}

/**
 * The team's leave with Approve / Reject, without a screen around it, so the
 * Leaves tab can show it beside My Requests. Rendered as plain views (not a
 * FlatList) because it sits inside the tab's own ScrollView.
 */
export function TeamLeavePanel({ refreshKey = 0, onLoaded }: { refreshKey?: number; onLoaded?: (rows: TeamLeaveRequest[]) => void }) {
  const [rows, setRows] = useState<TeamLeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('PENDING');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [rejecting, setRejecting] = useState<TeamLeaveRequest | null>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await teamService.getTeamLeaveRequests();
      setRows(data);
      onLoaded?.(data);
    } catch (e: any) {
      Alert.alert('Could not load team leave', e?.response?.data?.message || 'Please try again.');
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const pending = useMemo(() => rows.filter((r) => r.status === 'PENDING'), [rows]);
  const shown = tab === 'PENDING' ? pending : rows;

  const decide = async (r: TeamLeaveRequest, status: 'APPROVED' | 'REJECTED', why?: string) => {
    setBusyId(r.id);
    try {
      await teamService.decideLeave(r.id, status, why);
      setRows((prev) => {
        const next = prev.map((x) => (x.id === r.id ? { ...x, status, rejectionReason: why ?? null } : x));
        onLoaded?.(next);
        return next;
      });
    } catch (e: any) {
      Alert.alert('Could not save', e?.response?.data?.message || 'Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  const confirmApprove = (r: TeamLeaveRequest) =>
    Alert.alert('Approve leave?', `${r.employee.firstName}'s ${r.leaveType.name}, ${fmt(r.startDate)} · ${days(r)}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Approve', onPress: () => decide(r, 'APPROVED') },
    ]);

  const submitReject = () => {
    if (!rejecting || !reason.trim()) return;
    const r = rejecting;
    setRejecting(null);
    decide(r, 'REJECTED', reason.trim());
    setReason('');
  };

  const renderItem = ({ item: r }: { item: TeamLeaveRequest }) => {
    const s = STATUS_STYLE[r.status] || STATUS_STYLE.PENDING;
    const name = `${r.employee.firstName} ${r.employee.lastName || ''}`.trim();
    const sameDay = r.startDate.slice(0, 10) === r.endDate.slice(0, 10);
    return (
      <View style={styles.card}>
        <View style={styles.row}>
          {r.employee.avatarUrl
            ? <Image source={{ uri: r.employee.avatarUrl }} style={styles.avatar} />
            : <View style={[styles.avatar, styles.initials]}><Text style={styles.initialsText}>
                {(r.employee.firstName[0] || '') + (r.employee.lastName?.[0] || '')}</Text></View>}
          <View style={styles.flex}>
            <Text style={styles.name}>{name}</Text>
            <Text style={styles.meta} numberOfLines={1}>
              {[r.employee.designation?.name, r.employee.department?.name].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <View style={[styles.badge, { backgroundColor: s.bg }]}><Text style={[styles.badgeText, { color: s.fg }]}>{s.label}</Text></View>
        </View>

        <View style={styles.detail}>
          <Text style={styles.type}>{r.leaveType?.name}</Text>
          <Text style={styles.dates}>{sameDay ? fmt(r.startDate) : `${fmt(r.startDate)} → ${fmt(r.endDate)}`} · {days(r)}</Text>
          {!!r.reason && <Text style={styles.reason}>“{r.reason}”</Text>}
          {r.status === 'REJECTED' && !!r.rejectionReason && <Text style={styles.rejected}>Rejected: {r.rejectionReason}</Text>}
        </View>

        {r.status === 'PENDING' && (
          <View style={styles.actions}>
            <TouchableOpacity style={[styles.btn, styles.reject]} disabled={busyId === r.id}
              onPress={() => { setReason(''); setRejecting(r); }}>
              <Text style={styles.rejectText}>Reject</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.approve]} disabled={busyId === r.id} onPress={() => confirmApprove(r)}>
              {busyId === r.id ? <ActivityIndicator color="#fff" /> : <Text style={styles.approveText}>Approve</Text>}
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  return (
    <View>
      <View style={styles.tabs}>
        {(['PENDING', 'ALL'] as Tab[]).map((t) => (
          <TouchableOpacity key={t} style={[styles.tab, tab === t && styles.tabActive]} onPress={() => setTab(t)}>
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === 'PENDING' ? `Pending (${pending.length})` : `All (${rows.length})`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? <ActivityIndicator style={styles.loader} color={theme.colors.primary} /> : (
        <View style={styles.list}>
          {shown.length ? shown.map((item) => <React.Fragment key={item.id}>{renderItem({ item })}</React.Fragment>) : (
            <Text style={styles.empty}>
              {rows.length ? 'No pending leave. You are all caught up.' : 'No leave from your team yet. Only people who report to you appear here.'}
            </Text>
          )}
        </View>
      )}

      <Modal visible={!!rejecting} transparent animationType="fade" onRequestClose={() => setRejecting(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Reject leave</Text>
            <Text style={styles.sheetSub}>{rejecting?.employee.firstName} will see this reason.</Text>
            <TextInput
              style={styles.input} placeholder="e.g. Project deadline that week" value={reason}
              onChangeText={setReason} multiline autoFocus
            />
            <View style={styles.actions}>
              <TouchableOpacity style={[styles.btn, styles.cancel]} onPress={() => setRejecting(null)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, styles.rejectSolid, !reason.trim() && styles.disabled]}
                disabled={!reason.trim()} onPress={submitReject}>
                <Text style={styles.approveText}>Reject</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screenBody: { paddingBottom: 120 },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 8 },
  tab: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: '#F1F5F9' },
  tabActive: { backgroundColor: theme.colors.primary },
  tabText: { fontSize: 13, fontWeight: '600', color: '#475569' },
  tabTextActive: { color: '#fff' },
  loader: { marginTop: 40 },
  list: { padding: 16, gap: 12 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: theme.colors.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  initials: { backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' },
  initialsText: { color: '#fff', fontWeight: '700' },
  name: { fontSize: 15, fontWeight: '700', color: theme.colors.textPrimary },
  meta: { fontSize: 12, color: theme.colors.textSecondary, marginTop: 1 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  detail: { marginTop: 10, gap: 3 },
  type: { fontSize: 14, fontWeight: '600', color: theme.colors.primaryText },
  dates: { fontSize: 13, color: theme.colors.textPrimary },
  reason: { fontSize: 13, color: theme.colors.textSecondary, fontStyle: 'italic' },
  rejected: { fontSize: 12, color: '#991B1B' },
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
  sheetSub: { fontSize: 13, color: theme.colors.textSecondary, marginTop: 4 },
  input: { marginTop: 12, minHeight: 80, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, padding: 10, textAlignVertical: 'top', color: theme.colors.textPrimary },
});
