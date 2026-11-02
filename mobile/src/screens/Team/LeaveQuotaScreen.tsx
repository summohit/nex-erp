import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl, TextInput, ScrollView } from 'react-native';
import { ChevronLeft, ChevronRight, Search, ChevronDown, ChevronUp } from 'lucide-react-native';
import AppScreen from '../../components/AppScreen';
import { apiClient } from '../../api/apiClient';
import { Avatar, PersonTap, PersonSheetHost } from '../../components/PersonSheet';
import { theme } from '../../theme/theme';

/**
 * Leave quota report: for each person, each leave type's allocated, used and
 * remaining days for a year. HR and admins see everyone; anyone else sees only
 * their own row (the server decides, and says which in `scope`).
 */
type Cell = { allocated: number; used: number; remaining: number; encashed: number };
type Row = {
  employee: { id: number; name: string; employeeCode: string | null; avatarUrl: string | null; designation: string | null; department: string | null; isActive: boolean };
  byType: Record<number, Cell>; totals: Cell; hasNoBalances: boolean;
};
type Report = { year: number; leaveTypes: { id: number; name: string; isPaid: boolean; encashable: boolean }[]; rows: Row[]; scope: 'ALL' | 'SELF'; encashmentSettled: boolean };
type Sort = 'NAME' | 'LEAST' | 'MOST_USED';
const SORT_LABEL: Record<Sort, string> = { NAME: 'Name', LEAST: 'Least left', MOST_USED: 'Most used' };
const n = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
const nameParts = (s: string) => { const [firstName, ...rest] = s.split(' '); return { firstName, lastName: rest.join(' ') }; };

