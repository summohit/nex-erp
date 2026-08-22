import React, { useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { Calendar } from 'react-native-calendars';
import { CalendarIcon, AlertCircle, CheckCircle, Clock } from 'lucide-react-native';
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

function toYMD(date: Date) {
  return date.toISOString().split('T')[0];
}

export default function CalendarTab() {
  const { currentIssues, currentProject, fetchProjectDetails } = useProjectStore();
  const [selectedDay, setSelectedDay] = useState<string>(toYMD(new Date()));
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

  // Build marked dates from issues with due dates
  const { markedDates, issuesByDate } = useMemo(() => {
    const marks: Record<string, any> = {};
    const byDate: Record<string, any[]> = {};

    currentIssues
      .filter(i => !i.isArchived && i.dueDate)
      .forEach(issue => {
        const dateStr = toYMD(new Date(issue.dueDate));
        if (!byDate[dateStr]) byDate[dateStr] = [];
        byDate[dateStr].push(issue);

        const isOverdue = new Date(issue.dueDate) < new Date() && issue.status !== 'DONE';
        const dotColor = isOverdue ? '#EF4444' : PRIORITY_COLORS[issue.priority] || '#3B82F6';

        if (!marks[dateStr]) {
          marks[dateStr] = { dots: [] };
        }
        if (marks[dateStr].dots.length < 3) {
          marks[dateStr].dots.push({ color: dotColor, key: `issue-${issue.id}` });
        }
      });

    // Highlight selected
    if (marks[selectedDay]) {
      marks[selectedDay] = {
        ...marks[selectedDay],
        selected: true,
        selectedColor: '#E25E3E',
      };
    } else {
      marks[selectedDay] = { selected: true, selectedColor: '#E25E3E' };
    }

    return { markedDates: marks, issuesByDate: byDate };
  }, [currentIssues, selectedDay]);

  const issuesForDay = useMemo(
    () => issuesByDate[selectedDay] || [],
    [issuesByDate, selectedDay]
  );

  const handleDayPress = useCallback((day: any) => {
    setSelectedDay(day.dateString);
  }, []);

  const renderIssue = ({ item }: { item: any }) => {
    const isOverdue = new Date(item.dueDate) < new Date() && item.status !== 'DONE';
    const statusColor = STATUS_COLORS[item.status] || '#94A3B8';
    const priorityColor = PRIORITY_COLORS[item.priority] || '#94A3B8';

    return (
      <TouchableOpacity
        style={styles.issueCard}
        onPress={() => setSelectedIssue(item)}
        activeOpacity={0.8}
      >
        <View style={[styles.priorityIndicator, { backgroundColor: priorityColor }]} />
        <View style={styles.issueInfo}>
          <View style={styles.issueTopRow}>
            <Text style={styles.issueKey}>{item.key}</Text>
            {isOverdue && (
              <View style={styles.overdueBadge}>
                <AlertCircle size={11} color="#EF4444" />
                <Text style={styles.overdueText}>Overdue</Text>
              </View>
            )}
          </View>
          <Text style={styles.issueTitle} numberOfLines={2}>{item.title}</Text>
          <View style={styles.issueFooter}>
            <View style={[styles.statusChip, { backgroundColor: statusColor + '18' }]}>
              <Text style={[styles.statusChipText, { color: statusColor }]}>
                {item.status.replace('_', ' ')}
              </Text>
            </View>
            {item.assignee && (
              <Text style={styles.assigneeName} numberOfLines={1}>
                {item.assignee.firstName} {item.assignee.lastName}
              </Text>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const selectedDate = new Date(selectedDay + 'T00:00:00');
  const formattedDate = selectedDate.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  const totalWithDueDate = currentIssues.filter(i => !i.isArchived && i.dueDate).length;
  const overdueTotal = currentIssues.filter(
    i => !i.isArchived && i.dueDate && new Date(i.dueDate) < new Date() && i.status !== 'DONE'
  ).length;

  return (
    <View style={styles.container}>
      {/* Summary strip */}
      <View style={styles.summaryStrip}>
        <View style={styles.summaryItem}>
          <CalendarIcon size={13} color="#3B82F6" />
          <Text style={styles.summaryText}>{totalWithDueDate} with due dates</Text>
        </View>
        {overdueTotal > 0 && (
          <View style={styles.summaryItem}>
            <AlertCircle size={13} color="#EF4444" />
            <Text style={[styles.summaryText, { color: '#EF4444' }]}>{overdueTotal} overdue</Text>
          </View>
        )}
      </View>

      <Calendar
        markingType="multi-dot"
        markedDates={markedDates}
        onDayPress={handleDayPress}
        theme={{
          calendarBackground: '#FFFFFF',
          selectedDayBackgroundColor: '#E25E3E',
          selectedDayTextColor: '#FFFFFF',
          todayTextColor: '#E25E3E',
          arrowColor: '#E25E3E',
          monthTextColor: '#0F172A',
          textMonthFontWeight: '700',
          textDayFontSize: 13,
          textMonthFontSize: 15,
          textDayHeaderFontSize: 12,
          dayTextColor: '#0F172A',
          textSectionTitleColor: '#94A3B8',
          dotColor: '#E25E3E',
          selectedDotColor: '#FFFFFF',
        }}
        style={styles.calendar}
      />

      {/* Day issues */}
      <View style={styles.daySection}>
        <View style={styles.dayHeader}>
          <Text style={styles.dayTitle}>{formattedDate}</Text>
          <Text style={styles.dayCount}>{issuesForDay.length} issue{issuesForDay.length !== 1 ? 's' : ''}</Text>
        </View>
        <FlatList
          data={issuesForDay}
          keyExtractor={item => item.id.toString()}
          renderItem={renderIssue}
          contentContainerStyle={issuesForDay.length === 0 ? styles.emptyDayContent : styles.issueList}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} colors={['#E25E3E']} tintColor="#E25E3E" />}
          ListEmptyComponent={
            <View style={styles.emptyDay}>
              <CheckCircle size={28} color="#CBD5E1" />
              <Text style={styles.emptyDayText}>No issues due on this day</Text>
            </View>
          }
        />
      </View>

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

  summaryStrip: {
    flexDirection: 'row',
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  summaryItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  summaryText: { fontSize: 12, color: '#64748B', fontWeight: '500' },

  calendar: {
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },

  daySection: { flex: 1 },
  dayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    backgroundColor: '#FFFFFF',
  },
  dayTitle: { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  dayCount: { fontSize: 12, color: '#94A3B8', fontWeight: '500' },

  issueList: { padding: 16, gap: 10 },
  emptyDayContent: { flexGrow: 1 },
  issueCard: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  priorityIndicator: { width: 4 },
  issueInfo: { flex: 1, padding: 12 },
  issueTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 5 },
  issueKey: { fontSize: 11, fontWeight: '700', color: '#94A3B8' },
  overdueBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#FEF2F2',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
  },
  overdueText: { fontSize: 10, fontWeight: '700', color: '#EF4444' },
  issueTitle: { fontSize: 14, fontWeight: '600', color: '#0F172A', lineHeight: 20, marginBottom: 8 },
  issueFooter: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusChipText: { fontSize: 10, fontWeight: '700' },
  assigneeName: { fontSize: 11, color: '#64748B' },

  emptyDay: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 10, marginTop: 40 },
  emptyDayText: { fontSize: 14, color: '#94A3B8', fontWeight: '500' },
});
