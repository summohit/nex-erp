import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator, Alert, TextInput, Modal,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import AppScreen from '../../components/AppScreen';
import { timesheetService as ts, TsDay, TsPending, TsStatus, TsWeek } from '../../api/timesheetService';
import { theme } from '../../theme/theme';

const STATUS: Record<TsStatus, { label: string; bg: string; fg: string }> = {
  NOT_SUBMITTED: { label: 'Not submitted', bg: '#F1F5F9', fg: '#475569' },
  SUBMITTED: { label: 'Waiting for review', bg: '#FEF3C7', fg: '#B45309' },
  APPROVED: { label: 'Approved', bg: '#DCFCE7', fg: '#15803D' },
  REJECTED: { label: 'Rejected', bg: '#FEE2E2', fg: '#B91C1C' },
};

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** Monday of the week holding `d`, the same week the web shows. */
const mondayOf = (d: Date) => {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
};
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const dayLabel = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' });
const time = (s: string | null) => (s ? new Date(s).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '—');
const h = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace(/\.?0+$/, '') || '0'}h`;
const personName = (p: { firstName: string; lastName?: string | null }) => `${p.firstName} ${p.lastName || ''}`.trim();

/**
 * The weekly timesheet: each day's clocked-in hours beside the hours booked to
 * tasks, submitted a day at a time. Reviewers (project managers for the work
 * done on their projects, admins for everyone) get a second tab of days
 * waiting on them.
 */
export default function WeeklyTimesheetScreen() {
  const [tab, setTab] = useState<'MINE' | 'REVIEW'>('MINE');
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [week, setWeek] = useState<TsWeek | null>(null);
  const [pending, setPending] = useState<TsPending[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<TsPending | null>(null);
  const [reason, setReason] = useState('');

  const today = ymd(new Date());
  const isThisWeek = ymd(weekStart) === ymd(mondayOf(new Date()));

  const load = useCallback(async () => {
    try {
      const [w, p] = await Promise.all([
        ts.myWeek(ymd(weekStart), ymd(addDays(weekStart, 6))),
        ts.pending().catch(() => [] as TsPending[]),
      ]);
      setWeek(w);
      setPending(p);
    } catch (e: any) {
      Alert.alert('Could not load', e?.response?.data?.message || 'Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [weekStart]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const submit = (day: TsDay) => {
    const again = day.status === 'SUBMITTED' || day.status === 'REJECTED';
    Alert.alert(
      again ? 'Submit again?' : 'Submit this day?',
      `${dayLabel(day.date)} · ${h(day.loggedHours)} logged${day.unloggedHours > 0 ? ` · ${h(day.unloggedHours)} of your clocked-in time is not logged to any task` : ''}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Submit',
          onPress: async () => {
            setBusy(day.date);
            try { await ts.submitDay(day.date); await load(); } catch (e: any) {
              Alert.alert('Could not submit', e?.response?.data?.message || 'Please try again.');
            } finally { setBusy(null); }
          },
        },
      ],
    );
  };

  const decide = async (p: TsPending, decision: 'APPROVED' | 'REJECTED', why?: string) => {
    setBusy(`r${p.id}`);
    try {
      await ts.review(p.employee.id, p.date.slice(0, 10), decision, why);
      setPending((list) => list.filter((x) => x.id !== p.id));
      setRejecting(null);
      setReason('');
    } catch (e: any) {
      Alert.alert('Could not save', e?.response?.data?.message || 'Please try again.');
    } finally { setBusy(null); }
  };

  const renderDay = (d: TsDay) => {
    const st = STATUS[d.status];
    const expanded = open === d.date;
    const future = d.date > today;
    const canSubmit = !future && d.loggedHours > 0 && d.status !== 'APPROVED' && (d.status !== 'SUBMITTED' || d.changedSinceSubmission);
    const flags = [
      d.overLogged && 'More hours logged than clocked in',
      d.loggedWithoutLogin && 'Hours logged but no clock-in',
      d.hasImplausibleEntry && 'One entry is unusually long',
      d.changedSinceSubmission && d.status !== 'NOT_SUBMITTED' && 'Changed since you submitted',
      d.autoClockedOut && 'Clock-out was automatic, so clocked-in hours are an estimate',
    ].filter(Boolean) as string[];

    return (
      <View key={d.date} style={[styles.card, d.date === today && styles.today]}>
        <TouchableOpacity onPress={() => setOpen(expanded ? null : d.date)} activeOpacity={0.7}>
          <View style={styles.rowBetween}>
            <Text style={styles.dayTitle}>{dayLabel(d.date)}{d.date === today ? ' · Today' : ''}</Text>
            {(d.loggedHours > 0 || d.status !== 'NOT_SUBMITTED') && (
              <View style={[styles.pill, { backgroundColor: st.bg }]}><Text style={[styles.pillText, { color: st.fg }]}>{st.label}</Text></View>
            )}
          </View>
          <View style={styles.stats}>
            <Stat label="Clocked in" value={d.sessionOpen ? 'Running' : h(d.loginHours)} />
            <Stat label="Logged" value={h(d.loggedHours)} strong />
            <Stat label="Not logged" value={h(d.unloggedHours)} warn={d.unloggedHours > 0.5} />
          </View>
        </TouchableOpacity>

        {flags.map((f) => <Text key={f} style={styles.flag}>⚠ {f}</Text>)}
        {d.status === 'REJECTED' && !!d.rejectionReason && <Text style={styles.rejected}>Rejected: “{d.rejectionReason}”</Text>}

        {expanded && (
          <View style={styles.entries}>
            <Text style={styles.meta}>In {time(d.clockIn)} · Out {time(d.clockOut)}</Text>
            {d.entries.length === 0 ? <Text style={styles.meta}>No time logged to tasks.</Text> : d.entries.map((e) => (
              <View key={e.id} style={styles.entry}>
                <View style={styles.flex}>
                  <Text style={styles.entryTitle} numberOfLines={2}>{e.issueKey} · {e.issueTitle}</Text>
                  <Text style={styles.meta}>
                    {e.projectName || 'General'} · {time(e.startedAt)}–{time(e.endedAt)} · {e.source === 'TIMER' ? 'Timer' : 'Manual'}
                  </Text>
                  {!!e.note && <Text style={styles.note}>{e.note}</Text>}
                </View>
                <Text style={styles.entryHours}>{h(e.hours)}</Text>
              </View>
            ))}
            <Text style={styles.hint}>Add or edit time from the task itself (Tasks → open the task → Time log).</Text>
          </View>
        )}

        {canSubmit && (
          <TouchableOpacity style={styles.submit} disabled={busy === d.date} onPress={() => submit(d)}>
            {busy === d.date ? <ActivityIndicator color="#fff" /> : (
              <Text style={styles.submitText}>{d.status === 'NOT_SUBMITTED' ? 'Submit day' : 'Submit again'}</Text>
            )}
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <AppScreen title="Timesheet" subtitle="Hours logged against tasks">
      {pending.length > 0 && (
        <View style={styles.segment}>
          {(['MINE', 'REVIEW'] as const).map((t) => (
            <TouchableOpacity key={t} style={[styles.segBtn, tab === t && styles.segOn]} onPress={() => setTab(t)}>
              <Text style={[styles.segText, tab === t && styles.segTextOn]}>{t === 'MINE' ? 'My week' : `To review (${pending.length})`}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {tab === 'MINE' || pending.length === 0 ? (
        <>
          <View style={styles.weekBar}>
            <TouchableOpacity style={styles.navBtn} onPress={() => setWeekStart(addDays(weekStart, -7))}><Text style={styles.navText}>‹</Text></TouchableOpacity>
            <Text style={styles.weekText}>{dayLabel(ymd(weekStart))} – {dayLabel(ymd(addDays(weekStart, 6)))}</Text>
            <TouchableOpacity style={[styles.navBtn, isThisWeek && { opacity: 0.3 }]} disabled={isThisWeek} onPress={() => setWeekStart(addDays(weekStart, 7))}>
              <Text style={styles.navText}>›</Text>
            </TouchableOpacity>
          </View>
          {loading && !week ? <ActivityIndicator style={{ marginTop: 40 }} color={theme.colors.primary} /> : (
            <ScrollView
              contentContainerStyle={styles.body}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
              {week && (
                <View style={[styles.card, styles.totals]}>
                  <Stat label="Clocked in" value={h(week.totals.loginHours)} />
                  <Stat label="Logged" value={h(week.totals.loggedHours)} strong />
                  <Stat label="Not logged" value={h(week.totals.unloggedHours)} warn={week.totals.unloggedHours > 1} />
                </View>
              )}
              {week?.days.map(renderDay)}
            </ScrollView>
          )}
        </>
      ) : (
        <ScrollView
          contentContainerStyle={styles.body}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
          {pending.map((p) => (
            <View key={p.id} style={styles.card}>
              <View style={styles.rowBetween}>
                <View style={styles.flex}>
                  <Text style={styles.dayTitle}>{personName(p.employee)}</Text>
                  <Text style={styles.meta}>{dayLabel(p.date)} · {h(p.submittedHours ?? 0)} submitted</Text>
                </View>
              </View>
              <View style={styles.reviewRow}>
                <TouchableOpacity style={[styles.reviewBtn, styles.reject]} disabled={!!busy} onPress={() => { setReason(''); setRejecting(p); }}>
                  <Text style={styles.rejectText}>Reject</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.reviewBtn, styles.approve]} disabled={!!busy} onPress={() => decide(p, 'APPROVED')}>
                  {busy === `r${p.id}` ? <ActivityIndicator color="#fff" /> : <Text style={styles.approveText}>Approve</Text>}
                </TouchableOpacity>
              </View>
            </View>
          ))}
          <Text style={styles.hint}>To see the task-by-task entries before deciding, open Timesheets on the web.</Text>
        </ScrollView>
      )}

      <Modal visible={!!rejecting} transparent animationType="fade" onRequestClose={() => setRejecting(null)}>
        <View style={styles.backdrop}>
          <View style={styles.dialog}>
            <Text style={styles.dayTitle}>Reject {rejecting ? personName(rejecting.employee) : ''}'s day?</Text>
            <Text style={styles.meta}>{rejecting ? dayLabel(rejecting.date) : ''} · they will see your reason</Text>
            <TextInput style={styles.input} placeholder="Reason (required)" value={reason} onChangeText={setReason} multiline />
            <View style={styles.reviewRow}>
              <TouchableOpacity style={[styles.reviewBtn, styles.cancel]} onPress={() => setRejecting(null)}><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity
                style={[styles.reviewBtn, styles.rejectSolid, !reason.trim() && { opacity: 0.5 }]}
                disabled={!reason.trim() || !!busy}
                onPress={() => rejecting && decide(rejecting, 'REJECTED', reason.trim())}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.approveText}>Reject</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </AppScreen>
  );
}

function Stat({ label, value, strong, warn }: { label: string; value: string; strong?: boolean; warn?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, strong && { color: theme.colors.primary }, warn && { color: '#D97706' }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, paddingBottom: 120, gap: 10 },
  flex: { flex: 1 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  segment: { flexDirection: 'row', backgroundColor: '#F1F5F9', borderRadius: 10, padding: 3, marginHorizontal: 16, marginTop: 12 },
  segBtn: { flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center' },
  segOn: { backgroundColor: '#fff' },
  segText: { fontSize: 13, fontWeight: '600', color: '#64748B' },
  segTextOn: { color: theme.colors.primary },
  weekBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 12 },
  navBtn: { width: 40, height: 40, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  navText: { fontSize: 22, color: theme.colors.textPrimary, marginTop: -2 },
  weekText: { fontSize: 14, fontWeight: '700', color: theme.colors.textPrimary },
  card: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, padding: 14 },
  today: { borderColor: theme.colors.primary },
  totals: { flexDirection: 'row' },
  dayTitle: { fontSize: 15, fontWeight: '700', color: theme.colors.textPrimary },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  pillText: { fontSize: 11, fontWeight: '700' },
  stats: { flexDirection: 'row', marginTop: 10 },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 17, fontWeight: '800', color: theme.colors.textPrimary },
  statLabel: { fontSize: 11, color: theme.colors.textSecondary, marginTop: 2 },
  flag: { fontSize: 12, color: '#B45309', marginTop: 6 },
  rejected: { fontSize: 12.5, color: '#B91C1C', marginTop: 6 },
  entries: { marginTop: 10, borderTopWidth: 1, borderTopColor: '#F1F5F9', paddingTop: 10, gap: 8 },
  entry: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  entryTitle: { fontSize: 13.5, fontWeight: '600', color: theme.colors.textPrimary },
  entryHours: { fontSize: 14, fontWeight: '800', color: theme.colors.textPrimary },
  note: { fontSize: 12, color: theme.colors.textSecondary, fontStyle: 'italic', marginTop: 2 },
  meta: { fontSize: 12, color: theme.colors.textSecondary },
  hint: { fontSize: 12, color: theme.colors.textMuted, textAlign: 'center', marginTop: 4 },
  submit: { marginTop: 12, height: 42, borderRadius: 10, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' },
  submitText: { color: '#fff', fontWeight: '700' },
  reviewRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  reviewBtn: { flex: 1, height: 42, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  reject: { borderWidth: 1, borderColor: '#FECACA', backgroundColor: '#FEF2F2' },
  rejectText: { color: '#B91C1C', fontWeight: '700' },
  rejectSolid: { backgroundColor: '#DC2626' },
  approve: { backgroundColor: '#16A34A' },
  approveText: { color: '#fff', fontWeight: '700' },
  cancel: { borderWidth: 1, borderColor: theme.colors.border },
  cancelText: { color: theme.colors.textPrimary, fontWeight: '600' },
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'center', padding: 24 },
  dialog: { backgroundColor: '#fff', borderRadius: 14, padding: 18, gap: 8 },
  input: { minHeight: 80, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, padding: 10, textAlignVertical: 'top', color: theme.colors.textPrimary, marginTop: 6 },
});
