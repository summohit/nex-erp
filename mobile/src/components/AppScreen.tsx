import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, StatusBar, Platform, Image } from 'react-native';
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

function getHeaderIconTheme(title: string): { bg: string; color: string } {
  const t = title.toLowerCase();
  if (t.includes('attendance') || t.includes('time') || t.includes('leave')) return { bg: '#FFF1EC', color: '#E25E3E' };
  if (t.includes('project') || t.includes('board')) return { bg: '#FEF3C7', color: '#D97706' };
  if (t.includes('ticket') || t.includes('helpdesk')) return { bg: '#FAF5FF', color: '#9333EA' };
  if (t.includes('hardware') || t.includes('asset')) return { bg: '#FEF2F2', color: '#DC2626' };
  if (t.includes('lead') || t.includes('crm')) return { bg: '#F0F9FF', color: '#0284C7' };
  if (t.includes('payslip') || t.includes('payroll')) return { bg: '#F0FDF4', color: '#16A34A' };
  if (t.includes('visit')) return { bg: '#F0F9FF', color: '#0284C7' };
  if (t.includes('profile')) return { bg: '#EEF2FF', color: '#4F46E5' };
  if (t.includes('notification')) return { bg: '#EFF6FF', color: '#2563EB' };
  return { bg: '#FFF1EC', color: '#E25E3E' };
}

/**
 * Modern header matching reference design: floating circular buttons,
 * squircle category icon badge, dark bold title, and light-blue rimmed avatar.
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

  return (
    <View style={[styles.headerContainer, transparent && styles.headerTransparent]}>
      <View style={styles.headerTitleRow}>
        {/* Left: Floating circular white hamburger button */}
        <TouchableOpacity
          style={styles.floatingCircleBtn}
          activeOpacity={0.7}
          onPress={onOpenDrawer}
          accessibilityRole="button"
          accessibilityLabel="Open menu"
        >
          <Menu size={20} color="#0F172A" strokeWidth={2.4} />
        </TouchableOpacity>

        {/* Center: Themed Icon Badge + Title & Subtitle */}
        {!hideTitle && !!title && (
          <View style={styles.headerCenter}>
            <View style={[styles.titleIconBadge, { backgroundColor: iconTheme.bg }]}>
              <HeaderIcon size={21} color={iconTheme.color} strokeWidth={2.2} />
            </View>
            <View style={styles.headerTitleCol}>
              <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
              {!!subtitle && (
                <Text style={styles.headerSubtitle} numberOfLines={1}>{subtitle}</Text>
              )}
            </View>
          </View>
        )}

        {/* Right: Floating circular bell + Profile avatar with sky blue ring */}
        <View style={styles.headerRight}>
          {right}
          <TouchableOpacity
            style={styles.floatingCircleBtn}
            activeOpacity={0.7}
            onPress={() => navigation.navigate('Notifications')}
            accessibilityRole="button"
            accessibilityLabel="Notifications"
          >
            <Bell size={19} color="#0F172A" strokeWidth={2} />
            {unreadCount > 0 && <View style={styles.notificationDot} />}
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
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  content: {
    flex: 1,
  },
  headerContainer: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 11,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 8,
    elevation: 2,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  floatingCircleBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
    borderWidth: Platform.OS === 'ios' ? 1 : 0,
    borderColor: '#F1F5F9',
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginLeft: 2,
  },
  titleIconBadge: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleCol: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.2,
  },
  headerSubtitle: {
    fontSize: 11.5,
    fontWeight: '500',
    color: '#64748B',
    marginTop: 1.5,
  },
  headerTransparent: {
    backgroundColor: 'transparent',
    borderBottomWidth: 0,
    elevation: 0,
    shadowOpacity: 0,
  },
  containerTransparent: {
    backgroundColor: 'transparent',
  },
  headerRight: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  notificationDot: {
    position: 'absolute',
    top: 8,
    right: 9,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E25E3E',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  avatarButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#E25E3E',
    borderWidth: 2,
    borderColor: '#BAE6FD',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 22,
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
});
