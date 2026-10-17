import React, { useState, useMemo, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Dimensions, Platform, FlatList, RefreshControl, Animated, Image, Modal, Alert, ActivityIndicator, TextInput } from 'react-native';
import { useAuthStore } from '../../../store/authStore';
import { useProjectStore } from '../../../store/projectStore';
import { AlertCircle, CheckCircle, Clock, Plus, ArrowDown, Minus, ArrowUp, Flame, MessageSquare, Paperclip } from 'lucide-react-native';
import IssueFormModal from '../modals/IssueFormModal';
import IssueDetailModal from '../modals/IssueDetailModal';
import { useProjectPermissions } from '../../../hooks/useProjectPermissions';
import TaskApprovalBar from '../components/TaskApprovalBar';
import ProofUploadSheet from '../components/ProofUploadSheet';

const { width } = Dimensions.get('window');
const COLUMN_WIDTH = width * 0.85;
const MAX_CARD_AVATARS = 3;

// Matches web's getMemberColor() palette exactly (project-detail.ts)
const MEMBER_COLORS = ['#0c66e4', '#1f845a', '#616062', '#7a7a7b', '#6e5dc6', '#943d73', '#206a83', '#505f79'];
const getMemberColor = (employeeId: number) => MEMBER_COLORS[employeeId % MEMBER_COLORS.length];
const getMemberInitials = (emp: any) => {
  const fn = (emp?.firstName || '').charAt(0).toUpperCase();
  const ln = (emp?.lastName || '').charAt(0).toUpperCase();
  return (fn + ln) || 'M';
};

