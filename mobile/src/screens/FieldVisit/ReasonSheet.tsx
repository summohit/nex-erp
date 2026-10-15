import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { theme } from '../../theme/theme';

/**
 * Ask for a reason before an action (reject, cancel, send back…). Alert.prompt
 * exists only on iOS, so this is the one sheet both platforms use.
 */
export default function ReasonSheet({
  visible, title, message, placeholder, confirmLabel, danger = false, required = true, busy = false, onSubmit, onClose,
}: {
  visible: boolean;
  title: string;
  message?: string;
  placeholder?: string;
  confirmLabel: string;
  danger?: boolean;
  required?: boolean;
  busy?: boolean;
  onSubmit: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  useEffect(() => { if (visible) setReason(''); }, [visible]);
  const blocked = busy || (required && !reason.trim());

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{title}</Text>
          {!!message && <Text style={styles.message}>{message}</Text>}
          <TextInput
            style={styles.input}
            value={reason}
            onChangeText={setReason}
            placeholder={placeholder || (required ? 'Reason (required)' : 'Reason (optional)')}
            multiline
            autoFocus
          />
          <TouchableOpacity
            style={[styles.confirm, danger && styles.danger, blocked && styles.disabled]}
            disabled={blocked}
            onPress={() => onSubmit(reason.trim())}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.confirmText}>{confirmLabel}</Text>}
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} disabled={busy}>
            <Text style={styles.cancel}>Back</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18, paddingBottom: 30 },
  title: { fontSize: 17, fontWeight: '800', color: theme.colors.textPrimary },
  message: { fontSize: 13, color: theme.colors.textSecondary, marginTop: 6, lineHeight: 18 },
  input: {
    minHeight: 80, marginTop: 12, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10,
    padding: 10, textAlignVertical: 'top', color: theme.colors.textPrimary,
  },
  confirm: { marginTop: 14, height: 46, borderRadius: 12, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' },
  danger: { backgroundColor: '#DC2626' },
  disabled: { opacity: 0.5 },
  confirmText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  cancel: { textAlign: 'center', color: theme.colors.textSecondary, marginTop: 12, fontWeight: '600' },
});
