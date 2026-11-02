import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import {
  View,
  Text,
  StyleSheet,
  SectionList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  TextInput,
  ScrollView,
  Modal,
  Linking,
  Platform,
} from 'react-native';
import {
  Search,
  ArrowUpDown,
  Mail,
  Phone,
  ChevronDown,
  X,
  Check,
  SlidersHorizontal,
  MapPin,
  Building2,
  Briefcase,
  UserCheck,
  ChevronRight,
  CheckCircle2,
} from 'lucide-react-native';
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
  id: number;
  firstName: string;
  lastName?: string | null;
  avatarUrl?: string | null;
  employeeCode?: string | null;
  department?: string | null;
  designation?: string | null;
  branch?: string | null;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
  accountStatus?: string | null;
  onboardingStatus?: string | null;
  offboardingStatus?: string | null;
  joiningDate?: string | null;
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
  id: e.id,
  firstName: e.firstName,
  lastName: e.lastName,
  avatarUrl: e.avatarUrl,
  employeeCode: e.employeeCode,
  department: nameOf(e.department),
  designation: nameOf(e.designation),
  branch: nameOf(e.branch),
  email: e.user?.email ?? e.email ?? null,
  phone: e.phone ?? null,
  role: e.user?.role ?? null,
  accountStatus: e.user?.status ?? null,
  onboardingStatus: e.onboardingStatus ?? null,
  offboardingStatus: e.offboardingStatus ?? 'NONE',
  joiningDate: e.joiningDate ?? null,
});

