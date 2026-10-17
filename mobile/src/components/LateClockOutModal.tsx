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
import { Clock, MapPin, X } from 'lucide-react-native';

interface Props {
  visible: boolean;
  day?: string;
  submitting?: boolean;
  onCancel: () => void;
  onSubmit: (reason: string) => void;
  title?: string;
  message?: string;
  placeholder?: string;
}

const QUICK_REASONS_LATE = [
  'Forgot to clock out after shift',
  'Left client site late',
  'Network issue while clocking out',
];

const QUICK_REASONS_OUTSIDE = [
  'At client site for meeting',
  'Working from approved remote location',
  'On field duty',
];

export default function LateClockOutModal({
  visible,
  day,
  submitting,
  onCancel,
  onSubmit,
  title,
  message,
  placeholder,
}: Props) {
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (visible) setReason('');
  }, [visible]);

  const canSubmit = reason.trim().length > 0 && !submitting;
  const isOutside = (title || '').toLowerCase().includes('outside');
  const HeaderIcon = isOutside ? MapPin : Clock;
  const quickReasons = isOutside ? QUICK_REASONS_OUTSIDE : QUICK_REASONS_LATE;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <View style={styles.iconBadge}>
              <HeaderIcon size={20} color="#1373e5" strokeWidth={2.3} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{title || 'Reason for Late Clock-Out'}</Text>
              <Text style={styles.subtitle}>
                {isOutside ? 'Location verification note' : day ? `Session date · ${formatDay(day)}` : 'Previous shift verification'}
              </Text>
            </View>
            <TouchableOpacity style={styles.closeBtn} onPress={onCancel} disabled={submitting}>
              <X size={16} color="#64748B" />
            </TouchableOpacity>
          </View>

          <Text style={styles.body}>
            {message
              ? message
              : day
                ? `You are closing your open shift from ${formatDay(day)}. Please provide a brief reason for your attendance record.`
                : 'You are closing a previous day’s open shift. Please provide a brief reason for your attendance record.'}
          </Text>

          {/* Quick Reason Chips */}
          <View style={styles.chipsWrap}>
            {quickReasons.map((q) => (
              <TouchableOpacity
                key={q}
                style={[styles.quickChip, reason === q && styles.quickChipActive]}
                activeOpacity={0.75}
                onPress={() => setReason(q)}
              >
                <Text style={[styles.quickChipText, reason === q && styles.quickChipTextActive]}>
                  {q}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TextInput
            style={styles.input}
            placeholder={placeholder || 'e.g. Left the site in a hurry and forgot to clock out'}
            placeholderTextColor="#94A3B8"
            value={reason}
            onChangeText={setReason}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
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
                {submitting ? 'Submitting…' : isOutside ? 'Submit & Continue' : 'Clock Out'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function formatDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 20,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  iconBadge: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 16.5,
    fontWeight: '800',
    color: '#0F172A',
  },
  subtitle: {
    fontSize: 12,
    fontWeight: '500',
    color: '#64748B',
    marginTop: 1,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    fontSize: 13,
    lineHeight: 19,
    color: '#475569',
    marginBottom: 12,
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 12,
  },
  quickChip: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  quickChipActive: {
    backgroundColor: '#EFF6FF',
    borderColor: '#93C5FD',
  },
  quickChipText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#475569',
  },
  quickChipTextActive: {
    color: '#1D4ED8',
    fontWeight: '700',
  },
  input: {
    minHeight: 84,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: '#0F172A',
    backgroundColor: '#F8FAFC',
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  btn: {
    flex: 1,
    height: 46,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnGhost: {
    backgroundColor: '#F1F5F9',
  },
  btnGhostText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#475569',
  },
  btnPrimary: {
    flex: 1.4,
    backgroundColor: '#1373e5',
  },
  btnPrimaryText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  btnDisabled: {
    opacity: 0.5,
  },
});
