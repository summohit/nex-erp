import React, { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Animated,
  Alert,
  Platform,
} from 'react-native';
import AppScreen from '../../components/AppScreen';
import Svg, { Circle, Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import { useAuthStore } from '../../store/authStore';
import { useDashboardStore, getCurrentLocation, requestLocationPermission } from '../../store/dashboardStore';
import { notificationService, AppNotification } from '../../api/notificationService';
import { fieldVisitRequestService, FvDay } from '../../api/fieldVisitRequestService';
import { startJourneyFor, endJourneyFor, flushJourneyPoints } from '../FieldVisit/JourneyPanel';
import { formatElapsed } from '../../utils/haversine';
import { navigateTo } from '../../navigation/navigationUtils';
import FeedbackModal, { ModalType } from '../../components/FeedbackModal';
import LateClockOutModal from '../../components/LateClockOutModal';
import {
  fetchHomeSections,
  HomeSectionsData,
  HomeTask,
  WorkspaceHubSection,
} from './HomeSections';
import { CLOCK_ERROR, clockRefusal } from '../../api/attendanceService';
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
  Sparkles,
} from 'lucide-react-native';

const PulseSkeleton = ({ style }: { style: any }) => {
  const pulseAnim = React.useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.5, duration: 800, useNativeDriver: true }),
      ]),
    ).start();
  }, [pulseAnim]);
  return <Animated.View style={[style, { opacity: pulseAnim, backgroundColor: '#E2E8F0' }]} />;
};

const LiveClock = memo(function LiveClock({ style }: { style?: any }) {
  const [now, setNow] = useState(() =>
    new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }),
  );

  useEffect(() => {
    const tick = () =>
      setNow(new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);

  return <Text style={style}>{now}</Text>;
});