const SORT_LABEL: Record<Sort, string> = { NAME: 'Name', JOINED: 'Newest', DEPARTMENT: 'Department' };

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
  const [sheetSearch, setSheetSearch] = useState('');

  const load = useCallback(async () => {
    try {
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
      for (const e of people) {
        const v = f.value(e);
        if (v) m.set(v, (m.get(v) || 0) + 1);
      }
      o[f.key] = [...m.entries()].map(([value, n]) => ({ value, n })).sort((a, b) => a.value.localeCompare(b.value));
    }
    return o;
  }, [people]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^#/, '');
    const out = people.filter((e) => {
      for (const f of FILTERS) {
        const want = filters[f.key];
        if (want && f.value(e) !== want) return false;
      }
      if (!q) return true;
      return [name(e), e.employeeCode, e.department, e.designation, e.email, e.branch]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
    return out.sort((a, b) =>
      sort === 'JOINED'
        ? String(b.joiningDate || '').localeCompare(String(a.joiningDate || ''))
        : sort === 'DEPARTMENT'
        ? String(a.department || '~').localeCompare(String(b.department || '~')) || name(a).localeCompare(name(b))
        : name(a).localeCompare(name(b))
    );
  }, [people, filters, query, sort]);

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

  const filteredSheetOptions = useMemo(() => {
    if (!picking) return [];
    const all = [{ value: '', n: people.length }, ...(options[picking] || [])];
    if (!sheetSearch.trim()) return all;
    const q = sheetSearch.trim().toLowerCase();
    return all.filter((o) => (o.value || `All ${pickingDef?.label.toLowerCase()}s`).toLowerCase().includes(q));
  }, [picking, options, people.length, sheetSearch, pickingDef]);

  const header = (
    <View style={styles.header}>
      {/* Search Bar & Sort Button */}
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Search size={15} color="#94A3B8" strokeWidth={2.2} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search name, #code, department..."
            placeholderTextColor="#94A3B8"
            autoCorrect={false}
            autoCapitalize="none"
            clearButtonMode="never"
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')} style={styles.clearSearchBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <X size={14} color="#64748B" strokeWidth={2.4} />
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity style={[styles.sortBtn, sort !== 'NAME' && styles.sortBtnActive]} onPress={cycleSort} activeOpacity={0.75}>
          <ArrowUpDown size={14} color={sort !== 'NAME' ? '#1373E5' : '#475569'} strokeWidth={2.2} />
          <Text style={[styles.sortText, sort !== 'NAME' && styles.sortTextActive]} numberOfLines={1}>
            {SORT_LABEL[sort]}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Filter Chips Horizontal Strip */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsScroll}>
        <View style={styles.filterPillIcon}>
          <SlidersHorizontal size={13} color="#64748B" strokeWidth={2.2} />
        </View>
        {shownFilters.map((f) => {
          const v = filters[f.key];
          return (
            <TouchableOpacity
              key={f.key}
              style={[styles.chip, v && styles.chipActive]}
              onPress={() => {
                setPicking(f.key);
                setSheetSearch('');
              }}
              activeOpacity={0.8}
            >
              <Text style={[styles.chipText, v && styles.chipTextActive]} numberOfLines={1}>
                {v ? `${f.label}: ${v}` : f.label}
              </Text>
              <ChevronDown size={13} color={v ? '#FFFFFF' : '#64748B'} strokeWidth={2.2} />
            </TouchableOpacity>
          );
        })}
        {activeFilters.length > 0 && (
          <TouchableOpacity style={styles.clearFilterChip} onPress={() => setFilters({})} activeOpacity={0.8}>
            <X size={13} color="#DC2626" strokeWidth={2.4} />
            <Text style={styles.clearFilterText}>Reset</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Results Count Banner */}
      <View style={styles.countRow}>
        <Text style={styles.countText}>
          Showing <Text style={styles.countTextBold}>{list.length}</Text> of {people.length} employees
        </Text>
        {activeFilters.length > 0 && (
          <View style={styles.activeFilterCountPill}>
            <Text style={styles.activeFilterCountText}>{activeFilters.length} active</Text>
          </View>
        )}
      </View>
    </View>
  );

  return (
    <AppScreen
      showBack
      title="Employee Directory"
      subtitle={`${people.length} people · ${departments} departments`}
    >
      {loading ? (
        <ActivityIndicator style={styles.loader} color={theme.colors.primary} size="large" />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(e) => String(e.id)}
          ListHeaderComponent={header}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconCircle}>
                <Search size={30} color="#94A3B8" />
              </View>
              <Text style={styles.emptyTitle}>No employees found</Text>
              <Text style={styles.emptySubtitle}>Try adjusting your search query or removing some active filters.</Text>
              {activeFilters.length > 0 && (
                <TouchableOpacity style={styles.resetBtn} onPress={() => { setQuery(''); setFilters({}); }}>
                  <Text style={styles.resetBtnText}>Clear all filters</Text>
                </TouchableOpacity>
              )}
            </View>
          }
          renderSectionHeader={({ section }) =>
            section.title ? (
              <View style={styles.sectionHeaderRow}>
                <View style={styles.sectionBadge}>
                  <Text style={styles.sectionBadgeText}>{section.title}</Text>
                </View>
                <View style={styles.sectionLine} />
              </View>
            ) : null
          }
          renderItem={({ item: e }) => {
            const status = statusOf(e);
            return (
              <TouchableOpacity
                style={[styles.card, status !== 'Active' && styles.cardMuted]}
                onPress={() => navigation.navigate('EmployeeProfile', { id: e.id, person: e, full })}
                activeOpacity={0.75}
              >
                {/* Employee Avatar */}
                <Avatar person={e} size={48} />

                {/* Main Details */}
                <View style={styles.cardInfo}>
                  <View style={styles.nameLine}>
                    <Text style={styles.nameText} numberOfLines={1}>{name(e)}</Text>
                    {status !== 'Active' && (
                      <View style={[styles.statusBadge, status === 'Left' ? styles.statusLeft : styles.statusDeactivated]}>
                        <Text style={[styles.statusBadgeText, status === 'Left' ? styles.statusLeftText : styles.statusDeactivatedText]}>
                          {status}
                        </Text>
                      </View>
                    )}
                  </View>

                  <Text style={styles.roleText} numberOfLines={1}>
                    {[e.designation, e.department].filter(Boolean).join(' · ') || 'No title'}
                  </Text>

                  {/* Micro Metadata: Code & Branch */}
                  <View style={styles.metaRow}>
                    {!!e.employeeCode && (
                      <View style={styles.codePill}>
                        <Text style={styles.codeText}>#{e.employeeCode}</Text>
                      </View>
                    )}
                    {!!e.branch && (
                      <View style={styles.branchPill}>
                        <MapPin size={10} color="#64748B" strokeWidth={2.2} />
                        <Text style={styles.branchText} numberOfLines={1}>{e.branch}</Text>
                      </View>
                    )}
                  </View>
                </View>

                {/* Quick Contact Action Buttons */}
                <View style={styles.actionsCol}>
                  {!!e.phone && (
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.phoneBtn]}
                      onPress={(ev) => {
                        ev.stopPropagation();
                        Linking.openURL(`tel:${e.phone}`);
                      }}
                      activeOpacity={0.7}
                      accessibilityLabel="Call"
                    >
                      <Phone size={15} color="#059669" strokeWidth={2.2} />
                    </TouchableOpacity>
                  )}
                  {!!e.email && (
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.emailBtn]}
                      onPress={(ev) => {
                        ev.stopPropagation();
                        Linking.openURL(`mailto:${e.email}`);
                      }}
                      activeOpacity={0.7}
                      accessibilityLabel="Email"
                    >
                      <Mail size={15} color="#1373E5" strokeWidth={2.2} />
                    </TouchableOpacity>
                  )}
                  <ChevronRight size={16} color="#CBD5E1" strokeWidth={2.2} style={{ marginLeft: 2 }} />
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}

      {/* Enhanced Filter Selection Bottom Sheet */}
      <Modal visible={!!picking} transparent animationType="slide" onRequestClose={() => setPicking(null)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setPicking(null)}>
          <TouchableOpacity activeOpacity={1} style={styles.sheet}>
            {/* Sheet Drag Indicator */}
            <View style={styles.dragHandle} />

            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.sheetTitle}>{pickingDef?.label}</Text>
                <Text style={styles.sheetSubtitle}>Filter employees by {pickingDef?.label.toLowerCase()}</Text>
              </View>
              <TouchableOpacity
                onPress={() => setPicking(null)}
                style={styles.closeBtn}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <X size={18} color="#475569" strokeWidth={2.4} />
              </TouchableOpacity>
            </View>

            {/* Filter Search Input (when list is long) */}
            <View style={styles.sheetSearchBox}>
              <Search size={14} color="#94A3B8" strokeWidth={2.2} />
              <TextInput
                style={styles.sheetSearchInput}
                value={sheetSearch}
                onChangeText={setSheetSearch}
                placeholder={`Search ${pickingDef?.label.toLowerCase()}s...`}
                placeholderTextColor="#94A3B8"
                autoCorrect={false}
              />
              {sheetSearch.length > 0 && (
                <TouchableOpacity onPress={() => setSheetSearch('')} style={styles.clearSearchBtn}>
                  <X size={13} color="#64748B" strokeWidth={2.4} />
                </TouchableOpacity>
              )}
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetOptionsList}>
              {filteredSheetOptions.map((o) => {
                const isSelected = (filters[picking!] || '') === o.value;
                const displayLabel = o.value || `All ${pickingDef?.label.toLowerCase()}s`;
                return (
                  <TouchableOpacity
                    key={o.value || 'all'}
                    style={[styles.sheetOption, isSelected && styles.sheetOptionSelected]}
                    onPress={() => {
                      setFilters((f) => ({ ...f, [picking!]: o.value || undefined }));
                      setPicking(null);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.sheetOptionText, isSelected && styles.sheetOptionTextSelected]}>
                      {displayLabel}
                    </Text>
                    <View style={styles.sheetOptionRight}>
                      <View style={[styles.optionCountPill, isSelected && styles.optionCountPillSelected]}>
                        <Text style={[styles.optionCountText, isSelected && styles.optionCountTextSelected]}>
                          {o.n}
                        </Text>
                      </View>
                      {isSelected && <Check size={16} color="#1373E5" strokeWidth={2.6} />}
                    </View>
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
  loader: { marginTop: 60 },
  list: { paddingHorizontal: 16, paddingBottom: 130 },

  // Header & Controls
  header: { gap: 10, paddingTop: 10, paddingBottom: 6 },
  searchRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 11,
    height: 42,
    gap: 8,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
    elevation: 1,
  },
  searchInput: { flex: 1, fontSize: 13.5, color: '#0F172A', paddingVertical: 0 },
  clearSearchBtn: { padding: 4 },
  sortBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
    elevation: 1,
  },
  sortBtnActive: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
  },
  sortText: { fontSize: 12.5, fontWeight: '700', color: '#475569' },
  sortTextActive: { color: '#1373E5' },

  // Filter Chips Row
  chipsScroll: { gap: 6, alignItems: 'center', paddingVertical: 2 },
  filterPillIcon: {
    width: 30,
    height: 30,
    borderRadius: 999,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    maxWidth: 220,
  },
  chipActive: {
    backgroundColor: '#1373E5',
    borderColor: '#1373E5',
    shadowColor: '#1373E5',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 2,
  },
  chipText: { fontSize: 12, fontWeight: '700', color: '#475569' },
  chipTextActive: { color: '#FFFFFF' },
  clearFilterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  clearFilterText: { fontSize: 12, fontWeight: '800', color: '#DC2626' },

  // Count & Meta Banner
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  countText: { fontSize: 12, color: '#64748B' },
  countTextBold: { fontWeight: '800', color: '#0F172A' },
  activeFilterCountPill: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#DBEAFE',
  },
  activeFilterCountText: { fontSize: 11, fontWeight: '800', color: '#1D4ED8' },

  // Section Headers (A-Z)
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    marginBottom: 8,
    gap: 8,
  },
  sectionBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionBadgeText: { fontSize: 12, fontWeight: '800', color: '#334155' },
  sectionLine: { flex: 1, height: 1, backgroundColor: '#F1F5F9' },

  // Employee Card
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 12,
    marginBottom: 8,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 5,
    elevation: 1,
  },
  cardMuted: { opacity: 0.65 },
  cardInfo: { flex: 1, minWidth: 0, gap: 2 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  nameText: { flexShrink: 1, fontSize: 15, fontWeight: '800', color: '#0F172A' },
  statusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 6,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  statusLeft: { backgroundColor: '#F1F5F9' },
  statusLeftText: { fontSize: 10, fontWeight: '800', color: '#64748B' },
  statusDeactivated: { backgroundColor: '#FEF2F2' },
  statusDeactivatedText: { fontSize: 10, fontWeight: '800', color: '#DC2626' },
  roleText: { fontSize: 12.5, color: '#475569', fontWeight: '500' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2, minWidth: 0 },
  codePill: {
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
    paddingHorizontal: 7,
    paddingVertical: 1.5,
    borderRadius: 6,
    flexShrink: 0,
  },
  codeText: { fontSize: 11, fontWeight: '800', color: '#4338CA', letterSpacing: 0.2 },
  branchPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    flexShrink: 1,
    minWidth: 0,
  },
  branchText: { fontSize: 11, color: '#64748B', fontWeight: '500', flexShrink: 1 },

  // Action Buttons Col
  actionsCol: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  actionBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  phoneBtn: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  emailBtn: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
  },

  // Empty State
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
  },
  emptyIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: '#0F172A', marginBottom: 4 },
  emptySubtitle: { fontSize: 13, color: '#64748B', textAlign: 'center', lineHeight: 18, marginBottom: 14 },
  resetBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#1373E5',
  },
  resetBtnText: { fontSize: 12.5, fontWeight: '800', color: '#FFFFFF' },

  // Bottom Sheet
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '75%',
    paddingBottom: 34,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 10,
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#CBD5E1',
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 4,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  sheetTitle: { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  sheetSubtitle: { fontSize: 12, color: '#64748B', marginTop: 1 },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetSearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 10,
    height: 38,
    backgroundColor: '#F8FAFC',
  },
  sheetSearchInput: { flex: 1, fontSize: 13, color: '#0F172A', paddingVertical: 0 },
  sheetOptionsList: { paddingHorizontal: 12, paddingVertical: 4 },
  sheetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
  },
  sheetOptionSelected: {
    backgroundColor: '#EFF6FF',
  },
  sheetOptionText: { fontSize: 14.5, color: '#0F172A', fontWeight: '500' },
  sheetOptionTextSelected: { fontWeight: '800', color: '#1373E5' },
  sheetOptionRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  optionCountPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: '#F1F5F9',
  },
  optionCountPillSelected: {
    backgroundColor: '#DBEAFE',
  },
  optionCountText: { fontSize: 12, color: '#64748B', fontWeight: '700' },
  optionCountTextSelected: { color: '#1D4ED8' },
});
