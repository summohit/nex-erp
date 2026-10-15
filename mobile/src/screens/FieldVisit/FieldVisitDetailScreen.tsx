import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, TextInput, Linking, RefreshControl,
} from 'react-native';
import DateTimePickerModal from 'react-native-modal-datetime-picker';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import AppScreen from '../../components/AppScreen';
import {
  fieldVisitRequestService as fv, FieldVisitDetail, FvActivity, FvAttendance, FvApprovalEdits, ROSTER_DAY_OFF_CLASH,
} from '../../api/fieldVisitRequestService';
import ReasonSheet from './ReasonSheet';
import { theme } from '../../theme/theme';
import {
  fvStatus, FV_ACTIVITY, dateLabel, timeLabel, clockAt, whenLabel, range, who, metres, mapsUrl,
} from './fvFormat';

/**
 * One field visit, end to end — the mobile counterpart of the web's request
 * detail: who asked, who is going, the tasks, the site, each person's days with
 * how far from the site they clocked, and the history.
 *
 * Every action is shown only when the server says this person may take it (the
 * can* flags on GET /field-visit-requests/:id). The list screen used to offer
 * Withdraw and Cancel to everyone and let the server refuse.
 */
export default function FieldVisitDetailScreen() {
  const navigation = useNavigation<any>();
  const { id } = useRoute<any>().params as { id: number };
  const [visit, setVisit] = useState<FieldVisitDetail | null>(null);
  const [timeline, setTimeline] = useState<FvActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [isApprover, setIsApprover] = useState(false);
  // Which reason sheet is open, and for what.
  const [sheet, setSheet] = useState<null | 'reject' | 'cancel' | 'rejectChange' | { status: string }>(null);
  const [statusMenu, setStatusMenu] = useState(false);
  // Super Admin: correct a pending request while approving it.
  const [edit, setEdit] = useState<{ location: string; startDate: string; endDate: string; startTime: string; endTime: string; reason: string } | null>(null);
  const [editPicker, setEditPicker] = useState<null | 'startDate' | 'endDate' | 'startTime' | 'endTime'>(null);

  const load = useCallback(async () => {
    try {
      const [v, t, caps] = await Promise.all([
        fv.get(id), fv.timeline(id).catch(() => []), fv.capabilities().catch(() => null),
      ]);
      setVisit(v);
      setTimeline(t);
      setIsApprover(!!caps?.isApprover);
      setError(null);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Could not load this field visit.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  /** Each day of the trip, with everyone's attendance on it. */
  const days = useMemo(() => {
    const byDay = new Map<string, FvAttendance[]>();
    for (const a of visit?.attendances ?? []) {
      const key = a.visitDate.slice(0, 10);
      byDay.set(key, [...(byDay.get(key) ?? []), a]);
    }
    return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [visit]);

  const act = async (label: string, run: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await run();
      await load();
    } catch (e: any) {
      Alert.alert(`Could not ${label}`, e?.response?.data?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const withdraw = () =>
    Alert.alert('Withdraw request?', `${visit!.requestNumber} goes back to a draft.`, [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Withdraw', style: 'destructive', onPress: () => act('withdraw', () => fv.withdraw(id)) },
    ]);

  const sendForApproval = () =>
    act('send it', async () => {
      const saved = await fv.submit(id);
      Alert.alert(saved?.status === 'APPROVED' ? 'Approved' : 'Sent for approval',
        saved?.status === 'APPROVED' ? `${visit!.requestNumber} is approved.` : `${visit!.requestNumber} is waiting for approval.`);
    });

  const errorOf = (e: any) => {
    const m = e?.response?.data?.message;
    return Array.isArray(m) ? m.join('\n') : m || e?.message || 'Please try again.';
  };

  /**
   * Approve, with the same day-off rule as the web: if the trip lands on someone's
   * rostered day off, show which and offer to approve anyway (roster them on site).
   */
  const approve = async (override = false, edits?: FvApprovalEdits, editReason?: string) => {
    setBusy(true);
    try {
      await fv.approve(id, { overrideDayOff: override, edits, editReason });
      setEdit(null);
      await load();
      Alert.alert('Approved', `${visit!.requestNumber} is approved. Everyone on it has their tasks and days.`);
    } catch (e: any) {
      const data = e?.response?.data;
      if (!override && data?.code === ROSTER_DAY_OFF_CLASH) {
        Alert.alert('This trip falls on rostered days off', errorOf(e), [
          { text: 'Back', style: 'cancel' },
          { text: 'Approve and override days off', onPress: () => approve(true, edits, editReason) },
        ]);
      } else {
        Alert.alert('Could not approve', errorOf(e));
      }
    } finally {
      setBusy(false);
    }
  };

  /** Any administrator status move; APPROVED goes through the same day-off check. */
  const moveTo = async (status: string, reason?: string, override = false) => {
    setBusy(true);
    try {
      await fv.changeStatus(id, status, reason, override);
      setSheet(null);
      setStatusMenu(false);
      await load();
    } catch (e: any) {
      if (status === 'APPROVED' && !override && e?.response?.data?.code === ROSTER_DAY_OFF_CLASH) {
        Alert.alert('This trip falls on rostered days off', errorOf(e), [
          { text: 'Back', style: 'cancel' },
          { text: 'Approve and override days off', onPress: () => moveTo(status, reason, true) },
        ]);
      } else {
        Alert.alert('Could not change the status', errorOf(e));
      }
    } finally {
      setBusy(false);
    }
  };

  const onReason = (reason: string) => {
    if (sheet === 'reject') act('reject', async () => { await fv.reject(id, reason); setSheet(null); });
    else if (sheet === 'cancel') act('cancel', async () => { await fv.cancel(id, reason); setSheet(null); });
    else if (sheet === 'rejectChange') act('reject the change', async () => { await fv.rejectChange(id, reason); setSheet(null); });
    else if (sheet && typeof sheet === 'object') moveTo(sheet.status, reason || undefined);
  };

  const markComplete = () =>
    Alert.alert('Mark complete?', `${visit!.requestNumber} is closed as completed.`, [
      { text: 'Back', style: 'cancel' },
      { text: 'Mark complete', onPress: () => act('mark it complete', () => fv.complete(id)) },
    ]);

  const approveChange = () =>
    Alert.alert('Approve the change?', 'The visit, its people, tasks and days are updated to the proposal.', [
      { text: 'Back', style: 'cancel' },
      { text: 'Approve change', onPress: () => act('approve the change', () => fv.approveChange(id)) },
    ]);

  const startEdit = () => setEdit({
    location: visit!.location, startDate: visit!.startDate.slice(0, 10), endDate: visit!.endDate.slice(0, 10),
    startTime: visit!.startTime, endTime: visit!.endTime, reason: '',
  });

  /** Only what the Super Admin actually changed goes to the server. */
  const approveEdited = () => {
    if (!edit) return;
    const edits: FvApprovalEdits = {};
    if (edit.location.trim() !== visit!.location) edits.location = edit.location.trim();
    if (edit.startDate !== visit!.startDate.slice(0, 10)) edits.startDate = edit.startDate;
    if (edit.endDate !== visit!.endDate.slice(0, 10)) edits.endDate = edit.endDate;
    if (edit.startTime !== visit!.startTime) edits.startTime = edit.startTime;
    if (edit.endTime !== visit!.endTime) edits.endTime = edit.endTime;
    if (!Object.keys(edits).length) { Alert.alert('Nothing changed', 'Change something, or approve it as it is.'); return; }
    if (edit.endDate < edit.startDate) { Alert.alert('Check the dates', 'The end date is before the start date.'); return; }
    if (!edit.reason.trim()) { Alert.alert('Give a reason', 'Say why it was changed — the person who raised it is told.'); return; }
    approve(false, edits, edit.reason.trim());
  };

  const back = (
    <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backRow} accessibilityRole="button">
      <Text style={styles.back}>‹ Field Visits</Text>
    </TouchableOpacity>
  );

  if (loading) {
    return <AppScreen title="Field Visit">{back}<ActivityIndicator style={styles.loader} color={theme.colors.primary} /></AppScreen>;
  }
  if (!visit) {
    return <AppScreen title="Field Visit">{back}<Text style={styles.empty}>{error}</Text></AppScreen>;
  }

  const s = fvStatus(visit.status);
  // Administrators may move a request to another status (server changeStatus),
  // including a finished one back to pending.
  const canMoveStatus = isApprover;
  return (
    <AppScreen title={visit.requestNumber} subtitle={visit.project?.isSystem ? 'General visit' : visit.project?.name}>
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      >
        {back}
        <View style={[styles.badge, { backgroundColor: s.bg }]}><Text style={[styles.badgeText, { color: s.fg }]}>{s.label}</Text></View>

        <Text style={styles.site}>{visit.location}</Text>
        <Text style={styles.link} onPress={() => Linking.openURL(mapsUrl(visit.latitude, visit.longitude))}>Open site in Maps</Text>
        <Text style={styles.meta}>{range(visit)} · {visit.visitDays} day{visit.visitDays === 1 ? '' : 's'}</Text>
        <Text style={styles.meta}>
          {timeLabel(visit.startTime)} – {timeLabel(visit.endTime)} · clock in within {metres(visit.geofenceRadiusM / 1000)} of the site
        </Text>
        {!!visit.raisedBy && <Text style={styles.meta}>Raised by {who(visit.raisedBy)}</Text>}
        {!!visit.reviewedBy && visit.reviewedAt && (
          <Text style={styles.meta}>Reviewed by {who(visit.reviewedBy)} · {whenLabel(visit.reviewedAt)}</Text>
        )}
        {visit.status === 'REJECTED' && !!visit.rejectionReason && <Text style={styles.rejected}>Rejected: {visit.rejectionReason}</Text>}
        {!!visit.pendingChange && <Text style={styles.notice}>A change to this visit is waiting for approval.</Text>}

        <Text style={styles.section}>People ({visit.members.length})</Text>
        {visit.members.map((m) => <Text key={m.id} style={styles.item}>• {who(m.employee)}</Text>)}

        <Text style={styles.section}>Tasks ({visit.tasks.length})</Text>
        {visit.tasks.map((t) => <Text key={t.id} style={styles.item}>• {t.issue ? `${t.issue.key} · ${t.issue.title}` : t.name}</Text>)}

        {!!visit.remarks && (<><Text style={styles.section}>Remarks</Text><Text style={styles.item}>{visit.remarks}</Text></>)}

        {(visit.attachments?.length ?? 0) > 0 && <Text style={styles.section}>Attachments ({visit.attachments!.length})</Text>}
        {visit.attachments?.map((a, i) => (
          <Text key={a.id ?? i} style={[styles.item, styles.linkItem]} numberOfLines={1} onPress={() => Linking.openURL(a.fileUrl)}>📎 {a.fileName}</Text>
        ))}

        {days.length > 0 && <Text style={styles.section}>Days on site</Text>}
        {days.map(([day, rows]) => (
          <View key={day} style={styles.dayCard}>
            <Text style={styles.dayTitle}>{dateLabel(day)}{rows[0]?.isHoliday ? ' · holiday' : ''}</Text>
            {rows.map((a) => (
              <View key={a.id} style={styles.dayRow}>
                <Text style={styles.dayWho}>{who(a.employee)}</Text>
                <Text style={styles.dayWhat}>
                  {a.clockInTime
                    ? `In ${clockAt(a.clockInTime)}${a.clockInDistanceKm != null ? ` (${metres(a.clockInDistanceKm)})` : ''}`
                      + (a.clockOutTime ? ` · Out ${clockAt(a.clockOutTime)}${a.clockOutDistanceKm != null ? ` (${metres(a.clockOutDistanceKm)})` : ''}` : ' · on site')
                    : a.status.replace(/_/g, ' ').toLowerCase()}
                </Text>
                {!!a.issue && <Text style={styles.dayTask}>{a.issue.key} · {a.issue.title}</Text>}
              </View>
            ))}
          </View>
        ))}

        {timeline.length > 0 && <Text style={styles.section}>History</Text>}
        {timeline.map((t) => (
          <View key={t.id} style={styles.tlRow}>
            <View style={styles.tlDot} />
            <View style={styles.tlText}>
              <Text style={styles.tlWhat}>{t.detail || FV_ACTIVITY[t.action] || t.action}</Text>
              <Text style={styles.tlMeta}>{t.actor ? `${who(t.actor)} · ` : ''}{whenLabel(t.createdAt)}</Text>
            </View>
          </View>
        ))}

        {!!visit.pendingChange && (
          <View style={styles.changeBox}>
            <Text style={styles.changeTitle}>Proposed change</Text>
            {changeRows(visit).map(([label, from, to]) => (
              <Text key={label} style={styles.changeLine}>{label}: <Text style={styles.changeFrom}>{from}</Text> → <Text style={styles.changeTo}>{to}</Text></Text>
            ))}
            {visit.canReviewChange && (
              <View style={styles.rowBtns}>
                <TouchableOpacity style={[styles.halfBtn, styles.actionPrimary]} disabled={busy} onPress={approveChange}>
                  <Text style={styles.solidText}>Approve change</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.halfBtn, styles.actionDanger]} disabled={busy} onPress={() => setSheet('rejectChange')}>
                  <Text style={styles.actionDangerText}>Reject change</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {visit.canReview && !edit && (
          <View style={styles.rowBtns}>
            <TouchableOpacity style={[styles.halfBtn, styles.approveBtn]} disabled={busy} onPress={() => approve()}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.solidText}>Approve</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={[styles.halfBtn, styles.actionDanger]} disabled={busy} onPress={() => setSheet('reject')}>
              <Text style={styles.actionDangerText}>Reject</Text>
            </TouchableOpacity>
          </View>
        )}
        {visit.canReview && visit.canEdit && visit.status === 'PENDING_APPROVAL' && !edit && (
          <TouchableOpacity style={[styles.action, styles.actionGhost]} disabled={busy} onPress={startEdit}>
            <Text style={styles.actionGhostText}>Edit and approve (Super Admin)</Text>
          </TouchableOpacity>
        )}
        {edit && (
          <View style={styles.editBox}>
            <Text style={styles.changeTitle}>Correct, then approve</Text>
            <Text style={styles.label}>Site name</Text>
            <TextInput style={styles.field} value={edit.location} onChangeText={(v) => setEdit({ ...edit, location: v })} />
            <View style={styles.rowBtns}>
              <TouchableOpacity style={[styles.field, styles.flex]} onPress={() => setEditPicker('startDate')}><Text style={styles.fieldText}>From {dateLabel(edit.startDate)}</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.field, styles.flex]} onPress={() => setEditPicker('endDate')}><Text style={styles.fieldText}>To {dateLabel(edit.endDate)}</Text></TouchableOpacity>
            </View>
            <View style={styles.rowBtns}>
              <TouchableOpacity style={[styles.field, styles.flex]} onPress={() => setEditPicker('startTime')}><Text style={styles.fieldText}>In {timeLabel(edit.startTime)}</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.field, styles.flex]} onPress={() => setEditPicker('endTime')}><Text style={styles.fieldText}>Out {timeLabel(edit.endTime)}</Text></TouchableOpacity>
            </View>
            <Text style={styles.label}>Why it was changed *</Text>
            <TextInput style={[styles.field, styles.area]} value={edit.reason} multiline placeholder="The person who raised it is told"
              onChangeText={(v) => setEdit({ ...edit, reason: v })} />
            <TouchableOpacity style={[styles.action, styles.approveBtn]} disabled={busy} onPress={approveEdited}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.solidText}>Approve with changes</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setEdit(null)}><Text style={styles.keep}>Discard changes</Text></TouchableOpacity>
          </View>
        )}

        {visit.canComplete && (
          <TouchableOpacity style={[styles.action, styles.actionGhost]} disabled={busy} onPress={markComplete}>
            <Text style={styles.actionGhostText}>Mark complete</Text>
          </TouchableOpacity>
        )}

        {visit.canSubmit && (
          <TouchableOpacity style={[styles.action, styles.actionPrimary]} disabled={busy} onPress={sendForApproval}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.solidText}>Send for approval</Text>}
          </TouchableOpacity>
        )}
        {visit.canEdit && visit.status === 'DRAFT' && (
          <TouchableOpacity style={[styles.action, styles.actionGhost]} disabled={busy}
            onPress={() => navigation.navigate('FieldVisitRequestForm', { mode: 'edit', id })}>
            <Text style={styles.actionGhostText}>Edit draft</Text>
          </TouchableOpacity>
        )}
        {visit.canRequestChange && (
          <TouchableOpacity style={[styles.action, styles.actionGhost]} disabled={busy}
            onPress={() => navigation.navigate('FieldVisitRequestForm', { mode: 'change', id })}>
            <Text style={styles.actionGhostText}>Request a change</Text>
          </TouchableOpacity>
        )}
        {visit.canWithdraw && (
          <TouchableOpacity style={[styles.action, styles.actionGhost]} disabled={busy} onPress={withdraw}>
            <Text style={styles.actionGhostText}>Withdraw to draft</Text>
          </TouchableOpacity>
        )}
        {visit.canCancel && (
          <TouchableOpacity style={[styles.action, styles.actionDanger]} disabled={busy} onPress={() => setSheet('cancel')}>
            <Text style={styles.actionDangerText}>Cancel this visit</Text>
          </TouchableOpacity>
        )}

        {canMoveStatus && (
          <TouchableOpacity onPress={() => setStatusMenu((v) => !v)} disabled={busy}>
            <Text style={styles.statusLink}>{statusMenu ? 'Hide status options' : 'Change status…'}</Text>
          </TouchableOpacity>
        )}
        {statusMenu && (
          <View style={styles.statusMenu}>
            {STATUS_TARGETS.filter((t) => t.value !== visit.status).map((t) => (
              <TouchableOpacity key={t.value} style={styles.statusOpt} disabled={busy}
                onPress={() => (t.reason ? setSheet({ status: t.value }) : moveTo(t.value))}>
                <Text style={styles.statusOptText}>Move to {t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>

      <ReasonSheet
        visible={!!sheet}
        title={sheet === 'reject' ? 'Reject this request' : sheet === 'cancel' ? 'Cancel this visit'
          : sheet === 'rejectChange' ? 'Reject the change' : `Move to ${STATUS_TARGETS.find((t) => typeof sheet === 'object' && sheet && t.value === sheet.status)?.label ?? ''}`}
        message={sheet === 'cancel' ? 'Everyone on it is told.' : sheet === 'reject' || sheet === 'rejectChange' ? 'The person who raised it sees this reason.' : undefined}
        confirmLabel={sheet === 'reject' ? 'Reject' : sheet === 'cancel' ? 'Cancel visit' : sheet === 'rejectChange' ? 'Reject change' : 'Change status'}
        danger
        required={sheet === 'reject' || sheet === 'rejectChange'}
        busy={busy}
        onSubmit={onReason}
        onClose={() => setSheet(null)}
      />

      <DateTimePickerModal
        isVisible={!!editPicker}
        mode={editPicker === 'startDate' || editPicker === 'endDate' ? 'date' : 'time'}
        date={(() => {
          if (!edit || !editPicker) return new Date();
          if (editPicker === 'startDate' || editPicker === 'endDate') return new Date(`${edit[editPicker]}T00:00:00`);
          const [h, m] = edit[editPicker].split(':').map(Number); const d = new Date(); d.setHours(h, m, 0, 0); return d;
        })()}
        onConfirm={(d) => {
          if (edit && editPicker) {
            const v = editPicker === 'startDate' || editPicker === 'endDate'
              ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
              : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
            setEdit({ ...edit, [editPicker]: v });
          }
          setEditPicker(null);
        }}
        onCancel={() => setEditPicker(null)}
      />
    </AppScreen>
  );
}

/** Where an administrator may move a request (server changeStatus); `reason` asks for one first. */
const STATUS_TARGETS: { value: string; label: string; reason: boolean }[] = [
  { value: 'PENDING_APPROVAL', label: 'Waiting approval', reason: false },
  { value: 'APPROVED', label: 'Approved', reason: false },
  { value: 'REJECTED', label: 'Rejected', reason: true },
  { value: 'CANCELLED', label: 'Cancelled', reason: true },
  { value: 'COMPLETED', label: 'Completed', reason: false },
];

/** A proposed change, as "what → what" lines for the fields that differ. */
function changeRows(v: FieldVisitDetail): [string, string, string][] {
  const c = v.pendingChange || {};
  const rows: [string, string, string][] = [];
  if (c.location && c.location !== v.location) rows.push(['Site', v.location, c.location]);
  const from = range(v);
  const to = c.startDate && c.endDate ? range({ startDate: c.startDate, endDate: c.endDate }) : from;
  if (to !== from) rows.push(['Dates', from, to]);
  const hours = `${timeLabel(v.startTime)} – ${timeLabel(v.endTime)}`;
  const newHours = `${timeLabel(c.startTime ?? v.startTime)} – ${timeLabel(c.endTime ?? v.endTime)}`;
  if (newHours !== hours) rows.push(['Hours', hours, newHours]);
  if (Array.isArray(c.employeeIds)) {
    const now = v.members.map((m) => m.employee.id).sort().join(',');
    if ([...c.employeeIds].sort().join(',') !== now) rows.push(['People', String(v.members.length), String(c.employeeIds.length)]);
  }
  if (Array.isArray(c.tasks) && c.tasks.length !== v.tasks.length) rows.push(['Tasks', String(v.tasks.length), String(c.tasks.length)]);
  if (!rows.length) rows.push(['Details', 'as approved', 'see the request']);
  return rows;
}

const styles = StyleSheet.create({
  body: { padding: 16, paddingBottom: 120 },
  loader: { marginTop: 40 },
  empty: { textAlign: 'center', color: theme.colors.textSecondary, marginTop: 40, paddingHorizontal: 24 },
  backRow: { paddingVertical: 6, marginBottom: 6 },
  back: { color: theme.colors.primary, fontWeight: '700', fontSize: 14 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, alignSelf: 'flex-start' },
  badgeText: { fontSize: 11, fontWeight: '700' },
  site: { fontSize: 18, fontWeight: '800', color: theme.colors.textPrimary, marginTop: 8 },
  link: { color: theme.colors.primary, fontWeight: '600', marginTop: 6 },
  meta: { fontSize: 13, color: theme.colors.textSecondary, marginTop: 4 },
  rejected: { marginTop: 8, fontSize: 13, color: '#B91C1C' },
  notice: { marginTop: 8, fontSize: 13, color: '#92400E', backgroundColor: '#FEF3C7', padding: 8, borderRadius: 8 },
  section: { marginTop: 20, fontSize: 12.5, fontWeight: '700', color: theme.colors.textSecondary, textTransform: 'uppercase' },
  item: { fontSize: 14, color: theme.colors.textPrimary, marginTop: 5 },
  dayCard: { marginTop: 8, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: '#fff' },
  dayTitle: { fontWeight: '700', color: theme.colors.textPrimary, marginBottom: 4 },
  dayRow: { marginTop: 6 },
  dayWho: { fontSize: 13.5, fontWeight: '600', color: theme.colors.textPrimary },
  dayWhat: { fontSize: 12.5, color: theme.colors.textSecondary, marginTop: 1 },
  dayTask: { fontSize: 12, color: theme.colors.textMuted, marginTop: 1 },
  tlRow: { flexDirection: 'row', marginTop: 10, gap: 10 },
  tlDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.primary, marginTop: 6 },
  tlText: { flex: 1 },
  tlWhat: { fontSize: 13.5, color: theme.colors.textPrimary },
  tlMeta: { fontSize: 12, color: theme.colors.textMuted, marginTop: 2 },
  label: { fontSize: 12.5, fontWeight: '600', color: theme.colors.textPrimary, marginBottom: 6 },
  action: { marginTop: 20, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  actionGhost: { backgroundColor: '#F1F5F9' },
  actionPrimary: { backgroundColor: theme.colors.primary },
  approveBtn: { backgroundColor: '#16A34A' },
  rowBtns: { flexDirection: 'row', gap: 10, marginTop: 12 },
  halfBtn: { flex: 1, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  changeBox: { marginTop: 18, padding: 12, borderRadius: 12, backgroundColor: '#FFFBEB', borderWidth: 1, borderColor: '#FDE68A' },
  changeTitle: { fontWeight: '800', color: theme.colors.textPrimary, marginBottom: 6 },
  changeLine: { fontSize: 13, color: theme.colors.textPrimary, marginTop: 3 },
  changeFrom: { color: theme.colors.textMuted, textDecorationLine: 'line-through' },
  changeTo: { fontWeight: '700' },
  editBox: { marginTop: 18, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: '#F8FAFC' },
  field: { minHeight: 44, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, paddingHorizontal: 12, justifyContent: 'center', backgroundColor: '#fff', color: theme.colors.textPrimary },
  fieldText: { color: theme.colors.textPrimary },
  area: { minHeight: 70, paddingTop: 10, textAlignVertical: 'top' },
  statusLink: { textAlign: 'center', color: theme.colors.primary, fontWeight: '700', marginTop: 18 },
  statusMenu: { marginTop: 8, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, overflow: 'hidden' },
  statusOpt: { paddingVertical: 12, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: '#F1F5F9', backgroundColor: '#fff' },
  statusOptText: { color: theme.colors.textPrimary, fontWeight: '600' },
  linkItem: { color: theme.colors.primary },
  actionGhostText: { fontWeight: '700', color: '#334155' },
  actionDanger: { borderWidth: 1, borderColor: '#FECACA', backgroundColor: '#FEF2F2' },
  actionDangerText: { fontWeight: '700', color: '#DC2626' },
  actionDangerSolid: { backgroundColor: '#DC2626' },
  solidText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  disabled: { opacity: 0.5 },
  keep: { textAlign: 'center', color: theme.colors.textSecondary, marginTop: 12, fontWeight: '600' },
  input: { minHeight: 70, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, padding: 10, textAlignVertical: 'top', color: theme.colors.textPrimary },
});
