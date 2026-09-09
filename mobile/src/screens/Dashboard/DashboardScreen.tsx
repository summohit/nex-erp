import React, { useState, useEffect } from 'react';
import { useNavigation } from '@react-navigation/native';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Animated,
} from 'react-native';
import AppScreen from '../../components/AppScreen';
import Svg, { Circle } from 'react-native-svg';
import { useAuthStore } from '../../store/authStore';
import { useDashboardStore } from '../../store/dashboardStore';
import { notificationService, AppNotification } from '../../api/notificationService';
import { useFieldVisitStore } from '../../store/fieldVisitStore';
import { formatElapsed } from '../../utils/haversine';
import { navigateTo } from '../../navigation/navigationUtils';
import FeedbackModal, { ModalType } from '../../components/FeedbackModal';
import {
  Clock,
  Play,
  Square,
  CalendarDays,
  CalendarClock,
  Receipt,
  MapPin,
  Navigation,
  FolderKanban,
  ArrowUp,
  ChevronRight,
  Bell,
  X,
  CheckCircle2,
} from 'lucide-react-native';

const PulseSkeleton = ({ style }: { style: any }) => {
  const pulseAnim = React.useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.5, duration: 800, useNativeDriver: true }),
      ])
    ).start();
  }, [pulseAnim]);
  return <Animated.View style={[style, { opacity: pulseAnim, backgroundColor: '#E2E8F0' }]} />;
};

function formatRelativeTime(dateStr?: string | Date): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getNotificationIcon(title?: string, message?: string) {
  const text = `${title || ''} ${message || ''}`.toLowerCase();
  if (text.includes('leave') || text.includes('holiday')) {
    return { Icon: CalendarDays, bg: '#ECFDF5', color: '#059669' };
  }
  if (text.includes('project') || text.includes('task') || text.includes('board')) {
    return { Icon: FolderKanban, bg: '#FEF3C7', color: '#D97706' };
  }
  if (text.includes('payroll') || text.includes('payslip') || text.includes('expense')) {
    return { Icon: Receipt, bg: '#F0FDF4', color: '#16A34A' };
  }
  if (text.includes('visit') || text.includes('travel') || text.includes('client')) {
    return { Icon: MapPin, bg: '#FAF5FF', color: '#9333EA' };
  }
  if (text.includes('attendance') || text.includes('timesheet') || text.includes('clock')) {
    return { Icon: CalendarClock, bg: '#EFF6FF', color: '#2563EB' };
  }
  return { Icon: Bell, bg: '#F8FAFC', color: '#64748B' };
}

