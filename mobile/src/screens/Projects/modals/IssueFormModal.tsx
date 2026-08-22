import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, AlertCircle, ArrowDown, Minus, ArrowUp, Flame } from 'lucide-react-native';

import { useProjectStore } from '../../../store/projectStore';

interface IssueFormModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (data: any) => Promise<void>;
  initialColumnId?: number;
}

export default function IssueFormModal({ visible, onClose, onSubmit, initialColumnId }: IssueFormModalProps) {
  const insets = useSafeAreaInsets();
  const currentBoard = useProjectStore(state => state.currentBoard);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when modal opens
  useEffect(() => {
    if (visible) {
      setTitle('');
      setDescription('');
      setPriority('MEDIUM');
      setError(null);
      setIsSubmitting(false);
    }
  }, [visible]);

  const handleSubmit = async () => {
    if (!title.trim()) {
      setError('Title is required');
      return;
    }
    
    setIsSubmitting(true);
    setError(null);
    
    try {
      await onSubmit({
        title: title.trim(),
        description: description.trim(),
        priority,
        columnId: initialColumnId
      });
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to create task');
    } finally {
      setIsSubmitting(false);
    }
  };

  const PRIORITIES = [
    { id: 'LOW', label: 'Low', color: '#64748B', bg: '#F8FAFC', borderColor: '#CBD5E1', icon: ArrowDown },
    { id: 'MEDIUM', label: 'Medium', color: '#2563EB', bg: '#EFF6FF', borderColor: '#93C5FD', icon: Minus },
    { id: 'HIGH', label: 'High', color: '#D97706', bg: '#FFFBEB', borderColor: '#FCD34D', icon: ArrowUp },
    { id: 'CRITICAL', label: 'Critical', color: '#DC2626', bg: '#FEF2F2', borderColor: '#FCA5A5', icon: Flame }
  ];

  const targetColumn = currentBoard?.columns?.find((c: any) => c.id === initialColumnId);
  const columnName = targetColumn ? targetColumn.name : 'Backlog';

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={styles.modalOverlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.modalContent, { maxHeight: '92%' }]}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Create New Task</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <X size={22} color="#64748B" />
            </TouchableOpacity>
          </View>

          {/* Error Message */}
          {error && (
            <View style={styles.errorBannerWrapper}>
              <View style={styles.errorBanner}>
                <AlertCircle size={16} color="#EF4444" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            </View>
          )}

          {/* Scrollable Form */}
          <ScrollView
            style={styles.formScroll}
            contentContainerStyle={styles.formScrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.label}>Title <Text style={styles.required}>*</Text></Text>
            <TextInput
              style={styles.input}
              placeholder="What needs to be done?"
              placeholderTextColor="#94A3B8"
              value={title}
              onChangeText={(text) => {
                setTitle(text);
                if (error) setError(null);
              }}
              autoFocus
            />

            <Text style={styles.label}>Description</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Add details..."
              placeholderTextColor="#94A3B8"
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />

            <Text style={styles.label}>Priority</Text>
            <View style={styles.priorityContainer}>
              {PRIORITIES.map((p) => {
                const isSelected = priority === p.id;
                const IconComp = p.icon;
                return (
                  <TouchableOpacity
                    key={p.id}
                    style={[
                      styles.priorityBtn,
                      isSelected && { backgroundColor: p.bg, borderColor: p.borderColor, borderWidth: 1.5 }
                    ]}
                    onPress={() => setPriority(p.id)}
                    activeOpacity={0.7}
                  >
                    <IconComp size={14} color={isSelected ? p.color : '#94A3B8'} strokeWidth={2.5} />
                    <Text style={[
                      styles.priorityText,
                      isSelected && { color: p.color, fontWeight: '700' }
                    ]}>
                      {p.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.statusDisplay}>
              <Text style={styles.statusLabel}>Will be added to:</Text>
              <View style={styles.statusBadge}>
                <Text style={styles.statusBadgeText}>{columnName}</Text>
              </View>
            </View>
          </ScrollView>

          {/* Footer Actions */}
          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={onClose}
              disabled={isSubmitting}
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.submitBtn,
                (!title.trim() || isSubmitting) && styles.submitBtnDisabled
              ]}
              onPress={handleSubmit}
              disabled={!title.trim() || isSubmitting}
            >
              {isSubmitting ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.submitBtnText}>Create Task</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 16,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0F172A',
  },
  closeBtn: {
    padding: 4,
    backgroundColor: '#F1F5F9',
    borderRadius: 20,
  },
  errorBannerWrapper: {
    paddingHorizontal: 24,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#FCA5A5',
  },
  errorText: {
    color: '#EF4444',
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 8,
    flex: 1,
  },
  formScroll: {
    flexGrow: 0,
  },
  formScrollContent: {
    paddingHorizontal: 24,
    paddingBottom: 8,
    gap: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#475569',
    marginBottom: 6,
  },
  required: {
    color: '#EF4444',
  },
  input: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: '#0F172A',
  },
  textArea: {
    minHeight: 100,
  },
  priorityContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  priorityBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
  },
  priorityText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  statusDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    padding: 12,
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  statusLabel: {
    fontSize: 14,
    color: '#64748B',
    marginRight: 8,
  },
  statusBadge: {
    backgroundColor: '#E2E8F0',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  footer: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 24,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#475569',
  },
  submitBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#E25E3E',
    alignItems: 'center',
  },
  submitBtnDisabled: {
    backgroundColor: '#FCA5A5',
    opacity: 0.7,
  },
  submitBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
