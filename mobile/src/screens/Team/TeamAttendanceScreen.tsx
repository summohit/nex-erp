import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator, TextInput, ScrollView, Modal, Linking,
} from 'react-native';
import { ChevronLeft, ChevronRight, Search, X, MapPin, User, Trophy } from 'lucide-react-native';
import AppScreen from '../../components/AppScreen';
import { apiClient } from '../../api/apiClient';
import { Avatar } from '../../components/PersonSheet';
import { navigateTo } from '../../navigation/navigationUtils';
import { theme } from '../../theme/theme';

/**
 * Everybody's attendance, the mobile half of the web's All People Attendance.
 * Super Admin and HR only: the menu's Attendance opens this for them, and the
 * server refuses everyone else. Day view: who is in, late, half day, on leave,
 * off or not in, for any date. Month view: each person's month, the
 * punctuality ranking, and a tap-through to their day-by-day log.
 */
type Bucket = 'PRESENT' | 'LATE' | 'HALF_DAY' | 'LEAVE' | 'OFF' | 'NOT_IN';
const BUCKETS: { key: Bucket; label: string; color: string; bg: string }[] = [
  { key: 'PRESENT', label: 'On time', color: '#15803D', bg: '#DCFCE7' },
  { key: 'LATE', label: 'Late', color: '#B45309', bg: '#FEF3C7' },
  { key: 'HALF_DAY', label: 'Half day', color: '#0E7490', bg: '#CFFAFE' },
  { key: 'LEAVE', label: 'On leave', color: '#6D28D9', bg: '#EDE9FE' },
  { key: 'OFF', label: 'Day off', color: '#475569', bg: '#F1F5F9' },
  { key: 'NOT_IN', label: 'Not in', color: '#B91C1C', bg: '#FEE2E2' },
];

const IST = 5.5 * 3600000;
const istYmd = (d: Date) => new Date(d.getTime() + IST).toISOString().slice(0, 10);
const addDays = (k: string, n: number) => { const d = new Date(`${k}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const clock = (d?: string | null) => (d ? new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '');
const dayLabel = (k: string) => new Date(`${k}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' });
const hours = (r: any) => {
  if (!r?.clockIn) return 0;
  const end = r.clockOut ? new Date(r.clockOut).getTime() : Date.now();
  return Math.max(0, (end - new Date(r.clockIn).getTime()) / 3600000);
};
const fmtH = (h: number) => `${Math.floor(h)}h ${Math.round((h % 1) * 60)}m`;
const fullName = (e: any) => `${e?.firstName || ''} ${e?.lastName || ''}`.trim();

/** The IST calendar day of a record: dates come back as either UTC or IST midnight. */
const dayKeyOf = (d: string) => istYmd(new Date(d));
const RANK = (r: any) => (r.clockIn ? 0 : r.status === 'ON_LEAVE' ? 1 : r.id > 0 ? 2 : 3);
/** One row per past day, newest first: a real punch beats a leave, which beats a marker. */
function personDays(list: any[]) {
  const today = istYmd(new Date());
  const best = new Map<string, any>();
  for (const r of list) {
    const k = dayKeyOf(r.date);
    if (k > today) continue;
    const cur = best.get(k);
    if (!cur || RANK(r) < RANK(cur)) best.set(k, { ...r, dayKey: k });
  }
  return [...best.values()].sort((a, b) => b.dayKey.localeCompare(a.dayKey));
}
/** A record with no clock-in shows its own status rather than a guess. */
const statusText = (r: any) =>
  !r.status || r.status === 'PRESENT' ? 'No clock-in'
  : String(r.status).replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c: string) => c.toUpperCase());

function bucketOf(r: any | undefined): Bucket {
  if (!r) return 'NOT_IN';
  if (r.status === 'ON_LEAVE') return r.isHalfDay && r.clockIn ? 'HALF_DAY' : 'LEAVE';
  if (r.status === 'WEEKLY_OFF' || r.status === 'HOLIDAY' || r.status === 'DAY_OFF') return 'OFF';
  if (r.status === 'HALF_DAY') return 'HALF_DAY';
  if (r.clockIn) return r.isLate ? 'LATE' : 'PRESENT';
  return 'NOT_IN';
}

