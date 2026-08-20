import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Calendar, Umbrella } from 'lucide-react-native';
import { useTimesheetStore } from '../../../store/timesheetStore';

export default function HolidaysTab() {
  const { holidays, isLoading, fetchData } = useTimesheetStore();

  useEffect(() => {
    if (holidays.length === 0) {
      fetchData();
    }
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.iconBox}>
          <Umbrella size={24} color="#10B981" />
        </View>
        <Text style={styles.title}>Company Holidays</Text>
        <Text style={styles.subtitle}>Official days off for the year</Text>
      </View>

      {isLoading ? (
        <ActivityIndicator color="#E25E3E" style={{ marginTop: 40 }} />
      ) : holidays.length === 0 ? (
        <View style={styles.emptyState}>
          <Calendar size={32} color="#94A3B8" />
          <Text style={styles.emptyText}>No holidays configured</Text>
        </View>
      ) : (
        <View style={styles.listContent}>
          {holidays.map((item) => {
            const date = new Date(item.date);
            const isPast = date < new Date();
            
            return (
              <View key={item.id.toString()} style={[styles.card, isPast && styles.cardPast]}>
                <View style={styles.dateBox}>
                  <Text style={[styles.monthText, isPast && styles.textPast]}>
                    {date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}
                  </Text>
                  <Text style={[styles.dayText, isPast && styles.textPast]}>
                    {date.getDate()}
                  </Text>
                </View>
                <View style={styles.infoBox}>
                  <Text style={[styles.holidayName, isPast && styles.textPast]}>{item.name}</Text>
                  <Text style={[styles.holidayDay, isPast && styles.textPast]}>
                    {date.toLocaleDateString('en-US', { weekday: 'long' })}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  iconBox: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#D1FAE5',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
  },
  subtitle: {
    fontSize: 14,
    color: '#64748B',
    marginTop: 4,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 40,
    padding: 20,
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
  },
  emptyText: {
    color: '#64748B',
    fontSize: 14,
    marginTop: 12,
  },
  listContent: {
    paddingBottom: 40,
  },
  card: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  cardPast: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    shadowOpacity: 0,
    elevation: 0,
  },
  dateBox: {
    width: 60,
    height: 60,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  monthText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#E25E3E',
  },
  dayText: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
  },
  infoBox: {
    flex: 1,
    justifyContent: 'center',
  },
  holidayName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  holidayDay: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 4,
  },
  textPast: {
    color: '#94A3B8',
  }
});
