import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  Platform,
  Linking,
} from 'react-native';
import {
  X,
  MapPin,
  Clock,
  CheckCircle2,
  AlertCircle,
  XCircle,
  CalendarClock,
  Plane,
  PartyPopper,
  Coffee,
  Sun,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Timer,
} from 'lucide-react-native';

interface DayDetailModalProps {
  visible: boolean;
  onClose: () => void;
  dayData: any | null;
}

function getStatusTheme(status: string) {
  switch (status) {
    case 'Present':
      return {
        label: 'Present',
        color: '#10B981',
        bg: '#ECFDF5',
        border: '#A7F3D0',
        Icon: CheckCircle2,
        desc: 'Shift completed with verified attendance.',
      };
    case 'Half Day':
      return {
        label: 'Half Day',
        color: '#EA580C',
        bg: '#FFF7ED',
        border: '#FDBA74',
        Icon: Clock,
        desc: 'Partial working shift recorded.',
      };
    case 'Late':
      return {
        label: 'Late In',
        color: '#D97706',
        bg: '#FEF3C7',
        border: '#FDE68A',
        Icon: AlertCircle,
        desc: 'Clocked in past regular shift start time.',
      };
    case 'Absent':
      return {
        label: 'Absent',
        color: '#EF4444',
        bg: '#FEF2F2',
        border: '#FECACA',
        Icon: XCircle,
        desc: 'No punch activity recorded for this working day.',
      };
    case 'On Leave':
      return {
        label: 'On Leave',
        color: '#2563EB',
        bg: '#EFF6FF',
        border: '#BFDBFE',
        Icon: Plane,
        desc: 'Approved time-off from duties.',
      };
    case 'Holiday':
      return {
        label: 'Holiday',
        color: '#059669',
        bg: '#ECFDF5',
        border: '#A7F3D0',
        Icon: PartyPopper,
        desc: 'Official company public holiday.',
      };
    case 'Day Off':
      return {
        label: 'Day Off',
        color: '#64748B',
        bg: '#F8FAFC',
        border: '#E2E8F0',
        Icon: Coffee,
        desc: 'Scheduled weekly weekend rest day.',
      };
    default:
      return {
        label: status || 'Scheduled',
        color: '#64748B',
        bg: '#F8FAFC',
        border: '#E2E8F0',
        Icon: Sun,
        desc: 'Scheduled calendar date.',
      };
  }
}

