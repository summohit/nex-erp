import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, TextInput, Linking, RefreshControl,
} from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import AppScreen from '../../components/AppScreen';
import { fieldVisitRequestService as fv, FieldVisitDetail, FvActivity, FvAttendance } from '../../api/fieldVisitRequestService';
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
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [v, t] = await Promise.all([fv.get(id), fv.timeline(id).catch(() => [])]);
      setVisit(v);
      setTimeline(t);
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

  const submitCancel = () =>
    act('cancel', async () => {
      await fv.cancel(id, cancelReason.trim());
      setCancelling(false);
      setCancelReason('');
    });

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

        {visit.canSubmit && (
          <TouchableOpacity style={[styles.action, styles.actionPrimary]} disabled={busy} onPress={sendForApproval}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.solidText}>Send for approval</Text>}
          </TouchableOpacity>
        )}
        {visit.canEdit && (
          <TouchableOpacity style={[styles.action, styles.actionGhost]} disabled={busy}
            onPress={() => navigation.navigate('FieldVisitRequestForm', { mode: 'edit', id })}>
            <Text style={styles.actionGhostText}>{visit.status === 'DRAFT' ? 'Edit draft' : 'Edit request'}</Text>
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
        {visit.canCancel && !cancelling && (
          <TouchableOpacity style={[styles.action, styles.actionDanger]} disabled={busy} onPress={() => setCancelling(true)}>
            <Text style={styles.actionDangerText}>Cancel this visit</Text>
          </TouchableOpacity>
        )}
        {cancelling && (
          <View style={styles.cancelBox}>
            <Text style={styles.label}>Why is it cancelled? Everyone on it is told.</Text>
            <TextInput style={styles.input} value={cancelReason} onChangeText={setCancelReason} placeholder="e.g. Client postponed" multiline />
            <TouchableOpacity
              style={[styles.action, styles.actionDangerSolid, (!cancelReason.trim() || busy) && styles.disabled]}
              disabled={!cancelReason.trim() || busy}
              onPress={submitCancel}
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.solidText}>Cancel visit</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setCancelling(false); setCancelReason(''); }}>
              <Text style={styles.keep}>Keep the visit</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </AppScreen>
  );
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
  linkItem: { color: theme.colors.primary },
  actionGhostText: { fontWeight: '700', color: '#334155' },
  actionDanger: { borderWidth: 1, borderColor: '#FECACA', backgroundColor: '#FEF2F2' },
  actionDangerText: { fontWeight: '700', color: '#DC2626' },
  actionDangerSolid: { backgroundColor: '#DC2626' },
  solidText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  disabled: { opacity: 0.5 },
  cancelBox: { marginTop: 16 },
  keep: { textAlign: 'center', color: theme.colors.textSecondary, marginTop: 12, fontWeight: '600' },
  input: { minHeight: 70, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, padding: 10, textAlignVertical: 'top', color: theme.colors.textPrimary },
});
