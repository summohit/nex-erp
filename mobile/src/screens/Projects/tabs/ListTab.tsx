import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  Image,
  RefreshControl,
} from 'react-native';
import {
  Search,
  X,
  ArrowDown,
  ArrowUp,
  Minus,
  Flame,
  AlertCircle,
  Clock,
  CheckCircle,
  XCircle,
  RotateCcw,
  ChevronRight,
} from 'lucide-react-native';
import { useProjectStore } from '../../../store/projectStore';
import IssueDetailModal from '../modals/IssueDetailModal';

const PRIORITY_CONFIG: Record<string, { color: string; bg: string; icon: React.ComponentType<any> }> = {
  CRITICAL: { color: '#EF4444', bg: '#FEF2F2', icon: Flame },
  HIGH:     { color: '#F97316', bg: '#FFF7ED', icon: ArrowUp },
  MEDIUM:   { color: '#3B82F6', bg: '#EFF6FF', icon: Minus },
  LOW:      { color: '#94A3B8', bg: '#F8FAFC', icon: ArrowDown },
};

const STATUS_CONFIG: Record<string, { color: string; bg: string; icon: React.ComponentType<any>; label: string }> = {
  TODO:        { color: '#94A3B8', bg: '#F8FAFC', icon: AlertCircle,  label: 'To Do' },
  IN_PROGRESS: { color: '#3B82F6', bg: '#EFF6FF', icon: RotateCcw,   label: 'In Progress' },
  IN_REVIEW:   { color: '#A855F7', bg: '#FAF5FF', icon: Clock,        label: 'In Review' },
  DONE:        { color: '#10B981', bg: '#ECFDF5', icon: CheckCircle,  label: 'Done' },
  CANCELLED:   { color: '#EF4444', bg: '#FEF2F2', icon: XCircle,     label: 'Cancelled' },
};

const STATUS_FILTERS = ['ALL', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'CANCELLED'];

