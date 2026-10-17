import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, StatusBar, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import {
  Menu,
  Bell,
  CalendarClock,
  FolderKanban,
  UserCircle,
  Ticket,
  Package,
  FileText,
  MapPin,
  Users,
  LayoutDashboard,
} from 'lucide-react-native';
import BottomNavBar from './BottomNavBar';
import AppDrawer from './AppDrawer';
import { useDashboardStore } from '../store/dashboardStore';
import { useAuthStore } from '../store/authStore';

function initialsOf(firstName?: string, lastName?: string, email?: string) {
  if (firstName && lastName) return `${firstName[0]}${lastName[0]}`.toUpperCase();
  return email ? email.substring(0, 2).toUpperCase() : 'MS';
}

export type Crumb = { label: string; onPress?: () => void };

function getHeaderIcon(title: string): React.ComponentType<any> {
  const t = title.toLowerCase();
  if (t.includes('attendance') || t.includes('time') || t.includes('leave')) return CalendarClock;
  if (t.includes('project') || t.includes('board')) return FolderKanban;
  if (t.includes('ticket') || t.includes('helpdesk')) return Ticket;
  if (t.includes('hardware') || t.includes('asset')) return Package;
  if (t.includes('lead') || t.includes('crm')) return Users;
  if (t.includes('payslip') || t.includes('payroll')) return FileText;
  if (t.includes('visit')) return MapPin;
  if (t.includes('profile')) return UserCircle;
  if (t.includes('notification') || t.includes('alert')) return Bell;
  return LayoutDashboard;
}

function getHeaderIconTheme(title: string): { bg: string; color: string; border: string } {
  const t = title.toLowerCase();
  if (t.includes('attendance') || t.includes('time') || t.includes('leave')) return { bg: '#EFF6FF', color: '#1373E5', border: '#BFDBFE' };
  if (t.includes('project') || t.includes('board')) return { bg: '#F3E8FF', color: '#7C3AED', border: '#DDD6FE' };
  if (t.includes('ticket') || t.includes('helpdesk')) return { bg: '#FAF5FF', color: '#9333EA', border: '#E9D5FF' };
  if (t.includes('hardware') || t.includes('asset')) return { bg: '#F0FDFA', color: '#0D9488', border: '#99F6E4' };
  if (t.includes('lead') || t.includes('crm')) return { bg: '#F0F9FF', color: '#0284C7', border: '#BAE6FD' };
  if (t.includes('payslip') || t.includes('payroll') || t.includes('expense')) return { bg: '#ECFDF5', color: '#047857', border: '#A7F3D0' };
  if (t.includes('visit')) return { bg: '#F0F9FF', color: '#0284C7', border: '#BAE6FD' };
  if (t.includes('profile')) return { bg: '#EEF2FF', color: '#4F46E5', border: '#C7D2FE' };
  if (t.includes('notification')) return { bg: '#FFFBEB', color: '#D97706', border: '#FDE68A' };
  return { bg: '#EFF6FF', color: '#1373E5', border: '#BFDBFE' };
}

/**
 * The header on every app screen, in the Timesheet design system
 * (theme/ds.ts): rounded-square buttons on a soft slate tile, the screen's
 * icon in its own tinted tile, a heavy title, the unread count on the bell,
 * and the person's photo.
 */
