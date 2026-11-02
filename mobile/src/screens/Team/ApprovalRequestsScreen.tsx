import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
  ScrollView,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import {
  Check,
  X,
  Timer,
  ClipboardCheck,
  Sparkles,
  Info,
  MapPin,
  FileText,
  Navigation,
  Search,
  ArrowUpDown,
  CheckCheck,
  CheckSquare,
  Square,
  MessageSquare,
  Clock,
  CheckCircle2,
  ChevronRight,
} from 'lucide-react-native';
import AppScreen from '../../components/AppScreen';
import { apiClient } from '../../api/apiClient';
import { Avatar, PersonTap, PersonLite, PersonSheetHost } from '../../components/PersonSheet';
import { htmlToText } from '../../utils/htmlText';
import { theme } from '../../theme/theme';

/**
 * Delivery approvals: the same queues as the web's Approval Requests page
 * (task hours, task approvals, budget, scope, visit locations, field visits,
 * project tickets). The server decides who may approve each one.
 */
type QueueKey = 'HOURS' | 'TASKS' | 'BUDGET' | 'SCOPE' | 'LOCATIONS' | 'VISITS' | 'TICKETS';

type Row = {
  id: number;
  raw: any;
  person: PersonLite | null;
  title: string;
  project?: string | null;
  lines: string[];
  reason?: string | null;
  date?: string | null;
  metricHighlight?: string | null;
};

type Queue = {
  key: QueueKey;
  label: string;
  badgeLabel: string;
  Icon: any;
  theme: { bg: string; border: string; text: string };
  load: () => Promise<any[]>;
  toRow: (r: any) => Row;
  approve: (r: any) => Promise<unknown>;
  reject: (r: any, reason: string) => Promise<unknown>;
};

const QUICK_REASONS = [
  'Incomplete specification',
  'Scope exceeds allocation',
  'Client approval required',
  'Incorrect hours requested',
  'Duplicate submission',
];

type Period = 'ALL' | 'TODAY' | 'YESTERDAY' | '7' | '30' | 'MONTH';
const PERIODS: { key: Period; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'TODAY', label: 'Today' },
  { key: 'YESTERDAY', label: 'Yesterday' },
  { key: '7', label: '7d' },
  { key: '30', label: '30d' },
  { key: 'MONTH', label: 'Month' },
];

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const periodRange = (p: Period): [string, string] | null => {
  if (p === 'ALL') return null;
  const now = new Date();
  const start = new Date(now);
  if (p === 'YESTERDAY') {
    start.setDate(start.getDate() - 1);
    return [ymd(start), ymd(start)];
  }
  if (p === '7' || p === '30') start.setDate(start.getDate() - (Number(p) - 1));
  if (p === 'MONTH') start.setDate(1);
  return [ymd(start), ymd(now)];
};

const get = (url: string, params?: any) => apiClient.get(url, { params }).then((r) => r.data || []);
const post = (url: string, body: any) => apiClient.post(url, body);
const pending = (s?: string) => !s || /^(PENDING|REQUESTED)/.test(String(s).toUpperCase());
const projectOf = (r: any) => r.project?.name || r.issue?.project?.name || r.projectName || null;
const hrs = (n?: number | null) => (n == null ? null : `${n}h`);

const waitingDays = (d?: string | null) => {
  if (!d) return 0;
  const t = new Date(d).getTime();
  return isNaN(t) ? 0 : Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
};

