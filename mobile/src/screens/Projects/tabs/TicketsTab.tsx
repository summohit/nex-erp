import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  Modal,
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import DateTimePickerModal from 'react-native-modal-datetime-picker';
import {
  Ticket as TicketIcon,
  Plus,
  X,
  Calendar,
  Clock,
  User,
  Check,
  CheckSquare,
  AlertTriangle,
  Send,
  XCircle,
} from 'lucide-react-native';
import { apiClient } from '../../../api/apiClient';
import { useAuthStore } from '../../../store/authStore';
import { useProjectStore } from '../../../store/projectStore';
import { useProjectPermissions } from '../../../hooks/useProjectPermissions';
import { theme } from '../../../theme/theme';

const STATUS: Record<string, { label: string; bg: string; fg: string; border: string; dot: string }> = {
  REQUESTED: { label: 'Awaiting approval', bg: '#FFFBEB', fg: '#B45309', border: '#FDE68A', dot: '#F59E0B' },
  APPROVED: { label: 'Approved', bg: '#F0FDF4', fg: '#15803D', border: '#BBF7D0', dot: '#22C55E' },
  CONVERTED: { label: 'Converted to task', bg: '#EFF6FF', fg: '#1D4ED8', border: '#BFDBFE', dot: '#2563EB' },
  COMPLETED: { label: 'Completed', bg: '#F0FDF4', fg: '#15803D', border: '#BBF7D0', dot: '#22C55E' },
  REJECTED: { label: 'Rejected', bg: '#FEF2F2', fg: '#B91C1C', border: '#FECACA', dot: '#EF4444' },
  CANCELLED: { label: 'Cancelled', bg: '#F8FAFC', fg: '#64748B', border: '#E2E8F0', dot: '#94A3B8' },
};

const PRIORITY_BADGES: Record<string, { label: string; bg: string; fg: string; border: string }> = {
  CRITICAL: { label: 'Critical', bg: '#FEF2F2', fg: '#DC2626', border: '#FECACA' },
  HIGH:     { label: 'High', bg: '#FFF7ED', fg: '#EA580C', border: '#FED7AA' },
  MEDIUM:   { label: 'Medium', bg: '#FAF5FF', fg: '#7E22CE', border: '#E9D5FF' },
  LOW:      { label: 'Low', bg: '#F8FAFC', fg: '#475569', border: '#E2E8F0' },
};

const FILTERS = ['ALL', 'REQUESTED', 'CONVERTED', 'COMPLETED', 'REJECTED', 'CANCELLED'];
const PRIORITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

