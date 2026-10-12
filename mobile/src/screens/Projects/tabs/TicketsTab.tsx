import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, Modal, ActivityIndicator, Alert, RefreshControl, ScrollView,
} from 'react-native';
import DateTimePickerModal from 'react-native-modal-datetime-picker';
import { apiClient } from '../../../api/apiClient';
import { useAuthStore } from '../../../store/authStore';
import { useProjectStore } from '../../../store/projectStore';
import { useProjectPermissions } from '../../../hooks/useProjectPermissions';

const STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  REQUESTED: { label: 'Awaiting approval', bg: '#FEF3C7', fg: '#B45309' },
  APPROVED: { label: 'Approved', bg: '#DCFCE7', fg: '#15803D' },
  CONVERTED: { label: 'Converted to task', bg: '#DBEAFE', fg: '#1D4ED8' },
  COMPLETED: { label: 'Completed', bg: '#DCFCE7', fg: '#15803D' },
  REJECTED: { label: 'Rejected', bg: '#FEE2E2', fg: '#B91C1C' },
  CANCELLED: { label: 'Cancelled', bg: '#F1F5F9', fg: '#64748B' },
};
const FILTERS = ['ALL', 'REQUESTED', 'CONVERTED', 'COMPLETED', 'REJECTED', 'CANCELLED'];
const PRIORITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const name = (p: any) => `${p?.firstName ?? ''} ${p?.lastName ?? ''}`.trim();
const day = (s?: string | null) => (s ? new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Project tickets (§29, §30): a project manager records a requirement, an
 * administrator approves it — which turns it into a task — or rejects it.
 * The server holds every rule; the app only hides buttons it would refuse.
 */
export default function TicketsTab({ projectId }: { projectId: number }) {
  const role = useAuthStore((s) => s.user?.role || 'EMPLOYEE');
  const isAdmin = ['SUPERADMIN', 'ADMIN'].includes(role);
  const project = useProjectStore((s) => s.currentProject);
  const columns = useProjectStore((s) => s.currentBoard?.columns || []);
  const perms = useProjectPermissions(project, columns);
  const canRaise = isAdmin || perms.isPM || perms.isOwner;

  const [filter, setFilter] = useState('ALL');
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<number | 'new' | null>(null);
  const [rejecting, setRejecting] = useState<any>(null);
  const [reason, setReason] = useState('');
  const [raising, setRaising] = useState(false);
  const [form, setForm] = useState<any>({ title: '', description: '', priority: 'MEDIUM', estimatedHours: '', proposedAssigneeId: null, startDate: null, dueDate: null });
  const [dateTarget, setDateTarget] = useState<'startDate' | 'dueDate' | null>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await apiClient.get(`/projects/${projectId}/tickets`, { params: filter === 'ALL' ? {} : { status: filter } });
      setList(data || []);
    } catch { setList([]); } finally { setLoading(false); setRefreshing(false); }
  }, [projectId, filter]);
  useEffect(() => { setLoading(true); load(); }, [load]);

  const act = async (t: any, fn: () => Promise<any>) => {
    setBusy(t.id);
    try { await fn(); setRejecting(null); setReason(''); await load(); }
    catch (e: any) { Alert.alert('Could not save', e?.response?.data?.message || 'Please try again.'); }
    finally { setBusy(null); }
  };

  const raise = async () => {
    if (!form.title.trim()) { Alert.alert('Almost there', 'A ticket needs a title.'); return; }
    setBusy('new');
    try {
      await apiClient.post(`/projects/${projectId}/tickets`, {
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        priority: form.priority,
        estimatedHours: form.estimatedHours ? Number(form.estimatedHours) : undefined,
        proposedAssigneeId: form.proposedAssigneeId || undefined,
        startDate: form.startDate || undefined,
        dueDate: form.dueDate || undefined,
      });
      setRaising(false);
      setForm({ title: '', description: '', priority: 'MEDIUM', estimatedHours: '', proposedAssigneeId: null, startDate: null, dueDate: null });
      load();
    } catch (e: any) {
      Alert.alert('Could not raise', e?.response?.data?.message || 'Please try again.');
    } finally { setBusy(null); }
  };

  const members: any[] = (project?.members || []).filter((m: any) => m.employee);

  return (
    <View style={{ flex: 1 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
        {FILTERS.map((f) => (
          <TouchableOpacity key={f} style={[styles.chip, filter === f && styles.chipOn]} onPress={() => setFilter(f)}>
            <Text style={[styles.chipText, filter === f && styles.chipTextOn]}>{f === 'ALL' ? 'All' : STATUS[f].label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading ? <ActivityIndicator style={{ marginTop: 40 }} color="#2563EB" /> : (
        <FlatList
          data={list}
          keyExtractor={(t) => String(t.id)}
          contentContainerStyle={styles.body}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListHeaderComponent={canRaise ? (
            <TouchableOpacity style={styles.primary} onPress={() => setRaising(true)}><Text style={styles.primaryText}>+ Raise a ticket</Text></TouchableOpacity>
          ) : undefined}
          ListEmptyComponent={<Text style={styles.empty}>No tickets{filter === 'ALL' ? ' yet' : ' here'}.</Text>}
          renderItem={({ item: t }) => {
            const st = STATUS[t.status] || STATUS.REQUESTED;
            return (
              <View style={styles.card}>
                <View style={styles.rowBetween}>
                  <Text style={styles.num}>{t.ticketNumber} · {t.priority}</Text>
                  <View style={[styles.pill, { backgroundColor: st.bg }]}><Text style={[styles.pillText, { color: st.fg }]}>{st.label}</Text></View>
                </View>
                <Text style={styles.title}>{t.title}</Text>
                {!!t.description && <Text style={styles.desc} numberOfLines={4}>{t.description.replace(/<[^>]+>/g, '')}</Text>}
                <Text style={styles.meta}>
                  Raised by {name(t.raisedBy) || '—'} · {day(t.createdAt)}
                  {t.proposedAssignee ? ` · for ${name(t.proposedAssignee)}` : ''}
                  {t.estimatedHours ? ` · ${t.estimatedHours}h` : ''}
                </Text>
                {(t.startDate || t.dueDate) && <Text style={styles.meta}>{day(t.startDate)} → {day(t.dueDate)}</Text>}
                {t.convertedIssue && <Text style={styles.ok}>Task {t.convertedIssue.key}: {t.convertedIssue.title}</Text>}
                {t.status === 'REJECTED' && !!t.rejectionReason && <Text style={styles.bad}>Rejected: “{t.rejectionReason}”</Text>}

                {t.status === 'REQUESTED' && (
                  <View style={styles.actions}>
                    {canRaise && (
                      <TouchableOpacity style={[styles.btn, styles.ghost]} disabled={busy === t.id}
                        onPress={() => Alert.alert('Cancel this ticket?', t.title, [{ text: 'No' }, { text: 'Cancel ticket', style: 'destructive', onPress: () => act(t, () => apiClient.post(`/project-tickets/${t.id}/cancel`, {})) }])}>
                        <Text style={styles.ghostText}>Cancel</Text>
                      </TouchableOpacity>
                    )}
                    {isAdmin ? (
                      <>
                        <TouchableOpacity style={[styles.btn, styles.reject]} disabled={busy === t.id} onPress={() => { setReason(''); setRejecting(t); }}>
                          <Text style={styles.rejectText}>Reject</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.btn, styles.approve]} disabled={busy === t.id}
                          onPress={() => act(t, () => apiClient.post(`/project-tickets/${t.id}/review`, { decision: 'APPROVED' }))}>
                          {busy === t.id ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Approve → task</Text>}
                        </TouchableOpacity>
                      </>
                    ) : <Text style={[styles.meta, { alignSelf: 'center' }]}>Waiting on an administrator</Text>}
                  </View>
                )}
              </View>
            );
          }}
        />
      )}

      <Modal visible={!!rejecting} transparent animationType="fade" onRequestClose={() => setRejecting(null)}>
        <View style={styles.backdrop}>
          <View style={styles.dialog}>
            <Text style={styles.title}>Reject {rejecting?.ticketNumber}?</Text>
            <TextInput style={[styles.input, { minHeight: 80, textAlignVertical: 'top', paddingTop: 10 }]} placeholder="Reason (required)" value={reason} onChangeText={setReason} multiline />
            <View style={styles.actions}>
              <TouchableOpacity style={[styles.btn, styles.ghost]} onPress={() => setRejecting(null)}><Text style={styles.ghostText}>Back</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.btn, styles.rejectSolid, !reason.trim() && { opacity: 0.5 }]} disabled={!reason.trim() || busy != null}
                onPress={() => act(rejecting, () => apiClient.post(`/project-tickets/${rejecting.id}/review`, { decision: 'REJECTED', reason: reason.trim() }))}>
                <Text style={styles.primaryText}>Reject</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={raising} animationType="slide" onRequestClose={() => setRaising(false)}>
        <View style={styles.page}>
          <View style={styles.pageHead}>
            <TouchableOpacity onPress={() => setRaising(false)}><Text style={styles.link}>Cancel</Text></TouchableOpacity>
            <Text style={styles.title}>Raise a ticket</Text>
            <TouchableOpacity onPress={raise} disabled={busy === 'new'}>{busy === 'new' ? <ActivityIndicator color="#2563EB" /> : <Text style={styles.link}>Send</Text>}</TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>Title *</Text>
            <TextInput style={styles.input} value={form.title} onChangeText={(v) => setForm({ ...form, title: v })} placeholder="What is needed?" />
            <Text style={styles.label}>Description</Text>
            <TextInput style={[styles.input, { minHeight: 100, textAlignVertical: 'top', paddingTop: 10 }]} multiline value={form.description} onChangeText={(v) => setForm({ ...form, description: v })} />
            <Text style={styles.label}>Priority</Text>
            <View style={styles.wrap}>
              {PRIORITIES.map((p) => (
                <TouchableOpacity key={p} style={[styles.chip, form.priority === p && styles.chipOn]} onPress={() => setForm({ ...form, priority: p })}>
                  <Text style={[styles.chipText, form.priority === p && styles.chipTextOn]}>{p[0] + p.slice(1).toLowerCase()}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.label}>Proposed assignee</Text>
            <View style={styles.wrap}>
              {members.map((m: any) => {
                const on = form.proposedAssigneeId === m.employee.id;
                return (
                  <TouchableOpacity key={m.employee.id} style={[styles.chip, on && styles.chipOn]} onPress={() => setForm({ ...form, proposedAssigneeId: on ? null : m.employee.id })}>
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{name(m.employee)}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {(['startDate', 'dueDate'] as const).map((k) => (
                <View key={k} style={{ flex: 1 }}>
                  <Text style={styles.label}>{k === 'startDate' ? 'Start' : 'Due'}</Text>
                  <TouchableOpacity style={[styles.input, { justifyContent: 'center' }]} onPress={() => setDateTarget(k)}>
                    <Text style={{ color: form[k] ? '#0F172A' : '#94A3B8' }}>{form[k] ? day(form[k]) : 'Optional'}</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
            <Text style={styles.label}>Estimated hours</Text>
            <TextInput style={styles.input} keyboardType="decimal-pad" value={form.estimatedHours} onChangeText={(v) => setForm({ ...form, estimatedHours: v.replace(/[^0-9.]/g, '') })} placeholder="Optional" />
          </ScrollView>
          <DateTimePickerModal
            isVisible={!!dateTarget}
            mode="date"
            onConfirm={(d) => { if (dateTarget) setForm({ ...form, [dateTarget]: ymd(d) }); setDateTarget(null); }}
            onCancel={() => setDateTarget(null)}
          />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  filters: { gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  body: { padding: 16, paddingTop: 4, gap: 10, paddingBottom: 60 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: '#CBD5E1', backgroundColor: '#fff' },
  chipOn: { borderColor: '#2563EB', backgroundColor: '#EFF6FF' },
  chipText: { fontSize: 12.5, color: '#475569', fontWeight: '600' },
  chipTextOn: { color: '#1D4ED8' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  primary: { height: 44, borderRadius: 10, backgroundColor: '#2563EB', alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#fff', fontWeight: '700' },
  card: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', padding: 14, gap: 5 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  num: { fontSize: 12, fontWeight: '700', color: '#64748B' },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  pillText: { fontSize: 11, fontWeight: '700' },
  title: { fontSize: 15, fontWeight: '700', color: '#0F172A' },
  desc: { fontSize: 13, color: '#475569' },
  meta: { fontSize: 12, color: '#64748B' },
  ok: { fontSize: 12.5, color: '#1D4ED8', fontWeight: '600' },
  bad: { fontSize: 12.5, color: '#B91C1C' },
  empty: { textAlign: 'center', color: '#64748B', marginTop: 30 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 8, justifyContent: 'flex-end' },
  btn: { height: 38, paddingHorizontal: 14, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  ghost: { borderWidth: 1, borderColor: '#CBD5E1' },
  ghostText: { color: '#334155', fontWeight: '600' },
  reject: { borderWidth: 1, borderColor: '#FECACA', backgroundColor: '#FEF2F2' },
  rejectText: { color: '#B91C1C', fontWeight: '700' },
  rejectSolid: { backgroundColor: '#DC2626' },
  approve: { backgroundColor: '#16A34A' },
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'center', padding: 24 },
  dialog: { backgroundColor: '#fff', borderRadius: 14, padding: 18, gap: 10 },
  page: { flex: 1, backgroundColor: '#F8FAFC', paddingTop: 50 },
  pageHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8 },
  link: { color: '#2563EB', fontWeight: '700', fontSize: 15 },
  label: { fontSize: 13, fontWeight: '700', color: '#0F172A', marginTop: 8 },
  input: { minHeight: 44, borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 10, paddingHorizontal: 12, backgroundColor: '#fff', color: '#0F172A' },
});
