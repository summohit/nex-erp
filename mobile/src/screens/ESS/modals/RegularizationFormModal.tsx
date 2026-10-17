import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePickerModal from 'react-native-modal-datetime-picker';
import {
  X,
  Calendar as CalendarIcon,
  Clock,
  CalendarClock,
  ArrowDownRight,
  ArrowUpRight,
  Sparkles,
  AlertCircle,
  Send,
} from 'lucide-react-native';
import { Calendar } from 'react-native-calendars';
import { useTimesheetStore } from '../../../store/timesheetStore';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialDate?: string | null;
}

function formatTime(date: Date): string {
  const h = date.getHours().toString().padStart(2, '0');
  const m = date.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

/** `HH:mm` in IST for a stored timestamp, or '' when there is none. */
function istHm(iso?: string | null): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const d = new Date(t + 330 * 60 * 1000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** The calendar day (IST) a stored attendance date falls on. */
function istYmd(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 330 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function formatShortChipDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function RegularizationFormModal({
  visible,
  onClose,
  onSuccess,
  initialDate,
}: Props) {
  const insets = useSafeAreaInsets();
  const [dates, setDates] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  // Blank means "keep what was recorded": an approved request replaces the
  // day's clock-in/out with whatever is sent, so nothing is filled in blindly.
  const [inTime, setInTime] = useState('');
  const [outTime, setOutTime] = useState('');
  const [showCalendar, setShowCalendar] = useState(false);
  const [timePickerTarget, setTimePickerTarget] = useState<'in' | 'out' | null>(null);

  const { requestRegularization, isLoading, error, attendanceHistory } = useTimesheetStore();

  useEffect(() => {
    if (visible) {
      if (initialDate) {
        setDates([initialDate]);
        // Start from that day's actual punches, so only the missing or wrong
        // time needs changing.
        const log: any = attendanceHistory.find((r: any) => r?.date && istYmd(r.date) === initialDate);
        setInTime(istHm(log?.clockIn));
        setOutTime(istHm(log?.clockOut));
      } else {
        setInTime('');
        setOutTime('');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- prefill on open only; a refresh must not wipe what they typed
  }, [visible, initialDate]);

  const handleSubmit = async () => {
    if (!dates.length || !reason.trim()) {
      Alert.alert('Missing Details', 'Please select at least one date and enter a reason.');
      return;
    }
    if (!inTime && !outTime) {
      Alert.alert('Missing Time', 'Set the clock-in or clock-out time to correct. Leave the other blank to keep what was recorded.');
      return;
    }
    const at = (d: string, t: string) => (t ? `${d}T${t}:00+05:30` : undefined);
    const sorted = [...dates].sort();
    const success = await requestRegularization({
      reason: reason.trim(),
      entries: sorted.map((d) => ({
        date: d,
        proposedClockIn: at(d, inTime),
        proposedClockOut: at(d, outTime),
      })),
    });
    if (success) {
      onSuccess();
      handleClose();
    }
  };

  const handleClose = () => {
    setDates([]);
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

  const sortedDates = [...dates].sort();

  return (
    <>
      <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={handleClose} />
          <View style={[styles.modalContent, { paddingBottom: Math.max(insets.bottom, 18) }]}>
            <View style={styles.dragHandle} />

            {/* Header */}
            <View style={styles.modalHeader}>
              <View style={styles.headerLeft}>
                <View style={styles.headerIconBadge}>
                  <CalendarClock size={20} color="#1373e5" strokeWidth={2.3} />
                </View>
                <View>
                  <Text style={styles.modalTitle}>Request Regularization</Text>
                  <Text style={styles.modalSubtitle}>Correct missed punches or shift timings</Text>
                </View>
              </View>
              <TouchableOpacity onPress={handleClose} style={styles.closeBtn} activeOpacity={0.7}>
                <X size={18} color="#64748B" strokeWidth={2.4} />
              </TouchableOpacity>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.scrollContent}
            >
              {error ? (
                <View style={styles.errorBanner}>
                  <AlertCircle size={15} color="#DC2626" />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              {/* Step 1: Dates */}
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.label}>1. Select Date(s) *</Text>
                <Text style={styles.hint}>Multi-date supported</Text>
              </View>

              <TouchableOpacity
                style={[styles.dateSelectorBtn, showCalendar && styles.dateSelectorBtnActive]}
                onPress={() => setShowCalendar((v) => !v)}
                activeOpacity={0.75}
              >
                <View style={styles.dateSelectorLeft}>
                  <View style={styles.dateIconCircle}>
                    <CalendarIcon size={16} color="#1373e5" strokeWidth={2.2} />
                  </View>
                  <Text style={dates.length ? styles.inputText : styles.placeholderText}>
                    {dates.length
                      ? `${dates.length} ${dates.length === 1 ? 'date' : 'dates'} selected`
                      : 'Tap to choose date(s) from calendar'}
                  </Text>
                </View>
                <Text style={styles.calendarToggleText}>{showCalendar ? 'Hide' : 'Pick'}</Text>
              </TouchableOpacity>

              {/* Selected Date Chips */}
              {sortedDates.length > 0 && (
                <View style={styles.dateChipsWrap}>
                  {sortedDates.map((d) => (
                    <TouchableOpacity
                      key={d}
                      style={styles.dateChip}
                      activeOpacity={0.75}
                      onPress={() => setDates((prev) => prev.filter((x) => x !== d))}
                    >
                      <Text style={styles.dateChipText}>{formatShortChipDate(d)}</Text>
                      <X size={12} color="#1D4ED8" strokeWidth={2.5} />
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {showCalendar && (
                <View style={styles.calendarWrapper}>
                  <Calendar
                    maxDate={new Date().toISOString().slice(0, 10)}
                    onDayPress={(day: any) => {
                      setDates((prev) =>
                        prev.includes(day.dateString)
                          ? prev.filter((d) => d !== day.dateString)
                          : prev.length >= 31
                            ? prev
                            : [...prev, day.dateString],
                      );
                    }}
                    markedDates={Object.fromEntries(
                      dates.map((d) => [d, { selected: true, selectedColor: '#1373e5' }]),
                    )}
                    theme={{
                      todayTextColor: '#1373e5',
                      arrowColor: '#1373e5',
                      textDayFontWeight: '600',
                      textMonthFontWeight: '800',
                    }}
                  />
                  <View style={styles.calendarFooter}>
                    <TouchableOpacity
                      style={styles.doneBtn}
                      onPress={() => setShowCalendar(false)}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.doneText}>
                        Done{dates.length ? ` (${dates.length})` : ''}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {/* Step 2: Proposed Shift Timings */}
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.label}>2. Proposed Shift Timings</Text>
                <View style={styles.presetRow}>
                  <TouchableOpacity
                    style={styles.presetChip}
                    onPress={() => {
                      setInTime('09:30');
                      setOutTime('18:30');
                    }}
                  >
                    <Sparkles size={11} color="#1373e5" />
                    <Text style={styles.presetChipText}>9:30 – 18:30</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.presetChip}
                    onPress={() => {
                      setInTime('10:00');
                      setOutTime('19:00');
                    }}
                  >
                    <Text style={styles.presetChipText}>10:00 – 19:00</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.timeCardsRow}>
                {/* In Time Card */}
                <TouchableOpacity
                  style={styles.inTimeCard}
                  onPress={() => setTimePickerTarget('in')}
                  activeOpacity={0.8}
                >
                  <View style={styles.timeCardHeader}>
                    <View style={styles.inBadge}>
                      <ArrowDownRight size={12} color="#16A34A" strokeWidth={2.5} />
                    </View>
                    <Text style={styles.inCardLabel}>CLOCK IN</Text>
                  </View>
                  <View style={styles.timeValueRow}>
                    <Text style={styles.timeCardValue}>{inTime || '--:--'}</Text>
                    <Clock size={15} color="#16A34A" />
                  </View>
                </TouchableOpacity>

                {/* Out Time Card */}
                <TouchableOpacity
                  style={styles.outTimeCard}
                  onPress={() => setTimePickerTarget('out')}
                  activeOpacity={0.8}
                >
                  <View style={styles.timeCardHeader}>
                    <View style={styles.outBadge}>
                      <ArrowUpRight size={12} color="#1D4ED8" strokeWidth={2.5} />
                    </View>
                    <Text style={styles.outCardLabel}>CLOCK OUT</Text>
                  </View>
                  <View style={styles.timeValueRow}>
                    <Text style={styles.timeCardValue}>{outTime || '--:--'}</Text>
                    <Clock size={15} color="#1D4ED8" />
                  </View>
                </TouchableOpacity>
              </View>

              {/* Step 3: Reason */}
              <Text style={[styles.label, { marginTop: 4, marginBottom: 8 }]}>
                3. Reason for Regularization *
              </Text>
              <View style={styles.textAreaBox}>
                <TextInput
                  style={styles.textArea}
                  placeholder="e.g. Was at client site / forgot to punch in on arrival..."
                  placeholderTextColor="#94A3B8"
                  multiline
                  numberOfLines={3}
                  value={reason}
                  onChangeText={setReason}
                  textAlignVertical="top"
                />
              </View>
            </ScrollView>

            {/* Footer */}
            <View style={styles.footer}>
              <TouchableOpacity style={styles.cancelBtn} onPress={handleClose} activeOpacity={0.8}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.submitBtn, isLoading && { opacity: 0.7 }]}
                onPress={handleSubmit}
                disabled={isLoading}
                activeOpacity={0.85}
              >
                {isLoading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <>
                    <Send size={15} color="#FFFFFF" strokeWidth={2.3} />
                    <Text style={styles.submitBtnText}>
                      {dates.length > 1 ? `Submit (${dates.length} Days)` : 'Submit Request'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <DateTimePickerModal
        isVisible={timePickerTarget !== null}
        mode="time"
        date={pickerInitialDate}
        is24Hour
        onConfirm={handleTimeConfirm}
        onCancel={() => setTimePickerTarget(null)}
        accentColor="#1373e5"
        buttonTextColorIOS="#1373e5"
      />
    </>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '92%',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.16,
    shadowRadius: 24,
    elevation: 12,
  },
  dragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#CBD5E1',
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 4,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerIconBadge: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.2,
  },
  modalSubtitle: {
    fontSize: 12,
    fontWeight: '500',
    color: '#64748B',
    marginTop: 1,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    padding: 12,
    borderRadius: 12,
    marginBottom: 14,
  },
  errorText: {
    flex: 1,
    color: '#DC2626',
    fontSize: 12.5,
    fontWeight: '600',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: '800',
    color: '#1E293B',
  },
  hint: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#94A3B8',
  },
  dateSelectorBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    paddingHorizontal: 12,
    height: 50,
    marginBottom: 10,
  },
  dateSelectorBtnActive: {
    borderColor: '#1373e5',
    backgroundColor: '#EFF6FF',
  },
  dateSelectorLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  dateIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  placeholderText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#94A3B8',
  },
  calendarToggleText: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#1373e5',
    paddingHorizontal: 8,
  },
  dateChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  dateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  dateChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1E40AF',
  },
  calendarWrapper: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 16,
    overflow: 'hidden',
  },
  calendarFooter: {
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    alignItems: 'flex-end',
  },
  doneBtn: {
    paddingVertical: 7,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: '#1373e5',
  },
  doneText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 12.5,
  },
  presetRow: {
    flexDirection: 'row',
    gap: 6,
  },
  presetChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  presetChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  timeCardsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  inTimeCard: {
    flex: 1,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: 14,
    padding: 12,
  },
  outTimeCard: {
    flex: 1,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 14,
    padding: 12,
  },
  timeCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  inBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  outBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#DBEAFE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inCardLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#15803D',
    letterSpacing: 0.5,
  },
  outCardLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#1D4ED8',
    letterSpacing: 0.5,
  },
  timeValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  timeCardValue: {
    fontSize: 17,
    fontWeight: '900',
    color: '#0F172A',
    fontVariant: ['tabular-nums'],
  },
  textAreaBox: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 96,
  },
  textArea: {
    fontSize: 14,
    color: '#0F172A',
    lineHeight: 20,
    minHeight: 72,
  },
  footer: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  cancelBtn: {
    flex: 1,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F5F9',
    borderRadius: 14,
  },
  cancelBtnText: {
    fontSize: 14.5,
    fontWeight: '800',
    color: '#475569',
  },
  submitBtn: {
    flex: 2,
    height: 48,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1373e5',
    borderRadius: 14,
    shadowColor: '#1373e5',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  submitBtnText: {
    fontSize: 14.5,
    fontWeight: '800',
    color: '#FFFFFF',
  },
});