const VisitElapsed = memo(function VisitElapsed({ startTime, style }: { startTime: string; style?: any }) {
  const [elapsed, setElapsed] = useState('00:00:00');

  useEffect(() => {
    const startMs = new Date(startTime).getTime();
    const tick = () => setElapsed(formatElapsed(Math.max(0, Math.floor((Date.now() - startMs) / 1000))));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [startTime]);

  return <Text style={style}>{elapsed}</Text>;
});

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
    return { Icon: FolderKanban, bg: '#f3efff', color: '#6b3fd6' };
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

const IMPRECISE_M = 150;

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

  const [visitDays, setVisitDays] = useState<FvDay[]>([]);
  const [kmRate, setKmRate] = useState<number | null>(null);
  const [fieldBusy, setFieldBusy] = useState(false);

  const loadVisitDays = useCallback(() => {
    fieldVisitRequestService.today().then(setVisitDays).catch(() => setVisitDays([]));
    fieldVisitRequestService
      .travelSettings()
      .then((c) => setKmRate(c.myRatePerKm ?? c.defaultRatePerKm ?? null))
      .catch(() => {});
  }, []);

  const [liveWorkedTime, setLiveWorkedTime] = useState({ hours: 0, minutes: 0 });
  const [timeFilter, setTimeFilter] = useState<'7D' | '30D' | '3M'>('7D');
  const [refreshing, setRefreshing] = useState(false);
  const [feedback, setFeedback] = useState<{
    visible: boolean;
    type: ModalType;
    title: string;
    message: string;
  }>({ visible: false, type: 'success', title: '', message: '' });

  // Sort newest created request first, then prioritize active on-site or active journey visits.
  const sortedVisitDays = useMemo(
    () => [...visitDays].sort((a, b) => (b.request?.id ?? b.id) - (a.request?.id ?? a.id)),
    [visitDays],
  );
  const onSiteDay = sortedVisitDays.find((d) => !!d.clockInTime && !d.clockOutTime) ?? null;
  const activeJourneyDay = sortedVisitDays.find((d) => !!d.journeyStartAt && !d.journeyEndAt) ?? null;
  const upcomingDay = sortedVisitDays.find((d) => !d.clockInTime && !d.clockOutTime) ?? null;
  const visitDay = onSiteDay ?? activeJourneyDay ?? upcomingDay ?? sortedVisitDays[0] ?? null;

  type FieldStage = 'IDLE' | 'READY' | 'EN_ROUTE' | 'ON_SITE' | 'RETURNING' | 'COMPLETED';
  // Mid-journey: send the route recorded so far, as the Field Visits screen does.
  useEffect(() => {
    if (visitDay) flushJourneyPoints(visitDay);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per journey change, not on every refresh
  }, [visitDay?.id, visitDay?.journeyStartAt, visitDay?.journeyEndAt]);

  const fieldStage: FieldStage = useMemo(() => {
    if (!visitDay) return 'IDLE';
    if (visitDay.clockInTime && !visitDay.clockOutTime) return 'ON_SITE';
    if (visitDay.clockOutTime && visitDay.journeyStartAt && !visitDay.journeyEndAt) return 'RETURNING';
    if (visitDay.journeyStartAt && !visitDay.journeyEndAt && !visitDay.clockInTime) return 'EN_ROUTE';
    if (visitDay.clockOutTime) return 'COMPLETED';
    return 'READY';
  }, [visitDay]);

  const handleDashboardJourney = async (action: 'start' | 'end') => {
    if (!visitDay) return;
    setFieldBusy(true);
    try {
      // Same code as the Field Visits screen, so the two never drift apart.
      if (action === 'start') await startJourneyFor(visitDay);
      else await endJourneyFor(visitDay);
      loadVisitDays();
    } catch (e: any) {
      Alert.alert(
        action === 'start' ? 'Could not start journey' : 'Could not end journey',
        e?.response?.data?.message || e?.message || 'Please try again.',
      );
    } finally {
      setFieldBusy(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  useFocusEffect(
    useCallback(() => {
      loadVisitDays();
    }, [loadVisitDays]),
  );

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

  const [homeSections, setHomeSections] = useState<HomeSectionsData>({
    myTasks: [],
    myTickets: [],
    appreciations: [],
  });
  const [homeSectionsLoading, setHomeSectionsLoading] = useState(true);
  const loadHomeSections = async () => {
    try {
      setHomeSections(await fetchHomeSections());
    } catch {
      // Keep existing state
    } finally {
      setHomeSectionsLoading(false);
    }
  };
  useEffect(() => {
    loadHomeSections();
  }, []);

  const openTask = (task: HomeTask) => {
    const projectId = task.projectId ?? task.project?.id;
    if (!projectId) return;
    navigation.navigate('ProjectDetail', { projectId, projectName: task.project?.name });
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchDashboardData(), loadHomeSections(), loadVisitDays()]);
    setRefreshing(false);
  };

  const [lateClockOut, setLateClockOut] = useState<{ visible: boolean; day?: string }>({ visible: false });
  const [outside, setOutside] = useState<{ visible: boolean; direction?: 'in' | 'out'; message?: string }>({
    visible: false,
  });

  const locatePrecisely = async (): Promise<boolean> => {
    if (!(await requestLocationPermission())) {
      setFeedback({
        visible: true,
        type: 'error',
        title: 'Location needed',
        message: 'Allow location for MIRA in your phone settings to clock in.',
      });
      return false;
    }
    for (;;) {
      let fix;
      try {
        fix = await getCurrentLocation();
      } catch {
        setFeedback({
          visible: true,
          type: 'error',
          title: 'No location',
          message: 'Turn on Location (GPS) and try again.',
        });
        return false;
      }
      useDashboardStore.setState({ lastFix: fix });
      if (fix.accuracy <= IMPRECISE_M) return true;
      const off = fix.accuracy >= 1000 ? `${(fix.accuracy / 1000).toFixed(1)} km` : `${Math.round(fix.accuracy)} m`;
      const steps =
        Platform.OS === 'ios'
          ? 'iPhone: Settings → Privacy & Security → Location Services → ON → MIRA → "While Using the App" and turn ON "Precise Location".'
          : 'Android: pull down quick settings and turn Location ON. Then Settings → Location → Location services → Google Location Accuracy → ON. App info → MIRA → Permissions → Location → Allow, with "Use precise location" ON.';
      const choice = await new Promise<'retry' | 'go' | 'stop'>((resolve) =>
        Alert.alert(
          'Your location is not precise',
          `Your phone could only guess your position to within about ${off}, so you may be shown outside the office even when you are inside.\n\n${steps}\n\nStep near a window if you are deep inside the building.`,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve('stop') },
            { text: 'Continue anyway', onPress: () => resolve('go') },
            { text: 'Try again', onPress: () => resolve('retry') },
          ],
        ),
      );
      if (choice === 'go') return true;
      if (choice === 'stop') return false;
    }
  };

  const handleAttendanceToggle = async () => {
    try {
      if (!(await locatePrecisely())) return;
      if (todayAttendance?.clockIn && !todayAttendance?.clockOut) {
        await clockOut(undefined, undefined, undefined, undefined, true);
        setFeedback({
          visible: true,
          type: 'success',
          title: 'Shift Ended',
          message: 'You have clocked out successfully.',
        });
      } else {
        await clockIn(undefined, true);
        setFeedback({
          visible: true,
          type: 'success',
          title: 'Shift Started',
          message: 'You have clocked in successfully.',
        });
      }
    } catch (err: any) {
      const refusal = clockRefusal(err);

      if (refusal.code === CLOCK_ERROR.OUTSIDE_OFFICE) {
        setOutside({ visible: true, direction: refusal.direction, message: refusal.message });
        return;
      }

      if (refusal.code === CLOCK_ERROR.LATE_REASON_REQUIRED) {
        setLateClockOut({ visible: true, day: refusal.openSessionDate });
        return;
      }

      if (refusal.code === CLOCK_ERROR.OPEN_PREVIOUS_SESSION) {
        try {
          await clockOut();
          setFeedback({
            visible: true,
            type: 'success',
            title: 'Previous Shift Closed',
            message: 'Your earlier session has been clocked out. You can start your shift now.',
          });
        } catch (inner: any) {
          const innerRefusal = clockRefusal(inner);
          if (innerRefusal.code === CLOCK_ERROR.LATE_REASON_REQUIRED) {
            setLateClockOut({ visible: true, day: innerRefusal.openSessionDate });
            return;
          }
          setFeedback({
            visible: true,
            type: 'error',
            title: 'Action Failed',
            message: innerRefusal.message || refusal.message || 'Failed to update attendance',
          });
        }
        return;
      }

      setFeedback({
        visible: true,
        type: 'error',
        title: 'Action Failed',
        message: refusal.message || err?.message || 'Failed to update attendance',
      });
    }
  };

  const submitOutside = async (reason: string) => {
    const direction = outside.direction;
    setOutside({ visible: false });
    try {
      if (direction === 'out') await clockOut(undefined, undefined, undefined, reason, true);
      else await clockIn(reason, true);
      setFeedback({
        visible: true,
        type: 'success',
        title: direction === 'out' ? 'Shift Ended' : 'Shift Started',
        message: 'Recorded as outside the office — an administrator will review your reason.',
      });
    } catch (err: any) {
      setFeedback({
        visible: true,
        type: 'error',
        title: 'Action Failed',
        message: clockRefusal(err).message || err?.message || 'Failed to update attendance',
      });
    }
  };

  const submitLateClockOut = async (reason: string) => {
    try {
      await clockOut(undefined, undefined, reason);
      setLateClockOut({ visible: false });
      setFeedback({
        visible: true,
        type: 'success',
        title: 'Shift Ended',
        message: 'Your previous session has been closed.',
      });
    } catch (err: any) {
      setLateClockOut({ visible: false });
      setFeedback({
        visible: true,
        type: 'error',
        title: 'Action Failed',
        message: clockRefusal(err).message || err?.message || 'Failed to clock out',
      });
    }
  };

  const isCheckedIn = !!(todayAttendance?.clockIn && !todayAttendance?.clockOut);

  const handleNotificationPress = async (notification: AppNotification) => {
    if (!notification.isRead) {
      notificationService.markAsRead(notification.id).catch(() => {});
      useDashboardStore.setState((state) => ({
        notifications: state.notifications.map((n) => (n.id === notification.id ? { ...n, isRead: true } : n)),
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

  const { totalLeaveAllocated, totalLeaveUsed, totalLeaveRemaining, leaveProgress } = useMemo(() => {
    const allocated = leaveBalances.reduce((sum, lb) => sum + lb.allocated, 0);
    const used = leaveBalances.reduce((sum, lb) => sum + lb.used, 0);
    return {
      totalLeaveAllocated: allocated,
      totalLeaveUsed: used,
      totalLeaveRemaining: Math.max(0, allocated - used),
      leaveProgress: allocated > 0 ? (used / allocated) * 100 : 0,
    };
  }, [leaveBalances]);

  const { activeProjectsCount, completedProjectsCount } = useMemo(
    () => ({
      activeProjectsCount: projects.filter((p) => p.status !== 'ARCHIVED').length,
      completedProjectsCount: projects.filter((p) => p.status === 'COMPLETED').length,
    }),
    [projects],
  );

  const currentHour = new Date().getHours();
  const greeting = currentHour < 12 ? 'Good morning' : currentHour < 17 ? 'Good afternoon' : 'Good evening';

  const displayName = useMemo(() => {
    const cleanLastName = (profile?.lastName || '').trim() === '.' ? '' : (profile?.lastName || '').trim();
    return profile
      ? [profile.firstName?.trim(), cleanLastName].filter(Boolean).join(' ')
      : user?.email?.split('@')[0] || 'Employee';
  }, [profile, user?.email]);

  // Weekly attendance chart data + period average (supports 7D / 30D / 3M)
  const { data: chartData, avgHours, daysLoggedInPeriod } = useMemo(() => {
    const data = [
      { day: 'M', label: 'Mon', pct: 0, hours: 0 },
      { day: 'T', label: 'Tue', pct: 0, hours: 0 },
      { day: 'W', label: 'Wed', pct: 0, hours: 0 },
      { day: 'T', label: 'Thu', pct: 0, hours: 0 },
      { day: 'F', label: 'Fri', pct: 0, hours: 0 },
      { day: 'S', label: 'Sat', pct: 0, hours: 0 },
      { day: 'S', label: 'Sun', pct: 0, hours: 0 },
    ];

    if (!attendanceHistory || attendanceHistory.length === 0) {
      return { data, avgHours: 0, daysLoggedInPeriod: 0 };
    }

    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - ((now.getDay() + 6) % 7)); // Monday
    startOfWeek.setHours(0, 0, 0, 0);

    const periodCutoff = new Date(now);
    const daysBack = timeFilter === '7D' ? 7 : timeFilter === '30D' ? 30 : 90;
    periodCutoff.setDate(now.getDate() - daysBack);
    periodCutoff.setHours(0, 0, 0, 0);

    let totalHoursPeriod = 0;
    let workDaysCount = 0;

    attendanceHistory.forEach((record) => {
      const recordDate = new Date(record.date);
      if (recordDate >= startOfWeek) {
        const dayIndex = recordDate.getDay();
        const mappedIndex = dayIndex === 0 ? 6 : dayIndex - 1;
        if (mappedIndex >= 0 && mappedIndex < 7) {
          const pct = Math.min(100, Math.round((record.totalHours / 10) * 100));
          data[mappedIndex].pct = pct;
          data[mappedIndex].hours = record.totalHours;
        }
      }
      if (recordDate >= periodCutoff && record.totalHours > 0) {
        totalHoursPeriod += record.totalHours;
        workDaysCount++;
      }
    });

    const avg = workDaysCount > 0 ? totalHoursPeriod / workDaysCount : 0;
    return { data, avgHours: avg, daysLoggedInPeriod: workDaysCount };
  }, [attendanceHistory, timeFilter]);

  const todayDayIndex = (new Date().getDay() + 6) % 7; // Monday = 0
  const targetHours = 8.5;
  const workedTodayHours = todayAttendance?.totalHours || liveWorkedTime.hours + liveWorkedTime.minutes / 60;
  const progressRatio = Math.min(workedTodayHours / targetHours, 1);
  const progressPct = Math.round(progressRatio * 100);
  const trendVsAvg = avgHours > 0 ? ((workedTodayHours - avgHours) / avgHours) * 100 : 0;
  const trendColor = trendVsAvg >= 0 ? '#10B981' : '#1373e5';
  const trendBg = trendVsAvg >= 0 ? '#ECFDF5' : '#EFF6FF';

  // Split field visit location into clean 1-line title + 1-line subtitle
  const [visitSiteTitle, visitSiteSub] = useMemo(() => {
    const raw = (visitDay?.request?.location || '').trim();
    const parts = raw.split(/\s+[–—-]\s+/);
    if (parts.length > 1) {
      return [parts[0].trim(), parts.slice(1).join(' · ').trim()];
    }
    return [raw, ''];
  }, [visitDay?.request?.location]);

  // Render the Smart Field Operations Island
  const renderFieldOperationsIsland = () => {
    const steps = [
      { key: 'EN_ROUTE', label: 'Journey', done: !!(visitDay?.journeyStartAt || visitDay?.clockInTime) },
      { key: 'ON_SITE', label: 'On Site', done: !!visitDay?.clockInTime },
      { key: 'RETURNING', label: 'Site Out', done: !!visitDay?.clockOutTime },
      { key: 'COMPLETED', label: 'Done', done: !!(visitDay?.clockOutTime && (!visitDay?.journeyStartAt || visitDay?.journeyEndAt)) },
    ];

    return (
      <View style={styles.sectionBlock}>
        <View style={styles.sectionHeadingRow}>
          <View style={styles.sectionHeadingLeft}>
            <Text style={styles.sectionHeading}>Field Operations</Text>
            {visitDay && (
              <View style={styles.liveCountPill}>
                <Text style={styles.liveCountPillText}>{ sortedVisitDays.length } Today</Text>
              </View>
            )}
          </View>
          <TouchableOpacity activeOpacity={0.7} onPress={() => safeNavigate('FieldVisit')}>
            <Text style={styles.viewAllBtnText}>Open Visits</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          activeOpacity={0.92}
          style={[
            styles.fieldCard,
            (fieldStage === 'EN_ROUTE' || fieldStage === 'RETURNING') && styles.fieldCardJourneyBorder,
            fieldStage === 'ON_SITE' && styles.fieldCardOnSiteBorder,
          ]}
          onPress={() => safeNavigate('FieldVisit')}
        >
          <View style={styles.fieldCardHeader}>
            <View style={styles.fieldTitleGroup}>
              <View
                style={[
                  styles.fieldBadge,
                  (fieldStage === 'ON_SITE' || fieldStage === 'COMPLETED') && styles.fieldBadgeActive,
                  (fieldStage === 'EN_ROUTE' || fieldStage === 'RETURNING') && styles.fieldBadgeJourney,
                ]}
              >
                <Navigation
                  size={13}
                  color={
                    fieldStage === 'ON_SITE' || fieldStage === 'COMPLETED'
                      ? '#16A34A'
                      : fieldStage === 'EN_ROUTE' || fieldStage === 'RETURNING'
                        ? '#1D4ED8'
                        : '#64748B'
                  }
                  strokeWidth={2.3}
                />
                <Text
                  style={[
                    styles.fieldBadgeText,
                    (fieldStage === 'ON_SITE' || fieldStage === 'COMPLETED') && styles.fieldBadgeTextActive,
                    (fieldStage === 'EN_ROUTE' || fieldStage === 'RETURNING') && styles.fieldBadgeTextJourney,
                  ]}
                >
                  {fieldStage === 'ON_SITE'
                    ? 'ON SITE'
                    : fieldStage === 'EN_ROUTE'
                      ? 'EN ROUTE · GPS'
                      : fieldStage === 'RETURNING'
                        ? 'RETURN JOURNEY'
                        : fieldStage === 'COMPLETED'
                          ? 'COMPLETED'
                          : visitDay
                            ? 'SCHEDULED TODAY'
                            : 'STANDBY'}
                </Text>
              </View>
            </View>
            {visitDay ? (
              <Text style={styles.fieldRequestTag}>{visitDay.request.requestNumber}</Text>
            ) : (
              <View style={[styles.fieldStatusDotWrap, styles.fieldDotIdle]} />
            )}
          </View>

          {visitDay ? (
            <>
              {/* 4-Stage Visual Progress Bar */}
              <View style={styles.stepperRow}>
                {steps.map((s, idx) => (
                  <React.Fragment key={s.key}>
                    <View style={styles.stepperItem}>
                      <View style={[styles.stepperDot, s.done && styles.stepperDotDone]}>
                        {s.done && <View style={styles.stepperDotInner} />}
                      </View>
                      <Text style={[styles.stepperLabel, s.done && styles.stepperLabelDone]}>{s.label}</Text>
                    </View>
                    {idx < steps.length - 1 && (
                      <View style={[styles.stepperLine, s.done && styles.stepperLineDone]} />
                    )}
                  </React.Fragment>
                ))}
              </View>

              {/* Site & Project Info Box */}
              <View style={styles.fieldSiteBox}>
                <View style={styles.fieldProjectInlineRow}>
                  <View style={[styles.fieldProjectDot, { backgroundColor: '#2563EB' }]} />
                  <Text style={styles.fieldProjectName} numberOfLines={1}>
                    {visitDay.request.project?.name || 'General field visit'}
                  </Text>
                  {visitDay.request.travelZone === 'DELHI_NCR' && (
                    <View style={styles.fieldRatePill}>
                      <Text style={styles.fieldRatePillText}>Delhi NCR{kmRate != null ? ` · ₹${kmRate}/km` : ''}</Text>
                    </View>
                  )}
                </View>

                <Text style={styles.fieldSiteTitle} numberOfLines={1}>
                  {visitSiteTitle || visitDay.request.location}
                </Text>
                {visitSiteSub ? (
                  <Text style={styles.fieldSiteSubtitle} numberOfLines={1}>
                    {visitSiteSub}
                  </Text>
                ) : null}
              </View>

              {/* Live Metrics Strip */}
              <View style={styles.fieldLiveMetricsRow}>
                <View style={styles.fieldLiveMetricItem}>
                  <Clock size={14} color="#1373e5" strokeWidth={2.2} />
                  {fieldStage === 'ON_SITE' && visitDay.clockInTime ? (
                    <VisitElapsed startTime={visitDay.clockInTime} style={styles.fieldLiveValue} />
                  ) : (fieldStage === 'EN_ROUTE' || fieldStage === 'RETURNING') && visitDay.journeyStartAt ? (
                    <Text style={styles.fieldLiveValue}>
                      {new Date(visitDay.journeyStartAt).toLocaleTimeString('en-IN', {
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone: 'Asia/Kolkata',
                      })}
                    </Text>
                  ) : (
                    <Text style={styles.fieldLiveValue}>
                      {visitDay.request.startTime}–{visitDay.request.endTime}
                    </Text>
                  )}
                  <Text style={styles.fieldLiveLabel}>
                    {fieldStage === 'ON_SITE'
                      ? 'Elapsed on site'
                      : fieldStage === 'EN_ROUTE' || fieldStage === 'RETURNING'
                        ? 'Journey started'
                        : 'Visit window'}
                  </Text>
                </View>

                <View style={styles.fieldLiveDivider} />

                <View style={styles.fieldLiveMetricItem}>
                  <MapPin size={14} color="#2563EB" strokeWidth={2.2} />
                  <Text style={styles.fieldLiveValue}>
                    {fieldStage === 'ON_SITE' && visitDay.clockInTime
                      ? new Date(visitDay.clockInTime).toLocaleTimeString('en-IN', {
                          hour: '2-digit',
                          minute: '2-digit',
                          timeZone: 'Asia/Kolkata',
                        })
                      : fieldStage === 'EN_ROUTE' || fieldStage === 'RETURNING'
                        ? 'In progress'
                        : visitDay.journeyTrackedKm != null
                        ? `${visitDay.journeyTrackedKm.toFixed(1)} km`
                        : visitDay.clockOutTime
                          ? 'Site Done'
                          : 'Ready'}
                  </Text>
                  <Text style={styles.fieldLiveLabel}>
                    {fieldStage === 'ON_SITE'
                      ? 'Clocked in at'
                      : fieldStage === 'EN_ROUTE' || fieldStage === 'RETURNING'
                        ? 'Journey'
                        : visitDay.journeyTrackedKm != null
                        ? 'Tracked distance'
                        : 'Site status'}
                  </Text>
                </View>
              </View>

              {/* Stage-aware Action Buttons */}
              {fieldStage === 'READY' && visitDay.request.travelZone === 'DELHI_NCR' ? (
                <View style={styles.fieldDualBtnRow}>
                  <TouchableOpacity
                    style={[styles.fieldActiveActionBtn, { flex: 1 }]}
                    activeOpacity={0.85}
                    disabled={fieldBusy}
                    onPress={() => handleDashboardJourney('start')}
                  >
                    {fieldBusy ? (
                      <ActivityIndicator color="#FFFFFF" size="small" />
                    ) : (
                      <>
                        <Navigation size={15} color="#FFFFFF" strokeWidth={2.3} style={{ marginRight: 6 }} />
                        <Text style={styles.fieldActiveActionText}>Start journey</Text>
                      </>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.fieldSecondaryActionBtn}
                    activeOpacity={0.85}
                    onPress={() => safeNavigate('FieldVisit')}
                  >
                    <MapPin size={15} color="#1E3A8A" strokeWidth={2.2} style={{ marginRight: 5 }} />
                    <Text style={styles.fieldSecondaryActionText}>Clock in</Text>
                  </TouchableOpacity>
                </View>
              ) : fieldStage === 'EN_ROUTE' ? (
                <View style={styles.fieldDualBtnRow}>
                  <TouchableOpacity
                    style={[styles.fieldActiveActionBtn, { flex: 1, backgroundColor: '#16A34A', shadowColor: '#16A34A' }]}
                    activeOpacity={0.85}
                    onPress={() => safeNavigate('FieldVisit')}
                  >
                    <MapPin size={15} color="#FFFFFF" strokeWidth={2.3} style={{ marginRight: 6 }} />
                    <Text style={styles.fieldActiveActionText}>Clock in at site</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.fieldSecondaryActionBtn}
                    activeOpacity={0.85}
                    disabled={fieldBusy}
                    onPress={() => handleDashboardJourney('end')}
                  >
                    {fieldBusy ? (
                      <ActivityIndicator color="#1E3A8A" size="small" />
                    ) : (
                      <Text style={styles.fieldSecondaryActionText}>End journey</Text>
                    )}
                  </TouchableOpacity>
                </View>
              ) : fieldStage === 'ON_SITE' ? (
                <TouchableOpacity
                  style={[styles.fieldActiveActionBtn, { backgroundColor: '#DC2626', shadowColor: '#DC2626' }]}
                  activeOpacity={0.85}
                  onPress={() => safeNavigate('FieldVisit')}
                >
                  <MapPin size={16} color="#FFFFFF" strokeWidth={2.3} style={{ marginRight: 6 }} />
                  <Text style={styles.fieldActiveActionText}>Clock out at site</Text>
                </TouchableOpacity>
              ) : fieldStage === 'RETURNING' ? (
                <TouchableOpacity
                  style={styles.fieldActiveActionBtn}
                  activeOpacity={0.85}
                  disabled={fieldBusy}
                  onPress={() => handleDashboardJourney('end')}
                >
                  {fieldBusy ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <>
                      <MapPin size={16} color="#FFFFFF" strokeWidth={2.3} style={{ marginRight: 6 }} />
                      <Text style={styles.fieldActiveActionText}>End journey</Text>
                    </>
                  )}
                </TouchableOpacity>
              ) : fieldStage === 'COMPLETED' ? (
                <View style={styles.fieldCompletedBanner}>
                  <CheckCircle2 size={15} color="#15803D" strokeWidth={2.3} />
                  <Text style={styles.fieldCompletedBannerText}>Visit & journey completed for today</Text>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.fieldActiveActionBtn}
                  activeOpacity={0.85}
                  onPress={() => safeNavigate('FieldVisit')}
                >
                  <MapPin size={16} color="#FFFFFF" strokeWidth={2.3} style={{ marginRight: 6 }} />
                  <Text style={styles.fieldActiveActionText}>Clock in at site</Text>
                </TouchableOpacity>
              )}
            </>
          ) : (
            <View style={styles.fieldIdleRow}>
              <Text style={styles.fieldIdleDescription}>
                No field visit scheduled today. Tap to request or view past visits.
              </Text>
              <View style={styles.fieldStartBtn}>
                <Navigation size={14} color="#FFFFFF" strokeWidth={2.4} style={{ marginRight: 5 }} />
                <Text style={styles.fieldStartBtnText}>Visits</Text>
              </View>
            </View>
          )}
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <AppScreen showBottomNav={false} title={displayName} subtitle={greeting}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#1373e5']} />}
      >
        {error ? (
          <View style={styles.errorContainer}>
            <View style={styles.errorIconBox}>
              <X color="#1373e5" size={32} strokeWidth={2.5} />
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
            <PulseSkeleton style={{ height: 230, borderRadius: 26, width: '100%' }} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <PulseSkeleton style={{ height: 84, borderRadius: 18, flex: 1 }} />
              <PulseSkeleton style={{ height: 84, borderRadius: 18, flex: 1 }} />
              <PulseSkeleton style={{ height: 84, borderRadius: 18, flex: 1 }} />
              <PulseSkeleton style={{ height: 84, borderRadius: 18, flex: 1 }} />
            </View>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <PulseSkeleton style={{ height: 135, borderRadius: 22, flex: 1 }} />
              <PulseSkeleton style={{ height: 135, borderRadius: 22, flex: 1 }} />
            </View>
            <PulseSkeleton style={{ height: 220, borderRadius: 24, width: '100%' }} />
          </View>
        ) : (
          <>
            {/* 1. EXECUTIVE GRADIENT SHIFT & ATTENDANCE COMMAND HERO */}
            <View style={styles.heroAttendanceCard}>
              <Svg height="100%" width="100%" style={StyleSheet.absoluteFill}>
                <Defs>
                  <LinearGradient id="heroShiftGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <Stop offset="0%" stopColor={isCheckedIn ? '#064E3B' : '#0F172A'} />
                    <Stop offset="52%" stopColor={isCheckedIn ? '#0F3E47' : '#1E3A8A'} />
                    <Stop offset="100%" stopColor={isCheckedIn ? '#1D4ED8' : '#1373E5'} />
                  </LinearGradient>
                </Defs>
                <Rect x="0" y="0" width="100%" height="100%" fill="url(#heroShiftGrad)" />
                <Circle cx="92%" cy="14%" r="105" fill="#FFFFFF" fillOpacity="0.07" />
                <Circle cx="10%" cy="95%" r="80" fill="#38BDF8" fillOpacity="0.08" />
              </Svg>

              <View style={styles.heroInnerPad}>
                {/* Status Pill & Date Header */}
                <View style={styles.heroHeaderRow}>
                  <View
                    style={[
                      styles.heroShiftBadge,
                      isCheckedIn ? styles.heroShiftBadgeActive : styles.heroShiftBadgeIdle,
                    ]}
                  >
                    <View
                      style={[
                        styles.heroStatusDot,
                        isCheckedIn ? styles.heroStatusDotActive : styles.heroStatusDotIdle,
                      ]}
                    />
                    <Text style={styles.heroShiftBadgeText}>
                      {isCheckedIn ? 'ACTIVE SHIFT' : 'OFF SHIFT'}
                    </Text>
                  </View>

                  <View style={styles.heroDateChip}>
                    <CalendarDays size={13} color="#BAE6FD" strokeWidth={2.2} />
                    <Text style={styles.heroDateText}>
                      {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                    </Text>
                  </View>
                </View>

                {/* Live Clock & Luminous Circular Ring */}
                <View style={styles.heroCenterRow}>
                  <View style={styles.heroTimeCol}>
                    <LiveClock style={styles.heroTimeClock} />
                    <Text style={styles.heroTargetSubtitle}>
                      {todayAttendance?.clockIn
                        ? `Clocked in at ${new Date(todayAttendance.clockIn).toLocaleTimeString('en-US', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}`
                        : 'Standard shift target · 8h 30m'}
                    </Text>
                  </View>

                  <View style={styles.heroRingWrapper}>
                    <Svg width="74" height="74" viewBox="0 0 74 74">
                      <Circle
                        cx="37"
                        cy="37"
                        r="30"
                        stroke="rgba(255,255,255,0.16)"
                        strokeWidth="6"
                        fill="none"
                      />
                      <Circle
                        cx="37"
                        cy="37"
                        r="30"
                        stroke={isCheckedIn ? '#34D399' : '#38BDF8'}
                        strokeWidth="6"
                        fill="none"
                        strokeDasharray={`${2 * Math.PI * 30}`}
                        strokeDashoffset={`${2 * Math.PI * 30 * (1 - progressRatio)}`}
                        strokeLinecap="round"
                        rotation="-90"
                        origin="37, 37"
                      />
                    </Svg>
                    <View style={styles.heroRingCenterContent}>
                      <Text style={styles.heroRingMainText}>{progressPct}%</Text>
                      <Text style={styles.heroRingSubText}>Goal</Text>
                    </View>
                  </View>
                </View>

                {/* 3-Column Glassmorphic Shift Strip */}
                <View style={styles.heroGlassStrip}>
                  <View style={styles.heroGlassMetric}>
                    <Text style={styles.heroGlassLabel}>CLOCK IN</Text>
                    <Text style={styles.heroGlassValue}>
                      {todayAttendance?.clockIn
                        ? new Date(todayAttendance.clockIn).toLocaleTimeString('en-US', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : '--:--'}
                    </Text>
                  </View>
                  <View style={styles.heroGlassDivider} />
                  <View style={styles.heroGlassMetric}>
                    <Text style={styles.heroGlassLabel}>WORKED</Text>
                    <Text style={styles.heroGlassValue}>
                      {liveWorkedTime.hours}h {liveWorkedTime.minutes}m
                    </Text>
                  </View>
                  <View style={styles.heroGlassDivider} />
                  <View style={styles.heroGlassMetric}>
                    <Text style={styles.heroGlassLabel}>TARGET</Text>
                    <Text style={styles.heroGlassValue}>8h 30m</Text>
                  </View>
                </View>

                {/* Tactile Action Button */}
                <TouchableOpacity
                  style={[
                    styles.heroPunchBtn,
                    isCheckedIn ? styles.heroPunchBtnOut : styles.heroPunchBtnIn,
                    isClockingIn && { opacity: 0.78 },
                  ]}
                  activeOpacity={0.85}
                  onPress={handleAttendanceToggle}
                  disabled={isClockingIn}
                >
                  {isClockingIn ? (
                    <ActivityIndicator
                      size="small"
                      color={isCheckedIn ? '#FFFFFF' : '#0F172A'}
                      style={{ marginRight: 8 }}
                    />
                  ) : isCheckedIn ? (
                    <Square size={15} color="#FFFFFF" fill="#FFFFFF" style={{ marginRight: 8 }} />
                  ) : (
                    <Play size={15} color="#0F172A" fill="#0F172A" style={{ marginRight: 8 }} />
                  )}
                  <Text
                    style={[
                      styles.heroPunchBtnText,
                      isCheckedIn ? styles.heroPunchBtnTextOut : styles.heroPunchBtnTextIn,
                    ]}
                  >
                    {isClockingIn
                      ? 'Updating Status…'
                      : isCheckedIn
                        ? 'End Shift · Clock Out'
                        : 'Clock In for Today'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* 2. PROMOTED FIELD OPERATIONS ISLAND (When user has a visit today) */}
            {visitDay && renderFieldOperationsIsland()}

            {/* 3. QUICK ACTIONS DOCK */}
            <View style={styles.sectionHeadingRow}>
              <Text style={styles.sectionHeading}>Quick Actions</Text>
            </View>
            <View style={styles.quickGrid}>
              <TouchableOpacity
                style={styles.quickTile}
                activeOpacity={0.75}
                onPress={() => safeNavigate('Leaves')}
              >
                <View style={[styles.quickTileIcon, { backgroundColor: '#EFF6FF' }]}>
                  <CalendarDays size={21} color="#1373e5" strokeWidth={2.2} />
                </View>
                <Text style={styles.quickTileLabel}>Leaves</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.quickTile}
                activeOpacity={0.75}
                onPress={() => safeNavigate('Attendance')}
              >
                <View style={[styles.quickTileIcon, { backgroundColor: '#ECFDF5' }]}>
                  <CalendarClock size={21} color="#059669" strokeWidth={2.2} />
                </View>
                <Text style={styles.quickTileLabel}>Timesheet</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.quickTile}
                activeOpacity={0.75}
                onPress={() => safeNavigate('Expenses')}
              >
                <View style={[styles.quickTileIcon, { backgroundColor: '#EEF2FF' }]}>
                  <Receipt size={21} color="#4F46E5" strokeWidth={2.2} />
                </View>
                <Text style={styles.quickTileLabel}>Expense</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.quickTile}
                activeOpacity={0.75}
                onPress={() => safeNavigate('FieldVisit')}
              >
                <View style={[styles.quickTileIcon, { backgroundColor: '#FAF5FF' }]}>
                  <MapPin size={21} color="#9333EA" strokeWidth={2.2} />
                </View>
                <Text style={styles.quickTileLabel}>Field Visit</Text>
              </TouchableOpacity>
            </View>

            {/* 4. EXECUTIVE BENTO GRID (LEAVE & PROJECTS) */}
            <View style={styles.sectionHeadingRow}>
              <Text style={styles.sectionHeading}>Overview</Text>
              <TouchableOpacity activeOpacity={0.7} onPress={() => safeNavigate('Projects')}>
                <Text style={styles.viewAllBtnText}>All Projects</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.bentoGrid}>
              {/* Card A: Leave Balance */}
              <TouchableOpacity
                style={styles.bentoCard}
                activeOpacity={0.82}
                onPress={() => safeNavigate('Leaves')}
              >
                <View style={[styles.bentoCornerGlow, { backgroundColor: '#ECFDF5' }]} />
                <View style={styles.bentoHeader}>
                  <View style={[styles.bentoIconBadge, { backgroundColor: '#ECFDF5' }]}>
                    <CalendarDays size={18} color="#059669" strokeWidth={2.2} />
                  </View>
                  <View style={[styles.bentoPill, { backgroundColor: '#ECFDF5' }]}>
                    <Text style={[styles.bentoPillText, { color: '#059669' }]}>
                      {totalLeaveUsed}/{totalLeaveAllocated} used
                    </Text>
                  </View>
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
                      { width: `${Math.min(100 - leaveProgress, 100)}%` },
                    ]}
                  />
                </View>
              </TouchableOpacity>

              {/* Card B: Active Projects */}
              <TouchableOpacity
                style={styles.bentoCard}
                activeOpacity={0.82}
                onPress={() => safeNavigate('Projects')}
              >
                <View style={[styles.bentoCornerGlow, { backgroundColor: '#F3EFFF' }]} />
                <View style={styles.bentoHeader}>
                  <View style={[styles.bentoIconBadge, { backgroundColor: '#F3EFFF' }]}>
                    <FolderKanban size={18} color="#6B3FD6" strokeWidth={2.2} />
                  </View>
                  <View style={styles.bentoPill}>
                    <Text style={styles.bentoPillText}>{completedProjectsCount} Done</Text>
                  </View>
                </View>
                <View style={styles.bentoValueRow}>
                  <Text style={styles.bentoValue}>{activeProjectsCount}</Text>
                  <Text style={styles.bentoUnit}>active</Text>
                </View>
                <Text style={styles.bentoTitle}>Project Pipeline</Text>
                <View style={styles.bentoProgressTrack}>
                  <View
                    style={[
                      styles.bentoProgressFill,
                      {
                        backgroundColor: '#6B3FD6',
                        width:
                          projects.length > 0
                            ? `${Math.max(12, Math.min((completedProjectsCount / projects.length) * 100, 100))}%`
                            : '15%',
                      },
                    ]}
                  />
                </View>
              </TouchableOpacity>
            </View>

            {/* 5. UNIFIED WORKSPACE HUB (TASKS · TICKETS · KUDOS) */}
            <View style={styles.sectionHeadingRow}>
              <View style={styles.sectionHeadingLeft}>
                <Sparkles size={15} color="#1373e5" strokeWidth={2.3} />
                <Text style={styles.sectionHeading}>My Workspace</Text>
              </View>
            </View>
            <WorkspaceHubSection
              data={homeSections}
              loading={homeSectionsLoading}
              onOpenTask={openTask}
              onViewTasks={() => safeNavigate('Projects')}
              onViewTickets={() => safeNavigate('Tickets')}
            />

            {/* 6. WORKING HOURS / ATTENDANCE RHYTHM CHART */}
            <View style={styles.chartCard}>
              <View style={styles.chartCardHeader}>
                <View>
                  <Text style={styles.chartCardTitle}>Working Hours</Text>
                  <Text style={styles.chartCardSubtitle}>
                    {daysLoggedInPeriod} active {daysLoggedInPeriod === 1 ? 'day' : 'days'} in period
                  </Text>
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
                    const displayHours = isToday && item.hours === 0 ? workedTodayHours : item.hours;
                    const displayPct = Math.min(100, Math.round((displayHours / 10) * 100));
                    return (
                      <View key={index} style={styles.barColumn}>
                        <Text style={[styles.barHoursCaption, isToday && styles.barHoursCaptionToday]}>
                          {displayHours > 0 ? `${displayHours.toFixed(1)}h` : ''}
                        </Text>
                        <View style={[styles.barTrack, isToday && styles.barTrackToday]}>
                          <View
                            style={[
                              styles.barFill,
                              { height: `${Math.max(displayPct, 6)}%` },
                              isToday
                                ? styles.barFillToday
                                : displayHours >= 8
                                  ? styles.barFillMet
                                  : styles.barFillOther,
                            ]}
                          />
                        </View>
                        <Text style={[styles.barLabel, isToday && styles.barLabelToday]}>{item.day}</Text>
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
                  <Text style={styles.chartAvgLabel}>Daily avg ({timeFilter})</Text>
                </View>
                <View style={[styles.chartTrendBadge, { backgroundColor: trendBg }]}>
                  <ArrowUp
                    size={13}
                    color={trendColor}
                    strokeWidth={2.5}
                    style={{ transform: [{ rotate: trendVsAvg >= 0 ? '0deg' : '180deg' }] }}
                  />
                  <Text style={[styles.chartTrendText, { color: trendColor }]}>
                    {' '}
                    {Math.abs(trendVsAvg).toFixed(1)}% vs avg
                  </Text>
                </View>
              </View>
            </View>

            {/* IF NO VISIT TODAY, SHOW COMPACT FIELD OPERATIONS CARD BELOW CHART */}
            {!visitDay && renderFieldOperationsIsland()}

            {/* 7. RECENT ACTIVITY TIMELINE FEED */}
            <View style={styles.sectionHeadingRow}>
              <Text style={styles.sectionHeading}>Recent Activity</Text>
              <TouchableOpacity activeOpacity={0.7} onPress={() => safeNavigate('Notifications')}>
                <Text style={styles.viewAllBtnText}>View all</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.activityCard}>
              {notifications.length > 0 ? (
                notifications.slice(0, 4).map((notification, index) => {
                  const { Icon: ActionIcon, bg: iconBg, color: iconColor } = getNotificationIcon(
                    notification.title,
                    notification.message,
                  );
                  return (
                    <React.Fragment key={notification.id}>
                      <TouchableOpacity
                        style={[styles.activityItem, !notification.isRead && styles.activityItemUnread]}
                        activeOpacity={0.7}
                        onPress={() => handleNotificationPress(notification)}
                      >
                        <View style={[styles.activityIconBox, { backgroundColor: iconBg }]}>
                          <ActionIcon size={18} color={iconColor} strokeWidth={2.2} />
                          {!notification.isRead && <View style={styles.activityUnreadDot} />}
                        </View>
                        <View style={styles.activityContentCol}>
                          <Text
                            style={[styles.activityTitle, !notification.isRead && styles.activityTitleBold]}
                            numberOfLines={1}
                          >
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
        onClose={() => setFeedback((prev) => ({ ...prev, visible: false }))}
      />

      <LateClockOutModal
        visible={outside.visible}
        submitting={isClockingIn}
        title="Outside the office"
        message={`${outside.message || 'You are outside the office radius.'}`}
        placeholder="e.g. At the client site for a meeting"
        onCancel={() => setOutside({ visible: false })}
        onSubmit={submitOutside}
      />

      <LateClockOutModal
        visible={lateClockOut.visible}
        day={lateClockOut.day}
        submitting={isClockingIn}
        onCancel={() => setLateClockOut({ visible: false })}
        onSubmit={submitLateClockOut}
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 92,
  },
  sectionBlock: {
    marginBottom: 4,
  },

  // --- 1. EXECUTIVE GRADIENT SHIFT HERO ---
  heroAttendanceCard: {
    borderRadius: 26,
    marginBottom: 20,
    position: 'relative',
    overflow: 'hidden',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 6,
  },
  heroInnerPad: {
    padding: 20,
  },
  heroHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  heroShiftBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    gap: 6,
  },
  heroShiftBadgeActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.22)',
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.45)',
  },
  heroShiftBadgeIdle: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  heroStatusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  heroStatusDotActive: {
    backgroundColor: '#34D399',
  },
  heroStatusDotIdle: {
    backgroundColor: '#FBBF24',
  },
  heroShiftBadgeText: {
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.7,
    color: '#FFFFFF',
  },
  heroDateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 10,
    paddingVertical: 4.5,
    borderRadius: 12,
  },
  heroDateText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#E0F2FE',
  },
  heroCenterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  heroTimeCol: {
    flex: 1,
    paddingRight: 12,
  },
  heroTimeClock: {
    fontSize: 28,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -0.6,
    fontVariant: ['tabular-nums'],
    marginBottom: 4,
  },
  heroTargetSubtitle: {
    fontSize: 12.5,
    fontWeight: '500',
    color: 'rgba(224, 242, 254, 0.82)',
    lineHeight: 17,
  },
  heroRingWrapper: {
    width: 74,
    height: 74,
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
    fontSize: 13,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  heroRingSubText: {
    fontSize: 8.5,
    fontWeight: '700',
    color: '#BAE6FD',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  heroGlassStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 14,
  },
  heroGlassMetric: {
    flex: 1,
    alignItems: 'center',
  },
  heroGlassDivider: {
    width: 1,
    height: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
  },
  heroGlassLabel: {
    fontSize: 9.5,
    fontWeight: '700',
    color: 'rgba(186, 230, 253, 0.8)',
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  heroGlassValue: {
    fontSize: 13.5,
    fontWeight: '800',
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
  },
  heroPunchBtn: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 13.5,
    borderRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 3,
  },
  heroPunchBtnIn: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
  },
  heroPunchBtnOut: {
    backgroundColor: '#EF4444',
    shadowColor: '#EF4444',
  },
  heroPunchBtnText: {
    fontWeight: '800',
    fontSize: 14.5,
    letterSpacing: 0.2,
  },
  heroPunchBtnTextIn: {
    color: '#0F172A',
  },
  heroPunchBtnTextOut: {
    color: '#FFFFFF',
  },

  // --- SECTION HEADINGS ---
  sectionHeadingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 11,
    paddingHorizontal: 2,
  },
  sectionHeadingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionHeading: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.2,
  },
  liveCountPill: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  liveCountPillText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#1D4ED8',
  },
  viewAllBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1373e5',
  },

  // --- QUICK ACTIONS DOCK ---
  quickGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  quickTile: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
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
    marginBottom: 7,
  },
  quickTileLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1E293B',
  },

  // --- EXECUTIVE BENTO CARDS ---
  bentoGrid: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  bentoCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 16,
    position: 'relative',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  bentoCornerGlow: {
    position: 'absolute',
    top: -28,
    right: -28,
    width: 80,
    height: 80,
    borderRadius: 40,
    opacity: 0.6,
  },
  bentoHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  bentoIconBadge: {
    width: 38,
    height: 38,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bentoPill: {
    backgroundColor: '#F3EFFF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  bentoPillText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#6B3FD6',
  },
  bentoValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 5,
    marginBottom: 2,
  },
  bentoValue: {
    fontSize: 27,
    fontWeight: '900',
    color: '#0F172A',
    letterSpacing: -0.5,
    fontVariant: ['tabular-nums'],
  },
  bentoUnit: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  bentoTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 10,
  },
  bentoProgressTrack: {
    height: 6,
    backgroundColor: '#F1F5F9',
    borderRadius: 3,
    overflow: 'hidden',
  },
  bentoProgressFill: {
    height: '100%',
    backgroundColor: '#10B981',
    borderRadius: 3,
  },

  // --- WORKING HOURS CHART ---
  chartCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 18,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 2,
  },
  chartCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
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
    paddingHorizontal: 10,
    paddingVertical: 4.5,
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
    color: '#64748B',
  },
  periodTabTextActive: {
    color: '#0F172A',
    fontWeight: '800',
  },
  chartBody: {
    height: 146,
    justifyContent: 'flex-end',
    position: 'relative',
    marginBottom: 14,
  },
  chartGridLines: {
    position: 'absolute',
    top: 16,
    bottom: 24,
    left: 0,
    right: 0,
    justifyContent: 'space-between',
  },
  chartGridLine: {
    height: 1,
    backgroundColor: '#F1F5F9',
  },
  barsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: '100%',
    paddingHorizontal: 4,
  },
  barColumn: {
    alignItems: 'center',
    height: '100%',
    justifyContent: 'flex-end',
    flex: 1,
  },
  barHoursCaption: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#94A3B8',
    marginBottom: 4,
    height: 13,
  },
  barHoursCaptionToday: {
    color: '#1373e5',
    fontWeight: '800',
  },
  barTrack: {
    height: 100,
    width: 22,
    backgroundColor: '#F8FAFC',
    borderRadius: 11,
    justifyContent: 'flex-end',
    alignItems: 'center',
    overflow: 'hidden',
  },
  barTrackToday: {
    backgroundColor: '#EFF6FF',
  },
  barFill: {
    width: 22,
    borderRadius: 11,
  },
  barFillToday: {
    backgroundColor: '#1373e5',
  },
  barFillMet: {
    backgroundColor: '#10B981',
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
    color: '#1373e5',
    fontWeight: '800',
  },
  chartFooterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderColor: '#F1F5F9',
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
    paddingHorizontal: 9,
    paddingVertical: 4.5,
    borderRadius: 10,
  },
  chartTrendText: {
    fontSize: 11,
    fontWeight: '700',
  },

  // --- SMART FIELD OPERATIONS ISLAND ---
  fieldCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
  },
  fieldCardJourneyBorder: {
    borderColor: '#93C5FD',
    backgroundColor: '#FAFCFF',
  },
  fieldCardOnSiteBorder: {
    borderColor: '#86EFAC',
    backgroundColor: '#FAFFFC',
  },
  fieldCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
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
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 5,
  },
  fieldBadgeActive: {
    backgroundColor: '#DCFCE7',
  },
  fieldBadgeJourney: {
    backgroundColor: '#DBEAFE',
  },
  fieldBadgeText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#475569',
    letterSpacing: 0.4,
  },
  fieldBadgeTextActive: {
    color: '#15803D',
  },
  fieldBadgeTextJourney: {
    color: '#1D4ED8',
  },
  fieldStatusDotWrap: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  fieldDotIdle: {
    backgroundColor: '#CBD5E1',
  },
  fieldRequestTag: {
    fontSize: 11,
    fontWeight: '800',
    color: '#3730A3',
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 7,
    overflow: 'hidden',
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    marginBottom: 12,
  },
  stepperItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  stepperDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperDotDone: {
    borderColor: '#2563EB',
    backgroundColor: '#DBEAFE',
  },
  stepperDotInner: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#2563EB',
  },
  stepperLabel: {
    fontSize: 10.5,
    fontWeight: '600',
    color: '#94A3B8',
  },
  stepperLabelDone: {
    color: '#1E3A8A',
    fontWeight: '800',
  },
  stepperLine: {
    flex: 1,
    height: 1.5,
    backgroundColor: '#E2E8F0',
    marginHorizontal: 6,
  },
  stepperLineDone: {
    backgroundColor: '#93C5FD',
  },
  fieldSiteBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  fieldProjectInlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  fieldProjectDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  fieldProjectName: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
    flex: 1,
  },
  fieldRatePill: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
  },
  fieldRatePillText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#1E40AF',
  },
  fieldSiteTitle: {
    fontSize: 14.5,
    fontWeight: '800',
    color: '#0F172A',
  },
  fieldSiteSubtitle: {
    fontSize: 12,
    fontWeight: '500',
    color: '#64748B',
    marginTop: 2,
  },
  fieldLiveMetricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    paddingVertical: 9,
    marginBottom: 12,
  },
  fieldLiveMetricItem: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  fieldLiveDivider: {
    width: 1,
    height: 26,
    backgroundColor: '#E2E8F0',
  },
  fieldLiveValue: {
    fontSize: 13.5,
    fontWeight: '800',
    color: '#0F172A',
  },
  fieldLiveLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#64748B',
  },
  fieldDualBtnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  fieldActiveActionBtn: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1373e5',
    paddingVertical: 11.5,
    paddingHorizontal: 14,
    borderRadius: 14,
    shadowColor: '#1373e5',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.22,
    shadowRadius: 6,
    elevation: 3,
  },
  fieldActiveActionText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 13.5,
  },
  fieldSecondaryActionBtn: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    paddingVertical: 11.5,
    paddingHorizontal: 14,
    borderRadius: 14,
  },
  fieldSecondaryActionText: {
    color: '#1E3A8A',
    fontWeight: '800',
    fontSize: 13,
  },
  fieldCompletedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    paddingVertical: 10,
    borderRadius: 12,
  },
  fieldCompletedBannerText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#15803D',
  },
  fieldIdleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  fieldIdleDescription: {
    flex: 1,
    fontSize: 12.5,
    color: '#64748B',
    lineHeight: 17,
  },
  fieldStartBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1373e5',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 12,
  },
  fieldStartBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12.5,
  },

  // --- RECENT ACTIVITY FEED ---
  activityCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 6,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  activityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  activityItemUnread: {
    backgroundColor: '#F8FAFC',
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
    backgroundColor: '#1373e5',
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
    backgroundColor: '#F1F5F9',
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
    backgroundColor: '#DBEAFE',
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
    backgroundColor: '#1373e5',
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
