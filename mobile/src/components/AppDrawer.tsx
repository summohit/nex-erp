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
} from 'react-native';

const PANEL_WIDTH = Math.min(300, Dimensions.get('window').width - 56);
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import {
  Home,
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
  Rocket,
  LayoutDashboard,
} from 'lucide-react-native';
import { useAuthStore } from '../store/authStore';
import { useMenuStore, MenuItem } from '../store/menuStore';
import { useDashboardStore } from '../store/dashboardStore';
import { useProjectStore } from '../store/projectStore';
import FeedbackModal from './FeedbackModal';

// Map icon name strings (from DB/API) to lucide components
const ICON_MAP: Record<string, React.ComponentType<any>> = {
  'layout-dashboard': LayoutDashboard,
  'users': Users,
  'briefcase': Briefcase,
  'kanban': Briefcase,
  'calendar-clock': Clock,
  'banknote': DollarSign,
  'dollar-sign': DollarSign,
  'laptop': Monitor,
  'monitor': Monitor,
  'settings': Settings,
  'trophy': Trophy,
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
  'rocket': Rocket,
};

// Map API route → { screen, params? } for screens that exist in mobile
const ROUTE_TO_NAV: Record<string, { screen: string; params?: any }> = {
  '/dashboard': { screen: 'Home' },
  '/projects': { screen: 'Projects' },
  '/attendance/timesheets': { screen: 'Attendance', params: { initialTab: 'timesheets' } },
  '/attendance/leaves': { screen: 'Leaves', params: { initialTab: 'leaves' } },
  '/crm/leads': { screen: 'CRM' },
  '/crm': { screen: 'CRM' },
  '/notifications': { screen: 'Notifications' },
  '/payroll/payslips': { screen: 'Payslips' },
  '/payroll': { screen: 'Payslips' },
};

// Client-side group bucketing so the flat MAIN section gets visual grouping
const ITEM_TO_GROUP: Record<string, string> = {
  dashboard: 'WORKSPACE',
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
  sales: 'OPERATIONS',
  offboarding: 'OPERATIONS',
  settings: 'SYSTEM',
};

const GROUP_ORDER = ['WORKSPACE', 'FINANCE', 'OPERATIONS', 'SYSTEM'];

// Items that are fully implemented and always shown (no WIP badge)
const ALWAYS_ON_ITEMS: { group: string; id: string; title: string; icon: string; route: string }[] = [
  { group: 'WORKSPACE', id: 'notifications', title: 'Notifications', icon: 'bell', route: '/notifications' },
  { group: 'FINANCE',   id: 'payslips',       title: 'Payslips',       icon: 'file-text', route: '/payroll/payslips' },
];

// Items that are always shown as WIP regardless of what the API returns
const WIP_ITEMS: { group: string; id: string; title: string; icon: string }[] = [
  { group: 'WORKSPACE', id: 'recruitment', title: 'Recruitment', icon: 'users' },
  { group: 'WORKSPACE', id: 'performance', title: 'Performance', icon: 'target' },
  { group: 'FINANCE', id: 'assets', title: 'Assets & IT', icon: 'package' },
  { group: 'OPERATIONS', id: 'offboarding', title: 'Offboarding', icon: 'door-open' },
  { group: 'OPERATIONS', id: 'appreciation', title: 'Appreciation', icon: 'trophy' },
];

function getIcon(iconName?: string): React.ComponentType<any> {
  if (iconName && ICON_MAP[iconName]) return ICON_MAP[iconName];
  return Briefcase;
}

function resolveNav(item: MenuItem): { screen: string; params?: any } | null {
  // Check top-level route first
  if (item.route && ROUTE_TO_NAV[item.route]) {
    return ROUTE_TO_NAV[item.route];
  }
  // For items with subitems, find first navigable subitem
  if (item.subItems?.length) {
    for (const sub of item.subItems) {
      if (sub.route && ROUTE_TO_NAV[sub.route]) {
        return ROUTE_TO_NAV[sub.route];
      }
    }
  }
  return null;
}

