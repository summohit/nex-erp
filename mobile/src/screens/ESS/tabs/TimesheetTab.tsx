import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, FlatList, ActivityIndicator, Alert } from 'react-native';
import { ChevronLeft, ChevronRight, CheckCircle, Clock, XCircle, AlertCircle, Calendar, Plane, Star } from 'lucide-react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTimesheetStore } from '../../../store/timesheetStore';

import RegularizationFormModal from '../modals/RegularizationFormModal';
import DayDetailModal from '../modals/DayDetailModal';

const LEGEND = [
  { label: 'Present', color: '#10B981', bg: '#ECFDF5', border: '#A7F3D0', icon: CheckCircle },
  { label: 'Half Day', color: '#F97316', bg: '#FFF7ED', border: '#FED7AA', icon: Clock },
  { label: 'Late', color: '#EAB308', bg: '#FEF9C3', border: '#FDE047', icon: AlertCircle },
  { label: 'Absent', color: '#EF4444', bg: '#FEF2F2', border: '#FECACA', icon: XCircle },
  { label: 'On Leave', color: '#3B82F6', bg: '#EFF6FF', border: '#BFDBFE', icon: Plane },
  { label: 'Holiday', color: '#F59E0B', bg: '#FEF3C7', border: '#FDE68A', icon: Star },
  { label: 'Day Off', color: '#94A3B8', bg: '#F1F5F9', border: '#E2E8F0', icon: Calendar },
];

