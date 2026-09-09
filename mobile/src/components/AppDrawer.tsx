import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  Image,
  ActivityIndicator,
  Dimensions,
  Linking,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import {
  Users,
  Briefcase,
  Clock,
  Calendar,
  DollarSign,
  FileText,
  MapPin,
  Bell,
  Settings,
  LogOut,
  ChevronRight,
  ChevronDown,
  X,
  Target,
  Building,
  Filter,
  ShoppingCart,
  Trophy,
  UserCircle,
  Monitor,
  Package,
  Ticket,
  Bug,
  Rocket,
  LayoutDashboard,
  Award,
  Sparkles,
  CalendarClock,
  CalendarDays,
  ExternalLink,
  FolderKanban,
  UserCheck,
  UserPlus,
  LifeBuoy,
} from 'lucide-react-native';
import { API_URL } from '../api/apiClient';
import { useAuthStore } from '../store/authStore';
import { useMenuStore, MenuItem } from '../store/menuStore';
import { useDashboardStore } from '../store/dashboardStore';
import { navigateTo } from '../navigation/navigationUtils';
import FeedbackModal from './FeedbackModal';

const PANEL_WIDTH = Math.min(320, Dimensions.get('window').width * 0.82);

// The Angular web app is served from the same host as the API, one path
// segment up (https://host/api -> https://host).
const WEB_URL = API_URL.replace(/\/api\/?$/, '');

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64Encode(input: string): string {
  let output = '';
  let i = 0;
  while (i < input.length) {
    const c1 = input.charCodeAt(i++);
    const c2 = i < input.length ? input.charCodeAt(i++) : NaN;
    const c3 = i < input.length ? input.charCodeAt(i++) : NaN;
    const e1 = c1 >> 2;
    const e2 = ((c1 & 3) << 4) | (isNaN(c2) ? 0 : c2 >> 4);
    const e3 = isNaN(c2) ? 64 : (((c2 & 15) << 2) | (isNaN(c3) ? 0 : c3 >> 6));
    const e4 = isNaN(c3) ? 64 : (c3 & 63);
    output += B64_CHARS[e1] + B64_CHARS[e2] + (e3 === 64 ? '=' : B64_CHARS[e3]) + (e4 === 64 ? '=' : B64_CHARS[e4]);
  }
  return output;
}

// Map normalized icon strings to Lucide components
const ICON_MAP: Record<string, React.ComponentType<any>> = {
  'layout-dashboard': LayoutDashboard,
  'users': Users,
  'user-check': UserCheck,
  'user-plus': UserPlus,
  'briefcase': Briefcase,
  'kanban': FolderKanban,
  'folder-kanban': FolderKanban,
  'calendar-clock': CalendarClock,
  'calendar-days': CalendarDays,
  'clock': Clock,
  'calendar': Calendar,
  'banknote': DollarSign,
  'dollar-sign': DollarSign,
  'laptop': Monitor,
  'monitor': Monitor,
  'settings': Settings,
  'trophy': Trophy,
  'award': Award,
  'sparkles': Sparkles,
  'building': Building,
  'target': Target,
  'door-open': LogOut,
  'funnel': Filter,
  'filter': Filter,
  'shopping-cart': ShoppingCart,
  'map-pin': MapPin,
  'bell': Bell,
  'user': UserCircle,
  'file-text': FileText,
  'package': Package,
  'ticket': Ticket,
  'bug': Bug,
  'rocket': Rocket,
  'life-buoy': LifeBuoy,
};

