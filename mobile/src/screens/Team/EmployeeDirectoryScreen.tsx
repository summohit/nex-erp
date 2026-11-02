import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import {
  View, Text, StyleSheet, SectionList, TouchableOpacity, RefreshControl, ActivityIndicator,
  TextInput, ScrollView, Modal, Linking,
} from 'react-native';
import { Search, ArrowUpDown, Mail, Phone, ChevronDown, X, Check, SlidersHorizontal } from 'lucide-react-native';
import AppScreen from '../../components/AppScreen';
import { apiClient } from '../../api/apiClient';
import { Avatar } from '../../components/PersonSheet';
import { theme } from '../../theme/theme';

/**
 * Employee directory. HR and admins (anyone the server lets read /employees)
 * get the full list with the web's admin filters; everyone else gets the
 * basic list, which the server allows for all employees.
 */
type Emp = {
  id: number; firstName: string; lastName?: string | null; avatarUrl?: string | null; employeeCode?: string | null;
  department?: string | null; designation?: string | null; branch?: string | null; email?: string | null;
  phone?: string | null; role?: string | null; accountStatus?: string | null; onboardingStatus?: string | null;
  offboardingStatus?: string | null; joiningDate?: string | null;
};
type FilterKey = 'department' | 'designation' | 'branch' | 'role' | 'onboarding' | 'offboarding' | 'status';
type Sort = 'NAME' | 'JOINED' | 'DEPARTMENT';

const name = (e: Emp) => `${e.firstName || ''} ${e.lastName || ''}`.trim();
const nameOf = (v: any) => (typeof v === 'string' ? v : v?.name) || null;
const ROLE_LABEL = (r: string) => r.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const ONBOARDING: Record<string, string> = { PENDING: 'Pending', IN_PROGRESS: 'In progress', COMPLETED: 'Completed' };
const OFFBOARDING: Record<string, string> = { NONE: 'Not started', IN_PROGRESS: 'In progress', SEPARATED: 'Offboarded' };
const isLeft = (e: Emp) => e.offboardingStatus === 'SEPARATED';
const isInactive = (e: Emp) => ['SUSPENDED', 'INACTIVE', 'BLOCKED'].includes(String(e.accountStatus || '').toUpperCase());
const statusOf = (e: Emp) => (isLeft(e) ? 'Left' : isInactive(e) ? 'Deactivated' : 'Active');

const toEmp = (e: any): Emp => ({
  id: e.id, firstName: e.firstName, lastName: e.lastName, avatarUrl: e.avatarUrl, employeeCode: e.employeeCode,
  department: nameOf(e.department), designation: nameOf(e.designation), branch: nameOf(e.branch),
  email: e.user?.email ?? e.email ?? null, phone: e.phone ?? null, role: e.user?.role ?? null,
  accountStatus: e.user?.status ?? null, onboardingStatus: e.onboardingStatus ?? null,
  offboardingStatus: e.offboardingStatus ?? 'NONE', joiningDate: e.joiningDate ?? null,
});

const SORT_LABEL: Record<Sort, string> = { NAME: 'Name', JOINED: 'Newest joiners', DEPARTMENT: 'Department' };