export default function DashboardScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAuthStore();
  const {
    profile,
    todayAttendance,
    attendanceHistory,
    leaveBalances,
    projects,
    notifications,
    fetchDashboardData,
    clockIn,
    clockOut,
    isClockingIn,
    isLoading,
    error,
  } = useDashboardStore();
  const { activeVisit, fetchActiveVisit } = useFieldVisitStore();

  const [currentTime, setCurrentTime] = useState('');
  const [liveWorkedTime, setLiveWorkedTime] = useState({ hours: 0, minutes: 0 });
  const [timeFilter, setTimeFilter] = useState<'7D' | '30D' | '3M'>('7D');
  const [refreshing, setRefreshing] = useState(false);
  const [visitElapsed, setVisitElapsed] = useState('00:00:00');
  const [feedback, setFeedback] = useState<{
    visible: boolean;
    type: ModalType;
    title: string;
    message: string;
  }>({ visible: false, type: 'success', title: '', message: '' });

  const isTraveling = !!activeVisit;

  // Initial load
  useEffect(() => {
    fetchDashboardData();
    fetchActiveVisit().catch(() => {});
  }, [fetchDashboardData, fetchActiveVisit]);

  // Field visit elapsed timer
  useEffect(() => {
    if (!activeVisit?.startTime) return;
    const tick = () => {
      const secs = Math.max(0, Math.floor((Date.now() - new Date(activeVisit.startTime).getTime()) / 1000));
      setVisitElapsed(formatElapsed(secs));
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [activeVisit?.startTime]);

  // Live Clock
  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setCurrentTime(now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }));
    };
    updateClock();
    const timer = setInterval(updateClock, 1000);
    return () => clearInterval(timer);
  }, []);

  // Live Worked Time Tracker
  useEffect(() => {
    const updateTimer = () => {
      if (todayAttendance?.clockIn && !todayAttendance?.clockOut) {
        const clockInTime = new Date(todayAttendance.clockIn).getTime();
        const diffMs = Math.max(0, Date.now() - clockInTime);
        const totalMinutes = Math.floor(diffMs / 60000);
        setLiveWorkedTime({ hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 });
      } else if (todayAttendance?.totalHours) {
        setLiveWorkedTime({
          hours: Math.floor(todayAttendance.totalHours),
          minutes: Math.round((todayAttendance.totalHours % 1) * 60),
        });
      } else {
        setLiveWorkedTime({ hours: 0, minutes: 0 });
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 60000);
    return () => clearInterval(interval);
  }, [todayAttendance]);

  const safeNavigate = (screenName: string, params?: any) => {
    if (screenName === 'Expenses') {
      navigateTo(navigation, 'Attendance', { initialTab: 'expenses' });
    } else {
      navigateTo(navigation, screenName, params);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchDashboardData();
    setRefreshing(false);
  };

  const handleAttendanceToggle = async () => {
    try {
      if (todayAttendance?.clockIn && !todayAttendance?.clockOut) {
        await clockOut();
        setFeedback({ visible: true, type: 'success', title: 'Shift Ended', message: 'You have clocked out successfully.' });
      } else {
        await clockIn();
        setFeedback({ visible: true, type: 'success', title: 'Shift Started', message: 'You have clocked in successfully.' });
      }
    } catch (err: any) {
      setFeedback({ visible: true, type: 'error', title: 'Action Failed', message: err?.message || 'Failed to update attendance' });
    }
  };

  const isCheckedIn = !!(todayAttendance?.clockIn && !todayAttendance?.clockOut);

  const handleNotificationPress = async (notification: AppNotification) => {
    if (!notification.isRead) {
      notificationService.markAsRead(notification.id).catch(() => {});
      useDashboardStore.setState(state => ({
        notifications: state.notifications.map(n => n.id === notification.id ? { ...n, isRead: true } : n),
        unreadCount: Math.max(0, state.unreadCount - 1),
      }));
    }

    const path = notification.linkUrl?.split('?')[0];
    if (!path) return;

    if (path.startsWith('/projects/')) {
      const parts = path.split('/');
      const projectId = parseInt(parts[2], 10);
      if (!isNaN(projectId)) {
        const project = projects.find((p: any) => p.id === projectId);
        if (project) {
          navigation.navigate('ProjectDetail', { projectId: project.id, projectName: project.name });
          return;
        }
      }
      safeNavigate('Projects');
    } else if (path === '/projects') {
      safeNavigate('Projects');
    } else if (path.startsWith('/attendance/leaves') || path === '/attendance/leave') {
      safeNavigate('Leaves', { initialTab: 'leaves' });
    } else if (path.startsWith('/attendance')) {
      safeNavigate('Attendance', { initialTab: 'timesheets' });
    } else if (path.startsWith('/payroll')) {
      safeNavigate('Payslips');
    }
  };

  // Computed values
  const totalLeaveAllocated = leaveBalances.reduce((sum, lb) => sum + lb.allocated, 0);
  const totalLeaveUsed = leaveBalances.reduce((sum, lb) => sum + lb.used, 0);
  const totalLeaveRemaining = Math.max(0, totalLeaveAllocated - totalLeaveUsed);
  const leaveProgress = totalLeaveAllocated > 0 ? (totalLeaveUsed / totalLeaveAllocated) * 100 : 0;

  const activeProjectsCount = projects.filter(p => p.status !== 'ARCHIVED').length;
  const completedProjectsCount = projects.filter(p => p.status === 'COMPLETED').length;

  const currentHour = new Date().getHours();
  const greeting = currentHour < 12 ? 'Good morning' : currentHour < 17 ? 'Good afternoon' : 'Good evening';
  const cleanLastName = (profile?.lastName || '').trim() === '.' ? '' : (profile?.lastName || '').trim();
  const displayName = profile
    ? [profile.firstName?.trim(), cleanLastName].filter(Boolean).join(' ')
    : (user?.email?.split('@')[0] || 'Employee');

  // Weekly attendance chart data (computed)
  const getChartData = () => {
    const data = [
      { day: 'M', label: 'Mon', pct: 0, hours: 0 },
      { day: 'T', label: 'Tue', pct: 0, hours: 0 },
      { day: 'W', label: 'Wed', pct: 0, hours: 0 },
      { day: 'T', label: 'Thu', pct: 0, hours: 0 },
      { day: 'F', label: 'Fri', pct: 0, hours: 0 },
      { day: 'S', label: 'Sat', pct: 0, hours: 0 },
      { day: 'S', label: 'Sun', pct: 0, hours: 0 },
    ];

    if (!attendanceHistory || attendanceHistory.length === 0) return { data, avgHours: 0 };

    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - ((now.getDay() + 6) % 7)); // Monday
    startOfWeek.setHours(0, 0, 0, 0);

    let totalHoursWeek = 0;
    let workDaysCount = 0;

    attendanceHistory.forEach(record => {
      const recordDate = new Date(record.date);
      if (recordDate >= startOfWeek) {
        const dayIndex = recordDate.getDay(); // 0 (Sun) to 6 (Sat)
        const mappedIndex = dayIndex === 0 ? 6 : dayIndex - 1; // Map to Mon-Sun
        if (mappedIndex >= 0 && mappedIndex < 7) {
          totalHoursWeek += record.totalHours;
          if (record.totalHours > 0) workDaysCount++;
          const pct = Math.min(100, Math.round((record.totalHours / 10) * 100));
          data[mappedIndex].pct = pct;
          data[mappedIndex].hours = record.totalHours;
        }
      }
    });

    const avg = workDaysCount > 0 ? totalHoursWeek / workDaysCount : (totalHoursWeek / 5);
    return { data, avgHours: avg };
  };

  const { data: chartData, avgHours } = getChartData();
  const todayDayIndex = (new Date().getDay() + 6) % 7; // Monday = 0
  const workedTodayHours = todayAttendance?.totalHours || (liveWorkedTime.hours + liveWorkedTime.minutes / 60);
  const targetHours = 8.5;
  const progressRatio = Math.min(workedTodayHours / targetHours, 1);
  const trendVsAvg = avgHours > 0 ? ((workedTodayHours - avgHours) / avgHours) * 100 : 0;
  const trendColor = trendVsAvg >= 0 ? '#10B981' : '#EF4444';
  const trendBg = trendVsAvg >= 0 ? '#ECFDF5' : '#FEF2F2';

  return (
    <AppScreen
      showBottomNav={false}
      title={displayName}
      subtitle={greeting}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#E25E3E']} />
        }
      >
        {error ? (
          <View style={styles.errorContainer}>
            <View style={styles.errorIconBox}>
              <X color="#DC2626" size={32} strokeWidth={2.5} />
            </View>
            <Text style={styles.errorTitle}>Connection Issue</Text>
            <Text style={styles.errorMessage}>
              We could not sync your dashboard. Please verify your network connection.
            </Text>
            <TouchableOpacity style={styles.retryBtn} onPress={onRefresh} activeOpacity={0.8}>
              <Text style={styles.retryBtnText}>Retry Sync</Text>
            </TouchableOpacity>
          </View>
        ) : isLoading && !refreshing ? (
          <View style={styles.skeletonContainer}>
            <PulseSkeleton style={{ height: 210, borderRadius: 24, width: '100%' }} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <PulseSkeleton style={{ height: 88, borderRadius: 18, flex: 1 }} />
              <PulseSkeleton style={{ height: 88, borderRadius: 18, flex: 1 }} />
              <PulseSkeleton style={{ height: 88, borderRadius: 18, flex: 1 }} />
              <PulseSkeleton style={{ height: 88, borderRadius: 18, flex: 1 }} />
            </View>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <PulseSkeleton style={{ height: 135, borderRadius: 22, flex: 1 }} />
              <PulseSkeleton style={{ height: 135, borderRadius: 22, flex: 1 }} />
            </View>
            <PulseSkeleton style={{ height: 240, borderRadius: 24, width: '100%' }} />
          </View>
        ) : (
          <>
            {/* 1. HERO ATTENDANCE & SHIFT HUB */}
            <View style={styles.heroAttendanceCard}>
              <View style={styles.heroGlowAccent} />

              {/* Status Pill & Date Header */}
              <View style={styles.heroHeaderRow}>
                <View style={[styles.heroShiftBadge, isCheckedIn ? styles.heroShiftBadgeActive : styles.heroShiftBadgeIdle]}>
                  <View style={[styles.heroStatusDot, isCheckedIn ? styles.heroStatusDotActive : styles.heroStatusDotIdle]} />
                  <Text style={[styles.heroShiftBadgeText, isCheckedIn ? styles.heroShiftTextActive : styles.heroShiftTextIdle]}>
                    {isCheckedIn ? 'ACTIVE SHIFT' : 'OFF SHIFT'}
                  </Text>
                </View>

                <View style={styles.heroDateRow}>
                  <CalendarDays size={14} color="#64748B" strokeWidth={2} />
                  <Text style={styles.heroDateText}>
                    {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                  </Text>
                </View>
              </View>

              {/* Clock & SVG Gauge Center */}
              <View style={styles.heroCenterRow}>
                <View style={styles.heroTimeCol}>
                  <Text style={styles.heroTimeClock}>{currentTime || '00:00:00'}</Text>
                  <Text style={styles.heroTargetSubtitle}>
                    {todayAttendance?.clockIn
                      ? `Clocked in at ${new Date(todayAttendance.clockIn).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`
                      : 'Regular shift target: 8h 30m'}
                  </Text>
                </View>

                {/* Circular Progress Gauge */}
                <View style={styles.heroRingWrapper}>
                  <Svg width="68" height="68" viewBox="0 0 68 68">
                    <Circle
                      cx="34" cy="34" r="28"
                      stroke="#F1F5F9" strokeWidth="6" fill="none"
                    />
                    <Circle
                      cx="34" cy="34" r="28"
                      stroke={isCheckedIn ? '#10B981' : '#E25E3E'} strokeWidth="6" fill="none"
                      strokeDasharray={`${2 * Math.PI * 28}`}
                      strokeDashoffset={`${2 * Math.PI * 28 * (1 - progressRatio)}`}
                      strokeLinecap="round"
                      rotation="-90"
                      origin="34, 34"
                    />
                  </Svg>
                  <View style={styles.heroRingCenterContent}>
                    <Text style={styles.heroRingMainText}>
                      {liveWorkedTime.hours}h {liveWorkedTime.minutes}m
                    </Text>
                    <Text style={styles.heroRingSubText}>Worked</Text>
                  </View>
                </View>
              </View>

              {/* Action Button Bar */}
              <View style={styles.heroFooter}>
                <TouchableOpacity
                  style={[
                    styles.heroPunchBtn,
                    isCheckedIn ? styles.heroPunchBtnOut : styles.heroPunchBtnIn,
                    isClockingIn && { opacity: 0.75 },
                  ]}
                  activeOpacity={0.82}
                  onPress={handleAttendanceToggle}
                  disabled={isClockingIn}
                >
                  {isClockingIn ? (
                    <ActivityIndicator size="small" color="#FFFFFF" style={{ marginRight: 8 }} />
                  ) : isCheckedIn ? (
                    <Square size={16} color="#FFFFFF" fill="#FFFFFF" style={{ marginRight: 8 }} />
                  ) : (
                    <Play size={16} color="#FFFFFF" fill="#FFFFFF" style={{ marginRight: 8 }} />
                  )}
                  <Text style={styles.heroPunchBtnText}>
                    {isClockingIn ? 'Updating Status…' : isCheckedIn ? 'Clock Out' : 'Clock In for Today'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* 2. REFINED QUICK ACTIONS GRID */}
            <View style={styles.sectionHeadingRow}>
              <Text style={styles.sectionHeading}>Quick Actions</Text>
            </View>
            <View style={styles.quickGrid}>
              <TouchableOpacity
                style={styles.quickTile}
                activeOpacity={0.75}
                onPress={() => safeNavigate('Leaves')}
              >
                <View style={[styles.quickTileIcon, { backgroundColor: '#FFF7ED' }]}>
                  <CalendarDays size={22} color="#EA580C" strokeWidth={2.2} />
                </View>
                <Text style={styles.quickTileLabel}>Leaves</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.quickTile}
                activeOpacity={0.75}
                onPress={() => safeNavigate('Attendance')}
              >
                <View style={[styles.quickTileIcon, { backgroundColor: '#ECFDF5' }]}>
                  <CalendarClock size={22} color="#059669" strokeWidth={2.2} />
                </View>
                <Text style={styles.quickTileLabel}>Timesheet</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.quickTile}
                activeOpacity={0.75}
                onPress={() => safeNavigate('Expenses')}
              >
                <View style={[styles.quickTileIcon, { backgroundColor: '#EFF6FF' }]}>
                  <Receipt size={22} color="#2563EB" strokeWidth={2.2} />
                </View>
                <Text style={styles.quickTileLabel}>Expense</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.quickTile}
                activeOpacity={0.75}
                onPress={() => safeNavigate('FieldVisit')}
              >
                <View style={[styles.quickTileIcon, { backgroundColor: '#FAF5FF' }]}>
                  <MapPin size={22} color="#9333EA" strokeWidth={2.2} />
                </View>
                <Text style={styles.quickTileLabel}>Field Visit</Text>
              </TouchableOpacity>
            </View>

            {/* 3. EXECUTIVE BENTO CARDS (LEAVE & PROJECTS) */}
            <View style={styles.sectionHeadingRow}>
              <Text style={styles.sectionHeading}>Overview</Text>
              <TouchableOpacity activeOpacity={0.7} onPress={() => safeNavigate('Projects')}>
                <Text style={styles.viewAllBtnText}>View all</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.bentoGrid}>
              {/* Card A: Leave Balance */}
              <TouchableOpacity
                style={styles.bentoCard}
                activeOpacity={0.8}
                onPress={() => safeNavigate('Leaves')}
              >
                <View style={styles.bentoHeader}>
                  <View style={[styles.bentoIconBadge, { backgroundColor: '#ECFDF5' }]}>
                    <CalendarDays size={18} color="#059669" strokeWidth={2.2} />
                  </View>
                  <ChevronRight size={16} color="#CBD5E1" strokeWidth={2.2} />
                </View>
                <View style={styles.bentoValueRow}>
                  <Text style={styles.bentoValue}>{totalLeaveRemaining}</Text>
                  <Text style={styles.bentoUnit}>days left</Text>
                </View>
                <Text style={styles.bentoTitle}>Leave Balance</Text>
                <View style={styles.bentoProgressTrack}>
                  <View
                    style={[
                      styles.bentoProgressFill,
                      { width: `${Math.min(leaveProgress, 100)}%` },
                      leaveProgress >= 90 && { backgroundColor: '#EF4444' },
                    ]}
                  />
                </View>
                <Text style={styles.bentoFooterNote}>{totalLeaveUsed} of {totalLeaveAllocated} used</Text>
              </TouchableOpacity>

              {/* Card B: Active Projects */}
              <TouchableOpacity
                style={styles.bentoCard}
                activeOpacity={0.8}
                onPress={() => safeNavigate('Projects')}
              >
                <View style={styles.bentoHeader}>
                  <View style={[styles.bentoIconBadge, { backgroundColor: '#FEF3C7' }]}>
                    <FolderKanban size={18} color="#D97706" strokeWidth={2.2} />
                  </View>
                  <View style={styles.bentoPill}>
                    <Text style={styles.bentoPillText}>{activeProjectsCount} Active</Text>
                  </View>
                </View>
                <View style={styles.bentoValueRow}>
                  <Text style={styles.bentoValue}>{activeProjectsCount}</Text>
                  <Text style={styles.bentoUnit}>projects</Text>
                </View>
                <Text style={styles.bentoTitle}>Current Pipeline</Text>
                <View style={styles.bentoProgressTrack}>
                  <View
                    style={[
                      styles.bentoProgressFill,
                      {
                        backgroundColor: '#3B82F6',
                        width: projects.length > 0 ? `${Math.min((completedProjectsCount / projects.length) * 100, 100)}%` : '0%',
                      },
                    ]}
                  />
                </View>
                <Text style={styles.bentoFooterNote}>{completedProjectsCount} completed</Text>
              </TouchableOpacity>
            </View>

            {/* 4. WORKING HOURS / ATTENDANCE RHYTHM CHART */}
            <View style={styles.chartCard}>
              <View style={styles.chartCardHeader}>
                <View>
                  <Text style={styles.chartCardTitle}>Working Hours</Text>
                  <Text style={styles.chartCardSubtitle}>Weekly attendance rhythm</Text>
                </View>
                <View style={styles.periodPills}>
                  {(['7D', '30D', '3M'] as const).map((filter) => (
                    <TouchableOpacity
                      key={filter}
                      style={[styles.periodTab, timeFilter === filter && styles.periodTabActive]}
                      activeOpacity={0.7}
                      onPress={() => setTimeFilter(filter)}
                    >
                      <Text style={[styles.periodTabText, timeFilter === filter && styles.periodTabTextActive]}>
                        {filter}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Bar Chart */}
              <View style={styles.chartBody}>
                <View style={styles.chartGridLines}>
                  <View style={styles.chartGridLine} />
                  <View style={styles.chartGridLine} />
                  <View style={styles.chartGridLine} />
                </View>
                <View style={styles.barsRow}>
                  {chartData.map((item, index) => {
                    const isToday = index === todayDayIndex;
                    return (
                      <View key={index} style={styles.barColumn}>
                        <View style={styles.barTrack}>
                          <View
                            style={[
                              styles.barFill,
                              { height: `${Math.max(item.pct, 4)}%` },
                              isToday ? styles.barFillToday : styles.barFillOther,
                            ]}
                          />
                        </View>
                        <Text style={[styles.barLabel, isToday && styles.barLabelToday]}>
                          {item.day}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </View>

              {/* Chart Stats Footer */}
              <View style={styles.chartFooterRow}>
                <View style={styles.chartAvgGroup}>
                  <Text style={styles.chartAvgValue}>
                    {avgHours > 0 ? `${Math.floor(avgHours)}h ${Math.round((avgHours % 1) * 60)}m` : '0h 0m'}
                  </Text>
                  <Text style={styles.chartAvgLabel}>Weekly average</Text>
                </View>
                <View style={[styles.chartTrendBadge, { backgroundColor: trendBg }]}>
                  <ArrowUp
                    size={13}
                    color={trendColor}
                    strokeWidth={2.5}
                    style={{ transform: [{ rotate: trendVsAvg >= 0 ? '0deg' : '180deg' }] }}
                  />
                  <Text style={[styles.chartTrendText, { color: trendColor }]}>
                    {' '}{Math.abs(trendVsAvg).toFixed(1)}% vs avg
                  </Text>
                </View>
              </View>
            </View>

            {/* 5. SMART FIELD VISIT ISLAND */}
            <View style={styles.sectionHeadingRow}>
              <Text style={styles.sectionHeading}>Field Operations</Text>
              <TouchableOpacity activeOpacity={0.7} onPress={() => safeNavigate('FieldVisit')}>
                <Text style={styles.viewAllBtnText}>History</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              activeOpacity={0.9}
              style={styles.fieldCard}
              onPress={() => safeNavigate('FieldVisit')}
            >
              <View style={styles.fieldCardHeader}>
                <View style={styles.fieldTitleGroup}>
                  <View style={[styles.fieldBadge, isTraveling && styles.fieldBadgeActive]}>
                    <Navigation size={15} color={isTraveling ? '#16A34A' : '#64748B'} strokeWidth={2.2} />
                    <Text style={[styles.fieldBadgeText, isTraveling && styles.fieldBadgeTextActive]}>
                      {isTraveling ? 'TRAVELING' : 'IDLE'}
                    </Text>
                  </View>
                  <Text style={styles.fieldMainTitle}>
                    {isTraveling ? 'Field Visit in Progress' : 'Field Visit'}
                  </Text>
                </View>
                <View style={[styles.fieldStatusDotWrap, isTraveling ? styles.fieldDotActive : styles.fieldDotIdle]} />
              </View>

              {isTraveling && activeVisit ? (
                <>
                  <View style={styles.fieldVisitProjectRow}>
                    <View style={[styles.fieldProjectDot, { backgroundColor: activeVisit.project?.color || '#2563EB' }]} />
                    <Text style={styles.fieldProjectName} numberOfLines={1}>
                      {activeVisit.project?.name || 'Active Visit Project'}
                    </Text>
                  </View>
                  {!!activeVisit.purpose && (
                    <Text style={styles.fieldPurposeText} numberOfLines={2}>
                      {activeVisit.purpose}
                    </Text>
                  )}
                  <View style={styles.fieldLiveMetricsRow}>
                    <View style={styles.fieldLiveMetricItem}>
                      <Clock size={15} color="#E25E3E" strokeWidth={2.2} />
                      <Text style={styles.fieldLiveValue}>{visitElapsed}</Text>
                      <Text style={styles.fieldLiveLabel}>Duration</Text>
                    </View>
                    <View style={styles.fieldLiveDivider} />
                    <View style={styles.fieldLiveMetricItem}>
                      <MapPin size={15} color="#2563EB" strokeWidth={2.2} />
                      <Text style={styles.fieldLiveValue}>
                        {new Date(activeVisit.startTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                      </Text>
                      <Text style={styles.fieldLiveLabel}>Started</Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    style={styles.fieldActiveActionBtn}
                    activeOpacity={0.8}
                    onPress={() => safeNavigate('FieldVisit')}
                  >
                    <MapPin size={16} color="#FFFFFF" strokeWidth={2.2} style={{ marginRight: 6 }} />
                    <Text style={styles.fieldActiveActionText}>View Live Route</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <View style={styles.fieldIdleContent}>
                  <Text style={styles.fieldIdleDescription}>
                    Track your business travel, client meetings, and route logs effortlessly.
                  </Text>
                  <View style={styles.fieldIdleActionRow}>
                    <TouchableOpacity
                      style={styles.fieldStartBtn}
                      activeOpacity={0.8}
                      onPress={() => safeNavigate('FieldVisit')}
                    >
                      <Navigation size={15} color="#FFFFFF" strokeWidth={2.4} style={{ marginRight: 6 }} />
                      <Text style={styles.fieldStartBtnText}>Start Trip</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </TouchableOpacity>

            {/* 6. RECENT ACTIVITY TIMELINE FEED */}
            <View style={styles.sectionHeadingRow}>
              <Text style={styles.sectionHeading}>Recent Activity</Text>
              <TouchableOpacity activeOpacity={0.7} onPress={() => safeNavigate('Notifications')}>
                <Text style={styles.viewAllBtnText}>View all</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.activityCard}>
              {notifications.length > 0 ? (
                notifications.slice(0, 4).map((notification, index) => {
                  const { Icon: ActionIcon, bg: iconBg, color: iconColor } = getNotificationIcon(notification.title, notification.message);
                  return (
                    <React.Fragment key={notification.id}>
                      <TouchableOpacity
                        style={[
                          styles.activityItem,
                          !notification.isRead && styles.activityItemUnread,
                        ]}
                        activeOpacity={0.7}
                        onPress={() => handleNotificationPress(notification)}
                      >
                        <View style={[styles.activityIconBox, { backgroundColor: iconBg }]}>
                          <ActionIcon size={18} color={iconColor} strokeWidth={2.2} />
                          {!notification.isRead && <View style={styles.activityUnreadDot} />}
                        </View>
                        <View style={styles.activityContentCol}>
                          <Text style={[styles.activityTitle, !notification.isRead && styles.activityTitleBold]} numberOfLines={1}>
                            {notification.title}
                          </Text>
                          <Text style={styles.activityMessage} numberOfLines={2}>
                            {notification.message}
                          </Text>
                          <Text style={styles.activityTime}>{formatRelativeTime(notification.createdAt)}</Text>
                        </View>
                        <ChevronRight size={15} color="#CBD5E1" strokeWidth={2} />
                      </TouchableOpacity>
                      {index < Math.min(notifications.length, 4) - 1 && <View style={styles.activityDivider} />}
                    </React.Fragment>
                  );
                })
              ) : (
                <View style={styles.activityEmptyState}>
                  <CheckCircle2 size={32} color="#10B981" strokeWidth={2} style={{ marginBottom: 8 }} />
                  <Text style={styles.activityEmptyTitle}>All Caught Up</Text>
                  <Text style={styles.activityEmptySubtitle}>You have no pending notifications or updates.</Text>
                </View>
              )}
            </View>
          </>
        )}
      </ScrollView>

      <FeedbackModal
        visible={feedback.visible}
        type={feedback.type}
        title={feedback.title}
        message={feedback.message}
        onClose={() => setFeedback(prev => ({ ...prev, visible: false }))}
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 90,
  },

  // --- 1. HERO ATTENDANCE & SHIFT HUB ---
  heroAttendanceCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 20,
    marginBottom: 20,
    position: 'relative',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#FFF1EC',
    shadowColor: '#E25E3E',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.07,
    shadowRadius: 18,
    elevation: 4,
  },
  heroGlowAccent: {
    position: 'absolute',
    top: -50,
    right: -50,
    width: 170,
    height: 170,
    borderRadius: 85,
    backgroundColor: '#FFF7F5',
  },
  heroHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  heroShiftBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4.5,
    borderRadius: 20,
    gap: 6,
  },
  heroShiftBadgeActive: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  heroShiftBadgeIdle: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  heroStatusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  heroStatusDotActive: {
    backgroundColor: '#10B981',
  },
  heroStatusDotIdle: {
    backgroundColor: '#94A3B8',
  },
  heroShiftBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  heroShiftTextActive: {
    color: '#059669',
  },
  heroShiftTextIdle: {
    color: '#64748B',
  },
  heroDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  heroDateText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: '#64748B',
  },
  heroCenterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  heroTimeCol: {
    flex: 1,
    paddingRight: 12,
  },
  heroTimeClock: {
    fontSize: 27,
    fontWeight: '900',
    color: '#0F172A',
    letterSpacing: -0.8,
    fontVariant: ['tabular-nums'],
    marginBottom: 4,
  },
  heroTargetSubtitle: {
    fontSize: 12,
    fontWeight: '500',
    color: '#64748B',
    lineHeight: 16,
  },
  heroRingWrapper: {
    width: 68,
    height: 68,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroRingCenterContent: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroRingMainText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0F172A',
  },
  heroRingSubText: {
    fontSize: 8.5,
    fontWeight: '600',
    color: '#94A3B8',
    textTransform: 'uppercase',
  },
  heroFooter: {
    marginTop: 2,
  },
  heroPunchBtn: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 13,
    borderRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 3,
  },
  heroPunchBtnIn: {
    backgroundColor: '#E25E3E',
    shadowColor: '#E25E3E',
  },
  heroPunchBtnOut: {
    backgroundColor: '#EF4444',
    shadowColor: '#EF4444',
  },
  heroPunchBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 14.5,
    letterSpacing: 0.2,
  },

  // --- 2. QUICK ACTIONS GRID ---
  sectionHeadingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    paddingHorizontal: 2,
  },
  sectionHeading: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.2,
  },
  viewAllBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#E25E3E',
  },
  quickGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 22,
  },
  quickTile: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#F1F5F9',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 1,
  },
  quickTileIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  quickTileLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
  },

  // --- 3. BENTO CARDS ---
  bentoGrid: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 22,
  },
  bentoCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 8,
    elevation: 2,
  },
  bentoHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  bentoIconBadge: {
    width: 36,
    height: 36,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bentoPill: {
    backgroundColor: '#FFF7ED',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  bentoPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#EA580C',
  },
  bentoValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 5,
    marginBottom: 2,
  },
  bentoValue: {
    fontSize: 26,
    fontWeight: '900',
    color: '#0F172A',
    letterSpacing: -0.5,
  },
  bentoUnit: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  bentoTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 10,
  },
  bentoProgressTrack: {
    height: 6,
    backgroundColor: '#F1F5F9',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 6,
  },
  bentoProgressFill: {
    height: '100%',
    backgroundColor: '#10B981',
    borderRadius: 3,
  },
  bentoFooterNote: {
    fontSize: 11,
    fontWeight: '500',
    color: '#94A3B8',
  },

  // --- 4. WORKING HOURS CHART ---
  chartCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 18,
    marginBottom: 22,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 2,
  },
  chartCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  chartCardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  chartCardSubtitle: {
    fontSize: 12,
    fontWeight: '500',
    color: '#64748B',
    marginTop: 2,
  },
  periodPills: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    padding: 3,
  },
  periodTab: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 9,
  },
  periodTabActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  periodTabText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
  },
  periodTabTextActive: {
    color: '#0F172A',
  },
  chartBody: {
    height: 140,
    justifyContent: 'flex-end',
    position: 'relative',
    marginBottom: 14,
  },
  chartGridLines: {
    position: 'absolute',
    top: 0,
    bottom: 24,
    left: 0,
    right: 0,
    justifyContent: 'space-between',
  },
  chartGridLine: {
    height: 1,
    backgroundColor: '#F8FAFC',
  },
  barsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: '100%',
    paddingHorizontal: 6,
  },
  barColumn: {
    alignItems: 'center',
    height: '100%',
    justifyContent: 'flex-end',
    flex: 1,
  },
  barTrack: {
    height: 104,
    width: 20,
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    justifyContent: 'flex-end',
    alignItems: 'center',
    overflow: 'hidden',
  },
  barFill: {
    width: 20,
    borderRadius: 10,
  },
  barFillToday: {
    backgroundColor: '#E25E3E',
  },
  barFillOther: {
    backgroundColor: '#CBD5E1',
  },
  barLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94A3B8',
    marginTop: 6,
  },
  barLabelToday: {
    color: '#E25E3E',
    fontWeight: '800',
  },
  chartFooterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderColor: '#F8FAFC',
    paddingTop: 12,
  },
  chartAvgGroup: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  chartAvgValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  chartAvgLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: '#64748B',
  },
  chartTrendBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  chartTrendText: {
    fontSize: 11,
    fontWeight: '700',
  },

  // --- 5. FIELD VISIT ISLAND ---
  fieldCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 18,
    marginBottom: 22,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 8,
    elevation: 2,
  },
  fieldCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  fieldTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  fieldBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 3.5,
    borderRadius: 8,
    gap: 4,
  },
  fieldBadgeActive: {
    backgroundColor: '#DCFCE7',
  },
  fieldBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.4,
  },
  fieldBadgeTextActive: {
    color: '#16A34A',
  },
  fieldMainTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  fieldStatusDotWrap: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  fieldDotActive: {
    backgroundColor: '#16A34A',
  },
  fieldDotIdle: {
    backgroundColor: '#CBD5E1',
  },
  fieldVisitProjectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    marginTop: 4,
    marginBottom: 8,
  },
  fieldProjectDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  fieldProjectName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
    flex: 1,
  },
  fieldPurposeText: {
    fontSize: 12.5,
    color: '#64748B',
    marginBottom: 10,
    lineHeight: 17,
  },
  fieldLiveMetricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    paddingVertical: 10,
    marginBottom: 12,
  },
  fieldLiveMetricItem: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  fieldLiveDivider: {
    width: 1,
    height: 28,
    backgroundColor: '#E2E8F0',
  },
  fieldLiveValue: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  fieldLiveLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#94A3B8',
  },
  fieldActiveActionBtn: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#EF4444',
    paddingVertical: 11,
    borderRadius: 14,
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  fieldActiveActionText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13.5,
  },
  fieldIdleContent: {
    marginTop: 4,
  },
  fieldIdleDescription: {
    fontSize: 12.5,
    color: '#64748B',
    lineHeight: 18,
    marginBottom: 12,
  },
  fieldIdleActionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  fieldStartBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E25E3E',
    paddingHorizontal: 16,
    paddingVertical: 8.5,
    borderRadius: 12,
    shadowColor: '#E25E3E',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  fieldStartBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },

  // --- 6. RECENT ACTIVITY FEED ---
  activityCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 6,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 8,
    elevation: 2,
  },
  activityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  activityItemUnread: {
    backgroundColor: '#FFFBF9',
    marginHorizontal: -8,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  activityIconBox: {
    width: 40,
    height: 40,
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    position: 'relative',
  },
  activityUnreadDot: {
    position: 'absolute',
    top: -1,
    right: -1,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E25E3E',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  activityContentCol: {
    flex: 1,
    marginRight: 8,
  },
  activityTitle: {
    fontSize: 13.5,
    fontWeight: '600',
    color: '#0F172A',
    marginBottom: 2,
  },
  activityTitleBold: {
    fontWeight: '800',
  },
  activityMessage: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 16,
    marginBottom: 2,
  },
  activityTime: {
    fontSize: 10.5,
    fontWeight: '600',
    color: '#94A3B8',
  },
  activityDivider: {
    height: 1,
    backgroundColor: '#F8FAFC',
  },
  activityEmptyState: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  activityEmptyTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 2,
  },
  activityEmptySubtitle: {
    fontSize: 12,
    color: '#94A3B8',
  },

  // --- STATE CONTAINERS ---
  errorContainer: {
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 40,
  },
  errorIconBox: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  errorTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 6,
  },
  errorMessage: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
  },
  retryBtn: {
    backgroundColor: '#E25E3E',
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderRadius: 14,
  },
  retryBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  skeletonContainer: {
    gap: 16,
    paddingTop: 8,
  },
});
