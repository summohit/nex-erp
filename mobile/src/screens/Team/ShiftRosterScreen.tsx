import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl, TextInput, Modal, ScrollView,
  Alert, Switch, KeyboardAvoidingView, Platform,
} from 'react-native';
import { ChevronLeft, ChevronRight, Search, X, Check, Copy, Users, MapPin } from 'lucide-react-native';
import AppScreen from '../../components/AppScreen';
import { apiClient } from '../../api/apiClient';
import { Avatar, PersonTap, PersonSheetHost } from '../../components/PersonSheet';
import { useAuthStore } from '../../store/authStore';
import { theme } from '../../theme/theme';

/**
 * The shift roster for a phone: one week at a time, a row per person with a
 * cell per day. Tap a cell to set a shift, a day off, or clear it back to the
 * person's standing shift. Bulk assign, copy last month and the on-site
 * approvals are here too. Who may see and change it is decided by the server
 * (the roster permission), the same as on the web.
 */
type Shift = { id: number; name: string; shortCode?: string | null; colorCode?: string | null; shiftType?: string; startTime?: string | null; endTime?: string | null };
type Cell = { date: string; type: 'SHIFT' | 'DAY_OFF' | 'LEAVE' | 'UNASSIGNED'; shift?: Shift; label?: string; isDefault?: boolean; isHalfDay?: boolean; isFieldVisit?: boolean; note?: string | null; onSite?: { projectName?: string | null; address?: string | null; approvalStatus: string } };
type Row = { employee: { id: number; name: string; employeeCode?: string | null; avatarUrl?: string | null; department?: string | null; designation?: string | null; isActive?: boolean }; defaultShift: { id: number; name: string } | null; cells: Cell[] };

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const monday = (d: Date) => { const m = new Date(d); m.setHours(0, 0, 0, 0); m.setDate(m.getDate() - ((m.getDay() + 6) % 7)); return m; };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const dayLabel = (k: string) => new Date(`${k}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short' }).slice(0, 2);
const dayNum = (k: string) => Number(k.slice(8, 10));
const errMsg = (e: any) => e?.response?.data?.message || 'Please try again.';
const isOnsite = (s?: Shift) => String(s?.shiftType || '').toUpperCase().includes('SITE');
const nameParts = (n: string) => { const [firstName, ...rest] = n.split(' '); return { firstName, lastName: rest.join(' ') }; };

function cellLook(c: Cell) {
  if (c.type === 'LEAVE') return { text: 'L', bg: '#FEF3C7', fg: '#B45309' };
  if (c.type === 'DAY_OFF') return { text: 'OFF', bg: '#F1F5F9', fg: '#64748B' };
  if (c.type === 'SHIFT' && c.shift) {
    const color = c.shift.colorCode || '#1373E5';
    return { text: c.shift.shortCode || c.shift.name.slice(0, 3).toUpperCase(), bg: c.isDefault ? '#FFFFFF' : color + '22', fg: color, dashed: c.isDefault };
  }
  return { text: '—', bg: '#FFFFFF', fg: '#CBD5E1' };
}

export default function ShiftRosterScreen() {
  const role = useAuthStore((s) => s.user?.role) || '';
  const canApproveOnsite = ['SUPERADMIN', 'ADMIN', 'HR'].includes(role);
  const [weekStart, setWeekStart] = useState(() => monday(new Date()));
  const [grid, setGrid] = useState<{ days: string[]; shifts: Shift[]; rows: Row[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [denied, setDenied] = useState(false);
  const [query, setQuery] = useState('');
  const [dept, setDept] = useState('');
  const [tab, setTab] = useState<'roster' | 'onsite'>('roster');
  const [pending, setPending] = useState<any[]>([]);
  const [projects, setProjects] = useState<{ id: number; name: string }[]>([]);

  // Single-cell editor
  const [edit, setEdit] = useState<{ row: Row; cell: Cell } | null>(null);
  const [onsite, setOnsite] = useState<{ shiftId: number; projectId: number | null; address: string } | null>(null);

  // Bulk assign
  const [bulk, setBulk] = useState<null | { ids: Set<number>; start: string; end: string; shiftId: number | null; dayOff: boolean; skip: boolean; overwrite: boolean }>(null);

  const load = useCallback(async () => {
    const start = ymd(weekStart);
    const end = ymd(addDays(weekStart, 6));
    try {
      const { data } = await apiClient.get('/shifts/roster', { params: { start, end } });
      setGrid(data);
      setDenied(false);
      apiClient.get('/shifts/roster/onsite/pending').then((r) => setPending(r.data || [])).catch(() => setPending([]));
    } catch (e: any) {
      if (e?.response?.status === 403) setDenied(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [weekStart]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const departments = useMemo(() => [...new Set((grid?.rows || []).map((r) => r.employee.department).filter(Boolean))].sort() as string[], [grid]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (grid?.rows || []).filter((r) =>
      r.employee.isActive !== false && (!dept || r.employee.department === dept) &&
      (!q || `${r.employee.name} ${r.employee.employeeCode || ''} ${r.employee.designation || ''}`.toLowerCase().includes(q)));
  }, [grid, query, dept]);

  // How many people work each day this week (for the header).
  const staffing = useMemo(() => (grid?.days || []).map((d, i) => rows.filter((r) => r.cells[i]?.type === 'SHIFT').length), [grid, rows]);

  const ensureProjects = async () => {
    if (projects.length) return;
    const { data } = await apiClient.get('/projects').catch(() => ({ data: [] }));
    setProjects((Array.isArray(data) ? data : data?.items || []).map((p: any) => ({ id: p.id, name: p.name })));
  };

  const assign = async (payload: any) => {
    try {
      await apiClient.post('/shifts/roster', payload);
      setEdit(null);
      setOnsite(null);
      load();
    } catch (e) { Alert.alert('Could not save', errMsg(e)); }
  };

  const chooseShift = (s: Shift) => {
    if (!edit) return;
    if (isOnsite(s)) { ensureProjects(); setOnsite({ shiftId: s.id, projectId: null, address: '' }); return; }
    assign({ employeeId: edit.row.employee.id, date: edit.cell.date, shiftId: s.id });
  };

  const saveOnsite = () => {
    if (!edit || !onsite) return;
    assign({
      employeeId: edit.row.employee.id, date: edit.cell.date, shiftId: onsite.shiftId,
      projectId: onsite.projectId, address: onsite.address.trim() || null,
      // "No project" goes to Admin + HR for approval, as on the web.
      needsApproval: !onsite.projectId,
    });
  };

  const runBulk = async () => {
    if (!bulk || !bulk.ids.size || (!bulk.shiftId && !bulk.dayOff)) return;
    try {
      const { data } = await apiClient.post('/shifts/roster/bulk', {
        employeeIds: [...bulk.ids], start: bulk.start, end: bulk.end,
        shiftId: bulk.dayOff ? null : bulk.shiftId, isDayOff: bulk.dayOff,
        skipNonWorkingDays: bulk.skip, overwriteExisting: bulk.overwrite,
      });
      setBulk(null);
      Alert.alert('Roster updated', `${data?.written ?? 0} days set${data?.skipped ? `, ${data.skipped} skipped` : ''}.`);
      load();
    } catch (e) { Alert.alert('Could not assign', errMsg(e)); }
  };

  const copyLastMonth = () => {
    const d = weekStart;
    const label = d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    Alert.alert('Copy last month?', `Fills ${label} from the previous month's roster, weekday for weekday.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Copy', onPress: async () => {
        try {
          const { data } = await apiClient.post('/shifts/roster/copy-previous-month', { year: d.getFullYear(), month: d.getMonth() + 1 });
          Alert.alert('Copied', `${data?.created ?? 0} days for ${data?.people ?? 0} people.`);
          load();
        } catch (e) { Alert.alert('Could not copy', errMsg(e)); }
      } },
    ]);
  };

  const resolve = async (id: number, action: 'APPROVED' | 'REJECTED') => {
    try {
      await apiClient.post(`/shifts/roster/onsite/${id}/resolve`, { action });
      setPending((p) => p.filter((x) => x.id !== id));
      load();
    } catch (e) { Alert.alert('Could not save', errMsg(e)); }
  };

  if (denied) {
    return (
      <AppScreen showBack title="Shift Roster">
        <Text style={styles.empty}>The shift roster is for managers, HR and administrators.</Text>
      </AppScreen>
    );
  }

  const weekLabel = `${weekStart.getDate()} – ${addDays(weekStart, 6).getDate()} ${addDays(weekStart, 6).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`;
  const today = ymd(new Date());

  const header = (
    <View style={{ gap: 10, marginBottom: 6 }}>
      <View style={styles.tabs}>
        <TouchableOpacity style={[styles.tab, tab === 'roster' && styles.tabOn]} onPress={() => setTab('roster')}>
          <Text style={[styles.tabText, tab === 'roster' && styles.tabTextOn]}>Roster</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, tab === 'onsite' && styles.tabOn]} onPress={() => setTab('onsite')}>
          <Text style={[styles.tabText, tab === 'onsite' && styles.tabTextOn]}>On-site requests {pending.length}</Text>
        </TouchableOpacity>
      </View>
      {tab === 'roster' && (
        <>
          <View style={styles.weekBar}>
            <TouchableOpacity style={styles.navBtn} onPress={() => setWeekStart((w) => addDays(w, -7))}><ChevronLeft size={18} color="#334155" /></TouchableOpacity>
            <TouchableOpacity style={{ flex: 1, alignItems: 'center' }} onPress={() => setWeekStart(monday(new Date()))}>
              <Text style={styles.weekText}>{weekLabel}</Text>
              <Text style={styles.sub}>Tap for this week</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.navBtn} onPress={() => setWeekStart((w) => addDays(w, 7))}><ChevronRight size={18} color="#334155" /></TouchableOpacity>
          </View>
          <View style={styles.search}>
            <Search size={16} color="#94A3B8" />
            <TextInput style={styles.searchInput} value={query} onChangeText={setQuery} placeholder="Search person" placeholderTextColor="#94A3B8" autoCorrect={false} clearButtonMode="while-editing" />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {['', ...departments].map((d) => (
              <TouchableOpacity key={d || 'all'} style={[styles.chip, dept === d && styles.chipOn]} onPress={() => setDept(d)}>
                <Text style={[styles.chipText, dept === d && styles.chipTextOn]}>{d || 'All departments'}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <View style={styles.actions}>
            <TouchableOpacity style={styles.action} onPress={() => setBulk({ ids: new Set(), start: ymd(weekStart), end: ymd(addDays(weekStart, 6)), shiftId: grid?.shifts[0]?.id ?? null, dayOff: false, skip: true, overwrite: false })}>
              <Users size={14} color="#1373E5" /><Text style={styles.actionText}>Bulk assign</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.action} onPress={copyLastMonth}>
              <Copy size={14} color="#1373E5" /><Text style={styles.actionText}>Copy last month</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.dayHead}>
            <View style={{ flex: 1 }} />
            {(grid?.days || []).map((d, i) => (
              <View key={d} style={styles.dayCol}>
                <Text style={[styles.dayName, d === today && styles.todayText]}>{dayLabel(d)}</Text>
                <Text style={[styles.dayNum, d === today && styles.todayText]}>{dayNum(d)}</Text>
                <Text style={styles.staff}>{staffing[i]}</Text>
              </View>
            ))}
          </View>
        </>
      )}
    </View>
  );

  return (
    <AppScreen showBack title="Shift Roster" subtitle={`${rows.length} people${pending.length ? ` · ${pending.length} on-site pending` : ''}`}>
      {loading ? <ActivityIndicator style={{ marginTop: 40 }} color={theme.colors.primary} /> : tab === 'roster' ? (
        <FlatList
          data={rows}
          keyExtractor={(r) => String(r.employee.id)}
          ListHeaderComponent={header}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListEmptyComponent={<Text style={styles.empty}>No one matches.</Text>}
          renderItem={({ item: r }) => {
            const person = { id: r.employee.id, ...nameParts(r.employee.name), avatarUrl: r.employee.avatarUrl };
            return (
              <View style={styles.row}>
                <PersonTap person={person} style={styles.who}>
                  <Avatar person={person} size={28} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name} numberOfLines={1}>{r.employee.name}</Text>
                    <Text style={styles.tiny} numberOfLines={1}>{r.defaultShift?.name || 'No standing shift'}</Text>
                  </View>
                </PersonTap>
                {r.cells.map((c) => {
                  const look = cellLook(c);
                  return (
                    <TouchableOpacity
                      key={c.date}
                      style={[styles.cell, { backgroundColor: look.bg, borderColor: look.dashed ? '#E2E8F0' : look.bg }, look.dashed && styles.dashed, c.date === today && styles.todayCell]}
                      onPress={() => setEdit({ row: r, cell: c })}
                    >
                      <Text style={[styles.cellText, { color: look.fg }]} numberOfLines={1}>{look.text}</Text>
                      {(c.onSite || c.isFieldVisit) && <View style={[styles.siteDot, c.onSite?.approvalStatus === 'PENDING' && { backgroundColor: '#F59E0B' }]} />}
                    </TouchableOpacity>
                  );
                })}
              </View>
            );
          }}
        />
      ) : (
        <FlatList
          data={pending}
          keyExtractor={(p) => String(p.id)}
          ListHeaderComponent={header}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.empty}>No on-site requests waiting.</Text>}
          renderItem={({ item: p }) => (
            <View style={styles.card}>
              <View style={styles.who}>
                <Avatar person={p.employee} size={36} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{`${p.employee?.firstName || ''} ${p.employee?.lastName || ''}`.trim()}</Text>
                  <Text style={styles.sub}>{String(p.date).slice(0, 10)} · {p.shift?.name || 'Shift'}</Text>
                </View>
              </View>
              <Text style={styles.line}><MapPin size={12} color="#64748B" /> {p.project?.name || 'No project'}{p.address ? ` · ${p.address}` : ''}</Text>
              {!!p.note && <Text style={styles.sub}>{p.note}</Text>}
              {canApproveOnsite ? (
                <View style={styles.actions}>
                  <TouchableOpacity style={[styles.btn, styles.reject]} onPress={() => resolve(p.id, 'REJECTED')}><Text style={styles.rejectText}>Reject</Text></TouchableOpacity>
                  <TouchableOpacity style={[styles.btn, styles.approve]} onPress={() => resolve(p.id, 'APPROVED')}><Text style={styles.approveText}>Approve</Text></TouchableOpacity>
                </View>
              ) : <Text style={styles.tiny}>Waiting for Admin or HR.</Text>}
            </View>
          )}
        />
      )}

      {/* Cell editor */}
      <Modal visible={!!edit} transparent animationType="slide" onRequestClose={() => { setEdit(null); setOnsite(null); }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.bottom}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetTitle}>{edit?.row.employee.name}</Text>
                <Text style={styles.sub}>
                  {edit ? new Date(`${edit.cell.date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'short' }) : ''}
                  {edit?.cell.type === 'LEAVE' ? ` · On leave${edit.cell.label ? ` (${edit.cell.label})` : ''}` : ''}
                </Text>
              </View>
              <TouchableOpacity onPress={() => { setEdit(null); setOnsite(null); }}><X size={20} color="#334155" /></TouchableOpacity>
            </View>
            {onsite ? (
              <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }} keyboardShouldPersistTaps="handled">
                <Text style={styles.section}>ON-SITE DETAILS</Text>
                <ScrollView style={{ maxHeight: 220 }}>
                  {[{ id: 0, name: 'No project (needs Admin / HR approval)' }, ...projects].map((p) => {
                    const on = (onsite.projectId ?? 0) === p.id;
                    return (
                      <TouchableOpacity key={p.id} style={styles.option} onPress={() => setOnsite((o) => (o ? { ...o, projectId: p.id || null } : o))}>
                        <Text style={[styles.optionText, on && styles.optionOn]} numberOfLines={1}>{p.name}</Text>
                        {on && <Check size={16} color="#1373E5" />}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
                <TextInput style={styles.input} value={onsite.address} onChangeText={(v) => setOnsite((o) => (o ? { ...o, address: v } : o))} placeholder="Site address" placeholderTextColor="#94A3B8" />
                <TouchableOpacity style={styles.submit} onPress={saveOnsite}><Text style={styles.approveText}>Save on-site shift</Text></TouchableOpacity>
              </ScrollView>
            ) : (
              <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
                {(grid?.shifts || []).map((s) => {
                  const on = edit?.cell.type === 'SHIFT' && edit.cell.shift?.id === s.id && !edit.cell.isDefault;
                  return (
                    <TouchableOpacity key={s.id} style={[styles.shiftOpt, on && { borderColor: s.colorCode || '#1373E5' }]} onPress={() => chooseShift(s)}>
                      <View style={[styles.swatch, { backgroundColor: s.colorCode || '#1373E5' }]} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.name}>{s.name}{isOnsite(s) ? '  · on site' : ''}</Text>
                        {!!s.startTime && <Text style={styles.sub}>{s.startTime}–{s.endTime}</Text>}
                      </View>
                      {on && <Check size={16} color="#1373E5" />}
                    </TouchableOpacity>
                  );
                })}
                <TouchableOpacity style={styles.shiftOpt} onPress={() => edit && assign({ employeeId: edit.row.employee.id, date: edit.cell.date, isDayOff: true })}>
                  <View style={[styles.swatch, { backgroundColor: '#94A3B8' }]} />
                  <Text style={[styles.name, { flex: 1 }]}>Day off</Text>
                  {edit?.cell.type === 'DAY_OFF' && <Check size={16} color="#1373E5" />}
                </TouchableOpacity>
                <TouchableOpacity style={styles.clearBtn} onPress={() => edit && assign({ employeeId: edit.row.employee.id, date: edit.cell.date })}>
                  <Text style={styles.clearText}>Clear (use {edit?.row.defaultShift?.name || 'standing shift'})</Text>
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Bulk assign */}
      <Modal visible={!!bulk} transparent animationType="slide" onRequestClose={() => setBulk(null)}>
        <View style={styles.bottom}>
          <View style={[styles.sheet, { maxHeight: '92%' }]}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>Bulk assign</Text>
              <TouchableOpacity onPress={() => setBulk(null)}><X size={20} color="#334155" /></TouchableOpacity>
            </View>
            {bulk && (
              <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }} keyboardShouldPersistTaps="handled">
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TextInput style={[styles.input, { flex: 1 }]} value={bulk.start} onChangeText={(v) => setBulk((b) => (b ? { ...b, start: v } : b))} placeholder="From YYYY-MM-DD" placeholderTextColor="#94A3B8" autoCapitalize="none" />
                  <TextInput style={[styles.input, { flex: 1 }]} value={bulk.end} onChangeText={(v) => setBulk((b) => (b ? { ...b, end: v } : b))} placeholder="To YYYY-MM-DD" placeholderTextColor="#94A3B8" autoCapitalize="none" />
                </View>
                <Text style={styles.section}>ASSIGN</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {(grid?.shifts || []).filter((s) => !isOnsite(s)).map((s) => {
                    const on = !bulk.dayOff && bulk.shiftId === s.id;
                    return (
                      <TouchableOpacity key={s.id} style={[styles.chip, on && styles.chipOn]} onPress={() => setBulk((b) => (b ? { ...b, shiftId: s.id, dayOff: false } : b))}>
                        <Text style={[styles.chipText, on && styles.chipTextOn]}>{s.name}</Text>
                      </TouchableOpacity>
                    );
                  })}
                  <TouchableOpacity style={[styles.chip, bulk.dayOff && styles.chipOn]} onPress={() => setBulk((b) => (b ? { ...b, dayOff: true } : b))}>
                    <Text style={[styles.chipText, bulk.dayOff && styles.chipTextOn]}>Day off</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.switchRow}><Text style={[styles.line, { flex: 1 }]}>Skip weekly offs and holidays</Text><Switch value={bulk.skip} onValueChange={(v) => setBulk((b) => (b ? { ...b, skip: v } : b))} /></View>
                <View style={styles.switchRow}><Text style={[styles.line, { flex: 1 }]}>Overwrite days already set</Text><Switch value={bulk.overwrite} onValueChange={(v) => setBulk((b) => (b ? { ...b, overwrite: v } : b))} /></View>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={[styles.section, { flex: 1 }]}>PEOPLE · {bulk.ids.size}</Text>
                  <TouchableOpacity onPress={() => setBulk((b) => (b ? { ...b, ids: b.ids.size === rows.length ? new Set() : new Set(rows.map((r) => r.employee.id)) } : b))}>
                    <Text style={styles.actionText}>{bulk.ids.size === rows.length ? 'None' : `All shown (${rows.length})`}</Text>
                  </TouchableOpacity>
                </View>
                {rows.map((r) => {
                  const on = bulk.ids.has(r.employee.id);
                  return (
                    <TouchableOpacity key={r.employee.id} style={styles.option} onPress={() => setBulk((b) => { if (!b) return b; const ids = new Set(b.ids); on ? ids.delete(r.employee.id) : ids.add(r.employee.id); return { ...b, ids }; })}>
                      <Text style={[styles.optionText, on && styles.optionOn]} numberOfLines={1}>{r.employee.name}</Text>
                      <Text style={styles.tiny}>{r.employee.department}</Text>
                      {on && <Check size={16} color="#1373E5" />}
                    </TouchableOpacity>
                  );
                })}
                <TouchableOpacity style={[styles.submit, (!bulk.ids.size || (!bulk.shiftId && !bulk.dayOff)) && { opacity: 0.5 }]} disabled={!bulk.ids.size || (!bulk.shiftId && !bulk.dayOff)} onPress={runBulk}>
                  <Text style={styles.approveText}>Assign to {bulk.ids.size} {bulk.ids.size === 1 ? 'person' : 'people'}</Text>
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
      <PersonSheetHost />
    </AppScreen>
  );
}

const CELL = 34;
const styles = StyleSheet.create({
  list: { padding: 12, paddingBottom: 120, gap: 6 },
  tabs: { flexDirection: 'row', backgroundColor: '#F1F5F9', borderRadius: 12, padding: 3, gap: 3 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 9 },
  tabOn: { backgroundColor: '#fff' },
  tabText: { fontSize: 13, fontWeight: '700', color: '#64748B' },
  tabTextOn: { color: '#0F172A' },
  weekBar: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', padding: 8 },
  navBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#F8FAFC', alignItems: 'center', justifyContent: 'center' },
  weekText: { fontSize: 15, fontWeight: '800', color: '#0F172A' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, paddingHorizontal: 12, height: 40 },
  searchInput: { flex: 1, fontSize: 14, color: '#0F172A', paddingVertical: 0 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0' },
  chipOn: { backgroundColor: '#1373E5', borderColor: '#1373E5' },
  chipText: { fontSize: 12, fontWeight: '700', color: '#475569' },
  chipTextOn: { color: '#fff' },
  actions: { flexDirection: 'row', gap: 8 },
  action: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 36, borderRadius: 10, backgroundColor: '#EFF6FF' },
  actionText: { fontSize: 12, fontWeight: '700', color: '#1373E5' },
  dayHead: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, paddingTop: 4 },
  dayCol: { width: CELL, alignItems: 'center' },
  dayName: { fontSize: 10, fontWeight: '700', color: '#64748B' },
  dayNum: { fontSize: 13, fontWeight: '800', color: '#0F172A' },
  staff: { fontSize: 9, color: '#94A3B8' },
  todayText: { color: '#1373E5' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', padding: 6 },
  who: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  name: { fontSize: 13, fontWeight: '800', color: '#0F172A' },
  tiny: { fontSize: 10, color: '#94A3B8' },
  sub: { fontSize: 12, color: '#64748B' },
  line: { fontSize: 13, color: '#334155' },
  cell: { width: CELL, height: CELL, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  dashed: { borderStyle: 'dashed' },
  todayCell: { borderColor: '#1373E5', borderWidth: 1.5 },
  cellText: { fontSize: 9, fontWeight: '800' },
  siteDot: { position: 'absolute', top: 2, right: 2, width: 5, height: 5, borderRadius: 3, backgroundColor: '#0D9488' },
  empty: { textAlign: 'center', color: theme.colors.textSecondary, marginTop: 30, paddingHorizontal: 24 },
  card: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', padding: 12, gap: 6 },
  btn: { flex: 1, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  reject: { backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA' },
  rejectText: { color: '#B91C1C', fontWeight: '800' },
  approve: { backgroundColor: '#16A34A' },
  approveText: { color: '#fff', fontWeight: '800' },
  bottom: { flex: 1, backgroundColor: 'rgba(15,23,42,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: '80%', paddingBottom: 30 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  sheetTitle: { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  section: { fontSize: 11, fontWeight: '800', color: '#64748B', letterSpacing: 0.6 },
  shiftOpt: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, borderWidth: 1.5, borderColor: '#E2E8F0' },
  swatch: { width: 14, height: 14, borderRadius: 7 },
  clearBtn: { height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F1F5F9' },
  clearText: { fontWeight: '700', color: '#334155' },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  optionText: { flex: 1, fontSize: 14, color: '#0F172A' },
  optionOn: { fontWeight: '800', color: '#1373E5' },
  input: { borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, color: '#0F172A', backgroundColor: '#F8FAFC' },
  submit: { height: 48, borderRadius: 12, backgroundColor: '#1373E5', alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
