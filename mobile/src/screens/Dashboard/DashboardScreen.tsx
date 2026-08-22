import React, { useState, useEffect } from 'react';
import { useNavigation } from '@react-navigation/native';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  StatusBar,
  RefreshControl,
  Image,
  ActivityIndicator,
  Alert,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { useAuthStore } from '../../store/authStore';
import { useDashboardStore } from '../../store/dashboardStore';
import { notificationService, AppNotification } from '../../api/notificationService';
import { useProjectStore } from '../../store/projectStore';
import FeedbackModal, { ModalType } from '../../components/FeedbackModal';
import AppDrawer from '../../components/AppDrawer';
import {
  Briefcase,
  Calendar,
  Clock,
  Menu,
  Bell,
  Play,
  Receipt,
  MapPin,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  X,
} from 'lucide-react-native';

const PulseSkeleton = ({ style }: { style: any }) => {
  const pulseAnim = React.useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.5, duration: 800, useNativeDriver: true })
      ])
    ).start();
  }, [pulseAnim]);
  return <Animated.View style={[style, { opacity: pulseAnim, backgroundColor: '#E2E8F0' }]} />;
};

export default function DashboardScreen() {
  const navigation = useNavigation<any>();
  const { logout, user } = useAuthStore();
  const { 
    profile, 
    todayAttendance, 
    attendanceHistory, 
    leaveBalances, 
    projects, 
    notifications, 
    unreadCount, 
    fetchDashboardData, 
    clockIn, 
    clockOut, 
    isClockingIn,
    isLoading,
    error,
  } = useDashboardStore();
  
  const [currentTime, setCurrentTime] = useState('');
  const [liveWorkedTime, setLiveWorkedTime] = useState({ hours: 0, minutes: 0 });
  const [timeFilter, setTimeFilter] = useState<'7D' | '30D' | '3M'>('3M');
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Local state for field visit
  const [isTraveling, setIsTraveling] = useState(false);
  const [activeTripLocation, setActiveTripLocation] = useState('NetGuard Sentinel');

  const safeNavigate = (screenName: string, params?: any) => {
    const comingSoon = ['Expenses', 'FieldVisits', 'FieldVisitsHistory'];
    if (comingSoon.includes(screenName)) {
      Alert.alert('Coming Soon', `The ${screenName} screen is currently under development.`);
    } else {
      navigation.navigate(screenName as any, params);
    }
  };

  const toggleTrip = () => {
    setIsTraveling(!isTraveling);
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchDashboardData();
    setRefreshing(false);
  };

  // Live Clock
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setCurrentTime(now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Live Worked Time Tracker
  useEffect(() => {
    const updateTimer = () => {
      if (todayAttendance?.clockIn && !todayAttendance?.clockOut) {
        const clockInTime = new Date(todayAttendance.clockIn).getTime();
        const diffMs = Math.max(0, new Date().getTime() - clockInTime);
        const totalMinutes = Math.floor(diffMs / 60000);
        setLiveWorkedTime({ hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 });
      } else if (todayAttendance?.totalHours) {
        setLiveWorkedTime({
          hours: Math.floor(todayAttendance.totalHours),
          minutes: Math.round((todayAttendance.totalHours % 1) * 60)
        });
      } else {
        setLiveWorkedTime({ hours: 0, minutes: 0 });
      }
    };
    
    updateTimer();
    const interval = setInterval(updateTimer, 60000);
    return () => clearInterval(interval);
  }, [todayAttendance]);

  const handleAttendanceToggle = async () => {
    try {
      if (todayAttendance?.clockIn && !todayAttendance?.clockOut) {
        await clockOut();
        setFeedback({ visible: true, type: 'success', title: 'Clocked Out', message: 'You have clocked out successfully.' });
      } else {
        await clockIn();
        setFeedback({ visible: true, type: 'success', title: 'Clocked In', message: 'You have clocked in successfully.' });
      }
    } catch (error: any) {
      setFeedback({ visible: true, type: 'error', title: 'Error', message: error?.message || 'Failed to update attendance' });
    }
  };

  const getInitials = (firstName?: string, lastName?: string, email?: string) => {
    if (firstName && lastName) return `${firstName[0]}${lastName[0]}`.toUpperCase();
    return email ? email.substring(0, 2).toUpperCase() : 'MS';
  };

  const isCheckedIn = !!(todayAttendance?.clockIn && !todayAttendance?.clockOut);

  const handleNotificationPress = async (notification: AppNotification) => {
    if (!notification.isRead) {
      notificationService.markAsRead(notification.id).catch(() => {});
      useDashboardStore.setState(state => ({
        notifications: state.notifications.map(n => n.id === notification.id ? { ...n, isRead: true } : n),
        unreadCount: Math.max(0, state.unreadCount - 1)
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
          (navigation as any).navigate('ProjectDetail', { projectId: project.id, projectName: project.name });
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
      (navigation as any).navigate('Payslips');
    }
  };
  
  const [feedback, setFeedback] = useState<{ 
    visible: boolean; 
    type: ModalType; 
    title: string; 
    message: string; 
  }>({ visible: false, type: 'success', title: '', message: '' });
  
  // Computed values
  const totalLeaveAllocated = leaveBalances.reduce((sum, lb) => sum + lb.allocated, 0);
  const totalLeaveUsed = leaveBalances.reduce((sum, lb) => sum + lb.used, 0);
  const totalLeaveRemaining = totalLeaveAllocated - totalLeaveUsed;
  const leaveProgress = totalLeaveAllocated > 0 ? (totalLeaveUsed / totalLeaveAllocated) * 100 : 0;
  
  const activeProjectsCount = projects.filter(p => p.status !== 'ARCHIVED').length;
  const completedProjectsCount = projects.filter(p => p.status === 'COMPLETED').length;
  
  const currentHour = new Date().getHours();
  const greeting = currentHour < 12 ? 'GOOD MORNING' : currentHour < 17 ? 'GOOD AFTERNOON' : 'GOOD EVENING';
  const displayName = profile ? `${profile.firstName} ${profile.lastName}` : (user?.email?.split('@')[0] || 'Employee');

  // Weekly attendance chart data (computed)
  const getChartData = () => {
    const days = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    const data = [
      { day: 'M', height: '0%' },
      { day: 'T', height: '0%' },
      { day: 'W', height: '0%' },
      { day: 'T', height: '0%' },
      { day: 'F', height: '0%' },
      { day: 'S', height: '0%' },
      { day: 'S', height: '0%' },
    ];
    
    if (!attendanceHistory || attendanceHistory.length === 0) return { data, avgHours: 0 };
    
    // Group history by day of week
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay() + 1); // Monday
    startOfWeek.setHours(0, 0, 0, 0);
    
    let totalHoursWeek = 0;
    
    attendanceHistory.forEach(record => {
      const recordDate = new Date(record.date);
      if (recordDate >= startOfWeek) {
        const dayIndex = recordDate.getDay(); // 0 (Sun) to 6 (Sat)
        const mappedIndex = dayIndex === 0 ? 6 : dayIndex - 1; // Map to M-S
        if (mappedIndex >= 0 && mappedIndex < 7) {
          totalHoursWeek += record.totalHours;
          // Normalize to a max of 12 hours for 100% height
          const pct = Math.min(100, Math.round((record.totalHours / 12) * 100));
          data[mappedIndex].height = `${pct}%`;
        }
      }
    });
    
    return { data, avgHours: totalHoursWeek / 5 }; // Assuming 5 work days for avg
  };

  const { data: chartData, avgHours } = getChartData();

  const workedTodayHours = todayAttendance?.totalHours || 0;
  const trendVsAvg = avgHours > 0 ? ((workedTodayHours - avgHours) / avgHours) * 100 : 0;
  const trendColor = trendVsAvg >= 0 ? '#16A34A' : '#EF4444';
  const trendBg = trendVsAvg >= 0 ? '#DCFCE7' : '#FEE2E2';

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      
      {/* Top Header Bar */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.iconButton}
          activeOpacity={0.7}
          onPress={() => setIsDrawerOpen(true)}
        >
          <Menu size={22} color="#0F172A" />
        </TouchableOpacity>

        {isLoading && !refreshing ? (
          <View style={styles.headerCenter}>
            <PulseSkeleton style={{ width: 80, height: 10, borderRadius: 4, marginBottom: 6 }} />
            <PulseSkeleton style={{ width: 140, height: 18, borderRadius: 6 }} />
          </View>
        ) : (
          <View style={styles.headerCenter}>
            <Text style={styles.greetingText}>{greeting}</Text>
            <Text style={styles.nameText}>{displayName}</Text>
          </View>
        )}
        
        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.iconButton} activeOpacity={0.7} onPress={() => safeNavigate('Notifications')}>
            <Bell size={20} color="#0F172A" />
            {unreadCount > 0 && <View style={styles.notificationDot} />}
          </TouchableOpacity>
          {isLoading && !refreshing ? (
            <PulseSkeleton style={{ width: 44, height: 44, borderRadius: 14 }} />
          ) : (
            <TouchableOpacity style={styles.avatarButton} onPress={() => safeNavigate('Profile')} activeOpacity={0.8}>
              {profile?.avatarUrl ? (
                <Image source={{ uri: profile.avatarUrl }} style={{ width: '100%', height: '100%', borderRadius: 12 }} />
              ) : (
                <Text style={styles.avatarText}>{getInitials(profile?.firstName, profile?.lastName, user?.email)}</Text>
              )}
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView 
        contentContainerStyle={styles.scrollContent} 
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#E25E3E']} />
        }
      >
        {error ? (
          <View style={{ padding: 40, alignItems: 'center', justifyContent: 'center', marginTop: 40 }}>
            <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: '#FEE2E2', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
              <X color="#DC2626" size={32} />
            </View>
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#0F172A', marginBottom: 8, textAlign: 'center' }}>
              Oops, something went wrong
            </Text>
            <Text style={{ fontSize: 14, color: '#64748B', textAlign: 'center', marginBottom: 24, lineHeight: 20 }}>
              We couldn't load your dashboard data. Please check your connection and try again.
            </Text>
            <Text style={{ fontSize: 12, color: '#94A3B8', textAlign: 'center', marginBottom: 24, paddingHorizontal: 20 }}>
              Error: {error}
            </Text>
            <TouchableOpacity 
              style={{ backgroundColor: '#E25E3E', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 100 }}
              onPress={onRefresh}
            >
              <Text style={{ color: '#FFF', fontWeight: '600', fontSize: 14 }}>Try Again</Text>
            </TouchableOpacity>
          </View>
        ) : isLoading && !refreshing ? (
          <View style={{ paddingHorizontal: 20, paddingTop: 20, gap: 20 }}>
            <PulseSkeleton style={{ height: 220, borderRadius: 24, width: '100%' }} />
            <PulseSkeleton style={{ height: 100, borderRadius: 16, width: '100%' }} />
            <View style={{ flexDirection: 'row', gap: 15 }}>
              <PulseSkeleton style={{ height: 140, borderRadius: 20, flex: 1 }} />
              <PulseSkeleton style={{ height: 140, borderRadius: 20, flex: 1 }} />
            </View>
            <PulseSkeleton style={{ height: 280, borderRadius: 24, width: '100%' }} />
          </View>
        ) : (
          <>
        {/* --- Today's Attendance Card --- */}
        <View style={styles.attendanceCard}>
          {/* Subtle decorative background circle top-right */}
          <View style={styles.cardGlowBg} />

          <Text style={styles.attendanceCardTitle}>TODAY'S ATTENDANCE</Text>
          <Text style={styles.attendanceDate}>
            {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          </Text>

          <View style={styles.attendanceTimeRow}>
            <Text style={styles.timeClock}>{currentTime || '00: 00: 00'}</Text>
            
            <View style={{ position: 'relative', width: 80, height: 80, alignItems: 'center', justifyContent: 'center' }}>
              <Svg width="80" height="80" viewBox="0 0 80 80">
                <Circle
                  cx="40" cy="40" r="35"
                  stroke="#F3E8E5" strokeWidth="6" fill="none"
                />
                <Circle
                  cx="40" cy="40" r="35"
                  stroke="#EA580C" strokeWidth="6" fill="none"
                  strokeDasharray={`${2 * Math.PI * 35}`}
                  strokeDashoffset={`${2 * Math.PI * 35 * (1 - Math.min((liveWorkedTime.hours * 60 + liveWorkedTime.minutes) / (9 * 60), 1))}`}
                  strokeLinecap="round"
                  rotation="-90"
                  origin="40, 40"
                />
              </Svg>
              <View style={{ position: 'absolute', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={styles.progressRingText}>
                  {liveWorkedTime.hours}h {liveWorkedTime.minutes.toString().padStart(2, '0')}m
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.attendanceFooter}>
            <View style={styles.statusPill}>
              <View style={[styles.statusDot, { backgroundColor: isCheckedIn ? '#10B981' : '#94A3B8' }]} />
              <Text style={styles.statusText}>{isCheckedIn ? 'Clocked in' : 'Not clocked in'}</Text>
            </View>

            <TouchableOpacity 
              style={[
                styles.punchButton, 
                isCheckedIn ? styles.punchButtonOut : styles.punchButtonIn, 
                isClockingIn && { opacity: 0.7 }
              ]}
              activeOpacity={0.8}
              onPress={handleAttendanceToggle}
              disabled={isClockingIn}
            >
              {isClockingIn ? (
                <ActivityIndicator size="small" color="#FFFFFF" style={{ marginRight: 6 }} />
              ) : (
                <Play size={15} color="#FFFFFF" style={{ marginRight: 6, transform: [{ rotate: isCheckedIn ? '90deg' : '0deg' }] }} />
              )}
              <Text style={styles.punchButtonText}>
                {isClockingIn ? 'Processing...' : (isCheckedIn ? 'Clock Out' : 'Clock In')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>


        {/* --- Quick Actions (Equal 4-Column Grid) --- */}
        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <View style={styles.quickActionsGrid}>
          <TouchableOpacity style={styles.quickActionCard} activeOpacity={0.7} onPress={() => safeNavigate('Leaves')}>
            <View style={[styles.qaIconWrapper, { backgroundColor: '#FFF7ED' }]}>
              <Calendar size={22} color="#EA580C" />
            </View>
            <Text style={styles.qaText}>Leave</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.quickActionCard} activeOpacity={0.7} onPress={() => safeNavigate('Attendance')}>
            <View style={[styles.qaIconWrapper, { backgroundColor: '#F0FDF4' }]}>
              <Clock size={22} color="#16A34A" />
            </View>
            <Text style={styles.qaText}>Attendance</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.quickActionCard} activeOpacity={0.7} onPress={() => safeNavigate('Expenses')}>
            <View style={[styles.qaIconWrapper, { backgroundColor: '#EFF6FF' }]}>
              <Receipt size={22} color="#2563EB" />
            </View>
            <Text style={styles.qaText}>Expense</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.quickActionCard} activeOpacity={0.7} onPress={() => safeNavigate('FieldVisits')}>
            <View style={[styles.qaIconWrapper, { backgroundColor: '#FAF5FF' }]}>
              <MapPin size={22} color="#9333EA" />
            </View>
            <Text style={styles.qaText}>Field Visit</Text>
          </TouchableOpacity>
        </View>


        {/* --- Overview (2-Column Equal Grid) --- */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Overview</Text>
          <TouchableOpacity activeOpacity={0.7} onPress={() => safeNavigate('Projects')}>
            <Text style={styles.viewAllText}>View all</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.overviewGrid}>
          {/* Card 1: Worked Today */}
          <View style={styles.overviewCard}>
            <View style={[styles.overviewIconWrapper, { backgroundColor: '#FFF7ED' }]}>
              <Clock size={20} color="#EA580C" />
            </View>
            <Text style={styles.overviewValue}>
              {todayAttendance?.totalHours ? `${Math.floor(todayAttendance.totalHours)}h ${Math.round((todayAttendance.totalHours % 1) * 60)}m` : '0h 0m'}
            </Text>
            <Text style={styles.overviewLabel}>Worked today</Text>
            <View style={[styles.overviewBadge, { backgroundColor: trendBg }]}>
              <ArrowUp size={12} color={trendColor} style={{ transform: [{ rotate: trendVsAvg >= 0 ? '0deg' : '180deg' }] }} />
              <Text style={[styles.overviewBadgeText, { color: trendColor }]}> {Math.abs(trendVsAvg).toFixed(1)}% vs avg</Text>
            </View>
          </View>

          {/* Card 2: Active Projects */}
          <View style={styles.overviewCard}>
            <View style={[styles.overviewIconWrapper, { backgroundColor: '#F0FDF4' }]}>
              <Briefcase size={20} color="#16A34A" />
            </View>
            <Text style={styles.overviewValue}>{activeProjectsCount}</Text>
            <Text style={styles.overviewLabel}>Active projects</Text>
            <View style={[styles.overviewBadge, { backgroundColor: '#F1F5F9' }]}>
              <Text style={[styles.overviewBadgeText, { color: '#64748B' }]}>{completedProjectsCount} completed</Text>
            </View>
          </View>
        </View>


        {/* --- Working Hours / Attendance Chart Section --- */}
        <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Attendance</Text>

        <View style={styles.chartCard}>
          {/* Header Row inside Chart Card */}
          <View style={styles.chartHeader}>
            <View>
              <Text style={styles.chartTitle}>Working hours</Text>
              <Text style={styles.chartSubtitle}>Your attendance this week</Text>
            </View>

            {/* Time Filter Pill Selector */}
            <View style={styles.filterPillContainer}>
              {(['7D', '30D', '3M'] as const).map((filter) => (
                <TouchableOpacity
                  key={filter}
                  style={[
                    styles.filterTab,
                    timeFilter === filter && styles.filterTabActive,
                  ]}
                  activeOpacity={0.7}
                  onPress={() => setTimeFilter(filter)}
                >
                  <Text
                    style={[
                      styles.filterTabText,
                      timeFilter === filter && styles.filterTabTextActive,
                    ]}
                  >
                    {filter}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Bar Chart View */}
          <View style={styles.chartContainer}>
            {/* Background Grid Lines */}
            <View style={styles.gridLinesContainer}>
              <View style={styles.gridLine} />
              <View style={styles.gridLine} />
              <View style={styles.gridLine} />
              <View style={styles.gridLine} />
            </View>

            {/* Bars */}
            <View style={styles.barsRow}>
              {/* Dynamic Chart Data based on history will go here */}
              {chartData.map((item: { day: string; height: string }, index: number) => (
                <View key={index} style={styles.barColumn}>
                  <View style={styles.barTrack}>
                    <View
                      style={[
                        styles.barFill,
                        { height: item.height },
                      ]}
                    />
                  </View>
                  <Text style={styles.barLabel}>{item.day}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* Chart Footer */}
          <View style={styles.chartFooter}>
            <View style={styles.avgContainer}>
              <Text style={styles.avgValue}>
                {avgHours > 0 ? `${Math.floor(avgHours)}h ${Math.round((avgHours % 1) * 60)}m` : '0h 0m'}
              </Text>
              <Text style={styles.avgLabel}>Weekly average</Text>
            </View>

            <View style={[styles.chartBadge, { backgroundColor: trendBg }]}>
              <ArrowUp size={12} color={trendColor} style={{ transform: [{ rotate: trendVsAvg >= 0 ? '0deg' : '180deg' }] }} />
              <Text style={[styles.chartBadgeText, { color: trendColor }]}> {Math.abs(trendVsAvg).toFixed(1)}%</Text>
            </View>
          </View>
        </View>

        {/* --- Leave Balance --- */}
        <TouchableOpacity
          style={styles.statPanel}
          activeOpacity={0.85}
          onPress={() => safeNavigate('Leaves')}
        >
          <View style={styles.statPanelHeader}>
            <View style={styles.statPanelHeaderLeft}>
              <View style={[styles.statPanelIconWrap, { backgroundColor: '#ECFDF5' }]}>
                <Calendar size={18} color="#16A34A" />
              </View>
              <Text style={styles.statPanelTitle}>Leave Balance</Text>
            </View>
            <ChevronRight size={18} color="#CBD5E1" />
          </View>

          <View style={styles.statPanelValueRow}>
            <Text style={styles.statPanelBigValue}>{totalLeaveRemaining}</Text>
            <Text style={styles.statPanelValueUnit}>days remaining</Text>
          </View>

          <View style={styles.leaveProgressBarTrack}>
            <View
              style={[
                styles.leaveProgressBarFill,
                { width: `${Math.min(leaveProgress, 100)}%` },
                leaveProgress >= 90 && { backgroundColor: '#F87171' },
              ]}
            />
          </View>
          <View style={styles.leaveProgressLabels}>
            <Text style={styles.leaveProgressText}>{totalLeaveUsed} used</Text>
            <Text style={styles.leaveProgressText}>{totalLeaveAllocated} total</Text>
          </View>
        </TouchableOpacity>

        {/* --- Active Projects --- */}
        <TouchableOpacity
          style={[styles.statPanel, { marginBottom: 24 }]}
          activeOpacity={0.85}
          onPress={() => safeNavigate('Projects')}
        >
          <View style={styles.statPanelHeader}>
            <View style={styles.statPanelHeaderLeft}>
              <View style={[styles.statPanelIconWrap, { backgroundColor: '#FFF7ED' }]}>
                <Briefcase size={18} color="#EA580C" />
              </View>
              <Text style={styles.statPanelTitle}>Active Projects</Text>
            </View>
            <View style={styles.statPanelCountPill}>
              <Text style={styles.statPanelCountPillText}>{activeProjectsCount}</Text>
            </View>
          </View>

          <View style={styles.projectsList}>
            {projects.slice(0, 3).map((project, index) => (
              <View key={project.id || index} style={styles.projectItemRow}>
                <View
                  style={[
                    styles.projectStatusDot,
                    { backgroundColor: project.status === 'COMPLETED' ? '#16A34A' : '#EA580C' },
                  ]}
                />
                <Text style={styles.projectNameText} numberOfLines={1}>{project.name}</Text>
                <View style={[styles.statusBadge, project.status === 'COMPLETED' ? styles.doneBadge : styles.wipBadge]}>
                  <Text style={project.status === 'COMPLETED' ? styles.doneBadgeText : styles.wipBadgeText}>
                    {project.status === 'COMPLETED' ? 'DONE' : 'WIP'}
                  </Text>
                </View>
              </View>
            ))}
            {projects.length === 0 && (
              <Text style={styles.emptyProjectsText}>No active projects</Text>
            )}
            {projects.length > 3 && (
              <Text style={styles.moreProjectsText}>+{projects.length - 3} more</Text>
            )}
          </View>
        </TouchableOpacity>

        {/* --- Field Visit Section --- */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Field Visit</Text>
          <TouchableOpacity activeOpacity={0.7} onPress={() => safeNavigate('FieldVisitsHistory')}>
            <Text style={styles.historyText}>History</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.fieldVisitCard}>
          <View style={styles.fieldVisitHeaderRow}>
            <View>
              <Text style={styles.fieldVisitTag}>FIELD VISIT</Text>
              <Text style={styles.fieldVisitStatusText}>{isTraveling ? 'Traveling' : 'Not traveling'}</Text>
            </View>
            <View style={[styles.idlePill, isTraveling && { backgroundColor: '#DCFCE7' }]}>
              <View style={[styles.idleDot, isTraveling && { backgroundColor: '#16A34A' }]} />
              <Text style={[styles.idlePillText, isTraveling && { color: '#16A34A' }]}>{isTraveling ? 'Active' : 'Idle'}</Text>
            </View>
          </View>

          <Text style={styles.travelingForLabel}>Traveling for</Text>
          <TouchableOpacity style={styles.dropdownInput} activeOpacity={0.7}>
            <Text style={styles.dropdownSelectedText}>{activeTripLocation}</Text>
            <ChevronDown size={20} color="#64748B" />
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.startTripButton, isTraveling && { backgroundColor: '#EF4444', shadowColor: '#EF4444' }]} 
            activeOpacity={0.8}
            onPress={toggleTrip}
          >
            <MapPin size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
            <Text style={styles.startTripButtonText}>{isTraveling ? 'End Trip' : 'Start Trip'}</Text>
          </TouchableOpacity>
        </View>

        {/* --- Recent Activity Section --- */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Recent Activity</Text>
          <TouchableOpacity activeOpacity={0.7} onPress={() => safeNavigate('Notifications')}>
            <Text style={styles.viewAllText}>View all</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.activityCard}>
          {notifications.length > 0 ? notifications.slice(0, 5).map((notification, index) => (
            <React.Fragment key={notification.id}>
              <TouchableOpacity style={[styles.activityItemRow, !notification.isRead && { backgroundColor: '#F1F5F9', borderRadius: 12, paddingHorizontal: 12, marginHorizontal: -12 }]} activeOpacity={0.7} onPress={() => handleNotificationPress(notification)}>

                <View style={styles.activityIconBox}>
                  <Bell size={20} color={notification.isRead ? "#64748B" : "#2563EB"} />
                  {!notification.isRead && <View style={{ position: 'absolute', top: 0, right: 0, width: 8, height: 8, borderRadius: 4, backgroundColor: '#EF4444' }} />}
                </View>
                <View style={styles.activityContent}>
                  <Text style={styles.activityTitle}>{notification.title}</Text>
                  <Text style={styles.activitySubtitle} numberOfLines={1}>{notification.message}</Text>
                </View>
                <View style={styles.activityStatusGroup}>
                  <Text style={styles.activityDate}>
                    {new Date(notification.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </Text>
                </View>
              </TouchableOpacity>
              {index < Math.min(notifications.length, 5) - 1 && <View style={styles.activityDivider} />}
            </React.Fragment>
          )) : (
            <View style={{ padding: 16, alignItems: 'center' }}>
              <Text style={{ color: '#94A3B8' }}>No recent activity</Text>
            </View>
          )}
        </View>
          </>
        )}

      </ScrollView>

      {/* Dynamic side drawer — menus fetched from /menus/sidebar API */}
      <AppDrawer
        visible={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        activeScreen="Home"
      />

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F5F7FA',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
    backgroundColor: '#F5F7FA',
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  headerCenter: {
    flex: 1,
    paddingHorizontal: 12,
  },
  greetingText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  nameText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    textTransform: 'capitalize',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  notificationDot: {
    position: 'absolute',
    top: 11,
    right: 13,
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#EA580C',
  },
  avatarButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#E25E3E',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#E25E3E',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 84,
  },

  // --- Today's Attendance Card Styles ---
  attendanceCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 22,
    marginBottom: 24,
    position: 'relative',
    overflow: 'hidden',
    shadowColor: '#E25E3E',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.05,
    shadowRadius: 16,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#FFF5F2',
  },
  cardGlowBg: {
    position: 'absolute',
    top: -40,
    right: -40,
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: '#FFF1EC',
    opacity: 0.7,
  },
  attendanceCardTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  attendanceDate: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748B',
    marginBottom: 4,
  },
  attendanceTimeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  timeClock: {
    fontSize: 32,
    fontWeight: '900',
    color: '#0F172A',
    letterSpacing: -0.5,
    flex: 1,
    fontVariant: ['tabular-nums'],
  },
  progressRing: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 5,
    borderColor: '#F5E6E3',
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressRingInner: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressRingText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0F172A',
  },
  attendanceFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  statusText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },
  punchButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 24,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  punchButtonIn: {
    backgroundColor: '#E25E3E',
    shadowColor: '#E25E3E',
  },
  punchButtonOut: {
    backgroundColor: '#EF4444',
    shadowColor: '#EF4444',
  },
  punchButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },

  // --- Quick Actions Grid (4 Columns side-by-side) ---
  sectionTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 14,
  },
  quickActionsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 24,
  },
  quickActionCard: {
    flex: 1,
    height: 94,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 2,
  },
  qaIconWrapper: {
    width: 42,
    height: 42,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  qaText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },

  // --- Overview Grid (2 Columns side-by-side) ---
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  viewAllText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#E25E3E',
  },
  overviewGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  overviewCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 2,
  },
  overviewIconWrapper: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  overviewValue: {
    fontSize: 26,
    fontWeight: '900',
    color: '#0F172A',
    marginBottom: 2,
  },
  overviewLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
    marginBottom: 12,
  },
  overviewBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  overviewBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },

  // --- Working Hours / Attendance Chart Styles ---
  chartCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 8,
    elevation: 2,
    marginBottom: 24,
  },
  chartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 24,
  },
  chartTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  chartSubtitle: {
    fontSize: 13,
    fontWeight: '500',
    color: '#64748B',
    marginTop: 2,
  },
  filterPillContainer: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 14,
    padding: 3,
  },
  filterTab: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  filterTabActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  filterTabText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#94A3B8',
  },
  filterTabTextActive: {
    color: '#0F172A',
  },
  chartContainer: {
    height: 170,
    justifyContent: 'flex-end',
    position: 'relative',
    marginBottom: 16,
  },
  gridLinesContainer: {
    position: 'absolute',
    top: 0,
    bottom: 30,
    left: 0,
    right: 0,
    justifyContent: 'space-between',
  },
  gridLine: {
    height: 1,
    backgroundColor: '#F1F5F9',
  },
  barsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: '100%',
    paddingHorizontal: 8,
  },
  barColumn: {
    alignItems: 'center',
    height: '100%',
    justifyContent: 'flex-end',
    flex: 1,
  },
  barTrack: {
    height: 130,
    width: 24,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  barFill: {
    width: 24,
    backgroundColor: '#E25E3E',
    borderRadius: 12,
  },
  barLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#94A3B8',
    marginTop: 8,
  },
  chartFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderColor: '#F1F5F9',
    paddingTop: 16,
    marginTop: 8,
  },
  avgContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  avgValue: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
  },
  avgLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: '#64748B',
  },
  chartBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  chartBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#16A34A',
  },

  // --- Leave Balance & Projects Styles ---
  statPanel: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    marginBottom: 12,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 2,
  },
  statPanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  statPanelHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  statPanelIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statPanelTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  statPanelCountPill: {
    backgroundColor: '#FFF7ED',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  statPanelCountPillText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#EA580C',
  },
  statPanelValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    marginBottom: 14,
  },
  statPanelBigValue: {
    fontSize: 30,
    fontWeight: '900',
    color: '#0F172A',
    lineHeight: 34,
  },
  statPanelValueUnit: {
    fontSize: 13,
    fontWeight: '600',
    color: '#94A3B8',
  },
  leaveProgressBarTrack: {
    height: 8,
    backgroundColor: '#F1F5F9',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 10,
  },
  leaveProgressBarFill: {
    height: '100%',
    backgroundColor: '#34D399',
    borderRadius: 4,
  },
  leaveProgressLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  leaveProgressText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94A3B8',
  },
  projectsList: {
    gap: 12,
  },
  projectItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  projectStatusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  projectNameText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  wipBadge: {
    backgroundColor: '#FEF3C7',
  },
  wipBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#D97706',
  },
  doneBadge: {
    backgroundColor: '#DCFCE7',
  },
  doneBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#16A34A',
  },
  emptyProjectsText: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 4,
  },
  moreProjectsText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#E25E3E',
    marginTop: 2,
  },

  // --- Field Visit & Recent Activity Styles ---
  historyText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#E25E3E',
  },
  fieldVisitCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 20,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 8,
    elevation: 2,
  },
  fieldVisitHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  fieldVisitTag: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  fieldVisitStatusText: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
  },
  idlePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  idleDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#94A3B8',
    marginRight: 6,
  },
  idlePillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
  },
  travelingForLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
    marginTop: 16,
    marginBottom: 8,
  },
  dropdownInput: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#F1F5F9',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 18,
  },
  dropdownSelectedText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  startTripButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#E25E3E',
    borderRadius: 24,
    paddingVertical: 14,
    shadowColor: '#E25E3E',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  startTripButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },

  // Recent Activity Styles
  activityCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 8,
    elevation: 2,
    marginBottom: 24,
  },
  activityItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
  },
  activityIconBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#F8FAFC',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  activityContent: {
    flex: 1,
  },
  activityTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 2,
  },
  activitySubtitle: {
    fontSize: 12,
    fontWeight: '500',
    color: '#64748B',
  },
  activityStatusGroup: {
    alignItems: 'flex-end',
  },
  approvedBadge: {
    backgroundColor: '#DCFCE7',
  },
  approvedBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#16A34A',
  },
  pendingBadge: {
    backgroundColor: '#FEF3C7',
  },
  pendingBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#D97706',
  },
  reviewBadge: {
    backgroundColor: '#FEF3C7',
  },
  reviewBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#D97706',
  },
  activityDate: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94A3B8',
    marginTop: 4,
  },
  activityDivider: {
    height: 1,
    backgroundColor: '#F1F5F9',
  },
});
