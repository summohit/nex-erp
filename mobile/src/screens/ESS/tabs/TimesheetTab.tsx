import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  FlatList,
  RefreshControl,
} from 'react-native';
import {
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Clock,
  XCircle,
  AlertCircle,
  Calendar,
  Plane,
  Star,
  Plus,
  FileEdit,
  ArrowDownRight,
  ArrowUpRight,
} from 'lucide-react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTimesheetStore } from '../../../store/timesheetStore';
import { isRestDay } from '../../../utils/weeklyOffs';
import GradientBg from '../../../components/GradientBg';

import RegularizationFormModal from '../modals/RegularizationFormModal';
import DayDetailModal from '../modals/DayDetailModal';
import FeedbackModal from '../../../components/FeedbackModal';

const LEGEND = [
  { label: 'Present', color: '#10B981', bg: '#ECFDF5', border: '#A7F3D0', icon: CheckCircle2 },
  { label: 'Half Day', color: '#D97706', bg: '#FFFBEB', border: '#FDE68A', icon: Clock },
  { label: 'Late', color: '#7C3AED', bg: '#F3E8FF', border: '#DDD6FE', icon: AlertCircle },
  { label: 'Absent', color: '#EF4444', bg: '#FEF2F2', border: '#FECACA', icon: XCircle },
  { label: 'On Leave', color: '#0284C7', bg: '#F0F9FF', border: '#BAE6FD', icon: Plane },
  { label: 'Holiday', color: '#0D9488', bg: '#F0FDFA', border: '#99F6E4', icon: Star },
  { label: 'Day Off', color: '#64748B', bg: '#F1F5F9', border: '#E2E8F0', icon: Calendar },
];

