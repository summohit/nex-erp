import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl, TextInput, Switch, Alert, Linking,
} from 'react-native';
import { Search, ChevronDown, ChevronUp, Mail, Lock, UserX } from 'lucide-react-native';
import AppScreen from '../../components/AppScreen';
import { apiClient } from '../../api/apiClient';
import { Avatar } from '../../components/PersonSheet';
import { theme } from '../../theme/theme';

/**
 * HR's profile-completion report: who still has documents or details
 * missing, what exactly, and their manager. Also the document lock and the
 * list of people excused from it, as on the web.
 */
type Row = {
  employee: { id: number; firstName: string; lastName?: string | null; employeeCode?: string | null; email?: string; department: string | null; designation: string | null; avatarUrl?: string | null };
  manager: string | null; complete: boolean; firstJob?: boolean; missing: string[]; uploadedAsOther?: string[];
};
type Filter = 'INCOMPLETE' | 'COMPLETE' | 'ALL' | 'EXEMPT';
const fullName = (e: any) => `${e.firstName} ${e.lastName || ''}`.trim();
const errMsg = (e: any) => e?.response?.data?.message || 'Please try again.';

export default function ProfileCompletionScreen() {
  const navigation = useNavigation<any>();
  const [report, setReport] = useState<{ total: number; complete: number; incomplete: number; rows: Row[] } | null>(null);
  const [exempt, setExempt] = useState<any[]>([]);
  const [lock, setLock] = useState<{ enabled: boolean; from: string | null; active: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [denied, setDenied] = useState(false);
  const [filter, setFilter] = useState<Filter>('INCOMPLETE');
  const [query, setQuery] = useState('');
  const [openRows, setOpenRows] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    try {
      const [r, ex, lk] = await Promise.all([
        apiClient.get('/employees/profile-completeness').then((x) => x.data),
        apiClient.get('/employees/profile-completeness/exempt').then((x) => x.data).catch(() => []),
        apiClient.get('/employees/profile-completeness/lock').then((x) => x.data).catch(() => null),
      ]);
      setReport(r);
      setExempt(ex || []);
      setLock(lk);
      setDenied(false);
    } catch (e: any) {
      if (e?.response?.status === 403) setDenied(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (report?.rows || []).filter((r) =>
      (filter === 'ALL' || (filter === 'COMPLETE' ? r.complete : !r.complete)) &&
      (!q || `${fullName(r.employee)} ${r.employee.employeeCode || ''} ${r.employee.department || ''} ${r.manager || ''} ${r.missing.join(' ')}`.toLowerCase().includes(q)));
  }, [report, filter, query]);

  // Which documents most people are missing: where HR's chasing pays off first.
  const topMissing = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of report?.rows || []) for (const x of r.missing) m.set(x, (m.get(x) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [report]);

  const toggleRow = (id: number) => setOpenRows((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const setExemptFor = async (id: number, value: boolean) => {
    try {
      const { data } = await apiClient.put(`/employees/profile-completeness/exempt/${id}`, { exempt: value });
      setExempt(data || []);
      load();
    } catch (e) { Alert.alert('Could not update', errMsg(e)); }
  };

  const toggleLock = async (enabled: boolean) => {
    try {
      const { data } = await apiClient.put('/employees/profile-completeness/lock', { enabled, from: lock?.from ?? null });
      setLock(data);
    } catch (e) { Alert.alert('Could not change the lock', errMsg(e)); }
  };

  if (denied) {
    return (
      <AppScreen showBack title="Profile Completion">
        <Text style={styles.empty}>This report is for HR and administrators.</Text>
      </AppScreen>
    );
  }

  const pct = report?.total ? Math.round((report.complete / report.total) * 100) : 0;
  const tabs: { key: Filter; label: string; n: number }[] = [
    { key: 'INCOMPLETE', label: 'Incomplete', n: report?.incomplete || 0 },
    { key: 'COMPLETE', label: 'Complete', n: report?.complete || 0 },
    { key: 'ALL', label: 'All', n: report?.total || 0 },
    { key: 'EXEMPT', label: 'Exempt', n: exempt.length },
  ];

  const header = (
    <View style={{ gap: 12, marginBottom: 4 }}>
      <View style={styles.summary}>
        <View style={styles.ring}><Text style={styles.ringNum}>{pct}%</Text><Text style={styles.ringLabel}>complete</Text></View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={styles.sumLine}><Text style={styles.bold}>{report?.complete ?? 0}</Text> of {report?.total ?? 0} profiles complete</Text>
          <Text style={styles.sumLine}><Text style={[styles.bold, { color: '#B91C1C' }]}>{report?.incomplete ?? 0}</Text> still missing something</Text>
          {exempt.length > 0 && <Text style={styles.sub}>{exempt.length} excused from the reminder</Text>}
        </View>
      </View>

      {lock && (
        <View style={styles.lockCard}>
          <Lock size={18} color={lock.active ? '#B91C1C' : '#64748B'} />
          <View style={{ flex: 1 }}>
            <Text style={styles.bold}>Document lock</Text>
            <Text style={styles.sub}>
              {lock.enabled ? (lock.active ? 'On: people with missing documents are blocked until they upload.' : `Turns on ${lock.from || 'soon'}.`) : 'Off: people only get a reminder.'}
            </Text>
          </View>
          <Switch value={lock.enabled} onValueChange={toggleLock} />
        </View>
      )}

      {topMissing.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.section}>MOST OFTEN MISSING</Text>
          {topMissing.map(([label, n]) => (
            <TouchableOpacity key={label} style={styles.missRow} onPress={() => { setFilter('INCOMPLETE'); setQuery(label); }}>
              <Text style={styles.missLabel} numberOfLines={1}>{label}</Text>
              <Text style={styles.missN}>{n}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <View style={styles.tabs}>
        {tabs.map((t) => (
          <TouchableOpacity key={t.key} style={[styles.tab, filter === t.key && styles.tabOn]} onPress={() => setFilter(t.key)}>
            <Text style={[styles.tabText, filter === t.key && styles.tabTextOn]}>{t.label} {t.n}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {filter !== 'EXEMPT' && (
        <View style={styles.search}>
          <Search size={16} color="#94A3B8" />
          <TextInput style={styles.searchInput} value={query} onChangeText={setQuery} placeholder="Search name, manager, missing document" placeholderTextColor="#94A3B8" autoCorrect={false} clearButtonMode="while-editing" />
        </View>
      )}
    </View>
  );

  return (
    <AppScreen showBack title="Profile Completion" subtitle={report ? `${pct}% complete · ${report.incomplete} pending` : undefined}>
      {loading ? <ActivityIndicator style={{ marginTop: 40 }} color={theme.colors.primary} /> : filter === 'EXEMPT' ? (
        <FlatList
          data={exempt}
          keyExtractor={(e) => String(e.id)}
          ListHeaderComponent={header}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.empty}>No one is excused.</Text>}
          renderItem={({ item: e }) => (
            <View style={styles.row}>
              <Avatar person={e} size={40} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{fullName(e)}</Text>
                <Text style={styles.sub}>{[e.designation, e.email].filter(Boolean).join(' · ')}</Text>
              </View>
              {e.fixed ? <Text style={styles.fixed}>Always</Text> : (
                <TouchableOpacity onPress={() => setExemptFor(e.id, false)}><Text style={styles.link}>Remove</Text></TouchableOpacity>
              )}
            </View>
          )}
        />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => String(r.employee.id)}
          ListHeaderComponent={header}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListEmptyComponent={<Text style={styles.empty}>No one matches.</Text>}
          renderItem={({ item: r }) => {
            const isOpen = openRows.has(r.employee.id);
            return (
              <View style={styles.rowWrap}>
                <TouchableOpacity style={styles.row} onPress={() => toggleRow(r.employee.id)} activeOpacity={0.8}>
                  <Avatar person={r.employee} size={40} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name} numberOfLines={1}>{fullName(r.employee)}</Text>
                    <Text style={styles.sub} numberOfLines={1}>{[r.employee.designation, r.employee.department].filter(Boolean).join(' · ')}</Text>
                  </View>
                  {r.complete
                    ? <Text style={styles.done}>Complete</Text>
                    : <Text style={styles.missCount}>{r.missing.length} missing</Text>}
                  {!r.complete && (isOpen ? <ChevronUp size={16} color="#94A3B8" /> : <ChevronDown size={16} color="#94A3B8" />)}
                </TouchableOpacity>
                {isOpen && !r.complete && (
                  <View style={styles.detail}>
                    {r.missing.map((m) => <Text key={m} style={styles.missItem}>• {m}</Text>)}
                    {!!r.uploadedAsOther?.length && <Text style={styles.sub}>Filed as “Other”: {r.uploadedAsOther.join(', ')}</Text>}
                    {r.firstJob && <Text style={styles.sub}>First job: no previous-employer documents needed.</Text>}
                    {!!r.manager && <Text style={styles.sub}>Manager: {r.manager}</Text>}
                    <View style={styles.actions}>
                      {!!r.employee.email && (
                        <TouchableOpacity style={styles.action} onPress={() => Linking.openURL(`mailto:${r.employee.email}?subject=${encodeURIComponent('Please complete your profile')}&body=${encodeURIComponent(`Hi ${r.employee.firstName},\n\nYour MIRA profile is still missing:\n${r.missing.map((m) => `- ${m}`).join('\n')}\n\nPlease upload these from your Profile.\n`)}`)}>
                          <Mail size={14} color="#1373E5" /><Text style={styles.actionText}>Remind</Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity style={styles.action} onPress={() => navigation.navigate('EmployeeEdit', { employeeId: r.employee.id, initialTab: 'Documents' })}>
                        <Text style={styles.actionText}>Upload for them</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.action} onPress={() => Alert.alert('Excuse from reminder?', `${r.employee.firstName} will no longer be reminded or locked out.`, [
                        { text: 'Cancel', style: 'cancel' }, { text: 'Excuse', onPress: () => setExemptFor(r.employee.id, true) },
                      ])}>
                        <UserX size={14} color="#64748B" /><Text style={[styles.actionText, { color: '#475569' }]}>Excuse</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>
            );
          }}
        />
      )}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, paddingBottom: 120, gap: 8 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#fff', borderRadius: 18, borderWidth: 1, borderColor: '#E2E8F0', padding: 14 },
  ring: { width: 76, height: 76, borderRadius: 38, borderWidth: 6, borderColor: '#22C55E', alignItems: 'center', justifyContent: 'center' },
  ringNum: { fontSize: 18, fontWeight: '800', color: '#0F172A' },
  ringLabel: { fontSize: 9, color: '#64748B', fontWeight: '700' },
  sumLine: { fontSize: 14, color: '#334155' },
  bold: { fontWeight: '800', color: '#0F172A' },
  sub: { fontSize: 12, color: '#64748B' },
  lockCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#E2E8F0', padding: 12 },
  card: { backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#E2E8F0', padding: 12, gap: 6 },
  section: { fontSize: 11, fontWeight: '800', color: '#64748B', letterSpacing: 0.6 },
  missRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  missLabel: { flex: 1, fontSize: 13, color: '#0F172A' },
  missN: { fontSize: 13, fontWeight: '800', color: '#B91C1C' },
  tabs: { flexDirection: 'row', backgroundColor: '#F1F5F9', borderRadius: 12, padding: 3, gap: 3 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 9 },
  tabOn: { backgroundColor: '#fff' },
  tabText: { fontSize: 11, fontWeight: '700', color: '#64748B' },
  tabTextOn: { color: '#0F172A' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, paddingHorizontal: 12, height: 42 },
  searchInput: { flex: 1, fontSize: 14, color: '#0F172A', paddingVertical: 0 },
  rowWrap: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, backgroundColor: '#fff' },
  name: { fontSize: 14, fontWeight: '800', color: '#0F172A' },
  done: { fontSize: 11, fontWeight: '800', color: '#047857', backgroundColor: '#ECFDF5', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, overflow: 'hidden' },
  missCount: { fontSize: 11, fontWeight: '800', color: '#B91C1C', backgroundColor: '#FEF2F2', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, overflow: 'hidden' },
  detail: { paddingHorizontal: 14, paddingBottom: 12, gap: 4, borderTopWidth: 1, borderTopColor: '#F1F5F9', paddingTop: 10 },
  missItem: { fontSize: 13, color: '#334155' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, height: 34, borderRadius: 10, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0' },
  actionText: { fontSize: 12, fontWeight: '700', color: '#1373E5' },
  fixed: { fontSize: 11, fontWeight: '700', color: '#64748B' },
  link: { fontSize: 13, fontWeight: '700', color: '#B91C1C' },
  empty: { textAlign: 'center', color: theme.colors.textSecondary, marginTop: 30, paddingHorizontal: 24 },
});
