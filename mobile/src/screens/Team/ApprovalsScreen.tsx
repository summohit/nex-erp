import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator, Alert,
  Modal, TextInput, Image, KeyboardAvoidingView, Platform, Linking, ScrollView,
} from 'react-native';
import {
  Check, X, CheckCheck, CheckSquare, Square, Clock, MapPin, Paperclip,
  MessageSquare, CheckCircle2, ChevronRight, Calendar, Briefcase, Sparkles, Search, ArrowUpDown,
} from 'lucide-react-native';
import AppScreen from '../../components/AppScreen';
import { workService, Regularization, AttendanceApproval, PersonLite, EarlyRelease } from '../../api/workService';
import { teamService, TeamLeaveRequest } from '../../api/teamService';
import { wfhService, WfhRequest } from '../../api/wfhService';
import { theme } from '../../theme/theme';

type Kind = 'LEAVE' | 'WFH' | 'REG' | 'CLOCKOUT' | 'OUTSIDE' | 'RELEASE';
type Item =
  | { kind: 'LEAVE'; id: number; row: TeamLeaveRequest }
  | { kind: 'WFH'; id: number; row: WfhRequest }
  | { kind: 'REG'; id: number; row: Regularization }
  | { kind: 'CLOCKOUT'; id: number; row: AttendanceApproval }
  | { kind: 'OUTSIDE'; id: number; row: AttendanceApproval }
  | { kind: 'RELEASE'; id: number; row: EarlyRelease };

const TABS: { kind: Kind; label: string }[] = [
  { kind: 'LEAVE', label: 'Leave' },
  { kind: 'WFH', label: 'WFH' },
  { kind: 'REG', label: 'Regularization' },
  { kind: 'CLOCKOUT', label: 'Late clock-out' },
  { kind: 'OUTSIDE', label: 'Out of office' },
  { kind: 'RELEASE', label: 'Early release' },
];

const QUICK_REASONS = [
  'Missing punch log proof',
  'Overtime not pre-approved',
  'Outside policy window',
  'Incorrect shift or timing',
  'Duplicate submission',
];

// Same quick ranges as the web Approvals page.
type Period = 'ALL' | 'TODAY' | 'YESTERDAY' | '7' | '30' | 'MONTH';
const PERIODS: { key: Period; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'TODAY', label: 'Today' },
  { key: 'YESTERDAY', label: 'Yesterday' },
  { key: '7', label: '7d' },
  { key: '30', label: '30d' },
  { key: 'MONTH', label: 'Month' },
];
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const periodRange = (p: Period): [string, string] | null => {
  if (p === 'ALL') return null;
  const now = new Date();
  const start = new Date(now);
  if (p === 'YESTERDAY') { start.setDate(start.getDate() - 1); return [ymd(start), ymd(start)]; }
  if (p === '7' || p === '30') start.setDate(start.getDate() - (Number(p) - 1));
  if (p === 'MONTH') start.setDate(1);
  return [ymd(start), ymd(now)];
};
// The day a request is about; leave also has an end day.
const startOf = (it: Item) => String(it.kind === 'LEAVE' ? it.row.startDate : it.row.date ?? '').slice(0, 10);
const endOf = (it: Item) => (it.kind === 'LEAVE' ? String(it.row.endDate ?? '').slice(0, 10) || startOf(it) : startOf(it));
const waitingDays = (it: Item) => {
  const t = new Date(startOf(it)).getTime();
  return isNaN(t) ? 0 : Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
};

const day = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' }) : '';
const time = (d?: string | null) =>
  d ? new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '—';
const nameOf = (p?: PersonLite) => (p ? `${p.firstName} ${p.lastName || ''}`.trim() : '');
const km = (v?: number | null) => (v == null ? 'no GPS' : `${v < 10 ? v.toFixed(2) : Math.round(v)} km`);

