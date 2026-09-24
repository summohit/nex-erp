import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';

interface Props {
  visible: boolean;
  /** The day being closed, as YYYY-MM-DD. Shown so the user knows which. */
  day?: string;
  submitting?: boolean;
  onCancel: () => void;
  onSubmit: (reason: string) => void;
}

/**
 * Asks why a previous day's session is being closed now.
 *
 * The server refuses a previous-day clock-out without a reason, so this is not
 * a nicety — it is the only way to complete the action. It is deliberately not
 * dismissible by tapping outside: losing a typed explanation to a stray tap
 * means typing it again.
 */
export default function LateClockOutModal({ visible, day, submitting, onCancel, onSubmit }: Props) {
  const [reason, setReason] = useState('');

  // Clear between openings, so yesterday's explanation is not pre-filled for
  // a different day.
  useEffect(() => {
    if (visible) setReason('');
  }, [visible]);

  const canSubmit = reason.trim().length > 0 && !submitting;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.card}>
          <Text style={styles.title}>Reason for late clock-out</Text>
          <Text style={styles.body}>
            {day
              ? `You are clocking out for ${formatDay(day)}, a previous day. Please say why — it is saved against that day's record.`
              : 'You are clocking out for a previous day. Please say why — it is saved against that day’s record.'}
          </Text>

          <TextInput
            style={styles.input}
            placeholder="e.g. Left the site in a hurry and forgot to clock out"
            placeholderTextColor="#94a3b8"
            value={reason}
            onChangeText={setReason}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            autoFocus
            editable={!submitting}
          />

          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.btn, styles.btnGhost]}
              onPress={onCancel}
              disabled={submitting}
            >
              <Text style={styles.btnGhostText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary, !canSubmit && styles.btnDisabled]}
              onPress={() => onSubmit(reason.trim())}
              disabled={!canSubmit}
            >
              <Text style={styles.btnPrimaryText}>
                {submitting ? 'Clocking out…' : 'Clock out'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** "2026-09-14" → "14 Sep 2026". */
function formatDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 22,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 8,
  },
  body: {
    fontSize: 13.5,
    lineHeight: 20,
    color: '#475569',
    marginBottom: 16,
  },
  input: {
    minHeight: 84,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: '#0f172a',
    backgroundColor: '#f8fafc',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 18,
  },
  btn: {
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 10,
  },
  btnGhost: {
    backgroundColor: '#f1f5f9',
  },
  btnGhostText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#475569',
  },
  btnPrimary: {
    backgroundColor: '#1373e5',
  },
  btnPrimaryText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#ffffff',
  },
  btnDisabled: {
    opacity: 0.5,
  },
});
