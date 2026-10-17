import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { CheckSquare, Ticket, Award, ChevronRight, Sparkles, Calendar } from 'lucide-react-native';
import { apiClient } from '../../api/apiClient';

/**
 * The three home sections the web dashboard also shows — My Tasks, My Tickets
 * and Employee Appreciations — read from the same GET /dashboard payload, so
 * the phone and the web agree on what is pending without a second set of
 * queries.
 */

export interface HomeTask {
  id: number;
  key?: string;
  title: string;
  status?: string;
  priority?: string;
  dueDate?: string | null;
  projectId?: number;
  project?: { id: number; name: string } | null;
}

export interface HomeTicket {
  id: number;
  ticketNumber?: string;
  title: string;
  status?: string;
  priority?: string;
  createdAt?: string;
}

export interface HomeAppreciation {
  id: number;
  awardTitle?: string;
  summary?: string;
  givenDate?: string;
  employee?: { firstName: string; lastName: string; designation?: string | null } | null;
}

export interface HomeSectionsData {
  myTasks: HomeTask[];
  myTickets: HomeTicket[];
  appreciations: HomeAppreciation[];
}

export async function fetchHomeSections(): Promise<HomeSectionsData> {
  const { data } = await apiClient.get('/dashboard');
  const common = data?.common ?? {};
  return {
    myTasks: common.myTasks ?? [],
    myTickets: common.myTickets ?? [],
    appreciations: common.appreciations ?? [],
  };
}

const MAX_ROWS = 4;

function shortDate(value?: string | null): string {
  if (!value) return 'No due date';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function humanize(value?: string): string {
  if (!value) return '';
  return value.replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase());
}

function getPriorityStyle(priority?: string) {
  const p = (priority || '').toUpperCase();
  if (p === 'CRITICAL' || p === 'URGENT' || p === 'HIGH') {
    return { bg: '#FEF2F2', text: '#DC2626', border: '#FECACA' };
  }
  if (p === 'MEDIUM') {
    return { bg: '#FFFBEB', text: '#D97706', border: '#FDE68A' };
  }
  return { bg: '#F1F5F9', text: '#475569', border: '#E2E8F0' };
}