const ago = (d?: string | null) => {
  if (!d) return '';
  const days = waitingDays(d);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days}d ago`;
};

const QUEUES: Queue[] = [
  {
    key: 'HOURS',
    label: 'Task hours',
    badgeLabel: 'Task Hours',
    Icon: Timer,
    theme: { bg: '#EFF6FF', border: '#BFDBFE', text: '#1D4ED8' },
    load: async () => (await get('/task-hours-requests')).filter((r: any) => r.status === 'REQUESTED'),
    toRow: (r) => ({
      id: r.id,
      raw: r,
      person: r.requestedBy,
      project: projectOf(r),
      title: [r.issue?.key, r.issue?.title].filter(Boolean).join(' · ') || 'Task',
      metricHighlight: r.requestedHours != null ? `+${r.requestedHours}h requested` : null,
      lines: [`Asks for ${hrs(r.requestedHours)} more`],
      reason: r.reason,
      date: r.createdAt,
    }),
    approve: (r) =>
      apiClient.patch(`/task-hours-requests/${r.id}/review`, {
        decision: 'APPROVED',
        approvedHours: r.requestedHours,
      }),
    reject: (r, reason) =>
      apiClient.patch(`/task-hours-requests/${r.id}/review`, { decision: 'REJECTED', reason }),
  },
  {
    key: 'TASKS',
    label: 'Task approvals',
    badgeLabel: 'Task Approval',
    Icon: ClipboardCheck,
    theme: { bg: '#F5F3FF', border: '#DDD6FE', text: '#7C3AED' },
    load: () => get('/task-approvals/pending'),
    toRow: (r) => ({
      id: r.id,
      raw: r,
      person: r.approvalRequestedBy || r.reporter || r.assignee || null,
      project: projectOf(r),
      title: [r.key, r.title].filter(Boolean).join(' · ') || 'Task',
      metricHighlight: r.approvalState === 'PENDING_TECHNICAL' ? 'Technical review' : 'Administrator review',
      lines: [
        r.approvalState === 'PENDING_TECHNICAL' ? 'Waiting for technical review' : 'Waiting for administrator',
        [r.estimatedHours != null && `${r.estimatedHours}h estimate`, r.priority].filter(Boolean).join(' · '),
      ].filter(Boolean) as string[],
      reason: htmlToText(r.description).slice(0, 300) || null,
      date: r.createdAt,
    }),
    approve: (r) =>
      post(`/projects/${r.projectId ?? r.project?.id}/issues/${r.id}/approval`, { action: 'APPROVE' }),
    reject: (r, reason) =>
      post(`/projects/${r.projectId ?? r.project?.id}/issues/${r.id}/approval`, { action: 'REJECT', reason }),
  },
  {
    key: 'BUDGET',
    label: 'Budget',
    badgeLabel: 'Budget Request',
    Icon: Sparkles,
    theme: { bg: '#ECFDF5', border: '#A7F3D0', text: '#047857' },
    load: () => get('/budget-requests/pending'),
    toRow: (r) => ({
      id: r.id,
      raw: r,
      person: r.requestedBy || r.createdBy || null,
      project: projectOf(r),
      title: projectOf(r) || 'Budget change',
      metricHighlight:
        r.additionalBudget != null
          ? `+₹${Number(r.additionalBudget).toLocaleString('en-IN')}`
          : r.additionalHours != null
          ? `+${r.additionalHours}h`
          : null,
      lines: [
        r.additionalHours != null &&
          `+${r.additionalHours}h${r.hoursBefore != null ? ` (${r.hoursBefore}h → ${r.hoursAfter}h)` : ''}`,
        r.additionalBudget != null && `+₹${Number(r.additionalBudget).toLocaleString('en-IN')}`,
      ].filter(Boolean) as string[],
      reason: r.reason,
      date: r.createdAt,
    }),
    approve: (r) => post(`/budget-requests/${r.id}/review`, { decision: 'APPROVED' }),
    reject: (r, reason) => post(`/budget-requests/${r.id}/review`, { decision: 'REJECTED', reason }),
  },
  {
    key: 'SCOPE',
    label: 'Scope',
    badgeLabel: 'Scope Change',
    Icon: Info,
    theme: { bg: '#F0F9FF', border: '#BAE6FD', text: '#0284C7' },
    load: () => get('/scope-requests/pending'),
    toRow: (r) => ({
      id: r.id,
      raw: r,
      person: r.requestedBy || r.createdBy || null,
      project: projectOf(r),
      title: r.title || 'Scope change',
      metricHighlight: 'Scope adjustment',
      lines: [r.scope].filter(Boolean),
      reason: htmlToText(r.body || r.reason) || null,
      date: r.createdAt,
    }),
    approve: (r) => post(`/scope-requests/${r.id}/review`, { decision: 'APPROVED' }),
    reject: (r, reason) => post(`/scope-requests/${r.id}/review`, { decision: 'REJECTED', note: reason }),
  },
  {
    key: 'LOCATIONS',
    label: 'Visit locations',
    badgeLabel: 'Location Request',
    Icon: MapPin,
    theme: { bg: '#FFF1F2', border: '#FECDD3', text: '#BE123C' },
    load: async () => (await get('/visit-location-requests')).filter((r: any) => pending(r.status)),
    toRow: (r) => ({
      id: r.id,
      raw: r,
      person: r.requestedBy || r.createdBy || r.employee || null,
      project: projectOf(r),
      title: r.name || 'New visit location',
      metricHighlight: 'New Location',
      lines: [r.address].filter(Boolean),
      reason: r.reason,
      date: r.createdAt,
    }),
    approve: (r) => post(`/visit-location-requests/${r.id}/review`, { decision: 'APPROVED' }),
    reject: (r, reason) => post(`/visit-location-requests/${r.id}/review`, { decision: 'REJECTED', reason }),
  },
  {
    key: 'VISITS',
    label: 'Field visits',
    badgeLabel: 'Field Visit',
    Icon: Navigation,
    theme: { bg: '#F0FDFA', border: '#99F6E4', text: '#0F766E' },
    load: () => get('/field-visit-requests', { status: 'PENDING_APPROVAL' }),
    toRow: (r) => ({
      id: r.id,
      raw: r,
      person: r.requestedBy || r.employee || r.createdBy || null,
      project: projectOf(r),
      title: [r.requestNumber, r.location || r.locationName].filter(Boolean).join(' · ') || 'Field visit',
      metricHighlight: r.startDate
        ? `${String(r.startDate).slice(0, 10)}${r.endDate ? ` → ${String(r.endDate).slice(0, 10)}` : ''}`
        : null,
      lines: [
        r.startDate && `${String(r.startDate).slice(0, 10)}${r.endDate ? ` → ${String(r.endDate).slice(0, 10)}` : ''}`,
      ].filter(Boolean) as string[],
      reason: r.purpose || r.reason,
      date: r.createdAt,
    }),
    approve: (r) => post(`/field-visit-requests/${r.id}/approve`, {}),
    reject: (r, reason) => post(`/field-visit-requests/${r.id}/reject`, { reason }),
  },
  {
    key: 'TICKETS',
    label: 'Project tickets',
    badgeLabel: 'Project Ticket',
    Icon: FileText,
    theme: { bg: '#F8FAFC', border: '#CBD5E1', text: '#334155' },
    load: () => get('/project-tickets/pending'),
    toRow: (r) => ({
      id: r.id,
      raw: r,
      person: r.raisedBy || null,
      project: projectOf(r),
      title: [r.ticketNumber, r.title].filter(Boolean).join(' · '),
      metricHighlight: r.priority ? `${r.priority} Priority` : null,
      lines: [
        [
          r.priority,
          r.estimatedHours != null && `${r.estimatedHours}h`,
          r.dueDate && `due ${String(r.dueDate).slice(0, 10)}`,
        ]
          .filter(Boolean)
          .join(' · '),
      ].filter(Boolean),
      reason: htmlToText(r.description) || null,
      date: r.createdAt,
    }),
    approve: (r) => post(`/project-tickets/${r.id}/review`, { decision: 'APPROVED' }),
    reject: (r, reason) => post(`/project-tickets/${r.id}/review`, { decision: 'REJECTED', reason }),
  },
];

export default function ApprovalRequestsScreen() {
  const route = useRoute<any>();
  const [data, setData] = useState<Record<QueueKey, any[] | null>>({} as any);
  const [tab, setTab] = useState<QueueKey>(route.params?.queue || 'HOURS');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // Search, filter, and sort state
  const [query, setQuery] = useState('');
  const [period, setPeriod] = useState<Period>('ALL');
  const [newestFirst, setNewestFirst] = useState(true);

  // Batch triage state
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [batchProcessing, setBatchProcessing] = useState(false);
  const [isBatchRejectModal, setIsBatchRejectModal] = useState(false);

  // Single reject state
  const [rejectingRow, setRejectingRow] = useState<Row | null>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    const results = await Promise.allSettled(QUEUES.map((q) => q.load()));
    const next = {} as Record<QueueKey, any[] | null>;
    QUEUES.forEach((q, i) => {
      const r = results[i];
      next[q.key] = r.status === 'fulfilled' ? r.value : null;
    });
    setData(next);
    // Open on the asked-for queue, else the first one with something waiting.
    setTab((cur) => (next[cur]?.length ? cur : QUEUES.find((q) => next[q.key]?.length)?.key ?? cur));
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const queue = QUEUES.find((q) => q.key === tab)!;

  // Filter and sort items across queues for accurate badge counts
  const shown = useMemo(() => {
    const range = periodRange(period);
    const q = query.trim().toLowerCase();
    const out = {} as Record<QueueKey, Row[] | null>;

    for (const qDef of QUEUES) {
      const rawList = data[qDef.key];
      if (!rawList) {
        out[qDef.key] = null;
        continue;
      }
      const mappedRows = rawList.map(qDef.toRow);
      out[qDef.key] = mappedRows
        .filter((r) => {
          if (!range) return true;
          const dStr = r.date ? String(r.date).slice(0, 10) : '';
          return !dStr || (dStr >= range[0] && dStr <= range[1]);
        })
        .filter((r) => {
          if (!q) return true;
          const pName = r.person ? `${r.person.firstName} ${r.person.lastName || ''} #${r.person.employeeCode || ''}` : '';
          const searchCorpus = [
            pName,
            r.project || '',
            r.title || '',
            r.reason || '',
            r.lines.join(' '),
            qDef.label,
          ].join(' ').toLowerCase();
          return searchCorpus.includes(q.replace(/^#/, ''));
        })
        .sort((a, b) => {
          const tA = a.date ? new Date(a.date).getTime() : 0;
          const tB = b.date ? new Date(b.date).getTime() : 0;
          return (newestFirst ? -1 : 1) * (tA - tB);
        });
    }
    return out;
  }, [data, period, query, newestFirst]);

  const currentRows = shown[tab] || [];
  const total = useMemo(() => QUEUES.reduce((s, qDef) => s + (shown[qDef.key]?.length || 0), 0), [shown]);
  const urgent = useMemo(
    () => QUEUES.reduce((s, qDef) => s + (shown[qDef.key] || []).filter((r) => waitingDays(r.date) >= 7).length, 0),
    [shown]
  );

  const screenSubtitle = useMemo(() => {
    if (total === 0) return 'Nothing waiting';
    if (urgent > 0) return `${total} waiting · ${urgent} urgent`;
    return `${total} waiting for you`;
  }, [total, urgent]);

  const handleTabChange = (newKey: QueueKey) => {
    setTab(newKey);
    setSelectedIds(new Set());
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === currentRows.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(currentRows.map((r) => r.id)));
    }
  };

  const decide = async (raw: any, approve: boolean, why?: string) => {
    const key = `${tab}-${raw.id}`;
    setBusy(key);
    try {
      if (approve) await queue.approve(raw);
      else await queue.reject(raw, why || '');
      setData((d) => ({ ...d, [tab]: (d[tab] || []).filter((x) => x.id !== raw.id) }));
    } catch (e: any) {
      const m = e?.response?.data?.message;
      Alert.alert('Could not save', Array.isArray(m) ? m.join('\n') : m || 'Please try again, or decide this one on the web.');
    } finally {
      setBusy(null);
    }
  };

  const confirmApprove = (row: Row) =>
    Alert.alert('Approve Request?', `${row.title}${row.lines[0] ? `\n${row.lines[0]}` : ''}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Approve', onPress: () => decide(row.raw, true) },
    ]);

  const executeBatchApprove = () => {
    if (selectedIds.size === 0) return;
    Alert.alert(
      `Approve ${selectedIds.size} Requests?`,
      `Are you sure you want to approve ${selectedIds.size} ${queue.label.toLowerCase()} request(s)?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: `Approve (${selectedIds.size})`,
          onPress: async () => {
            setBatchProcessing(true);
            const targets = currentRows.filter((r) => selectedIds.has(r.id));
            const failed: string[] = [];

            for (const r of targets) {
              try {
                await queue.approve(r.raw);
              } catch {
                failed.push(r.title);
              }
            }

            const succeededIds = new Set(
              targets.filter((t) => !failed.includes(t.title)).map((t) => t.id)
            );
            setData((d) => ({
              ...d,
              [tab]: (d[tab] || []).filter((x) => !succeededIds.has(x.id)),
            }));
            setSelectedIds(new Set());
            setBatchProcessing(false);

            if (failed.length > 0) {
              Alert.alert('Notice', `Approved ${succeededIds.size} items. ${failed.length} failed to save.`);
            }
          },
        },
      ]
    );
  };

  const executeBatchReject = async () => {
    if (!reason.trim()) return;
    setBatchProcessing(true);
    const note = reason.trim();
    const targets = currentRows.filter((r) => selectedIds.has(r.id));
    const failed: string[] = [];

    for (const r of targets) {
      try {
        await queue.reject(r.raw, note);
      } catch {
        failed.push(r.title);
      }
    }

    const succeededIds = new Set(
      targets.filter((t) => !failed.includes(t.title)).map((t) => t.id)
    );
    setData((d) => ({
      ...d,
      [tab]: (d[tab] || []).filter((x) => !succeededIds.has(x.id)),
    }));
    setSelectedIds(new Set());
    setBatchProcessing(false);
    setIsBatchRejectModal(false);
    setReason('');

    if (failed.length > 0) {
      Alert.alert('Notice', `Rejected ${succeededIds.size} items. ${failed.length} failed to save.`);
    }
  };

  const renderEmptyState = () => {
    const isFiltered = query.trim() !== '' || period !== 'ALL';
    const otherQueuesWithItems = QUEUES.filter(
      (qDef) => qDef.key !== tab && (shown[qDef.key]?.length ?? 0) > 0
    );
    const nextQueue = otherQueuesWithItems[0];

    return (
      <View style={styles.emptyContainer}>
        <View style={[styles.emptyIconCircle, isFiltered && styles.emptyIconCircleFiltered]}>
          {isFiltered ? (
            <Search size={32} color="#64748B" strokeWidth={2} />
          ) : (
            <CheckCircle2 size={34} color="#16A34A" strokeWidth={2.2} />
          )}
        </View>
        <Text style={styles.emptyTitle}>
          {isFiltered ? 'No matching requests' : `All caught up in ${queue.label}!`}
        </Text>
        <Text style={styles.emptySubtitle}>
          {isFiltered
            ? 'Try adjusting your search keywords or date period filter.'
            : 'There are no pending requests waiting for your approval in this queue.'}
        </Text>

        {isFiltered ? (
          <TouchableOpacity
            style={styles.emptyActionBtn}
            onPress={() => {
              setQuery('');
              setPeriod('ALL');
            }}
            activeOpacity={0.8}
          >
            <Text style={styles.emptyActionBtnText}>Reset Filters</Text>
          </TouchableOpacity>
        ) : nextQueue ? (
          <TouchableOpacity
            style={styles.emptyQueueBtn}
            onPress={() => handleTabChange(nextQueue.key)}
            activeOpacity={0.8}
          >
            <nextQueue.Icon size={15} color="#1373E5" strokeWidth={2.4} />
            <Text style={styles.emptyQueueBtnText}>
              Go to {nextQueue.label} ({shown[nextQueue.key]?.length})
            </Text>
            <ChevronRight size={15} color="#1373E5" strokeWidth={2.4} />
          </TouchableOpacity>
        ) : null}
      </View>
    );
  };

  return (
    <AppScreen
      title="Approval Requests"
      subtitle={screenSubtitle}
      right={
        total > 0 ? (
          <TouchableOpacity
            style={[styles.headerActionBtn, isBatchMode && styles.headerActionBtnActive]}
            onPress={() => {
              setIsBatchMode((v) => !v);
              setSelectedIds(new Set());
            }}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="Batch select"
          >
            <CheckCheck size={18} color={isBatchMode ? '#FFFFFF' : '#0F172A'} strokeWidth={2.4} />
          </TouchableOpacity>
        ) : null
      }
    >
      {loading ? (
        <ActivityIndicator style={styles.loader} color={theme.colors.primary} size="large" />
      ) : (
        <>
          {/* Search, Sort and Filter Deck */}
          <View style={styles.filterDeck}>
            <View style={styles.searchRow}>
              <View style={styles.searchBox}>
                <Search size={15} color="#94A3B8" strokeWidth={2.2} />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search requester, project, task..."
                  placeholderTextColor="#94A3B8"
                  value={query}
                  onChangeText={setQuery}
                  returnKeyType="search"
                  clearButtonMode="never"
                />
                {query.length > 0 && (
                  <TouchableOpacity onPress={() => setQuery('')} style={styles.clearSearchBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <X size={14} color="#64748B" strokeWidth={2.4} />
                  </TouchableOpacity>
                )}
              </View>

              <TouchableOpacity
                style={[styles.sortBtn, !newestFirst && styles.sortBtnActive]}
                onPress={() => setNewestFirst((v) => !v)}
                activeOpacity={0.75}
              >
                <ArrowUpDown size={14} color={!newestFirst ? '#1373E5' : '#475569'} strokeWidth={2.2} />
                <Text style={[styles.sortText, !newestFirst && styles.sortTextActive]}>
                  {newestFirst ? 'Newest' : 'Oldest'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Quick Date Period Filter Strip */}
            <View style={styles.periodStrip}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.periodRow}
                style={styles.periodScroll}
              >
                {PERIODS.map((p) => {
                  const isActive = period === p.key;
                  return (
                    <TouchableOpacity
                      key={p.key}
                      style={[styles.periodChip, isActive && styles.periodChipActive]}
                      onPress={() => {
                        setPeriod(p.key);
                        setSelectedIds(new Set());
                      }}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.periodText, isActive && styles.periodTextActive]}>{p.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>

            {/* Category Tabs Strip */}
            <View style={styles.tabsWrapper}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.tabsContent}
                style={styles.tabsScroll}
              >
                {QUEUES.filter((qDef) => data[qDef.key] !== null).map((qDef) => {
                  const isSelected = qDef.key === tab;
                  const count = shown[qDef.key]?.length ?? 0;
                  const TabIcon = qDef.Icon;
                  return (
                    <TouchableOpacity
                      key={qDef.key}
                      style={[styles.tab, isSelected && styles.tabActive]}
                      onPress={() => handleTabChange(qDef.key)}
                      activeOpacity={0.8}
                    >
                      <TabIcon size={14} color={isSelected ? '#FFFFFF' : '#475569'} strokeWidth={2.2} />
                      <Text
                        style={[
                          styles.tabText,
                          isSelected && styles.tabTextActive,
                          count === 0 && !isSelected && styles.tabTextZero,
                        ]}
                      >
                        {qDef.label}
                      </Text>
                      <View
                        style={[
                          styles.tabBadge,
                          isSelected
                            ? styles.tabBadgeActive
                            : count === 0
                            ? styles.tabBadgeZero
                            : styles.tabBadgeInactive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.tabBadgeText,
                            isSelected && styles.tabBadgeTextActive,
                            count === 0 && !isSelected && styles.tabBadgeTextZero,
                          ]}
                        >
                          {count}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>

            {/* Active Filter Clear Bar (Shows only when filter or search is applied) */}
            {(query.trim() !== '' || period !== 'ALL') && (
              <View style={styles.activeFilterBar}>
                <Text style={styles.activeFilterText} numberOfLines={1}>
                  Filtered: {query.trim() ? `"${query.trim()}"` : ''}
                  {query.trim() && period !== 'ALL' ? ' · ' : ''}
                  {period !== 'ALL' ? PERIODS.find((p) => p.key === period)?.label : ''} ({currentRows.length} results)
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    setQuery('');
                    setPeriod('ALL');
                  }}
                  style={styles.clearFilterBtn}
                  activeOpacity={0.7}
                >
                  <Text style={styles.clearFilterText}>Reset Filters</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Batch Selection Control Banner */}
          {isBatchMode && currentRows.length > 0 && (
            <View style={styles.batchBanner}>
              <TouchableOpacity style={styles.batchBannerLeft} onPress={toggleSelectAll} activeOpacity={0.7}>
                {selectedIds.size === currentRows.length && currentRows.length > 0 ? (
                  <CheckSquare size={17} color="#1373E5" strokeWidth={2.4} />
                ) : (
                  <Square size={17} color="#64748B" strokeWidth={2} />
                )}
                <Text style={styles.batchBannerText}>
                  {selectedIds.size} of {currentRows.length} selected
                </Text>
              </TouchableOpacity>

              <View style={styles.batchBannerActions}>
                <TouchableOpacity
                  style={[
                    styles.batchBannerBtn,
                    styles.batchBannerReject,
                    selectedIds.size === 0 && { opacity: 0.4 },
                  ]}
                  disabled={selectedIds.size === 0 || batchProcessing}
                  onPress={() => {
                    setReason('');
                    setIsBatchRejectModal(true);
                  }}
                  activeOpacity={0.8}
                >
                  <X size={13} color="#DC2626" strokeWidth={2.4} />
                  <Text style={styles.batchBannerRejectText}>Reject</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.batchBannerBtn,
                    styles.batchBannerApprove,
                    selectedIds.size === 0 && { opacity: 0.4 },
                  ]}
                  disabled={selectedIds.size === 0 || batchProcessing}
                  onPress={executeBatchApprove}
                  activeOpacity={0.8}
                >
                  {batchProcessing ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <Check size={14} color="#FFFFFF" strokeWidth={2.6} />
                      <Text style={styles.batchBannerApproveText}>Approve</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Requests List */}
          <FlatList
            data={currentRows}
            keyExtractor={(r) => String(r.id)}
            contentContainerStyle={styles.list}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
            }
            ListEmptyComponent={renderEmptyState}
            renderItem={({ item: r }) => {
              const isBusy = busy === `${tab}-${r.id}`;
              const isSelected = selectedIds.has(r.id);
              const isUrgent = waitingDays(r.date) >= 7;
              const QueueIcon = queue.Icon;

              return (
                <View style={[styles.card, isSelected && styles.cardSelected]}>
                  {/* Card Header: Person & Meta */}
                  <View style={styles.cardHeader}>
                    {isBatchMode && (
                      <TouchableOpacity
                        style={styles.checkboxTouch}
                        onPress={() => toggleSelect(r.id)}
                        activeOpacity={0.7}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        {isSelected ? (
                          <CheckSquare size={21} color="#1373E5" strokeWidth={2.4} />
                        ) : (
                          <Square size={21} color="#94A3B8" strokeWidth={2} />
                        )}
                      </TouchableOpacity>
                    )}

                    <PersonTap person={r.person} style={styles.personHeaderTap}>
                      <Avatar person={r.person} size={40} />
                      <View style={styles.personMetaCol}>
                        <Text style={styles.personName} numberOfLines={1}>
                          {r.person ? `${r.person.firstName} ${r.person.lastName || ''}`.trim() : 'Requester'}
                        </Text>
                        <Text style={styles.personSubtitle} numberOfLines={1}>
                          {ago(r.date)}{r.project ? ` · ${r.project}` : ''}
                        </Text>
                      </View>
                    </PersonTap>

                    <View style={styles.headerBadgesCol}>
                      <View style={[styles.categoryBadge, { backgroundColor: queue.theme.bg, borderColor: queue.theme.border }]}>
                        <QueueIcon size={11} color={queue.theme.text} strokeWidth={2.4} />
                        <Text style={[styles.categoryBadgeText, { color: queue.theme.text }]}>
                          {queue.badgeLabel}
                        </Text>
                      </View>
                      {isUrgent && (
                        <View style={styles.urgentBadge}>
                          <Clock size={10} color="#B45309" strokeWidth={2.4} />
                          <Text style={styles.urgentBadgeText}>{waitingDays(r.date)}d pending</Text>
                        </View>
                      )}
                    </View>
                  </View>

                  {/* Task / Project Information Block */}
                  <View style={styles.contentBox}>
                    <Text style={styles.titleText}>{r.title}</Text>
                    {r.lines.map((l) => (
                      <View key={l} style={styles.metricRow}>
                        <View style={styles.metricDot} />
                        <Text style={styles.metricText}>{l}</Text>
                      </View>
                    ))}
                  </View>

                  {/* Reason Quote Card */}
                  {!!r.reason && (
                    <View style={styles.reasonCard}>
                      <MessageSquare size={13} color="#B45309" style={styles.reasonIcon} />
                      <Text style={styles.reasonText} numberOfLines={4}>
                        “{r.reason}”
                      </Text>
                    </View>
                  )}

                  {/* Single Item Action Buttons */}
                  {!isBatchMode && (
                    <View style={styles.actions}>
                      <TouchableOpacity
                        style={[styles.btn, styles.rejectBtn]}
                        disabled={isBusy}
                        activeOpacity={0.75}
                        onPress={() => {
                          setRejectingRow(r);
                          setReason('');
                        }}
                      >
                        <X size={15} color="#DC2626" strokeWidth={2.4} />
                        <Text style={styles.rejectBtnText}>Reject</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.btn, styles.approveBtn]}
                        disabled={isBusy}
                        activeOpacity={0.8}
                        onPress={() => confirmApprove(r)}
                      >
                        {isBusy ? (
                          <ActivityIndicator color="#fff" size="small" />
                        ) : (
                          <>
                            <Check size={16} color="#FFFFFF" strokeWidth={2.6} />
                            <Text style={styles.approveBtnText}>Approve</Text>
                          </>
                        )}
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              );
            }}
          />

          {/* Floating Batch Action Pill (When items are selected in batch mode) */}
          {isBatchMode && selectedIds.size > 0 && (
            <View style={styles.floatingBatchBar}>
              <View style={styles.floatingBatchBarContent}>
                <Text style={styles.floatingBatchText}>
                  {selectedIds.size} request{selectedIds.size > 1 ? 's' : ''} selected
                </Text>
                <View style={styles.floatingBatchActions}>
                  <TouchableOpacity
                    style={[styles.floatingBatchBtn, styles.floatingRejectBtn]}
                    onPress={() => {
                      setReason('');
                      setIsBatchRejectModal(true);
                    }}
                    disabled={batchProcessing}
                    activeOpacity={0.8}
                  >
                    <X size={14} color="#DC2626" strokeWidth={2.4} />
                    <Text style={styles.floatingRejectText}>Reject</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.floatingBatchBtn, styles.floatingApproveBtn]}
                    onPress={executeBatchApprove}
                    disabled={batchProcessing}
                    activeOpacity={0.8}
                  >
                    {batchProcessing ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <>
                        <Check size={15} color="#FFFFFF" strokeWidth={2.6} />
                        <Text style={styles.floatingApproveText}>Approve</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}
        </>
      )}

      {/* Modern Rejection Modal with Quick Chips */}
      <Modal
        visible={!!rejectingRow || isBatchRejectModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setRejectingRow(null);
          setIsBatchRejectModal(false);
          setReason('');
        }}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>
                {isBatchRejectModal
                  ? `Reject ${selectedIds.size} Requests`
                  : `Reject Request`}
              </Text>
              <Text style={styles.sheetSubtitle}>
                {isBatchRejectModal
                  ? 'Select or enter a reason for rejecting all selected requests:'
                  : `Provide constructive feedback for ${
                      rejectingRow?.person ? `${rejectingRow.person.firstName} ${rejectingRow.person.lastName || ''}`.trim() : 'the requester'
                    }:`}
              </Text>
            </View>

            {/* Quick Reason Chips */}
            <View style={styles.quickReasonsRow}>
              {QUICK_REASONS.map((qr) => (
                <TouchableOpacity
                  key={qr}
                  style={[styles.quickReasonChip, reason === qr && styles.quickReasonChipActive]}
                  onPress={() => setReason(qr)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.quickReasonText, reason === qr && styles.quickReasonTextActive]}>
                    {qr}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              style={styles.input}
              value={reason}
              onChangeText={setReason}
              placeholder="State rejection reason (required)..."
              placeholderTextColor="#94A3B8"
              multiline
              autoFocus
            />

            <View style={styles.sheetActions}>
              <TouchableOpacity
                style={[styles.sheetBtn, styles.sheetCancelBtn]}
                onPress={() => {
                  setRejectingRow(null);
                  setIsBatchRejectModal(false);
                  setReason('');
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.sheetCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.sheetBtn, styles.sheetRejectBtn, !reason.trim() && { opacity: 0.5 }]}
                disabled={!reason.trim()}
                onPress={() => {
                  if (isBatchRejectModal) {
                    executeBatchReject();
                  } else if (rejectingRow) {
                    const row = rejectingRow;
                    setRejectingRow(null);
                    decide(row.raw, false, reason.trim());
                  }
                }}
                activeOpacity={0.8}
              >
                <Text style={styles.sheetRejectText}>Confirm Rejection</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <PersonSheetHost />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  loader: { marginTop: 60 },

  // Header Right Action Button
  headerActionBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  headerActionBtnActive: {
    backgroundColor: '#1373E5',
    borderColor: '#1373E5',
  },

  // Search & Filter Deck
  filterDeck: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderColor: '#F1F5F9',
    paddingTop: 8,
    paddingBottom: 2,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 8,
    marginBottom: 8,
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 10,
    height: 40,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: '#0F172A',
    paddingVertical: 0,
  },
  clearSearchBtn: {
    padding: 4,
  },
  sortBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 11,
    height: 40,
    gap: 5,
  },
  sortBtnActive: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
  },
  sortText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  sortTextActive: {
    color: '#1373E5',
  },
  periodStrip: {
    marginBottom: 4,
  },
  periodScroll: {
    flexGrow: 0,
  },
  periodRow: {
    paddingHorizontal: 16,
    gap: 6,
    alignItems: 'center',
  },
  periodChip: {
    paddingHorizontal: 13,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  periodChipActive: {
    backgroundColor: '#1373E5',
    borderColor: '#1373E5',
  },
  periodText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
  },
  periodTextActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },

  // Category Tabs
  tabsWrapper: {
    backgroundColor: '#FFFFFF',
    paddingVertical: 8,
  },
  tabsScroll: {
    flexGrow: 0,
  },
  tabsContent: {
    paddingHorizontal: 16,
    gap: 8,
    alignItems: 'center',
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 6,
  },
  tabActive: {
    backgroundColor: '#1373E5',
    borderColor: '#1373E5',
    shadowColor: '#1373E5',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 2,
  },
  tabText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  tabTextActive: {
    color: '#FFFFFF',
  },
  tabTextZero: {
    color: '#94A3B8',
  },
  tabBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 18,
  },
  tabBadgeActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
  },
  tabBadgeInactive: {
    backgroundColor: '#F1F5F9',
  },
  tabBadgeZero: {
    backgroundColor: '#F8FAFC',
  },
  tabBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#334155',
  },
  tabBadgeTextActive: {
    color: '#FFFFFF',
  },
  tabBadgeTextZero: {
    color: '#94A3B8',
  },

  // Active Filter Bar
  activeFilterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#EFF6FF',
    borderTopWidth: 1,
    borderColor: '#DBEAFE',
    paddingHorizontal: 16,
    paddingVertical: 7,
  },
  activeFilterText: {
    flex: 1,
    fontSize: 11,
    fontWeight: '600',
    color: '#1E40AF',
    marginRight: 8,
  },
  clearFilterBtn: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: '#DBEAFE',
  },
  clearFilterText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#1D4ED8',
  },

  // Batch Banner
  batchBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F0F9FF',
    borderBottomWidth: 1,
    borderColor: '#BAE6FD',
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  batchBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  batchBannerText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0369A1',
  },
  batchBannerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  batchBannerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 11,
    height: 30,
    borderRadius: 8,
    gap: 4,
  },
  batchBannerReject: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  batchBannerRejectText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#DC2626',
  },
  batchBannerApprove: {
    backgroundColor: '#16A34A',
  },
  batchBannerApproveText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#FFFFFF',
  },

  // List & Cards
  list: {
    padding: 16,
    paddingTop: 10,
    paddingBottom: 130,
    gap: 12,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 14,
    gap: 10,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  cardSelected: {
    borderColor: '#1373E5',
    backgroundColor: '#F8FAFC',
  },

  // Card Header
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  checkboxTouch: {
    marginRight: -2,
  },
  personHeaderTap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  personMetaCol: {
    flex: 1,
  },
  personName: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  personSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 1,
  },
  headerBadgesCol: {
    alignItems: 'flex-end',
    gap: 4,
  },
  categoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  categoryBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  urgentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  urgentBadgeText: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#B45309',
  },

  // Task / Project Content Box
  contentBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    padding: 10,
    gap: 5,
  },
  titleText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#1E3A8A',
    lineHeight: 19,
  },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metricDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#3B82F6',
  },
  metricText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: '#334155',
  },

  // Reason Quote Card
  reasonCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderLeftWidth: 3.5,
    borderLeftColor: '#F59E0B',
    borderRadius: 10,
    padding: 10,
  },
  reasonIcon: {
    marginTop: 2,
  },
  reasonText: {
    flex: 1,
    fontSize: 12.5,
    fontStyle: 'italic',
    color: '#92400E',
    lineHeight: 18,
  },

  // Card Actions
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 2,
  },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 42,
    borderRadius: 12,
  },
  rejectBtn: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  rejectBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#DC2626',
  },
  approveBtn: {
    backgroundColor: '#16A34A',
    shadowColor: '#16A34A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 2,
  },
  approveBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
  },

  // Empty State
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
  },
  emptyIconCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  emptyIconCircleFiltered: {
    backgroundColor: '#F1F5F9',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 16,
  },
  emptyActionBtn: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: '#1373E5',
  },
  emptyActionBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  emptyQueueBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  emptyQueueBtnText: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#1373E5',
  },

  // Rejection Bottom Sheet Modal
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'center',
    padding: 20,
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  sheetHeader: {
    gap: 4,
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
  },
  sheetSubtitle: {
    fontSize: 13,
    color: '#64748B',
    lineHeight: 18,
  },
  quickReasonsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginVertical: 4,
  },
  quickReasonChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  quickReasonChipActive: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  quickReasonText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  quickReasonTextActive: {
    color: '#DC2626',
    fontWeight: '800',
  },
  input: {
    minHeight: 88,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    padding: 12,
    fontSize: 13.5,
    color: '#0F172A',
    backgroundColor: '#F8FAFC',
    textAlignVertical: 'top',
  },
  sheetActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  sheetBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetCancelBtn: {
    backgroundColor: '#F1F5F9',
  },
  sheetCancelText: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#475569',
  },
  sheetRejectBtn: {
    backgroundColor: '#DC2626',
  },
  sheetRejectText: {
    fontSize: 13.5,
    fontWeight: '800',
    color: '#FFFFFF',
  },

  // Floating Batch Action Pill
  floatingBatchBar: {
    position: 'absolute',
    bottom: 24,
    left: 16,
    right: 16,
    zIndex: 10,
  },
  floatingBatchBarContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0F172A',
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 8,
  },
  floatingBatchText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  floatingBatchActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  floatingBatchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    height: 34,
    borderRadius: 10,
  },
  floatingRejectBtn: {
    backgroundColor: '#FEF2F2',
  },
  floatingRejectText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#DC2626',
  },
  floatingApproveBtn: {
    backgroundColor: '#16A34A',
  },
  floatingApproveText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
  },
});
