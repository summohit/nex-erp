import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Dimensions,
  RefreshControl,
} from 'react-native';
import { BarChart } from 'react-native-gifted-charts';
import { BarChart2, Users, Target, Clock, TrendingUp } from 'lucide-react-native';
import { useProjectStore } from '../../../store/projectStore';
import { PulseSkeleton } from '../../../components/SharedUI';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CHART_WIDTH = SCREEN_WIDTH - 64;

const PRIORITY_COLORS: Record<string, string> = {
  CRITICAL: '#EF4444',
  HIGH:     '#F97316',
  MEDIUM:   '#3B82F6',
  LOW:      '#94A3B8',
};

const STATUS_COLORS: Record<string, string> = {
  TODO:        '#94A3B8',
  IN_PROGRESS: '#3B82F6',
  IN_REVIEW:   '#A855F7',
  DONE:        '#10B981',
  CANCELLED:   '#EF4444',
};

const STATUS_LABELS: Record<string, string> = {
  TODO:        'To Do',
  IN_PROGRESS: 'In Progress',
  IN_REVIEW:   'In Review',
  DONE:        'Done',
  CANCELLED:   'Cancelled',
};

function SectionCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={styles.sectionCard}>
      <View style={styles.sectionHeader}>
        {icon}
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function Legend({ items }: { items: { label: string; color: string; value: number }[] }) {
  return (
    <View style={styles.legend}>
      {items.map(item => (
        <View key={item.label} style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: item.color }]} />
          <Text style={styles.legendLabel}>{item.label}</Text>
          <Text style={styles.legendValue}>{item.value}</Text>
        </View>
      ))}
    </View>
  );
}