export function WorkspaceHubSection({
  data,
  loading,
  onOpenTask,
  onViewTasks,
  onViewTickets,
}: {
  data: HomeSectionsData;
  loading: boolean;
  onOpenTask: (task: HomeTask) => void;
  onViewTasks: () => void;
  onViewTickets: () => void;
}) {
  const [activeTab, setActiveTab] = useState<'tasks' | 'tickets' | 'kudos'>('tasks');

  const tabs = [
    {
      key: 'tasks' as const,
      label: 'Tasks',
      count: data.myTasks.length,
      Icon: CheckSquare,
      activeColor: '#2563EB',
      activeBg: '#EFF6FF',
    },
    {
      key: 'tickets' as const,
      label: 'Tickets',
      count: data.myTickets.length,
      Icon: Ticket,
      activeColor: '#DB2777',
      activeBg: '#FDF2F8',
    },
    {
      key: 'kudos' as const,
      label: 'Kudos',
      count: data.appreciations.length,
      Icon: Award,
      activeColor: '#D97706',
      activeBg: '#FFFBEB',
    },
  ];

  return (
    <View style={styles.hubCard}>
      {/* Segmented Header Bar */}
      <View style={styles.tabBar}>
        {tabs.map((tab) => {
          const isActive = activeTab === tab.key;
          const TabIcon = tab.Icon;
          return (
            <TouchableOpacity
              key={tab.key}
              style={[styles.tabPill, isActive && styles.tabPillActive]}
              activeOpacity={0.8}
              onPress={() => setActiveTab(tab.key)}
            >
              <TabIcon
                size={14}
                color={isActive ? tab.activeColor : '#64748B'}
                strokeWidth={2.3}
              />
              <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
                {tab.label}
              </Text>
              <View
                style={[
                  styles.tabCountBadge,
                  isActive ? { backgroundColor: tab.activeBg } : styles.tabCountBadgeIdle,
                ]}
              >
                <Text
                  style={[
                    styles.tabCountText,
                    isActive ? { color: tab.activeColor } : styles.tabCountTextIdle,
                  ]}
                >
                  {tab.count}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Content Area */}
      {loading ? (
        <View style={styles.loaderWrap}>
          <ActivityIndicator color="#1373e5" />
        </View>
      ) : activeTab === 'tasks' ? (
        data.myTasks.length === 0 ? (
          <View style={styles.emptyBox}>
            <View style={[styles.emptyIconCircle, { backgroundColor: '#EFF6FF' }]}>
              <CheckSquare size={20} color="#2563EB" strokeWidth={2.2} />
            </View>
            <Text style={styles.emptyTitle}>All tasks cleared</Text>
            <Text style={styles.emptySub}>You have no active tasks assigned right now.</Text>
          </View>
        ) : (
          <View style={styles.listWrap}>
            {data.myTasks.slice(0, MAX_ROWS).map((t, i) => {
              const prio = getPriorityStyle(t.priority);
              return (
                <TouchableOpacity
                  key={t.id}
                  style={[styles.itemRow, i > 0 && styles.itemDivider]}
                  activeOpacity={0.75}
                  disabled={!(t.projectId ?? t.project?.id)}
                  onPress={() => onOpenTask(t)}
                >
                  <View style={styles.itemLeftAccent} />
                  <View style={styles.itemMain}>
                    <View style={styles.itemTopMetaRow}>
                      {t.key ? (
                        <Text style={styles.itemCodeTag}>{t.key}</Text>
                      ) : null}
                      {t.priority ? (
                        <View style={[styles.prioPill, { backgroundColor: prio.bg, borderColor: prio.border }]}>
                          <Text style={[styles.prioPillText, { color: prio.text }]}>
                            {humanize(t.priority)}
                          </Text>
                        </View>
                      ) : null}
                      {t.status ? (
                        <Text style={styles.statusText}>{humanize(t.status)}</Text>
                      ) : null}
                    </View>
                    <Text style={styles.itemTitle} numberOfLines={1}>
                      {t.title}
                    </Text>
                  </View>
                  <View style={styles.itemRightCol}>
                    <View style={styles.dateChip}>
                      <Calendar size={11} color="#64748B" />
                      <Text style={styles.dateChipText}>{shortDate(t.dueDate)}</Text>
                    </View>
                    <ChevronRight size={15} color="#CBD5E1" />
                  </View>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity style={styles.footerLinkBtn} activeOpacity={0.75} onPress={onViewTasks}>
              <Text style={styles.footerLinkText}>Open Project Boards</Text>
              <ChevronRight size={14} color="#1373e5" strokeWidth={2.4} />
            </TouchableOpacity>
          </View>
        )
      ) : activeTab === 'tickets' ? (
        data.myTickets.length === 0 ? (
          <View style={styles.emptyBox}>
            <View style={[styles.emptyIconCircle, { backgroundColor: '#FDF2F8' }]}>
              <Ticket size={20} color="#DB2777" strokeWidth={2.2} />
            </View>
            <Text style={styles.emptyTitle}>No open helpdesk tickets</Text>
            <Text style={styles.emptySub}>Need IT or HR support? Raise a ticket anytime.</Text>
            <TouchableOpacity style={styles.emptyCtaBtn} activeOpacity={0.8} onPress={onViewTickets}>
              <Text style={styles.emptyCtaText}>Go to Helpdesk</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.listWrap}>
            {data.myTickets.slice(0, MAX_ROWS).map((t, i) => {
              const prio = getPriorityStyle(t.priority);
              return (
                <TouchableOpacity
                  key={t.id}
                  style={[styles.itemRow, i > 0 && styles.itemDivider]}
                  activeOpacity={0.75}
                  onPress={onViewTickets}
                >
                  <View style={[styles.itemLeftAccent, { backgroundColor: '#DB2777' }]} />
                  <View style={styles.itemMain}>
                    <View style={styles.itemTopMetaRow}>
                      {t.ticketNumber ? (
                        <Text style={[styles.itemCodeTag, { color: '#be185d', backgroundColor: '#fdf2f8' }]}>
                          {t.ticketNumber}
                        </Text>
                      ) : null}
                      {t.priority ? (
                        <View style={[styles.prioPill, { backgroundColor: prio.bg, borderColor: prio.border }]}>
                          <Text style={[styles.prioPillText, { color: prio.text }]}>
                            {humanize(t.priority)}
                          </Text>
                        </View>
                      ) : null}
                      {t.status ? (
                        <Text style={styles.statusText}>{humanize(t.status)}</Text>
                      ) : null}
                    </View>
                    <Text style={styles.itemTitle} numberOfLines={1}>
                      {t.title}
                    </Text>
                  </View>
                  <View style={styles.itemRightCol}>
                    <Text style={styles.dateChipText}>{shortDate(t.createdAt)}</Text>
                    <ChevronRight size={15} color="#CBD5E1" />
                  </View>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity style={styles.footerLinkBtn} activeOpacity={0.75} onPress={onViewTickets}>
              <Text style={styles.footerLinkText}>View All Tickets</Text>
              <ChevronRight size={14} color="#1373e5" strokeWidth={2.4} />
            </TouchableOpacity>
          </View>
        )
      ) : data.appreciations.length === 0 ? (
        <View style={styles.emptyBox}>
          <View style={[styles.emptyIconCircle, { backgroundColor: '#FFFBEB' }]}>
            <Sparkles size={20} color="#D97706" strokeWidth={2.2} />
          </View>
          <Text style={styles.emptyTitle}>Team Recognition</Text>
          <Text style={styles.emptySub}>Employee awards and appreciations appear here.</Text>
        </View>
      ) : (
        <View style={styles.listWrap}>
          {data.appreciations.slice(0, MAX_ROWS).map((a, i) => {
            const name = a.employee ? `${a.employee.firstName} ${a.employee.lastName}`.trim() : 'Team member';
            return (
              <View key={a.id} style={[styles.itemRow, i > 0 && styles.itemDivider]}>
                <View style={styles.kudosAvatar}>
                  <Text style={styles.kudosAvatarText}>{(a.employee?.firstName || '?').charAt(0)}</Text>
                </View>
                <View style={styles.itemMain}>
                  <Text style={styles.itemTitle} numberOfLines={1}>{name}</Text>
                  <Text style={styles.kudosAwardTitle} numberOfLines={1}>
                    {a.awardTitle || 'Excellence Award'}
                  </Text>
                  {a.summary ? (
                    <Text style={styles.kudosSummary} numberOfLines={2}>{a.summary}</Text>
                  ) : null}
                </View>
                <Text style={styles.dateChipText}>{shortDate(a.givenDate)}</Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  hubCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 14,
    padding: 4,
    gap: 4,
    marginBottom: 12,
  },
  tabPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 11,
    gap: 5,
  },
  tabPillActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  tabLabel: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#64748B',
  },
  tabLabelActive: {
    color: '#0F172A',
    fontWeight: '800',
  },
  tabCountBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 8,
    minWidth: 20,
    alignItems: 'center',
  },
  tabCountBadgeIdle: {
    backgroundColor: '#E2E8F0',
  },
  tabCountText: {
    fontSize: 10.5,
    fontWeight: '800',
  },
  tabCountTextIdle: {
    color: '#64748B',
  },
  loaderWrap: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  emptyBox: {
    paddingVertical: 22,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  emptyIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  emptyTitle: {
    fontSize: 14.5,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 3,
  },
  emptySub: {
    fontSize: 12.5,
    color: '#64748B',
    textAlign: 'center',
  },
  emptyCtaBtn: {
    marginTop: 12,
    backgroundColor: '#FDF2F8',
    borderWidth: 1,
    borderColor: '#FBCFE8',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 10,
  },
  emptyCtaText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#DB2777',
  },
  listWrap: {
    paddingTop: 2,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    gap: 10,
  },
  itemDivider: {
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  itemLeftAccent: {
    width: 3.5,
    height: 32,
    borderRadius: 2,
    backgroundColor: '#2563EB',
  },
  itemMain: {
    flex: 1,
    minWidth: 0,
  },
  itemTopMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 3,
  },
  itemCodeTag: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#1D4ED8',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 5,
    overflow: 'hidden',
  },
  prioPill: {
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 5,
    borderWidth: 1,
  },
  prioPillText: {
    fontSize: 10,
    fontWeight: '800',
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  itemTitle: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#0F172A',
  },
  itemRightCol: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: 6,
  },
  dateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 7,
    paddingVertical: 3.5,
    borderRadius: 7,
  },
  dateChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  footerLinkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingTop: 11,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  footerLinkText: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#1373e5',
  },
  kudosAvatar: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  kudosAvatarText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#B45309',
  },
  kudosAwardTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#D97706',
    marginTop: 1,
  },
  kudosSummary: {
    fontSize: 11.5,
    color: '#64748B',
    marginTop: 2,
  },
});