export function ScreenHeader({
  title = '',
  subtitle,
  right,
  transparent = false,
  hideTitle = false,
  onOpenDrawer,
}: {
  title?: string;
  subtitle?: string;
  crumbs?: Crumb[];
  right?: React.ReactNode;
  showBreadcrumbs?: boolean;
  transparent?: boolean;
  hideTitle?: boolean;
  onOpenDrawer: () => void;
}) {
  const navigation = useNavigation<any>();
  const { profile, unreadCount } = useDashboardStore();
  const { user } = useAuthStore();

  const HeaderIcon = getHeaderIcon(title);
  const iconTheme = getHeaderIconTheme(title);
  const unread = unreadCount > 99 ? '99+' : String(unreadCount);

  return (
    <View style={[styles.headerContainer, transparent && styles.headerTransparent]}>
      <View style={styles.headerTitleRow}>
        <TouchableOpacity
          style={styles.iconBtn}
          activeOpacity={0.7}
          onPress={onOpenDrawer}
          accessibilityRole="button"
          accessibilityLabel="Open menu"
        >
          <Menu size={19} color="#0F172A" strokeWidth={2.4} />
        </TouchableOpacity>

        {!hideTitle && !!title ? (
          <View style={styles.headerCenter}>
            <View style={[styles.titleIconBadge, { backgroundColor: iconTheme.bg, borderColor: iconTheme.border }]}>
              <HeaderIcon size={18} color={iconTheme.color} strokeWidth={2.3} />
            </View>
            <View style={styles.headerTitleCol}>
              <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
              {!!subtitle && (
                <Text style={styles.headerSubtitle} numberOfLines={1}>{subtitle}</Text>
              )}
            </View>
          </View>
        ) : (
          <View style={styles.headerCenter} />
        )}

        <View style={styles.headerRight}>
          {right}
          <TouchableOpacity
            style={styles.iconBtn}
            activeOpacity={0.7}
            onPress={() => navigation.navigate('Notifications')}
            accessibilityRole="button"
            accessibilityLabel={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
          >
            <Bell size={18} color="#0F172A" strokeWidth={2.2} />
            {unreadCount > 0 && (
              <View style={[styles.badge, unread.length > 1 && styles.badgeWide]}>
                <Text style={styles.badgeText}>{unread}</Text>
              </View>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.avatarButton}
            activeOpacity={0.8}
            onPress={() => navigation.navigate('MainTabs', { screen: 'Profile' })}
            accessibilityRole="button"
            accessibilityLabel="Profile"
          >
            {profile?.avatarUrl ? (
              <Image source={{ uri: profile.avatarUrl }} style={styles.avatarImage} />
            ) : (
              <Text style={styles.avatarText}>
                {initialsOf(profile?.firstName, profile?.lastName, user?.email)}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

export default function AppScreen({
  title = '',
  subtitle,
  crumbs,
  right,
  showBreadcrumbs = false,
  showBottomNav = true,
  transparent = false,
  hideTitle = false,
  children,
}: {
  title?: string;
  subtitle?: string;
  crumbs?: Crumb[];
  right?: React.ReactNode;
  showBreadcrumbs?: boolean;
  showBottomNav?: boolean;
  transparent?: boolean;
  hideTitle?: boolean;
  children: React.ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const route = useRoute();

  return (
    <SafeAreaView style={[styles.container, transparent && styles.containerTransparent]} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />
      <ScreenHeader
        title={title}
        subtitle={subtitle}
        crumbs={crumbs}
        right={right}
        showBreadcrumbs={showBreadcrumbs}
        transparent={transparent}
        hideTitle={hideTitle}
        onOpenDrawer={() => setDrawerOpen(true)}
      />
      <View style={styles.content}>{children}</View>
      {showBottomNav && <BottomNavBar />}

      <AppDrawer
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        activeScreen={route.name}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  content: { flex: 1 },
  headerContainer: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 22,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
    zIndex: 2,
  },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 },
  titleIconBadge: {
    width: 38,
    height: 38,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleCol: { flex: 1, minWidth: 0 },
  headerTitle: { fontSize: 17, fontWeight: '900', color: '#0F172A', letterSpacing: -0.3 },
  headerSubtitle: { fontSize: 11.5, fontWeight: '600', color: '#94A3B8', marginTop: 1 },
  headerTransparent: {
    backgroundColor: 'transparent',
    borderBottomWidth: 0,
    elevation: 0,
    shadowOpacity: 0,
  },
  containerTransparent: { backgroundColor: 'transparent' },
  headerRight: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: {
    position: 'absolute',
    top: -5,
    right: -5,
    minWidth: 19,
    height: 19,
    borderRadius: 10,
    paddingHorizontal: 4,
    backgroundColor: '#EF4444',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeWide: { paddingHorizontal: 5 },
  badgeText: { color: '#FFFFFF', fontSize: 9.5, fontWeight: '900', fontVariant: ['tabular-nums'] },
  avatarButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: '#1373E5',
    borderWidth: 2,
    borderColor: '#BFDBFE',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: { width: '100%', height: '100%' },
  avatarText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
});
