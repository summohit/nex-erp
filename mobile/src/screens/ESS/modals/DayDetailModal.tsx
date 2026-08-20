import React from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView } from 'react-native';
import { X, MapPin, Clock, ArrowRight, CheckCircle, AlertCircle, XCircle, Calendar, Plane, Star } from 'lucide-react-native';

interface DayDetailModalProps {
  visible: boolean;
  onClose: () => void;
  dayData: any | null;
}

export default function DayDetailModal({ visible, onClose, dayData }: DayDetailModalProps) {
  if (!dayData) return null;

  const { date, status, log, isHoliday, isWeekend } = dayData;
  const dateStr = date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const getStatusColor = () => {
    switch (status) {
      case 'Present': return '#10B981';
      case 'Half Day': return '#F97316';
      case 'Late': return '#EAB308';
      case 'Absent': return '#EF4444';
      case 'On Leave': return '#3B82F6';
      case 'Holiday': return '#F59E0B';
      default: return '#94A3B8';
    }
  };

  const getStatusBgColor = () => {
    switch (status) {
      case 'Present': return '#ECFDF5';
      case 'Half Day': return '#FFF7ED';
      case 'Late': return '#FEF9C3';
      case 'Absent': return '#FEF2F2';
      case 'On Leave': return '#EFF6FF';
      case 'Holiday': return '#FEF3C7';
      default: return '#F1F5F9';
    }
  };

  const formatTime = (isoString?: string) => {
    if (!isoString) return '--:--';
    return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getTotalDurationFormatted = () => {
    const sessions = log?.logs?.length > 0 ? log.logs : (log ? [log] : []);
    if (!sessions || sessions.length === 0) return '--';
    let totalMs = 0;
    sessions.forEach((s: any) => {
      if (s.clockIn && s.clockOut) {
        const start = new Date(s.clockIn).getTime();
        const end = new Date(s.clockOut).getTime();
        totalMs += (end - start);
      }
    });
    if (totalMs === 0) return '--';
    const totalMinutes = Math.floor(totalMs / (1000 * 60));
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    if (hours > 0 && mins > 0) return `${hours} hrs ${mins} mins`;
    if (hours > 0) return `${hours} hrs`;
    return `${mins} mins`;
  };

  const openMap = (lat: number, lng: number) => {
    const url = `https://www.google.com/maps?q=${lat},${lng}`;
    import('react-native').then(rn => {
      rn.Linking.openURL(url).catch(() => console.log('Failed to open map'));
    });
  };

  const sessions = log?.logs?.length > 0 ? log.logs : (log ? [log] : []);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Attendance Details</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <X size={20} color="#64748B" />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
            {/* Date & Status Bar */}
            <View style={styles.dateStatusBar}>
              <View>
                <Text style={styles.dateLabelText}>DATE</Text>
                <Text style={styles.dateValueText}>{dateStr}</Text>
              </View>
              <View style={[styles.statusPill, { backgroundColor: getStatusBgColor(), borderColor: getStatusColor() }]}>
                <View style={[styles.statusDot, { backgroundColor: getStatusColor() }]} />
                <Text style={[styles.statusText, { color: getStatusColor() }]}>{status}</Text>
              </View>
            </View>

            {/* Punches Timeline */}
            {log && (log.clockIn || log.clockOut) ? (
              <View style={styles.punchesContainer}>
                {sessions.map((session: any, idx: number) => (
                  <View key={session.id || idx} style={styles.sessionCard}>
                    <View style={styles.sessionHeader}>
                      <Text style={styles.sessionHeaderText}>SESSION {idx + 1}</Text>
                    </View>
                    <View style={styles.sessionBody}>
                      {/* Clock In */}
                      <View style={styles.punchColumn}>
                        <View style={styles.punchLabelRow}>
                          <Clock size={12} color="#1E40AF" />
                          <Text style={[styles.punchLabel, { color: '#1E40AF' }]}>CLOCK IN</Text>
                        </View>
                        <Text style={styles.punchTime}>{formatTime(session.clockIn)}</Text>
                        {session.clockInLat && session.clockInLng && (
                          <View style={styles.locationBox}>
                            <Text style={styles.locationText}>Lat: {session.clockInLat.toFixed(4)}</Text>
                            <Text style={styles.locationText}>Lng: {session.clockInLng.toFixed(4)}</Text>
                            <TouchableOpacity style={styles.mapBtn} onPress={() => openMap(session.clockInLat, session.clockInLng)}>
                              <Text style={styles.mapBtnText}>View on Map</Text>
                              <ArrowRight size={10} color="#2563EB" />
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>

                      {/* Divider */}
                      <View style={styles.verticalDivider} />

                      {/* Clock Out */}
                      <View style={styles.punchColumn}>
                        <View style={styles.punchLabelRow}>
                          <Clock size={12} color="#166534" />
                          <Text style={[styles.punchLabel, { color: '#166534' }]}>CLOCK OUT</Text>
                        </View>
                        <Text style={styles.punchTime}>
                          {session.clockOut ? formatTime(session.clockOut) : 'Ongoing...'}
                        </Text>
                        {session.clockOutLat && session.clockOutLng && (
                          <View style={styles.locationBox}>
                            <Text style={styles.locationText}>Lat: {session.clockOutLat.toFixed(4)}</Text>
                            <Text style={styles.locationText}>Lng: {session.clockOutLng.toFixed(4)}</Text>
                            <TouchableOpacity style={styles.mapBtn} onPress={() => openMap(session.clockOutLat, session.clockOutLng)}>
                              <Text style={styles.mapBtnText}>View on Map</Text>
                              <ArrowRight size={10} color="#2563EB" />
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    </View>
                  </View>
                ))}

                {/* Summary Box */}
                <View style={styles.summaryBox}>
                  <Text style={styles.summaryLabel}>⏱️ Total Duration Worked:</Text>
                  <Text style={styles.summaryValue}>{getTotalDurationFormatted()}</Text>
                </View>
              </View>
            ) : (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>
                  {status === 'Holiday' ? 'Holiday - No attendance expected.' : 
                   status === 'On Leave' ? 'On Leave - No attendance expected.' : 
                   status === 'Day Off' ? 'Weekend / Day Off.' : 
                   status === 'Future' ? 'Future Date.' :
                   'No punch records found for this date.'}
                </Text>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    maxHeight: '90%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 10,
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
  },
  closeBtn: {
    padding: 6,
    backgroundColor: '#F1F5F9',
    borderRadius: 20,
  },
  dateStatusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    padding: 12,
    margin: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  dateLabelText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  dateValueText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    gap: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 13,
    fontWeight: '700',
  },
  punchesContainer: {
    paddingHorizontal: 16,
    gap: 16,
  },
  sessionCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    overflow: 'hidden',
  },
  sessionHeader: {
    backgroundColor: '#F1F5F9',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  sessionHeaderText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    letterSpacing: 0.5,
  },
  sessionBody: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
  },
  punchColumn: {
    flex: 1,
    padding: 12,
  },
  verticalDivider: {
    width: 1,
    backgroundColor: '#E2E8F0',
  },
  punchLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  punchLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  punchTime: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1E293B',
  },
  locationBox: {
    marginTop: 10,
    backgroundColor: '#F8FAFC',
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 2,
  },
  locationText: {
    fontSize: 10,
    color: '#64748B',
    fontWeight: '500',
  },
  mapBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  mapBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#2563EB',
  },
  summaryBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    padding: 14,
    borderRadius: 12,
    marginTop: 4,
  },
  summaryLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#92400E',
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '800',
    color: '#78350F',
  },
  emptyContainer: {
    padding: 32,
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    marginHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  emptyText: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
    fontWeight: '500',
  }
});
