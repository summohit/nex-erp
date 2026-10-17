import React from 'react';
import GradientBg from '../../../components/GradientBg';
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
  FileEdit,
} from 'lucide-react-native';

interface DayDetailModalProps {
  visible: boolean;
  onClose: () => void;
  dayData: any | null;
  onRegularize?: (isoDate: string) => void;
}

function getStatusTheme(status: string) {
  switch (status) {
    case 'Present':
      return {
        label: 'Present',
        color: '#10B981',
        bg: '#ECFDF5',
        border: '#A7F3D0',
        gradStart: '#064E3B',
        gradEnd: '#059669',
        Icon: CheckCircle2,
        desc: 'Shift completed with verified attendance.',
      };
    case 'Half Day':
      return {
        label: 'Half Day',
        color: '#D97706',
        bg: '#FFFBEB',
        border: '#FDE68A',
        gradStart: '#78350F',
        gradEnd: '#D97706',
        Icon: Clock,
        desc: 'Partial working shift recorded.',
      };
    case 'Late':
      return {
        label: 'Late Arrival',
        color: '#7C3AED',
        bg: '#F3E8FF',
        border: '#DDD6FE',
        gradStart: '#4C1D95',
        gradEnd: '#7C3AED',
        Icon: AlertCircle,
        desc: 'Clocked in past regular shift start time.',
      };
    case 'Absent':
      return {
        label: 'Absent',
        color: '#EF4444',
        bg: '#FEF2F2',
        border: '#FECACA',
        gradStart: '#7F1D1D',
        gradEnd: '#DC2626',
        Icon: XCircle,
        desc: 'No punch activity recorded for this working day.',
      };
    case 'On Leave':
      return {
        label: 'On Leave',
        color: '#0284C7',
        bg: '#F0F9FF',
        border: '#BAE6FD',
        gradStart: '#0C4A6E',
        gradEnd: '#0284C7',
        Icon: Plane,
        desc: 'Approved time-off from duties.',
      };
    case 'Holiday':
      return {
        label: 'Holiday',
        color: '#0D9488',
        bg: '#F0FDFA',
        border: '#99F6E4',
        gradStart: '#134E4A',
        gradEnd: '#0D9488',
        Icon: PartyPopper,
        desc: 'Official company public holiday.',
      };
    case 'Day Off':
      return {
        label: 'Day Off',
        color: '#64748B',
        bg: '#F8FAFC',
        border: '#E2E8F0',
        gradStart: '#1E293B',
        gradEnd: '#475569',
        Icon: Coffee,
        desc: 'Scheduled weekly rest day.',
      };
    default:
      return {
        label: status || 'Scheduled',
        color: '#64748B',
        bg: '#F8FAFC',
        border: '#E2E8F0',
        gradStart: '#0F172A',
        gradEnd: '#1E3A8A',
        Icon: Sun,
        desc: 'Scheduled calendar date.',
      };
  }
}