function normalizeIconKey(rawName?: string): string {
  if (!rawName) return '';
  return rawName
    .replace(/^lucide[-_]?/i, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase();
}

function getIcon(iconName?: string, itemId?: string, route?: string): React.ComponentType<any> {
  const norm = normalizeIconKey(iconName);
  if (norm && ICON_MAP[norm]) return ICON_MAP[norm];

  // Contextual fallback based on item ID and route
  const key = (itemId || route?.replace(/^\//, '') || '').toLowerCase();
  if (key === 'overview' || key === 'dashboard' || key === 'home') return LayoutDashboard;
  if (key === 'employees') return Users;
  if (key === 'recruitment') return UserCheck;
  if (key === 'projects') return FolderKanban;
  if (key === 'attendance' || key.startsWith('attendance')) return CalendarClock;
  if (key === 'leaves') return CalendarDays;
  if (key === 'appreciation') return Award;
  if (key === 'field-visits') return MapPin;
  if (key === 'tickets' || key === 'crm/tickets') return Ticket;
  if (key === 'notifications') return Bell;
  if (key === 'performance') return Target;
  if (key === 'payslips' || key.includes('payroll')) return FileText;
  if (key.includes('asset') || key.includes('hardware')) return Package;

  return Briefcase;
}

function getSubItemIcon(sub: MenuItem): React.ComponentType<any> | null {
  const titleLower = sub.title?.toLowerCase() || '';
  const idLower = sub.id?.toLowerCase() || '';
  if (sub.external || titleLower.includes('public') || titleLower.includes('career')) return ExternalLink;
  if (titleLower.includes('interview') || idLower.includes('interview')) return Calendar;
  if (titleLower.includes('candidate') || titleLower.includes('job')) return Users;
  if (titleLower.includes('profile') || idLower.includes('profile')) return UserCircle;
  if (titleLower.includes('timesheet') || titleLower.includes('time')) return Clock;
  if (titleLower.includes('leave') || titleLower.includes('holiday')) return CalendarDays;
  if (titleLower.includes('document')) return FileText;
  if (sub.icon) {
    const icon = getIcon(sub.icon, sub.id, sub.route);
    if (icon !== Briefcase) return icon;
  }
  return null;
}

// Executive Soft-Card category tints (Slack / Notion inspired)
interface ItemTheme {
  iconBg: string;
  iconColor: string;
}

const CATEGORY_THEMES: Record<string, ItemTheme> = {
  // Dashboard / Overview
  overview: { iconBg: '#FFF1EC', iconColor: '#E25E3E' },
  dashboard: { iconBg: '#FFF1EC', iconColor: '#E25E3E' },
  home: { iconBg: '#FFF1EC', iconColor: '#E25E3E' },
  // People & Talent
  employees: { iconBg: '#EEF2FF', iconColor: '#4F46E5' },
  recruitment: { iconBg: '#F5F3FF', iconColor: '#7C3AED' },
  // Projects & Tasks
  projects: { iconBg: '#FEF3C7', iconColor: '#D97706' },
  // Attendance & Time
  attendance: { iconBg: '#ECFDF5', iconColor: '#059669' },
  'attendance/timesheets': { iconBg: '#ECFDF5', iconColor: '#059669' },
  'attendance/leaves': { iconBg: '#ECFDF5', iconColor: '#059669' },
  leaves: { iconBg: '#ECFDF5', iconColor: '#059669' },
  // Appreciation & Culture
  appreciation: { iconBg: '#FFF1F2', iconColor: '#E11D48' },
  // Field Operations
  'field-visits': { iconBg: '#F0F9FF', iconColor: '#0284C7' },
  // Support & Issues
  tickets: { iconBg: '#FAF5FF', iconColor: '#9333EA' },
  // Notifications
  notifications: { iconBg: '#EFF6FF', iconColor: '#2563EB' },
  // Finance & HR
  payslips: { iconBg: '#F0FDF4', iconColor: '#16A34A' },
  payroll: { iconBg: '#F0FDF4', iconColor: '#16A34A' },
  'payroll/payslips': { iconBg: '#F0FDF4', iconColor: '#16A34A' },
  'payroll/expenses': { iconBg: '#F0FDF4', iconColor: '#16A34A' },
  expenses: { iconBg: '#F0FDF4', iconColor: '#16A34A' },
  'assets/requests': { iconBg: '#FEF2F2', iconColor: '#DC2626' },
  'hardware-requests': { iconBg: '#FEF2F2', iconColor: '#DC2626' },
  assets: { iconBg: '#FEF2F2', iconColor: '#DC2626' },
  // Muted & Default
  performance: { iconBg: '#F1F5F9', iconColor: '#64748B' },
  offboarding: { iconBg: '#F1F5F9', iconColor: '#64748B' },
  settings: { iconBg: '#F8FAFC', iconColor: '#475569' },
  default: { iconBg: '#F8FAFC', iconColor: '#64748B' },
};

function getItemTheme(item: { id?: string; route?: string }): ItemTheme {
  const key = (item.id || item.route?.replace(/^\//, '') || '').toLowerCase();
  if (CATEGORY_THEMES[key]) return CATEGORY_THEMES[key];
  if (item.route) {
    const rKey = item.route.replace(/^\//, '').toLowerCase();
    if (CATEGORY_THEMES[rKey]) return CATEGORY_THEMES[rKey];
  }
  return CATEGORY_THEMES.default;
}

// Map API route → { screen, params? } for screens that exist in mobile
const ROUTE_TO_NAV: Record<string, { screen: string; params?: any }> = {
  '/dashboard': { screen: 'Home' },
  '/projects': { screen: 'Projects' },
  '/attendance/timesheets': { screen: 'Attendance', params: { initialTab: 'timesheets' } },
  '/attendance/leaves': { screen: 'Leaves', params: { initialTab: 'leaves' } },
  '/crm/leads': { screen: 'CRM' },
  '/crm/lead-contacts': { screen: 'CRM' },
  '/crm': { screen: 'CRM' },
  '/notifications': { screen: 'Notifications' },
  '/payroll/payslips': { screen: 'Payslips' },
  '/payroll': { screen: 'Payslips' },
  '/crm/tickets': { screen: 'Tickets' },
  '/assets/requests': { screen: 'HardwareRequests' },
  '/assets/hardware-requests': { screen: 'HardwareRequests' },
  '/field-visits': { screen: 'FieldVisit' },
  '/employees/me/profile': { screen: 'Profile' },
  '/attendance/holidays': { screen: 'Attendance', params: { initialTab: 'holidays' } },
  '/payroll/expenses': { screen: 'Attendance', params: { initialTab: 'expenses' } },
};

// Client-side group bucketing for visual grouping
const ITEM_TO_GROUP: Record<string, string> = {
  dashboard: 'WORKSPACE',
  overview: 'WORKSPACE',
  employees: 'WORKSPACE',
  projects: 'WORKSPACE',
  'attendance': 'WORKSPACE',
  'attendance/timesheets': 'WORKSPACE',
  'attendance/leaves': 'WORKSPACE',
  recruitment: 'WORKSPACE',
  performance: 'WORKSPACE',
  payroll: 'FINANCE',
  'payroll/payslips': 'FINANCE',
  'payroll/expenses': 'FINANCE',
  payslips: 'FINANCE',
  assets: 'FINANCE',
  notifications: 'WORKSPACE',
  clients: 'OPERATIONS',
  crm: 'OPERATIONS',
  'crm/leads': 'OPERATIONS',
  'crm/lead-contacts': 'OPERATIONS',
  sales: 'OPERATIONS',
  offboarding: 'OPERATIONS',
  settings: 'SYSTEM',
};

const GROUP_ORDER = ['WORKSPACE', 'FINANCE', 'OPERATIONS', 'SYSTEM'];

// Items that are fully implemented and always shown
const ALWAYS_ON_ITEMS: { group: string; id: string; title: string; icon: string; route: string }[] = [
  { group: 'WORKSPACE', id: 'notifications', title: 'Notifications', icon: 'bell', route: '/notifications' },
  { group: 'FINANCE', id: 'payslips', title: 'Payslips', icon: 'file-text', route: '/payroll/payslips' },
  { group: 'FINANCE', id: 'hardware-requests', title: 'Hardware Requests', icon: 'package', route: '/assets/requests' },
];

function resolveNav(item: MenuItem): { screen: string; params?: any } | null {
  if (item.route && ROUTE_TO_NAV[item.route]) {
    return ROUTE_TO_NAV[item.route];
  }
  if (item.subItems?.length) {
    for (const sub of item.subItems) {
      if (sub.route && ROUTE_TO_NAV[sub.route]) {
        return ROUTE_TO_NAV[sub.route];
      }
    }
  }
  return null;
}

function filterFunctionalItems(items: MenuItem[]): MenuItem[] {
  const result: MenuItem[] = [];
  for (const item of items) {
    if (item.subItems && item.subItems.length > 0) {
      const validSubItems = item.subItems.filter(
        sub => sub.external || sub.route === '/careers' || (sub.route && ROUTE_TO_NAV[sub.route])
      );
      if (validSubItems.length > 0) {
        result.push({
          ...item,
          subItems: validSubItems,
        });
        continue;
      }
    }
    if (item.external || item.route === '/careers' || (item.route && ROUTE_TO_NAV[item.route])) {
      result.push(item);
    }
  }
  return result;
}

function groupItems(items: MenuItem[]): { group: string; items: MenuItem[] }[] {
  const functionalItems = filterFunctionalItems(items);
  const groups: Record<string, MenuItem[]> = {};
  const existingIds = new Set(functionalItems.map(i => i.id));

  for (const item of functionalItems) {
    const group = ITEM_TO_GROUP[item.id] || ITEM_TO_GROUP[item.route?.replace('/', '') || ''] || 'WORKSPACE';
    if (!groups[group]) groups[group] = [];
    groups[group].push(item);
  }

  for (const item of ALWAYS_ON_ITEMS) {
    if (!existingIds.has(item.id)) {
      if (!groups[item.group]) groups[item.group] = [];
      groups[item.group].push({ id: item.id, title: item.title, icon: item.icon, route: item.route });
    }
  }

  return GROUP_ORDER
    .filter(g => groups[g] && groups[g].length > 0)
    .map(g => ({ group: g, items: groups[g] }));
}

interface AppDrawerProps {
  visible: boolean;
  onClose: () => void;
  activeScreen?: string;
}

export default function AppDrawer({ visible, onClose, activeScreen = 'Home' }: AppDrawerProps) {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { user, company, logout } = useAuthStore();
  const { sections, isLoading, fetchMenus } = useMenuStore();
  const { profile, projects, leaveBalances, unreadCount } = useDashboardStore();

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [comingSoon, setComingSoon] = useState(false);
  const [logoutConfirm, setLogoutConfirm] = useState(false);

  useEffect(() => {
    if (visible && sections.length === 0) {
      fetchMenus();
    }
  }, [visible, sections.length, fetchMenus]);

  const activeProjectsCount = projects.filter((p: any) => p.status !== 'ARCHIVED').length;
  const totalLeaveRemaining = leaveBalances.reduce((s: number, lb: any) => s + lb.allocated - lb.used, 0);

  function getBadge(item: MenuItem): number {
    const id = item.id || '';
    if (id === 'projects' || item.route === '/projects') return activeProjectsCount;
    if (id === 'attendance/leaves' || item.route === '/attendance/leaves') return totalLeaveRemaining;
    if (item.title?.toLowerCase().includes('notification')) return unreadCount;
    return 0;
  }

  function handleItemPress(item: MenuItem) {
    if (item.subItems?.length) {
      setExpandedIds(prev => {
        const next = new Set(prev);
        if (next.has(item.id)) next.delete(item.id);
        else next.add(item.id);
        return next;
      });
      return;
    }
    const nav = resolveNav(item);
    if (nav) {
      onClose();
      navigateTo(navigation, nav.screen, nav.params);
    } else {
      setComingSoon(true);
    }
  }

  function handleSubItemPress(sub: MenuItem) {
    if (sub.external || sub.route === '/careers') {
      let path = sub.route || '/careers';
      if (path === '/careers' && user?.companyId != null) {
        path = `/careers/${base64Encode(String(user.companyId))}`;
      }
      onClose();
      Linking.openURL(`${WEB_URL}${path}`).catch(() => setComingSoon(true));
      return;
    }

    const nav = resolveNav(sub);
    if (nav) {
      onClose();
      navigateTo(navigation, nav.screen, nav.params);
    } else {
      setComingSoon(true);
    }
  }

  function handleLogout() {
    setLogoutConfirm(true);
  }

  function confirmLogout() {
    setLogoutConfirm(false);
    onClose();
    logout();
  }

  const getInitials = (firstName?: string, lastName?: string, email?: string) => {
    if (firstName && lastName) return `${firstName[0]}${lastName[0]}`.toUpperCase();
    return email ? email.substring(0, 2).toUpperCase() : 'MS';
  };

  const allItems: MenuItem[] = sections.flatMap(s => s.items);
  const grouped = groupItems(allItems);

  return (
    <>
      <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
        <View style={styles.overlay}>
          {/* Panel anchored on the left */}
          <View style={styles.panel}>
            <SafeAreaView edges={['top']} style={{ flex: 1 }}>
              {/* Header with workspace brand and close button */}
              <View style={styles.header}>
                <View style={styles.brandGroup}>
                  {company?.logoUrl ? (
                    <View style={styles.logoWrapper}>
                      <Image source={{ uri: company.logoUrl }} style={styles.companyLogo} />
                    </View>
                  ) : (
                    <View style={styles.logoBox}>
                      <Text style={styles.logoText}>
                        {company?.name ? company.name.charAt(0).toUpperCase() : 'N'}
                      </Text>
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.brandTitle} numberOfLines={1}>
                      {company?.name || 'NEX'}
                    </Text>
                    <View style={styles.brandSubtitleRow}>
                      <View style={styles.workspaceDot} />
                      <Text style={styles.brandSubtitle}>Employee Workspace</Text>
                    </View>
                  </View>
                </View>
                <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.7}>
                  <X size={16} color="#475569" strokeWidth={2.5} />
                </TouchableOpacity>
              </View>

              {/* Menu items scroll list */}
              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.scrollContent}
              >
                {isLoading ? (
                  <View style={styles.loadingBox}>
                    <ActivityIndicator size="small" color="#E25E3E" />
                    <Text style={styles.loadingText}>Loading menu…</Text>
                  </View>
                ) : allItems.length === 0 ? (
                  <StaticMenuFallback
                    activeScreen={activeScreen}
                    activeProjectsCount={activeProjectsCount}
                    totalLeaveRemaining={totalLeaveRemaining}
                    unreadCount={unreadCount}
                    onNavigate={(screen, params) => { onClose(); navigateTo(navigation, screen, params); }}
                  />
                ) : (
                  grouped.map(({ group, items: groupItemsList }) => (
                    <View key={group} style={styles.groupContainer}>
                      <Text style={styles.groupLabel}>{group}</Text>
                      {groupItemsList.map(item => {
                        const isActive = activeScreen === resolveNav(item)?.screen;
                        const badge = getBadge(item);
                        const Icon = getIcon(item.icon, item.id, item.route);
                        const theme = getItemTheme(item);
                        const isExpanded = expandedIds.has(item.id);
                        const hasSubItems = !!item.subItems?.length;

                        return (
                          <View key={item.id}>
                            <TouchableOpacity
                              style={[
                                styles.item,
                                isActive && styles.itemActive,
                              ]}
                              activeOpacity={0.75}
                              onPress={() => handleItemPress(item)}
                            >
                              {isActive && <View style={styles.activeBar} />}

                              <View style={styles.itemLeft}>
                                <View
                                  style={[
                                    styles.iconBox,
                                    { backgroundColor: theme.iconBg },
                                    isActive && styles.iconBoxActive,
                                  ]}
                                >
                                  <Icon
                                    size={18}
                                    color={isActive ? '#E25E3E' : theme.iconColor}
                                    strokeWidth={isActive ? 2.2 : 2}
                                  />
                                </View>
                                <Text
                                  style={[
                                    styles.itemText,
                                    isActive && styles.itemTextActive,
                                  ]}
                                >
                                  {item.title}
                                </Text>
                              </View>

                              <View style={styles.itemRight}>
                                {badge > 0 && (
                                  <View style={styles.badge}>
                                    <Text style={styles.badgeText}>{badge}</Text>
                                  </View>
                                )}
                                {hasSubItems ? (
                                  <ChevronDown
                                    size={16}
                                    color={isActive ? '#E25E3E' : '#94A3B8'}
                                    strokeWidth={2}
                                    style={{ transform: [{ rotate: isExpanded ? '180deg' : '0deg' }] }}
                                  />
                                ) : (
                                  <ChevronRight
                                    size={16}
                                    color={isActive ? '#E25E3E' : '#CBD5E1'}
                                    strokeWidth={2}
                                  />
                                )}
                              </View>
                            </TouchableOpacity>

                            {/* Sub-items tree view */}
                            {hasSubItems && isExpanded && (
                              <View style={styles.subItemsTree}>
                                {item.subItems!.map(sub => {
                                  const subActive = activeScreen === resolveNav(sub)?.screen;
                                  const SubIconComponent = getSubItemIcon(sub);
                                  const isExternal = !!sub.external || sub.route === '/careers';

                                  return (
                                    <TouchableOpacity
                                      key={sub.id}
                                      style={[styles.subItem, subActive && styles.subItemActive]}
                                      activeOpacity={0.7}
                                      onPress={() => handleSubItemPress(sub)}
                                    >
                                      <View style={styles.subItemLeft}>
                                        {SubIconComponent ? (
                                          <SubIconComponent
                                            size={14}
                                            color={subActive ? '#E25E3E' : '#64748B'}
                                            strokeWidth={subActive ? 2.2 : 1.8}
                                          />
                                        ) : (
                                          <View style={[styles.subItemDot, subActive && styles.subItemDotActive]} />
                                        )}
                                        <Text
                                          style={[styles.subItemText, subActive && styles.subItemTextActive]}
                                          numberOfLines={1}
                                        >
                                          {sub.title.replace(' ↗', '')}
                                        </Text>
                                      </View>
                                      {isExternal && (
                                        <ExternalLink size={12} color="#94A3B8" strokeWidth={2} />
                                      )}
                                    </TouchableOpacity>
                                  );
                                })}
                              </View>
                            )}
                          </View>
                        );
                      })}
                    </View>
                  ))
                )}
              </ScrollView>

              {/* Elevated Footer User Profile Dock */}
              <View style={[styles.footerWrapper, { paddingBottom: Math.max(insets.bottom, 12) }]}>
                <View style={styles.footerCard}>
                  <TouchableOpacity
                    style={styles.profileClickArea}
                    activeOpacity={0.7}
                    onPress={() => { onClose(); navigateTo(navigation, 'Profile'); }}
                  >
                    <View style={styles.avatarContainer}>
                      {profile?.avatarUrl ? (
                        <Image source={{ uri: profile.avatarUrl }} style={styles.footerAvatar} />
                      ) : (
                        <View style={styles.footerAvatarPlaceholder}>
                          <Text style={styles.footerAvatarText}>
                            {getInitials(profile?.firstName, profile?.lastName, user?.email)}
                          </Text>
                        </View>
                      )}
                      <View style={styles.onlineDot} />
                    </View>

                    <View style={styles.footerInfo}>
                      <Text style={styles.footerName} numberOfLines={1}>
                        {profile ? `${profile.firstName} ${profile.lastName}` : (user?.email?.split('@')[0] || 'Employee')}
                      </Text>
                      <View style={styles.roleBadge}>
                        <Text style={styles.roleBadgeText} numberOfLines={1}>
                          {(profile as any)?.designation?.name || (profile as any)?.jobTitle || user?.role || 'Employee'}
                        </Text>
                      </View>
                    </View>
                  </TouchableOpacity>

                  {/* Quick Logout Button */}
                  <TouchableOpacity
                    style={styles.logoutBtn}
                    activeOpacity={0.7}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    onPress={handleLogout}
                  >
                    <LogOut size={16} color="#EF4444" strokeWidth={2.2} />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Modals rendered inside panel */}
              <FeedbackModal
                visible={comingSoon}
                type="warning"
                title="Coming Soon"
                message="This module is under development and will be available in a future update."
                onClose={() => setComingSoon(false)}
              />
              <FeedbackModal
                visible={logoutConfirm}
                type="warning"
                title="Logout"
                message="Are you sure you want to log out?"
                showCancel
                confirmText="Logout"
                onClose={() => setLogoutConfirm(false)}
                onConfirm={confirmLogout}
              />
            </SafeAreaView>
          </View>

          {/* Backdrop on the right side */}
          <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        </View>
      </Modal>
    </>
  );
}

type StaticItem = { id: string; title: string; icon: string; screen: string; badge?: number; params?: any };

function StaticMenuFallback({
  activeScreen,
  activeProjectsCount,
  totalLeaveRemaining,
  unreadCount,
  onNavigate,
}: {
  activeScreen: string;
  activeProjectsCount: number;
  totalLeaveRemaining: number;
  unreadCount: number;
  onNavigate: (screen: string, params?: any) => void;
}) {
  const staticGroups: { group: string; items: StaticItem[] }[] = [
    {
      group: 'WORKSPACE',
      items: [
        { id: 'home', title: 'Home', icon: 'layout-dashboard', screen: 'Home' },
        { id: 'projects', title: 'Projects', icon: 'folder-kanban', screen: 'Projects', badge: activeProjectsCount },
        { id: 'attendance', title: 'Attendance', icon: 'calendar-clock', screen: 'Attendance', params: { initialTab: 'timesheets' } },
        { id: 'leaves', title: 'Leave', icon: 'calendar-days', screen: 'Leaves', params: { initialTab: 'leaves' }, badge: totalLeaveRemaining },
        { id: 'notifications', title: 'Notifications', icon: 'bell', screen: 'Notifications', badge: unreadCount },
      ],
    },
    {
      group: 'FINANCE',
      items: [
        { id: 'payslips', title: 'Payslips', icon: 'file-text', screen: 'Payslips' },
        { id: 'assets', title: 'Hardware Requests', icon: 'package', screen: 'HardwareRequests' },
        { id: 'tickets', title: 'Helpdesk & Tickets', icon: 'ticket', screen: 'Tickets' },
      ],
    },
  ];

  return (
    <>
      {staticGroups.map(({ group, items }) => (
        <View key={group} style={styles.groupContainer}>
          <Text style={styles.groupLabel}>{group}</Text>
          {items.map(item => {
            const isActive = activeScreen === item.screen;
            const Icon = getIcon(item.icon, item.id);
            const theme = getItemTheme({ id: item.id });

            return (
              <TouchableOpacity
                key={item.id}
                style={[
                  styles.item,
                  isActive && styles.itemActive,
                ]}
                activeOpacity={0.75}
                onPress={() => onNavigate(item.screen, item.params)}
              >
                {isActive && <View style={styles.activeBar} />}

                <View style={styles.itemLeft}>
                  <View
                    style={[
                      styles.iconBox,
                      { backgroundColor: theme.iconBg },
                      isActive && styles.iconBoxActive,
                    ]}
                  >
                    <Icon
                      size={18}
                      color={isActive ? '#E25E3E' : theme.iconColor}
                      strokeWidth={isActive ? 2.2 : 2}
                    />
                  </View>
                  <Text
                    style={[
                      styles.itemText,
                      isActive && styles.itemTextActive,
                    ]}
                  >
                    {item.title}
                  </Text>
                </View>

                <View style={styles.itemRight}>
                  {(item.badge ?? 0) > 0 && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{item.badge}</Text>
                    </View>
                  )}
                  <ChevronRight
                    size={16}
                    color={isActive ? '#E25E3E' : '#CBD5E1'}
                    strokeWidth={2}
                  />
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  panel: {
    width: PANEL_WIDTH,
    backgroundColor: '#FFFFFF',
    borderTopRightRadius: 24,
    borderBottomRightRadius: 24,
    shadowColor: '#0F172A',
    shadowOffset: { width: 6, height: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 16,
    overflow: 'hidden',
  },
  backdrop: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 4,
    paddingBottom: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  brandGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    marginRight: 8,
  },
  logoWrapper: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  companyLogo: {
    width: '100%',
    height: '100%',
    resizeMode: 'contain',
  },
  logoBox: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: '#E25E3E',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#E25E3E',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  logoText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 18,
  },
  brandTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.2,
  },
  brandSubtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  workspaceDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  brandSubtitle: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '500',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 24,
  },
  loadingText: {
    fontSize: 13,
    color: '#94A3B8',
  },
  groupContainer: {
    marginTop: 14,
  },
  groupLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 0.8,
    marginBottom: 6,
    paddingHorizontal: 18,
    textTransform: 'uppercase',
  },
  item: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginHorizontal: 10,
    borderRadius: 14,
    marginBottom: 2,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  itemActive: {
    backgroundColor: '#FFF7F5',
    borderColor: '#FED7AA',
  },
  activeBar: {
    position: 'absolute',
    left: 0,
    top: 8,
    bottom: 8,
    width: 3.5,
    backgroundColor: '#E25E3E',
    borderTopRightRadius: 4,
    borderBottomRightRadius: 4,
  },
  itemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconBoxActive: {
    backgroundColor: '#FFE8DF',
  },
  itemText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#334155',
  },
  itemTextActive: {
    color: '#0F172A',
    fontWeight: '700',
  },
  itemTextWip: {
    color: '#94A3B8',
  },
  itemRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  badge: {
    backgroundColor: '#FEE2E2',
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
    minWidth: 20,
    alignItems: 'center',
  },
  badgeText: {
    color: '#DC2626',
    fontSize: 11,
    fontWeight: '700',
  },
  wipBadge: {
    backgroundColor: '#F1F5F9',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  wipBadgeText: {
    color: '#64748B',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  subItemsTree: {
    marginLeft: 32,
    paddingLeft: 12,
    borderLeftWidth: 1.5,
    borderLeftColor: '#E2E8F0',
    marginVertical: 4,
    gap: 2,
  },
  subItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 9,
    backgroundColor: 'transparent',
  },
  subItemActive: {
    backgroundColor: '#FFF7F5',
  },
  subItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  subItemDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#CBD5E1',
  },
  subItemDotActive: {
    backgroundColor: '#E25E3E',
  },
  subItemText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#64748B',
  },
  subItemTextActive: {
    color: '#E25E3E',
    fontWeight: '600',
  },
  footerWrapper: {
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    backgroundColor: '#FFFFFF',
  },
  footerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 10,
    borderRadius: 14,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  profileClickArea: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    flex: 1,
  },
  avatarContainer: {
    position: 'relative',
  },
  footerAvatar: {
    width: 38,
    height: 38,
    borderRadius: 11,
  },
  footerAvatarPlaceholder: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: '#E25E3E',
    justifyContent: 'center',
    alignItems: 'center',
  },
  footerAvatarText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  onlineDot: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#10B981',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  footerInfo: {
    flex: 1,
  },
  footerName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  roleBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#E2E8F0',
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 5,
    marginTop: 3,
  },
  roleBadgeText: {
    fontSize: 10,
    color: '#475569',
    fontWeight: '600',
  },
  logoutBtn: {
    width: 34,
    height: 34,
    borderRadius: 9,
    backgroundColor: '#FEE2E2',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 6,
  },
});
