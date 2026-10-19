import React, { useEffect, useState } from 'react';
import { Alert, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { X, Home } from 'lucide-react-native';
import { wfhService, WfhRequest } from '../../../api/wfhService';
import { colors } from '../../../theme/ds';

/**
 * Request Work From Home (19 Oct 2026): one day, a reason, and my requests.
 * WFH used to be a leave type; it is its own request now, approved by the
 * reporting manager then HR, within a monthly allowance set by HR.
 */
const LABEL: Record<string, string> = {
  PENDING_MANAGER: 'With manager', PENDING_HR: 'With HR', APPROVED: 'Approved', REJECTED: 'Rejected', CANCELLED: 'Cancelled',
};
const todayKey = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const addDays = (key: string, n: number) => {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const pretty = (key: string) =>
  new Date(`${key.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

export default function WfhRequestSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [limit, setLimit] = useState(1);
  const [used, setUsed] = useState(0);
  const [requests, setRequests] = useState<WfhRequest[]>([]);
  const [date, setDate] = useState(todayKey());
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => wfhService.mine().then((r) => { setLimit(r.limit); setUsed(r.usedThisMonth); setRequests(r.requests); }).catch(() => {});
  useEffect(() => { if (visible) { setDate(todayKey()); setReason(''); load(); } }, [visible]);

  // The next two weeks as tappable days: no date picker needed for one day.
  const days = Array.from({ length: 14 }, (_, i) => addDays(todayKey(), i));

  const submit = async () => {
    if (!reason.trim()) { Alert.alert('Reason needed', 'Write why you need to work from home.'); return; }
    setBusy(true);
    try {
      await wfhService.create(date, reason.trim());
      setReason('');
      await load();
      Alert.alert('Sent', 'Your WFH request went to your reporting manager.');
    } catch (e: any) {
      Alert.alert('Could not send', e?.response?.data?.message || 'Please try again.');
    } finally { setBusy(false); }
  };

  const cancel = (r: WfhRequest) =>
    Alert.alert('Cancel this request?', pretty(r.date), [
      { text: 'Keep', style: 'cancel' },
      { text: 'Cancel it', style: 'destructive', onPress: async () => { try { await wfhService.cancel(r.id); load(); } catch (e: any) { Alert.alert('Could not cancel', e?.response?.data?.message || ''); } } },
    ]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.head}>
            <View style={styles.headIcon}><Home size={16} color="#047857" /></View>
            <Text style={styles.title}>Work From Home</Text>
            <TouchableOpacity onPress={onClose} style={styles.close}><X size={16} color="#64748B" /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
            <Text style={styles.allow}>
              {limit === 0 ? 'WFH requests are switched off.' : `You can work from home ${limit} day${limit === 1 ? '' : 's'} a month. `}
              <Text style={{ fontWeight: '800' }}>{used} of {limit}</Text> used this month.
            </Text>

            <Text style={styles.label}>Day</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {days.map((d) => (
                <TouchableOpacity key={d} style={[styles.day, d === date && styles.dayOn]} onPress={() => setDate(d)}>
                  <Text style={[styles.dayText, d === date && styles.dayTextOn]}>{pretty(d)}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.label}>Reason</Text>
            <TextInput style={styles.input} multiline value={reason} onChangeText={setReason} placeholder="Why you need to work from home" placeholderTextColor="#94A3B8" />
            <Text style={styles.note}>Your reporting manager approves first, then HR.</Text>
            <TouchableOpacity style={[styles.primary, (busy || !reason.trim()) && { opacity: 0.5 }]} disabled={busy || !reason.trim()} onPress={submit}>
              <Text style={styles.primaryText}>{busy ? 'Sending…' : 'Send request'}</Text>
            </TouchableOpacity>

            <Text style={styles.label}>My WFH requests</Text>
            {!requests.length && <Text style={styles.empty}>None yet.</Text>}
            {requests.map((r) => (
              <View key={r.id} style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{pretty(r.date)}</Text>
                  <Text style={styles.rowSub} numberOfLines={2}>{r.reason}</Text>
                  {r.status === 'REJECTED' && !!r.reviewNote && <Text style={[styles.rowSub, { color: '#B91C1C' }]}>“{r.reviewNote}”</Text>}
                </View>
                <View style={{ alignItems: 'flex-end', gap: 6 }}>
                  <Text style={[styles.chip, r.status === 'APPROVED' ? styles.chipOk : r.status === 'REJECTED' ? styles.chipNo : r.status.startsWith('PENDING') ? styles.chipWait : null]}>{LABEL[r.status] ?? r.status}</Text>
                  {(r.status.startsWith('PENDING') || (r.status === 'APPROVED' && r.date.slice(0, 10) >= todayKey())) && (
                    <TouchableOpacity onPress={() => cancel(r)}><Text style={styles.cancel}>Cancel</Text></TouchableOpacity>
                  )}
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '88%', backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  headIcon: { width: 30, height: 30, borderRadius: 10, backgroundColor: '#ECFDF5', alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontSize: 17, fontWeight: '800', color: colors.text },
  close: { width: 32, height: 32, borderRadius: 10, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' },
  allow: { fontSize: 13, color: colors.textBody, backgroundColor: '#F8FAFC', borderRadius: 12, padding: 12 },
  label: { marginTop: 16, marginBottom: 8, fontSize: 12, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  day: { paddingHorizontal: 12, height: 38, borderRadius: 10, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' },
  dayOn: { borderColor: '#047857', backgroundColor: '#ECFDF5' },
  dayText: { fontSize: 13, fontWeight: '700', color: colors.textBody },
  dayTextOn: { color: '#047857' },
  input: { minHeight: 80, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, fontSize: 14, color: colors.text, textAlignVertical: 'top' },
  note: { marginTop: 6, fontSize: 12, color: colors.textFaint },
  primary: { marginTop: 14, height: 48, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  empty: { fontSize: 13, color: colors.textFaint },
  row: { flexDirection: 'row', gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  rowTitle: { fontSize: 14, fontWeight: '800', color: colors.text },
  rowSub: { fontSize: 12.5, color: colors.textMuted, marginTop: 2 },
  chip: { fontSize: 11.5, fontWeight: '800', paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, overflow: 'hidden', backgroundColor: '#F1F5F9', color: '#475569' },
  chipOk: { backgroundColor: '#ECFDF5', color: '#047857' },
  chipNo: { backgroundColor: '#FEF2F2', color: '#B91C1C' },
  chipWait: { backgroundColor: '#FFFBEB', color: '#B45309' },
  cancel: { fontSize: 12.5, fontWeight: '700', color: '#B91C1C' },
});