// Group items from a flat section into visual sections, merging WIP supplements
function groupItems(items: MenuItem[]): { group: string; items: (MenuItem & { wip?: boolean })[] }[] {
  const groups: Record<string, (MenuItem & { wip?: boolean })[]> = {};
  const existingIds = new Set(items.map(i => i.id));

  for (const item of items) {
    const group = ITEM_TO_GROUP[item.id] || ITEM_TO_GROUP[item.route?.replace('/', '') || ''] || 'WORKSPACE';
    if (!groups[group]) groups[group] = [];
    groups[group].push(item);
  }

  // Merge always-on items (fully implemented, no WIP badge)
  for (const item of ALWAYS_ON_ITEMS) {
    if (!existingIds.has(item.id)) {
      if (!groups[item.group]) groups[item.group] = [];
      groups[item.group].push({ id: item.id, title: item.title, icon: item.icon, route: item.route });
    }
  }

  // Merge WIP items that weren't returned by the API
  for (const wip of WIP_ITEMS) {
    if (!existingIds.has(wip.id)) {
      if (!groups[wip.group]) groups[wip.group] = [];
      groups[wip.group].push({ id: wip.id, title: wip.title, icon: wip.icon, wip: true });
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
  }, [visible]);

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
      navigation.navigate(nav.screen, nav.params);
    } else {
      setComingSoon(true);
    }
  }

  function handleSubItemPress(sub: MenuItem) {
    const nav = resolveNav(sub);
    if (nav) {
      onClose();
      navigation.navigate(nav.screen, nav.params);
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

  // Flatten the API sections: the API returns [{title:'MAIN', items:[...]}]
  // We take all items from all sections and group them ourselves for visual clarity
  const allItems: MenuItem[] = sections.flatMap(s => s.items);
  const grouped = groupItems(allItems);

  return (
    <>
      <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
        <View style={styles.overlay}>
          <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />

          <View style={styles.panel}>
            <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.scrollContent}
              >
                {/* Header — company name + logo from API */}
                <View style={styles.header}>
                  <View style={styles.brandGroup}>
                    {company?.logoUrl ? (
                      <Image source={{ uri: company.logoUrl }} style={styles.companyLogo} />
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
                      <Text style={styles.brandSubtitle}>Employee Workspace</Text>
                    </View>
                  </View>
                  <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.7}>
                    <X size={18} color="#0F172A" />
                  </TouchableOpacity>
                </View>

                {/* Menu items */}
                {isLoading ? (
                  <View style={styles.loadingBox}>
                    <ActivityIndicator size="small" color="#E25E3E" />
                    <Text style={styles.loadingText}>Loading menu…</Text>
                  </View>
                ) : allItems.length === 0 ? (
                  // API returned nothing — show static fallback with working items + WIP section
                  <StaticMenuFallback
                    activeScreen={activeScreen}
                    activeProjectsCount={activeProjectsCount}
                    totalLeaveRemaining={totalLeaveRemaining}
                    unreadCount={unreadCount}
                    onNavigate={(screen, params) => { onClose(); navigation.navigate(screen, params); }}
                    onComingSoon={() => setComingSoon(true)}
                  />
                ) : (
                  grouped.map(({ group, items: groupItems }) => (
                    <View key={group}>
                      <Text style={styles.groupLabel}>{group}</Text>
                      {groupItems.map(item => {
                        const isWip = !!(item as any).wip;
                        const isActive = !isWip && activeScreen === resolveNav(item)?.screen;
                        const badge = isWip ? 0 : getBadge(item);
                        const Icon = getIcon(item.icon);
                        const isExpanded = expandedIds.has(item.id);
                        const hasSubItems = !isWip && !!item.subItems?.length;

                        return (
                          <View key={item.id}>
                            <TouchableOpacity
                              style={[styles.item, isActive && styles.itemActive]}
                              activeOpacity={0.75}
                              onPress={() => isWip ? setComingSoon(true) : handleItemPress(item)}
                            >
                              <View style={styles.itemLeft}>
                                <View style={[styles.iconBox, isActive && styles.iconBoxActive]}>
                                  <Icon size={18} color={isActive ? '#E25E3E' : isWip ? '#CBD5E1' : '#64748B'} />
                                </View>
                                <Text style={[styles.itemText, isActive && styles.itemTextActive, isWip && styles.itemTextWip]}>
                                  {item.title}
                                </Text>
                              </View>
                              <View style={styles.itemRight}>
                                {badge > 0 && (
                                  <View style={styles.badge}>
                                    <Text style={styles.badgeText}>{badge}</Text>
                                  </View>
                                )}
                                {isWip ? (
                                  <View style={styles.wipBadge}>
                                    <Text style={styles.wipBadgeText}>WIP</Text>
                                  </View>
                                ) : hasSubItems ? (
                                  <ChevronDown
                                    size={16}
                                    color="#CBD5E1"
                                    style={{ transform: [{ rotate: isExpanded ? '180deg' : '0deg' }] }}
                                  />
                                ) : (
                                  <ChevronRight size={16} color={isActive ? '#FFFFFF' : '#CBD5E1'} />
                                )}
                              </View>
                            </TouchableOpacity>

                            {/* Sub-items */}
                            {hasSubItems && isExpanded && item.subItems!.map(sub => {
                              const subActive = activeScreen === resolveNav(sub)?.screen;
                              const SubIcon = getIcon(sub.icon || item.icon);
                              return (
                                <TouchableOpacity
                                  key={sub.id}
                                  style={[styles.subItem, subActive && styles.subItemActive]}
                                  activeOpacity={0.75}
                                  onPress={() => handleSubItemPress(sub)}
                                >
                                  <View style={styles.subItemDot} />
                                  <Text style={[styles.subItemText, subActive && styles.subItemTextActive]}>
                                    {sub.title}
                                  </Text>
                                </TouchableOpacity>
                              );
                            })}
                          </View>
                        );
                      })}
                    </View>
                  ))
                )}

                <View style={styles.divider} />

                <TouchableOpacity style={styles.item} activeOpacity={0.7} onPress={handleLogout}>
                  <View style={styles.itemLeft}>
                    <View style={styles.iconBox}><LogOut size={18} color="#EF4444" /></View>
                    <Text style={[styles.itemText, { color: '#EF4444' }]}>Logout</Text>
                  </View>
                </TouchableOpacity>
              </ScrollView>

              {/* Footer user card */}
              <TouchableOpacity
                style={styles.footerCard}
                activeOpacity={0.7}
                onPress={() => { onClose(); navigation.navigate('Profile'); }}
              >
                {profile?.avatarUrl ? (
                  <Image source={{ uri: profile.avatarUrl }} style={styles.footerAvatar} />
                ) : (
                  <View style={styles.footerAvatarPlaceholder}>
                    <Text style={styles.footerAvatarText}>
                      {getInitials(profile?.firstName, profile?.lastName, user?.email)}
                    </Text>
                  </View>
                )}
                <View style={styles.footerInfo}>
                  <Text style={styles.footerName} numberOfLines={1}>
                    {profile ? `${profile.firstName} ${profile.lastName}` : (user?.email?.split('@')[0] || 'Employee')}
                  </Text>
                  <Text style={styles.footerRole} numberOfLines={1}>
                    {(profile as any)?.designation?.name || (profile as any)?.jobTitle || user?.role || 'Employee'}
                  </Text>
                </View>
                <ChevronRight size={16} color="#CBD5E1" />
              </TouchableOpacity>

              {/* Modals rendered inside panel SafeAreaView so they appear on top of the drawer */}
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
        </View>
      </Modal>
    </>
  );
}

type StaticItem = { id: string; title: string; icon: string; screen: string | null; badge?: number; params?: any };

// Static fallback shown when API returns no menus (offline / error)
function StaticMenuFallback({
  activeScreen,
  activeProjectsCount,
  totalLeaveRemaining,
  unreadCount,
  onNavigate,
  onComingSoon,
}: {
  activeScreen: string;
  activeProjectsCount: number;
  totalLeaveRemaining: number;
  unreadCount: number;
  onNavigate: (screen: string, params?: any) => void;
  onComingSoon: () => void;
}) {
  const staticGroups: { group: string; items: StaticItem[] }[] = [
    {
      group: 'WORKSPACE',
      items: [
        { id: 'home', title: 'Home', icon: 'layout-dashboard', screen: 'Home' },
        { id: 'projects', title: 'Projects', icon: 'briefcase', screen: 'Projects', badge: activeProjectsCount },
        { id: 'attendance', title: 'Attendance', icon: 'calendar-clock', screen: 'Attendance', params: { initialTab: 'timesheets' } },
        { id: 'leaves', title: 'Leave', icon: 'calendar-clock', screen: 'Leaves', params: { initialTab: 'leaves' }, badge: totalLeaveRemaining },
        { id: 'notifications', title: 'Notifications', icon: 'bell', screen: 'Notifications', badge: unreadCount },
        { id: 'recruitment', title: 'Recruitment', icon: 'users', screen: null },
        { id: 'performance', title: 'Performance', icon: 'target', screen: null },
      ],
    },
    {
      group: 'FINANCE',
      items: [
        { id: 'payslips', title: 'Payslips', icon: 'file-text', screen: 'Payslips' },
        { id: 'payroll', title: 'Payroll', icon: 'banknote', screen: null },
        { id: 'expenses', title: 'Expenses', icon: 'file-text', screen: null },
        { id: 'assets', title: 'Assets & IT', icon: 'package', screen: null },
      ],
    },
    {
      group: 'OPERATIONS',
      items: [
        { id: 'offboarding', title: 'Offboarding', icon: 'door-open', screen: null },
        { id: 'appreciation', title: 'Appreciation', icon: 'trophy', screen: null },
      ],
    },
  ];

  return (
    <>
      {staticGroups.map(({ group, items }) => (
        <View key={group}>
          <Text style={styles.groupLabel}>{group}</Text>
          {items.map(item => {
            const isActive = activeScreen === item.screen;
            const Icon = getIcon(item.icon);
            return (
              <TouchableOpacity
                key={item.id}
                style={[styles.item, isActive && styles.itemActive]}
                activeOpacity={0.75}
                onPress={() => {
                  if (item.screen) onNavigate(item.screen, item.params);
                  else onComingSoon();
                }}
              >
                <View style={styles.itemLeft}>
                  <View style={[styles.iconBox, isActive && styles.iconBoxActive]}>
                    <Icon size={18} color={isActive ? '#E25E3E' : item.screen ? '#64748B' : '#CBD5E1'} />
                  </View>
                  <Text style={[styles.itemText, isActive && styles.itemTextActive, !item.screen && styles.itemTextWip]}>
                    {item.title}
                  </Text>
                </View>
                <View style={styles.itemRight}>
                  {(item.badge ?? 0) > 0 && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{item.badge}</Text>
                    </View>
                  )}
                  {!item.screen ? (
                    <View style={styles.wipBadge}>
                      <Text style={styles.wipBadgeText}>WIP</Text>
                    </View>
                  ) : (
                    <ChevronRight size={16} color={isActive ? '#FFFFFF' : '#CBD5E1'} />
                  )}
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
    backgroundColor: 'rgba(15,23,42,0.45)',
  },
  backdrop: {
    flex: 1,
  },
  panel: {
    width: PANEL_WIDTH,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: -2, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 12,
  },
  scrollContent: {
    paddingBottom: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  brandGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    marginRight: 8,
  },
  logoBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#E25E3E',
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 18,
  },
  companyLogo: {
    width: 36,
    height: 36,
    borderRadius: 10,
    resizeMode: 'contain',
  },
  brandTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  brandSubtitle: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '500',
  },
  closeBtn: {
    width: 34,
    height: 34,
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
  groupLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 1,
    marginTop: 20,
    marginBottom: 4,
    paddingHorizontal: 20,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginHorizontal: 8,
    borderRadius: 12,
    marginBottom: 2,
  },
  itemActive: {
    backgroundColor: '#E25E3E',
  },
  itemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  iconBox: {
    width: 34,
    height: 34,
    borderRadius: 9,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconBoxActive: {
    backgroundColor: '#FFF1EC',
    borderColor: '#FFDDD5',
  },
  itemText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#334155',
  },
  itemTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  itemRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  badge: {
    backgroundColor: '#E25E3E',
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
    minWidth: 22,
    alignItems: 'center',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  wipBadge: {
    backgroundColor: '#FEF3C7',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  wipBadgeText: {
    color: '#92400E',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  itemTextWip: {
    color: '#94A3B8',
  },
  subItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 9,
    marginHorizontal: 8,
    marginLeft: 24,
    borderRadius: 10,
    marginBottom: 1,
    gap: 10,
  },
  subItemActive: {
    backgroundColor: '#FFF1EC',
  },
  subItemDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#CBD5E1',
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
  divider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginHorizontal: 20,
    marginVertical: 12,
  },
  footerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    marginHorizontal: 8,
    marginBottom: 8,
    borderRadius: 14,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#F1F5F9',
    gap: 12,
  },
  footerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 12,
  },
  footerAvatarPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#E25E3E',
    justifyContent: 'center',
    alignItems: 'center',
  },
  footerAvatarText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  footerInfo: {
    flex: 1,
  },
  footerName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  footerRole: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
});