export default function TeamAttendanceScreen() {
  const navigation = useNavigation<any>();
  const [mode, setMode] = useState<'DAY' | 'MONTH'>('DAY');
  const [day, setDay] = useState(istYmd(new Date()));
  const [month, setMonth] = useState(() => { const t = istYmd(new Date()); return { y: Number(t.slice(0, 4)), m: Number(t.slice(5, 7)) }; });
  const [people, setPeople] = useState<any[]>([]);
  const [records, setRecords] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [denied, setDenied] = useState(false);
  const [bucket, setBucket] = useState<Bucket | ''>('');
  const [dept, setDept] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'NAME' | 'LATE' | 'PRESENT'>('NAME');
  const [person, setPerson] = useState<any | null>(null);

  const load = useCallback(async () => {
    try {
      const params = mode === 'DAY' ? { from: day, to: day } : { month: month.m, year: month.y };
      const [att, emps, sum] = await Promise.all([
        apiClient.get('/attendance/all', { params }),
        people.length ? Promise.resolve({ data: people }) : apiClient.get('/employees/basic-list'),
        mode === 'DAY' ? apiClient.get('/attendance/today-summary', { params: { date: day } }).catch(() => ({ data: null })) : Promise.resolve({ data: null }),
      ]);
      setRecords(att.data || []);
      setPeople(emps.data || []);
      setSummary(sum.data);
      setDenied(false);
    } catch (e: any) {
      if (e?.response?.status === 403) setDenied(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  // people is a cache; re-fetching it on every date change is not needed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, day, month]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const departments = useMemo(() => [...new Set(people.map((p) => p.department?.name).filter(Boolean))].sort() as string[], [people]);
  const q = query.trim().toLowerCase();
  const matches = (e: any) => (!dept || e.department?.name === dept) &&
    (!q || `${fullName(e)} ${e.employeeCode || ''} ${e.designation?.name || ''}`.toLowerCase().includes(q));

  // ---- Day view: one row per person, from their record for the day (if any).
  const dayRows = useMemo(() => {
    if (mode !== 'DAY') return [];
    const byEmp = new Map<number, any>();
    for (const r of records) {
      const prev = byEmp.get(r.employeeId);
      // A real punch beats a planned marker for the same day.
      if (!prev || (r.id > 0 && prev.id < 0)) byEmp.set(r.employeeId, r);
    }
    return people.filter(matches).map((e) => ({ e, r: byEmp.get(e.id), b: bucketOf(byEmp.get(e.id)) }))
      .sort((a, b) => fullName(a.e).localeCompare(fullName(b.e)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, records, people, dept, q]);
  const dayCounts = useMemo(() => Object.fromEntries(BUCKETS.map((b) => [b.key, dayRows.filter((x) => x.b === b.key).length])) as Record<Bucket, number>, [dayRows]);
  const dayShown = bucket ? dayRows.filter((x) => x.b === bucket) : dayRows;

  // ---- Month view: per-person totals.
  const monthRows = useMemo(() => {
    if (mode !== 'MONTH') return [];
    const by = new Map<number, any[]>();
    for (const r of records) by.set(r.employeeId, [...(by.get(r.employeeId) || []), r]);
    const rows = people.filter(matches).map((e) => {
      const list = (by.get(e.id) || []).filter((r) => r.id > 0 || r.status === 'ON_LEAVE');
      const worked = list.filter((r) => r.clockIn);
      const late = worked.filter((r) => r.isLate).length;
      return {
        e, list,
        present: worked.length, late, early: worked.filter((r) => r.isEarlyLeave).length,
        half: list.filter((r) => r.status === 'HALF_DAY' || (r.status === 'ON_LEAVE' && r.isHalfDay)).length,
        leave: list.filter((r) => r.status === 'ON_LEAVE').length,
        avg: worked.length ? worked.reduce((s, r) => s + hours(r), 0) / worked.length : 0,
        onsite: worked.filter((r) => r.isOnsite).length,
      };
    });
    return rows.sort((a, b) => sort === 'LATE' ? b.late - a.late : sort === 'PRESENT' ? b.present - a.present : fullName(a.e).localeCompare(fullName(b.e)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, records, people, dept, q, sort]);
  // Punctuality ranking: most on-time days, never late.
  const champions = useMemo(() => monthRows.filter((r) => r.present >= 5 && r.late === 0).sort((a, b) => b.present - a.present || b.avg - a.avg).slice(0, 5), [monthRows]);

  const openPerson = async (e: any) => {
    setPerson({ e, list: null });
    const { data } = await apiClient.get('/attendance/all', { params: mode === 'DAY' ? { month: Number(day.slice(5, 7)), year: Number(day.slice(0, 4)), employeeId: e.id } : { month: month.m, year: month.y, employeeId: e.id } }).catch(() => ({ data: [] }));
    setPerson({ e, list: personDays(data || []) });
  };

  if (denied) {
    return (
      <AppScreen showBack title="Attendance" subtitle="Everyone">
        <Text style={styles.empty}>Everyone's attendance is visible to Super Admin and HR only.</Text>
      </AppScreen>
    );
  }

  const monthLabel = new Date(Date.UTC(month.y, month.m - 1, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const today = istYmd(new Date());
  const shiftMonth = (n: number) => setMonth(({ y, m }) => { const d = new Date(Date.UTC(y, m - 1 + n, 1)); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 }; });

  const header = (
    <View style={{ gap: 10, marginBottom: 6 }}>
      <View style={styles.tabs}>
        {(['DAY', 'MONTH'] as const).map((m) => (
          <TouchableOpacity key={m} style={[styles.tab, mode === m && styles.tabOn]} onPress={() => { setMode(m); setBucket(''); }}>
            <Text style={[styles.tabText, mode === m && styles.tabTextOn]}>{m === 'DAY' ? 'Day' : 'Month'}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.nav}>
        <TouchableOpacity style={styles.navBtn} onPress={() => (mode === 'DAY' ? setDay((d) => addDays(d, -1)) : shiftMonth(-1))}><ChevronLeft size={18} color="#334155" /></TouchableOpacity>
        <TouchableOpacity style={{ flex: 1, alignItems: 'center' }} onPress={() => (mode === 'DAY' ? setDay(today) : setMonth({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) }))}>
          <Text style={styles.navText}>{mode === 'DAY' ? (day === today ? `Today · ${dayLabel(day)}` : dayLabel(day)) : monthLabel}</Text>
          <Text style={styles.tiny}>Tap for {mode === 'DAY' ? 'today' : 'this month'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navBtn} disabled={mode === 'DAY' && day >= today} onPress={() => (mode === 'DAY' ? setDay((d) => addDays(d, 1)) : shiftMonth(1))}>
          <ChevronRight size={18} color={mode === 'DAY' && day >= today ? '#CBD5E1' : '#334155'} />
        </TouchableOpacity>
      </View>

      {mode === 'DAY' ? (
        <>
          <View style={styles.grid}>
            {BUCKETS.map((b) => (
              <TouchableOpacity key={b.key} style={[styles.kpi, { backgroundColor: b.bg }, bucket === b.key && { borderColor: b.color }]} onPress={() => setBucket(bucket === b.key ? '' : b.key)}>
                <Text style={[styles.kpiNum, { color: b.color }]}>{dayCounts[b.key] || 0}</Text>
                <Text style={[styles.kpiLabel, { color: b.color }]}>{b.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {summary && (
            <Text style={styles.note}>
              {summary.stillWorking ? `${summary.stillWorking} still working · ` : ''}{summary.office} in office · {summary.onsite} on site · {summary.remote} remote
            </Text>
          )}
        </>
      ) : (
        <>
          {champions.length > 0 && (
            <View style={styles.card}>
              <View style={styles.rowCenter}><Trophy size={15} color="#D97706" /><Text style={styles.cardTitle}>Attendance champions</Text></View>
              {champions.map((c, i) => (
                <TouchableOpacity key={c.e.id} style={styles.champ} onPress={() => openPerson(c.e)}>
                  <Text style={styles.rank}>{i + 1}</Text>
                  <Avatar person={c.e} size={26} />
                  <Text style={[styles.name, { flex: 1 }]} numberOfLines={1}>{fullName(c.e)}</Text>
                  <Text style={styles.sub}>{c.present} days · never late</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {([['NAME', 'Name'], ['LATE', 'Most late'], ['PRESENT', 'Most present']] as const).map(([k, l]) => (
              <TouchableOpacity key={k} style={[styles.chip, sort === k && styles.chipOn]} onPress={() => setSort(k)}>
                <Text style={[styles.chipText, sort === k && styles.chipTextOn]}>{l}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </>
      )}

      <View style={styles.search}>
        <Search size={16} color="#94A3B8" />
        <TextInput style={styles.searchInput} value={query} onChangeText={setQuery} placeholder="Search name, #code, designation" placeholderTextColor="#94A3B8" autoCorrect={false} clearButtonMode="while-editing" />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {['', ...departments].map((d) => (
          <TouchableOpacity key={d || 'all'} style={[styles.chip, dept === d && styles.chipOn]} onPress={() => setDept(d)}>
            <Text style={[styles.chipText, dept === d && styles.chipTextOn]}>{d || 'All departments'}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );

  return (
    <AppScreen
      showBack
      title="Attendance"
      subtitle={mode === 'DAY' ? `Everyone · ${dayRows.length} people` : `Everyone · ${monthLabel}`}
      right={
        <TouchableOpacity style={styles.mineBtn} onPress={() => navigateTo(navigation, 'Attendance', { initialTab: 'timesheets' })}>
          <User size={14} color="#1373E5" /><Text style={styles.mineText}>Mine</Text>
        </TouchableOpacity>
      }
    >
      {loading ? <ActivityIndicator style={{ marginTop: 40 }} color={theme.colors.primary} /> : mode === 'DAY' ? (
        <FlatList
          data={dayShown}
          keyExtractor={(x) => String(x.e.id)}
          ListHeaderComponent={header}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListEmptyComponent={<Text style={styles.empty}>No one here.</Text>}
          renderItem={({ item: { e, r, b } }) => {
            const t = BUCKETS.find((x) => x.key === b)!;
            const detail = r?.clockIn
              ? `In ${clock(r.clockIn)}${r.clockOut ? ` · out ${clock(r.clockOut)} · ${fmtH(hours(r))}` : ' · working'}`
              : b === 'LEAVE' ? `${r?.leaveType || 'Leave'}${r?.isHalfDay ? ' (half day)' : ''}` : b === 'OFF' ? 'Weekly off / day off' : 'No clock-in';
            return (
              <TouchableOpacity style={styles.row} onPress={() => openPerson(e)} activeOpacity={0.8}>
                <Avatar person={e} size={38} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.name} numberOfLines={1}>{fullName(e)}</Text>
                  <Text style={styles.sub} numberOfLines={1}>{detail}</Text>
                  <View style={styles.flags}>
                    {r?.isEarlyLeave && <Text style={styles.flag}>Early leave</Text>}
                    {r?.isOnsite && <Text style={[styles.flag, { color: '#0D9488', backgroundColor: '#F0FDFA' }]}>On site{r.project?.name ? ` · ${r.project.name}` : ''}</Text>}
                    {(r?.clockInOutside || r?.clockOutOutside) && <Text style={[styles.flag, { color: '#C2410C', backgroundColor: '#FFF7ED' }]}>Outside office</Text>}
                    {r?.autoClockedOut && <Text style={styles.flag}>Auto clock-out</Text>}
                  </View>
                </View>
                <Text style={[styles.pill, { color: t.color, backgroundColor: t.bg }]}>{t.label}</Text>
              </TouchableOpacity>
            );
          }}
        />
      ) : (
        <FlatList
          data={monthRows}
          keyExtractor={(x) => String(x.e.id)}
          ListHeaderComponent={header}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListEmptyComponent={<Text style={styles.empty}>No one here.</Text>}
          renderItem={({ item: x }) => (
            <TouchableOpacity style={styles.row} onPress={() => openPerson(x.e)} activeOpacity={0.8}>
              <Avatar person={x.e} size={38} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={styles.name} numberOfLines={1}>{fullName(x.e)}</Text>
                <View style={styles.stats}>
                  <Text style={styles.stat}><Text style={styles.statNum}>{x.present}</Text> present</Text>
                  <Text style={[styles.stat, x.late > 0 && { color: '#B45309' }]}><Text style={styles.statNum}>{x.late}</Text> late</Text>
                  <Text style={styles.stat}><Text style={styles.statNum}>{x.leave}</Text> leave</Text>
                  {x.half > 0 && <Text style={styles.stat}><Text style={styles.statNum}>{x.half}</Text> half</Text>}
                  {x.early > 0 && <Text style={styles.stat}><Text style={styles.statNum}>{x.early}</Text> early</Text>}
                </View>
                {x.present > 0 && <Text style={styles.tiny}>Avg {fmtH(x.avg)} a day{x.onsite ? ` · ${x.onsite} on site` : ''}</Text>}
              </View>
              <ChevronRight size={16} color="#CBD5E1" />
            </TouchableOpacity>
          )}
        />
      )}

      {/* One person's month */}
      <Modal visible={!!person} transparent animationType="slide" onRequestClose={() => setPerson(null)}>
        <View style={styles.bottom}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Avatar person={person?.e} size={40} />
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetTitle}>{fullName(person?.e)}</Text>
                <Text style={styles.sub}>{[person?.e?.designation?.name, person?.e?.department?.name].filter(Boolean).join(' · ')}</Text>
              </View>
              <TouchableOpacity onPress={() => setPerson(null)}><X size={20} color="#334155" /></TouchableOpacity>
            </View>
            {person?.list === null ? <ActivityIndicator style={{ margin: 30 }} color={theme.colors.primary} /> : (
              <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
                {(person?.list || []).length ? person.list.map((r: any) => {
                  const b = bucketOf(r);
                  const t = BUCKETS.find((x) => x.key === b)!;
                  return (
                    <View key={r.id} style={styles.logRow}>
                      <Text style={styles.logDay}>{dayLabel(r.dayKey)}</Text>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={styles.sub}>
                          {r.clockIn ? `${clock(r.clockIn)} – ${r.clockOut ? clock(r.clockOut) : 'working'}${r.clockIn ? ` · ${fmtH(hours(r))}` : ''}` : b === 'LEAVE' ? r.leaveType || 'Leave' : b === 'NOT_IN' ? statusText(r) : t.label}
                        </Text>
                        {(r.logs || []).length > 1 && <Text style={styles.tiny}>{r.logs.length} punches</Text>}
                        {!!r.clockOutReason && <Text style={styles.tiny}>“{r.clockOutReason}”</Text>}
                      </View>
                      {r.clockInLat != null && r.clockInLng != null && (
                        <TouchableOpacity onPress={() => Linking.openURL(`https://maps.google.com/?q=${r.clockInLat},${r.clockInLng}`)}>
                          <MapPin size={16} color="#0D9488" />
                        </TouchableOpacity>
                      )}
                      <Text style={[styles.pill, { color: t.color, backgroundColor: t.bg }]}>{r.isEarlyLeave && b !== 'LEAVE' ? 'Early' : t.label}</Text>
                    </View>
                  );
                }) : <Text style={styles.sub}>No attendance this month.</Text>}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, paddingBottom: 120, gap: 8 },
  tabs: { flexDirection: 'row', backgroundColor: '#F1F5F9', borderRadius: 12, padding: 3, gap: 3 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 9 },
  tabOn: { backgroundColor: '#fff' },
  tabText: { fontSize: 13, fontWeight: '700', color: '#64748B' },
  tabTextOn: { color: '#0F172A' },
  nav: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', padding: 8 },
  navBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#F8FAFC', alignItems: 'center', justifyContent: 'center' },
  navText: { fontSize: 15, fontWeight: '800', color: '#0F172A' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  kpi: { width: '31.6%', borderRadius: 12, paddingVertical: 9, alignItems: 'center', borderWidth: 1.5, borderColor: 'transparent' },
  kpiNum: { fontSize: 20, fontWeight: '800' },
  kpiLabel: { fontSize: 11, fontWeight: '700' },
  note: { fontSize: 12, color: '#64748B', textAlign: 'center' },
  card: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', padding: 12, gap: 8 },
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardTitle: { fontSize: 14, fontWeight: '800', color: '#0F172A' },
  champ: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rank: { width: 16, fontSize: 13, fontWeight: '800', color: '#D97706' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, paddingHorizontal: 12, height: 42 },
  searchInput: { flex: 1, fontSize: 14, color: '#0F172A', paddingVertical: 0 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0' },
  chipOn: { backgroundColor: '#1373E5', borderColor: '#1373E5' },
  chipText: { fontSize: 12, fontWeight: '700', color: '#475569' },
  chipTextOn: { color: '#fff' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', padding: 12 },
  name: { fontSize: 14, fontWeight: '800', color: '#0F172A' },
  sub: { fontSize: 12, color: '#64748B' },
  tiny: { fontSize: 11, color: '#94A3B8' },
  flags: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  flag: { fontSize: 10, fontWeight: '700', color: '#B45309', backgroundColor: '#FFFBEB', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, overflow: 'hidden' },
  pill: { fontSize: 10, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, overflow: 'hidden' },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  stat: { fontSize: 12, color: '#64748B' },
  statNum: { fontWeight: '800', color: '#0F172A' },
  mineBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, height: 36, borderRadius: 10, backgroundColor: '#EFF6FF' },
  mineText: { fontSize: 12, fontWeight: '800', color: '#1373E5' },
  empty: { textAlign: 'center', color: theme.colors.textSecondary, marginTop: 30, paddingHorizontal: 24 },
  bottom: { flex: 1, backgroundColor: 'rgba(15,23,42,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: '85%', paddingBottom: 30 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  sheetTitle: { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  logRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  logDay: { width: 92, fontSize: 12, fontWeight: '700', color: '#334155' },
});
