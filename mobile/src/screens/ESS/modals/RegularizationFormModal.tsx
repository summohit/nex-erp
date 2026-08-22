import React, { useState } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, TextInput,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePickerModal from 'react-native-modal-datetime-picker';
import { X, Calendar as CalendarIcon, Clock } from 'lucide-react-native';
import { Calendar } from 'react-native-calendars';
import { useTimesheetStore } from '../../../store/timesheetStore';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

function formatTime(date: Date): string {
  const h = date.getHours().toString().padStart(2, '0');
  const m = date.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

export default function RegularizationFormModal({ visible, onClose, onSuccess }: Props) {
  const insets = useSafeAreaInsets();
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [inTime, setInTime] = useState('');
  const [outTime, setOutTime] = useState('');
  const [showCalendar, setShowCalendar] = useState(false);
  const [timePickerTarget, setTimePickerTarget] = useState<'in' | 'out' | null>(null);

  const { requestRegularization, isLoading, error } = useTimesheetStore();

  const handleSubmit = async () => {
    if (!date || !reason) {
      Alert.alert('Missing Fields', 'Please fill out date and reason.');
      return;
    }
    const isoDate = new Date(date).toISOString();
    const success = await requestRegularization({
      date: isoDate,
      proposedClockIn: inTime ? new Date(`${date}T${inTime}:00`).toISOString() : undefined,
      proposedClockOut: outTime ? new Date(`${date}T${outTime}:00`).toISOString() : undefined,
      reason,
    });
    if (success) {
      onSuccess();
      handleClose();
    }
  };

  const handleClose = () => {
    setDate('');
    setReason('');
    setInTime('');
    setOutTime('');
    setShowCalendar(false);
    setTimePickerTarget(null);
    onClose();
  };

  const handleTimeConfirm = (picked: Date) => {
    const formatted = formatTime(picked);
    if (timePickerTarget === 'in') setInTime(formatted);
    else setOutTime(formatted);
    setTimePickerTarget(null);
  };

  const pickerInitialDate = (() => {
    const val = timePickerTarget === 'in' ? inTime : outTime;
    if (val) {
      const [h, m] = val.split(':').map(Number);
      const d = new Date();
      d.setHours(h, m, 0, 0);
      return d;
    }
    return new Date();
  })();

  return (
    <>
      <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={[styles.modalContent, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Request Regularization</Text>
              <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
                <X size={24} color="#64748B" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {error ? <Text style={styles.errorText}>{error}</Text> : null}

              {/* Date */}
              <Text style={styles.label}>Date *</Text>
              <TouchableOpacity
                style={styles.inputBox}
                onPress={() => setShowCalendar(v => !v)}
                activeOpacity={0.7}
              >
                <Text style={date ? styles.inputText : styles.placeholderText}>
                  {date || 'Select Date'}
                </Text>
                <CalendarIcon size={18} color="#94A3B8" />
              </TouchableOpacity>

              {showCalendar && (
                <View style={styles.calendarWrapper}>
                  <Calendar
                    onDayPress={(day: any) => {
                      setDate(day.dateString);
                      setShowCalendar(false);
                    }}
                    markedDates={{ [date]: { selected: true, selectedColor: '#E25E3E' } }}
                    theme={{ todayTextColor: '#E25E3E', arrowColor: '#E25E3E' }}
                  />
                </View>
              )}

              {/* Time pickers */}
              <View style={styles.row}>
                <View style={styles.flexHalf}>
                  <Text style={styles.label}>Proposed In Time</Text>
                  <TouchableOpacity
                    style={styles.inputBox}
                    onPress={() => setTimePickerTarget('in')}
                    activeOpacity={0.7}
                  >
                    <Text style={inTime ? styles.inputText : styles.placeholderText}>
                      {inTime || 'Select time'}
                    </Text>
                    <Clock size={18} color="#94A3B8" />
                  </TouchableOpacity>
                </View>
                <View style={{ width: 12 }} />
                <View style={styles.flexHalf}>
                  <Text style={styles.label}>Proposed Out Time</Text>
                  <TouchableOpacity
                    style={styles.inputBox}
                    onPress={() => setTimePickerTarget('out')}
                    activeOpacity={0.7}
                  >
                    <Text style={outTime ? styles.inputText : styles.placeholderText}>
                      {outTime || 'Select time'}
                    </Text>
                    <Clock size={18} color="#94A3B8" />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Reason */}
              <Text style={styles.label}>Reason *</Text>
              <View style={[styles.inputBox, styles.textAreaBox]}>
                <TextInput
                  style={styles.textArea}
                  placeholder="Why do you need to regularize?"
                  placeholderTextColor="#94A3B8"
                  multiline
                  numberOfLines={3}
                  value={reason}
                  onChangeText={setReason}
                  textAlignVertical="top"
                />
              </View>
            </ScrollView>

            <View style={styles.footer}>
              <TouchableOpacity style={styles.cancelBtn} onPress={handleClose}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.submitBtn, isLoading && { opacity: 0.7 }]}
                onPress={handleSubmit}
                disabled={isLoading}
              >
                {isLoading
                  ? <ActivityIndicator color="#FFFFFF" />
                  : <Text style={styles.submitBtnText}>Submit Request</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Time picker — outside the sheet modal so it renders above it */}
      <DateTimePickerModal
        isVisible={timePickerTarget !== null}
        mode="time"
        date={pickerInitialDate}
        is24Hour
        onConfirm={handleTimeConfirm}
        onCancel={() => setTimePickerTarget(null)}
        accentColor="#E25E3E"
        buttonTextColorIOS="#E25E3E"
      />
    </>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    maxHeight: '92%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
  },
  closeBtn: {
    padding: 4,
    backgroundColor: '#F1F5F9',
    borderRadius: 20,
  },
  errorText: {
    color: '#EF4444',
    fontSize: 13,
    marginBottom: 12,
    backgroundColor: '#FEF2F2',
    padding: 10,
    borderRadius: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 6,
  },
  inputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 48,
    marginBottom: 16,
  },
  inputText: {
    flex: 1,
    fontSize: 15,
    color: '#0F172A',
  },
  placeholderText: {
    flex: 1,
    fontSize: 15,
    color: '#94A3B8',
  },
  calendarWrapper: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 16,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
  },
  flexHalf: {
    flex: 1,
  },
  textAreaBox: {
    height: 100,
    alignItems: 'flex-start',
    paddingVertical: 12,
  },
  textArea: {
    flex: 1,
    fontSize: 15,
    color: '#0F172A',
  },
  footer: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 10,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  cancelBtn: {
    flex: 1,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
  },
  cancelBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#64748B',
  },
  submitBtn: {
    flex: 2,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E25E3E',
    borderRadius: 12,
  },
  submitBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