export default function TimesheetTab() {
  const { attendanceHistory, regularizations, holidays, leaveRequests, currentMonth, isLoading, fetchData, changeMonth } = useTimesheetStore();
  const [showModal, setShowModal] = useState(false);
  const [selectedDayData, setSelectedDayData] = useState<any>(null);
  const [showDayDetailModal, setShowDayDetailModal] = useState(false);
  const listRef = useRef<FlatList>(null);

  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, [fetchData])
  );

  const handlePrevMonth = () => {
    const prev = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
    changeMonth(prev);
  };

  const handleNextMonth = () => {
    const next = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
    changeMonth(next);
  };

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return Array.from({ length: daysInMonth }, (_, i) => {
      const day = i + 1;
      const d = new Date(year, month, day);
      const checkDate = new Date(year, month, day);
      checkDate.setHours(0, 0, 0, 0);
      
      const isFuture = checkDate.getTime() > today.getTime();
      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

      // Check Attendance record
      const log = attendanceHistory.find(r => r.date.startsWith(dateStr));

      // Check Holiday
      const holiday = holidays.find(h => {
        const hDate = new Date(h.date);
        return hDate.getFullYear() === year && hDate.getMonth() === month && hDate.getDate() === day;
      });

      // Check Leave
      const leave = leaveRequests.find(l => {
        if (l.status === 'REJECTED' || l.status === 'CANCELLED') return false;
        const s = new Date(l.startDate);
        s.setHours(0, 0, 0, 0);
        const e = new Date(l.endDate);
        e.setHours(23, 59, 59, 999);
        return checkDate >= s && checkDate <= e;
      });

      let status: 'Present' | 'Half Day' | 'Late' | 'Absent' | 'On Leave' | 'Holiday' | 'Day Off' | 'Future' = 'Future';

      if (isFuture) {
        if (holiday) status = 'Holiday';
        else if (leave) status = 'On Leave';
        else if (isWeekend) status = 'Day Off';
        else status = 'Future';
      } else {
        if (log && (log.clockIn || log.status)) {
          if (log.status === 'HALF_DAY') status = 'Half Day';
          else if (log.status === 'LATE' || (log as any).isLate) status = 'Late';
          else if (log.status === 'ABSENT') status = 'Absent';
          else status = 'Present';
        } else if (holiday) {
          status = 'Holiday';
        } else if (leave) {
          status = 'On Leave';
        } else if (isWeekend) {
          status = 'Day Off';
        } else {
          status = 'Absent';
        }
      }

      return {
        date: d,
        dayStr: day.toString(),
        dayName: d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase(),
        isoDate: dateStr,
        status,
        isFuture,
        isWeekend,
        isHoliday: !!holiday,
        log,
      };
    });
  };

  const days = getDaysInMonth(currentMonth);

  // Auto-scroll to today when viewing the current month
  useEffect(() => {
    if (isLoading || days.length === 0) return;
    const now = new Date();
    const isCurrentMonth =
      currentMonth.getFullYear() === now.getFullYear() &&
      currentMonth.getMonth() === now.getMonth();
    if (!isCurrentMonth) return;
    const todayIndex = days.findIndex(d => d.isoDate === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`);
    if (todayIndex >= 0) {
      setTimeout(() => {
        listRef.current?.scrollToIndex({ index: todayIndex, animated: true, viewPosition: 0.5 });
      }, 100);
    }
  }, [isLoading, currentMonth]);

  // Accurate working days calculation matching CRM logic
  let totalWorkingDays = 0;
  let totalPresent = 0;

  for (const d of days) {
    if (!d.isFuture) {
      const worked = d.status === 'Present' || d.status === 'Late' || d.status === 'Half Day';
      if (!d.isWeekend && !d.isHoliday) {
        totalWorkingDays++;
      } else if (worked) {
        totalWorkingDays++;
      }

      if (worked) {
        totalPresent++;
      }
    }
  }

  const getLegendItem = (status: string) => {
    return LEGEND.find(l => l.label === status);
  };

  return (
    <View style={styles.container}>
      {/* Month Selector */}
      <View style={styles.monthSelector}>
        <TouchableOpacity onPress={handlePrevMonth} style={styles.navBtn}>
          <ChevronLeft size={20} color="#64748B" />
        </TouchableOpacity>
        <Text style={styles.monthText}>
          {currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </Text>
        <TouchableOpacity onPress={handleNextMonth} style={styles.navBtn}>
          <ChevronRight size={20} color="#64748B" />
        </TouchableOpacity>
      </View>

      {/* Legend */}
      <View style={styles.legendContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.legendScroll}>
          {LEGEND.map((item, index) => {
            const Icon = item.icon;
            return (
              <View key={index} style={styles.legendItem}>
                <View style={[styles.legendIconBox, { backgroundColor: item.bg }]}>
                  <Icon size={12} color={item.color} />
                </View>
                <Text style={styles.legendText}>{item.label}</Text>
              </View>
            );
          })}
        </ScrollView>
      </View>

      {/* Calendar Strip */}
      <View style={styles.calendarStripContainer}>
        {isLoading ? (
          <View style={[styles.calendarStrip, { flexDirection: 'row' }]}>
            {Array.from({ length: 7 }).map((_, idx) => (
              <View key={idx} style={styles.dayCol}>
                <View style={styles.skeletonTextSmall} />
                <View style={styles.skeletonTextLarge} />
                <View style={styles.skeletonCircle} />
              </View>
            ))}
          </View>
        ) : (
          <FlatList
            ref={listRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            data={days}
            keyExtractor={item => item.isoDate}
            contentContainerStyle={styles.calendarStrip}
            getItemLayout={(_, index) => ({ length: 44, offset: 16 + index * 44, index })}
            onScrollToIndexFailed={() => {}}
            renderItem={({ item }) => {
              const legend = getLegendItem(item.status);
              const Icon = legend?.icon;

              return (
                <TouchableOpacity 
                  style={styles.dayCol} 
                  onPress={() => {
                    setSelectedDayData(item);
                    setShowDayDetailModal(true);
                  }}
                >
                  <Text style={[styles.dayName, item.isWeekend && { color: '#CBD5E1' }]}>{item.dayName}</Text>
                  <Text style={[styles.dayStr, item.isFuture && { color: '#94A3B8' }]}>{item.dayStr}</Text>
                  <View 
                    style={[
                      styles.statusIndicator, 
                      legend 
                        ? { backgroundColor: legend.bg, borderColor: legend.border, borderWidth: 1 } 
                        : { backgroundColor: '#F8FAFC', borderColor: '#E2E8F0', borderWidth: 1 }
                    ]}
                  >
                    {Icon ? (
                      <Icon size={12} color={legend.color} />
                    ) : null}
                  </View>
                </TouchableOpacity>
              );
            }}
          />
        )}
        <View style={styles.totalBox}>
          <Text style={styles.totalLabel}>TOTAL</Text>
          <Text style={styles.totalValue}>{totalPresent}/{totalWorkingDays}</Text>
        </View>
      </View>

      {/* Regularizations Section */}
      <View style={styles.regSection}>
        <View style={styles.regHeader}>
          <Text style={styles.regTitle}>My Regularizations</Text>
          <TouchableOpacity style={styles.requestBtn} onPress={() => setShowModal(true)}>
            <Text style={styles.requestBtnText}>Request</Text>
          </TouchableOpacity>
        </View>
        
        {regularizations.length === 0 ? (
          <View style={styles.emptyReg}>
            <Text style={styles.emptyRegText}>No regularization requests found.</Text>
          </View>
        ) : (
          regularizations.map(reg => (
            <View key={reg.id} style={styles.regCard}>
              <View style={styles.regRow}>
                <Text style={styles.regDate}>{new Date(reg.date).toLocaleDateString()}</Text>
                <Text style={[styles.regStatus, reg.status === 'APPROVED' ? {color: '#10B981'} : {color: '#F59E0B'}]}>
                  {reg.status}
                </Text>
              </View>
              <Text style={styles.regReason} numberOfLines={2}>{reg.reason}</Text>
            </View>
          ))
        )}
      </View>

      <RegularizationFormModal 
        visible={showModal} 
        onClose={() => setShowModal(false)} 
        onSuccess={() => Alert.alert('Success', 'Regularization request submitted!')} 
      />

      <DayDetailModal 
        visible={showDayDetailModal} 
        onClose={() => setShowDayDetailModal(false)} 
        dayData={selectedDayData} 
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  monthSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 12,
  },
  navBtn: {
    padding: 8,
    backgroundColor: '#F1F5F9',
    borderRadius: 20,
    marginHorizontal: 16,
  },
  monthText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
    width: 140,
    textAlign: 'center',
  },
  legendContainer: {
    marginBottom: 16,
  },
  legendScroll: {
    paddingHorizontal: 20,
    gap: 12,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendIconBox: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  legendText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
  },
  calendarStripContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingVertical: 16,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#E2E8F0',
  },
  calendarStrip: {
    paddingHorizontal: 16,
    gap: 8,
  },
  dayCol: {
    alignItems: 'center',
    width: 36,
    gap: 4,
  },
  dayName: {
    fontSize: 10,
    color: '#94A3B8',
    fontWeight: '600',
  },
  dayStr: {
    fontSize: 14,
    color: '#0F172A',
    fontWeight: '700',
  },
  statusIndicator: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  totalBox: {
    paddingHorizontal: 16,
    borderLeftWidth: 1,
    borderLeftColor: '#E2E8F0',
    alignItems: 'center',
  },
  totalLabel: {
    fontSize: 10,
    color: '#64748B',
    fontWeight: '700',
  },
  totalValue: {
    fontSize: 16,
    color: '#0F172A',
    fontWeight: '800',
    marginTop: 2,
  },
  regSection: {
    padding: 20,
  },
  regHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  regTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  requestBtn: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  requestBtnText: {
    fontSize: 13,
    color: '#334155',
    fontWeight: '600',
  },
  emptyReg: {
    padding: 20,
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
  },
  emptyRegText: {
    color: '#64748B',
    fontSize: 14,
  },
  regCard: {
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  regRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  regDate: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
  },
  regStatus: {
    fontSize: 12,
    fontWeight: '700',
  },
  regReason: {
    fontSize: 13,
    color: '#64748B',
  },
  skeletonTextSmall: {
    width: 24,
    height: 10,
    backgroundColor: '#E2E8F0',
    borderRadius: 4,
  },
  skeletonTextLarge: {
    width: 20,
    height: 16,
    backgroundColor: '#E2E8F0',
    borderRadius: 4,
    marginTop: 4,
  },
  skeletonCircle: {
    width: 24,
    height: 24,
    backgroundColor: '#E2E8F0',
    borderRadius: 12,
    marginTop: 4,
  }
});
