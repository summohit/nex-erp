import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, AlertCircle, ArrowDown, Minus, ArrowUp, Flame } from 'lucide-react-native';

import DateTimePickerModal from 'react-native-modal-datetime-picker';
import { useProjectStore } from '../../../store/projectStore';
import { apiClient } from '../../../api/apiClient';
import { projectService } from '../../../api/projectService';

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const nice = (s: string | null) => (s ? new Date(`${s}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Pick a date');
const fullName = (e: any) => `${e?.firstName ?? ''} ${e?.lastName ?? ''}`.trim();

interface IssueFormModalProps {
  visible: boolean;
  onClose: () => void;
  /** Creates the task and returns it, so its members can be added after. */
  onSubmit: (data: any) => Promise<any>;
  initialColumnId?: number;
}

export default function IssueFormModal({ visible, onClose, onSubmit, initialColumnId }: IssueFormModalProps) {
  const insets = useSafeAreaInsets();
  const currentBoard = useProjectStore(state => state.currentBoard);
  const currentProject = useProjectStore(state => state.currentProject);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [startDate, setStartDate] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [estimatedHours, setEstimatedHours] = useState('');
  const [memberIds, setMemberIds] = useState<number[]>([]);
  const [smeId, setSmeId] = useState<number | null>(null);
  const [prerequisites, setPrerequisites] = useState('');
  const [phaseId, setPhaseId] = useState<number | null>(null);
  const [milestoneId, setMilestoneId] = useState<number | null>(null);
  const [phases, setPhases] = useState<any[]>([]);
  const [milestones, setMilestones] = useState<any[]>([]);
  const [dateTarget, setDateTarget] = useState<'start' | 'due' | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // The same lists the web's task drawer offers (§import template): any
  // project member can be on the task; the SME is a PM or technical architect,
  // defaulting to the PM.
  const projectMembers: any[] = (currentProject?.members || []).filter((m: any) => m.employee);
  const smeOptions = projectMembers
    .filter((m: any) => m.role === 'PROJECT_MANAGER' || m.role === 'TECHNICAL_ARCHITECT')
    .sort((a: any, b: any) => (a.role === 'PROJECT_MANAGER' ? -1 : 0) - (b.role === 'PROJECT_MANAGER' ? -1 : 0));
  const defaultSmeId = smeOptions[0]?.employee?.id ?? currentProject?.leadId ?? null;
  const [error, setError] = useState<string | null>(null);

  // Reset form when modal opens
  useEffect(() => {
    if (visible) {
      setTitle('');
      setDescription('');
      setPriority('MEDIUM');
      setStartDate(null);
      setDueDate(null);
      setEstimatedHours('');
      setMemberIds([]);
      setSmeId(defaultSmeId);
      setPrerequisites('');
      setMilestoneId(null);
      setError(null);
      setIsSubmitting(false);
      apiClient.get('/master-data/project-phases', { params: { activeOnly: true } })
        .then(({ data }) => { setPhases(data || []); setPhaseId((data || [])[0]?.id ?? null); })
        .catch(() => setPhases([]));
      if (currentProject?.id) {
        // Not everyone may read milestones; the picker just stays hidden then.
        apiClient.get(`/projects/${currentProject.id}/milestones`)
          .then(({ data }) => setMilestones(data?.milestones || []))
          .catch(() => setMilestones([]));
      }
    }
  }, [visible]);

  /** The web's required fields, in its order (project-detail isFieldInvalid). */
  const missing = (): string | null => {
    if (!title.trim()) return 'Title is required';
    if (!memberIds.length) return 'Add at least one member';
    if (!startDate) return 'Start date is required';
    if (!dueDate) return 'Due date is required';
    if (dueDate < startDate) return 'Due date cannot be before the start date';
    if (!prerequisites.trim()) return 'Pre-requisite is required';
    if (!smeId) return 'SME / Govern is required';
    if (!(Number(estimatedHours) > 0)) return 'Estimated hours must be more than 0';
    if (!description.trim()) return 'Description is required';
    return null;
  };

  const handleSubmit = async () => {
    const problem = missing();
    if (problem) {
      setError(problem);
      return;
    }

    setIsSubmitting(true);
    setError(null);
    
    try {
      const created = await onSubmit({
        title: title.trim(),
        description: description.trim(),
        type: 'TASK',
        priority,
        columnId: initialColumnId,
        startDate,
        dueDate,
        estimatedHours: Number(estimatedHours),
        prerequisites: prerequisites.trim(),
        smeId,
        phaseId,
        milestoneId,
        assigneeId: memberIds[0],
      });
      // As the web does: the task is created with its first member as the
      // assignee, then every chosen member is put on it.
      const newId = created?.id ?? created?.issue?.id;
      if (newId && currentProject?.id) {
        await Promise.allSettled(memberIds.map((id) =>
          projectService.toggleIssueMember(currentProject.id, newId, id)));
        useProjectStore.getState().fetchProjectDetails(currentProject.id);
      }
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to create task');
    } finally {
      setIsSubmitting(false);
    }
  };

  const PRIORITIES = [
    { id: 'LOW', label: 'Low', color: '#64748B', bg: '#F8FAFC', borderColor: '#CBD5E1', icon: ArrowDown },
    { id: 'MEDIUM', label: 'Medium', color: '#2563EB', bg: '#EFF6FF', borderColor: '#93C5FD', icon: Minus },
    { id: 'HIGH', label: 'High', color: '#6b3fd6', bg: '#f3efff', borderColor: '#a4a4a5', icon: ArrowUp },
    { id: 'CRITICAL', label: 'Critical', color: '#1373e5', bg: '#eff6ff', borderColor: '#dbeafe', icon: Flame }
  ];

  const targetColumn = currentBoard?.columns?.find((c: any) => c.id === initialColumnId);
  const columnName = targetColumn ? targetColumn.name : 'Backlog';

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={styles.modalOverlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.modalContent, { maxHeight: '92%' }]}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Create New Task</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <X size={22} color="#64748B" />
            </TouchableOpacity>
          </View>

          {/* Error Message */}
          {error && (
            <View style={styles.errorBannerWrapper}>
              <View style={styles.errorBanner}>
                <AlertCircle size={16} color="#1373e5" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            </View>
          )}

          {/* Scrollable Form */}
          <ScrollView
            style={styles.formScroll}
            contentContainerStyle={styles.formScrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.label}>Title <Text style={styles.required}>*</Text></Text>
            <TextInput
              style={styles.input}
              placeholder="What needs to be done?"
              placeholderTextColor="#94A3B8"
              value={title}
              onChangeText={(text) => {
                setTitle(text);
                if (error) setError(null);
              }}
              autoFocus
            />

            <Text style={styles.label}>Description <Text style={styles.required}>*</Text></Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Add details..."
              placeholderTextColor="#94A3B8"
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />

            <Text style={styles.label}>Priority</Text>
            <View style={styles.priorityContainer}>
              {PRIORITIES.map((p) => {
                const isSelected = priority === p.id;
                const IconComp = p.icon;
                return (
                  <TouchableOpacity
                    key={p.id}
                    style={[
                      styles.priorityBtn,
                      isSelected && { backgroundColor: p.bg, borderColor: p.borderColor, borderWidth: 1.5 }
                    ]}
                    onPress={() => setPriority(p.id)}
                    activeOpacity={0.7}
                  >
                    <IconComp size={14} color={isSelected ? p.color : '#94A3B8'} strokeWidth={2.5} />
                    <Text style={[
                      styles.priorityText,
                      isSelected && { color: p.color, fontWeight: '700' }
                    ]}>
                      {p.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.label}>Members <Text style={styles.required}>*</Text></Text>
            <View style={styles.chips}>
              {projectMembers.map((m: any) => {
                const on = memberIds.includes(m.employee.id);
                return (
                  <TouchableOpacity key={m.employee.id} style={[styles.chip, on && styles.chipOn]}
                    onPress={() => setMemberIds((ids) => (on ? ids.filter((i) => i !== m.employee.id) : [...ids, m.employee.id]))}>
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{on ? '✓ ' : ''}{fullName(m.employee)}</Text>
                  </TouchableOpacity>
                );
              })}
              {projectMembers.length === 0 && <Text style={styles.hint}>This project has no members yet. Add them from the project's team first.</Text>}
            </View>

            <View style={styles.twoCol}>
              <View style={styles.col}>
                <Text style={styles.label}>Start date <Text style={styles.required}>*</Text></Text>
                <TouchableOpacity style={styles.input} onPress={() => setDateTarget('start')}>
                  <Text style={[styles.pickText, !startDate && styles.placeholder]}>{nice(startDate)}</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.col}>
                <Text style={styles.label}>Due date <Text style={styles.required}>*</Text></Text>
                <TouchableOpacity style={styles.input} onPress={() => setDateTarget('due')}>
                  <Text style={[styles.pickText, !dueDate && styles.placeholder]}>{nice(dueDate)}</Text>
                </TouchableOpacity>
              </View>
            </View>

            <Text style={styles.label}>Estimated hours <Text style={styles.required}>*</Text></Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 8"
              placeholderTextColor="#94A3B8"
              keyboardType="decimal-pad"
              value={estimatedHours}
              onChangeText={(v) => setEstimatedHours(v.replace(/[^0-9.]/g, ''))}
            />

            <Text style={styles.label}>SME / Govern <Text style={styles.required}>*</Text></Text>
            <View style={styles.chips}>
              {smeOptions.map((m: any) => {
                const on = smeId === m.employee.id;
                return (
                  <TouchableOpacity key={m.employee.id} style={[styles.chip, on && styles.chipOn]} onPress={() => setSmeId(m.employee.id)}>
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>
                      {fullName(m.employee)} · {m.role === 'PROJECT_MANAGER' ? 'PM' : 'Tech Architect'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              {smeOptions.length === 0 && <Text style={styles.hint}>No PM or technical architect on this project — ask the project owner to add one.</Text>}
            </View>

            <Text style={styles.label}>Pre-requisite <Text style={styles.required}>*</Text></Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="What must be ready before this can start?"
              placeholderTextColor="#94A3B8"
              value={prerequisites}
              onChangeText={setPrerequisites}
              multiline
              textAlignVertical="top"
            />

            {phases.length > 0 && (
              <>
                <Text style={styles.label}>Phase</Text>
                <View style={styles.chips}>
                  {phases.map((ph: any) => (
                    <TouchableOpacity key={ph.id} style={[styles.chip, phaseId === ph.id && styles.chipOn]} onPress={() => setPhaseId(ph.id)}>
                      <Text style={[styles.chipText, phaseId === ph.id && styles.chipTextOn]}>{ph.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            {milestones.length > 0 && (
              <>
                <Text style={styles.label}>Milestone</Text>
                <View style={styles.chips}>
                  <TouchableOpacity style={[styles.chip, milestoneId == null && styles.chipOn]} onPress={() => setMilestoneId(null)}>
                    <Text style={[styles.chipText, milestoneId == null && styles.chipTextOn]}>No milestone</Text>
                  </TouchableOpacity>
                  {milestones.map((ms: any) => (
                    <TouchableOpacity key={ms.id} style={[styles.chip, milestoneId === ms.id && styles.chipOn]} onPress={() => setMilestoneId(ms.id)}>
                      <Text style={[styles.chipText, milestoneId === ms.id && styles.chipTextOn]}>{ms.name || ms.title}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            <DateTimePickerModal
              isVisible={!!dateTarget}
              mode="date"
              minimumDate={dateTarget === 'due' && startDate ? new Date(`${startDate}T00:00:00`) : undefined}
              date={new Date(`${(dateTarget === 'due' ? dueDate || startDate : startDate) || ymd(new Date())}T00:00:00`)}
              onConfirm={(d) => {
                const v = ymd(d);
                if (dateTarget === 'start') { setStartDate(v); if (dueDate && dueDate < v) setDueDate(v); } else setDueDate(v);
                setDateTarget(null);
              }}
              onCancel={() => setDateTarget(null)}
            />

            <View style={styles.statusDisplay}>
              <Text style={styles.statusLabel}>Will be added to:</Text>
              <View style={styles.statusBadge}>
                <Text style={styles.statusBadgeText}>{columnName}</Text>
              </View>
            </View>
          </ScrollView>

          {/* Footer Actions */}
          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={onClose}
              disabled={isSubmitting}
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.submitBtn,
                isSubmitting && styles.submitBtnDisabled
              ]}
              onPress={handleSubmit}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.submitBtnText}>Create Task</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: '#CBD5E1', backgroundColor: '#F8FAFC' },
  chipOn: { borderColor: '#2563EB', backgroundColor: '#EFF6FF' },
  chipText: { fontSize: 13, color: '#475569', fontWeight: '500' },
  chipTextOn: { color: '#1D4ED8', fontWeight: '700' },
  hint: { fontSize: 12, color: '#94A3B8' },
  twoCol: { flexDirection: 'row', gap: 10 },
  col: { flex: 1 },
  pickText: { fontSize: 15, color: '#0F172A' },
  placeholder: { color: '#94A3B8' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 16,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0F172A',
  },
  closeBtn: {
    padding: 4,
    backgroundColor: '#F1F5F9',
    borderRadius: 20,
  },
  errorBannerWrapper: {
    paddingHorizontal: 24,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eff6ff',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#dbeafe',
  },
  errorText: {
    color: '#1373e5',
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 8,
    flex: 1,
  },
  formScroll: {
    flexGrow: 0,
  },
  formScrollContent: {
    paddingHorizontal: 24,
    paddingBottom: 8,
    gap: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#475569',
    marginBottom: 6,
  },
  required: {
    color: '#1373e5',
  },
  input: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: '#0F172A',
  },
  textArea: {
    minHeight: 100,
  },
  priorityContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  priorityBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
  },
  priorityText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  statusDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    padding: 12,
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  statusLabel: {
    fontSize: 14,
    color: '#64748B',
    marginRight: 8,
  },
  statusBadge: {
    backgroundColor: '#E2E8F0',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  footer: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 24,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#475569',
  },
  submitBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#1373e5',
    alignItems: 'center',
  },
  submitBtnDisabled: {
    backgroundColor: '#dbeafe',
    opacity: 0.7,
  },
  submitBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