export default function BoardTab() {
  const { currentProject, currentBoard, currentIssues, createIssue, fetchProjectDetails, updateIssueColumn, isLoading } = useProjectStore();
  const myEmployeeId = useAuthStore((s) => s.user?.employeeId);

  // ── Board filters (the web board's filter bar) ──
  type DueFilter = 'OVERDUE' | 'TODAY' | 'WEEK' | 'NO_DATE';
  const [query, setQuery] = useState('');
  const [onlyMine, setOnlyMine] = useState(false);
  const [due, setDue] = useState<DueFilter | null>(null);
  const [memberIds, setMemberIds] = useState<number[]>([]);
  const [labelIds, setLabelIds] = useState<number[]>([]);
  const [phaseIds, setPhaseIds] = useState<number[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const extraCount = memberIds.length + labelIds.length + phaseIds.length;
  const anyFilter = !!query.trim() || onlyMine || !!due || extraCount > 0;
  const clearFilters = () => { setQuery(''); setOnlyMine(false); setDue(null); setMemberIds([]); setLabelIds([]); setPhaseIds([]); };

  const memberIdsOf = (i: any): number[] => [
    ...(i.assigneeId ? [i.assigneeId] : []),
    ...((i.members || []).map((m: any) => m.employeeId ?? m.employee?.id)),
  ].filter(Boolean);

  /** What the filter sheet offers: only values that occur on this board. */
  const filterOptions = useMemo(() => {
    const people = new Map<number, string>();
    const labels = new Map<number, { name: string; color?: string }>();
    const phases = new Map<number, string>();
    (currentIssues || []).forEach((i: any) => {
      if (i.isArchived) return;
      (i.members || []).forEach((m: any) => {
        const e = m.employee; const id = m.employeeId ?? e?.id;
        if (id && e) people.set(id, `${e.firstName ?? ''} ${e.lastName ?? ''}`.trim());
      });
      if (i.assignee?.id) people.set(i.assignee.id, `${i.assignee.firstName ?? ''} ${i.assignee.lastName ?? ''}`.trim());
      (i.labels || []).forEach((l: any) => { const lab = l.label || l; if (lab?.id) labels.set(lab.id, { name: lab.name, color: lab.color }); });
      if (i.phase?.id) phases.set(i.phase.id, i.phase.name);
    });
    const byName = (a: any, b: any) => a.name.localeCompare(b.name);
    return {
      people: [...people].map(([id, name]) => ({ id, name })).sort(byName),
      labels: [...labels].map(([id, v]) => ({ id, ...v })).sort(byName),
      phases: [...phases].map(([id, name]) => ({ id, name })).sort(byName),
    };
  }, [currentIssues]);

  const passes = (i: any): boolean => {
    const q = query.trim().toLowerCase();
    if (q && !(`${i.title ?? ''} ${i.key ?? ''}`.toLowerCase().includes(q))) return false;
    const people = memberIdsOf(i);
    if (onlyMine && !(myEmployeeId && people.includes(myEmployeeId))) return false;
    if (memberIds.length && !people.some((id) => memberIds.includes(id))) return false;
    if (labelIds.length && !(i.labels || []).some((l: any) => labelIds.includes((l.label || l)?.id))) return false;
    if (phaseIds.length && !(i.phase?.id && phaseIds.includes(i.phase.id))) return false;
    if (due) {
      if (due === 'NO_DATE') return !i.dueDate;
      if (!i.dueDate) return false;
      const d = new Date(i.dueDate); d.setHours(23, 59, 59, 999);
      const now = new Date(); const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
      if (due === 'OVERDUE') return d < now && i.status !== 'DONE' && !i.completed;
      if (due === 'TODAY') return d >= startToday && d.getTime() - startToday.getTime() < 86400000;
      if (due === 'WEEK') return d >= startToday && d.getTime() - startToday.getTime() < 7 * 86400000;
    }
    return true;
  };
  const toggleId = (set: React.Dispatch<React.SetStateAction<number[]>>, id: number) =>
    set((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  /** The card whose "Move to…" sheet is open (long-press on the board). */
  const [moving, setMoving] = useState<any>(null);
  const [moveBusy, setMoveBusy] = useState(false);

  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<any>(null);

  useEffect(() => {
    if (selectedIssue && currentIssues) {
      const updated = currentIssues.find(i => i.id === selectedIssue.id);
      if (updated && updated.updatedAt !== selectedIssue.updatedAt) {
        // Safe check using updatedAt or just set it
        setSelectedIssue(updated);
      } else if (updated) {
        // Fallback for fields like attachments/coverUrl that might not bump updatedAt instantly in some backends
        if (JSON.stringify(updated.attachments) !== JSON.stringify(selectedIssue.attachments) || updated.coverUrl !== selectedIssue.coverUrl) {
          setSelectedIssue(updated);
        }
      }
    }
  }, [currentIssues]);
  
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [createColumnId, setCreateColumnId] = useState<number | undefined>(undefined);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    if (!currentProject?.id) return;
    setIsRefreshing(true);
    try {
      await fetchProjectDetails(currentProject.id);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Fetch columns from the dynamic currentBoard structure
  const columns = useMemo(() => {
    if (currentBoard && Array.isArray(currentBoard.columns) && currentBoard.columns.length > 0) {
      return [...currentBoard.columns].sort((a: any, b: any) => a.position - b.position);
    }
    // Default columns fallback
    return [
      { id: 'todo', name: 'To Do', type: 'TODO', color: '#94a3b8' },
      { id: 'in_progress', name: 'In Progress', type: 'IN_PROGRESS', color: '#3b82f6' },
      { id: 'done', name: 'Done', type: 'DONE', color: '#10b981' },
    ];
  }, [currentBoard]);

  const perms = useProjectPermissions(currentProject, columns);

  const issuesByColumnId = useMemo(() => {
    const map: Record<string, any[]> = {};
    columns.forEach((col: any) => { map[col.id.toString()] = []; });
    
    currentIssues.filter(passes).forEach(issue => {
      // Prefer mapping by columnId
      if (issue.columnId && map[issue.columnId.toString()]) {
        map[issue.columnId.toString()].push(issue);
      } else {
        // Fallback: Try to map by matching issue status to column type/name if columnId is missing
        const matchedCol = columns.find((c: any) => c.type === issue.status || c.name.toUpperCase() === issue.status);
        if (matchedCol && map[matchedCol.id.toString()]) {
          map[matchedCol.id.toString()].push(issue);
        } else {
          // Absolute fallback to first column
          const firstColId = columns[0]?.id?.toString();
          if (firstColId) {
            if (!map[firstColId]) map[firstColId] = [];
            map[firstColId].push(issue);
          }
        }
      }
    });
    
    return map;
  }, [currentIssues, columns, query, onlyMine, due, memberIds, labelIds, phaseIds, myEmployeeId]);

  /**
   * Why a card can't go to a column, or null if it can. The same rules the
   * task's own status picker applies: one step at a time, and Review / Done
   * only for the people allowed to put it there.
   */
  const moveBlockReason = (issue: any, col: any): string | null => {
    if (issue.columnId === col.id) return 'Here now';
    if (!perms.isStatusMoveBlocked(issue, col.id)) return null;
    if ((perms.isReviewColumn(col.id) || perms.isDoneOrArchiveColumn(col.id)) && !perms.canMoveIntoReviewOrDone(issue, col.id)) {
      return perms.isAssigneePM(issue) ? 'Only the project owner' : 'Only PM / owner / manager';
    }
    if (/cancel/i.test(col.name || '') || col.type === 'CANCELLED') {
      return perms.isAssigneePM(issue) ? 'Only the project owner' : 'Only PM / owner / manager';
    }
    return 'One step at a time';
  };

  const [proofFor, setProofFor] = useState<{ issue: any; col: any } | null>(null);
  const moveAfterProof = async (completion: { completionRemark?: string; completionAttachmentIds?: number[] }) => {
    if (!proofFor || !currentProject?.id) return;
    await updateIssueColumn(currentProject.id, proofFor.issue.id, proofFor.col.id, completion);
    setProofFor(null);
    fetchProjectDetails(currentProject.id);
  };

  const moveTo = async (issue: any, col: any) => {
    // Review and Done need proof from most people; that upload lives in the
    // task itself, so hand over to it rather than move without proof.
    // Review and Done always ask for proof (photos, files, remark), as the web
    // does; owners and PMs can skip it from the same sheet.
    const needsProof = perms.isReviewColumn(col.id) || perms.isDoneOrArchiveColumn(col.id);
    if (needsProof) {
      setMoving(null);
      setProofFor({ issue, col });
      return;
    }
    setMoveBusy(true);
    try {
      await updateIssueColumn(currentProject.id, issue.id, col.id);
      setMoving(null);
    } catch (e: any) {
      Alert.alert('Could not move', e?.response?.data?.message || 'Please try again.');
    } finally {
      setMoveBusy(false);
    }
  };

  const openIssueDetails = (issue: any) => {
    setSelectedIssue(issue);
    setDetailModalVisible(true);
  };

  const SkeletonPulse = ({ width, height, borderRadius = 8, style }: any) => {
    const opacity = useRef(new Animated.Value(0.35)).current;

    useEffect(() => {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(opacity, {
            toValue: 0.8,
            duration: 750,
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 0.35,
            duration: 750,
            useNativeDriver: true,
          }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    }, [opacity]);

    return (
      <Animated.View
        style={[
          {
            width,
            height,
            borderRadius,
            backgroundColor: '#CBD5E1',
            opacity,
          },
          style,
        ]}
      />
    );
  };

  const SkeletonCard = () => (
    <View style={styles.skeletonCard}>
      <View style={styles.skeletonHeader}>
        <SkeletonPulse width={60} height={16} borderRadius={4} />
        <SkeletonPulse width={18} height={18} borderRadius={9} />
      </View>
      <SkeletonPulse width="90%" height={14} borderRadius={4} style={{ marginBottom: 6 }} />
      <SkeletonPulse width="65%" height={14} borderRadius={4} style={{ marginBottom: 12 }} />
      <View style={{ flexDirection: 'row', gap: 6, marginBottom: 12 }}>
        <SkeletonPulse width={50} height={16} borderRadius={4} />
        <SkeletonPulse width={65} height={16} borderRadius={4} />
      </View>
      <View style={styles.skeletonFooter}>
        <SkeletonPulse width={44} height={18} borderRadius={6} />
        <SkeletonPulse width={24} height={24} borderRadius={12} />
      </View>
    </View>
  );

  const getPriorityConfig = (priority?: string) => {
    switch (priority) {
      case 'LOW':
        return { icon: ArrowDown, color: '#64748B', bg: '#F1F5F9' };
      case 'HIGH':
        return { icon: ArrowUp, color: '#6b3fd6', bg: '#f3efff' };
      case 'CRITICAL':
        return { icon: Flame, color: '#1373e5', bg: '#eff6ff' };
      case 'MEDIUM':
      default:
        return { icon: Minus, color: '#2563EB', bg: '#EFF6FF' };
    }
  };

  // Tick once a second, but only while some task's timer is running.
  const [now, setNow] = useState(Date.now());
  const anyRunning = currentIssues.some((i: any) => i.workStartedAt && !i.workCompletedAt);
  useEffect(() => {
    if (!anyRunning) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [anyRunning]);

  const formatTimeSummary = (min: number) => (min < 60 ? `${Math.round(min)}m` : `${(min / 60).toFixed(1)}h`);

  const getIssueTimeSummary = (issue: any): { display: string; isRunning: boolean; isOver: boolean } | null => {
    const isRunning = !!(issue.workStartedAt && !issue.workCompletedAt);
    let loggedMin = 0;
    let openStartedAt: number | null = null;
    if (Array.isArray(issue.timeLogs) && issue.timeLogs.length > 0) {
      for (const log of issue.timeLogs) {
        if (log.endedAt || log.durationMin) loggedMin += log.durationMin || 0;
        else if (log.startedAt) openStartedAt = Math.max(openStartedAt ?? 0, new Date(log.startedAt).getTime());
      }
    }
    const estHours = issue.estimatedHours || 0;
    const estMin = estHours * 60;

    if (!isRunning && loggedMin === 0 && estHours === 0) return null;

    if (isRunning) {
      // Live, ticking every second (as on the web): time on this task so far,
      // and what is left of its estimate.
      const startMs = openStartedAt ?? new Date(issue.workStartedAt).getTime();
      const totalSec = Math.max(0, Math.floor(loggedMin * 60 + (now - startMs) / 1000));
      const hh = Math.floor(totalSec / 3600);
      const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
      const ss = String(totalSec % 60).padStart(2, '0');
      const clock = `${hh}:${mm}:${ss}`;
      if (estMin > 0) {
        const leftMin = estMin - totalSec / 60;
        return {
          display: leftMin >= 0 ? `${clock} · ${formatTimeSummary(leftMin)} left` : `${clock} · over ${formatTimeSummary(-leftMin)}`,
          isRunning: true,
          isOver: leftMin < 0,
        };
      }
      return { display: clock, isRunning: true, isOver: false };
    }
    if (estHours > 0) {
      return {
        display: `${formatTimeSummary(loggedMin)} / ${formatTimeSummary(estMin)}`,
        isRunning: false,
        isOver: loggedMin > estMin,
      };
    }
    return { display: formatTimeSummary(loggedMin), isRunning: false, isOver: false };
  };

  const renderIssue = ({ item }: { item: any }) => {
    const priorityConfig = getPriorityConfig(item.priority);
    const PriorityIconComp = priorityConfig.icon;
    const timeSummary = getIssueTimeSummary(item);
    const commentCount = item._count?.comments || 0;
    const fileCount = item._count?.attachments || 0;
    const isEvidence = fileCount > 0 && (item.status === 'IN_REVIEW' || item.status === 'DONE');

    return (
      <TouchableOpacity
        style={styles.issueCard}
        activeOpacity={0.7}
        onPress={() => openIssueDetails(item)}
        onLongPress={() => setMoving(item)}
        delayLongPress={350}
      >
          {item.coverUrl && (
            <Image 
              source={{ uri: item.coverUrl }} 
              style={{ width: '100%', height: 130, borderRadius: 8, marginBottom: 12 }} 
              resizeMode="cover" 
            />
          )}
          <View style={styles.issueHeader}>
            <Text style={styles.issueKey}>{item.key || `#${item.id}`}</Text>
            <View style={[styles.cardPriorityBadge, { backgroundColor: priorityConfig.bg }]}>
              <PriorityIconComp size={11} color={priorityConfig.color} strokeWidth={2.5} />
            </View>
          </View>

          {item.rejectionReason && (
            <View style={styles.rejectedPill}>
              <Text style={styles.rejectedPillText}>REJECTED</Text>
            </View>
          )}

          <Text style={styles.issueTitle} numberOfLines={2}>{item.title}</Text>

          {perms.approvalLabel(item) !== '' && (
            <TaskApprovalBar
              compact
              issue={item}
              projectId={currentProject?.id}
              label={perms.approvalLabel(item)}
              canDecide={perms.canDecideApproval(item)}
              onDone={() => { if (currentProject?.id) fetchProjectDetails(currentProject.id); }}
            />
          )}

          {item.labels && item.labels.length > 0 && (
            <View style={styles.cardLabelsRow}>
              {item.labels.slice(0, 3).map((l: any) => (
                <View key={l.id} style={[styles.cardLabelPill, { backgroundColor: `${l.color || '#64748B'}18`, borderColor: `${l.color || '#64748B'}35` }]}>
                  <View style={[styles.cardLabelDot, { backgroundColor: l.color || '#64748B' }]} />
                  <Text style={[styles.cardLabelText, { color: l.color || '#64748B' }]} numberOfLines={1}>{l.name}</Text>
                </View>
              ))}
              {item.labels.length > 3 && (
                <Text style={styles.cardMoreLabelsText}>+{item.labels.length - 3}</Text>
              )}
            </View>
          )}

          {(timeSummary || commentCount > 0 || fileCount > 0) && (
            <View style={styles.cardMetaRow}>
              {timeSummary && (
                <View style={[styles.timeBadge, timeSummary.isRunning && styles.timeBadgeRunning, timeSummary.isOver && styles.timeBadgeOver]}>
                  {timeSummary.isRunning && <View style={styles.pulseDot} />}
                  <Clock size={11} color={timeSummary.isRunning ? '#16A34A' : timeSummary.isOver ? '#1373e5' : '#64748B'} />
                  <Text style={[styles.timeBadgeText, timeSummary.isRunning && { color: '#16A34A' }, timeSummary.isOver && { color: '#1373e5' }]}>
                    {timeSummary.display}
                  </Text>
                </View>
              )}
              {fileCount > 0 && (
                <View style={[styles.commentBadge, isEvidence && styles.evidenceBadge]}>
                  <Paperclip size={11} color={isEvidence ? '#047857' : '#64748B'} />
                  <Text style={[styles.commentBadgeText, isEvidence && { color: '#047857' }]}>
                    {isEvidence ? `Proof ${fileCount}` : fileCount}
                  </Text>
                </View>
              )}
              {commentCount > 0 && (
                <View style={styles.commentBadge}>
                  <MessageSquare size={11} color="#64748B" />
                  <Text style={styles.commentBadgeText}>{commentCount}</Text>
                </View>
              )}
            </View>
          )}

          <View style={styles.issueFooter}>
            <View style={styles.issueTypeBadge}>
              <Text style={styles.issueTypeText}>{item.type || 'TASK'}</Text>
            </View>
            {(() => {
              const members: any[] = Array.isArray(item.members) && item.members.length > 0
                ? item.members
                : item.assignee
                ? [{ employeeId: item.assignee.id, employee: item.assignee }]
                : [];
              if (members.length === 0) return null;
              const visible = members.slice(0, MAX_CARD_AVATARS);
              const overflow = members.length - visible.length;
              return (
                <View style={styles.memberAvatarsRow}>
                  {visible.map((m, mi) => {
                    const emp = m.employee || m;
                    return (
                      <View
                        key={m.employeeId || mi}
                        style={[
                          styles.assigneeAvatar,
                          { marginLeft: mi === 0 ? 0 : -8, zIndex: visible.length - mi },
                          !emp.avatarUrl && { backgroundColor: getMemberColor(m.employeeId || emp.id || mi) },
                        ]}
                      >
                        {emp.avatarUrl ? (
                          <Image source={{ uri: emp.avatarUrl }} style={styles.assigneeAvatarImg} />
                        ) : (
                          <Text style={styles.assigneeInitial}>{getMemberInitials(emp)}</Text>
                        )}
                      </View>
                    );
                  })}
                  {overflow > 0 && (
                    <View style={[styles.assigneeAvatar, styles.assigneeAvatarOverflow, { marginLeft: -8 }]}>
                      <Text style={styles.assigneeOverflowText}>+{overflow}</Text>
                    </View>
                  )}
                </View>
              );
            })()}
          </View>
        </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.filterBar}>
        <TextInput
          style={styles.search}
          placeholder="Search tasks or keys"
          placeholderTextColor="#94A3B8"
          value={query}
          onChangeText={setQuery}
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          <FilterChip label="My tasks" on={onlyMine} onPress={() => setOnlyMine(!onlyMine)} />
          <FilterChip label="Overdue" on={due === 'OVERDUE'} onPress={() => setDue(due === 'OVERDUE' ? null : 'OVERDUE')} />
          <FilterChip label="Due today" on={due === 'TODAY'} onPress={() => setDue(due === 'TODAY' ? null : 'TODAY')} />
          <FilterChip label="Due this week" on={due === 'WEEK'} onPress={() => setDue(due === 'WEEK' ? null : 'WEEK')} />
          <FilterChip label="No due date" on={due === 'NO_DATE'} onPress={() => setDue(due === 'NO_DATE' ? null : 'NO_DATE')} />
          <FilterChip label={extraCount ? `More filters (${extraCount})` : 'More filters'} on={extraCount > 0} onPress={() => setFiltersOpen(true)} />
          {anyFilter && <FilterChip label="Clear" on={false} onPress={clearFilters} />}
        </ScrollView>
        {anyFilter && (
          <Text style={styles.filterNote}>
            Showing {Object.values(issuesByColumnId).reduce((n, l) => n + l.length, 0)} of {currentIssues.filter((i: any) => !i.isArchived).length} tasks
          </Text>
        )}
      </View>

      <Modal visible={filtersOpen} transparent animationType="slide" onRequestClose={() => setFiltersOpen(false)}>
        <View style={styles.moveBackdrop}>
          <View style={[styles.moveSheet, { maxHeight: '80%' }]}>
            <View style={styles.sheetHead}>
              <Text style={styles.moveTitle}>Filter the board</Text>
              <TouchableOpacity onPress={() => setFiltersOpen(false)}><Text style={styles.done}>Done</Text></TouchableOpacity>
            </View>
            <ScrollView>
              <Text style={styles.sheetLabel}>Members</Text>
              <View style={styles.wrap}>
                {filterOptions.people.map((p) => <FilterChip key={p.id} label={p.name} on={memberIds.includes(p.id)} onPress={() => toggleId(setMemberIds, p.id)} />)}
                {!filterOptions.people.length && <Text style={styles.filterNote}>Nobody is assigned yet.</Text>}
              </View>
              {filterOptions.labels.length > 0 && <Text style={styles.sheetLabel}>Labels</Text>}
              <View style={styles.wrap}>
                {filterOptions.labels.map((l) => <FilterChip key={l.id} label={l.name} color={l.color} on={labelIds.includes(l.id)} onPress={() => toggleId(setLabelIds, l.id)} />)}
              </View>
              {filterOptions.phases.length > 0 && <Text style={styles.sheetLabel}>Phase</Text>}
              <View style={styles.wrap}>
                {filterOptions.phases.map((p) => <FilterChip key={p.id} label={p.name} on={phaseIds.includes(p.id)} onPress={() => toggleId(setPhaseIds, p.id)} />)}
              </View>
              {extraCount > 0 && (
                <TouchableOpacity style={styles.moveOpen} onPress={() => { setMemberIds([]); setLabelIds([]); setPhaseIds([]); }}>
                  <Text style={styles.moveOpenText}>Clear these</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <ScrollView 
        horizontal 
        showsHorizontalScrollIndicator={false} 
        snapToInterval={COLUMN_WIDTH + 16}
        decelerationRate="fast"
        contentContainerStyle={styles.boardScroll}
      >
        {columns.map((col: any, idx: number) => {
          const colIssues = issuesByColumnId[col.id?.toString()] || [];
          
          return (
            <View key={col.id || idx} style={styles.column}>
              <View style={styles.columnHeader}>
                <View style={[styles.columnColorDot, { backgroundColor: col.color || '#94A3B8' }]} />
                <Text style={styles.columnName}>{col.name}</Text>
                <View style={styles.issueCountBadge}>
                  <Text style={styles.issueCountText}>{colIssues.length}</Text>
                </View>
                {perms.canCreateIssue && (
                  <TouchableOpacity
                    style={styles.addBtn}
                    onPress={() => {
                      setCreateColumnId(col.id !== 'todo' && col.id !== 'in_progress' && col.id !== 'done' ? col.id : undefined);
                      setCreateModalVisible(true);
                    }}
                  >
                    <Plus size={20} color="#64748B" />
                  </TouchableOpacity>
                )}
              </View>

              <View style={styles.listContainer}>
                {isLoading && currentIssues.length === 0 ? (
                  <View style={styles.listContent}>
                    <SkeletonCard />
                    <SkeletonCard />
                    <SkeletonCard />
                  </View>
                ) : (
                  <FlatList
                    data={colIssues}
                    keyExtractor={(item) => item.id.toString()}
                    renderItem={renderIssue}
                    contentContainerStyle={styles.listContent}
                    showsVerticalScrollIndicator={false}
                    refreshControl={
                      <RefreshControl
                        refreshing={isRefreshing}
                        onRefresh={handleRefresh}
                        colors={['#1373e5']}
                        tintColor="#1373e5"
                      />
                    }
                  />
                )}
              </View>
            </View>
          );
        })}
      </ScrollView>

      {/* Task Creation Modal */}
      <IssueFormModal 
        visible={createModalVisible}
        onClose={() => setCreateModalVisible(false)}
        initialColumnId={createColumnId}
        onSubmit={async (data) => {
          return createIssue(currentProject.id, data);
        }}
      />

      {/* Long-press: move the card without opening it */}
      <Modal visible={!!moving} transparent animationType="fade" onRequestClose={() => setMoving(null)}>
        <TouchableOpacity style={styles.moveBackdrop} activeOpacity={1} onPress={() => !moveBusy && setMoving(null)}>
          <View style={styles.moveSheet}>
            <Text style={styles.moveTitle} numberOfLines={2}>Move {moving?.key ? `${moving.key} · ` : ''}{moving?.title}</Text>
            {moveBusy ? <ActivityIndicator style={{ marginVertical: 24 }} color="#2563EB" /> : columns.map((col: any) => {
              const blocked = moving ? moveBlockReason(moving, col) : null;
              return (
                <TouchableOpacity key={col.id} style={[styles.moveRow, !!blocked && { opacity: 0.45 }]} disabled={!!blocked} onPress={() => moveTo(moving, col)}>
                  <View style={[styles.moveDot, { backgroundColor: col.color || '#94A3B8' }]} />
                  <Text style={styles.moveName}>{col.name}</Text>
                  {!!blocked && <Text style={styles.moveWhy}>{blocked}</Text>}
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity style={styles.moveOpen} onPress={() => { const m = moving; setMoving(null); openIssueDetails(m); }}>
              <Text style={styles.moveOpenText}>Open task</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Issue Detail Modal */}
      {proofFor && currentProject?.id && (
        <ProofUploadSheet
          visible
          projectId={currentProject.id}
          issueId={proofFor.issue.id}
          stageName={proofFor.col.name}
          onCancel={() => setProofFor(null)}
          canSkip={perms.canSkipProof}
          remarkRequired={perms.isMyTask(proofFor.issue) && !perms.canSkipProof}
          onSkip={moveAfterProof}
          onUploaded={moveAfterProof}
        />
      )}

      <IssueDetailModal
        visible={detailModalVisible}
        issue={selectedIssue}
        projectId={currentProject?.id}
        onClose={() => setDetailModalVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  filterBar: { paddingHorizontal: 16, paddingTop: 10, gap: 8 },
  search: { height: 40, borderRadius: 10, borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#fff', paddingHorizontal: 12, color: '#0F172A' },
  chipRow: { gap: 8, paddingRight: 16 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  fChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: '#CBD5E1', backgroundColor: '#fff', maxWidth: 220 },
  fChipOn: { borderColor: '#2563EB', backgroundColor: '#EFF6FF' },
  fChipText: { fontSize: 12.5, color: '#475569', fontWeight: '600' },
  fChipTextOn: { color: '#1D4ED8' },
  fDot: { width: 8, height: 8, borderRadius: 4 },
  filterNote: { fontSize: 12, color: '#64748B' },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sheetLabel: { fontSize: 13, fontWeight: '700', color: '#0F172A', marginTop: 14, marginBottom: 8 },
  done: { color: '#2563EB', fontWeight: '700', fontSize: 15 },
  moveBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  moveSheet: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, paddingBottom: 34 },
  moveTitle: { fontSize: 16, fontWeight: '700', color: '#0F172A', marginBottom: 10 },
  moveRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  moveDot: { width: 10, height: 10, borderRadius: 5 },
  moveName: { flex: 1, fontSize: 15, color: '#0F172A', fontWeight: '600' },
  moveWhy: { fontSize: 12, color: '#64748B' },
  moveOpen: { marginTop: 14, height: 44, borderRadius: 10, borderWidth: 1, borderColor: '#CBD5E1', alignItems: 'center', justifyContent: 'center' },
  moveOpenText: { color: '#0F172A', fontWeight: '600' },
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  boardScroll: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 16,
  },
  column: {
    width: COLUMN_WIDTH,
    backgroundColor: '#F1F5F9',
    borderRadius: 16,
    maxHeight: '100%',
  },
  columnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  columnColorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  columnName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
    flex: 1,
  },
  issueCountBadge: {
    backgroundColor: '#E2E8F0',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  issueCountText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  addBtn: {
    padding: 6,
    marginLeft: 8,
    backgroundColor: '#E2E8F0',
    borderRadius: 8,
  },
  listContainer: {
    flex: 1,
  },
  listContent: {
    padding: 12,
    gap: 12,
  },
  issueCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    elevation: 2,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  skeletonCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    elevation: 1,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
  },
  skeletonHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  skeletonFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  issueCardActive: {
    elevation: 8,
    shadowOpacity: 0.15,
    shadowRadius: 10,
    transform: [{ scale: 1.02 }],
  },
  issueHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  issueKey: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  cardPriorityBadge: {
    padding: 4,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moveBtn: {
    padding: 4,
  },
  issueTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1E293B',
    marginBottom: 8,
    lineHeight: 20,
  },
  cardLabelsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
    marginBottom: 12,
  },
  cardLabelPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    gap: 4,
  },
  cardLabelDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  cardLabelText: {
    fontSize: 10,
    fontWeight: '700',
  },
  cardMoreLabelsText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#94A3B8',
  },
  rejectedPill: {
    alignSelf: 'flex-start',
    backgroundColor: '#dbeafe',
    borderWidth: 1,
    borderColor: '#dbeafe',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginBottom: 6,
  },
  rejectedPillText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#1373e5',
    letterSpacing: 0.3,
  },
  cardMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
    flexWrap: 'wrap',
  },
  timeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  timeBadgeRunning: {
    backgroundColor: '#ECFDF5',
  },
  timeBadgeOver: {
    backgroundColor: '#eff6ff',
  },
  timeBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748B',
  },
  pulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#16A34A',
  },
  evidenceBadge: { backgroundColor: '#ECFDF5', borderWidth: 1, borderColor: '#A7F3D0' },
  commentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  commentBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748B',
  },
  issueFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  issueTypeBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  issueTypeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  memberAvatarsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  assigneeAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#1373e5',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    overflow: 'hidden',
  },
  assigneeAvatarImg: {
    width: '100%',
    height: '100%',
  },
  assigneeAvatarOverflow: {
    backgroundColor: '#475569',
  },
  assigneeOverflowText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  assigneeInitial: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  androidModalOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    zIndex: 1000,
  },
  androidModalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    width: '100%',
    padding: 24,
  },
  androidModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 16,
  },
  androidModalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  androidModalOptionText: {
    fontSize: 16,
    color: '#1E293B',
    fontWeight: '500',
  },
});

function FilterChip({ label, on, onPress, color }: { label: string; on: boolean; onPress: () => void; color?: string }) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.fChip, on && styles.fChipOn]}>
      {!!color && <View style={[styles.fDot, { backgroundColor: color }]} />}
      <Text style={[styles.fChipText, on && styles.fChipTextOn]} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
}
