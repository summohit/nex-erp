import React, { useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { Archive, RotateCcw, AlertCircle } from 'lucide-react-native';
import { useProjectStore } from '../../../store/projectStore';
import { projectService } from '../../../api/projectService';
import IssueDetailModal from '../modals/IssueDetailModal';
import { useProjectPermissions } from '../../../hooks/useProjectPermissions';

const PRIORITY_COLORS: Record<string, string> = {
  CRITICAL: '#EF4444',
  HIGH: '#F97316',
  MEDIUM: '#3B82F6',
  LOW: '#94A3B8',
};

const TYPE_COLORS: Record<string, string> = {
  EPIC: '#8B5CF6',
  STORY: '#10B981',
  TASK: '#3B82F6',
  BUG: '#EF4444',
  SUBTASK: '#F97316',
};

export default function ArchivedTab() {
  const { currentIssues, currentProject, currentBoard, fetchProjectDetails } = useProjectStore();
  const [restoringId, setRestoringId] = useState<number | null>(null);
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

  const columns = useMemo(() => {
    if (currentBoard && Array.isArray(currentBoard.columns)) {
      return currentBoard.columns;
    }
    return [];
  }, [currentBoard]);

  const perms = useProjectPermissions(currentProject, columns);

  const archivedIssues = useMemo(
    () => currentIssues.filter(i => i.isArchived),
    [currentIssues]
  );

  const handleRestore = useCallback((issue: any) => {
    Alert.alert(
      'Restore Issue',
      `Move "${issue.title}" back to the board?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore',
          onPress: async () => {
            setRestoringId(issue.id);
            try {
              await projectService.toggleIssueArchive(currentProject?.id, issue.id);
              if (currentProject?.id) await fetchProjectDetails(currentProject.id);
            } catch {
              Alert.alert('Error', 'Failed to restore issue.');
            } finally {
              setRestoringId(null);
            }
          },
        },
      ]
    );
  }, [currentProject, fetchProjectDetails]);

  const renderItem = ({ item }: { item: any }) => {
    const priorityColor = PRIORITY_COLORS[item.priority] || '#94A3B8';
    const typeColor = TYPE_COLORS[item.type] || '#3B82F6';
    const isRestoring = restoringId === item.id;

    return (
      <TouchableOpacity
        style={[styles.card, isRestoring && { opacity: 0.5 }]}
        onPress={() => setSelectedIssue(item)}
        activeOpacity={0.8}
      >
        <View style={styles.cardTop}>
          <View style={styles.badgesRow}>
            <View style={[styles.typeBadge, { backgroundColor: typeColor + '18' }]}>
              <Text style={[styles.typeBadgeText, { color: typeColor }]}>{item.type}</Text>
            </View>
            <View style={[styles.priorityBadge, { backgroundColor: priorityColor + '18' }]}>
              <Text style={[styles.priorityBadgeText, { color: priorityColor }]}>{item.priority}</Text>
            </View>
          </View>
          {perms.canCompleteIssue(item) && (
            <TouchableOpacity
              style={styles.restoreBtn}
              onPress={() => handleRestore(item)}
              disabled={isRestoring}
            >
              {isRestoring ? (
                <ActivityIndicator size="small" color="#10B981" />
              ) : (
                <>
                  <RotateCcw size={13} color="#10B981" />
                  <Text style={styles.restoreBtnText}>Restore</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>

        <Text style={styles.issueKey}>{item.key}</Text>
        <Text style={styles.issueTitle} numberOfLines={2}>{item.title}</Text>

        <View style={styles.cardBottom}>
          {item.assignee ? (
            <View style={styles.assigneeRow}>
              <View style={styles.assigneeAvatar}>
                <Text style={styles.assigneeInitial}>{item.assignee.firstName?.charAt(0)}</Text>
              </View>
              <Text style={styles.assigneeName} numberOfLines={1}>
                {item.assignee.firstName} {item.assignee.lastName}
              </Text>
            </View>
          ) : (
            <Text style={styles.unassigned}>Unassigned</Text>
          )}
          {item.dueDate && (
            <Text style={styles.dueDate}>
              {new Date(item.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}
            </Text>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  if (archivedIssues.length === 0) {
    return (
      <ScrollView
        contentContainerStyle={styles.emptyContainer}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} colors={['#E25E3E']} tintColor="#E25E3E" />}
      >
        <Archive size={44} color="#CBD5E1" />
        <Text style={styles.emptyTitle}>No archived issues</Text>
        <Text style={styles.emptySubtitle}>Issues you archive will appear here. You can restore them at any time.</Text>
      </ScrollView>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Archive size={15} color="#64748B" />
        <Text style={styles.headerText}>
          {archivedIssues.length} archived issue{archivedIssues.length !== 1 ? 's' : ''}
        </Text>
      </View>
      <FlatList
        data={archivedIssues}
        keyExtractor={item => item.id.toString()}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
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

  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderStyle: 'dashed',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  badgesRow: { flexDirection: 'row', gap: 6 },
  typeBadge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 4 },
  typeBadgeText: { fontSize: 10, fontWeight: '700' },
  priorityBadge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 4 },
  priorityBadgeText: { fontSize: 10, fontWeight: '700' },
  restoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  restoreBtnText: { fontSize: 12, fontWeight: '700', color: '#10B981' },
  issueKey: { fontSize: 11, fontWeight: '700', color: '#CBD5E1', marginBottom: 4 },
  issueTitle: { fontSize: 14, fontWeight: '600', color: '#475569', lineHeight: 20, marginBottom: 10 },
  cardBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  assigneeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  assigneeAvatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#CBD5E1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  assigneeInitial: { fontSize: 10, fontWeight: '700', color: '#FFF' },
  assigneeName: { fontSize: 12, color: '#64748B', maxWidth: 120 },
  unassigned: { fontSize: 12, color: '#CBD5E1' },
  dueDate: { fontSize: 11, color: '#94A3B8' },

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
