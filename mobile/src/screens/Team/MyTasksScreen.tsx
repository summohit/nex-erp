import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator,
  Alert, TextInput, Modal, Image,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import AppScreen from '../../components/AppScreen';
import { workService, MyTask, TaskScope, PersonLite } from '../../api/workService';
import { theme } from '../../theme/theme';

type Quick = 'ALL' | 'OVERDUE' | 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW';

const STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  TODO: { label: 'To do', bg: '#F1F5F9', fg: '#475569' },
  IN_PROGRESS: { label: 'In progress', bg: '#DBEAFE', fg: '#1D4ED8' },
  IN_REVIEW: { label: 'In review', bg: '#EDE9FE', fg: '#6D28D9' },
  BLOCKED: { label: 'Blocked', bg: '#FEE2E2', fg: '#B91C1C' },
  DONE: { label: 'Done', bg: '#DCFCE7', fg: '#15803D' },
  CANCELLED: { label: 'Cancelled', bg: '#F1F5F9', fg: '#64748B' },
};
const PRIORITY_COLOR: Record<string, string> = { CRITICAL: '#B91C1C', HIGH: '#DC2626', MEDIUM: '#D97706', LOW: '#64748B' };

const fmt = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const personName = (p?: { firstName?: string; lastName?: string | null }) =>
  p ? `${p.firstName || ''} ${p.lastName || ''}`.trim() : '';

/**
 * My Tasks, and — for administrators — everyone's.
 *
 * One list across project, general (GEN-) and pre-sales tasks, from the same
 * /tasks/my the web uses. In the Everyone view a person can be picked, and
 * their tasks come from the server rather than from the first 200 loaded.
 */
