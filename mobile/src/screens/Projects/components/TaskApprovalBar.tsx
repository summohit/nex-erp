import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Check, X, Clock, XCircle } from 'lucide-react-native';
import { projectService } from '../../../api/projectService';
import { colors, status } from '../../../theme/ds';

/**
 * A new task's approval (17 Oct 2026, as on the web): the "Awaiting … approval"
 * badge for everyone, and Approve / Reject for whoever may decide (admins at
 * either step, the project's Technical Architect at the technical step).
 * Reject asks why; the person who raised the task sees the reason.
 */
export default function TaskApprovalBar({
  issue, projectId, label, canDecide, onDone, compact = false,
}: {
  issue: any;
  projectId: number;
  label: string;
  canDecide: boolean;
  onDone: () => void;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState<'APPROVE' | 'REJECT' | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  if (!label) return null;
  const rejected = issue?.approvalState === 'REJECTED';
  const tone = rejected ? status.danger : status.warning;

  const decide = async (action: 'APPROVE' | 'REJECT', why?: string) => {
    setBusy(action);
    try {
      await projectService.decideIssueApproval(projectId, issue.id, action, why);
      setRejecting(false);
      setReason('');
      onDone();
    } catch (e: any) {
      Alert.alert('Could not save', e?.response?.data?.message || 'Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const approve = () =>
    Alert.alert('Approve this task?', issue?.title ?? '', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Approve', onPress: () => decide('APPROVE') },
    ]);

  return (
    <View style={[styles.wrap, compact && styles.wrapCompact]}>
      <View style={[styles.pill, { backgroundColor: tone.bg, borderColor: tone.border }]}>
        {rejected ? <XCircle size={11} color={tone.strong} /> : <Clock size={11} color={tone.strong} />}
        <Text style={[styles.pillText, { color: tone.strong }]} numberOfLines={1}>{label}</Text>
      </View>

      {canDecide && (
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.btn, styles.reject]}
            disabled={!!busy}
            onPress={() => { setReason(''); setRejecting(true); }}
            accessibilityLabel="Reject this task"
            hitSlop={6}
          >
            {busy === 'REJECT' ? <ActivityIndicator size="small" color={status.danger.strong} /> : <X size={14} color={status.danger.strong} strokeWidth={2.8} />}
            {!compact && <Text style={[styles.btnText, { color: status.danger.strong }]}>Reject</Text>}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, styles.approve]}
            disabled={!!busy}
            onPress={approve}
            accessibilityLabel="Approve this task"
            hitSlop={6}
          >
            {busy === 'APPROVE' ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Check size={14} color="#FFFFFF" strokeWidth={2.8} />}
            {!compact && <Text style={[styles.btnText, { color: '#FFFFFF' }]}>Approve</Text>}
          </TouchableOpacity>
        </View>
      )}

      <Modal visible={rejecting} transparent animationType="fade" onRequestClose={() => setRejecting(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Reject task</Text>
            <Text style={styles.sheetSub} numberOfLines={2}>{issue?.title}</Text>
            <TextInput
              style={styles.input}
              placeholder="Why is it being rejected?"
              placeholderTextColor={colors.textFaint}
              value={reason}
              onChangeText={setReason}
              multiline
              autoFocus
            />
            <View style={styles.sheetActions}>
              <TouchableOpacity style={[styles.sheetBtn, styles.sheetCancel]} onPress={() => setRejecting(false)}>
                <Text style={styles.sheetCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.sheetBtn, styles.sheetReject, !reason.trim() && { opacity: 0.5 }]}
                disabled={!reason.trim() || !!busy}
                onPress={() => decide('REJECT', reason.trim())}
              >
                {busy === 'REJECT' ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.sheetRejectText}>Reject</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginVertical: 6 },
  wrapCompact: { marginVertical: 4 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 999, borderWidth: 1, flexShrink: 1,
  },
  pillText: { fontSize: 11, fontWeight: '800' },
  actions: { flexDirection: 'row', gap: 6, marginLeft: 'auto' },
  btn: {
    minWidth: 30, height: 30, paddingHorizontal: 8, borderRadius: 10, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 4,
  },
  reject: { backgroundColor: status.danger.bg, borderWidth: 1, borderColor: status.danger.border },
  approve: { backgroundColor: status.success.fg },
  btnText: { fontSize: 12, fontWeight: '800' },
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'center', padding: 20 },
  sheet: { backgroundColor: '#FFFFFF', borderRadius: 22, padding: 18 },
  sheetTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  sheetSub: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  input: {
    marginTop: 12, minHeight: 84, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12,
    textAlignVertical: 'top', color: colors.text, backgroundColor: colors.bg, fontSize: 14,
  },
  sheetActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  sheetBtn: { flex: 1, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  sheetCancel: { backgroundColor: colors.borderSoft },
  sheetCancelText: { color: colors.textBody, fontWeight: '700' },
  sheetReject: { backgroundColor: status.danger.strong },
  sheetRejectText: { color: '#FFFFFF', fontWeight: '800' },
});
