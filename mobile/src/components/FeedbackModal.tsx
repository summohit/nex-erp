import React from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { X, CheckCircle, AlertCircle, AlertTriangle } from 'lucide-react-native';

export type ModalType = 'success' | 'error' | 'warning';

export interface FeedbackModalProps {
  visible: boolean;
  title: string;
  message: string;
  type: ModalType;
  onClose: () => void;
  onConfirm?: () => void;
  confirmText?: string;
  showCancel?: boolean;
}

export default function FeedbackModal({
  visible,
  title,
  message,
  type = 'error',
  onClose,
  onConfirm,
  confirmText = 'OK',
  showCancel = false,
}: FeedbackModalProps) {
  
  const getColors = () => {
    switch (type) {
      case 'success': return { bg: '#10B981', shadow: '#10B981' };
      case 'warning': return { bg: '#F59E0B', shadow: '#F59E0B' };
      case 'error':
      default: return { bg: '#EF4444', shadow: '#EF4444' };
    }
  };

  const colors = getColors();

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <TouchableOpacity
            style={styles.modalCloseBtn}
            onPress={onClose}
            activeOpacity={0.7}
          >
            <X size={20} color="#94A3B8" />
          </TouchableOpacity>

          <View style={[styles.modalIconContainer, { backgroundColor: colors.bg, shadowColor: colors.shadow }]}>
            {type === 'success' ? (
              <CheckCircle size={32} color="#FFFFFF" />
            ) : type === 'warning' ? (
              <AlertTriangle size={32} color="#FFFFFF" />
            ) : (
              <AlertCircle size={32} color="#FFFFFF" />
            )}
          </View>

          <Text style={styles.modalTitle}>{title}</Text>
          <Text style={styles.modalMessage}>{message}</Text>

          <View style={styles.modalActionsRow}>
            {showCancel && (
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={onClose}
                activeOpacity={0.85}
              >
                <Text style={styles.modalCancelButtonText}>Cancel</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.modalButton, { backgroundColor: colors.bg }]}
              onPress={() => {
                if (onConfirm) {
                  onConfirm();
                } else {
                  onClose();
                }
              }}
              activeOpacity={0.85}
            >
              <Text style={styles.modalButtonText}>{confirmText}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    width: '100%',
    padding: 24,
    alignItems: 'center',
    position: 'relative',
    elevation: 10,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
  },
  modalCloseBtn: {
    position: 'absolute',
    top: 16,
    right: 16,
    padding: 8,
  },
  modalIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    elevation: 8,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 8,
    textAlign: 'center',
  },
  modalMessage: {
    fontSize: 15,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  modalActionsRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  modalButton: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  modalCancelButton: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCancelButtonText: {
    color: '#475569',
    fontSize: 16,
    fontWeight: '600',
  },
});
