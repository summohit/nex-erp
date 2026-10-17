import React, { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { View, Text, StyleSheet, FlatList, RefreshControl, ActivityIndicator, Alert } from 'react-native';
import AppScreen from '../../components/AppScreen';
import { teamService, ShiftDay } from '../../api/teamService';
import { theme } from '../../theme/theme';

/** "21:30" -> "9:30 PM". */
function clock(t?: string | null): string {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h)) return t;
  return `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'UTC' });

/**
 * Today's shift and the next two weeks, the same schedule the web dashboard
 * shows: the roster wins over the standing shift, so a night shift or an
 * on-site day reads exactly as HR set it.
 */
export default function MyShiftScreen() {
  const [days, setDays] = useState<ShiftDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setDays(await teamService.getMySchedule());
    } catch (e: any) {
      Alert.alert('Could not load your shift', e?.response?.data?.message || 'Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Reload whenever this screen comes back into view, so changes made on the
  // web or from a notification show up without pulling down.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const today = days[0];
  const overnight = (d?: ShiftDay) => !!d?.startTime && !!d?.endTime && d.endTime <= d.startTime;

  return (
    <AppScreen title="My Shift" subtitle="Your schedule for the next two weeks">
      {loading ? <ActivityIndicator style={styles.loader} color={theme.colors.primary} /> : (
        <FlatList
          data={days.slice(1)}
          keyExtractor={(d) => d.date}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListHeaderComponent={today ? (
            <View style={[styles.today, today.isDayOff && styles.todayOff]}>
              <Text style={styles.todayLabel}>TODAY · {today.weekday}, {dayLabel(today.date)}</Text>
              <Text style={styles.todayShift}>{today.isDayOff ? 'Day off' : today.shiftName}</Text>
              {!today.isDayOff && !!today.startTime && (
                <Text style={styles.todayTime}>
                  {clock(today.startTime)} – {clock(today.endTime)}{overnight(today) ? '  (ends next morning)' : ''}
                </Text>
              )}
              {!!today.projectName && <Text style={styles.todayNote}>On site: {today.projectName}</Text>}
              {!!today.note && today.note !== 'Default shift' && <Text style={styles.todayNote}>{today.note}</Text>}
            </View>
          ) : undefined}
          ListEmptyComponent={!today ? <Text style={styles.empty}>No schedule found. Ask HR to assign your shift.</Text> : undefined}
          renderItem={({ item: d }) => (
            <View style={[styles.row, d.isDayOff && styles.rowOff]}>
              <View style={styles.dateCol}>
                <Text style={styles.weekday}>{d.weekday.slice(0, 3)}</Text>
                <Text style={styles.date}>{dayLabel(d.date)}</Text>
              </View>
              <View style={styles.flex}>
                <Text style={[styles.shift, d.isDayOff && styles.offText]}>{d.isDayOff ? 'Day off' : d.shiftName}</Text>
                {!d.isDayOff && !!d.startTime && (
                  <Text style={styles.time}>{clock(d.startTime)} – {clock(d.endTime)}{overnight(d) ? ' (overnight)' : ''}</Text>
                )}
                {!!d.projectName && <Text style={styles.note}>On site: {d.projectName}</Text>}
              </View>
            </View>
          )}
        />
      )}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  loader: { marginTop: 40 },
  list: { padding: 16, paddingBottom: 120, gap: 8 },
  today: { backgroundColor: theme.colors.primary, borderRadius: 16, padding: 18, marginBottom: 8 },
  todayOff: { backgroundColor: '#64748B' },
  todayLabel: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  todayShift: { color: '#fff', fontSize: 22, fontWeight: '800', marginTop: 6 },
  todayTime: { color: '#fff', fontSize: 16, fontWeight: '600', marginTop: 4 },
  todayNote: { color: 'rgba(255,255,255,0.9)', fontSize: 13, marginTop: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#fff', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: theme.colors.border },
  rowOff: { backgroundColor: '#F8FAFC' },
  dateCol: { width: 56, alignItems: 'center' },
  weekday: { fontSize: 12, fontWeight: '700', color: theme.colors.textSecondary, textTransform: 'uppercase' },
  date: { fontSize: 13, color: theme.colors.textPrimary, marginTop: 2 },
  shift: { fontSize: 15, fontWeight: '700', color: theme.colors.textPrimary },
  offText: { color: theme.colors.textMuted },
  time: { fontSize: 13, color: theme.colors.primaryText, marginTop: 2 },
  note: { fontSize: 12, color: theme.colors.textSecondary, marginTop: 2 },
  empty: { textAlign: 'center', color: theme.colors.textSecondary, marginTop: 40 },
});
