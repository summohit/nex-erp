import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Modal, ScrollView, Alert, RefreshControl, TextInput,
} from 'react-native';
import { Search, X, CheckSquare, Square, ChevronRight } from 'lucide-react-native';
import AppScreen from '../../components/AppScreen';
import { apiClient } from '../../api/apiClient';
import { Avatar } from '../../components/PersonSheet';
import { theme } from '../../theme/theme';

/**
 * The web's onboarding board as three tabs. Tap someone to tick their tasks
 * and move them along (Pending → In progress → Completed). HR and admins only;
 * the server refuses everyone else.
 */
type Status = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
const COLUMNS: { key: Status; label: string; field: 'pending' | 'inProgress' | 'completed'; color: string; bg: string }[] = [
  { key: 'PENDING', label: 'Pending', field: 'pending', color: '#B45309', bg: '#FFFBEB' },
  { key: 'IN_PROGRESS', label: 'In progress', field: 'inProgress', color: '#1D4ED8', bg: '#EFF6FF' },
  { key: 'COMPLETED', label: 'Completed', field: 'completed', color: '#047857', bg: '#ECFDF5' },
];
const fullName = (e: any) => `${e.firstName} ${e.lastName || ''}`.trim();
const progress = (e: any) => {
  const t: any[] = e.onboardingTasks || [];
  return { done: t.filter((x) => x.isCompleted).length, total: t.length };
};
const errMsg = (e: any) => e?.response?.data?.message || 'Please try again.';