export default function DayDetailModal({
  visible,
  onClose,
  dayData,
}: DayDetailModalProps) {
  if (!dayData) return null;

  const { date, status, log } = dayData;
  const statusTheme = getStatusTheme(status);
  const StatusIcon = statusTheme.Icon;

  const weekdayStr = date.toLocaleDateString('en-US', { weekday: 'long' });
  const fullDateStr = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const formatTime = (isoString?: string) => {
    if (!isoString) return '--:--';
    return new Date(isoString).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  };

  const getSessionDuration = (clockIn?: string, clockOut?: string) => {
    if (!clockIn || !clockOut) return null;
    const diffMs = Math.max(0, new Date(clockOut).getTime() - new Date(clockIn).getTime());
    const totalMins = Math.floor(diffMs / 60000);
    const hrs = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    if (hrs > 0 && mins > 0) return `${hrs}h ${mins}m`;
    if (hrs > 0) return `${hrs}h`;
    return `${mins}m`;
  };

  const getTotalDurationFormatted = () => {
    const sessions = log?.logs?.length > 0 ? log.logs : (log ? [log] : []);
    if (!sessions || sessions.length === 0) {
      if (log?.totalHours) {
        const h = Math.floor(log.totalHours);
        const m = Math.round((log.totalHours % 1) * 60);
        return { text: `${h} hrs ${m} mins`, hours: log.totalHours };
      }
      return { text: '--', hours: 0 };
    }
    let totalMs = 0;
    sessions.forEach((s: any) => {
      if (s.clockIn && s.clockOut) {
        const start = new Date(s.clockIn).getTime();
        const end = new Date(s.clockOut).getTime();
        totalMs += (end - start);
      }
    });
    if (totalMs === 0 && log?.totalHours) {
      const h = Math.floor(log.totalHours);
      const m = Math.round((log.totalHours % 1) * 60);
      return { text: `${h} hrs ${m} mins`, hours: log.totalHours };
    }
    if (totalMs === 0) return { text: '--', hours: 0 };
    const totalMinutes = Math.floor(totalMs / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    const hrsDec = hours + (mins / 60);
    if (hours > 0 && mins > 0) return { text: `${hours} hrs ${mins} mins`, hours: hrsDec };
    if (hours > 0) return { text: `${hours} hrs`, hours: hrsDec };
    return { text: `${mins} mins`, hours: hrsDec };
  };

  const openMap = (lat: number, lng: number) => {
    const url = `https://www.google.com/maps?q=${lat},${lng}`;
    Linking.openURL(url).catch(() => {});
  };

  const sessions = log?.logs?.length > 0 ? log.logs : (log ? [log] : []);
  const hasPunches = !!(log && (log.clockIn || log.clockOut || sessions.length > 0));
  const totalDuration = getTotalDurationFormatted();
  const isOvertime = totalDuration.hours >= 8.5;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          {/* Top Indicator Handle */}
          <View style={styles.dragHandle} />

          {/* Modal Header */}
          <View style={styles.modalHeader}>
            <View style={styles.headerLeft}>
              <View style={styles.headerIconBadge}>
                <CalendarClock size={20} color="#E25E3E" strokeWidth={2.2} />
              </View>
              <View>
                <Text style={styles.modalTitle}>Attendance Details</Text>
                <Text style={styles.modalSubtitle}>Daily shift records & activity</Text>
              </View>
            </View>

            <TouchableOpacity
              onPress={onClose}
              style={styles.closeBtn}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Close modal"
            >
              <X size={18} color="#64748B" strokeWidth={2.4} />
            </TouchableOpacity>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollBody}
          >
            {/* 1. Bento Date & Status Header */}
            <View style={styles.heroDateCard}>
              <View style={styles.heroDateCol}>
                <Text style={styles.dateOverline}>DATE</Text>
                <Text style={styles.weekdayText}>{weekdayStr}</Text>
                <Text style={styles.fullDateText}>{fullDateStr}</Text>
              </View>

              <View
                style={[
                  styles.statusPill,
                  { backgroundColor: statusTheme.bg, borderColor: statusTheme.border },
                ]}
              >
                <View style={[styles.statusDot, { backgroundColor: statusTheme.color }]} />
                <StatusIcon size={13} color={statusTheme.color} strokeWidth={2.4} />
                <Text style={[styles.statusText, { color: statusTheme.color }]}>
                  {statusTheme.label}
                </Text>
              </View>
            </View>

            {/* 2. Main Content: Punches or Themed Empty State */}
            {hasPunches ? (
              <View style={styles.punchesContainer}>
                {/* Session Cards */}
                {sessions.map((session: any, idx: number) => {
                  const sessDuration = getSessionDuration(session.clockIn, session.clockOut);
                  const isOngoing = session.clockIn && !session.clockOut;

                  return (
                    <View key={session.id || idx} style={styles.sessionCard}>
                      {/* Session Header Strip */}
                      <View style={styles.sessionHeaderRow}>
                        <View style={styles.sessionTitleGroup}>
                          <Clock size={13} color="#475569" strokeWidth={2.2} />
                          <Text style={styles.sessionHeaderText}>
                            SESSION {idx + 1}
                          </Text>
                        </View>
                        {sessDuration ? (
                          <View style={styles.durationPill}>
                            <Text style={styles.durationPillText}>{sessDuration}</Text>
                          </View>
                        ) : isOngoing ? (
                          <View style={styles.activePill}>
                            <View style={styles.activePillDot} />
                            <Text style={styles.activePillText}>ACTIVE SHIFT</Text>
                          </View>
                        ) : null}
                      </View>

                      {/* Dual In/Out Tiles */}
                      <View style={styles.sessionTilesRow}>
                        {/* Clock In */}
                        <View style={styles.clockInTile}>
                          <View style={styles.tileHeaderRow}>
                            <View style={styles.inIconBadge}>
                              <ArrowDownRight size={12} color="#16A34A" strokeWidth={2.5} />
                            </View>
                            <Text style={styles.clockInLabel}>CLOCK IN</Text>
                          </View>
                          <Text style={styles.punchTimeText}>
                            {formatTime(session.clockIn)}
                          </Text>

                          {session.clockInLat && session.clockInLng ? (
                            <TouchableOpacity
                              style={styles.mapLinkBtn}
                              activeOpacity={0.7}
                              onPress={() => openMap(session.clockInLat, session.clockInLng)}
                            >
                              <MapPin size={11} color="#16A34A" />
                              <Text style={styles.mapLinkTextIn}>View Location</Text>
                            </TouchableOpacity>
                          ) : null}
                        </View>

                        {/* Clock Out */}
                        <View style={[styles.clockOutTile, isOngoing && styles.clockOutTileOngoing]}>
                          <View style={styles.tileHeaderRow}>
                            <View style={[styles.outIconBadge, isOngoing && styles.ongoingIconBadge]}>
                              {isOngoing ? (
                                <Clock size={12} color="#EA580C" strokeWidth={2.5} />
                              ) : (
                                <ArrowUpRight size={12} color="#64748B" strokeWidth={2.5} />
                              )}
                            </View>
                            <Text style={[styles.clockOutLabel, isOngoing && styles.ongoingLabel]}>
                              {isOngoing ? 'CURRENT' : 'CLOCK OUT'}
                            </Text>
                          </View>

                          <Text
                            style={[
                              styles.punchTimeText,
                              isOngoing && styles.ongoingTimeText,
                            ]}
                          >
                            {session.clockOut ? formatTime(session.clockOut) : 'In Progress...'}
                          </Text>

                          {session.clockOutLat && session.clockOutLng ? (
                            <TouchableOpacity
                              style={styles.mapLinkBtn}
                              activeOpacity={0.7}
                              onPress={() => openMap(session.clockOutLat, session.clockOutLng)}
                            >
                              <MapPin size={11} color="#2563EB" />
                              <Text style={styles.mapLinkTextOut}>View Location</Text>
                            </TouchableOpacity>
                          ) : null}
                        </View>
                      </View>
                    </View>
                  );
                })}

                {/* Total Duration Hub (Replacing Old Yellow Warning Box) */}
                <View style={styles.durationHub}>
                  <View style={styles.durationHubLeft}>
                    <View style={styles.durationIconBox}>
                      <Timer size={22} color="#E25E3E" strokeWidth={2.2} />
                    </View>
                    <View>
                      <Text style={styles.durationHubOverline}>TOTAL WORKED DURATION</Text>
                      <Text style={styles.durationHubValue}>{totalDuration.text}</Text>
                    </View>
                  </View>

                  {totalDuration.hours > 0 && (
                    <View style={[styles.targetBadge, isOvertime ? styles.targetBadgeGreen : styles.targetBadgeSlate]}>
                      <Text style={[styles.targetBadgeText, isOvertime ? styles.targetTextGreen : styles.targetTextSlate]}>
                        {isOvertime ? 'Target Met' : 'Standard'}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            ) : (
              /* Themed Rich Non-Punch State Cards */
              <View style={styles.stateCardContainer}>
                {status === 'On Leave' ? (
                  <View style={styles.leaveStateCard}>
                    <View style={styles.leaveIconCircle}>
                      <Plane size={26} color="#0284C7" strokeWidth={2.2} />
                    </View>
                    <Text style={styles.stateCardTitle}>
                      {dayData.leave?.leaveType?.name
                        ? `${dayData.leave.leaveType.name}`
                        : 'Approved Leave'}
                    </Text>
                    <Text style={styles.stateCardSubtitle}>
                      {dayData.leave?.reason
                        ? `"${dayData.leave.reason}"`
                        : 'Official time-off recorded. No attendance expected.'}
                    </Text>
                    <View style={styles.leaveMetaBadge}>
                      <CheckCircle2 size={12} color="#0284C7" strokeWidth={2.2} />
                      <Text style={styles.leaveMetaText}>Approved Leave Record</Text>
                    </View>
                  </View>
                ) : status === 'Holiday' ? (
                  <View style={styles.holidayStateCard}>
                    <View style={styles.holidayIconCircle}>
                      <PartyPopper size={26} color="#059669" strokeWidth={2.2} />
                    </View>
                    <Text style={styles.stateCardTitleGreen}>
                      {dayData.holiday?.name || 'Company Holiday'}
                    </Text>
                    <Text style={styles.stateCardSubtitleGreen}>
                      Official public holiday. Enjoy your paid time off!
                    </Text>
                    <View style={styles.holidayMetaBadge}>
                      <Text style={styles.holidayMetaText}>Paid Holiday Observance</Text>
                    </View>
                  </View>
                ) : status === 'Day Off' ? (
                  <View style={styles.weekendStateCard}>
                    <View style={styles.weekendIconCircle}>
                      <Coffee size={26} color="#64748B" strokeWidth={2.2} />
                    </View>
                    <Text style={styles.stateCardTitleSlate}>Weekly Day Off</Text>
                    <Text style={styles.stateCardSubtitleSlate}>
                      Scheduled weekend rest day. No punch required.
                    </Text>
                    <View style={styles.weekendMetaBadge}>
                      <Text style={styles.weekendMetaText}>Weekly Rest</Text>
                    </View>
                  </View>
                ) : (
                  <View style={styles.absentStateCard}>
                    <View style={styles.absentIconCircle}>
                      <AlertTriangle size={26} color="#DC2626" strokeWidth={2.2} />
                    </View>
                    <Text style={styles.stateCardTitleRed}>No Attendance Recorded</Text>
                    <Text style={styles.stateCardSubtitleRed}>
                      No clock-in was recorded for this scheduled working day.
                    </Text>
                    <View style={styles.absentMetaBadge}>
                      <AlertCircle size={12} color="#DC2626" strokeWidth={2.2} />
                      <Text style={styles.absentMetaText}>Marked as Absent</Text>
                    </View>
                  </View>
                )}
              </View>
            )}
          </ScrollView>

          {/* Modal Actions Footer */}
          <View style={styles.modalFooter}>
            <TouchableOpacity
              style={styles.doneBtn}
              activeOpacity={0.8}
              onPress={onClose}
            >
              <Text style={styles.doneBtnText}>Close</Text>
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
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    width: '100%',
    maxHeight: '88%',
    overflow: 'hidden',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.18,
    shadowRadius: 28,
    elevation: 12,
    borderWidth: Platform.OS === 'ios' ? 1 : 0,
    borderColor: '#F1F5F9',
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E2E8F0',
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 2,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
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
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: '#FFF1EC',
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
    fontSize: 11.5,
    fontWeight: '500',
    color: '#64748B',
    marginTop: 1,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },

  scrollBody: {
    paddingBottom: 12,
  },

  /* --- 1. Bento Date & Status Card --- */
  heroDateCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    padding: 14,
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 14,
  },
  heroDateCol: {
    flex: 1,
  },
  dateOverline: {
    fontSize: 10,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  weekdayText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.2,
  },
  fullDateText: {
    fontSize: 12.5,
    fontWeight: '500',
    color: '#64748B',
    marginTop: 1,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    gap: 5,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 12.5,
    fontWeight: '700',
  },

  /* --- 2. Punches & Sessions --- */
  punchesContainer: {
    paddingHorizontal: 16,
    gap: 12,
  },
  sessionCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F1F5F9',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 1,
  },
  sessionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  sessionTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sessionHeaderText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#475569',
    letterSpacing: 0.5,
  },
  durationPill: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 10,
  },
  durationPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  activePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF7ED',
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 10,
    gap: 4,
  },
  activePillDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#EA580C',
  },
  activePillText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#C2410C',
    letterSpacing: 0.4,
  },

  sessionTilesRow: {
    flexDirection: 'row',
    padding: 10,
    gap: 10,
  },
  clockInTile: {
    flex: 1,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#DCFCE7',
    borderRadius: 13,
    padding: 11,
  },
  clockOutTile: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#F1F5F9',
    borderRadius: 13,
    padding: 11,
  },
  clockOutTileOngoing: {
    backgroundColor: '#FFF7ED',
    borderColor: '#FED7AA',
  },
  tileHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  inIconBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  outIconBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ongoingIconBadge: {
    backgroundColor: '#FED7AA',
  },
  clockInLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#15803D',
    letterSpacing: 0.5,
  },
  clockOutLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.5,
  },
  ongoingLabel: {
    color: '#C2410C',
  },
  punchTimeText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    fontVariant: ['tabular-nums'],
  },
  ongoingTimeText: {
    fontSize: 14,
    color: '#EA580C',
  },
  mapLinkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3.5,
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0, 0, 0, 0.05)',
  },
  mapLinkTextIn: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#15803D',
  },
  mapLinkTextOut: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#2563EB',
  },

  /* --- Total Duration Hub --- */
  durationHub: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFF7ED',
    borderWidth: 1,
    borderColor: '#FFEDD5',
    borderRadius: 16,
    padding: 13,
    marginTop: 2,
  },
  durationHubLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  durationIconBox: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#FFEDD5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  durationHubOverline: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#9A3412',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  durationHubValue: {
    fontSize: 17,
    fontWeight: '900',
    color: '#431407',
    fontVariant: ['tabular-nums'],
  },
  targetBadge: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 10,
  },
  targetBadgeGreen: {
    backgroundColor: '#ECFDF5',
  },
  targetBadgeSlate: {
    backgroundColor: '#F1F5F9',
  },
  targetBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  targetTextGreen: {
    color: '#059669',
  },
  targetTextSlate: {
    color: '#64748B',
  },

  /* --- Themed Non-Punch State Cards --- */
  stateCardContainer: {
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  leaveStateCard: {
    backgroundColor: '#F0F9FF',
    borderWidth: 1,
    borderColor: '#BAE6FD',
    borderRadius: 20,
    padding: 22,
    alignItems: 'center',
  },
  leaveIconCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#E0F2FE',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  stateCardTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0369A1',
    letterSpacing: -0.2,
    textAlign: 'center',
  },
  stateCardSubtitle: {
    fontSize: 13,
    fontWeight: '500',
    color: '#0284C7',
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 4,
    marginBottom: 14,
  },
  leaveMetaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E0F2FE',
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 12,
    gap: 5,
  },
  leaveMetaText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#0369A1',
  },

  holidayStateCard: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: 20,
    padding: 22,
    alignItems: 'center',
  },
  holidayIconCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#D1FAE5',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  stateCardTitleGreen: {
    fontSize: 17,
    fontWeight: '800',
    color: '#065F46',
    letterSpacing: -0.2,
    textAlign: 'center',
  },
  stateCardSubtitleGreen: {
    fontSize: 13,
    fontWeight: '500',
    color: '#059669',
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 4,
    marginBottom: 14,
  },
  holidayMetaBadge: {
    backgroundColor: '#D1FAE5',
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 12,
  },
  holidayMetaText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#065F46',
  },

  weekendStateCard: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 20,
    padding: 22,
    alignItems: 'center',
  },
  weekendIconCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  stateCardTitleSlate: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.2,
    textAlign: 'center',
  },
  stateCardSubtitleSlate: {
    fontSize: 13,
    fontWeight: '500',
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 4,
    marginBottom: 14,
  },
  weekendMetaBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 12,
  },
  weekendMetaText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#475569',
  },

  absentStateCard: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 20,
    padding: 22,
    alignItems: 'center',
  },
  absentIconCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  stateCardTitleRed: {
    fontSize: 17,
    fontWeight: '800',
    color: '#991B1B',
    letterSpacing: -0.2,
    textAlign: 'center',
  },
  stateCardSubtitleRed: {
    fontSize: 13,
    fontWeight: '500',
    color: '#DC2626',
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 4,
    marginBottom: 14,
  },
  absentMetaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 12,
  },
  absentMetaText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#DC2626',
  },

  /* --- Modal Footer --- */
  modalFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    backgroundColor: '#FFFFFF',
  },
  doneBtn: {
    flex: 1,
    height: 46,
    borderRadius: 13,
    backgroundColor: '#0F172A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBtnText: {
    color: '#FFFFFF',
    fontSize: 14.5,
    fontWeight: '700',
  },
});