export default function LeaveQuotaScreen() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [dept, setDept] = useState('');
  const [sort, setSort] = useState<Sort>('NAME');
  const [openRows, setOpenRows] = useState<Set<number>>(new Set());
  const [onlyMissing, setOnlyMissing] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/leaves/reports/quota', { params: { year } });
      setReport(data);
      if (data?.scope === 'SELF' && data.rows?.[0]) setOpenRows(new Set([data.rows[0].employee.id]));
    } catch { setReport(null); } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [year]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const departments = useMemo(() => [...new Set((report?.rows || []).map((r) => r.employee.department).filter(Boolean))].sort() as string[], [report]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (report?.rows || []).filter((r) =>
      (!dept || r.employee.department === dept) && (!onlyMissing || r.hasNoBalances) &&
      (!q || `${r.employee.name} ${r.employee.employeeCode || ''} ${r.employee.designation || ''}`.toLowerCase().includes(q)));
    return list.sort((a, b) =>
      sort === 'LEAST' ? a.totals.remaining - b.totals.remaining
      : sort === 'MOST_USED' ? b.totals.used - a.totals.used
      : a.employee.name.localeCompare(b.employee.name));
  }, [report, query, dept, sort, onlyMissing]);

  const sums = useMemo(() => rows.reduce((s, r) => ({
    allocated: s.allocated + r.totals.allocated, used: s.used + r.totals.used, remaining: s.remaining + r.totals.remaining,
  }), { allocated: 0, used: 0, remaining: 0 }), [rows]);
  const missing = (report?.rows || []).filter((r) => r.hasNoBalances).length;
  const isAll = report?.scope === 'ALL';

  const toggle = (id: number) => setOpenRows((s) => { const x = new Set(s); x.has(id) ? x.delete(id) : x.add(id); return x; });

  const header = (
    <View style={{ gap: 10, marginBottom: 6 }}>
      <View style={styles.yearBar}>
        <TouchableOpacity style={styles.navBtn} onPress={() => setYear((y) => y - 1)}><ChevronLeft size={18} color="#334155" /></TouchableOpacity>
        <Text style={styles.yearText}>{year}</Text>
        <TouchableOpacity style={styles.navBtn} onPress={() => setYear((y) => y + 1)}><ChevronRight size={18} color="#334155" /></TouchableOpacity>
      </View>
      <View style={styles.kpis}>
        <View style={[styles.kpi, { backgroundColor: '#EFF6FF' }]}><Text style={[styles.kpiNum, { color: '#1D4ED8' }]}>{n(sums.allocated)}</Text><Text style={[styles.kpiLabel, { color: '#1D4ED8' }]}>Allocated</Text></View>
        <View style={[styles.kpi, { backgroundColor: '#FFF7ED' }]}><Text style={[styles.kpiNum, { color: '#C2410C' }]}>{n(sums.used)}</Text><Text style={[styles.kpiLabel, { color: '#C2410C' }]}>Used</Text></View>
        <View style={[styles.kpi, { backgroundColor: '#ECFDF5' }]}><Text style={[styles.kpiNum, { color: '#047857' }]}>{n(sums.remaining)}</Text><Text style={[styles.kpiLabel, { color: '#047857' }]}>{report?.encashmentSettled ? 'Paid out' : 'Remaining'}</Text></View>
      </View>
      {report?.encashmentSettled && <Text style={styles.note}>The year is closed: remaining days were bought back on the closing payslip.</Text>}
      {isAll && (
        <>
          <View style={styles.searchRow}>
            <View style={styles.search}>
              <Search size={16} color="#94A3B8" />
              <TextInput style={styles.searchInput} value={query} onChangeText={setQuery} placeholder="Search person" placeholderTextColor="#94A3B8" autoCorrect={false} clearButtonMode="while-editing" />
            </View>
            <TouchableOpacity style={styles.sortBtn} onPress={() => setSort((s) => (s === 'NAME' ? 'LEAST' : s === 'LEAST' ? 'MOST_USED' : 'NAME'))}>
              <Text style={styles.sortText}>{SORT_LABEL[sort]}</Text>
            </TouchableOpacity>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {missing > 0 && (
              <TouchableOpacity style={[styles.chip, onlyMissing && styles.chipWarn]} onPress={() => setOnlyMissing((v) => !v)}>
                <Text style={[styles.chipText, onlyMissing && styles.chipTextOn]}>No balances set · {missing}</Text>
              </TouchableOpacity>
            )}
            {['', ...departments].map((d) => (
              <TouchableOpacity key={d || 'all'} style={[styles.chip, dept === d && styles.chipOn]} onPress={() => setDept(d)}>
                <Text style={[styles.chipText, dept === d && styles.chipTextOn]}>{d || 'All departments'}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </>
      )}
    </View>
  );

  return (
    <AppScreen showBack title="Leave Quota" subtitle={isAll ? `${rows.length} people · ${year}` : `Your leave · ${year}`}>
      {loading ? <ActivityIndicator style={{ marginTop: 40 }} color={theme.colors.primary} /> : (
        <FlatList
          data={rows}
          keyExtractor={(r) => String(r.employee.id)}
          ListHeaderComponent={header}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListEmptyComponent={<Text style={styles.empty}>No leave balances for {year}.</Text>}
          renderItem={({ item: r }) => {
            const isOpen = openRows.has(r.employee.id);
            const pct = r.totals.allocated ? Math.min(1, r.totals.used / r.totals.allocated) : 0;
            const person = { id: r.employee.id, ...nameParts(r.employee.name), avatarUrl: r.employee.avatarUrl };
            return (
              <View style={[styles.card, !r.employee.isActive && { opacity: 0.6 }]}>
                <TouchableOpacity style={styles.head} onPress={() => toggle(r.employee.id)} activeOpacity={0.8}>
                  <PersonTap person={person}><Avatar person={person} size={38} /></PersonTap>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={styles.name} numberOfLines={1}>{r.employee.name}</Text>
                    <Text style={styles.sub} numberOfLines={1}>{[r.employee.designation, r.employee.department].filter(Boolean).join(' · ')}</Text>
                    {r.hasNoBalances ? <Text style={styles.warn}>No leave balances set for {year}</Text> : (
                      <View style={styles.bar}><View style={[styles.barFill, { width: `${pct * 100}%` }, pct > 0.85 && { backgroundColor: '#F97316' }]} /></View>
                    )}
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.left}>{n(r.totals.remaining)}</Text>
                    <Text style={styles.tiny}>of {n(r.totals.allocated)} left</Text>
                  </View>
                  {isOpen ? <ChevronUp size={16} color="#94A3B8" /> : <ChevronDown size={16} color="#94A3B8" />}
                </TouchableOpacity>
                {isOpen && (
                  <View style={styles.detail}>
                    <View style={styles.tRow}>
                      <Text style={[styles.tType, styles.tHead]}>Type</Text>
                      <Text style={[styles.tNum, styles.tHead]}>Given</Text>
                      <Text style={[styles.tNum, styles.tHead]}>Used</Text>
                      <Text style={[styles.tNum, styles.tHead]}>Left</Text>
                    </View>
                    {(report?.leaveTypes || []).map((t) => {
                      const c = r.byType[t.id];
                      if (!c) return null;
                      return (
                        <View key={t.id} style={styles.tRow}>
                          <Text style={styles.tType} numberOfLines={1}>{t.name}{t.isPaid ? '' : ' (unpaid)'}</Text>
                          <Text style={styles.tNum}>{n(c.allocated)}</Text>
                          <Text style={styles.tNum}>{n(c.used)}</Text>
                          <Text style={[styles.tNum, { fontWeight: '800', color: c.remaining <= 0 ? '#B91C1C' : '#047857' }]}>{n(c.remaining)}{c.encashed ? '*' : ''}</Text>
                        </View>
                      );
                    })}
                    {Object.values(r.byType).some((c) => c.encashed) && <Text style={styles.tiny}>* paid out at year end</Text>}
                  </View>
                )}
              </View>
            );
          }}
        />
      )}
      <PersonSheetHost />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, paddingBottom: 120, gap: 8 },
  yearBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20 },
  navBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0', alignItems: 'center', justifyContent: 'center' },
  yearText: { fontSize: 20, fontWeight: '800', color: '#0F172A' },
  kpis: { flexDirection: 'row', gap: 8 },
  kpi: { flex: 1, borderRadius: 14, paddingVertical: 10, alignItems: 'center' },
  kpiNum: { fontSize: 20, fontWeight: '800' },
  kpiLabel: { fontSize: 11, fontWeight: '700' },
  note: { fontSize: 12, color: '#64748B', textAlign: 'center' },
  searchRow: { flexDirection: 'row', gap: 8 },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, paddingHorizontal: 12, height: 42 },
  searchInput: { flex: 1, fontSize: 14, color: '#0F172A', paddingVertical: 0 },
  sortBtn: { paddingHorizontal: 12, height: 42, borderRadius: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0', justifyContent: 'center' },
  sortText: { fontSize: 12, fontWeight: '700', color: '#334155' },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0' },
  chipOn: { backgroundColor: '#1373E5', borderColor: '#1373E5' },
  chipWarn: { backgroundColor: '#F97316', borderColor: '#F97316' },
  chipText: { fontSize: 12, fontWeight: '700', color: '#475569' },
  chipTextOn: { color: '#fff' },
  card: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  name: { fontSize: 14, fontWeight: '800', color: '#0F172A' },
  sub: { fontSize: 12, color: '#64748B' },
  tiny: { fontSize: 10, color: '#94A3B8' },
  warn: { fontSize: 11, fontWeight: '700', color: '#C2410C' },
  bar: { height: 5, backgroundColor: '#F1F5F9', borderRadius: 3, overflow: 'hidden' },
  barFill: { height: 5, backgroundColor: '#22C55E', borderRadius: 3 },
  left: { fontSize: 18, fontWeight: '800', color: '#047857' },
  detail: { borderTopWidth: 1, borderTopColor: '#F1F5F9', paddingHorizontal: 14, paddingVertical: 10, gap: 6 },
  tRow: { flexDirection: 'row', alignItems: 'center' },
  tHead: { fontSize: 11, fontWeight: '800', color: '#64748B' },
  tType: { flex: 1, fontSize: 13, color: '#0F172A' },
  tNum: { width: 52, textAlign: 'right', fontSize: 13, color: '#334155' },
  empty: { textAlign: 'center', color: theme.colors.textSecondary, marginTop: 30 },
});