export default function EmployeeDirectoryScreen() {
  const navigation = useNavigation<any>();
  const [people, setPeople] = useState<Emp[]>([]);
  const [full, setFull] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('NAME');
  const [filters, setFilters] = useState<Partial<Record<FilterKey, string>>>({ status: 'Active' });
  const [picking, setPicking] = useState<FilterKey | null>(null);

  const load = useCallback(async () => {
    try {
      // Full directory if the server allows it, else the list every employee may see.
      try {
        const { data } = await apiClient.get('/employees');
        setPeople((data || []).map(toEmp));
        setFull(true);
      } catch (e: any) {
        if (e?.response?.status !== 403) throw e;
        const { data } = await apiClient.get('/employees/basic-list');
        setPeople((data || []).map(toEmp));
        setFull(false);
        setFilters((f) => ({ ...f, status: undefined }));
      }
    } catch {
      setPeople([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const FILTERS: { key: FilterKey; label: string; hrOnly?: boolean; value: (e: Emp) => string | null }[] = [
    { key: 'department', label: 'Department', value: (e) => e.department ?? null },
    { key: 'designation', label: 'Designation', value: (e) => e.designation ?? null },
    { key: 'branch', label: 'Branch', value: (e) => e.branch ?? null },
    { key: 'role', label: 'Role', hrOnly: true, value: (e) => (e.role ? ROLE_LABEL(e.role) : null) },
    { key: 'onboarding', label: 'Onboarding', hrOnly: true, value: (e) => ONBOARDING[e.onboardingStatus || 'PENDING'] },
    { key: 'offboarding', label: 'Offboarding', hrOnly: true, value: (e) => OFFBOARDING[e.offboardingStatus || 'NONE'] },
    { key: 'status', label: 'Status', hrOnly: true, value: statusOf },
  ];
  const shownFilters = FILTERS.filter((f) => full || !f.hrOnly);

  const options = useMemo(() => {
    const o = {} as Record<FilterKey, { value: string; n: number }[]>;
    for (const f of FILTERS) {
      const m = new Map<string, number>();
      for (const e of people) { const v = f.value(e); if (v) m.set(v, (m.get(v) || 0) + 1); }
      o[f.key] = [...m.entries()].map(([value, n]) => ({ value, n })).sort((a, b) => a.value.localeCompare(b.value));
    }
    return o;
  // FILTERS is rebuilt each render but only reads people.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^#/, '');
    const out = people.filter((e) => {
      for (const f of FILTERS) {
        const want = filters[f.key];
        if (want && f.value(e) !== want) return false;
      }
      if (!q) return true;
      return [name(e), e.employeeCode, e.department, e.designation, e.email, e.branch].filter(Boolean).join(' ').toLowerCase().includes(q);
    });
    return out.sort((a, b) =>
      sort === 'JOINED' ? String(b.joiningDate || '').localeCompare(String(a.joiningDate || ''))
      : sort === 'DEPARTMENT' ? String(a.department || '~').localeCompare(String(b.department || '~')) || name(a).localeCompare(name(b))
      : name(a).localeCompare(name(b)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people, filters, query, sort]);

  // A–Z sections by name, department sections when sorted by department, one list for newest joiners.
  const sections = useMemo(() => {
    if (sort === 'JOINED') return [{ title: '', data: list }];
    const m = new Map<string, Emp[]>();
    for (const e of list) {
      const k = sort === 'DEPARTMENT' ? e.department || 'No department' : (name(e)[0] || '#').toUpperCase();
      m.set(k, [...(m.get(k) || []), e]);
    }
    return [...m.entries()].map(([title, data]) => ({ title, data }));
  }, [list, sort]);

  const departments = new Set(people.map((e) => e.department).filter(Boolean)).size;
  const activeFilters = Object.entries(filters).filter(([, v]) => v);
  const cycleSort = () => setSort((s) => (s === 'NAME' ? 'DEPARTMENT' : s === 'DEPARTMENT' ? 'JOINED' : 'NAME'));
  const pickingDef = FILTERS.find((f) => f.key === picking);

  const header = (
    <View style={styles.header}>
      <View style={styles.searchRow}>
        <View style={styles.search}>
          <Search size={16} color="#94A3B8" />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search name, #code, department, email"
            placeholderTextColor="#94A3B8"
            autoCorrect={false}
            autoCapitalize="none"
            clearButtonMode="while-editing"
          />
        </View>
        <TouchableOpacity style={styles.sortBtn} onPress={cycleSort} activeOpacity={0.7}>
          <ArrowUpDown size={14} color="#334155" />
          <Text style={styles.sortText} numberOfLines={1}>{SORT_LABEL[sort]}</Text>
        </TouchableOpacity>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        <View style={styles.filterIcon}><SlidersHorizontal size={14} color="#64748B" /></View>
        {shownFilters.map((f) => {
          const v = filters[f.key];
          return (
            <TouchableOpacity key={f.key} style={[styles.chip, v && styles.chipOn]} onPress={() => setPicking(f.key)} activeOpacity={0.8}>
              <Text style={[styles.chipText, v && styles.chipTextOn]} numberOfLines={1}>{v ? `${f.label}: ${v}` : f.label}</Text>
              <ChevronDown size={13} color={v ? '#fff' : '#64748B'} />
            </TouchableOpacity>
          );
        })}
        {activeFilters.length > 0 && (
          <TouchableOpacity style={styles.clearChip} onPress={() => setFilters({})}>
            <X size={13} color="#B91C1C" /><Text style={styles.clearText}>Clear</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
      <Text style={styles.count}>Showing {list.length} of {people.length}</Text>
    </View>
  );

  return (
    <AppScreen showBack title="Employee Directory" subtitle={`${people.length} people · ${departments} departments`}>
      {loading ? <ActivityIndicator style={styles.loader} color={theme.colors.primary} /> : (
        <SectionList
          sections={sections}
          keyExtractor={(e) => String(e.id)}
          ListHeaderComponent={header}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListEmptyComponent={<Text style={styles.empty}>No one matches these filters.</Text>}
          renderSectionHeader={({ section }) => (section.title ? <Text style={styles.section}>{section.title}</Text> : null)}
          renderItem={({ item: e }) => {
            const status = statusOf(e);
            return (
              <TouchableOpacity
                style={[styles.row, status !== 'Active' && styles.rowMuted]}
                onPress={() => navigation.navigate('EmployeeProfile', { id: e.id, person: e, full })}
                activeOpacity={0.8}
              >
                <Avatar person={e} size={44} />
                <View style={styles.rowMain}>
                  <View style={styles.nameLine}>
                    <Text style={styles.name} numberOfLines={1}>{name(e)}</Text>
                    {status !== 'Active' && <Text style={styles.badge}>{status}</Text>}
                  </View>
                  <Text style={styles.sub} numberOfLines={1}>{[e.designation, e.department].filter(Boolean).join(' · ') || '—'}</Text>
                  {!!e.employeeCode && <Text style={styles.code}>#{e.employeeCode}{e.branch ? ` · ${e.branch}` : ''}</Text>}
                </View>
                {!!e.phone && (
                  <TouchableOpacity style={styles.iconBtn} onPress={() => Linking.openURL(`tel:${e.phone}`)}>
                    <Phone size={16} color="#059669" />
                  </TouchableOpacity>
                )}
                {!!e.email && (
                  <TouchableOpacity style={styles.iconBtn} onPress={() => Linking.openURL(`mailto:${e.email}`)}>
                    <Mail size={16} color="#1373E5" />
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
            );
          }}
        />
      )}

      <Modal visible={!!picking} transparent animationType="slide" onRequestClose={() => setPicking(null)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setPicking(null)}>
          <TouchableOpacity activeOpacity={1} style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>{pickingDef?.label}</Text>
              <TouchableOpacity onPress={() => setPicking(null)}><X size={20} color="#334155" /></TouchableOpacity>
            </View>
            <ScrollView>
              {[{ value: '', n: people.length }, ...(picking ? options[picking] : [])].map((o) => {
                const on = (filters[picking!] || '') === o.value;
                return (
                  <TouchableOpacity
                    key={o.value || 'all'}
                    style={styles.option}
                    onPress={() => { setFilters((f) => ({ ...f, [picking!]: o.value || undefined })); setPicking(null); }}
                  >
                    <Text style={[styles.optionText, on && styles.optionOn]}>{o.value || `All ${pickingDef?.label.toLowerCase()}s`}</Text>
                    <Text style={styles.optionN}>{o.n}</Text>
                    {on && <Check size={16} color="#1373E5" />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  loader: { marginTop: 40 },
  list: { paddingHorizontal: 16, paddingBottom: 120 },
  header: { gap: 10, paddingTop: 12, paddingBottom: 4 },
  searchRow: { flexDirection: 'row', gap: 8 },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, paddingHorizontal: 12, height: 42 },
  searchInput: { flex: 1, fontSize: 14, color: '#0F172A', paddingVertical: 0 },
  sortBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, height: 42, maxWidth: 140, borderRadius: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0' },
  sortText: { fontSize: 12, fontWeight: '700', color: '#334155', flexShrink: 1 },
  chips: { gap: 6, alignItems: 'center' },
  filterIcon: { paddingRight: 2 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 999, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0', maxWidth: 220 },
  chipOn: { backgroundColor: '#1373E5', borderColor: '#1373E5' },
  chipText: { fontSize: 12, fontWeight: '700', color: '#475569', flexShrink: 1 },
  chipTextOn: { color: '#fff' },
  clearChip: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999, backgroundColor: '#FEF2F2' },
  clearText: { fontSize: 12, fontWeight: '700', color: '#B91C1C' },
  count: { fontSize: 12, color: '#64748B' },
  section: { fontSize: 12, fontWeight: '800', color: '#64748B', letterSpacing: 0.6, marginTop: 14, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', padding: 12, marginBottom: 8 },
  rowMuted: { opacity: 0.65 },
  rowMain: { flex: 1, gap: 1 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { flexShrink: 1, fontSize: 15, fontWeight: '800', color: '#0F172A' },
  badge: { fontSize: 10, fontWeight: '800', color: '#64748B', backgroundColor: '#F1F5F9', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, overflow: 'hidden' },
  sub: { fontSize: 12, color: '#475569' },
  code: { fontSize: 11, color: '#94A3B8', fontWeight: '600' },
  iconBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', alignItems: 'center', justifyContent: 'center' },
  empty: { textAlign: 'center', color: theme.colors.textSecondary, marginTop: 40 },
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: '70%', paddingBottom: 30 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 18, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  sheetTitle: { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F8FAFC' },
  optionText: { flex: 1, fontSize: 15, color: '#0F172A' },
  optionOn: { fontWeight: '800', color: '#1373E5' },
  optionN: { fontSize: 13, color: '#94A3B8', fontWeight: '600' },
});