const name = (p: any) => `${p?.firstName ?? ''} ${p?.lastName ?? ''}`.trim();
const initialsOf = (fullName?: string) => {
  if (!fullName) return 'U';
  const parts = fullName.trim().split(/\s+/);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return fullName.slice(0, 2).toUpperCase() || 'U';
};
const day = (s?: string | null) => (s ? new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Project tickets (§29, §30): a project manager records a requirement, an
 * administrator approves it — which turns it into a task — or rejects it.
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
  const [form, setForm] = useState<any>({
    title: '',
    description: '',
    priority: 'MEDIUM',
    estimatedHours: '',
    proposedAssigneeId: null,
    startDate: null,
    dueDate: null,
  });
  const [dateTarget, setDateTarget] = useState<'startDate' | 'dueDate' | null>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await apiClient.get(`/projects/${projectId}/tickets`, {
        params: filter === 'ALL' ? {} : { status: filter },
      });
      setList(data || []);
    } catch {
      setList([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [projectId, filter]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const act = async (t: any, fn: () => Promise<any>) => {
    setBusy(t.id);
    try {
      await fn();
      setRejecting(null);
      setReason('');
      await load();
    } catch (e: any) {
      Alert.alert('Could not save', e?.response?.data?.message || 'Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const raise = async () => {
    if (!form.title.trim()) {
      Alert.alert('Almost there', 'A ticket needs a title.');
      return;
    }
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
      setForm({
        title: '',
        description: '',
        priority: 'MEDIUM',
        estimatedHours: '',
        proposedAssigneeId: null,
        startDate: null,
        dueDate: null,
      });
      load();
    } catch (e: any) {
      Alert.alert('Could not raise', e?.response?.data?.message || 'Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const members: any[] = (project?.members || []).filter((m: any) => m.employee);

  return (
    <View style={styles.container}>
      {/* Horizontal Filter Bar - constrained to prevent vertical stretching */}
      <View style={styles.filterBarContainer}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterScroll}
          contentContainerStyle={styles.filterScrollContent}
        >
          {FILTERS.map((f) => {
            const active = filter === f;
            const s = f === 'ALL' ? null : STATUS[f];
            return (
              <TouchableOpacity
                key={f}
                style={[styles.chip, active && styles.chipActive]}
                activeOpacity={0.75}
                onPress={() => setFilter(f)}
              >
                {active && (
                  <View style={[styles.chipDot, { backgroundColor: s?.dot || '#1373e5' }]} />
                )}
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {f === 'ALL' ? 'All Tickets' : s?.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Main List */}
      {loading ? (
        <View style={styles.loaderWrap}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={styles.loaderText}>Loading tickets…</Text>
        </View>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(t) => String(t.id)}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListHeaderComponent={
            <View style={styles.listHeaderRow}>
              <View>
                <Text style={styles.listHeaderCount}>
                  {list.length} {filter === 'ALL' ? 'total' : ''} ticket{list.length === 1 ? '' : 's'}
                </Text>
              </View>
              {canRaise && (
                <TouchableOpacity
                  style={styles.newTicketBtn}
                  activeOpacity={0.85}
                  onPress={() => setRaising(true)}
                >
                  <Plus size={15} color="#FFFFFF" strokeWidth={2.6} />
                  <Text style={styles.newTicketBtnText}>Raise Ticket</Text>
                </TouchableOpacity>
              )}
            </View>
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconCircle}>
                <TicketIcon size={34} color="#1373e5" strokeWidth={1.8} />
              </View>
              <Text style={styles.emptyTitle}>No Tickets Found</Text>
              <Text style={styles.emptySubtitle}>
                {filter === 'ALL'
                  ? 'Requirements and change requests raised for this project will appear here for review.'
                  : `There are no tickets currently in "${STATUS[filter]?.label || filter}" status.`}
              </Text>
              {canRaise && filter === 'ALL' && (
                <TouchableOpacity
                  style={styles.emptyActionBtn}
                  activeOpacity={0.85}
                  onPress={() => setRaising(true)}
                >
                  <Plus size={16} color="#FFFFFF" strokeWidth={2.6} />
                  <Text style={styles.emptyActionBtnText}>Raise a Ticket</Text>
                </TouchableOpacity>
              )}
            </View>
          }
          renderItem={({ item: t }) => {
            const st = STATUS[t.status] || STATUS.REQUESTED;
            const prio = PRIORITY_BADGES[t.priority] || PRIORITY_BADGES.MEDIUM;
            const raisedByName = name(t.raisedBy);
            const assigneeName = name(t.proposedAssignee);

            return (
              <View style={styles.ticketCard}>
                {/* Top Badge Row */}
                <View style={styles.ticketCardHead}>
                  <View style={styles.headBadges}>
                    <View style={styles.ticketNumBadge}>
                      <Text style={styles.ticketNumText}>#{t.ticketNumber}</Text>
                    </View>
                    <View style={[styles.priorityBadge, { backgroundColor: prio.bg, borderColor: prio.border }]}>
                      <Text style={[styles.priorityBadgeText, { color: prio.fg }]}>{prio.label}</Text>
                    </View>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: st.bg, borderColor: st.border }]}>
                    <View style={[styles.statusDot, { backgroundColor: st.dot }]} />
                    <Text style={[styles.statusBadgeText, { color: st.fg }]}>{st.label}</Text>
                  </View>
                </View>

                {/* Ticket Title */}
                <Text style={styles.ticketTitle}>{t.title}</Text>

                {/* Ticket Description */}
                {!!t.description && (
                  <Text style={styles.ticketDesc} numberOfLines={3}>
                    {t.description.replace(/<[^>]+>/g, '').trim()}
                  </Text>
                )}

                {/* Info Chips / Metadata */}
                <View style={styles.metaRow}>
                  {!!raisedByName && (
                    <View style={styles.metaChip}>
                      <View style={styles.metaAvatar}>
                        <Text style={styles.metaAvatarText}>{initialsOf(raisedByName)}</Text>
                      </View>
                      <Text style={styles.metaChipText}>{raisedByName}</Text>
                    </View>
                  )}
                  <View style={styles.metaChip}>
                    <Calendar size={12} color="#64748B" strokeWidth={2} />
                    <Text style={styles.metaChipText}>{day(t.createdAt)}</Text>
                  </View>
                  {!!assigneeName && (
                    <View style={styles.metaChip}>
                      <User size={12} color="#64748B" strokeWidth={2} />
                      <Text style={styles.metaChipText}>Assignee: {assigneeName}</Text>
                    </View>
                  )}
                  {!!t.estimatedHours && (
                    <View style={styles.metaChip}>
                      <Clock size={12} color="#64748B" strokeWidth={2} />
                      <Text style={styles.metaChipText}>{t.estimatedHours}h estimated</Text>
                    </View>
                  )}
                </View>

                {/* Date range if present */}
                {(t.startDate || t.dueDate) && (
                  <View style={styles.datesRow}>
                    <Calendar size={13} color="#0284C7" strokeWidth={2} />
                    <Text style={styles.datesRowText}>
                      Schedule: {day(t.startDate)} → {day(t.dueDate)}
                    </Text>
                  </View>
                )}

                {/* Converted to task banner */}
                {t.convertedIssue && (
                  <View style={styles.convertedBanner}>
                    <CheckSquare size={15} color="#15803D" strokeWidth={2.2} />
                    <Text style={styles.convertedBannerText}>
                      Task #{t.convertedIssue.key}: {t.convertedIssue.title}
                    </Text>
                  </View>
                )}

                {/* Rejection Notice */}
                {t.status === 'REJECTED' && !!t.rejectionReason && (
                  <View style={styles.rejectionBanner}>
                    <AlertTriangle size={15} color="#DC2626" strokeWidth={2.2} />
                    <Text style={styles.rejectionBannerText}>
                      Rejected: “{t.rejectionReason}”
                    </Text>
                  </View>
                )}

                {/* Actions for REQUESTED status */}
                {t.status === 'REQUESTED' && (
                  <View style={styles.cardActionsRow}>
                    {canRaise && (
                      <TouchableOpacity
                        style={styles.cancelTicketBtn}
                        disabled={busy === t.id}
                        activeOpacity={0.8}
                        onPress={() =>
                          Alert.alert('Cancel this ticket?', t.title, [
                            { text: 'Keep Ticket', style: 'cancel' },
                            {
                              text: 'Cancel Ticket',
                              style: 'destructive',
                              onPress: () => act(t, () => apiClient.post(`/project-tickets/${t.id}/cancel`, {})),
                            },
                          ])
                        }
                      >
                        <XCircle size={15} color="#64748B" strokeWidth={2} />
                        <Text style={styles.cancelTicketBtnText}>Cancel</Text>
                      </TouchableOpacity>
                    )}

                    {isAdmin ? (
                      <View style={styles.adminActionGroup}>
                        <TouchableOpacity
                          style={styles.rejectTicketBtn}
                          disabled={busy === t.id}
                          activeOpacity={0.8}
                          onPress={() => {
                            setReason('');
                            setRejecting(t);
                          }}
                        >
                          <Text style={styles.rejectTicketBtnText}>Reject</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={styles.approveTicketBtn}
                          disabled={busy === t.id}
                          activeOpacity={0.85}
                          onPress={() => act(t, () => apiClient.post(`/project-tickets/${t.id}/review`, { decision: 'APPROVED' }))}
                        >
                          {busy === t.id ? (
                            <ActivityIndicator color="#fff" size="small" />
                          ) : (
                            <>
                              <Check size={15} color="#FFFFFF" strokeWidth={2.6} />
                              <Text style={styles.approveTicketBtnText}>Approve → Task</Text>
                            </>
                          )}
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <Text style={styles.waitingNoticeText}>Waiting on administrator review</Text>
                    )}
                  </View>
                )}
              </View>
            );
          }}
        />
      )}

      {/* Reject Modal */}
      <Modal visible={!!rejecting} transparent animationType="fade" onRequestClose={() => setRejecting(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
          <View style={styles.dialogCard}>
            <View style={styles.dialogHeader}>
              <AlertTriangle size={20} color="#DC2626" strokeWidth={2.2} />
              <Text style={styles.dialogTitle}>Reject #{rejecting?.ticketNumber}?</Text>
            </View>
            <Text style={styles.dialogSubtitle}>
              Please provide a reason. The person who raised the ticket will be notified.
            </Text>
            <TextInput
              style={styles.dialogInput}
              placeholder="Reason for rejection (required)"
              placeholderTextColor="#94A3B8"
              value={reason}
              onChangeText={setReason}
              multiline
              autoFocus
            />
            <View style={styles.dialogActions}>
              <TouchableOpacity
                style={styles.dialogBackBtn}
                activeOpacity={0.8}
                onPress={() => setRejecting(null)}
              >
                <Text style={styles.dialogBackBtnText}>Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.dialogRejectBtn, !reason.trim() && { opacity: 0.5 }]}
                disabled={!reason.trim() || busy != null}
                activeOpacity={0.85}
                onPress={() =>
                  act(rejecting, () =>
                    apiClient.post(`/project-tickets/${rejecting.id}/review`, {
                      decision: 'REJECTED',
                      reason: reason.trim(),
                    }),
                  )
                }
              >
                <Text style={styles.dialogRejectBtnText}>Reject Ticket</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Raise Ticket Modal */}
      <Modal visible={raising} animationType="slide" onRequestClose={() => setRaising(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.raiseModalContainer}
        >
          <View style={styles.raiseModalHeader}>
            <TouchableOpacity onPress={() => setRaising(false)} style={styles.raiseCloseBtn}>
              <X size={18} color="#0F172A" strokeWidth={2.4} />
            </TouchableOpacity>
            <Text style={styles.raiseModalTitle}>Raise a Ticket</Text>
            <TouchableOpacity
              onPress={raise}
              disabled={busy === 'new'}
              style={[styles.raiseSendBtn, busy === 'new' && { opacity: 0.7 }]}
            >
              {busy === 'new' ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.raiseSendBtnText}>Submit</Text>
              )}
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.raiseBody} keyboardShouldPersistTaps="handled">
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Title *</Text>
              <TextInput
                style={styles.textInput}
                value={form.title}
                onChangeText={(v) => setForm({ ...form, title: v })}
                placeholder="What is the requirement or feature needed?"
                placeholderTextColor="#94A3B8"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Description</Text>
              <TextInput
                style={[styles.textInput, styles.textAreaInput]}
                multiline
                value={form.description}
                onChangeText={(v) => setForm({ ...form, description: v })}
                placeholder="Provide detailed context, acceptance criteria or steps…"
                placeholderTextColor="#94A3B8"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Priority</Text>
              <View style={styles.priorityChipsRow}>
                {PRIORITIES.map((p) => {
                  const on = form.priority === p;
                  const prioInfo = PRIORITY_BADGES[p];
                  return (
                    <TouchableOpacity
                      key={p}
                      style={[styles.prioChip, on && { backgroundColor: prioInfo.bg, borderColor: prioInfo.border }]}
                      activeOpacity={0.8}
                      onPress={() => setForm({ ...form, priority: p })}
                    >
                      <Text style={[styles.prioChipText, on && { color: prioInfo.fg, fontWeight: '700' }]}>
                        {prioInfo.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Proposed Assignee</Text>
              <View style={styles.assigneeChipsWrap}>
                {members.map((m: any) => {
                  const on = form.proposedAssigneeId === m.employee.id;
                  const empName = name(m.employee);
                  return (
                    <TouchableOpacity
                      key={m.employee.id}
                      style={[styles.assigneeChip, on && styles.assigneeChipActive]}
                      activeOpacity={0.8}
                      onPress={() => setForm({ ...form, proposedAssigneeId: on ? null : m.employee.id })}
                    >
                      <View style={[styles.assigneeAvatar, on && styles.assigneeAvatarActive]}>
                        <Text style={[styles.assigneeAvatarText, on && styles.assigneeAvatarTextActive]}>
                          {initialsOf(empName)}
                        </Text>
                      </View>
                      <Text style={[styles.assigneeChipText, on && styles.assigneeChipTextActive]}>
                        {empName}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <View style={styles.dualGrid}>
              {(['startDate', 'dueDate'] as const).map((k) => (
                <View key={k} style={styles.dualCol}>
                  <Text style={styles.inputLabel}>{k === 'startDate' ? 'Start Date' : 'Due Date'}</Text>
                  <TouchableOpacity
                    style={styles.datePickerBox}
                    activeOpacity={0.75}
                    onPress={() => setDateTarget(k)}
                  >
                    <Calendar size={14} color="#64748B" strokeWidth={2} />
                    <Text style={[styles.datePickerText, !form[k] && styles.datePickerPlaceholder]}>
                      {form[k] ? day(form[k]) : 'Select date'}
                    </Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Estimated Hours</Text>
              <TextInput
                style={styles.textInput}
                keyboardType="decimal-pad"
                value={form.estimatedHours}
                onChangeText={(v) => setForm({ ...form, estimatedHours: v.replace(/[^0-9.]/g, '') })}
                placeholder="e.g. 16"
                placeholderTextColor="#94A3B8"
              />
            </View>

            <TouchableOpacity
              style={[styles.submitRaiseBtn, busy === 'new' && { opacity: 0.7 }]}
              disabled={busy === 'new'}
              activeOpacity={0.85}
              onPress={raise}
            >
              {busy === 'new' ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Send size={16} color="#FFFFFF" strokeWidth={2.4} />
                  <Text style={styles.submitRaiseBtnText}>Submit Ticket</Text>
                </>
              )}
            </TouchableOpacity>
          </ScrollView>

          <DateTimePickerModal
            isVisible={!!dateTarget}
            mode="date"
            onConfirm={(d) => {
              if (dateTarget) setForm({ ...form, [dateTarget]: ymd(d) });
              setDateTarget(null);
            }}
            onCancel={() => setDateTarget(null)}
          />
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  filterBarContainer: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  filterScroll: {
    flexGrow: 0,
  },
  filterScrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    gap: 6,
  },
  chipActive: {
    borderColor: '#1373e5',
    backgroundColor: '#EFF6FF',
  },
  chipDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  chipText: {
    fontSize: 12.5,
    color: '#64748B',
    fontWeight: '600',
  },
  chipTextActive: {
    color: '#1373e5',
    fontWeight: '700',
  },
  listContent: {
    padding: 16,
    paddingBottom: 60,
    gap: 12,
  },
  listHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  listHeaderCount: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '600',
  },
  newTicketBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#1373e5',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    shadowColor: '#1373e5',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
    elevation: 3,
  },
  newTicketBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  loaderWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 60,
    gap: 12,
  },
  loaderText: {
    color: '#64748B',
    fontSize: 13.5,
    fontWeight: '500',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 24,
  },
  emptyIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#EFF6FF',
    borderWidth: 1.5,
    borderColor: '#DBEAFE',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 13.5,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 6,
    maxWidth: 300,
  },
  emptyActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#1373e5',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    marginTop: 18,
    shadowColor: '#1373e5',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  emptyActionBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  ticketCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 15,
    gap: 8,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  ticketCardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  headBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  ticketNumBadge: {
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 7.5,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E0E7FF',
  },
  ticketNumText: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#4338CA',
  },
  priorityBadge: {
    paddingHorizontal: 7.5,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  priorityBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 3.5,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusBadgeText: {
    fontSize: 11.5,
    fontWeight: '700',
  },
  ticketTitle: {
    fontSize: 15.5,
    fontWeight: '700',
    color: '#0F172A',
    lineHeight: 21,
  },
  ticketDesc: {
    fontSize: 13,
    color: '#475569',
    lineHeight: 18,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 7,
  },
  metaAvatar: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#E0E7FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaAvatarText: {
    fontSize: 8.5,
    fontWeight: '800',
    color: '#4338CA',
  },
  metaChipText: {
    fontSize: 11.5,
    color: '#475569',
    fontWeight: '600',
  },
  datesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F0F9FF',
    borderWidth: 1,
    borderColor: '#BAE6FD',
    paddingHorizontal: 9,
    paddingVertical: 4.5,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  datesRowText: {
    fontSize: 12,
    color: '#0369A1',
    fontWeight: '600',
  },
  convertedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: 9,
    padding: 9,
    marginTop: 2,
  },
  convertedBannerText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#15803D',
    flex: 1,
  },
  rejectionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 9,
    padding: 9,
    marginTop: 2,
  },
  rejectionBannerText: {
    fontSize: 12.5,
    color: '#991B1B',
    fontWeight: '600',
    flex: 1,
  },
  cardActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 10,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  cancelTicketBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#F8FAFC',
  },
  cancelTicketBtnText: {
    fontSize: 12,
    color: '#475569',
    fontWeight: '600',
  },
  adminActionGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rejectTicketBtn: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FECACA',
    backgroundColor: '#FEF2F2',
  },
  rejectTicketBtnText: {
    color: '#DC2626',
    fontWeight: '700',
    fontSize: 12.5,
  },
  approveTicketBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#16A34A',
  },
  approveTicketBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12.5,
  },
  waitingNoticeText: {
    fontSize: 12,
    color: '#94A3B8',
    fontStyle: 'italic',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'center',
    padding: 20,
  },
  dialogCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 20,
    gap: 12,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 5,
  },
  dialogHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dialogTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
  },
  dialogSubtitle: {
    fontSize: 13,
    color: '#64748B',
    lineHeight: 18,
  },
  dialogInput: {
    minHeight: 80,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    padding: 12,
    textAlignVertical: 'top',
    fontSize: 14,
    color: '#0F172A',
  },
  dialogActions: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'flex-end',
    marginTop: 4,
  },
  dialogBackBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  dialogBackBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#475569',
  },
  dialogRejectBtn: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 10,
    backgroundColor: '#DC2626',
  },
  dialogRejectBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  raiseModalContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    paddingTop: Platform.OS === 'ios' ? 44 : 16,
  },
  raiseModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  raiseCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  raiseModalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  raiseSendBtn: {
    backgroundColor: '#1373e5',
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  raiseSendBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13.5,
  },
  raiseBody: {
    padding: 18,
    gap: 14,
    paddingBottom: 60,
  },
  inputGroup: {
    gap: 6,
  },
  inputLabel: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#334155',
  },
  textInput: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 11,
    paddingHorizontal: 12,
    fontSize: 14,
    color: '#0F172A',
    backgroundColor: '#FFFFFF',
  },
  textAreaInput: {
    minHeight: 90,
    paddingTop: 10,
    textAlignVertical: 'top',
  },
  priorityChipsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  prioChip: {
    flex: 1,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
  },
  prioChipText: {
    fontSize: 12.5,
    color: '#64748B',
    fontWeight: '600',
  },
  assigneeChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  assigneeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
  },
  assigneeChipActive: {
    borderColor: '#1373e5',
    backgroundColor: '#EFF6FF',
  },
  assigneeAvatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  assigneeAvatarActive: {
    backgroundColor: '#DBEAFE',
  },
  assigneeAvatarText: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#475569',
  },
  assigneeAvatarTextActive: {
    color: '#1373e5',
  },
  assigneeChipText: {
    fontSize: 12.5,
    color: '#475569',
    fontWeight: '600',
  },
  assigneeChipTextActive: {
    color: '#0F172A',
    fontWeight: '700',
  },
  dualGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  dualCol: {
    flex: 1,
    gap: 6,
  },
  datePickerBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 46,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 11,
    paddingHorizontal: 12,
    backgroundColor: '#FFFFFF',
  },
  datePickerText: {
    fontSize: 13.5,
    fontWeight: '600',
    color: '#0F172A',
  },
  datePickerPlaceholder: {
    fontWeight: '400',
    color: '#94A3B8',
  },
  submitRaiseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#1373e5',
    marginTop: 8,
    shadowColor: '#1373e5',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  submitRaiseBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
});