const IST_OFFSET_MS = 330 * 60_000; // UTC+5:30
function toISTDateString(dateStr: string): string {
  const d = new Date(dateStr);
  const shifted = new Date(d.getTime() + IST_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatShortTime(iso?: string | null): string {
  if (!iso) return '--:--';
  return new Date(iso).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export default function TimesheetTab() {
  const {
    attendanceHistory,
    regularizations,
    holidays,
    leaveRequests,
    currentMonth,
    isLoading,
    fetchData,
    changeMonth,
    roster,
    shiftWorkingDays,
    branchWeeklyOffs,
  } = useTimesheetStore();

  const [showModal, setShowModal] = useState(false);
  const [regularizeIsoDate, setRegularizeIsoDate] = useState<string | null>(null);
  const [selectedDayData, setSelectedDayData] = useState<any>(null);
  const [showDayDetailModal, setShowDayDetailModal] = useState(false);
  const [subView, setSubView] = useState<'logs' | 'regularizations'>('logs');
  const [successModalVisible, setSuccessModalVisible] = useState(false);

  const listRef = useRef<FlatList>(null);

  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, [fetchData]),
  );

  const handlePrevMonth = () => {
    const prev = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
    changeMonth(prev);
  };

  const handleNextMonth = () => {
    const next = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
    changeMonth(next);
  };

  const todayIso = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }, []);

  const days = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return Array.from({ length: daysInMonth }, (_, i) => {
      const day = i + 1;
      const d = new Date(year, month, day);
      const checkDate = new Date(year, month, day);
      checkDate.setHours(0, 0, 0, 0);

      const isFuture = checkDate.getTime() > today.getTime();
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const isWeekend =
        branchWeeklyOffs === null && !Object.keys(roster).length && !shiftWorkingDays
          ? d.getDay() === 0 || d.getDay() === 6
          : isRestDay(d, roster[dateStr], shiftWorkingDays, branchWeeklyOffs);

      const log = attendanceHistory.find((r) => toISTDateString(r.date) === dateStr);

      const holiday = holidays.find((h) => {
        const hDate = new Date(h.date);
        return hDate.getFullYear() === year && hDate.getMonth() === month && hDate.getDate() === day;
      });

      const leave = leaveRequests.find((l) => {
        if (l.status === 'REJECTED' || l.status === 'CANCELLED') return false;
        const s = new Date(l.startDate);
        s.setHours(0, 0, 0, 0);
        const e = new Date(l.endDate);
        e.setHours(23, 59, 59, 999);
        return checkDate >= s && checkDate <= e;
      });

      let status:
        | 'Present'
        | 'Half Day'
        | 'Late'
        | 'Absent'
        | 'On Leave'
        | 'Holiday'
        | 'Day Off'
        | 'Future' = 'Future';

      if (isFuture) {
        if (holiday) status = 'Holiday';
        else if (leave) status = 'On Leave';
        else if (isWeekend) status = 'Day Off';
        else status = 'Future';
      } else {
        if (log && (log.clockIn || log.status)) {
          if (log.status === 'HALF_DAY') status = 'Half Day';
          else if (log.status === 'LATE' || (log as any).isLate) status = 'Late';
          else if (log.clockIn) status = (log as any).isLate ? 'Late' : 'Present';
          else if (log.status === 'ABSENT') status = 'Absent';
          else status = 'Present';
        } else if (holiday) {
          status = 'Holiday';
        } else if (leave) {
          status = 'On Leave';
        } else if (isWeekend) {
          status = 'Day Off';
        } else {
          status = 'Absent';
        }
      }

      return {
        date: d,
        dayStr: day.toString(),
        dayName: d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase(),
        isoDate: dateStr,
        status,
        isFuture,
        isWeekend,
        isHoliday: !!holiday,
        holiday,
        leave,
        log,
      };
    });
  }, [currentMonth, attendanceHistory, holidays, leaveRequests, roster, shiftWorkingDays, branchWeeklyOffs]);

  // Auto-scroll to today when viewing the current month
  useEffect(() => {
    if (isLoading || days.length === 0) return;
    const now = new Date();
    const isCurrentMonth =
      currentMonth.getFullYear() === now.getFullYear() &&
      currentMonth.getMonth() === now.getMonth();
    if (!isCurrentMonth) return;
    const todayIndex = days.findIndex((d) => d.isoDate === todayIso);
    if (todayIndex >= 0) {
      setTimeout(() => {
        listRef.current?.scrollToIndex({ index: todayIndex, animated: true, viewPosition: 0.5 });
      }, 100);
    }
  }, [isLoading, currentMonth, days, todayIso]);

  // Compute monthly summary metrics
  const {
    totalWorkingDays,
    totalPresent,
    lateOrHalfCount,
    leaveCount,
    absentCount,
    totalHoursMonth,
  } = useMemo(() => {
    let workingDays = 0;
    let present = 0;
    let lateOrHalf = 0;
    let onLeave = 0;
    let absent = 0;
    let hoursSum = 0;

    for (const d of days) {
      if (!d.isFuture) {
        const worked = d.status === 'Present' || d.status === 'Late' || d.status === 'Half Day';
        const isLv = d.status === 'On Leave';

        if (!d.isWeekend && !d.isHoliday && !isLv) {
          workingDays++;
        } else if (worked) {
          workingDays++;
        }

        if (worked) present++;
        if (d.status === 'Late' || d.status === 'Half Day') lateOrHalf++;
        if (isLv) onLeave++;
        if (d.status === 'Absent') absent++;
        if (d.log?.totalHours) hoursSum += d.log.totalHours;
      }
    }

    return {
      totalWorkingDays: workingDays,
      totalPresent: present,
      lateOrHalfCount: lateOrHalf,
      leaveCount: onLeave,
      absentCount: absent,
      totalHoursMonth: hoursSum,
    };
  }, [days]);

  const pastDaysNewestFirst = useMemo(
    () => days.filter((d) => !d.isFuture).reverse(),
    [days],
  );

  const sortedRegularizations = useMemo(
    () =>
      [...regularizations].sort(
        (a, b) => new Date(b.createdAt || b.date).getTime() - new Date(a.createdAt || a.date).getTime(),
      ),
    [regularizations],
  );

  const getLegendItem = (status: string) => LEGEND.find((l) => l.label === status);

  const openRegularizeForDate = (isoDate?: string) => {
    setRegularizeIsoDate(isoDate || null);
    setShowModal(true);
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={isLoading} onRefresh={fetchData} colors={['#1373e5']} />}
    >
      {/* 1. EXECUTIVE MONTHLY ATTENDANCE HERO */}
      <View style={styles.heroCard}>
        <GradientBg />

        <View style={styles.heroInner}>
          {/* Month Switcher + Regularize Button */}
          <View style={styles.heroTopRow}>
            <View style={styles.monthPill}>
              <TouchableOpacity onPress={handlePrevMonth} style={styles.monthArrowBtn} activeOpacity={0.7}>
                <ChevronLeft size={16} color="#FFFFFF" strokeWidth={2.5} />
              </TouchableOpacity>
              <Text style={styles.monthTitleText}>
                {currentMonth.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
              </Text>
              <TouchableOpacity onPress={handleNextMonth} style={styles.monthArrowBtn} activeOpacity={0.7}>
                <ChevronRight size={16} color="#FFFFFF" strokeWidth={2.5} />
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.heroRegBtn}
              activeOpacity={0.85}
              onPress={() => openRegularizeForDate()}
            >
              <Plus size={14} color="#0F172A" strokeWidth={2.6} />
              <Text style={styles.heroRegBtnText}>Regularize</Text>
            </TouchableOpacity>
          </View>

          {/* Attendance Score & Hours Row */}
          <View style={styles.heroCenterRow}>
            <View>
              <Text style={styles.heroOverline}>ATTENDANCE RATIO</Text>
              <View style={styles.heroScoreRow}>
                <Text style={styles.heroBigScore}>{totalPresent}</Text>
                <Text style={styles.heroScoreSlash}>/ {totalWorkingDays} days</Text>
              </View>
            </View>

            <View style={styles.heroHoursBadge}>
              <Clock size={14} color="#38BDF8" strokeWidth={2.2} />
              <Text style={styles.heroHoursValue}>{totalHoursMonth.toFixed(1)}h</Text>
              <Text style={styles.heroHoursLabel}>logged</Text>
            </View>
          </View>

          {/* 4-Column Glassmorphic Breakdown */}
          <View style={styles.heroStatsStrip}>
            <View style={styles.heroStatCol}>
              <Text style={[styles.heroStatValue, { color: '#34D399' }]}>{totalPresent}</Text>
              <Text style={styles.heroStatLabel}>Present</Text>
            </View>
            <View style={styles.heroStatDivider} />
            <View style={styles.heroStatCol}>
              <Text style={[styles.heroStatValue, { color: '#FBBF24' }]}>{lateOrHalfCount}</Text>
              <Text style={styles.heroStatLabel}>Late / Half</Text>
            </View>
            <View style={styles.heroStatDivider} />
            <View style={styles.heroStatCol}>
              <Text style={[styles.heroStatValue, { color: '#38BDF8' }]}>{leaveCount}</Text>
              <Text style={styles.heroStatLabel}>On Leave</Text>
            </View>
            <View style={styles.heroStatDivider} />
            <View style={styles.heroStatCol}>
              <Text style={[styles.heroStatValue, { color: '#FCA5A5' }]}>{absentCount}</Text>
              <Text style={styles.heroStatLabel}>Absent</Text>
            </View>
          </View>
        </View>
      </View>

      {/* 2. CALENDAR STRIP CARD */}
      <View style={styles.calendarCard}>
        <View style={styles.calendarCardHead}>
          <Text style={styles.calendarCardTitle}>Monthly Timeline</Text>
          <Text style={styles.calendarCardHint}>Tap any date for shift details</Text>
        </View>

        {/* Legend Pills */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.legendScroll}
        >
          {LEGEND.map((item, index) => {
            const Icon = item.icon;
            return (
              <View key={index} style={[styles.legendPill, { backgroundColor: item.bg, borderColor: item.border }]}>
                <Icon size={11} color={item.color} strokeWidth={2.4} />
                <Text style={[styles.legendText, { color: item.color }]}>{item.label}</Text>
              </View>
            );
          })}
        </ScrollView>

        {/* Horizontal Day Strip */}
        {isLoading ? (
          <View style={[styles.calendarStrip, { flexDirection: 'row' }]}>
            {Array.from({ length: 7 }).map((_, idx) => (
              <View key={idx} style={styles.dayCol}>
                <View style={styles.skeletonTextSmall} />
                <View style={styles.skeletonTextLarge} />
                <View style={styles.skeletonCircle} />
              </View>
            ))}
          </View>
        ) : (
          <FlatList
            ref={listRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            data={days}
            keyExtractor={(item) => item.isoDate}
            contentContainerStyle={styles.calendarStrip}
            getItemLayout={(_, index) => ({ length: 50, offset: 12 + index * 50, index })}
            onScrollToIndexFailed={() => {}}
            renderItem={({ item }) => {
              const legend = getLegendItem(item.status);
              const Icon = legend?.icon;
              const isToday = item.isoDate === todayIso;

              return (
                <TouchableOpacity
                  style={[styles.dayCol, isToday && styles.dayColToday]}
                  activeOpacity={0.75}
                  onPress={() => {
                    setSelectedDayData(item);
                    setShowDayDetailModal(true);
                  }}
                >
                  <Text
                    style={[
                      styles.dayName,
                      item.isWeekend && { color: '#94A3B8' },
                      isToday && styles.dayNameToday,
                    ]}
                  >
                    {item.dayName}
                  </Text>
                  <Text
                    style={[
                      styles.dayStr,
                      item.isFuture && { color: '#94A3B8' },
                      isToday && styles.dayStrToday,
                    ]}
                  >
                    {item.dayStr}
                  </Text>
                  <View
                    style={[
                      styles.statusIndicator,
                      legend
                        ? { backgroundColor: legend.bg, borderColor: legend.border, borderWidth: 1 }
                        : { backgroundColor: '#F8FAFC', borderColor: '#E2E8F0', borderWidth: 1 },
                    ]}
                  >
                    {Icon ? <Icon size={12} color={legend.color} strokeWidth={2.4} /> : null}
                  </View>
                </TouchableOpacity>
              );
            }}
          />
        )}
      </View>

      {/* 3. SEGMENTED SWITCHER: DAILY LOGS vs REGULARIZATIONS */}
      <View style={styles.segmentedBar}>
        <TouchableOpacity
          style={[styles.segmentBtn, subView === 'logs' && styles.segmentBtnActive]}
          activeOpacity={0.8}
          onPress={() => setSubView('logs')}
        >
          <Text style={[styles.segmentBtnText, subView === 'logs' && styles.segmentBtnTextActive]}>
            Daily Logs ({pastDaysNewestFirst.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.segmentBtn, subView === 'regularizations' && styles.segmentBtnActive]}
          activeOpacity={0.8}
          onPress={() => setSubView('regularizations')}
        >
          <Text
            style={[
              styles.segmentBtnText,
              subView === 'regularizations' && styles.segmentBtnTextActive,
            ]}
          >
            Regularizations ({sortedRegularizations.length})
          </Text>
        </TouchableOpacity>
      </View>

      {/* 4. DAILY LOGS OR REGULARIZATIONS LIST */}
      {subView === 'logs' ? (
        <View style={styles.logsSection}>
          {pastDaysNewestFirst.map((d) => {
            const legend = getLegendItem(d.status);
            const Icon = legend?.icon || Calendar;
            const clockIn = d.log?.clockIn;
            const clockOut = d.log?.clockOut;
            const hours = d.log?.totalHours;
            const needsAction = d.status === 'Absent' || d.status === 'Late' || d.status === 'Half Day';

            return (
              <TouchableOpacity
                key={d.isoDate}
                style={styles.logCard}
                activeOpacity={0.8}
                onPress={() => {
                  setSelectedDayData(d);
                  setShowDayDetailModal(true);
                }}
              >
                {/* Date Badge Left */}
                <View style={[styles.logDateBox, d.isoDate === todayIso && styles.logDateBoxToday]}>
                  <Text style={[styles.logDateNum, d.isoDate === todayIso && styles.logDateNumToday]}>
                    {d.dayStr}
                  </Text>
                  <Text style={[styles.logDateDay, d.isoDate === todayIso && styles.logDateDayToday]}>
                    {d.dayName}
                  </Text>
                </View>

                {/* Center Punch Details */}
                <View style={styles.logCenterCol}>
                  <View style={styles.logStatusTopRow}>
                    <View
                      style={[
                        styles.logStatusBadge,
                        {
                          backgroundColor: legend?.bg || '#F8FAFC',
                          borderColor: legend?.border || '#E2E8F0',
                        },
                      ]}
                    >
                      <Icon size={11} color={legend?.color || '#64748B'} strokeWidth={2.4} />
                      <Text style={[styles.logStatusText, { color: legend?.color || '#64748B' }]}>
                        {d.status}
                      </Text>
                    </View>

                    {hours ? (
                      <Text style={styles.logHoursPill}>{hours.toFixed(1)}h</Text>
                    ) : null}
                  </View>

                  {clockIn || clockOut ? (
                    <View style={styles.logTimesRow}>
                      <ArrowDownRight size={12} color="#16A34A" strokeWidth={2.4} />
                      <Text style={styles.logTimeValue}>{formatShortTime(clockIn)}</Text>
                      <Text style={styles.logTimeDash}>→</Text>
                      <ArrowUpRight size={12} color="#2563EB" strokeWidth={2.4} />
                      <Text style={styles.logTimeValue}>
                        {clockOut ? formatShortTime(clockOut) : 'Active'}
                      </Text>
                    </View>
                  ) : (
                    <Text style={styles.logMetaNote} numberOfLines={1}>
                      {d.status === 'Holiday'
                        ? d.holiday?.name || 'Company Holiday'
                        : d.status === 'On Leave'
                          ? d.leave?.leaveType?.name || 'Approved Leave'
                          : d.status === 'Day Off'
                            ? 'Weekly rest day'
                            : 'No punch recorded'}
                    </Text>
                  )}
                </View>

                {/* Right Action / Chevron */}
                {needsAction ? (
                  <TouchableOpacity
                    style={styles.logFixBtn}
                    activeOpacity={0.8}
                    onPress={() => openRegularizeForDate(d.isoDate)}
                  >
                    <FileEdit size={12} color="#1373e5" strokeWidth={2.3} />
                    <Text style={styles.logFixBtnText}>Fix</Text>
                  </TouchableOpacity>
                ) : (
                  <ChevronRight size={16} color="#CBD5E1" />
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      ) : (
        <View style={styles.regSection}>
          {sortedRegularizations.length === 0 ? (
            <View style={styles.emptyReg}>
              <View style={styles.emptyRegIconCircle}>
                <FileEdit size={22} color="#1373e5" />
              </View>
              <Text style={styles.emptyRegTitle}>No Regularization Requests</Text>
              <Text style={styles.emptyRegText}>
                Missed a clock-in or worked off-site? Submit a regularization request for approval.
              </Text>
              <TouchableOpacity
                style={styles.emptyRegBtn}
                activeOpacity={0.85}
                onPress={() => openRegularizeForDate()}
              >
                <Plus size={15} color="#FFFFFF" strokeWidth={2.4} />
                <Text style={styles.emptyRegBtnText}>New Request</Text>
              </TouchableOpacity>
            </View>
          ) : (
            sortedRegularizations.map((reg) => {
              const st = (reg.status || 'PENDING').toUpperCase();
              const statusColors =
                st === 'APPROVED'
                  ? { bg: '#ECFDF5', text: '#059669', border: '#A7F3D0' }
                  : st === 'REJECTED'
                    ? { bg: '#FEF2F2', text: '#DC2626', border: '#FECACA' }
                    : { bg: '#FFFBEB', text: '#D97706', border: '#FDE68A' };

              return (
                <View key={reg.id} style={styles.regCard}>
                  <View style={styles.regRow}>
                    <View style={styles.regDateGroup}>
                      <Calendar size={14} color="#1373e5" strokeWidth={2.2} />
                      <Text style={styles.regDate}>
                        {new Date(reg.date).toLocaleDateString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.regStatusPill,
                        { backgroundColor: statusColors.bg, borderColor: statusColors.border },
                      ]}
                    >
                      <Text style={[styles.regStatus, { color: statusColors.text }]}>{st}</Text>
                    </View>
                  </View>

                  {(reg.proposedClockIn || reg.proposedClockOut) && (
                    <View style={styles.regProposedTimesRow}>
                      {reg.proposedClockIn && (
                        <View style={styles.regProposedChip}>
                          <ArrowDownRight size={11} color="#16A34A" />
                          <Text style={styles.regProposedText}>
                            In: {formatShortTime(reg.proposedClockIn)}
                          </Text>
                        </View>
                      )}
                      {reg.proposedClockOut && (
                        <View style={styles.regProposedChip}>
                          <ArrowUpRight size={11} color="#2563EB" />
                          <Text style={styles.regProposedText}>
                            Out: {formatShortTime(reg.proposedClockOut)}
                          </Text>
                        </View>
                      )}
                    </View>
                  )}

                  <Text style={styles.regReason} numberOfLines={2}>
                    "{reg.reason}"
                  </Text>
                </View>
              );
            })
          )}
        </View>
      )}

      <RegularizationFormModal
        visible={showModal}
        initialDate={regularizeIsoDate}
        onClose={() => {
          setShowModal(false);
          setRegularizeIsoDate(null);
        }}
        onSuccess={() => setSuccessModalVisible(true)}
      />

      <DayDetailModal
        visible={showDayDetailModal}
        onClose={() => setShowDayDetailModal(false)}
        dayData={selectedDayData}
        onRegularize={(iso) => openRegularizeForDate(iso)}
      />

      <FeedbackModal
        visible={successModalVisible}
        type="success"
        title="Regularization Submitted"
        message="Your attendance regularization request has been sent for manager approval."
        onClose={() => setSuccessModalVisible(false)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 110,
  },

  /* --- 1. HERO CARD --- */
  heroCard: {
    borderRadius: 24,
    overflow: 'hidden',
    marginBottom: 16,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 16,
    elevation: 5,
  },
  heroInner: {
    padding: 18,
  },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  monthPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 14,
    paddingHorizontal: 6,
    paddingVertical: 4,
    gap: 8,
  },
  monthArrowBtn: {
    width: 28,
    height: 28,
    borderRadius: 9,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthTitleText: {
    fontSize: 13.5,
    fontWeight: '800',
    color: '#FFFFFF',
    minWidth: 82,
    textAlign: 'center',
  },
  heroRegBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  heroRegBtnText: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#0F172A',
  },
  heroCenterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 16,
  },
  heroOverline: {
    fontSize: 10,
    fontWeight: '800',
    color: 'rgba(186, 230, 253, 0.85)',
    letterSpacing: 0.7,
    marginBottom: 2,
  },
  heroScoreRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  heroBigScore: {
    fontSize: 30,
    fontWeight: '900',
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
  },
  heroScoreSlash: {
    fontSize: 14,
    fontWeight: '700',
    color: '#BAE6FD',
  },
  heroHoursBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 12,
  },
  heroHoursValue: {
    fontSize: 14,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  heroHoursLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#BAE6FD',
  },
  heroStatsStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    borderRadius: 16,
    paddingVertical: 10,
  },
  heroStatCol: {
    flex: 1,
    alignItems: 'center',
  },
  heroStatDivider: {
    width: 1,
    height: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
  },
  heroStatValue: {
    fontSize: 16,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  heroStatLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(224, 242, 254, 0.85)',
    marginTop: 1,
  },

  /* --- 2. CALENDAR STRIP CARD --- */
  calendarCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    paddingVertical: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  calendarCardHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  calendarCardTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  calendarCardHint: {
    fontSize: 11.5,
    fontWeight: '500',
    color: '#94A3B8',
  },
  legendScroll: {
    paddingHorizontal: 16,
    gap: 8,
    paddingBottom: 12,
  },
  legendPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4.5,
    paddingHorizontal: 8.5,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  legendText: {
    fontSize: 11,
    fontWeight: '700',
  },
  calendarStrip: {
    paddingHorizontal: 12,
    gap: 6,
  },
  dayCol: {
    alignItems: 'center',
    width: 44,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#F1F5F9',
    gap: 3,
  },
  dayColToday: {
    backgroundColor: '#EFF6FF',
    borderColor: '#93C5FD',
  },
  dayName: {
    fontSize: 10,
    color: '#64748B',
    fontWeight: '700',
  },
  dayNameToday: {
    color: '#1D4ED8',
    fontWeight: '800',
  },
  dayStr: {
    fontSize: 14,
    color: '#0F172A',
    fontWeight: '800',
  },
  dayStrToday: {
    color: '#1373e5',
  },
  statusIndicator: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },

  /* --- 3. SEGMENTED BAR --- */
  segmentedBar: {
    flexDirection: 'row',
    backgroundColor: '#E2E8F0',
    borderRadius: 14,
    padding: 4,
    marginBottom: 14,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 11,
    alignItems: 'center',
  },
  segmentBtnActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  segmentBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748B',
  },
  segmentBtnTextActive: {
    color: '#0F172A',
    fontWeight: '800',
  },

  /* --- 4. DAILY LOGS --- */
  logsSection: {
    gap: 10,
  },
  logCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 12,
  },
  logDateBox: {
    width: 48,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logDateBoxToday: {
    backgroundColor: '#EFF6FF',
    borderColor: '#93C5FD',
  },
  logDateNum: {
    fontSize: 16,
    fontWeight: '900',
    color: '#0F172A',
  },
  logDateNumToday: {
    color: '#1373e5',
  },
  logDateDay: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748B',
  },
  logDateDayToday: {
    color: '#1D4ED8',
  },
  logCenterCol: {
    flex: 1,
    gap: 5,
  },
  logStatusTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 999,
    borderWidth: 1,
  },
  logStatusText: {
    fontSize: 11,
    fontWeight: '800',
  },
  logHoursPill: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#0F172A',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
  logTimesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  logTimeValue: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#334155',
    fontVariant: ['tabular-nums'],
  },
  logTimeDash: {
    fontSize: 12,
    color: '#94A3B8',
    marginHorizontal: 2,
  },
  logMetaNote: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
  },
  logFixBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  logFixBtnText: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#1373e5',
  },

  /* --- REGULARIZATIONS --- */
  regSection: {
    gap: 10,
  },
  emptyReg: {
    padding: 28,
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  emptyRegIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  emptyRegTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 4,
  },
  emptyRegText: {
    color: '#64748B',
    fontSize: 12.5,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 14,
  },
  emptyRegBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1373e5',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
  },
  emptyRegBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  regCard: {
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  regRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  regDateGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  regDate: {
    fontSize: 14.5,
    fontWeight: '800',
    color: '#0F172A',
  },
  regStatusPill: {
    paddingHorizontal: 9,
    paddingVertical: 3.5,
    borderRadius: 999,
    borderWidth: 1,
  },
  regStatus: {
    fontSize: 10.5,
    fontWeight: '800',
  },
  regProposedTimesRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  regProposedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  regProposedText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#334155',
  },
  regReason: {
    fontSize: 13,
    color: '#475569',
    fontStyle: 'italic',
    lineHeight: 18,
  },
  skeletonTextSmall: {
    width: 24,
    height: 10,
    backgroundColor: '#E2E8F0',
    borderRadius: 4,
  },
  skeletonTextLarge: {
    width: 20,
    height: 16,
    backgroundColor: '#E2E8F0',
    borderRadius: 4,
    marginTop: 4,
  },
  skeletonCircle: {
    width: 24,
    height: 24,
    backgroundColor: '#E2E8F0',
    borderRadius: 12,
    marginTop: 4,
  },
});