export default function DayDetailModal({
  visible,
  onClose,
  dayData,
  onRegularize,
}: DayDetailModalProps) {
  if (!dayData) return null;

  const { date, status, log, isoDate, isFuture } = dayData;
  const statusTheme = getStatusTheme(status);
  const StatusIcon = statusTheme.Icon;

  const weekdayStr = date.toLocaleDateString('en-US', { weekday: 'long' });
  const fullDateStr = date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

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
    const sessions = log?.logs?.length > 0 ? log.logs : log ? [log] : [];
    if (!sessions || sessions.length === 0) {
      if (log?.totalHours) {
        const h = Math.floor(log.totalHours);
        const m = Math.round((log.totalHours % 1) * 60);
        return { text: `${h}h ${m}m`, hours: log.totalHours };
      }
      return { text: '0h 0m', hours: 0 };
    }
    let totalMs = 0;
    sessions.forEach((s: any) => {
      if (s.clockIn && s.clockOut) {
        const start = new Date(s.clockIn).getTime();
        const end = new Date(s.clockOut).getTime();
        totalMs += end - start;
      }
    });
    if (totalMs === 0 && log?.totalHours) {
      const h = Math.floor(log.totalHours);
      const m = Math.round((log.totalHours % 1) * 60);
      return { text: `${h}h ${m}m`, hours: log.totalHours };
    }
    if (totalMs === 0) return { text: '0h 0m', hours: 0 };
    const totalMinutes = Math.floor(totalMs / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    const hrsDec = hours + mins / 60;
    return { text: `${hours}h ${mins}m`, hours: hrsDec };
  };

  const openMap = (lat: number, lng: number) => {
    const url = `https://www.google.com/maps?q=${lat},${lng}`;
    Linking.openURL(url).catch(() => {});
  };

  const sessions = log?.logs?.length > 0 ? log.logs : log ? [log] : [];
  const hasPunches = !!(log && (log.clockIn || log.clockOut || sessions.length > 0));
  const totalDuration = getTotalDurationFormatted();
  const targetRatio = Math.min(1, totalDuration.hours / 8.5);
  const canRegularize =
    !isFuture &&
    onRegularize &&
    (status === 'Absent' || status === 'Late' || status === 'Half Day' || status === 'Present');

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <View style={styles.modalCard}>
          {/* Top Drag Handle */}
          <View style={styles.dragHandle} />

          {/* Modal Header */}
          <View style={styles.modalHeader}>
            <View style={styles.headerLeft}>
              <View style={styles.headerIconBadge}>
                <CalendarClock size={20} color="#1373e5" strokeWidth={2.3} />
              </View>
              <View>
                <Text style={styles.modalTitle}>Daily Attendance</Text>
                <Text style={styles.modalSubtitle}>Shift log & punch verification</Text>
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

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollBody}>
            {/* 1. Gradient Hero Date & Status Banner */}
            <View style={styles.heroDateBanner}>
              <GradientBg />

              <View style={styles.heroDateContent}>
                <View style={styles.heroDateCol}>
                  <Text style={styles.dateOverline}>{weekdayStr.toUpperCase()}</Text>
                  <Text style={styles.fullDateText}>{fullDateStr}</Text>
                  <Text style={styles.heroStatusDesc}>{statusTheme.desc}</Text>
                </View>

                <View style={styles.statusGlassPill}>
                  <StatusIcon size={14} color="#FFFFFF" strokeWidth={2.4} />
                  <Text style={styles.statusGlassText}>{statusTheme.label}</Text>
                </View>
              </View>
            </View>

            {/* 2. Main Content: Punches or Themed Non-Punch State */}
            {hasPunches ? (
              <View style={styles.punchesContainer}>
                {/* Total Worked Progress Hub */}
                <View style={styles.durationHub}>
                  <View style={styles.durationHubTop}>
                    <View style={styles.durationHubLeft}>
                      <View style={styles.durationIconBox}>
                        <Timer size={20} color="#1373e5" strokeWidth={2.3} />
                      </View>
                      <View>
                        <Text style={styles.durationHubOverline}>TOTAL WORKED HOURS</Text>
                        <Text style={styles.durationHubValue}>{totalDuration.text}</Text>
                      </View>
                    </View>
                    <View style={styles.targetChip}>
                      <Text style={styles.targetChipText}>
                        {Math.round(targetRatio * 100)}% of 8h 30m
                      </Text>
                    </View>
                  </View>
                  <View style={styles.durationTrack}>
                    <View
                      style={[
                        styles.durationFill,
                        {
                          width: `${Math.max(6, Math.round(targetRatio * 100))}%`,
                          backgroundColor: targetRatio >= 0.9 ? '#10B981' : '#1373e5',
                        },
                      ]}
                    />
                  </View>
                </View>

                {/* Session Cards */}
                {sessions.map((session: any, idx: number) => {
                  const sessDuration = getSessionDuration(session.clockIn, session.clockOut);
                  const isOngoing = session.clockIn && !session.clockOut;

                  return (
                    <View key={session.id || idx} style={styles.sessionCard}>
                      <View style={styles.sessionHeaderRow}>
                        <View style={styles.sessionTitleGroup}>
                          <Clock size={13} color="#475569" strokeWidth={2.2} />
                          <Text style={styles.sessionHeaderText}>SHIFT PUNCH #{idx + 1}</Text>
                        </View>
                        {sessDuration ? (
                          <View style={styles.durationPill}>
                            <Text style={styles.durationPillText}>{sessDuration}</Text>
                          </View>
                        ) : isOngoing ? (
                          <View style={styles.activePill}>
                            <View style={styles.activePillDot} />
                            <Text style={styles.activePillText}>ACTIVE NOW</Text>
                          </View>
                        ) : null}
                      </View>

                      <View style={styles.sessionTilesRow}>
                        {/* Clock In */}
                        <View style={styles.clockInTile}>
                          <View style={styles.tileHeaderRow}>
                            <View style={styles.inIconBadge}>
                              <ArrowDownRight size={12} color="#16A34A" strokeWidth={2.5} />
                            </View>
                            <Text style={styles.clockInLabel}>CLOCK IN</Text>
                          </View>
                          <Text style={styles.punchTimeText}>{formatTime(session.clockIn)}</Text>

                          {session.clockInLat && session.clockInLng ? (
                            <TouchableOpacity
                              style={styles.mapLinkBtn}
                              activeOpacity={0.7}
                              onPress={() => openMap(session.clockInLat, session.clockInLng)}
                            >
                              <MapPin size={11} color="#16A34A" />
                              <Text style={styles.mapLinkTextIn}>Verify GPS Pin</Text>
                            </TouchableOpacity>
                          ) : null}
                        </View>

                        {/* Clock Out */}
                        <View style={[styles.clockOutTile, isOngoing && styles.clockOutTileOngoing]}>
                          <View style={styles.tileHeaderRow}>
                            <View style={[styles.outIconBadge, isOngoing && styles.ongoingIconBadge]}>
                              {isOngoing ? (
                                <Clock size={12} color="#1373e5" strokeWidth={2.5} />
                              ) : (
                                <ArrowUpRight size={12} color="#64748B" strokeWidth={2.5} />
                              )}
                            </View>
                            <Text style={[styles.clockOutLabel, isOngoing && styles.ongoingLabel]}>
                              {isOngoing ? 'STATUS' : 'CLOCK OUT'}
                            </Text>
                          </View>

                          <Text style={[styles.punchTimeText, isOngoing && styles.ongoingTimeText]}>
                            {session.clockOut ? formatTime(session.clockOut) : 'On Shift…'}
                          </Text>

                          {session.clockOutLat && session.clockOutLng ? (
                            <TouchableOpacity
                              style={styles.mapLinkBtn}
                              activeOpacity={0.7}
                              onPress={() => openMap(session.clockOutLat, session.clockOutLng)}
                            >
                              <MapPin size={11} color="#2563EB" />
                              <Text style={styles.mapLinkTextOut}>Verify GPS Pin</Text>
                            </TouchableOpacity>
                          ) : null}
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>
            ) : (
              /* Rich Non-Punch State Cards */
              <View style={styles.stateCardContainer}>
                {status === 'On Leave' ? (
                  <View style={styles.leaveStateCard}>
                    <View style={styles.leaveIconCircle}>
                      <Plane size={26} color="#0284C7" strokeWidth={2.2} />
                    </View>
                    <Text style={styles.stateCardTitle}>
                      {dayData.leave?.leaveType?.name || 'Approved Leave'}
                    </Text>
                    <Text style={styles.stateCardSubtitle}>
                      {dayData.leave?.reason
                        ? `"${dayData.leave.reason}"`
                        : 'Official time-off recorded. No attendance punch required.'}
                    </Text>
                    <View style={styles.leaveMetaBadge}>
                      <CheckCircle2 size={12} color="#0284C7" strokeWidth={2.2} />
                      <Text style={styles.leaveMetaText}>Approved Leave Record</Text>
                    </View>
                  </View>
                ) : status === 'Holiday' ? (
                  <View style={styles.holidayStateCard}>
                    <View style={styles.holidayIconCircle}>
                      <PartyPopper size={26} color="#0D9488" strokeWidth={2.2} />
                    </View>
                    <Text style={styles.stateCardTitleGreen}>
                      {dayData.holiday?.name || 'Company Holiday'}
                    </Text>
                    <Text style={styles.stateCardSubtitleGreen}>
                      Official public holiday. Enjoy your time off!
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
                    <Text style={styles.stateCardTitleSlate}>Weekly Rest Day</Text>
                    <Text style={styles.stateCardSubtitleSlate}>
                      Scheduled weekly off. No attendance punch expected.
                    </Text>
                    <View style={styles.weekendMetaBadge}>
                      <Text style={styles.weekendMetaText}>Weekly Off</Text>
                    </View>
                  </View>
                ) : (
                  <View style={styles.absentStateCard}>
                    <View style={styles.absentIconCircle}>
                      <AlertTriangle size={26} color="#EF4444" strokeWidth={2.2} />
                    </View>
                    <Text style={styles.stateCardTitleRed}>No Punch Recorded</Text>
                    <Text style={styles.stateCardSubtitleRed}>
                      No clock-in was recorded for this working day. If you worked or were on duty, submit a regularization request below.
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
            {canRegularize && isoDate ? (
              <TouchableOpacity
                style={styles.regularizeActionBtn}
                activeOpacity={0.85}
                onPress={() => {
                  onClose();
                  setTimeout(() => onRegularize(isoDate), 200);
                }}
              >
                <FileEdit size={16} color="#FFFFFF" strokeWidth={2.2} />
                <Text style={styles.regularizeActionText}>Regularize This Day</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={[styles.doneBtn, canRegularize && styles.doneBtnSecondary]}
              activeOpacity={0.8}
              onPress={onClose}
            >
              <Text style={[styles.doneBtnText, canRegularize && styles.doneBtnTextSecondary]}>
                Close
              </Text>
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
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    width: '100%',
    maxHeight: '88%',
    overflow: 'hidden',
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
    alignItems: 'center',
    justifyContent: 'space-between',
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
  scrollBody: {
    paddingBottom: 16,
  },

  /* --- 1. Gradient Hero Date Banner --- */
  heroDateBanner: {
    marginHorizontal: 18,
    marginTop: 16,
    marginBottom: 14,
    borderRadius: 20,
    overflow: 'hidden',
    position: 'relative',
  },
  heroDateContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 18,
    gap: 12,
  },
  heroDateCol: {
    flex: 1,
  },
  dateOverline: {
    fontSize: 10.5,
    fontWeight: '800',
    color: 'rgba(255, 255, 255, 0.75)',
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  fullDateText: {
    fontSize: 18,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  heroStatusDesc: {
    fontSize: 12,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.82)',
    marginTop: 4,
  },
  statusGlassPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.32)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    gap: 6,
  },
  statusGlassText: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#FFFFFF',
  },

  /* --- 2. Punches & Sessions --- */
  punchesContainer: {
    paddingHorizontal: 18,
    gap: 12,
  },
  durationHub: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 18,
    padding: 14,
  },
  durationHubTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  durationHubLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  durationIconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  durationHubOverline: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  durationHubValue: {
    fontSize: 18,
    fontWeight: '900',
    color: '#0F172A',
    fontVariant: ['tabular-nums'],
  },
  targetChip: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
  },
  targetChipText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#1D4ED8',
  },
  durationTrack: {
    height: 6,
    backgroundColor: '#E2E8F0',
    borderRadius: 3,
    overflow: 'hidden',
  },
  durationFill: {
    height: '100%',
    borderRadius: 3,
  },

  sessionCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 18,
    overflow: 'hidden',
  },
  sessionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 14,
    paddingVertical: 9,
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
    backgroundColor: '#E2E8F0',
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 8,
  },
  durationPillText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#1E293B',
  },
  activePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    gap: 5,
  },
  activePillDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#16A34A',
  },
  activePillText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#15803D',
  },

  sessionTilesRow: {
    flexDirection: 'row',
    padding: 12,
    gap: 10,
  },
  clockInTile: {
    flex: 1,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: 14,
    padding: 12,
  },
  clockOutTile: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    padding: 12,
  },
  clockOutTileOngoing: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
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
    backgroundColor: '#DBEAFE',
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
    color: '#1D4ED8',
  },
  punchTimeText: {
    fontSize: 16.5,
    fontWeight: '900',
    color: '#0F172A',
    fontVariant: ['tabular-nums'],
  },
  ongoingTimeText: {
    fontSize: 14.5,
    color: '#1373e5',
  },
  mapLinkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0, 0, 0, 0.06)',
  },
  mapLinkTextIn: {
    fontSize: 11,
    fontWeight: '700',
    color: '#15803D',
  },
  mapLinkTextOut: {
    fontSize: 11,
    fontWeight: '700',
    color: '#2563EB',
  },

  /* --- Themed Non-Punch State Cards --- */
  stateCardContainer: {
    paddingHorizontal: 18,
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
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#99F6E4',
    borderRadius: 20,
    padding: 22,
    alignItems: 'center',
  },
  holidayIconCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#CCFBF1',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  stateCardTitleGreen: {
    fontSize: 17,
    fontWeight: '800',
    color: '#115E59',
    textAlign: 'center',
  },
  stateCardSubtitleGreen: {
    fontSize: 13,
    fontWeight: '500',
    color: '#0D9488',
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 4,
    marginBottom: 14,
  },
  holidayMetaBadge: {
    backgroundColor: '#CCFBF1',
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 12,
  },
  holidayMetaText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#115E59',
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
    textAlign: 'center',
  },
  stateCardSubtitleRed: {
    fontSize: 13,
    fontWeight: '500',
    color: '#B91C1C',
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
    fontWeight: '800',
    color: '#DC2626',
  },

  /* --- Modal Footer --- */
  modalFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 28 : 18,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    backgroundColor: '#FFFFFF',
  },
  regularizeActionBtn: {
    flex: 2,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#1373e5',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: '#1373e5',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  regularizeActionText: {
    color: '#FFFFFF',
    fontSize: 14.5,
    fontWeight: '800',
  },
  doneBtn: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#0F172A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBtnSecondary: {
    backgroundColor: '#F1F5F9',
  },
  doneBtnText: {
    color: '#FFFFFF',
    fontSize: 14.5,
    fontWeight: '800',
  },
  doneBtnTextSecondary: {
    color: '#475569',
  },
});
