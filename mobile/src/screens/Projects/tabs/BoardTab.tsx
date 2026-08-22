import React, { useState, useMemo, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Dimensions, Platform, FlatList, RefreshControl, Animated, Image } from 'react-native';
import { useProjectStore } from '../../../store/projectStore';
import { AlertCircle, CheckCircle, Clock, Plus, ArrowDown, Minus, ArrowUp, Flame, MessageSquare } from 'lucide-react-native';
import IssueFormModal from '../modals/IssueFormModal';
import IssueDetailModal from '../modals/IssueDetailModal';
import { useProjectPermissions } from '../../../hooks/useProjectPermissions';

const { width } = Dimensions.get('window');
const COLUMN_WIDTH = width * 0.85;
const MAX_CARD_AVATARS = 3;

// Matches web's getMemberColor() palette exactly (project-detail.ts)
const MEMBER_COLORS = ['#0c66e4', '#1f845a', '#c25100', '#c9372c', '#6e5dc6', '#943d73', '#206a83', '#505f79'];
const getMemberColor = (employeeId: number) => MEMBER_COLORS[employeeId % MEMBER_COLORS.length];
const getMemberInitials = (emp: any) => {
  const fn = (emp?.firstName || '').charAt(0).toUpperCase();
  const ln = (emp?.lastName || '').charAt(0).toUpperCase();
  return (fn + ln) || 'M';
};

export default function BoardTab() {
  const { currentProject, currentBoard, currentIssues, createIssue, fetchProjectDetails, isLoading } = useProjectStore();

  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<any>(null);
  
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
    
    currentIssues.forEach(issue => {
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
  }, [currentIssues, columns]);

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
        return { icon: ArrowUp, color: '#D97706', bg: '#FFFBEB' };
      case 'CRITICAL':
        return { icon: Flame, color: '#DC2626', bg: '#FEF2F2' };
      case 'MEDIUM':
      default:
        return { icon: Minus, color: '#2563EB', bg: '#EFF6FF' };
    }
  };

  const formatTimeSummary = (min: number) => (min < 60 ? `${Math.round(min)}m` : `${(min / 60).toFixed(1)}h`);

  const getIssueTimeSummary = (issue: any): { display: string; isRunning: boolean; isOver: boolean } | null => {
    const isRunning = !!(issue.workStartedAt && !issue.workCompletedAt);
    let loggedMin = 0;
    if (Array.isArray(issue.timeLogs) && issue.timeLogs.length > 0) {
      loggedMin = issue.timeLogs.reduce((acc: number, log: any) => acc + (log.durationMin || 0), 0);
    }
    const estHours = issue.estimatedHours || 0;
    const estMin = estHours * 60;

    if (!isRunning && loggedMin === 0 && estHours === 0) return null;

    if (isRunning) {
      return { display: 'Timer Active', isRunning: true, isOver: false };
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

    return (
      <TouchableOpacity
        style={styles.issueCard}
        activeOpacity={0.7}
        onPress={() => openIssueDetails(item)}
      >
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

          {(timeSummary || commentCount > 0) && (
            <View style={styles.cardMetaRow}>
              {timeSummary && (
                <View style={[styles.timeBadge, timeSummary.isRunning && styles.timeBadgeRunning, timeSummary.isOver && styles.timeBadgeOver]}>
                  {timeSummary.isRunning && <View style={styles.pulseDot} />}
                  <Clock size={11} color={timeSummary.isRunning ? '#16A34A' : timeSummary.isOver ? '#DC2626' : '#64748B'} />
                  <Text style={[styles.timeBadgeText, timeSummary.isRunning && { color: '#16A34A' }, timeSummary.isOver && { color: '#DC2626' }]}>
                    {timeSummary.display}
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
                        colors={['#E25E3E']}
                        tintColor="#E25E3E"
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
          await createIssue(currentProject.id, data);
        }}
      />

      {/* Issue Detail Modal */}
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
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginBottom: 6,
  },
  rejectedPillText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#DC2626',
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
    backgroundColor: '#FEF2F2',
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
    backgroundColor: '#E25E3E',
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
    ...StyleSheet.absoluteFillObject,
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
