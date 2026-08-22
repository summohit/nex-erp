import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  RefreshControl,
} from 'react-native';
import {
  CheckCircle,
  Clock,
  Plus,
  AlertCircle,
  Users,
  Activity,
  Timer,
  TrendingUp,
} from 'lucide-react-native';
import { useProjectStore } from '../../../store/projectStore';
import { PulseSkeleton } from '../../../components/SharedUI';

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

const MetricCard = ({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) => (
  <View style={[styles.metricCard, { borderLeftColor: color }]}>
    <View style={[styles.metricIcon, { backgroundColor: color + '18' }]}>{icon}</View>
    <Text style={styles.metricValue}>{value}</Text>
    <Text style={styles.metricLabel}>{label}</Text>
  </View>
);

const formatTimeAgo = (dateStr: string) => {
  try {
    const d = new Date(dateStr);
    const diff = Date.now() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  } catch {
    return '';
  }
};

export default function SummaryTab() {
  const { currentSummary, currentProject, isLoading, fetchProjectDetails } = useProjectStore();
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

  if (isLoading) {
    return (
      <ScrollView contentContainerStyle={styles.loadingContainer}>
        {[1, 2, 3].map(i => (
          <PulseSkeleton key={i} style={{ width: '100%', height: 100, borderRadius: 12, marginBottom: 16 }} />
        ))}
      </ScrollView>
    );
  }

  if (!currentSummary) {
    return (
      <ScrollView
        contentContainerStyle={styles.emptyContainer}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} colors={['#E25E3E']} tintColor="#E25E3E" />}
      >
        <Activity size={40} color="#CBD5E1" />
        <Text style={styles.emptyText}>No summary data available</Text>
      </ScrollView>
    );
  }

  const { metrics, statusOverview, teamWorkload, priorityBreakdown, recentActivity, timeTracking } = currentSummary;
  const totalIssues = statusOverview.reduce((sum, s) => sum + s.count, 0);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} colors={['#E25E3E']} tintColor="#E25E3E" />}
    >

      {/* Project Info Card */}
      <View style={styles.projectInfoCard}>
        <Text style={styles.projectName}>{currentProject?.name}</Text>
        {currentProject?.description ? (
          <Text style={styles.projectDesc} numberOfLines={3}>{currentProject.description}</Text>
        ) : null}
        <View style={styles.projectMeta}>
          {currentProject?.status ? (
            <View style={[styles.statusPill, { backgroundColor: '#E25E3E18' }]}>
              <Text style={[styles.statusPillText, { color: '#E25E3E' }]}>{currentProject.status}</Text>
            </View>
          ) : null}
          {currentProject?.billingType ? (
            <View style={styles.statusPill}>
              <Text style={styles.statusPillText}>{currentProject.billingType}</Text>
            </View>
          ) : null}
        </View>
      </View>

      {/* Metrics Row */}
      <Text style={styles.sectionTitle}>Last 7 Days Activity</Text>
      <View style={styles.metricsGrid}>
        <MetricCard
          icon={<CheckCircle size={18} color="#10B981" />}
          label="Completed"
          value={metrics.completedLast7Days}
          color="#10B981"
        />
        <MetricCard
          icon={<TrendingUp size={18} color="#3B82F6" />}
          label="Updated"
          value={metrics.updatedLast7Days}
          color="#3B82F6"
        />
        <MetricCard
          icon={<Plus size={18} color="#8B5CF6" />}
          label="Created"
          value={metrics.createdLast7Days}
          color="#8B5CF6"
        />
        <MetricCard
          icon={<AlertCircle size={18} color="#F97316" />}
          label="Due Soon"
          value={metrics.dueSoonNext7Days}
          color="#F97316"
        />
      </View>

      {/* Status Overview */}
      {statusOverview.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Status Overview</Text>
          <View style={styles.card}>
            {statusOverview.map(s => {
              const pct = totalIssues > 0 ? (s.count / totalIssues) * 100 : 0;
              const color = STATUS_COLORS[s.status] || '#94A3B8';
              return (
                <View key={s.status} style={styles.statusRow}>
                  <View style={styles.statusLabelRow}>
                    <View style={[styles.statusDot, { backgroundColor: color }]} />
                    <Text style={styles.statusLabel}>{s.status.replace('_', ' ')}</Text>
                    <Text style={styles.statusCount}>{s.count}</Text>
                  </View>
                  <View style={styles.progressBar}>
                    <View style={[styles.progressFill, { width: `${pct}%`, backgroundColor: color }]} />
                  </View>
                </View>
              );
            })}
            <Text style={styles.totalText}>Total: {totalIssues} issues</Text>
          </View>
        </>
      )}

      {/* Priority Breakdown */}
      {priorityBreakdown.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Priority Breakdown</Text>
          <View style={[styles.card, styles.priorityRow]}>
            {priorityBreakdown.map(p => {
              const color = PRIORITY_COLORS[p.priority] || '#94A3B8';
              const pct = totalIssues > 0 ? Math.round((p.count / totalIssues) * 100) : 0;
              return (
                <View key={p.priority} style={styles.priorityItem}>
                  <View style={[styles.priorityCircle, { backgroundColor: color + '20', borderColor: color }]}>
                    <Text style={[styles.priorityCount, { color }]}>{p.count}</Text>
                  </View>
                  <Text style={styles.priorityLabel}>{p.priority}</Text>
                  <Text style={styles.priorityPct}>{pct}%</Text>
                </View>
              );
            })}
          </View>
        </>
      )}

      {/* Time Tracking */}
      {timeTracking && (timeTracking.estimatedHours > 0 || timeTracking.loggedHours > 0) && (
        <>
          <Text style={styles.sectionTitle}>Time Tracking</Text>
          <View style={styles.card}>
            <View style={styles.timeRow}>
              <View style={styles.timeStat}>
                <Timer size={16} color="#8B5CF6" />
                <Text style={styles.timeValue}>{timeTracking.estimatedHours.toFixed(1)}h</Text>
                <Text style={styles.timeSubLabel}>Estimated</Text>
              </View>
              <View style={styles.timeVsDivider} />
              <View style={styles.timeStat}>
                <Clock size={16} color="#10B981" />
                <Text style={styles.timeValue}>{timeTracking.loggedHours.toFixed(1)}h</Text>
                <Text style={styles.timeSubLabel}>Logged</Text>
              </View>
            </View>
            {timeTracking.estimatedHours > 0 && (
              <View style={styles.progressBar}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${Math.min((timeTracking.loggedHours / timeTracking.estimatedHours) * 100, 100)}%`,
                      backgroundColor: timeTracking.loggedHours > timeTracking.estimatedHours ? '#EF4444' : '#10B981',
                    },
                  ]}
                />
              </View>
            )}
          </View>
        </>
      )}

      {/* Team Workload */}
      {teamWorkload.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Team Workload</Text>
          <View style={styles.card}>
            {teamWorkload.slice(0, 8).map(member => {
              const maxCount = Math.max(...teamWorkload.map(m => m.count));
              const pct = maxCount > 0 ? (member.count / maxCount) * 100 : 0;
              return (
                <View key={member.assigneeId} style={styles.workloadRow}>
                  <View style={styles.workloadMember}>
                    {member.avatarUrl ? (
                      <Image source={{ uri: member.avatarUrl }} style={styles.memberAvatar} />
                    ) : (
                      <View style={styles.memberAvatarFallback}>
                        <Text style={styles.memberAvatarText}>{member.name.charAt(0)}</Text>
                      </View>
                    )}
                    <Text style={styles.memberName} numberOfLines={1}>{member.name}</Text>
                  </View>
                  <View style={styles.workloadBarContainer}>
                    <View style={[styles.workloadBar, { width: `${pct}%` }]} />
                  </View>
                  <Text style={styles.workloadCount}>{member.count}</Text>
                </View>
              );
            })}
          </View>
        </>
      )}

      {/* Recent Activity */}
      {recentActivity && recentActivity.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Recent Activity</Text>
          <View style={styles.card}>
            {recentActivity.slice(0, 10).map((item: any, idx: number) => (
              <View key={item.id ?? idx} style={[styles.activityItem, idx === recentActivity.slice(0, 10).length - 1 && styles.activityItemLast]}>
                <View style={styles.activityDot} />
                <View style={styles.activityContent}>
                  <Text style={styles.activityUser} numberOfLines={1}>
                    {item.actor?.firstName || item.user?.firstName || 'Someone'}
                  </Text>
                  <Text style={styles.activityAction} numberOfLines={2}>
                    {item.action === 'CREATED' ? 'created' : item.action === 'STATUS_CHANGED' ? `moved to ${item.detail || ''}` : item.action?.toLowerCase().replace('_', ' ') || 'updated'}{' '}
                    <Text style={styles.activityIssue}>{item.issue?.key || item.issueKey || ''} {item.issue?.title || ''}</Text>
                  </Text>
                  <Text style={styles.activityTime}>{formatTimeAgo(item.createdAt)}</Text>
                </View>
              </View>
            ))}
          </View>
        </>
      )}

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  content: { padding: 16 },
  loadingContainer: { padding: 16, gap: 16 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 80 },
  emptyText: { fontSize: 15, color: '#94A3B8', fontWeight: '500' },

  projectInfoCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  projectName: { fontSize: 18, fontWeight: '700', color: '#0F172A', marginBottom: 6 },
  projectDesc: { fontSize: 13, color: '#64748B', lineHeight: 20, marginBottom: 10 },
  projectMeta: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  statusPill: {
    backgroundColor: '#F1F5F9',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusPillText: { fontSize: 11, fontWeight: '600', color: '#475569' },

  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 10,
    marginTop: 4,
  },

  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 20,
  },
  metricCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    borderLeftWidth: 3,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  metricIcon: { width: 32, height: 32, borderRadius: 8, justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  metricValue: { fontSize: 22, fontWeight: '800', color: '#0F172A', marginBottom: 2 },
  metricLabel: { fontSize: 11, color: '#64748B', fontWeight: '500' },

  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },

  statusRow: { marginBottom: 12 },
  statusLabelRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 5 },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  statusLabel: { flex: 1, fontSize: 13, color: '#334155', fontWeight: '500' },
  statusCount: { fontSize: 13, fontWeight: '700', color: '#0F172A' },
  progressBar: {
    height: 6,
    backgroundColor: '#F1F5F9',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: { height: 6, borderRadius: 3 },
  totalText: { fontSize: 12, color: '#94A3B8', marginTop: 8, textAlign: 'right' },

  priorityRow: { flexDirection: 'row', justifyContent: 'space-around' },
  priorityItem: { alignItems: 'center', gap: 6 },
  priorityCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  priorityCount: { fontSize: 18, fontWeight: '800' },
  priorityLabel: { fontSize: 10, fontWeight: '600', color: '#64748B' },
  priorityPct: { fontSize: 10, color: '#94A3B8' },

  timeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  timeStat: { flex: 1, alignItems: 'center', gap: 4 },
  timeVsDivider: { width: 1, height: 40, backgroundColor: '#E2E8F0' },
  timeValue: { fontSize: 20, fontWeight: '800', color: '#0F172A' },
  timeSubLabel: { fontSize: 11, color: '#64748B', fontWeight: '500' },

  workloadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 10,
  },
  workloadMember: { width: 120, flexDirection: 'row', alignItems: 'center', gap: 8 },
  memberAvatar: { width: 28, height: 28, borderRadius: 14 },
  memberAvatarFallback: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#E25E3E',
    justifyContent: 'center',
    alignItems: 'center',
  },
  memberAvatarText: { color: '#FFF', fontSize: 12, fontWeight: '700' },
  memberName: { flex: 1, fontSize: 12, color: '#334155', fontWeight: '500' },
  workloadBarContainer: { flex: 1, height: 8, backgroundColor: '#F1F5F9', borderRadius: 4, overflow: 'hidden' },
  workloadBar: { height: 8, backgroundColor: '#E25E3E', borderRadius: 4 },
  workloadCount: { width: 24, fontSize: 12, fontWeight: '700', color: '#0F172A', textAlign: 'right' },

  activityItem: {
    flexDirection: 'row',
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    marginBottom: 14,
    gap: 12,
  },
  activityItemLast: { borderBottomWidth: 0, marginBottom: 0, paddingBottom: 0 },
  activityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E25E3E',
    marginTop: 4,
  },
  activityContent: { flex: 1 },
  activityUser: { fontSize: 13, fontWeight: '700', color: '#0F172A', marginBottom: 2 },
  activityAction: { fontSize: 12, color: '#64748B', lineHeight: 18 },
  activityIssue: { fontWeight: '600', color: '#334155' },
  activityTime: { fontSize: 11, color: '#94A3B8', marginTop: 3 },
});
