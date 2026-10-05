import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { CheckSquare, Ticket, Award } from 'lucide-react-native';
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

const MAX_ROWS = 5;

function shortDate(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function humanize(value?: string): string {
  if (!value) return '';
  return value.replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase());
}

function SectionShell({
  title, subtitle, icon, iconBg, count, onViewAll, loading, emptyText, children,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  iconBg: string;
  count: number;
  onViewAll?: () => void;
  loading: boolean;
  emptyText: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={[styles.iconBadge, { backgroundColor: iconBg }]}>{icon}</View>
        <View style={styles.headerText}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
        {onViewAll ? (
          <TouchableOpacity activeOpacity={0.7} onPress={onViewAll}>
            <Text style={styles.viewAll}>View all</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {loading ? (
        <ActivityIndicator style={styles.loader} color="#1373e5" />
      ) : count === 0 ? (
        <Text style={styles.empty}>{emptyText}</Text>
      ) : (
        children
      )}
    </View>
  );
}

export function MyTasksSection({
  tasks, loading, onOpenTask,
}: { tasks: HomeTask[]; loading: boolean; onOpenTask: (task: HomeTask) => void }) {
  return (
    <SectionShell
      title="My Tasks"
      subtitle="Current items in progress"
      icon={<CheckSquare size={18} color="#4F46E5" />}
      iconBg="#EEF2FF"
      count={tasks.length}
      loading={loading}
      emptyText="No pending tasks."
    >
      {tasks.slice(0, MAX_ROWS).map((t, i) => (
        <TouchableOpacity
          key={t.id}
          style={[styles.row, i > 0 && styles.rowDivider]}
          activeOpacity={0.7}
          disabled={!(t.projectId ?? t.project?.id)}
          onPress={() => onOpenTask(t)}
        >
          <View style={styles.rowMain}>
            <Text style={styles.rowTitle} numberOfLines={1}>{t.title}</Text>
            <Text style={styles.rowMeta} numberOfLines={1}>
              {[t.key, humanize(t.status), t.priority ? humanize(t.priority) : null].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <Text style={styles.rowDate}>Due {shortDate(t.dueDate)}</Text>
        </TouchableOpacity>
      ))}
    </SectionShell>
  );
}

export function MyTicketsSection({
  tickets, loading, onViewAll,
}: { tickets: HomeTicket[]; loading: boolean; onViewAll: () => void }) {
  return (
    <SectionShell
      title="My Tickets"
      subtitle="Helpdesk requests you raised"
      icon={<Ticket size={18} color="#DB2777" />}
      iconBg="#FDF2F8"
      count={tickets.length}
      onViewAll={onViewAll}
      loading={loading}
      emptyText="No open tickets."
    >
      {tickets.slice(0, MAX_ROWS).map((t, i) => (
        <TouchableOpacity
          key={t.id}
          style={[styles.row, i > 0 && styles.rowDivider]}
          activeOpacity={0.7}
          onPress={onViewAll}
        >
          <View style={styles.rowMain}>
            <Text style={styles.rowTitle} numberOfLines={1}>{t.title}</Text>
            <Text style={styles.rowMeta} numberOfLines={1}>
              {[t.ticketNumber, humanize(t.status), t.priority ? humanize(t.priority) : null].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <Text style={styles.rowDate}>{shortDate(t.createdAt)}</Text>
        </TouchableOpacity>
      ))}
    </SectionShell>
  );
}

export function AppreciationsSection({
  items, loading,
}: { items: HomeAppreciation[]; loading: boolean }) {
  return (
    <SectionShell
      title="Employee Appreciations"
      subtitle="Recognition across the team"
      icon={<Award size={18} color="#D97706" />}
      iconBg="#FFFBEB"
      count={items.length}
      loading={loading}
      emptyText="Appreciations will show up here when awarded."
    >
      {items.slice(0, MAX_ROWS).map((a, i) => {
        const name = a.employee ? `${a.employee.firstName} ${a.employee.lastName}` : 'Team member';
        return (
          <View key={a.id} style={[styles.row, i > 0 && styles.rowDivider]}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{(a.employee?.firstName || '?').charAt(0)}</Text>
            </View>
            <View style={styles.rowMain}>
              <Text style={styles.rowTitle} numberOfLines={1}>{name}</Text>
              <Text style={styles.awardTitle} numberOfLines={1}>{a.awardTitle || 'Appreciation'}</Text>
              {a.summary ? <Text style={styles.rowMeta} numberOfLines={2}>{a.summary}</Text> : null}
            </View>
            <Text style={styles.rowDate}>{shortDate(a.givenDate)}</Text>
          </View>
        );
      })}
    </SectionShell>
  );
}

const styles = StyleSheet.create({
  card: {
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  iconBadge: {
    width: 36,
    height: 36,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  subtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 1,
  },
  viewAll: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1373e5',
  },
  loader: {
    paddingVertical: 16,
  },
  empty: {
    fontSize: 13,
    color: '#94A3B8',
    textAlign: 'center',
    paddingVertical: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
  },
  rowDivider: {
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  rowMain: {
    flex: 1,
  },
  rowTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
  },
  rowMeta: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  rowDate: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
  },
  awardTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#D97706',
    marginTop: 1,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#FEF3C7',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#B45309',
  },
});
