import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl, TextInput, Modal, ScrollView,
  Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { X, Plus, Star, CheckCircle2, Circle, Search } from 'lucide-react-native';
import AppScreen from '../../components/AppScreen';
import { apiClient } from '../../api/apiClient';
import { Avatar } from '../../components/PersonSheet';
import { useAuthStore } from '../../store/authStore';
import { theme } from '../../theme/theme';

/**
 * Offboarding, as on the web. Resignations: employees resign and follow their
 * own; managers decide for their team, HR and admins for everyone. Clearance:
 * the exit checklist (IT, finance, HR…) for HR, admins and finance. Exit
 * interviews: HR and admins. The server enforces the same split.
 */
type Tab = 'RESIGNATIONS' | 'CLEARANCE' | 'EXIT';
const TONE: Record<string, { bg: string; text: string }> = {
  PENDING: { bg: '#FEF3C7', text: '#B45309' }, APPROVED: { bg: '#DCFCE7', text: '#15803D' },
  REJECTED: { bg: '#FEE2E2', text: '#B91C1C' }, WITHDRAWN: { bg: '#F1F5F9', text: '#64748B' },
  IN_PROGRESS: { bg: '#DBEAFE', text: '#1D4ED8' }, CLEARED: { bg: '#DCFCE7', text: '#15803D' },
};
const pretty = (v?: string) => String(v || '').replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
const date = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const ymd = (d?: string | null) => (d ? String(d).slice(0, 10) : '');
const fullName = (e: any) => (e ? `${e.firstName || ''} ${e.lastName || ''}`.trim() : 'Employee');
const errMsg = (e: any) => { const m = e?.response?.data?.message; return Array.isArray(m) ? m.join('\n') : m || 'Please try again.'; };
const daysTo = (d?: string | null) => (d ? Math.ceil((new Date(d).getTime() - Date.now()) / 86_400_000) : null);