export default function OnboardingTrackerScreen() {
  const navigation = useNavigation<any>();
  const [board, setBoard] = useState<Record<Status, any[]>>({ PENDING: [], IN_PROGRESS: [], COMPLETED: [] });
  const [tab, setTab] = useState<Status>('IN_PROGRESS');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [denied, setDenied] = useState(false);
  const [open, setOpen] = useState<any | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/onboarding/board');
      const next = { PENDING: data.pending || [], IN_PROGRESS: data.inProgress || [], COMPLETED: data.completed || [] };
      setBoard(next);
      setDenied(false);
      setTab((cur) => (next[cur].length ? cur : (COLUMNS.find((c) => next[c.key].length)?.key ?? cur)));
    } catch (e: any) {
      if (e?.response?.status === 403) setDenied(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return board[tab].filter((e) => !q || `${fullName(e)} ${e.employeeCode || ''} ${e.designation?.name || ''}`.toLowerCase().includes(q));
  }, [board, tab, query]);

  const toggleTask = async (task: any) => {
    const flip = (emp: any) => ({ ...emp, onboardingTasks: emp.onboardingTasks.map((t: any) => (t.id === task.id ? { ...t, isCompleted: !t.isCompleted } : t)) });
    setOpen((o: any) => (o ? flip(o) : o));
    try {
      await apiClient.put(`/onboarding/tasks/${task.id}/toggle`, { isCompleted: !task.isCompleted });
      load();
    } catch (e) {
      setOpen((o: any) => (o ? flip(o) : o));
      Alert.alert('Could not update task', errMsg(e));
    }
  };

  const move = async (status: Status) => {
    if (!open) return;
    try {
      await apiClient.put(`/onboarding/employee/${open.id}/status`, { status });
      setOpen(null);
      setTab(status);
      load();
    } catch (e) {
      Alert.alert('Could not move', errMsg(e));
    }
  };

  if (denied) {
    return (
      <AppScreen showBack title="Onboarding">
        <Text style={styles.empty}>Onboarding is managed by HR and administrators.</Text>
      </AppScreen>
    );
  }

  const total = board.PENDING.length + board.IN_PROGRESS.length + board.COMPLETED.length;

  return (
    <AppScreen showBack title="Onboarding" subtitle={`${board.PENDING.length + board.IN_PROGRESS.length} still onboarding · ${total} total`}>
      {loading ? <ActivityIndicator style={{ marginTop: 40 }} color={theme.colors.primary} /> : (
        <FlatList
          data={list}
          keyExtractor={(e) => String(e.id)}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListHeaderComponent={
            <View style={{ gap: 10, marginBottom: 4 }}>
              <View style={styles.kpis}>
                {COLUMNS.map((c) => (
                  <TouchableOpacity key={c.key} style={[styles.kpi, { backgroundColor: c.bg }, tab === c.key && { borderColor: c.color }]} onPress={() => setTab(c.key)}>
                    <Text style={[styles.kpiNum, { color: c.color }]}>{board[c.key].length}</Text>
                    <Text style={[styles.kpiLabel, { color: c.color }]}>{c.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.search}>
                <Search size={16} color="#94A3B8" />
                <TextInput style={styles.searchInput} value={query} onChangeText={setQuery} placeholder="Search name, #code, designation" placeholderTextColor="#94A3B8" autoCorrect={false} />
              </View>
            </View>
          }
          ListEmptyComponent={<Text style={styles.empty}>No one here.</Text>}
          renderItem={({ item: e }) => {
            const p = progress(e);
            const pct = p.total ? p.done / p.total : 0;
            return (
              <TouchableOpacity style={styles.card} onPress={() => setOpen(e)} activeOpacity={0.85}>
                <Avatar person={e} size={42} />
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={styles.name} numberOfLines={1}>{fullName(e)}</Text>
                  <Text style={styles.sub} numberOfLines={1}>{[e.designation?.name, e.department?.name].filter(Boolean).join(' · ') || '—'}</Text>
                  <View style={styles.bar}><View style={[styles.barFill, { width: `${pct * 100}%` }]} /></View>
                  <Text style={styles.sub}>{p.total ? `${p.done} of ${p.total} tasks done` : 'No tasks assigned'}</Text>
                </View>
                <ChevronRight size={18} color="#CBD5E1" />
              </TouchableOpacity>
            );
          }}
        />
      )}

      <Modal visible={!!open} transparent animationType="slide" onRequestClose={() => setOpen(null)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setOpen(null)}>
          <TouchableOpacity activeOpacity={1} style={styles.sheet}>
            {open && (
              <>
                <View style={styles.sheetHead}>
                  <Avatar person={open} size={44} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{fullName(open)}</Text>
                    <Text style={styles.sub}>{open.designation?.name || ''}{open.user?.email ? ` · ${open.user.email}` : ''}</Text>
                  </View>
                  <TouchableOpacity onPress={() => setOpen(null)}><X size={20} color="#334155" /></TouchableOpacity>
                </View>
                <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
                  <Text style={styles.section}>Tasks · {progress(open).done}/{progress(open).total}</Text>
                  {(open.onboardingTasks || []).map((t: any) => (
                    <TouchableOpacity key={t.id} style={styles.task} onPress={() => toggleTask(t)}>
                      {t.isCompleted ? <CheckSquare size={20} color="#16A34A" /> : <Square size={20} color="#94A3B8" />}
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.taskTitle, t.isCompleted && styles.taskDone]}>{t.title}</Text>
                        {!!t.description && <Text style={styles.sub}>{t.description}</Text>}
                      </View>
                    </TouchableOpacity>
                  ))}
                  {!(open.onboardingTasks || []).length && <Text style={styles.sub}>No tasks. Add templates on the web.</Text>}
                  <Text style={[styles.section, { marginTop: 10 }]}>Move to</Text>
                  <View style={styles.moves}>
                    {COLUMNS.filter((c) => c.key !== open.onboardingStatus).map((c) => (
                      <TouchableOpacity key={c.key} style={[styles.move, { backgroundColor: c.bg, borderColor: c.color }]} onPress={() => move(c.key)}>
                        <Text style={[styles.moveText, { color: c.color }]}>{c.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <TouchableOpacity onPress={() => { const id = open.id; setOpen(null); navigation.navigate('EmployeeProfile', { id, person: open }); }}>
                    <Text style={styles.link}>Open profile</Text>
                  </TouchableOpacity>
                </ScrollView>
              </>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, paddingBottom: 120, gap: 10 },
  kpis: { flexDirection: 'row', gap: 8 },
  kpi: { flex: 1, borderRadius: 14, paddingVertical: 10, alignItems: 'center', borderWidth: 1.5, borderColor: 'transparent' },
  kpiNum: { fontSize: 22, fontWeight: '800' },
  kpiLabel: { fontSize: 11, fontWeight: '700' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, paddingHorizontal: 12, height: 42 },
  searchInput: { flex: 1, fontSize: 14, color: '#0F172A', paddingVertical: 0 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#E2E8F0', padding: 12 },
  name: { fontSize: 15, fontWeight: '800', color: '#0F172A' },
  sub: { fontSize: 12, color: '#64748B' },
  bar: { height: 6, backgroundColor: '#F1F5F9', borderRadius: 3, overflow: 'hidden', marginTop: 4 },
  barFill: { height: 6, backgroundColor: '#22C55E', borderRadius: 3 },
  empty: { textAlign: 'center', color: theme.colors.textSecondary, marginTop: 40, paddingHorizontal: 24 },
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: '80%', paddingBottom: 30 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  section: { fontSize: 12, fontWeight: '800', color: '#64748B', letterSpacing: 0.5 },
  task: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12, borderRadius: 12, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0' },
  taskTitle: { fontSize: 14, fontWeight: '600', color: '#0F172A' },
  taskDone: { color: '#94A3B8', textDecorationLine: 'line-through' },
  moves: { flexDirection: 'row', gap: 8 },
  move: { flex: 1, height: 42, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  moveText: { fontWeight: '800', fontSize: 13 },
  link: { fontSize: 14, fontWeight: '700', color: '#1373E5', textAlign: 'center', marginTop: 12 },
});
