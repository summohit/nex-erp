import React, { useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import {
  ArrowLeft,
  Bell,
  CheckCheck,
  Calendar,
  Briefcase,
  DollarSign,
  AlertTriangle,
  CheckCircle,
  Info,
  Users,
} from 'lucide-react-native';
import { useDashboardStore } from '../../store/dashboardStore';
import { AppNotification } from '../../api/notificationService';

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return `${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
}

function isToday(dateStr: string): boolean {
  const d = new Date(dateStr);
  const now = new Date();
  return d.toDateString() === now.toDateString();
}

function isYesterday(dateStr: string): boolean {
  const d = new Date(dateStr);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return d.toDateString() === yesterday.toDateString();
}

function getTypeIcon(type: string) {
  switch (type) {
    case 'LEAVE_REQUEST': return Calendar;
    case 'ASSIGNMENT':    return Briefcase;
    case 'PAYROLL':       return DollarSign;
    case 'WARNING':       return AlertTriangle;
    case 'SUCCESS':       return CheckCircle;
    case 'ATTENDANCE':    return Users;
    default:              return Info;
  }
}

function getTypeColor(type: string): string {
  switch (type) {
    case 'LEAVE_REQUEST': return '#8B5CF6';
    case 'ASSIGNMENT':    return '#3B82F6';
    case 'PAYROLL':       return '#10B981';
    case 'WARNING':       return '#F59E0B';
    case 'SUCCESS':       return '#22C55E';
    case 'ATTENDANCE':    return '#6366F1';
    default:              return '#64748B';
  }
}

interface GroupedSection {
  title: string;
  data: AppNotification[];
}

function groupNotifications(notifications: AppNotification[]): GroupedSection[] {
  const today: AppNotification[] = [];
  const yesterday: AppNotification[] = [];
  const earlier: AppNotification[] = [];

  for (const n of notifications) {
    if (isToday(n.createdAt)) today.push(n);
    else if (isYesterday(n.createdAt)) yesterday.push(n);
    else earlier.push(n);
  }

  const sections: GroupedSection[] = [];
  if (today.length) sections.push({ title: 'Today', data: today });
  if (yesterday.length) sections.push({ title: 'Yesterday', data: yesterday });
  if (earlier.length) sections.push({ title: 'Earlier', data: earlier });
  return sections;
}

function NotificationItem({
  item,
  onPress,
}: {
  item: AppNotification;
  onPress: (item: AppNotification) => void;
}) {
  const Icon = getTypeIcon(item.type);
  const color = getTypeColor(item.type);

  return (
    <TouchableOpacity
      style={[styles.item, !item.isRead && styles.itemUnread]}
      activeOpacity={0.7}
      onPress={() => onPress(item)}
    >
      <View style={[styles.iconWrap, { backgroundColor: color + '18' }]}>
        <Icon size={20} color={color} />
      </View>
      <View style={styles.itemContent}>
        <View style={styles.itemHeader}>
          <Text style={[styles.itemTitle, !item.isRead && styles.itemTitleUnread]} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={styles.itemTime}>{formatTime(item.createdAt)}</Text>
        </View>
        <Text style={styles.itemMessage} numberOfLines={2}>
          {item.message}
        </Text>
      </View>
      {!item.isRead && <View style={styles.unreadDot} />}
    </TouchableOpacity>
  );
}

function resolveLink(linkUrl: string | undefined, projects: any[]): { screen: string; params?: any } | null {
  if (!linkUrl) return null;
  const path = linkUrl.split('?')[0];

  // /projects/:id  or  /projects/:id/...
  if (path.startsWith('/projects/')) {
    const parts = path.split('/');
    const projectId = parseInt(parts[2], 10);
    if (!isNaN(projectId)) {
      const project = projects.find((p: any) => p.id === projectId);
      if (project) return { screen: 'ProjectDetail', params: { projectId: project.id, projectName: project.name } };
      return { screen: 'Projects' };
    }
  }
  if (path === '/projects') return { screen: 'Projects' };
  if (path.startsWith('/attendance/leaves') || path === '/attendance/leave') return { screen: 'Leaves', params: { initialTab: 'leaves' } };
  if (path.startsWith('/attendance')) return { screen: 'Attendance', params: { initialTab: 'timesheets' } };
  if (path.startsWith('/payroll/payslips') || path.startsWith('/payroll')) return { screen: 'Payslips' };
  if (path === '/notifications') return null; // already here
  return null;
}

export default function NotificationsScreen() {
  const navigation = useNavigation<any>();
  const { notifications, unreadCount, isLoading, markNotificationRead, markAllNotificationsRead, fetchDashboardData, projects } = useDashboardStore();

  const sections = useMemo(() => groupNotifications(notifications), [notifications]);

  const handlePress = useCallback(async (item: AppNotification) => {
    if (!item.isRead) {
      await markNotificationRead(item.id);
    }
    const dest = resolveLink(item.linkUrl, projects);
    if (dest) {
      navigation.navigate(dest.screen, dest.params);
    }
  }, [markNotificationRead, projects, navigation]);

  const handleMarkAllRead = useCallback(async () => {
    if (unreadCount > 0) await markAllNotificationsRead();
  }, [unreadCount, markAllNotificationsRead]);

  const renderItem = useCallback(({ item }: { item: AppNotification }) => (
    <NotificationItem item={item} onPress={handlePress} />
  ), [handlePress]);

  const renderSectionHeader = useCallback((title: string) => (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  ), []);

  // Flatten sections with headers for FlatList
  const flatData = useMemo(() => {
    const rows: (AppNotification | { type: 'header'; title: string })[] = [];
    for (const s of sections) {
      rows.push({ type: 'header', title: s.title });
      rows.push(...s.data);
    }
    return rows;
  }, [sections]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="dark-content" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <ArrowLeft size={20} color="#0F172A" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Notifications</Text>
          {unreadCount > 0 && (
            <View style={styles.headerBadge}>
              <Text style={styles.headerBadgeText}>{unreadCount}</Text>
            </View>
          )}
        </View>
        {unreadCount > 0 ? (
          <TouchableOpacity style={styles.markAllBtn} onPress={handleMarkAllRead} activeOpacity={0.7}>
            <CheckCheck size={16} color="#E25E3E" />
            <Text style={styles.markAllText}>All read</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 80 }} />
        )}
      </View>

      {/* List */}
      {flatData.length === 0 && !isLoading ? (
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <Bell size={36} color="#CBD5E1" />
          </View>
          <Text style={styles.emptyTitle}>All caught up!</Text>
          <Text style={styles.emptyMsg}>No notifications yet. We'll let you know when something happens.</Text>
        </View>
      ) : (
        <FlatList
          data={flatData}
          keyExtractor={(item, i) => ('type' in item && item.type === 'header') ? `h-${i}` : String((item as AppNotification).id)}
          renderItem={({ item }) => {
            if ('type' in item && item.type === 'header') {
              return renderSectionHeader(item.title);
            }
            return renderItem({ item: item as AppNotification });
          }}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isLoading}
              onRefresh={fetchDashboardData}
              colors={['#E25E3E']}
              tintColor="#E25E3E"
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    paddingHorizontal: 12,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0F172A',
  },
  headerBadge: {
    backgroundColor: '#E25E3E',
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
    minWidth: 22,
    alignItems: 'center',
  },
  headerBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  markAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#FFF1EC',
  },
  markAllText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#E25E3E',
  },
  list: {
    paddingBottom: 24,
  },
  sectionHeader: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 6,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    gap: 12,
  },
  itemUnread: {
    backgroundColor: '#FFFBF9',
    borderColor: '#FED7C8',
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  itemContent: {
    flex: 1,
    gap: 4,
  },
  itemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  itemTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
    flex: 1,
  },
  itemTitleUnread: {
    color: '#0F172A',
    fontWeight: '700',
  },
  itemTime: {
    fontSize: 11,
    color: '#94A3B8',
    flexShrink: 0,
  },
  itemMessage: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 18,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E25E3E',
    marginTop: 4,
    flexShrink: 0,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    gap: 12,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 24,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0F172A',
  },
  emptyMsg: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 20,
  },
});
