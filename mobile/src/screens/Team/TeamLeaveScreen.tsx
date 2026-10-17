import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Image,
  ActivityIndicator, Alert, Modal, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import AppScreen from '../../components/AppScreen';
import { teamService, TeamLeaveRequest } from '../../api/teamService';
import { theme } from '../../theme/theme';
import { ds, colors as dsColors, status as dsStatus } from '../../theme/ds';
import { CheckCircle, XCircle, Clock, Users } from 'lucide-react-native';

type Tab = 'PENDING' | 'ALL';

const fmt = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

function days(r: TeamLeaveRequest): string {
  if (r.isHalfDay) return `Half day${r.halfDayPeriod ? ` (${r.halfDayPeriod})` : ''}`;
  const n = Math.round((Date.parse(r.endDate) - Date.parse(r.startDate)) / 86400000) + 1;
  return `${n} day${n === 1 ? '' : 's'}`;
}

const STATUS_STYLE: Record<string, { bg: string; fg: string; border: string; label: string; icon: any }> = {
  PENDING: { bg: dsStatus.warning.bg, fg: dsStatus.warning.fg, border: dsStatus.warning.border, label: 'Pending', icon: Clock },
  APPROVED: { bg: dsStatus.success.bg, fg: dsStatus.success.strong, border: dsStatus.success.border, label: 'Approved', icon: CheckCircle },
  REJECTED: { bg: dsStatus.danger.bg, fg: dsStatus.danger.strong, border: dsStatus.danger.border, label: 'Rejected', icon: XCircle },
  CANCELLED: { bg: dsStatus.neutral.bg, fg: dsStatus.neutral.fg, border: dsStatus.neutral.border, label: 'Cancelled', icon: XCircle },
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

  /** Summary card: what needs a decision, who is off today, approved this month. */
  const summary = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const month = today.slice(0, 7);
    const approved = rows.filter((r) => r.status === 'APPROVED');
    const offToday = approved.filter((r) => r.startDate.slice(0, 10) <= today && r.endDate.slice(0, 10) >= today);
    return {
      offToday,
      approvedMonth: approved.filter((r) => r.startDate.slice(0, 7) === month || r.endDate.slice(0, 7) === month).length,
      people: new Set(rows.map((r) => r.employee.id)).size,
    };
  }, [rows]);

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
    const StatusIcon = s.icon;
    const name = `${r.employee.firstName} ${r.employee.lastName || ''}`.trim();
    const sameDay = r.startDate.slice(0, 10) === r.endDate.slice(0, 10);
    const role = [r.employee.designation?.name, r.employee.department?.name].filter(Boolean).join(' · ');
    return (
      <View style={[ds.listCard, styles.card]}>
        <View style={styles.row}>
          {r.employee.avatarUrl
            ? <Image source={{ uri: r.employee.avatarUrl }} style={styles.avatar} />
            : <View style={[styles.avatar, styles.initials]}><Text style={styles.initialsText}>
                {((r.employee.firstName[0] || '') + (r.employee.lastName?.[0] || '')).toUpperCase()}</Text></View>}
          <View style={styles.flex}>
            <Text style={styles.name} numberOfLines={1}>{name}</Text>
            {!!role && <Text style={styles.meta} numberOfLines={1}>{role}</Text>}
          </View>
          <View style={[ds.pill, { backgroundColor: s.bg, borderColor: s.border }]}>
            <StatusIcon size={11} color={s.fg} />
            <Text style={[ds.pillText, { color: s.fg }]}>{s.label}</Text>
          </View>
        </View>

        <View style={styles.detail}>
          <View style={styles.detailTop}>
            <Text style={styles.type} numberOfLines={1}>{r.leaveType?.name}</Text>
            <Text style={styles.daysPill}>{days(r)}</Text>
          </View>
          <Text style={styles.dates}>{sameDay ? fmt(r.startDate) : `${fmt(r.startDate)} – ${fmt(r.endDate)}`}</Text>
          {!!r.reason && <Text style={styles.reason} numberOfLines={3}>“{r.reason}”</Text>}
        </View>

        {r.status === 'REJECTED' && !!r.rejectionReason && (
          <View style={styles.rejectedBox}>
            <XCircle size={13} color={dsStatus.danger.strong} />
            <Text style={styles.rejected}>{r.rejectionReason}</Text>
          </View>
        )}

        {r.status === 'PENDING' && (
          <View style={styles.actions}>
            <TouchableOpacity style={[styles.btn, styles.reject]} disabled={busyId === r.id} activeOpacity={0.8}
              onPress={() => { setReason(''); setRejecting(r); }}>
              <XCircle size={14} color={dsStatus.danger.strong} />
              <Text style={styles.rejectText}>Reject</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.approve]} disabled={busyId === r.id} activeOpacity={0.85} onPress={() => confirmApprove(r)}>
              {busyId === r.id ? <ActivityIndicator color="#fff" /> : (
                <>
                  <CheckCircle size={14} color="#FFFFFF" />
                  <Text style={styles.approveText}>Approve</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.panel}>
      {!loading && rows.length > 0 && (
        <View style={[ds.section, styles.summaryCard]}>
          <View style={ds.sectionHead}>
            <Text style={ds.sectionTitle}>Team overview</Text>
            <Text style={ds.sectionHint}>{summary.people} {summary.people === 1 ? 'person' : 'people'}</Text>
          </View>
          <View style={styles.summaryStrip}>
            {[
              { label: 'To decide', value: pending.length, tone: dsStatus.warning },
              { label: 'Off today', value: summary.offToday.length, tone: dsStatus.info },
              { label: 'Approved this month', value: summary.approvedMonth, tone: dsStatus.success },
            ].map((st) => (
              <View key={st.label} style={[styles.summaryTile, { backgroundColor: st.tone.bg, borderColor: st.tone.border }]}>
                <Text style={[styles.summaryNum, { color: st.tone.strong }]}>{st.value}</Text>
                <Text style={styles.summaryLbl} numberOfLines={2}>{st.label}</Text>
              </View>
            ))}
          </View>
          {summary.offToday.length > 0 && (
            <View style={styles.offTodayRow}>
              <Clock size={12} color={dsColors.textMuted} />
              <Text style={styles.offTodayText} numberOfLines={1}>
                Off today: {summary.offToday.map((r) => r.employee.firstName).join(', ')}
              </Text>
            </View>
          )}
        </View>
      )}

      <View style={ds.segmented}>
        {(['PENDING', 'ALL'] as Tab[]).map((t) => (
          <TouchableOpacity key={t} style={[ds.segment, tab === t && ds.segmentActive]} onPress={() => setTab(t)} activeOpacity={0.85}>
            <Text style={[ds.segmentText, tab === t && ds.segmentTextActive]}>
              {t === 'PENDING' ? `Pending (${pending.length})` : `All (${rows.length})`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? <ActivityIndicator style={styles.loader} color={theme.colors.primary} /> : (
        <View style={styles.list}>
          {shown.length ? shown.map((item) => <React.Fragment key={item.id}>{renderItem({ item })}</React.Fragment>) : (
            <View style={ds.empty}>
              <View style={ds.emptyIcon}>
                {rows.length ? <CheckCircle size={22} color={dsColors.primary} /> : <Users size={22} color={dsColors.primary} />}
              </View>
              <Text style={ds.emptyTitle}>{rows.length ? 'All caught up' : 'No team leave yet'}</Text>
              <Text style={[ds.emptyText, { marginBottom: 0 }]}>
                {rows.length ? 'No leave is waiting for your approval.' : 'Leave from people who report to you appears here.'}
              </Text>
            </View>
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
  screenBody: { paddingBottom: 120, paddingTop: 12 },
  panel: { paddingHorizontal: 16 },
  summaryCard: { paddingBottom: 14 },
  summaryStrip: { flexDirection: 'row', gap: 8, paddingHorizontal: 16 },
  summaryTile: { flex: 1, borderWidth: 1, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 8, alignItems: 'center' },
  summaryNum: { fontSize: 20, fontWeight: '900', fontVariant: ['tabular-nums'] },
  summaryLbl: { fontSize: 10.5, fontWeight: '700', color: dsColors.textSecondary, textAlign: 'center', marginTop: 2 },
  offTodayRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, marginTop: 10 },
  offTodayText: { flex: 1, fontSize: 12, fontWeight: '600', color: dsColors.textMuted },
  loader: { marginTop: 40 },
  list: { gap: 10 },
  card: { flexDirection: 'column', alignItems: 'stretch', gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 40, height: 40, borderRadius: 14 },
  initials: { backgroundColor: dsColors.primarySoft, borderWidth: 1, borderColor: dsColors.primaryBorder, alignItems: 'center', justifyContent: 'center' },
  initialsText: { color: dsColors.primary, fontWeight: '900', fontSize: 14 },
  name: { fontSize: 14.5, fontWeight: '800', color: dsColors.text },
  meta: { fontSize: 12, fontWeight: '500', color: dsColors.textMuted, marginTop: 1 },
  detail: { backgroundColor: dsColors.bg, borderWidth: 1, borderColor: dsColors.borderSoft, borderRadius: 14, padding: 10, gap: 4 },
  detailTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  type: { flex: 1, fontSize: 13.5, fontWeight: '800', color: dsColors.textBody },
  daysPill: {
    fontSize: 11.5, fontWeight: '800', color: dsColors.text, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: dsColors.border,
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, overflow: 'hidden',
  },
  dates: { fontSize: 12.5, fontWeight: '700', color: dsColors.textBody, fontVariant: ['tabular-nums'] },
  reason: { fontSize: 13, color: dsColors.textSecondary, fontStyle: 'italic', lineHeight: 18 },
  rejectedBox: {
    flexDirection: 'row', gap: 6, alignItems: 'flex-start', backgroundColor: dsStatus.danger.bg,
    borderWidth: 1, borderColor: dsStatus.danger.border, borderRadius: 10, padding: 10,
  },
  rejected: { flex: 1, fontSize: 12.5, color: dsStatus.danger.strong, fontWeight: '600', lineHeight: 17 },
  actions: { flexDirection: 'row', gap: 10 },
  btn: { flex: 1, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  approve: { backgroundColor: dsStatus.success.fg },
  approveText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  reject: { backgroundColor: dsStatus.danger.bg, borderWidth: 1, borderColor: dsStatus.danger.border },
  rejectText: { color: dsStatus.danger.strong, fontWeight: '800', fontSize: 13 },
  rejectSolid: { backgroundColor: dsStatus.danger.strong, flex: 1, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cancel: { backgroundColor: dsColors.borderSoft },
  cancelText: { color: dsColors.textBody, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'center', padding: 20 },
  sheet: { backgroundColor: '#fff', borderRadius: 22, padding: 18 },
  sheetTitle: { fontSize: 17, fontWeight: '800', color: dsColors.text },
  sheetSub: { fontSize: 13, color: dsColors.textMuted, marginTop: 4 },
  input: {
    marginTop: 12, marginBottom: 12, minHeight: 84, borderWidth: 1, borderColor: dsColors.border, borderRadius: 12,
    padding: 12, textAlignVertical: 'top', color: dsColors.text, backgroundColor: dsColors.bg, fontSize: 14,
  },
});
