import React, { useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SectionList,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { GanttChart, ChevronRight, AlertCircle, CheckCircle, Clock } from 'lucide-react-native';
import { useProjectStore } from '../../../store/projectStore';
import IssueDetailModal from '../modals/IssueDetailModal';

const PRIORITY_COLORS: Record<string, string> = {
  CRITICAL: '#EF4444',
  HIGH: '#F97316',
  MEDIUM: '#3B82F6',
  LOW: '#94A3B8',
};

const STATUS_COLORS: Record<string, string> = {
  TODO: '#94A3B8',
  IN_PROGRESS: '#3B82F6',
  IN_REVIEW: '#A855F7',
  DONE: '#10B981',
  CANCELLED: '#EF4444',
};

const TYPE_ICONS: Record<string, string> = {
  EPIC: '🗂',
  STORY: '📖',
  TASK: '✅',
  BUG: '🐛',
  SUBTASK: '🔸',
};

function formatDateRange(start?: string, due?: string) {
  const fmt = (d: string) =>
    new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  if (start && due) return `${fmt(start)} → ${fmt(due)}`;
  if (due) return `Due ${fmt(due)}`;
  if (start) return `Start ${fmt(start)}`;
  return 'No dates set';
}

function durationDays(start?: string, due?: string) {
  if (!start || !due) return null;
  const d = Math.round((new Date(due).getTime() - new Date(start).getTime()) / 86400000);
  return d > 0 ? d : null;
}

function progressPct(issue: any) {
  if (issue.status === 'DONE' || issue.status === 'CANCELLED') return 100;
  if (issue.status === 'IN_REVIEW') return 80;
  if (issue.status === 'IN_PROGRESS') {
    if (!issue.startDate || !issue.dueDate) return 40;
    const total = new Date(issue.dueDate).getTime() - new Date(issue.startDate).getTime();
    const elapsed = Date.now() - new Date(issue.startDate).getTime();
    return Math.min(Math.max(Math.round((elapsed / total) * 100), 5), 95);
  }
  return 0;
}

export default function RoadmapTab() {
  const { currentIssues, currentProject, fetchProjectDetails } = useProjectStore();
  const [selectedIssue, setSelectedIssue] = useState<any>(null);
  const [expandedEpics, setExpandedEpics] = useState<Set<number>>(new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    if (!currentProject?.id) return;
    setIsRefreshing(true);
    try {
      await fetchProjectDetails(currentProject.id);
    } finally {
      setIsRefreshing(false);
    }
  }, [currentProject?.id, fetchProjectDetails]);

  const sections = useMemo(() => {
    const active = currentIssues.filter(i => !i.isArchived);

    // Group: Epics as section headers, children nested under them
    const epics = active.filter(i => i.type === 'EPIC');
    const nonEpics = active.filter(i => i.type !== 'EPIC');

    const grouped: { title: string; data: any[]; epic: any }[] = epics.map(epic => ({
      title: epic.key,
      data: active.filter(i => i.parentId === epic.id),
      epic,
    }));

    // Issues without an epic parent
    const orphans = nonEpics.filter(i => !i.parentId || !epics.find(e => e.id === i.parentId));
    if (orphans.length > 0) {
      grouped.push({ title: 'NO_EPIC', data: orphans, epic: null });
    }

    // Sort each group by due date
    grouped.forEach(g => {
      g.data.sort((a, b) => {
        if (a.dueDate && b.dueDate) return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
        if (a.dueDate) return -1;
        if (b.dueDate) return 1;
        return 0;
      });
    });

    return grouped;
  }, [currentIssues]);

  const toggleEpic = useCallback((id: number) => {
    setExpandedEpics(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const renderSectionHeader = ({ section }: { section: any }) => {
    if (section.title === 'NO_EPIC') {
      return (
        <View style={styles.sectionLabel}>
          <Text style={styles.sectionLabelText}>Other Issues</Text>
        </View>
      );
    }
    const epic = section.epic;
    const pct = progressPct(epic);
    const statusColor = STATUS_COLORS[epic.status] || '#94A3B8';
    const isExpanded = expandedEpics.has(epic.id);

    return (
      <TouchableOpacity
        style={styles.epicCard}
        onPress={() => toggleEpic(epic.id)}
        activeOpacity={0.85}
      >
        <View style={styles.epicRow}>
          <Text style={styles.epicIcon}>{TYPE_ICONS.EPIC}</Text>
          <View style={styles.epicInfo}>
            <Text style={styles.epicKey}>{epic.key}</Text>
            <Text style={styles.epicTitle} numberOfLines={1}>{epic.title}</Text>
          </View>
          <View style={[styles.epicStatus, { backgroundColor: statusColor + '18' }]}>
            <Text style={[styles.epicStatusText, { color: statusColor }]}>
              {epic.status.replace('_', ' ')}
            </Text>
          </View>
          <ChevronRight
            size={16}
            color="#94A3B8"
            style={{ transform: [{ rotate: isExpanded ? '90deg' : '0deg' }] }}
          />
        </View>
        <View style={styles.epicMeta}>
          <Text style={styles.epicDateRange}>{formatDateRange(epic.startDate, epic.dueDate)}</Text>
          {section.data.length > 0 && (
            <Text style={styles.epicChildCount}>{section.data.length} issues</Text>
          )}
        </View>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, {
            width: `${pct}%`,
            backgroundColor: pct === 100 ? '#10B981' : '#8B5CF6'
          }]} />
        </View>
        <Text style={styles.progressText}>{pct}%</Text>
      </TouchableOpacity>
    );
  };

  const renderItem = ({ item, section }: { item: any; section: any }) => {
    if (section.epic && !expandedEpics.has(section.epic.id)) return null;

    const isOverdue = item.dueDate && new Date(item.dueDate) < new Date() && item.status !== 'DONE';
    const pct = progressPct(item);
    const priorityColor = PRIORITY_COLORS[item.priority] || '#94A3B8';
    const statusColor = STATUS_COLORS[item.status] || '#94A3B8';
    const days = durationDays(item.startDate, item.dueDate);

    return (
      <TouchableOpacity
        style={[styles.issueCard, section.epic && styles.issueCardNested]}
        onPress={() => setSelectedIssue(item)}
        activeOpacity={0.8}
      >
        <View style={[styles.issueLeftBar, { backgroundColor: priorityColor }]} />
        <View style={styles.issueContent}>
          <View style={styles.issueTopRow}>
            <Text style={styles.issueType}>{TYPE_ICONS[item.type] || '✅'}</Text>
            <Text style={styles.issueKey}>{item.key}</Text>
            <View style={[styles.statusBadge, { backgroundColor: statusColor + '18' }]}>
              <Text style={[styles.statusBadgeText, { color: statusColor }]}>
                {item.status.replace('_', ' ')}
              </Text>
            </View>
            {isOverdue && (
              <View style={styles.overdueDot}>
                <AlertCircle size={12} color="#EF4444" />
              </View>
            )}
          </View>
          <Text style={styles.issueTitle} numberOfLines={2}>{item.title}</Text>
          <View style={styles.issueMeta}>
            <Clock size={11} color="#94A3B8" />
            <Text style={[styles.issueDateText, isOverdue && { color: '#EF4444' }]}>
              {formatDateRange(item.startDate, item.dueDate)}
            </Text>
            {days && <Text style={styles.issueDuration}>{days}d</Text>}
          </View>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, {
              width: `${pct}%`,
              backgroundColor: pct === 100 ? '#10B981' : statusColor,
            }]} />
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const activeCount = currentIssues.filter(i => !i.isArchived).length;
  const withDates = currentIssues.filter(i => !i.isArchived && (i.startDate || i.dueDate)).length;

  if (activeCount === 0) {
    return (
      <ScrollView
        contentContainerStyle={styles.emptyContainer}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} colors={['#E25E3E']} tintColor="#E25E3E" />}
      >
        <GanttChart size={40} color="#CBD5E1" />
        <Text style={styles.emptyTitle}>No issues yet</Text>
        <Text style={styles.emptySubtitle}>Create issues on the board to see them here</Text>
      </ScrollView>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <GanttChart size={15} color="#64748B" />
        <Text style={styles.headerText}>{withDates} of {activeCount} issues have date ranges</Text>
      </View>
      <SectionList
        sections={sections}
        keyExtractor={item => item.id.toString()}
        renderSectionHeader={renderSectionHeader}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        stickySectionHeadersEnabled={false}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} colors={['#E25E3E']} tintColor="#E25E3E" />}
      />
      {selectedIssue && (
        <IssueDetailModal
          visible={!!selectedIssue}
          issue={selectedIssue}
          onClose={() => setSelectedIssue(null)}
          projectId={currentProject?.id}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
  },
  headerText: { fontSize: 13, color: '#64748B', fontWeight: '500' },
  list: { paddingHorizontal: 16, paddingBottom: 32 },

  sectionLabel: { paddingVertical: 10 },
  sectionLabelText: { fontSize: 12, fontWeight: '700', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: 0.5 },

  epicCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  epicRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  epicIcon: { fontSize: 16 },
  epicInfo: { flex: 1 },
  epicKey: { fontSize: 10, fontWeight: '700', color: '#94A3B8', marginBottom: 1 },
  epicTitle: { fontSize: 15, fontWeight: '700', color: '#0F172A' },
  epicStatus: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  epicStatusText: { fontSize: 10, fontWeight: '700' },
  epicMeta: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  epicDateRange: { fontSize: 12, color: '#64748B' },
  epicChildCount: { fontSize: 11, color: '#94A3B8' },
  progressBar: { height: 6, backgroundColor: '#F1F5F9', borderRadius: 3, overflow: 'hidden', marginBottom: 4 },
  progressFill: { height: 6, borderRadius: 3 },
  progressText: { fontSize: 11, color: '#94A3B8', textAlign: 'right' },

  issueCard: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    marginBottom: 8,
    overflow: 'hidden',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  issueCardNested: { marginLeft: 16 },
  issueLeftBar: { width: 3 },
  issueContent: { flex: 1, padding: 12 },
  issueTopRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  issueType: { fontSize: 13 },
  issueKey: { fontSize: 11, fontWeight: '700', color: '#94A3B8', flex: 1 },
  statusBadge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 5 },
  statusBadgeText: { fontSize: 9, fontWeight: '700' },
  overdueDot: { marginLeft: 2 },
  issueTitle: { fontSize: 14, fontWeight: '600', color: '#1E293B', lineHeight: 19, marginBottom: 8 },
  issueMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 8 },
  issueDateText: { fontSize: 11, color: '#64748B', flex: 1 },
  issueDuration: {
    fontSize: 10,
    fontWeight: '600',
    color: '#94A3B8',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },

  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 40,
  },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: '#334155' },
  emptySubtitle: { fontSize: 13, color: '#94A3B8', textAlign: 'center', lineHeight: 20 },
});
