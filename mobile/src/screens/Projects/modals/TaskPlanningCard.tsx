import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Modal, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { apiClient } from '../../../api/apiClient';
import { projectService } from '../../../api/projectService';
import { useProjectStore } from '../../../store/projectStore';

const fullName = (e: any) => `${e?.firstName ?? ''} ${e?.lastName ?? ''}`.trim();
const when = (s: string) => new Date(s).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' });
const hrs = (min: number) => (min < 60 ? `${Math.round(min)}m` : `${(min / 60).toFixed(1).replace(/\.0$/, '')}h`);

type Picker = 'PHASE' | 'MILESTONE' | 'SME' | null;

/**
 * The parts of the web's task drawer the app's task screen lacked: the hours
 * budget state, phase, milestone, SME, pre-requisite and estimate, each
 * logged session, and sub-tasks.
 *
 * Who may change what follows the web: the estimate is the project owner's or
 * PM's to set (an employee asks for more hours instead), and the planning
 * fields belong to whoever runs the project. The server refuses anyone else
 * either way; hiding the controls just avoids offering a save that fails.
 */
export default function TaskPlanningCard({
  issue, projectId, canManage, canAssignHours, onChanged,
}: {
  issue: any;
  projectId: number;
  canManage: boolean;
  canAssignHours: boolean;
  onChanged: () => void;
}) {
  const project = useProjectStore((s) => s.currentProject);
  const allIssues = useProjectStore((s) => s.currentIssues);
  const columns = useProjectStore((s) => s.currentBoard?.columns || []);

  const [phases, setPhases] = useState<any[]>([]);
  const [milestones, setMilestones] = useState<any[]>([]);
  const [picker, setPicker] = useState<Picker>(null);
  const [saving, setSaving] = useState(false);
  const [estimate, setEstimate] = useState(issue.estimatedHours != null ? String(issue.estimatedHours) : '');
  const [prereq, setPrereq] = useState(issue.prerequisites || '');
  const [editingPrereq, setEditingPrereq] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [newSubtask, setNewSubtask] = useState('');

  useEffect(() => {
    setEstimate(issue.estimatedHours != null ? String(issue.estimatedHours) : '');
    setPrereq(issue.prerequisites || '');
  }, [issue.id, issue.estimatedHours, issue.prerequisites]);

  useEffect(() => {
    if (!canManage) return;
    apiClient.get('/master-data/project-phases', { params: { activeOnly: true } }).then(({ data }) => setPhases(data || [])).catch(() => {});
    apiClient.get(`/projects/${projectId}/milestones`).then(({ data }) => setMilestones(data?.milestones || [])).catch(() => {});
  }, [projectId, canManage]);

  const smeOptions = (project?.members || []).filter((m: any) => m.employee && (m.role === 'PROJECT_MANAGER' || m.role === 'TECHNICAL_ARCHITECT'));

  // ── hours budget (web: On Track < 80% ≤ Near Budget < 100% ≤ Over Budget) ──
  const logs: any[] = Array.isArray(issue.timeLogs) ? issue.timeLogs : [];
  const loggedMin = logs.reduce((s, l) => s + (l.durationMin || 0), 0);
  const estMin = (Number(issue.estimatedHours) || 0) * 60;
  const pct = estMin > 0 ? Math.round((loggedMin / estMin) * 100) : 0;
  const budget = estMin <= 0 ? null
    : pct >= 100 ? { label: 'Over Budget', fg: '#B91C1C', bg: '#FEE2E2' }
    : pct >= 80 ? { label: 'Near Budget', fg: '#B45309', bg: '#FEF3C7' }
    : { label: 'On Track', fg: '#15803D', bg: '#DCFCE7' };

  const subtasks = useMemo(() => allIssues.filter((i: any) => i.parentId === issue.id && !i.isArchived), [allIssues, issue.id]);
  const doneCol = (id: number) => columns.find((c: any) => c.id === id);
  const isDone = (t: any) => t.status === 'DONE' || t.completed || /done/i.test(doneCol(t.columnId)?.name || '');

  const save = async (data: any, patch: () => void) => {
    setSaving(true);
    try {
      await projectService.updateIssue(projectId, issue.id, data);
      patch();
      onChanged();
      useProjectStore.getState().fetchProjectDetails(projectId).catch(() => {});
    } catch (e: any) {
      Alert.alert('Could not save', e?.response?.data?.message || 'Please try again.');
    } finally {
      setSaving(false);
      setPicker(null);
    }
  };

  const saveEstimate = () => {
    const n = Number(estimate);
    if (!(n > 0)) { Alert.alert('Estimated hours', 'Enter more than 0 hours.'); return; }
    if (n === Number(issue.estimatedHours)) return;
    save({ estimatedHours: n }, () => { issue.estimatedHours = n; });
  };

  const addSubtask = async () => {
    const title = newSubtask.trim();
    if (!title) return;
    setSaving(true);
    try {
      await useProjectStore.getState().createIssue(projectId, {
        title, type: 'SUBTASK', parentId: issue.id, priority: issue.priority,
        columnId: columns.length ? [...columns].sort((a: any, b: any) => a.position - b.position)[0].id : undefined,
        phaseId: issue.phase?.id ?? issue.phaseId ?? undefined,
      });
      setNewSubtask('');
    } catch (e: any) {
      Alert.alert('Could not add sub-task', e?.response?.data?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const Row = ({ label, value, onPress }: { label: string; value: string; onPress?: () => void }) => (
    <TouchableOpacity style={styles.row} disabled={!onPress} onPress={onPress} activeOpacity={0.7}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, !onPress && { color: '#334155' }]} numberOfLines={1}>{value}{onPress ? '  ›' : ''}</Text>
    </TouchableOpacity>
  );

  const pickerRows: { id: number | null; title: string; sub?: string }[] =
    picker === 'PHASE' ? phases.map((p) => ({ id: p.id, title: p.name }))
    : picker === 'MILESTONE' ? [{ id: null, title: 'No milestone' }, ...milestones.map((m) => ({ id: m.id, title: m.name || m.title }))]
    : picker === 'SME' ? smeOptions.map((m: any) => ({ id: m.employee.id, title: fullName(m.employee), sub: m.role === 'PROJECT_MANAGER' ? 'PM' : 'Tech Architect' }))
    : [];

  const choose = (id: number | null) => {
    if (picker === 'PHASE') {
      const ph = phases.find((p) => p.id === id);
      save({ phaseId: id }, () => { issue.phase = ph ? { id: ph.id, name: ph.name } : null; issue.phaseId = id; });
    } else if (picker === 'MILESTONE') {
      const ms = milestones.find((m) => m.id === id);
      save({ milestoneId: id }, () => { issue.milestone = ms ? { id: ms.id, name: ms.name || ms.title } : null; issue.milestoneId = id; });
    } else if (picker === 'SME') {
      const m = smeOptions.find((x: any) => x.employee.id === id);
      save({ smeId: id }, () => { issue.sme = m?.employee ?? null; issue.smeId = id; });
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>Planning</Text>
        {saving && <ActivityIndicator size="small" color="#2563EB" />}
      </View>

      {/* Hours budget */}
      <View style={styles.budgetRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowLabel}>Hours budget</Text>
          <Text style={styles.budgetText}>
            {estMin > 0 ? `${hrs(loggedMin)} used of ${hrs(estMin)} · ${hrs(Math.max(0, estMin - loggedMin))} left` : 'No estimate set'}
          </Text>
        </View>
        {budget && <View style={[styles.pill, { backgroundColor: budget.bg }]}><Text style={[styles.pillText, { color: budget.fg }]}>{budget.label}</Text></View>}
      </View>
      {estMin > 0 && (
        <View style={styles.barBg}><View style={[styles.barFill, { width: `${Math.min(100, pct)}%`, backgroundColor: budget!.fg }]} /></View>
      )}

      {canAssignHours ? (
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Estimated hours</Text>
          <View style={styles.estWrap}>
            <TextInput style={styles.estInput} value={estimate} onChangeText={(v) => setEstimate(v.replace(/[^0-9.]/g, ''))}
              keyboardType="decimal-pad" onEndEditing={saveEstimate} placeholder="0" />
            <Text style={styles.rowLabel}>h</Text>
          </View>
        </View>
      ) : (
        <Row label="Estimated hours" value={issue.estimatedHours != null ? `${issue.estimatedHours} h` : '—'} />
      )}

      <Row label="Phase" value={issue.phase?.name || '—'} onPress={canManage && phases.length ? () => setPicker('PHASE') : undefined} />
      <Row label="Milestone" value={issue.milestone?.name || 'No milestone'} onPress={canManage && milestones.length ? () => setPicker('MILESTONE') : undefined} />
      <Row label="SME / Govern" value={issue.sme ? fullName(issue.sme) : '—'} onPress={canManage && smeOptions.length ? () => setPicker('SME') : undefined} />

      <View style={[styles.row, { flexDirection: 'column', alignItems: 'stretch', gap: 6 }]}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={styles.rowLabel}>Pre-requisite</Text>
          {canManage && !editingPrereq && <TouchableOpacity onPress={() => setEditingPrereq(true)}><Text style={styles.link}>Edit</Text></TouchableOpacity>}
        </View>
        {editingPrereq ? (
          <>
            <TextInput style={styles.area} value={prereq} onChangeText={setPrereq} multiline textAlignVertical="top" />
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 16 }}>
              <TouchableOpacity onPress={() => { setPrereq(issue.prerequisites || ''); setEditingPrereq(false); }}><Text style={styles.muted}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => {
                if (!prereq.trim()) { Alert.alert('Pre-requisite', 'It cannot be empty.'); return; }
                save({ prerequisites: prereq.trim() }, () => { issue.prerequisites = prereq.trim(); setEditingPrereq(false); });
              }}><Text style={styles.link}>Save</Text></TouchableOpacity>
            </View>
          </>
        ) : <Text style={styles.body}>{issue.prerequisites || '—'}</Text>}
      </View>

      {/* Logged sessions */}
      <TouchableOpacity style={styles.row} onPress={() => setShowLogs(!showLogs)} disabled={!logs.length}>
        <Text style={styles.rowLabel}>Logged sessions</Text>
        <Text style={styles.rowValue}>{logs.length ? `${logs.length} · ${showLogs ? 'Hide' : 'Show'}` : 'None yet'}</Text>
      </TouchableOpacity>
      {showLogs && [...logs].sort((a, b) => +new Date(b.startedAt) - +new Date(a.startedAt)).map((l) => (
        <View key={l.id} style={styles.logRow}>
          <Text style={styles.body}>{when(l.startedAt)}{l.endedAt ? ` – ${new Date(l.endedAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}` : ' · running'}</Text>
          <Text style={styles.logHrs}>{hrs(l.durationMin || 0)}</Text>
        </View>
      ))}

      {/* Sub-tasks */}
      <View style={[styles.row, { borderBottomWidth: 0 }]}>
        <Text style={styles.rowLabel}>Sub-tasks</Text>
        <Text style={styles.rowValue}>{subtasks.length ? `${subtasks.filter(isDone).length}/${subtasks.length} done` : 'None'}</Text>
      </View>
      {subtasks.map((t: any) => (
        <View key={t.id} style={styles.logRow}>
          <Text style={[styles.body, { flex: 1 }, isDone(t) && styles.doneText]} numberOfLines={2}>{t.key} · {t.title}</Text>
          <Text style={styles.muted}>{doneCol(t.columnId)?.name || ''}</Text>
        </View>
      ))}
      {canManage && (
        <View style={styles.addRow}>
          <TextInput style={[styles.estInput, { flex: 1, textAlign: 'left' }]} placeholder="Add a sub-task" value={newSubtask} onChangeText={setNewSubtask} onSubmitEditing={addSubtask} />
          <TouchableOpacity style={[styles.addBtn, !newSubtask.trim() && { opacity: 0.5 }]} disabled={!newSubtask.trim() || saving} onPress={addSubtask}>
            <Text style={styles.addText}>Add</Text>
          </TouchableOpacity>
        </View>
      )}

      <Modal visible={!!picker} transparent animationType="fade" onRequestClose={() => setPicker(null)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setPicker(null)}>
          <View style={styles.sheet}>
            <Text style={styles.title}>{picker === 'PHASE' ? 'Phase' : picker === 'MILESTONE' ? 'Milestone' : 'SME / Govern'}</Text>
            <ScrollView style={{ maxHeight: 420 }}>
              {pickerRows.map((r) => (
                <TouchableOpacity key={String(r.id)} style={styles.pickRow} onPress={() => choose(r.id)}>
                  <Text style={styles.pickTitle}>{r.title}</Text>
                  {!!r.sub && <Text style={styles.muted}>{r.sub}</Text>}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#E2E8F0' },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  title: { fontSize: 15, fontWeight: '700', color: '#0F172A', marginBottom: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#F1F5F9', gap: 10 },
  rowLabel: { fontSize: 13, color: '#64748B', fontWeight: '600' },
  rowValue: { fontSize: 14, color: '#2563EB', fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  budgetRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 4 },
  budgetText: { fontSize: 14, color: '#0F172A', fontWeight: '600', marginTop: 2 },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  pillText: { fontSize: 12, fontWeight: '700' },
  barBg: { height: 6, borderRadius: 3, backgroundColor: '#F1F5F9', marginTop: 8, marginBottom: 4, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3 },
  estWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  estInput: { minWidth: 70, height: 38, borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, paddingHorizontal: 10, textAlign: 'right', color: '#0F172A' },
  area: { minHeight: 70, borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, padding: 10, color: '#0F172A' },
  body: { fontSize: 13.5, color: '#334155' },
  link: { color: '#2563EB', fontWeight: '700' },
  muted: { fontSize: 12, color: '#64748B' },
  logRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 7, paddingLeft: 8, gap: 8 },
  logHrs: { fontSize: 13, fontWeight: '700', color: '#0F172A' },
  doneText: { textDecorationLine: 'line-through', color: '#94A3B8' },
  addRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  addBtn: { height: 38, paddingHorizontal: 16, borderRadius: 8, backgroundColor: '#2563EB', justifyContent: 'center' },
  addText: { color: '#fff', fontWeight: '700' },
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, paddingBottom: 34 },
  pickRow: { paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  pickTitle: { fontSize: 15, color: '#0F172A', fontWeight: '600' },
});