const IssueRow = React.memo(({ issue, onPress }: { issue: any; onPress: () => void }) => {
  const p = PRIORITY_CONFIG[issue.priority] || PRIORITY_CONFIG.MEDIUM;
  const s = STATUS_CONFIG[issue.status] || STATUS_CONFIG.TODO;
  const PriorityIcon = p.icon;
  const StatusIcon = s.icon;

  const isOverdue = issue.dueDate && new Date(issue.dueDate) < new Date() && issue.status !== 'DONE';

  return (
    <TouchableOpacity style={styles.issueRow} onPress={onPress} activeOpacity={0.7}>
      <View style={[styles.priorityBar, { backgroundColor: p.color }]} />
      <View style={styles.issueContent}>
        <View style={styles.issueTopRow}>
          <Text style={styles.issueKey}>{issue.key}</Text>
          <View style={[styles.statusChip, { backgroundColor: s.bg }]}>
            <StatusIcon size={11} color={s.color} />
            <Text style={[styles.statusChipText, { color: s.color }]}>{s.label}</Text>
          </View>
        </View>
        <Text style={styles.issueTitle} numberOfLines={2}>{issue.title}</Text>
        <View style={styles.issueFooterRow}>
          <View style={[styles.priorityChip, { backgroundColor: p.bg }]}>
            <PriorityIcon size={11} color={p.color} />
            <Text style={[styles.priorityChipText, { color: p.color }]}>{issue.priority}</Text>
          </View>
          {issue.dueDate && (
            <Text style={[styles.dueDate, isOverdue && styles.dueDateOverdue]}>
              {isOverdue ? '⚠ ' : ''}
              {new Date(issue.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
            </Text>
          )}
          <View style={styles.spacer} />
          {issue.assignee ? (
            issue.assignee.avatarUrl ? (
              <Image source={{ uri: issue.assignee.avatarUrl }} style={styles.assigneeAvatar} />
            ) : (
              <View style={styles.assigneeAvatarFallback}>
                <Text style={styles.assigneeInitial}>
                  {issue.assignee.firstName?.charAt(0) || '?'}
                </Text>
              </View>
            )
          ) : null}
          <ChevronRight size={14} color="#CBD5E1" />
        </View>
      </View>
    </TouchableOpacity>
  );
});

export default function ListTab() {
  const { currentIssues, currentProject, fetchProjectDetails } = useProjectStore();
  const [search, setSearch] = useState('');
  const [activeStatus, setActiveStatus] = useState('ALL');
  const [selectedIssue, setSelectedIssue] = useState<any>(null);
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

  const visibleIssues = useMemo(() => {
    let result = currentIssues.filter(i => !i.isArchived);
    if (activeStatus !== 'ALL') result = result.filter(i => i.status === activeStatus);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        i => i.title?.toLowerCase().includes(q) || i.key?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [currentIssues, activeStatus, search]);

  const handlePress = useCallback((issue: any) => {
    setSelectedIssue(issue);
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: any }) => <IssueRow issue={item} onPress={() => handlePress(item)} />,
    [handlePress]
  );

  const keyExtractor = useCallback((item: any) => item.id.toString(), []);

  return (
    <View style={styles.container}>
      {/* Search */}
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Search size={15} color="#94A3B8" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search issues..."
            placeholderTextColor="#94A3B8"
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <X size={14} color="#94A3B8" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Status filters */}
      <View style={styles.filterScrollContainer}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={STATUS_FILTERS}
          keyExtractor={s => s}
          contentContainerStyle={styles.filterList}
          renderItem={({ item: s }) => {
            const isActive = activeStatus === s;
            const cfg = STATUS_CONFIG[s];
            return (
              <TouchableOpacity
                style={[styles.filterChip, isActive && (cfg ? { backgroundColor: cfg.color } : styles.filterChipActive)]}
                onPress={() => setActiveStatus(s)}
              >
                <Text style={[styles.filterChipText, isActive && styles.filterChipTextActive]}>
                  {s === 'ALL' ? 'All' : cfg?.label || s}
                </Text>
              </TouchableOpacity>
            );
          }}
        />
      </View>

      {/* Issue count */}
      <View style={styles.countRow}>
        <Text style={styles.countText}>{visibleIssues.length} issue{visibleIssues.length !== 1 ? 's' : ''}</Text>
      </View>

      {/* List */}
      <FlatList
        data={visibleIssues}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        contentContainerStyle={visibleIssues.length === 0 ? styles.listEmptyContent : styles.list}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews
        maxToRenderPerBatch={20}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} colors={['#E25E3E']} tintColor="#E25E3E" />}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <AlertCircle size={36} color="#CBD5E1" />
            <Text style={styles.emptyTitle}>No issues found</Text>
            <Text style={styles.emptySubtitle}>
              {search ? 'Try a different search term' : 'No issues match this filter'}
            </Text>
          </View>
        }
      />

      {/* Issue Detail Modal */}
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

  searchRow: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  searchInput: { flex: 1, fontSize: 14, color: '#0F172A', padding: 0 },

  filterScrollContainer: { paddingBottom: 8 },
  filterList: { paddingHorizontal: 16, gap: 8 },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#F1F5F9',
  },
  filterChipActive: { backgroundColor: '#E25E3E' },
  filterChipText: { fontSize: 12, fontWeight: '600', color: '#64748B' },
  filterChipTextActive: { color: '#FFFFFF' },

  countRow: { paddingHorizontal: 16, paddingBottom: 8 },
  countText: { fontSize: 12, color: '#94A3B8', fontWeight: '500' },

  list: { paddingHorizontal: 16, paddingBottom: 32 },
  listEmptyContent: { flexGrow: 1 },

  issueRow: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    marginBottom: 10,
    overflow: 'hidden',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  priorityBar: { width: 4 },
  issueContent: { flex: 1, padding: 13 },
  issueTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  issueKey: { fontSize: 11, fontWeight: '700', color: '#94A3B8' },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 20,
    gap: 4,
  },
  statusChipText: { fontSize: 10, fontWeight: '700' },
  issueTitle: { fontSize: 14, fontWeight: '600', color: '#0F172A', lineHeight: 20, marginBottom: 10 },
  issueFooterRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  priorityChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 4,
  },
  priorityChipText: { fontSize: 10, fontWeight: '700' },
  dueDate: { fontSize: 11, color: '#64748B', fontWeight: '500' },
  dueDateOverdue: { color: '#EF4444' },
  spacer: { flex: 1 },
  assigneeAvatar: { width: 22, height: 22, borderRadius: 11 },
  assigneeAvatarFallback: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#E25E3E',
    justifyContent: 'center',
    alignItems: 'center',
  },
  assigneeInitial: { color: '#FFF', fontSize: 10, fontWeight: '700' },

  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 10, marginTop: 60 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#334155' },
  emptySubtitle: { fontSize: 13, color: '#94A3B8' },
});