export default function MyTasksScreen() {
  const navigation = useNavigation<any>();
  const [isAdmin, setIsAdmin] = useState(false);
  const [scope, setScope] = useState<TaskScope>('mine');
  const [includeDone, setIncludeDone] = useState(false);
  const [person, setPerson] = useState<PersonLite | null>(null);
  const [tasks, setTasks] = useState<MyTask[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [quick, setQuick] = useState<Quick>('ALL');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<MyTask | null>(null);
  const [picker, setPicker] = useState(false);
  const [people, setPeople] = useState<PersonLite[]>([]);
  const [peopleQuery, setPeopleQuery] = useState('');
  // "Request more hours" on the open task.
  const [askHours, setAskHours] = useState(false);
  const [hours, setHours] = useState('');
  const [hoursReason, setHoursReason] = useState('');
  const [sendingHours, setSendingHours] = useState(false);

  const sendHours = async () => {
    const h = Number(hours);
    if (!open || !(h > 0) || !hoursReason.trim()) return;
    setSendingHours(true);
    try {
      await workService.requestHours(open.id, h, hoursReason.trim());
      setAskHours(false); setHours(''); setHoursReason('');
      Alert.alert('Request sent', `${h} more hour${h === 1 ? '' : 's'} requested on ${open.refKey}. You will be notified when it is decided.`);
    } catch (e: any) {
      Alert.alert('Could not send', e?.response?.data?.message || 'Please try again.');
    } finally {
      setSendingHours(false);
    }
  };

  useEffect(() => {
    workService.getCapabilities().then((c) => setIsAdmin(c.isAdmin)).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await workService.getTasks({
        scope, includeDone, assigneeId: scope === 'all' ? person?.id : undefined,
      });
      setTasks(res.items);
      setTruncated(res.truncated);
      if (res.scope !== scope) setScope(res.scope);
    } catch (e: any) {
      Alert.alert('Could not load tasks', e?.response?.data?.message || 'Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [scope, includeDone, person]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  const openPicker = () => {
    setPicker(true);
    if (!people.length) workService.getEmployees().then(setPeople).catch(() => {});
  };

  const counts = useMemo(() => ({
    ALL: tasks.length,
    OVERDUE: tasks.filter((t) => t.isOverdue).length,
    TODO: tasks.filter((t) => t.status === 'TODO').length,
    IN_PROGRESS: tasks.filter((t) => t.status === 'IN_PROGRESS').length,
    IN_REVIEW: tasks.filter((t) => t.status === 'IN_REVIEW').length,
  }), [tasks]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks.filter((t) => {
      if (quick === 'OVERDUE' && !t.isOverdue) return false;
      if (quick !== 'ALL' && quick !== 'OVERDUE' && t.status !== quick) return false;
      if (!q) return true;
      const hay = `${t.title} ${t.refKey} ${t.parent?.name || ''} ${t.assignees.map(personName).join(' ')}`.toLowerCase();
      return hay.includes(q);
    });
  }, [tasks, quick, query]);

  const filteredPeople = useMemo(() => {
    const q = peopleQuery.trim().toLowerCase();
    return people.filter((p) => !q || personName(p).toLowerCase().includes(q) || String(p.employeeCode || '').toLowerCase().includes(q));
  }, [people, peopleQuery]);

  const scopes: { key: TaskScope; label: string }[] = [
    { key: 'mine', label: 'Assigned to me' },
    { key: 'created', label: 'Created by me' },
    ...(isAdmin ? [{ key: 'all' as TaskScope, label: 'Everyone' }] : []),
  ];

  const renderTask = ({ item: t }: { item: MyTask }) => {
    const s = STATUS[t.status] || STATUS.TODO;
    return (
      <TouchableOpacity style={[styles.card, t.isOverdue && styles.overdue]} onPress={() => setOpen(t)}>
        <View style={styles.cardHead}>
          <Text style={styles.key}>{t.refKey}</Text>
          {!!t.priority && <Text style={[styles.priority, { color: PRIORITY_COLOR[t.priority] || '#64748B' }]}>● {t.priority.charAt(0) + t.priority.slice(1).toLowerCase()}</Text>}
          <View style={[styles.badge, { backgroundColor: s.bg }]}><Text style={[styles.badgeText, { color: s.fg }]}>{s.label}</Text></View>
        </View>
        <Text style={styles.title} numberOfLines={2}>{t.title}</Text>
        <Text style={styles.meta} numberOfLines={1}>
          {t.parent?.kind === 'GENERAL' ? 'General task' : t.parent?.name || ''}
          {scope !== 'mine' && t.assignees.length ? ` · ${t.assignees.map(personName).join(', ')}` : ''}
        </Text>
        <Text style={[styles.due, t.isOverdue && styles.dueLate]}>
          {t.dueDate ? `Due ${fmt(t.dueDate)}${t.isOverdue ? ' · overdue' : ''}` : 'No due date'}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <AppScreen title={scope === 'all' ? 'All Tasks' : 'My Tasks'} subtitle="Project, general and pre-sales tasks">
      <View style={styles.top}>
        <View style={styles.segment}>
          {scopes.map((s) => (
            <TouchableOpacity key={s.key} style={[styles.segBtn, scope === s.key && styles.segActive]}
              onPress={() => { setScope(s.key); setPerson(null); }}>
              <Text style={[styles.segText, scope === s.key && styles.segTextActive]}>{s.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.searchRow}>
          <TextInput style={styles.search} placeholder="Search tasks, keys, people…" value={query} onChangeText={setQuery} />
          <TouchableOpacity style={[styles.toggle, includeDone && styles.toggleOn]} onPress={() => setIncludeDone((v) => !v)}>
            <Text style={[styles.toggleText, includeDone && styles.toggleTextOn]}>{includeDone ? '✓ Completed' : 'Completed'}</Text>
          </TouchableOpacity>
        </View>

        {scope === 'all' && (
          <TouchableOpacity style={styles.personBtn} onPress={openPicker}>
            <Text style={styles.personText}>👤 {person ? personName(person) : 'All people'}</Text>
            {person && <Text style={styles.clear} onPress={() => setPerson(null)}>Clear</Text>}
          </TouchableOpacity>
        )}

        <View style={styles.chips}>
          {([['ALL', 'All'], ['OVERDUE', 'Overdue'], ['TODO', 'To do'], ['IN_PROGRESS', 'In progress'], ['IN_REVIEW', 'Review']] as [Quick, string][]).map(([k, label]) => (
            <TouchableOpacity key={k} style={[styles.chip, quick === k && styles.chipOn]} onPress={() => setQuick(k)}>
              <Text style={[styles.chipText, quick === k && styles.chipTextOn]}>{label} {counts[k]}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {loading ? <ActivityIndicator style={styles.loader} color={theme.colors.primary} /> : (
        <FlatList
          data={shown}
          keyExtractor={(t) => `${t.source}-${t.id}`}
          renderItem={renderTask}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListHeaderComponent={truncated ? <Text style={styles.truncated}>Showing the first 200 — pick a person or search to narrow it.</Text> : undefined}
          ListEmptyComponent={<Text style={styles.empty}>No tasks here.</Text>}
        />
      )}

      {/* Task detail */}
      <Modal visible={!!open} transparent animationType="slide" onRequestClose={() => setOpen(null)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            {open && (() => {
              const s = STATUS[open.status] || STATUS.TODO;
              return (
                <>
                  <Text style={styles.key}>{open.refKey}</Text>
                  <Text style={styles.sheetTitle}>{open.title}</Text>
                  <View style={[styles.badge, { backgroundColor: s.bg, alignSelf: 'flex-start', marginTop: 8 }]}>
                    <Text style={[styles.badgeText, { color: s.fg }]}>{open.rawStatus || s.label}</Text>
                  </View>
                  {[
                    ['Where', open.parent?.kind === 'GENERAL' ? 'General task' : open.parent?.name || '—'],
                    ['Assigned to', open.assignees.map(personName).join(', ') || '—'],
                    ['Priority', open.priority ? open.priority.charAt(0) + open.priority.slice(1).toLowerCase() : '—'],
                    ['Start', fmt(open.startDate)],
                    ['Due', `${fmt(open.dueDate)}${open.isOverdue ? ' (overdue)' : ''}`],
                    ['Estimate', open.estimatedHours ? `${open.estimatedHours} h` : '—'],
                    ['Created', fmt(open.createdAt)],
                  ].map(([k, v]) => (
                    <View key={k} style={styles.kv}><Text style={styles.k}>{k}</Text><Text style={styles.v}>{v}</Text></View>
                  ))}
                  {open.source !== 'PRE_SALES' && !['DONE', 'CANCELLED'].includes(open.status) && (askHours ? (
                    <View style={styles.hoursBox}>
                      <Text style={styles.hoursTitle}>Request more hours</Text>
                      <TextInput style={styles.search} placeholder="Extra hours, e.g. 4" keyboardType="decimal-pad" value={hours} onChangeText={setHours} />
                      <TextInput style={[styles.search, styles.hoursReason]} placeholder="Why do you need them?" value={hoursReason} onChangeText={setHoursReason} multiline />
                      <View style={styles.sheetActions}>
                        <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={() => setAskHours(false)}>
                          <Text style={styles.btnGhostText}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.btn, styles.btnPrimary, (!(Number(hours) > 0) || !hoursReason.trim() || sendingHours) && { opacity: 0.5 }]}
                          disabled={!(Number(hours) > 0) || !hoursReason.trim() || sendingHours} onPress={sendHours}>
                          {sendingHours ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnPrimaryText}>Send request</Text>}
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <TouchableOpacity style={styles.hoursLink} onPress={() => setAskHours(true)}>
                      <Text style={styles.hoursLinkText}>⏱ Request more hours</Text>
                    </TouchableOpacity>
                  ))}
                  <View style={styles.sheetActions}>
                    <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={() => { setAskHours(false); setOpen(null); }}>
                      <Text style={styles.btnGhostText}>Close</Text>
                    </TouchableOpacity>
                    {open.source === 'PROJECT' && open.projectId != null && (
                      <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={() => {
                        const t = open; setOpen(null);
                        navigation.navigate('ProjectDetail', { projectId: t.projectId, projectName: t.parent?.name });
                      }}>
                        <Text style={styles.btnPrimaryText}>Open project</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </>
              );
            })()}
          </View>
        </View>
      </Modal>

      {/* Person picker (Everyone view) */}
      <Modal visible={picker} animationType="slide" onRequestClose={() => setPicker(false)}>
        <View style={styles.pickerWrap}>
          <View style={styles.pickerHead}>
            <Text style={styles.sheetTitle}>Show tasks for…</Text>
            <TouchableOpacity onPress={() => setPicker(false)}><Text style={styles.clear}>Close</Text></TouchableOpacity>
          </View>
          <TextInput style={styles.search} placeholder="Search people" value={peopleQuery} onChangeText={setPeopleQuery} autoFocus />
          <FlatList
            data={filteredPeople}
            keyExtractor={(p) => String(p.id)}
            ListHeaderComponent={
              <TouchableOpacity style={styles.personRow} onPress={() => { setPerson(null); setPicker(false); }}>
                <Text style={styles.personRowName}>All people</Text>
              </TouchableOpacity>
            }
            renderItem={({ item: p }) => (
              <TouchableOpacity style={styles.personRow} onPress={() => { setPerson(p); setPicker(false); }}>
                {p.avatarUrl ? <Image source={{ uri: p.avatarUrl }} style={styles.avatar} />
                  : <View style={[styles.avatar, styles.initials]}><Text style={styles.initialsText}>{(p.firstName?.[0] || '') + (p.lastName?.[0] || '')}</Text></View>}
                <View>
                  <Text style={styles.personRowName}>{personName(p)}</Text>
                  {!!p.employeeCode && <Text style={styles.meta}>#{p.employeeCode}</Text>}
                </View>
              </TouchableOpacity>
            )}
          />
        </View>
      </Modal>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  top: { paddingHorizontal: 16, paddingTop: 8, gap: 10 },
  segment: { flexDirection: 'row', backgroundColor: '#F1F5F9', borderRadius: 10, padding: 3 },
  segBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  segActive: { backgroundColor: '#fff' },
  segText: { fontSize: 12.5, fontWeight: '600', color: '#64748B' },
  segTextActive: { color: theme.colors.primary },
  searchRow: { flexDirection: 'row', gap: 8 },
  search: { flex: 1, height: 40, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, paddingHorizontal: 12, backgroundColor: '#fff', color: theme.colors.textPrimary },
  toggle: { height: 40, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, justifyContent: 'center', backgroundColor: '#fff' },
  toggleOn: { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' },
  toggleText: { fontSize: 12.5, fontWeight: '600', color: '#475569' },
  toggleTextOn: { color: '#047857' },
  personBtn: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', height: 40, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: '#BFDBFE', backgroundColor: '#EFF6FF' },
  personText: { fontWeight: '600', color: theme.colors.primaryText },
  clear: { color: theme.colors.primary, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: '#F1F5F9' },
  chipOn: { backgroundColor: theme.colors.primary },
  chipText: { fontSize: 12, fontWeight: '600', color: '#475569' },
  chipTextOn: { color: '#fff' },
  loader: { marginTop: 40 },
  list: { padding: 16, paddingBottom: 120, gap: 10 },
  truncated: { fontSize: 12, color: '#92400E', backgroundColor: '#FEF3C7', padding: 8, borderRadius: 8, marginBottom: 6 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: theme.colors.border },
  overdue: { borderLeftWidth: 4, borderLeftColor: '#DC2626' },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  key: { fontSize: 12, fontWeight: '700', color: theme.colors.textMuted },
  priority: { fontSize: 11.5, fontWeight: '600' },
  badge: { marginLeft: 'auto', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  title: { fontSize: 15, fontWeight: '700', color: theme.colors.textPrimary, marginTop: 6 },
  meta: { fontSize: 12, color: theme.colors.textSecondary, marginTop: 3 },
  due: { fontSize: 12, color: theme.colors.textSecondary, marginTop: 6 },
  dueLate: { color: '#B91C1C', fontWeight: '600' },
  empty: { textAlign: 'center', color: theme.colors.textSecondary, marginTop: 40 },
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 34 },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: theme.colors.textPrimary, marginTop: 4 },
  kv: { flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  k: { width: 100, fontSize: 13, color: theme.colors.textSecondary },
  v: { flex: 1, fontSize: 13, color: theme.colors.textPrimary, fontWeight: '500' },
  sheetActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  btn: { flex: 1, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  btnGhost: { backgroundColor: '#F1F5F9' },
  btnGhostText: { fontWeight: '600', color: '#334155' },
  btnPrimary: { backgroundColor: theme.colors.primary },
  btnPrimaryText: { fontWeight: '700', color: '#fff' },
  hoursBox: { marginTop: 14, gap: 8 },
  hoursTitle: { fontSize: 14, fontWeight: '700', color: theme.colors.textPrimary },
  hoursReason: { height: 70, paddingTop: 8, textAlignVertical: 'top' },
  hoursLink: { marginTop: 14, paddingVertical: 10, alignItems: 'center', borderRadius: 10, borderWidth: 1, borderColor: '#BFDBFE', backgroundColor: '#EFF6FF' },
  hoursLinkText: { color: theme.colors.primaryText, fontWeight: '700' },
  pickerWrap: { flex: 1, backgroundColor: '#fff', paddingTop: 54, paddingHorizontal: 16, gap: 10 },
  pickerHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  personRowName: { fontSize: 15, fontWeight: '600', color: theme.colors.textPrimary },
  avatar: { width: 34, height: 34, borderRadius: 17 },
  initials: { backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' },
  initialsText: { color: '#fff', fontWeight: '700', fontSize: 12 },
});