export default function ReportsTab() {
  const { currentSummary, currentIssues, isLoading, currentProject, fetchProjectDetails } = useProjectStore();
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

  const statusBarData = useMemo(() => {
    if (!currentSummary?.statusOverview) return [];
    return currentSummary.statusOverview.map(s => ({
      value: s.count,
      label: STATUS_LABELS[s.status]?.replace(' ', '\n') || s.status,
      frontColor: STATUS_COLORS[s.status] || '#94A3B8',
      topLabelComponent: () => (
        <Text style={styles.barTopLabel}>{s.count}</Text>
      ),
    }));
  }, [currentSummary]);

  const priorityBarData = useMemo(() => {
    if (!currentSummary?.priorityBreakdown) return [];
    return currentSummary.priorityBreakdown.map(p => ({
      value: p.count,
      label: p.priority.charAt(0) + p.priority.slice(1).toLowerCase(),
      frontColor: PRIORITY_COLORS[p.priority] || '#94A3B8',
      topLabelComponent: () => (
        <Text style={styles.barTopLabel}>{p.count}</Text>
      ),
    }));
  }, [currentSummary]);

  const workloadBarData = useMemo(() => {
    if (!currentSummary?.teamWorkload) return [];
    return currentSummary.teamWorkload.slice(0, 6).map(m => ({
      value: m.count,
      label: m.name.split(' ')[0],
      frontColor: '#E25E3E',
      topLabelComponent: () => (
        <Text style={styles.barTopLabel}>{m.count}</Text>
      ),
    }));
  }, [currentSummary]);

  const typeBarData = useMemo(() => {
    if (!currentSummary?.typeDistribution) return [];
    return currentSummary.typeDistribution.map((t: any) => ({
      value: t.count,
      label: t.type,
      frontColor: '#8B5CF6',
      topLabelComponent: () => (
        <Text style={styles.barTopLabel}>{t.count}</Text>
      ),
    }));
  }, [currentSummary]);

  const timeTracking = currentSummary?.timeTracking;
  const loggedPct = timeTracking && timeTracking.estimatedHours > 0
    ? Math.min((timeTracking.loggedHours / timeTracking.estimatedHours) * 100, 100)
    : 0;

  const overdueCount = useMemo(
    () => currentIssues.filter(i => !i.isArchived && i.dueDate && new Date(i.dueDate) < new Date() && i.status !== 'DONE').length,
    [currentIssues]
  );

  if (isLoading) {
    return (
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        {[1, 2, 3].map(i => (
          <PulseSkeleton key={i} style={{ width: '100%', height: 200, borderRadius: 14 }} />
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
        <BarChart2 size={40} color="#CBD5E1" />
        <Text style={styles.emptyText}>No report data available</Text>
      </ScrollView>
    );
  }

  const totalIssues = currentIssues.filter(i => !i.isArchived).length;
  const doneCount = currentSummary.statusOverview.find(s => s.status === 'DONE')?.count || 0;
  const completionPct = totalIssues > 0 ? Math.round((doneCount / totalIssues) * 100) : 0;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} colors={['#E25E3E']} tintColor="#E25E3E" />}
    >

      {/* KPI Row */}
      <View style={styles.kpiRow}>
        <View style={styles.kpiCard}>
          <Text style={styles.kpiValue}>{completionPct}%</Text>
          <Text style={styles.kpiLabel}>Completion</Text>
        </View>
        <View style={styles.kpiCard}>
          <Text style={[styles.kpiValue, { color: '#EF4444' }]}>{overdueCount}</Text>
          <Text style={styles.kpiLabel}>Overdue</Text>
        </View>
        <View style={styles.kpiCard}>
          <Text style={[styles.kpiValue, { color: '#3B82F6' }]}>{currentSummary.metrics.createdLast7Days}</Text>
          <Text style={styles.kpiLabel}>Added (7d)</Text>
        </View>
        <View style={styles.kpiCard}>
          <Text style={[styles.kpiValue, { color: '#10B981' }]}>{currentSummary.metrics.completedLast7Days}</Text>
          <Text style={styles.kpiLabel}>Done (7d)</Text>
        </View>
      </View>

      {/* Completion Progress */}
      <SectionCard title="Overall Progress" icon={<Target size={16} color="#E25E3E" />}>
        <View style={styles.progressRow}>
          <View style={styles.bigProgressBar}>
            <View style={[styles.bigProgressFill, { width: `${completionPct}%` }]} />
          </View>
          <Text style={styles.progressPct}>{completionPct}%</Text>
        </View>
        <Text style={styles.progressSubtitle}>{doneCount} of {totalIssues} issues completed</Text>
      </SectionCard>

      {/* Status Distribution */}
      {statusBarData.length > 0 && (
        <SectionCard title="Status Distribution" icon={<BarChart2 size={16} color="#3B82F6" />}>
          <BarChart
            data={statusBarData}
            width={CHART_WIDTH}
            barWidth={Math.min(40, (CHART_WIDTH - 40) / statusBarData.length - 16)}
            barBorderRadius={6}
            hideRules
            xAxisThickness={1}
            yAxisThickness={0}
            xAxisColor="#E2E8F0"
            yAxisTextStyle={styles.axisLabel}
            xAxisLabelTextStyle={styles.axisLabel}
            noOfSections={4}
            isAnimated
          />
          <Legend
            items={currentSummary.statusOverview.map(s => ({
              label: STATUS_LABELS[s.status] || s.status,
              color: STATUS_COLORS[s.status] || '#94A3B8',
              value: s.count,
            }))}
          />
        </SectionCard>
      )}

      {/* Priority Breakdown */}
      {priorityBarData.length > 0 && (
        <SectionCard title="Priority Breakdown" icon={<TrendingUp size={16} color="#F97316" />}>
          <BarChart
            data={priorityBarData}
            width={CHART_WIDTH}
            barWidth={Math.min(50, (CHART_WIDTH - 40) / priorityBarData.length - 16)}
            barBorderRadius={6}
            hideRules
            xAxisThickness={1}
            yAxisThickness={0}
            xAxisColor="#E2E8F0"
            yAxisTextStyle={styles.axisLabel}
            xAxisLabelTextStyle={styles.axisLabel}
            noOfSections={4}
            isAnimated
          />
          <Legend
            items={currentSummary.priorityBreakdown.map(p => ({
              label: p.priority,
              color: PRIORITY_COLORS[p.priority] || '#94A3B8',
              value: p.count,
            }))}
          />
        </SectionCard>
      )}

      {/* Team Workload */}
      {workloadBarData.length > 0 && (
        <SectionCard title="Team Workload" icon={<Users size={16} color="#8B5CF6" />}>
          <BarChart
            data={workloadBarData}
            width={CHART_WIDTH}
            barWidth={Math.min(44, (CHART_WIDTH - 40) / workloadBarData.length - 12)}
            barBorderRadius={6}
            hideRules
            xAxisThickness={1}
            yAxisThickness={0}
            xAxisColor="#E2E8F0"
            yAxisTextStyle={styles.axisLabel}
            xAxisLabelTextStyle={styles.axisLabel}
            noOfSections={4}
            isAnimated
          />
          <View style={styles.workloadList}>
            {currentSummary.teamWorkload.slice(0, 6).map(m => (
              <View key={m.assigneeId} style={styles.workloadItem}>
                <View style={styles.workloadAvatarFallback}>
                  <Text style={styles.workloadAvatarText}>{m.name.charAt(0)}</Text>
                </View>
                <Text style={styles.workloadName} numberOfLines={1}>{m.name}</Text>
                <Text style={styles.workloadCount}>{m.count} tasks</Text>
              </View>
            ))}
          </View>
        </SectionCard>
      )}

      {/* Type Distribution */}
      {typeBarData.length > 0 && (
        <SectionCard title="Issue Types" icon={<Target size={16} color="#8B5CF6" />}>
          <BarChart
            data={typeBarData}
            width={CHART_WIDTH}
            barWidth={Math.min(44, (CHART_WIDTH - 40) / typeBarData.length - 12)}
            barBorderRadius={6}
            hideRules
            xAxisThickness={1}
            yAxisThickness={0}
            xAxisColor="#E2E8F0"
            yAxisTextStyle={styles.axisLabel}
            xAxisLabelTextStyle={styles.axisLabel}
            noOfSections={4}
            isAnimated
          />
        </SectionCard>
      )}

      {/* Time Tracking */}
      {timeTracking && (timeTracking.estimatedHours > 0 || timeTracking.loggedHours > 0) && (
        <SectionCard title="Time Tracking" icon={<Clock size={16} color="#10B981" />}>
          <View style={styles.timeStatsRow}>
            <View style={styles.timeStat}>
              <Text style={styles.timeStatValue}>{timeTracking.estimatedHours.toFixed(1)}h</Text>
              <Text style={styles.timeStatLabel}>Estimated</Text>
            </View>
            <View style={styles.timeDivider} />
            <View style={styles.timeStat}>
              <Text style={[styles.timeStatValue, { color: '#10B981' }]}>{timeTracking.loggedHours.toFixed(1)}h</Text>
              <Text style={styles.timeStatLabel}>Logged</Text>
            </View>
            <View style={styles.timeDivider} />
            <View style={styles.timeStat}>
              <Text style={[styles.timeStatValue, {
                color: timeTracking.loggedHours > timeTracking.estimatedHours ? '#EF4444' : '#3B82F6'
              }]}>
                {loggedPct.toFixed(0)}%
              </Text>
              <Text style={styles.timeStatLabel}>Used</Text>
            </View>
          </View>
          <View style={styles.bigProgressBar}>
            <View style={[
              styles.bigProgressFill,
              {
                width: `${loggedPct}%`,
                backgroundColor: loggedPct > 100 ? '#EF4444' : '#10B981',
              }
            ]} />
          </View>
        </SectionCard>
      )}

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  content: { padding: 16 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  emptyText: { fontSize: 15, color: '#94A3B8', fontWeight: '500' },

  kpiRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  kpiCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  kpiValue: { fontSize: 20, fontWeight: '800', color: '#E25E3E', marginBottom: 2 },
  kpiLabel: { fontSize: 10, color: '#94A3B8', fontWeight: '600', textAlign: 'center' },

  sectionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#0F172A' },

  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 6 },
  bigProgressBar: { flex: 1, height: 10, backgroundColor: '#F1F5F9', borderRadius: 5, overflow: 'hidden' },
  bigProgressFill: { height: 10, backgroundColor: '#10B981', borderRadius: 5 },
  progressPct: { fontSize: 15, fontWeight: '800', color: '#10B981', width: 44, textAlign: 'right' },
  progressSubtitle: { fontSize: 12, color: '#94A3B8' },

  axisLabel: { fontSize: 10, color: '#94A3B8', fontWeight: '500' },
  barTopLabel: { fontSize: 10, fontWeight: '700', color: '#334155' },

  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { fontSize: 11, color: '#64748B' },
  legendValue: { fontSize: 11, fontWeight: '700', color: '#0F172A' },

  workloadList: { marginTop: 12, gap: 8 },
  workloadItem: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  workloadAvatarFallback: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#E25E3E',
    justifyContent: 'center',
    alignItems: 'center',
  },
  workloadAvatarText: { color: '#FFF', fontSize: 12, fontWeight: '700' },
  workloadName: { flex: 1, fontSize: 13, color: '#334155', fontWeight: '500' },
  workloadCount: { fontSize: 12, color: '#94A3B8', fontWeight: '600' },

  timeStatsRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  timeStat: { flex: 1, alignItems: 'center', gap: 4 },
  timeDivider: { width: 1, height: 40, backgroundColor: '#E2E8F0' },
  timeStatValue: { fontSize: 20, fontWeight: '800', color: '#0F172A' },
  timeStatLabel: { fontSize: 11, color: '#94A3B8', fontWeight: '500' },
});