export default function ApprovalsScreen() {
  const [data, setData] = useState<Record<Kind, Item[] | null>>({ LEAVE: null, WFH: null, REG: null, CLOCKOUT: null, OUTSIDE: null, RELEASE: null });
  const [tab, setTab] = useState<Kind>('LEAVE');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  
  // Single reject modal state
  const [rejecting, setRejecting] = useState<Item | null>(null);
  const [reason, setReason] = useState('');

  // Batch action state
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [batchProcessing, setBatchProcessing] = useState(false);
  const [isBatchRejectModal, setIsBatchRejectModal] = useState(false);

  const load = useCallback(async () => {
    const [leave, reg, coOk, outOk, wfhOk, erOk] = await Promise.allSettled([
      teamService.getTeamLeaveRequests(),
      workService.getPendingRegularizations(),
      workService.canApproveClockOuts(),
      workService.canApproveOutOfOffice(),
      wfhService.canApprove(),
      workService.canApproveEarlyRelease(),
    ]);
    const [co, out, wfh, er] = await Promise.allSettled([
      coOk.status === 'fulfilled' && coOk.value ? workService.getPendingClockOuts() : Promise.resolve(null),
      outOk.status === 'fulfilled' && outOk.value ? workService.getPendingOutOfOffice() : Promise.resolve(null),
      wfhOk.status === 'fulfilled' && wfhOk.value ? wfhService.pending() : Promise.resolve(null),
      erOk.status === 'fulfilled' && erOk.value ? workService.getPendingEarlyReleases() : Promise.resolve(null),
    ]);
    const next: Record<Kind, Item[] | null> = {
      LEAVE: leave.status === 'fulfilled'
        ? leave.value.filter((r) => r.status === 'PENDING').map((row) => ({ kind: 'LEAVE' as const, id: row.id, row })) : null,
      WFH: wfh.status === 'fulfilled' && wfh.value ? wfh.value.map((row) => ({ kind: 'WFH' as const, id: row.id, row })) : null,
      REG: reg.status === 'fulfilled' ? reg.value.filter((r: any) => !r.status || r.status === 'PENDING').map((row) => ({ kind: 'REG' as const, id: row.id, row })) : null,
      CLOCKOUT: co.status === 'fulfilled' && co.value ? co.value.map((row) => ({ kind: 'CLOCKOUT' as const, id: row.id, row })) : null,
      OUTSIDE: out.status === 'fulfilled' && out.value ? out.value.map((row) => ({ kind: 'OUTSIDE' as const, id: row.id, row })) : null,
      RELEASE: er.status === 'fulfilled' && er.value ? er.value.map((row) => ({ kind: 'RELEASE' as const, id: row.id, row })) : null,
    };
    setData(next);
    // Land on the first tab that has something waiting.
    setTab((cur) => (next[cur]?.length ? cur : (TABS.find((t) => next[t.kind]?.length)?.kind ?? cur)));
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const [period, setPeriod] = useState<Period>('ALL');
  const [query, setQuery] = useState('');
  const [newestFirst, setNewestFirst] = useState(true);

  const visibleTabs = TABS.filter((t) => data[t.kind] !== null);
  // Period, search and sort apply to every tab, so the tab counts and the
  // header follow the filters the way the web page does.
  const shown = useMemo(() => {
    const range = periodRange(period);
    const q = query.trim().toLowerCase();
    const out = {} as Record<Kind, Item[] | null>;
    for (const t of TABS) {
      const list = data[t.kind];
      if (!list) { out[t.kind] = null; continue; }
      out[t.kind] = list
        .filter((it) => !range || (endOf(it) >= range[0] && startOf(it) <= range[1]))
        .filter((it) => {
          if (!q) return true;
          const e: any = it.row.employee || {};
          const hay = [nameOf(e), e.employeeCode, e.department?.name, (it.row as any).reason, t.label].join(' ').toLowerCase();
          return hay.includes(q.replace(/^#/, ''));
        })
        .sort((a, b) => (newestFirst ? -1 : 1) * startOf(a).localeCompare(startOf(b)));
    }
    return out;
  }, [data, period, query, newestFirst]);
  const items = shown[tab] || [];
  const total = useMemo(() => TABS.reduce((n, t) => n + (shown[t.kind]?.length || 0), 0), [shown]);
  const urgent = useMemo(() => TABS.reduce((n, t) => n + (shown[t.kind] || []).filter((it) => waitingDays(it) >= 7).length, 0), [shown]);

  // Reset selected items when switching tabs
  const handleTabChange = (newTab: Kind) => {
    setTab(newTab);
    setSelectedIds(new Set());
  };

  const decide = async (it: Item, approve: boolean, note?: string) => {
    const key = `${it.kind}-${it.id}`;
    setBusy(key);
    try {
      if (it.kind === 'LEAVE') await teamService.decideLeave(it.id, approve ? 'APPROVED' : 'REJECTED', note);
      if (it.kind === 'WFH') await wfhService.decide(it.id, approve ? 'APPROVE' : 'REJECT', note);
      if (it.kind === 'REG') await workService.decideRegularization(it.id, approve ? 'APPROVED' : 'REJECTED', note);
      if (it.kind === 'CLOCKOUT') await workService.decideClockOut(it.id, approve ? 'APPROVE' : 'REJECT', note);
      if (it.kind === 'OUTSIDE') await workService.decideOutOfOffice(it.id, approve ? 'APPROVE' : 'REJECT', note);
      if (it.kind === 'RELEASE') await workService.decideEarlyRelease(it.id, approve ? 'APPROVE' : 'REJECT', note);
      setData((d) => ({ ...d, [it.kind]: (d[it.kind] || []).filter((x) => x.id !== it.id) }));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(it.id);
        return next;
      });
    } catch (e: any) {
      Alert.alert('Could not save', e?.response?.data?.message || 'Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const confirmApprove = (it: Item) =>
    Alert.alert('Approve Request?', `${nameOf(it.row.employee)}\n${summary(it)}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Approve', onPress: () => decide(it, true) },
    ]);

  // Batch operations
  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === items.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items.map((i) => i.id)));
    }
  };

  const promptBatchApprove = () => {
    if (selectedIds.size === 0) return;
    Alert.alert(
      'Batch Approve',
      `Are you sure you want to approve ${selectedIds.size} selected requests?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: `Approve (${selectedIds.size})`,
          onPress: executeBatchApprove,
        },
      ]
    );
  };

  const executeBatchApprove = async () => {
    setBatchProcessing(true);
    const targets = items.filter((it) => selectedIds.has(it.id));
    const failed: string[] = [];

    for (const it of targets) {
      try {
        if (it.kind === 'LEAVE') await teamService.decideLeave(it.id, 'APPROVED');
        if (it.kind === 'WFH') await wfhService.decide(it.id, 'APPROVE');
        if (it.kind === 'REG') await workService.decideRegularization(it.id, 'APPROVED');
        if (it.kind === 'CLOCKOUT') await workService.decideClockOut(it.id, 'APPROVE');
        if (it.kind === 'OUTSIDE') await workService.decideOutOfOffice(it.id, 'APPROVE');
        if (it.kind === 'RELEASE') await workService.decideEarlyRelease(it.id, 'APPROVE');
      } catch {
        failed.push(nameOf(it.row.employee) || `ID #${it.id}`);
      }
    }

    const succeededIds = new Set(
      targets.filter((t) => !failed.includes(nameOf(t.row.employee) || `ID #${t.id}`)).map((t) => t.id)
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
  };

  const executeBatchReject = async () => {
    if (!reason.trim()) return;
    setBatchProcessing(true);
    const note = reason.trim();
    const targets = items.filter((it) => selectedIds.has(it.id));
    const failed: string[] = [];

    for (const it of targets) {
      try {
        if (it.kind === 'LEAVE') await teamService.decideLeave(it.id, 'REJECTED', note);
        if (it.kind === 'WFH') await wfhService.decide(it.id, 'REJECT', note);
        if (it.kind === 'REG') await workService.decideRegularization(it.id, 'REJECTED', note);
        if (it.kind === 'CLOCKOUT') await workService.decideClockOut(it.id, 'REJECT', note);
        if (it.kind === 'OUTSIDE') await workService.decideOutOfOffice(it.id, 'REJECT', note);
        if (it.kind === 'RELEASE') await workService.decideEarlyRelease(it.id, 'REJECT', note);
      } catch {
        failed.push(nameOf(it.row.employee) || `ID #${it.id}`);
      }
    }

    const succeededIds = new Set(
      targets.filter((t) => !failed.includes(nameOf(t.row.employee) || `ID #${t.id}`)).map((t) => t.id)
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

  const summary = (it: Item): string => {
    if (it.kind === 'LEAVE') {
      const r = it.row;
      return `${r.leaveType?.name}, ${day(r.startDate)}${r.startDate.slice(0, 10) !== r.endDate.slice(0, 10) ? ` → ${day(r.endDate)}` : ''}`;
    }
    if (it.kind === 'WFH') return `Work from home, ${day(it.row.date)}${it.row.status === 'PENDING_HR' ? ' (manager approved)' : ''}`;
    if (it.kind === 'REG') return `${day(it.row.date)}: ${time(it.row.proposedClockIn)} – ${time(it.row.proposedClockOut)}`;
    if (it.kind === 'CLOCKOUT') return `${day(it.row.date)}: clocked out ${time(it.row.clockOut)}`;
    if (it.kind === 'RELEASE') {
      const v = it.row.visit;
      return `${v?.requestNumber ?? 'Visit'}${v?.location ? ' · ' + v.location : ''} · ${it.row.type === 'HOURS' ? 'leave the site early on ' + day(it.row.date) : 'end the visit after ' + day(it.row.date)}`;
    }
    const r = it.row;
    return `${day(r.date)}: ${[r.clockInOutside && `in ${km(r.clockInDistanceKm)}`, r.clockOutOutside && `out ${km(r.clockOutDistanceKm)}`].filter(Boolean).join(' · ')} away`;
  };

  const reasons = (it: Item): string[] => {
    if (it.kind === 'LEAVE') return it.row.reason ? [it.row.reason] : [];
    if (it.kind === 'WFH') return it.row.reason ? [it.row.reason] : [];
    if (it.kind === 'REG') return [it.row.reason];
    if (it.kind === 'CLOCKOUT') return it.row.clockOutReason ? [it.row.clockOutReason] : [];
    if (it.kind === 'RELEASE') return it.row.reason ? [it.row.reason] : [];
    return [
      it.row.clockInOutsideReason && `Clock-in: ${it.row.clockInOutsideReason}`,
      it.row.clockOutOutsideReason && `Clock-out: ${it.row.clockOutOutsideReason}`,
    ].filter(Boolean) as string[];
  };

  const getKindBadge = (it: Item) => {
    switch (it.kind) {
      case 'CLOCKOUT':
        return { label: 'Late Clock-Out', bg: '#FEF3C7', border: '#FDE68A', text: '#B45309', Icon: Clock };
      case 'OUTSIDE':
        return { label: 'Outside Office', bg: '#EFF6FF', border: '#BFDBFE', text: '#1D4ED8', Icon: MapPin };
      case 'REG':
        return { label: 'Regularization', bg: '#F3E8FF', border: '#DDD6FE', text: '#7C3AED', Icon: Calendar };
      case 'WFH':
        return { label: 'WFH', bg: '#F0FDFA', border: '#99F6E4', text: '#0D9488', Icon: Briefcase };
      case 'LEAVE':
        return { label: it.row.leaveType?.name || 'Leave', bg: '#ECFDF5', border: '#A7F3D0', text: '#047857', Icon: Calendar };
      case 'RELEASE':
        return { label: it.row.type === 'HOURS' ? 'Early release · Hours' : 'Early release · Days', bg: '#FFF7ED', border: '#FED7AA', text: '#C2410C', Icon: MapPin };
    }
  };

  const renderItem = ({ item: it }: { item: Item }) => {
    const p = it.row.employee;
    const key = `${it.kind}-${it.id}`;
    const proof = it.kind === 'CLOCKOUT' ? it.row.clockOutProofUrl : null;
    const isSelected = selectedIds.has(it.id);
    const badge = getKindBadge(it);
    const BadgeIcon = badge.Icon;
    const isUrgent = waitingDays(it) >= 7;

    return (
      <View style={[styles.card, isSelected && styles.cardSelected]}>
        <View style={styles.cardHeader}>
          {isBatchMode && (
            <TouchableOpacity
              style={styles.checkboxTouch}
              onPress={() => toggleSelect(it.id)}
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

          {p?.avatarUrl ? (
            <Image source={{ uri: p.avatarUrl }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.initials]}>
              <Text style={styles.initialsText}>{(p?.firstName?.[0] || '') + (p?.lastName?.[0] || '')}</Text>
            </View>
          )}

          <View style={styles.flex}>
            <Text style={styles.name}>{nameOf(p)}</Text>
            <Text style={styles.meta} numberOfLines={1}>
              {[p?.employeeCode && `#${p.employeeCode}`, p?.designation?.name, p?.department?.name].filter(Boolean).join(' · ')}
            </Text>
          </View>

          <View style={styles.headerBadgesCol}>
            <View style={[styles.statusBadge, { backgroundColor: badge.bg, borderColor: badge.border }]}>
              <BadgeIcon size={11} color={badge.text} strokeWidth={2.4} />
              <Text style={[styles.statusBadgeText, { color: badge.text }]}>{badge.label}</Text>
            </View>
            {isUrgent && (
              <View style={styles.urgentBadge}>
                <Clock size={10} color="#B45309" strokeWidth={2.4} />
                <Text style={styles.urgentBadgeText}>{waitingDays(it)}d pending</Text>
              </View>
            )}
          </View>
        </View>

        {/* Attendance Summary Tile */}
        <View style={styles.summaryBox}>
          <Text style={styles.summaryText}>{summary(it)}</Text>
        </View>

        {/* Reason Quote Bubble */}
        {reasons(it).map((r, i) => (
          <View key={i} style={styles.reasonCard}>
            <MessageSquare size={13} color="#B45309" style={styles.reasonIcon} />
            <Text style={styles.reasonText}>“{r}”</Text>
          </View>
        ))}

        {/* Attachment Pill */}
        {!!proof && (
          <TouchableOpacity style={styles.proofBtn} onPress={() => Linking.openURL(proof)} activeOpacity={0.7}>
            <Paperclip size={13} color="#1373E5" />
            <Text style={styles.proofText}>View attached proof</Text>
            <ChevronRight size={13} color="#1373E5" />
          </TouchableOpacity>
        )}

        {/* Action Buttons */}
        {!isBatchMode && (
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.btn, styles.reject]}
              disabled={busy === key}
              activeOpacity={0.75}
              onPress={() => { setReason(''); setRejecting(it); }}
            >
              <X size={15} color="#DC2626" strokeWidth={2.4} />
              <Text style={styles.rejectText}>Reject</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.btn, styles.approve]}
              disabled={busy === key}
              activeOpacity={0.8}
              onPress={() => confirmApprove(it)}
            >
              {busy === key ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Check size={16} color="#FFFFFF" strokeWidth={2.6} />
                  <Text style={styles.approveText}>Approve</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  const renderEmptyState = () => {
    const isFiltered = query.trim() !== '' || period !== 'ALL';
    const nextTabWithItems = visibleTabs.find((t) => (shown[t.kind]?.length ?? 0) > 0);

    return (
      <View style={styles.emptyContainer}>
        <View style={[styles.emptyIconCircle, isFiltered && styles.emptyIconCircleFiltered]}>
          {isFiltered ? (
            <Search size={36} color="#64748B" strokeWidth={2.2} />
          ) : (
            <CheckCircle2 size={42} color="#10B981" strokeWidth={2.2} />
          )}
        </View>
        <Text style={styles.emptyTitle}>
          {isFiltered ? 'No Matching Requests' : "You're All Caught Up!"}
        </Text>
        <Text style={styles.emptySubtitle}>
          {isFiltered
            ? `No approvals found for "${query.trim() || period}". Try resetting filters or searching another keyword.`
            : total > 0
            ? 'No pending requests waiting in this category.'
            : 'All caught up — nothing is waiting for your approval.'}
        </Text>
        {isFiltered ? (
          <TouchableOpacity
            style={styles.emptyResetBtn}
            onPress={() => { setQuery(''); setPeriod('ALL'); }}
            activeOpacity={0.8}
          >
            <Text style={styles.emptyResetText}>Clear Search & Filters</Text>
          </TouchableOpacity>
        ) : nextTabWithItems ? (
          <TouchableOpacity
            style={styles.emptySwitchBtn}
            onPress={() => handleTabChange(nextTabWithItems.kind)}
            activeOpacity={0.8}
          >
            <Sparkles size={14} color="#FFFFFF" />
            <Text style={styles.emptySwitchText}>
              Check {nextTabWithItems.label} ({shown[nextTabWithItems.kind]?.length})
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  };

  return (
    <AppScreen
      title="Approvals"
      subtitle={total ? `${total} waiting for you${urgent ? ` · ${urgent} urgent (7d+)` : ''}` : 'Nothing waiting'}
      right={
        total > 0 ? (
          <TouchableOpacity
            style={[styles.headerActionBtn, isBatchMode && styles.headerActionBtnActive]}
            onPress={() => setIsBatchMode((v) => !v)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={isBatchMode ? 'Exit Batch Select' : 'Enter Batch Select'}
          >
            <CheckCheck size={18} color={isBatchMode ? '#1373E5' : '#0F172A'} strokeWidth={2.3} />
          </TouchableOpacity>
        ) : null
      }
    >
      {loading ? (
        <ActivityIndicator style={styles.loader} color={theme.colors.primary} />
      ) : (
        <>
          {/* Unified Filter Deck */}
          <View style={styles.filterDeck}>
            {/* Search Input & Independent Sort Toggle Button */}
            <View style={styles.searchRow}>
              <View style={styles.searchBox}>
                <Search size={16} color="#94A3B8" strokeWidth={2.2} />
                <TextInput
                  style={styles.searchInput}
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search name, #code, dept, reason..."
                  placeholderTextColor="#94A3B8"
                  autoCorrect={false}
                  autoCapitalize="none"
                />
                {query.length > 0 && (
                  <TouchableOpacity
                    onPress={() => setQuery('')}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={styles.clearSearchBtn}
                    activeOpacity={0.7}
                  >
                    <X size={12} color="#64748B" strokeWidth={2.6} />
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
                      onPress={() => { setPeriod(p.key); setSelectedIds(new Set()); }}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.periodText, isActive && styles.periodTextActive]}>{p.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>

            {/* Bounded Horizontal Category Tabs */}
            <View style={styles.tabsWrapper}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.tabsContent}
                style={styles.tabsScroll}
              >
                {visibleTabs.map((t) => {
                  const isSelected = tab === t.kind;
                  const count = shown[t.kind]?.length ?? 0;
                  return (
                    <TouchableOpacity
                      key={t.kind}
                      style={[styles.tab, isSelected && styles.tabActive]}
                      onPress={() => handleTabChange(t.kind)}
                      activeOpacity={0.8}
                    >
                      <Text
                        style={[
                          styles.tabText,
                          isSelected && styles.tabTextActive,
                          count === 0 && !isSelected && styles.tabTextZero,
                        ]}
                      >
                        {t.label}
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
                  {period !== 'ALL' ? PERIODS.find((p) => p.key === period)?.label : ''} ({items.length} results)
                </Text>
                <TouchableOpacity
                  onPress={() => { setQuery(''); setPeriod('ALL'); }}
                  style={styles.clearFilterBtn}
                  activeOpacity={0.7}
                >
                  <Text style={styles.clearFilterText}>Reset Filters</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Batch Selection Banner */}
          {isBatchMode && items.length > 0 && (
            <View style={styles.batchBanner}>
              <TouchableOpacity style={styles.batchBannerLeft} onPress={toggleSelectAll} activeOpacity={0.7}>
                {selectedIds.size === items.length ? (
                  <CheckSquare size={17} color="#1373E5" strokeWidth={2.4} />
                ) : (
                  <Square size={17} color="#64748B" strokeWidth={2} />
                )}
                <Text style={styles.batchBannerText}>
                  {selectedIds.size} of {items.length} selected
                </Text>
              </TouchableOpacity>

              <View style={styles.batchBannerButtons}>
                <TouchableOpacity
                  style={[styles.batchSmallBtn, styles.batchRejectSmall, selectedIds.size === 0 && styles.disabled]}
                  disabled={selectedIds.size === 0 || batchProcessing}
                  onPress={() => { setReason(''); setIsBatchRejectModal(true); }}
                  activeOpacity={0.8}
                >
                  <Text style={styles.batchRejectSmallText}>Reject ({selectedIds.size})</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.batchSmallBtn, styles.batchApproveSmall, selectedIds.size === 0 && styles.disabled]}
                  disabled={selectedIds.size === 0 || batchProcessing}
                  onPress={promptBatchApprove}
                  activeOpacity={0.8}
                >
                  {batchProcessing ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.batchApproveSmallText}>Approve ({selectedIds.size})</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}

          <FlatList
            data={items}
            keyExtractor={(it) => `${it.kind}-${it.id}`}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
            ListEmptyComponent={renderEmptyState}
          />
        </>
      )}

      {/* Single Item Rejection Modal */}
      <Modal visible={!!rejecting} transparent animationType="fade" onRequestClose={() => setRejecting(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Reject Request</Text>
            <Text style={styles.sheetMeta}>
              {rejecting ? `${nameOf(rejecting.row.employee)} · ${summary(rejecting)}` : ''}
            </Text>

            <Text style={styles.quickReasonsLabel}>Select a quick reason:</Text>
            <View style={styles.quickReasonsRow}>
              {QUICK_REASONS.slice(0, 4).map((q) => (
                <TouchableOpacity
                  key={q}
                  style={[styles.quickChip, reason === q && styles.quickChipSelected]}
                  onPress={() => setReason(q)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.quickChipText, reason === q && styles.quickChipTextSelected]}>{q}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              style={styles.input}
              placeholder="Or write custom feedback for employee..."
              placeholderTextColor="#94A3B8"
              value={reason}
              onChangeText={setReason}
              multiline
            />

            <View style={styles.actions}>
              <TouchableOpacity style={[styles.btn, styles.cancel]} onPress={() => setRejecting(null)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.rejectSolid, !reason.trim() && styles.disabled]}
                disabled={!reason.trim()}
                onPress={() => {
                  const it = rejecting!;
                  setRejecting(null);
                  decide(it, false, reason.trim());
                }}
              >
                <Text style={styles.approveText}>Confirm Reject</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Batch Rejection Modal */}
      <Modal visible={isBatchRejectModal} transparent animationType="fade" onRequestClose={() => setIsBatchRejectModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Batch Reject ({selectedIds.size} Requests)</Text>
            <Text style={styles.sheetMeta}>
              Selected employees will receive this explanation:
            </Text>

            <Text style={styles.quickReasonsLabel}>Select a quick reason:</Text>
            <View style={styles.quickReasonsRow}>
              {QUICK_REASONS.map((q) => (
                <TouchableOpacity
                  key={q}
                  style={[styles.quickChip, reason === q && styles.quickChipSelected]}
                  onPress={() => setReason(q)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.quickChipText, reason === q && styles.quickChipTextSelected]}>{q}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              style={styles.input}
              placeholder="Or write reason for batch rejection..."
              placeholderTextColor="#94A3B8"
              value={reason}
              onChangeText={setReason}
              multiline
            />

            <View style={styles.actions}>
              <TouchableOpacity style={[styles.btn, styles.cancel]} onPress={() => setIsBatchRejectModal(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.rejectSolid, !reason.trim() && styles.disabled]}
                disabled={!reason.trim() || batchProcessing}
                onPress={executeBatchReject}
              >
                {batchProcessing ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.approveText}>Reject All Selected</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  loader: { marginTop: 40 },

  // Header Batch Button
  headerActionBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerActionBtnActive: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
  },

  // Unified Filter Deck
  filterDeck: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    paddingTop: 10,
    paddingBottom: 8,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 2,
    zIndex: 1,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 8,
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 40,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: '#0F172A',
    paddingVertical: 0,
  },
  clearSearchBtn: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sortBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  sortBtnActive: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
  },
  sortText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  sortTextActive: {
    color: '#1373E5',
    fontWeight: '700',
  },

  // Date Period Filter Strip
  periodStrip: {
    marginTop: 8,
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
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  periodChipActive: {
    backgroundColor: '#1373E5',
    borderColor: '#1373E5',
    shadowColor: '#1373E5',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.18,
    shadowRadius: 3,
    elevation: 2,
  },
  periodText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#64748B',
  },
  periodTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },

  // Horizontal Tabs (Fixed against vertical stretching)
  tabsWrapper: {
    marginTop: 8,
  },
  tabsScroll: {
    flexGrow: 0,
    height: 36,
  },
  tabsContent: {
    paddingHorizontal: 16,
    gap: 8,
    alignItems: 'center',
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 6,
    height: 34,
  },
  tabActive: {
    backgroundColor: '#1373E5',
    borderColor: '#1373E5',
    shadowColor: '#1373E5',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  tabText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: '#475569',
  },
  tabTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  tabTextZero: {
    color: '#94A3B8',
  },
  tabBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
  },
  tabBadgeActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
  },
  tabBadgeInactive: {
    backgroundColor: '#E2E8F0',
  },
  tabBadgeZero: {
    backgroundColor: '#F1F5F9',
  },
  tabBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#475569',
  },
  tabBadgeTextActive: {
    color: '#FFFFFF',
  },
  tabBadgeTextZero: {
    color: '#94A3B8',
  },

  // Active Filter Strip
  activeFilterBar: {
    marginTop: 8,
    marginHorizontal: 16,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#EFF6FF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  activeFilterText: {
    fontSize: 11.5,
    color: '#1D4ED8',
    fontWeight: '600',
    flex: 1,
    marginRight: 8,
  },
  clearFilterBtn: {
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    backgroundColor: '#FFFFFF',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  clearFilterText: {
    fontSize: 10.5,
    color: '#1D4ED8',
    fontWeight: '700',
  },

  // Batch Selection Top Bar
  batchBanner: {
    backgroundColor: '#EFF6FF',
    borderBottomWidth: 1,
    borderBottomColor: '#BFDBFE',
    paddingHorizontal: 16,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  batchBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  batchBannerText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#1E3A8A',
  },
  batchBannerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  batchSmallBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  batchRejectSmall: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  batchRejectSmallText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#DC2626',
  },
  batchApproveSmall: {
    backgroundColor: '#16A34A',
  },
  batchApproveSmallText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // Feed & Cards
  list: {
    padding: 16,
    paddingBottom: 130,
    gap: 12,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  cardSelected: {
    borderColor: '#1373E5',
    backgroundColor: '#F8FAFC',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  checkboxTouch: {
    paddingRight: 2,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 14,
  },
  initials: {
    backgroundColor: '#1373E5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  initialsText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 13,
  },
  name: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  meta: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  headerBadgesCol: {
    alignItems: 'flex-end',
    gap: 4,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  urgentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  urgentBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#B45309',
  },

  // Summary box
  summaryBox: {
    marginTop: 12,
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  summaryText: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#1E3A8A',
  },

  // Reason quote
  reasonCard: {
    marginTop: 8,
    backgroundColor: '#FFFBEB',
    borderRadius: 10,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#FEF3C7',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
  },
  reasonIcon: {
    marginTop: 2,
  },
  reasonText: {
    flex: 1,
    fontSize: 12.5,
    color: '#92400E',
    lineHeight: 18,
    fontWeight: '500',
  },

  // Proof button
  proofBtn: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  proofText: {
    fontSize: 12,
    color: '#1373E5',
    fontWeight: '700',
  },

  // Actions
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  btn: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  approve: {
    backgroundColor: '#16A34A',
    shadowColor: '#16A34A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  approveText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13.5,
  },
  reject: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  rejectText: {
    color: '#DC2626',
    fontWeight: '700',
    fontSize: 13.5,
  },
  rejectSolid: {
    backgroundColor: '#DC2626',
  },
  cancel: {
    backgroundColor: '#F1F5F9',
  },
  cancelText: {
    color: '#334155',
    fontWeight: '600',
    fontSize: 13.5,
  },
  disabled: {
    opacity: 0.5,
  },

  // Empty State
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
  },
  emptyIconCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#ECFDF5',
    borderWidth: 2,
    borderColor: '#A7F3D0',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyIconCircleFiltered: {
    backgroundColor: '#F1F5F9',
    borderColor: '#E2E8F0',
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
    maxWidth: 280,
  },
  emptyResetBtn: {
    marginTop: 18,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 12,
  },
  emptyResetText: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '700',
  },
  emptySwitchBtn: {
    marginTop: 20,
    backgroundColor: '#1373E5',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    shadowColor: '#1373E5',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 3,
  },
  emptySwitchText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },

  // Rejection Modal
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: Platform.OS === 'ios' ? 36 : 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#CBD5E1',
    alignSelf: 'center',
    marginBottom: 14,
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
  },
  sheetMeta: {
    fontSize: 12.5,
    color: '#64748B',
    marginTop: 4,
  },
  quickReasonsLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    marginTop: 14,
    marginBottom: 8,
  },
  quickReasonsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 12,
  },
  quickChip: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  quickChipSelected: {
    backgroundColor: '#FEF2F2',
    borderColor: '#F87171',
  },
  quickChipText: {
    fontSize: 11.5,
    color: '#475569',
    fontWeight: '600',
  },
  quickChipTextSelected: {
    color: '#DC2626',
    fontWeight: '700',
  },
  input: {
    minHeight: 80,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 12,
    textAlignVertical: 'top',
    color: '#0F172A',
    fontSize: 13,
    backgroundColor: '#F8FAFC',
  },
});