export default function OffboardingScreen() {
  const user = useAuthStore((s) => s.user);
  const role = String(user?.role || '').toUpperCase();
  const isHr = ['SUPERADMIN', 'ADMIN', 'HR'].includes(role);
  const canDecide = isHr || role === 'MANAGER';
  const canClear = isHr || role === 'FINANCE';
  const [tab, setTab] = useState<Tab>('RESIGNATIONS');
  const [resignations, setResignations] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [interviews, setInterviews] = useState<any[]>([]);
  const [people, setPeople] = useState<Map<number, any>>(new Map());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');

  const [resign, setResign] = useState<{ reason: string; lastDay: string } | null>(null);
  const [decide, setDecide] = useState<{ r: any; status: 'APPROVED' | 'REJECTED'; lastDay: string; remarks: string } | null>(null);
  const [clear, setClear] = useState<{ t: any; remarks: string } | null>(null);
  const [exit, setExit] = useState<{ employeeId?: number; rating: number; feedback: string } | null>(null);

  const load = useCallback(async () => {
    const get = (url: string) => apiClient.get(url).then((r) => r.data || []).catch(() => []);
    const [r, t, x, p] = await Promise.all([
      get('/offboarding/resignations'),
      canClear ? get('/offboarding/tasks') : Promise.resolve([]),
      isHr ? get('/offboarding/exit-interviews') : Promise.resolve([]),
      get('/employees/basic-list'),
    ]);
    setResignations(r);
    setTasks(t);
    setInterviews(x);
    // Leavers may be deactivated and missing from the directory, so names
    // that come with the resignation, task or interview fill the gaps.
    const map = new Map<number, any>((p as any[]).map((e) => [e.id, e]));
    for (const row of [...r, ...t, ...x] as any[]) {
      const e = row.employee;
      if (e?.id && e.firstName && !map.has(e.id)) map.set(e.id, e);
    }
    setPeople(map);
    setLoading(false);
    setRefreshing(false);
  }, [canClear, isHr]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const person = (r: any) => people.get(r.employeeId ?? r.employee?.id) || r.employee;
  const mine = resignations.find((r) => (r.employeeId ?? r.employee?.id) === user?.employeeId && ['PENDING', 'APPROVED', 'IN_PROGRESS'].includes(r.status));
  const q = query.trim().toLowerCase();
  const matchesQ = (e: any) => !q || `${fullName(e)} ${e?.employeeCode || ''}`.toLowerCase().includes(q);

  const shownResignations = useMemo(() => resignations.filter((r) => (!status || r.status === status) && matchesQ(person(r))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resignations, status, q, people]);

  // Clearance grouped by leaver: one card per person with their checklist.
  const taskGroups = useMemo(() => {
    const m = new Map<number, any[]>();
    for (const t of tasks) m.set(t.employeeId, [...(m.get(t.employeeId) || []), t]);
    return [...m.entries()].map(([id, list]) => ({ id, e: people.get(id), list, open: list.filter((t) => t.status !== 'CLEARED').length }))
      .filter((g) => matchesQ(g.e) && (!status || (status === 'OPEN' ? g.open > 0 : g.open === 0)))
      .sort((a, b) => b.open - a.open);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, people, q, status]);

  const leavers = useMemo(() => resignations.filter((r) => r.status === 'APPROVED' || r.status === 'IN_PROGRESS'), [resignations]);

  const submitResign = async () => {
    if (!resign?.reason.trim() || !resign.lastDay) return;
    try {
      await apiClient.post('/offboarding/resign', { reason: resign.reason.trim(), intendedLastWorkingDay: resign.lastDay });
      setResign(null);
      load();
    } catch (e) { Alert.alert('Could not submit', errMsg(e)); }
  };

  const submitDecision = async () => {
    if (!decide) return;
    try {
      await apiClient.put(`/offboarding/resignations/${decide.r.id}/status`, {
        status: decide.status, approvedLastWorkingDay: decide.status === 'APPROVED' ? decide.lastDay : undefined, remarks: decide.remarks.trim() || undefined,
      });
      setDecide(null);
      load();
    } catch (e) { Alert.alert('Could not save', errMsg(e)); }
  };

  const submitClear = async () => {
    if (!clear) return;
    try {
      await apiClient.put(`/offboarding/tasks/${clear.t.id}/complete`, { remarks: clear.remarks.trim() || undefined });
      setClear(null);
      load();
    } catch (e) { Alert.alert('Could not clear', errMsg(e)); }
  };

  const submitExit = async () => {
    if (!exit?.employeeId || !exit.rating || !exit.feedback.trim()) return;
    try {
      await apiClient.post('/offboarding/exit-interview', { employeeId: exit.employeeId, rating: exit.rating, feedback: exit.feedback.trim() });
      setExit(null);
      load();
    } catch (e) { Alert.alert('Could not save', errMsg(e)); }
  };

  const tabs: { key: Tab; label: string; n: number }[] = [
    { key: 'RESIGNATIONS', label: 'Resignations', n: resignations.filter((r) => r.status === 'PENDING').length },
    ...(canClear ? [{ key: 'CLEARANCE' as Tab, label: 'Clearance', n: tasks.filter((t) => t.status !== 'CLEARED').length }] : []),
    ...(isHr ? [{ key: 'EXIT' as Tab, label: 'Exit interviews', n: interviews.length }] : []),
  ];
  const statusChips = tab === 'RESIGNATIONS'
    ? [['', 'All'], ['PENDING', 'Pending'], ['APPROVED', 'Approved'], ['REJECTED', 'Rejected'], ['WITHDRAWN', 'Withdrawn']]
    : tab === 'CLEARANCE' ? [['', 'All'], ['OPEN', 'Open'], ['DONE', 'All cleared']] : [];

  const header = (
    <View style={{ gap: 10, marginBottom: 6 }}>
      {tabs.length > 1 && (
        <View style={styles.tabs}>
          {tabs.map((t) => (
            <TouchableOpacity key={t.key} style={[styles.tab, tab === t.key && styles.tabOn]} onPress={() => { setTab(t.key); setStatus(''); }}>
              <Text style={[styles.tabText, tab === t.key && styles.tabTextOn]}>{t.label}{t.n ? ` ${t.n}` : ''}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      {mine && tab === 'RESIGNATIONS' && (
        <View style={styles.mine}>
          <Text style={styles.name}>Your resignation is {pretty(mine.status).toLowerCase()}</Text>
          <Text style={styles.sub}>
            Last working day {date(mine.approvedLastWorkingDay || mine.intendedLastWorkingDay)}
            {daysTo(mine.approvedLastWorkingDay || mine.intendedLastWorkingDay) !== null ? ` · ${Math.max(0, daysTo(mine.approvedLastWorkingDay || mine.intendedLastWorkingDay)!)} days left` : ''}
          </Text>
        </View>
      )}
      {(canDecide || canClear) && (
        <View style={styles.search}>
          <Search size={16} color="#94A3B8" />
          <TextInput style={styles.searchInput} value={query} onChangeText={setQuery} placeholder="Search name or #code" placeholderTextColor="#94A3B8" autoCorrect={false} clearButtonMode="while-editing" />
        </View>
      )}
      {statusChips.length > 0 && (canDecide || canClear) && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {statusChips.map(([k, l]) => (
            <TouchableOpacity key={k || 'all'} style={[styles.chip, status === k && styles.chipOn]} onPress={() => setStatus(k)}>
              <Text style={[styles.chipText, status === k && styles.chipTextOn]}>{l}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );

  const right = tab === 'RESIGNATIONS' && user?.employeeId && !mine ? (
    <TouchableOpacity style={styles.dangerBtn} onPress={() => setResign({ reason: '', lastDay: '' })}><Text style={styles.dangerBtnText}>Resign</Text></TouchableOpacity>
  ) : tab === 'EXIT' ? (
    <TouchableOpacity style={styles.primaryBtn} onPress={() => setExit({ rating: 0, feedback: '' })}><Plus size={15} color="#fff" /><Text style={styles.primaryText}>Add</Text></TouchableOpacity>
  ) : undefined;

  return (
    <AppScreen showBack title="Offboarding" subtitle={canDecide ? `${resignations.filter((r) => r.status === 'PENDING').length} pending · ${leavers.length} leaving` : 'Your resignation'} right={right}>
      {loading ? <ActivityIndicator style={{ marginTop: 40 }} color={theme.colors.primary} /> : tab === 'RESIGNATIONS' ? (
        <FlatList
          data={shownResignations}
          keyExtractor={(r) => String(r.id)}
          ListHeaderComponent={header}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListEmptyComponent={<Text style={styles.empty}>{canDecide ? 'No resignations.' : 'You have not resigned.'}</Text>}
          renderItem={({ item: r }) => {
            const e = person(r);
            const tone = TONE[r.status] || TONE.PENDING;
            const left = daysTo(r.approvedLastWorkingDay || r.intendedLastWorkingDay);
            const isOwn = (r.employeeId ?? r.employee?.id) === user?.employeeId;
            return (
              <View style={styles.card}>
                <View style={styles.cardTop}>
                  <Avatar person={e} size={40} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name} numberOfLines={1}>{fullName(e)}{isOwn ? ' (you)' : ''}</Text>
                    <Text style={styles.sub} numberOfLines={1}>{[e?.designation?.name, e?.employeeCode && `#${e.employeeCode}`].filter(Boolean).join(' · ')}</Text>
                  </View>
                  <Text style={[styles.pill, { backgroundColor: tone.bg, color: tone.text }]}>{pretty(r.status)}</Text>
                </View>
                <Text style={styles.reason} numberOfLines={4}>{r.reason}</Text>
                <Text style={styles.sub}>
                  Asked for {date(r.intendedLastWorkingDay)}
                  {r.approvedLastWorkingDay ? ` · approved ${date(r.approvedLastWorkingDay)}` : ''}
                  {left !== null && r.status === 'APPROVED' ? ` · ${left < 0 ? 'left' : `${left} days left`}` : ''}
                </Text>
                {!!r.remarks && <Text style={styles.tiny}>Note: {r.remarks}</Text>}
                {canDecide && !isOwn && r.status === 'PENDING' && (
                  <View style={styles.actions}>
                    <TouchableOpacity style={[styles.btn, styles.reject]} onPress={() => setDecide({ r, status: 'REJECTED', lastDay: '', remarks: '' })}><Text style={styles.rejectText}>Reject</Text></TouchableOpacity>
                    <TouchableOpacity style={[styles.btn, styles.approve]} onPress={() => setDecide({ r, status: 'APPROVED', lastDay: ymd(r.intendedLastWorkingDay), remarks: '' })}><Text style={styles.primaryText}>Approve</Text></TouchableOpacity>
                  </View>
                )}
              </View>
            );
          }}
        />
      ) : tab === 'CLEARANCE' ? (
        <FlatList
          data={taskGroups}
          keyExtractor={(g) => String(g.id)}
          ListHeaderComponent={header}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListEmptyComponent={<Text style={styles.empty}>No clearance tasks.</Text>}
          renderItem={({ item: g }) => (
            <View style={styles.card}>
              <View style={styles.cardTop}>
                <Avatar person={g.e} size={36} />
                <Text style={[styles.name, { flex: 1 }]} numberOfLines={1}>{fullName(g.e)}</Text>
                <Text style={[styles.pill, g.open ? { backgroundColor: '#FEF3C7', color: '#B45309' } : { backgroundColor: '#DCFCE7', color: '#15803D' }]}>
                  {g.open ? `${g.open} open` : 'All cleared'}
                </Text>
              </View>
              {g.list.map((t) => {
                const done = t.status === 'CLEARED';
                return (
                  <TouchableOpacity key={t.id} style={styles.task} disabled={done} onPress={() => setClear({ t, remarks: '' })}>
                    {done ? <CheckCircle2 size={18} color="#16A34A" /> : <Circle size={18} color="#94A3B8" />}
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.taskName, done && styles.taskDone]}>{t.taskName}</Text>
                      <Text style={styles.tiny}>{t.department}{done && t.clearedBy?.email ? ` · cleared by ${t.clearedBy.email}` : ''}{t.remarks ? ` · ${t.remarks}` : ''}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        />
      ) : (
        <FlatList
          data={interviews.filter((x) => matchesQ(people.get(x.employeeId)))}
          keyExtractor={(x) => String(x.id)}
          ListHeaderComponent={header}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListEmptyComponent={<Text style={styles.empty}>No exit interviews yet.</Text>}
          renderItem={({ item: x }) => (
            <View style={styles.card}>
              <View style={styles.cardTop}>
                <Avatar person={people.get(x.employeeId)} size={36} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name} numberOfLines={1}>{fullName(people.get(x.employeeId))}</Text>
                  <Text style={styles.tiny}>{date(x.completedAt || x.createdAt)}{x.interviewer?.email ? ` · by ${x.interviewer.email}` : ''}</Text>
                </View>
                <Text style={styles.stars}>{'★'.repeat(x.rating || 0)}{'☆'.repeat(Math.max(0, 5 - (x.rating || 0)))}</Text>
              </View>
              <Text style={styles.reason}>{x.feedback}</Text>
            </View>
          )}
        />
      )}

      {/* Resign */}
      <Modal visible={!!resign} transparent animationType="slide" onRequestClose={() => setResign(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.bottom}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}><Text style={[styles.sheetTitle, { flex: 1 }]}>Submit resignation</Text><TouchableOpacity onPress={() => setResign(null)}><X size={20} color="#334155" /></TouchableOpacity></View>
            {resign && (
              <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }} keyboardShouldPersistTaps="handled">
                <Text style={styles.label}>Last working day you are asking for (YYYY-MM-DD)</Text>
                <TextInput style={styles.input} value={resign.lastDay} onChangeText={(v) => setResign((x) => (x ? { ...x, lastDay: v } : x))} placeholder="2026-12-31" placeholderTextColor="#94A3B8" autoCapitalize="none" />
                <Text style={styles.label}>Reason</Text>
                <TextInput style={[styles.input, { minHeight: 110, textAlignVertical: 'top' }]} value={resign.reason} onChangeText={(v) => setResign((x) => (x ? { ...x, reason: v } : x))} multiline placeholder="Why you are leaving" placeholderTextColor="#94A3B8" />
                <Text style={styles.tiny}>Your manager and HR are notified. They confirm the final last working day.</Text>
                <TouchableOpacity style={[styles.submitDanger, (!resign.reason.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(resign.lastDay)) && { opacity: 0.5 }]}
                  disabled={!resign.reason.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(resign.lastDay)}
                  onPress={() => Alert.alert('Submit resignation?', 'This starts your offboarding.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Submit', style: 'destructive', onPress: submitResign }])}>
                  <Text style={styles.primaryText}>Submit resignation</Text>
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Approve / reject */}
      <Modal visible={!!decide} transparent animationType="fade" onRequestClose={() => setDecide(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.center}>
          <View style={styles.dialog}>
            <Text style={styles.sheetTitle}>{decide?.status === 'APPROVED' ? 'Approve' : 'Reject'} · {fullName(person(decide?.r || {}))}</Text>
            {decide?.status === 'APPROVED' && (
              <>
                <Text style={styles.label}>Final last working day (YYYY-MM-DD)</Text>
                <TextInput style={styles.input} value={decide.lastDay} onChangeText={(v) => setDecide((d) => (d ? { ...d, lastDay: v } : d))} autoCapitalize="none" />
                <Text style={styles.tiny}>Approving creates the exit checklist (IT, finance, HR) for this person.</Text>
              </>
            )}
            <TextInput style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]} value={decide?.remarks} onChangeText={(v) => setDecide((d) => (d ? { ...d, remarks: v } : d))} placeholder={decide?.status === 'REJECTED' ? 'Reason' : 'Note (optional)'} placeholderTextColor="#94A3B8" multiline />
            <View style={styles.actions}>
              <TouchableOpacity style={[styles.btn, styles.secondary]} onPress={() => setDecide(null)}><Text style={styles.secondaryText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.btn, decide?.status === 'APPROVED' ? styles.approve : styles.rejectSolid, ((decide?.status === 'APPROVED' && !/^\d{4}-\d{2}-\d{2}$/.test(decide.lastDay)) || (decide?.status === 'REJECTED' && !decide.remarks.trim())) && { opacity: 0.5 }]}
                disabled={(decide?.status === 'APPROVED' && !/^\d{4}-\d{2}-\d{2}$/.test(decide.lastDay)) || (decide?.status === 'REJECTED' && !decide?.remarks.trim())}
                onPress={submitDecision}>
                <Text style={styles.primaryText}>{decide?.status === 'APPROVED' ? 'Approve' : 'Reject'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Clear a task */}
      <Modal visible={!!clear} transparent animationType="fade" onRequestClose={() => setClear(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.center}>
          <View style={styles.dialog}>
            <Text style={styles.sheetTitle}>Clear · {clear?.t.taskName}</Text>
            <Text style={styles.sub}>{clear?.t.department}{clear?.t.description ? ` · ${clear.t.description}` : ''}</Text>
            <TextInput style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]} value={clear?.remarks} onChangeText={(v) => setClear((c) => (c ? { ...c, remarks: v } : c))} placeholder="Remarks (optional), e.g. laptop returned" placeholderTextColor="#94A3B8" multiline />
            <View style={styles.actions}>
              <TouchableOpacity style={[styles.btn, styles.secondary]} onPress={() => setClear(null)}><Text style={styles.secondaryText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.btn, styles.approve]} onPress={submitClear}><Text style={styles.primaryText}>Mark cleared</Text></TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Exit interview */}
      <Modal visible={!!exit} transparent animationType="slide" onRequestClose={() => setExit(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.bottom}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}><Text style={[styles.sheetTitle, { flex: 1 }]}>Exit interview</Text><TouchableOpacity onPress={() => setExit(null)}><X size={20} color="#334155" /></TouchableOpacity></View>
            {exit && (
              <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }} keyboardShouldPersistTaps="handled">
                <Text style={styles.label}>Leaving employee</Text>
                {leavers.length ? leavers.map((r) => {
                  const id = r.employeeId ?? r.employee?.id;
                  const on = exit.employeeId === id;
                  return (
                    <TouchableOpacity key={r.id} style={[styles.pick, on && styles.pickOn]} onPress={() => setExit((x) => (x ? { ...x, employeeId: id } : x))}>
                      <Avatar person={person(r)} size={28} />
                      <Text style={[styles.name, { flex: 1, fontWeight: on ? '800' : '600' }]}>{fullName(person(r))}</Text>
                      <Text style={styles.tiny}>{date(r.approvedLastWorkingDay || r.intendedLastWorkingDay)}</Text>
                    </TouchableOpacity>
                  );
                }) : <Text style={styles.sub}>No approved resignations.</Text>}
                <Text style={styles.label}>Overall rating</Text>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <TouchableOpacity key={n} onPress={() => setExit((x) => (x ? { ...x, rating: n } : x))}>
                      <Star size={30} color="#F59E0B" fill={n <= exit.rating ? '#F59E0B' : 'transparent'} />
                    </TouchableOpacity>
                  ))}
                </View>
                <TextInput style={[styles.input, { minHeight: 110, textAlignVertical: 'top' }]} value={exit.feedback} onChangeText={(v) => setExit((x) => (x ? { ...x, feedback: v } : x))} multiline placeholder="What they said: reasons, suggestions" placeholderTextColor="#94A3B8" />
                <TouchableOpacity style={[styles.submit, (!exit.employeeId || !exit.rating || !exit.feedback.trim()) && { opacity: 0.5 }]} disabled={!exit.employeeId || !exit.rating || !exit.feedback.trim()} onPress={submitExit}>
                  <Text style={styles.primaryText}>Save</Text>
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, paddingBottom: 120, gap: 10 },
  tabs: { flexDirection: 'row', backgroundColor: '#F1F5F9', borderRadius: 12, padding: 3, gap: 3 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 9 },
  tabOn: { backgroundColor: '#fff' },
  tabText: { fontSize: 12, fontWeight: '700', color: '#64748B' },
  tabTextOn: { color: '#0F172A' },
  mine: { backgroundColor: '#FFF7ED', borderRadius: 14, borderWidth: 1, borderColor: '#FED7AA', padding: 12, gap: 2 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, paddingHorizontal: 12, height: 42 },
  searchInput: { flex: 1, fontSize: 14, color: '#0F172A', paddingVertical: 0 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0' },
  chipOn: { backgroundColor: '#1373E5', borderColor: '#1373E5' },
  chipText: { fontSize: 12, fontWeight: '700', color: '#475569' },
  chipTextOn: { color: '#fff' },
  card: { backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#E2E8F0', padding: 14, gap: 8 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { fontSize: 14, fontWeight: '800', color: '#0F172A' },
  sub: { fontSize: 12, color: '#64748B' },
  tiny: { fontSize: 11, color: '#94A3B8' },
  reason: { fontSize: 13, lineHeight: 19, color: '#334155' },
  pill: { fontSize: 11, fontWeight: '800', paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, overflow: 'hidden' },
  stars: { fontSize: 14, color: '#F59E0B' },
  task: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  taskName: { fontSize: 14, fontWeight: '600', color: '#0F172A' },
  taskDone: { color: '#94A3B8', textDecorationLine: 'line-through' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  btn: { flex: 1, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  reject: { backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA' },
  rejectText: { color: '#B91C1C', fontWeight: '800' },
  rejectSolid: { backgroundColor: '#DC2626' },
  approve: { backgroundColor: '#16A34A' },
  secondary: { backgroundColor: '#F1F5F9' },
  secondaryText: { color: '#334155', fontWeight: '700' },
  primaryText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, height: 38, borderRadius: 12, backgroundColor: '#1373E5' },
  dangerBtn: { paddingHorizontal: 14, height: 38, borderRadius: 12, backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA', justifyContent: 'center' },
  dangerBtnText: { color: '#B91C1C', fontWeight: '800', fontSize: 13 },
  empty: { textAlign: 'center', color: theme.colors.textSecondary, marginTop: 30, paddingHorizontal: 24 },
  bottom: { flex: 1, backgroundColor: 'rgba(15,23,42,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: '90%', paddingBottom: 30 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  sheetTitle: { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  center: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'center', padding: 20 },
  dialog: { backgroundColor: '#fff', borderRadius: 20, padding: 18, gap: 10 },
  label: { fontSize: 12, fontWeight: '700', color: '#64748B' },
  input: { borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, color: '#0F172A', backgroundColor: '#F8FAFC' },
  pick: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0' },
  pickOn: { borderColor: '#1373E5', backgroundColor: '#EFF6FF' },
  submit: { height: 48, borderRadius: 12, backgroundColor: '#1373E5', alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  submitDanger: { height: 48, borderRadius: 12, backgroundColor: '#DC2626', alignItems: 'center', justifyContent: 'center', marginTop: 4 },
});
