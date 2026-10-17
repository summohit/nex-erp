import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator, TextInput, Image,
} from 'react-native';
import AppScreen from '../../components/AppScreen';
import { apiClient } from '../../api/apiClient';
import { theme } from '../../theme/theme';

type Bucket = 'PRESENT' | 'LATE' | 'LEAVE' | 'NOT_IN';
type Row = {
  id: number; name: string; code?: string | null; designation?: string | null; avatarUrl?: string | null;
  bucket: Bucket; detail: string; onsite?: boolean;
};

const BUCKETS: { key: Bucket; label: string; color: string; bg: string }[] = [
  { key: 'PRESENT', label: 'Present', color: '#15803D', bg: '#DCFCE7' },
  { key: 'LATE', label: 'Late', color: '#B45309', bg: '#FEF3C7' },
  { key: 'LEAVE', label: 'On leave', color: '#6D28D9', bg: '#EDE9FE' },
  { key: 'NOT_IN', label: 'Not in yet', color: '#B91C1C', bg: '#FEE2E2' },
];

/** Today as YYYY-MM-DD in IST, which is the day the server files attendance under. */
function istToday(): string {
  return new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
}
const clock = (d?: string | null) =>
  d ? new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '';

/**
 * Who is in, late, on leave or not in yet — today, company-wide.
 *
 * HR and Super Admin only: the server refuses /attendance/all to anyone else,
 * and this screen says so rather than showing an empty list.
 */
export default function TeamAttendanceScreen() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [denied, setDenied] = useState(false);
  const [bucket, setBucket] = useState<Bucket>('PRESENT');
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    const today = istToday();
    try {
      const [att, emps, leaves] = await Promise.all([
        apiClient.get('/attendance/all', { params: { from: today, to: today } }),
        apiClient.get('/employees/basic-list'),
        apiClient.get('/leaves/requests').catch(() => ({ data: [] })),
      ]);
      const byEmp = new Map<number, any>((att.data || []).map((a: any) => [a.employee?.id ?? a.employeeId, a]));
      const onLeave = new Map<number, any>();
      for (const l of leaves.data || []) {
        if (l.status === 'APPROVED' && String(l.startDate).slice(0, 10) <= today && String(l.endDate).slice(0, 10) >= today) {
          onLeave.set(l.employee?.id ?? l.employeeId, l);
        }
      }
      const out: Row[] = (emps.data || []).map((e: any) => {
        const a = byEmp.get(e.id);
        const base = {
          id: e.id, name: `${e.firstName || ''} ${e.lastName || ''}`.trim(), code: e.employeeCode,
          designation: e.designation?.name || a?.employee?.designation?.name || null, avatarUrl: e.avatarUrl,
        };
        if (a?.clockIn) {
          const out = a.clockOut ? ` · out ${clock(a.clockOut)}` : ' · working';
          return { ...base, bucket: a.isLate ? 'LATE' : 'PRESENT', detail: `In ${clock(a.clockIn)}${out}`, onsite: !!a.isOnsite } as Row;
        }
        const l = onLeave.get(e.id);
        if (l) return { ...base, bucket: 'LEAVE', detail: `${l.leaveType?.name || 'Leave'}${l.isHalfDay ? ' (half day)' : ''}` } as Row;
        return { ...base, bucket: 'NOT_IN', detail: 'No clock-in today' } as Row;
      });
      setRows(out.sort((x, y) => x.name.localeCompare(y.name)));
      setDenied(false);
    } catch (e: any) {
      if (e?.response?.status === 403) setDenied(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Reload whenever this screen comes back into view, so changes made on the
  // web or from a notification show up without pulling down.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const counts = useMemo(() => Object.fromEntries(BUCKETS.map((b) => [b.key, rows.filter((r) => r.bucket === b.key).length])) as Record<Bucket, number>, [rows]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => r.bucket === bucket && (!q || `${r.name} ${r.code || ''} ${r.designation || ''}`.toLowerCase().includes(q)));
  }, [rows, bucket, query]);

  if (denied) {
    return (
      <AppScreen title="Team Attendance" subtitle="Today">
        <Text style={styles.empty}>Company-wide attendance is available to HR and Super Admin only.</Text>
      </AppScreen>
    );
  }

  return (
    <AppScreen title="Team Attendance" subtitle={`Today · ${rows.length} people`}>
      {loading ? <ActivityIndicator style={styles.loader} color={theme.colors.primary} /> : (
        <>
          <View style={styles.kpis}>
            {BUCKETS.map((b) => (
              <TouchableOpacity key={b.key} style={[styles.kpi, { backgroundColor: b.bg }, bucket === b.key && { borderColor: b.color }]} onPress={() => setBucket(b.key)}>
                <Text style={[styles.kpiNum, { color: b.color }]}>{counts[b.key] || 0}</Text>
                <Text style={[styles.kpiLabel, { color: b.color }]}>{b.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput style={styles.search} placeholder="Search name, code, designation…" value={query} onChangeText={setQuery} />
          <FlatList
            data={shown}
            keyExtractor={(r) => String(r.id)}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
            ListEmptyComponent={<Text style={styles.empty}>Nobody here.</Text>}
            renderItem={({ item: r }) => (
              <View style={styles.row}>
                {r.avatarUrl ? <Image source={{ uri: r.avatarUrl }} style={styles.avatar} />
                  : <View style={[styles.avatar, styles.initials]}><Text style={styles.initialsText}>{r.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}</Text></View>}
                <View style={styles.flex}>
                  <Text style={styles.name}>{r.name}</Text>
                  <Text style={styles.meta} numberOfLines={1}>{[r.code && `#${r.code}`, r.designation].filter(Boolean).join(' · ')}</Text>
                </View>
                <View style={styles.right}>
                  <Text style={styles.detail}>{r.detail}</Text>
                  {r.onsite && <Text style={styles.onsite}>On site</Text>}
                </View>
              </View>
            )}
          />
        </>
      )}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  loader: { marginTop: 40 },
  kpis: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 8 },
  kpi: { flex: 1, borderRadius: 12, paddingVertical: 10, alignItems: 'center', borderWidth: 2, borderColor: 'transparent' },
  kpiNum: { fontSize: 20, fontWeight: '800' },
  kpiLabel: { fontSize: 11, fontWeight: '700' },
  search: { marginHorizontal: 16, marginTop: 10, height: 40, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, paddingHorizontal: 12, backgroundColor: '#fff', color: theme.colors.textPrimary },
  list: { padding: 16, paddingBottom: 120, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: theme.colors.border },
  avatar: { width: 36, height: 36, borderRadius: 18 },
  initials: { backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' },
  initialsText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  name: { fontSize: 14, fontWeight: '700', color: theme.colors.textPrimary },
  meta: { fontSize: 12, color: theme.colors.textSecondary },
  right: { alignItems: 'flex-end' },
  detail: { fontSize: 12, color: theme.colors.textPrimary, fontWeight: '600' },
  onsite: { fontSize: 10.5, color: '#0369A1', fontWeight: '700', marginTop: 2 },
  empty: { textAlign: 'center', color: theme.colors.textSecondary, marginTop: 40, paddingHorizontal: 24 },
});
