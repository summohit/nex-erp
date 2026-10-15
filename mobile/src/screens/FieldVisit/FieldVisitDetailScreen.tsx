import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, TextInput, Linking, RefreshControl,
} from 'react-native';
import DateTimePickerModal from 'react-native-modal-datetime-picker';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import {
  ArrowLeft,
  MapPin,
  Calendar,
  Clock,
  Users,
  CheckSquare,
  MessageSquare,
  Paperclip,
  ExternalLink,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  FolderKanban,
  Navigation,
  FileText,
  SlidersHorizontal,
  History,
  Pencil,
  RotateCcw,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  Trash2,
} from 'lucide-react-native';
import AppScreen from '../../components/AppScreen';
import {
  fieldVisitRequestService as fv, FieldVisitDetail, FvActivity, FvAttendance, FvApprovalEdits, ROSTER_DAY_OFF_CLASH,
} from '../../api/fieldVisitRequestService';
import ReasonSheet from './ReasonSheet';
import { theme } from '../../theme/theme';
import {
  fvStatus, FV_ACTIVITY, dateLabel, timeLabel, clockAt, whenLabel, range, who, metres, mapsUrl, initials,
} from './fvFormat';

/**
 * One field visit, end to end — the mobile counterpart of the web's request
 * detail: who asked, who is going, the tasks, the site, each person's days with
 * how far from the site they clocked, and the history.
 */
export default function FieldVisitDetailScreen() {
  const navigation = useNavigation<any>();
  const { id } = useRoute<any>().params as { id: number };
  const [visit, setVisit] = useState<FieldVisitDetail | null>(null);
  const [timeline, setTimeline] = useState<FvActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [isApprover, setIsApprover] = useState(false);
  // Which reason sheet is open, and for what.
  const [sheet, setSheet] = useState<null | 'reject' | 'cancel' | 'rejectChange' | { status: string }>(null);
  const [statusMenu, setStatusMenu] = useState(false);
  // Super Admin: correct a pending request while approving it.
  const [edit, setEdit] = useState<{ location: string; startDate: string; endDate: string; startTime: string; endTime: string; reason: string } | null>(null);
  const [editPicker, setEditPicker] = useState<null | 'startDate' | 'endDate' | 'startTime' | 'endTime'>(null);

  const load = useCallback(async () => {
    try {
      const [v, t, caps] = await Promise.all([
        fv.get(id), fv.timeline(id).catch(() => []), fv.capabilities().catch(() => null),
      ]);
      setVisit(v);
      setTimeline(t);
      setIsApprover(!!caps?.isApprover);
      setError(null);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Could not load this field visit.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  /** Each day of the trip, with everyone's attendance on it. */
  const days = useMemo(() => {
    const byDay = new Map<string, FvAttendance[]>();
    for (const a of visit?.attendances ?? []) {
      const key = a.visitDate.slice(0, 10);
      byDay.set(key, [...(byDay.get(key) ?? []), a]);
    }
    return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [visit]);

  const act = async (label: string, run: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await run();
      await load();
    } catch (e: any) {
      Alert.alert(`Could not ${label}`, e?.response?.data?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const withdraw = () =>
    Alert.alert('Withdraw request?', `${visit!.requestNumber} goes back to a draft.`, [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Withdraw', style: 'destructive', onPress: () => act('withdraw', () => fv.withdraw(id)) },
    ]);

  const sendForApproval = () =>
    act('send it', async () => {
      const saved = await fv.submit(id);
      Alert.alert(saved?.status === 'APPROVED' ? 'Approved' : 'Sent for approval',
        saved?.status === 'APPROVED' ? `${visit!.requestNumber} is approved.` : `${visit!.requestNumber} is waiting for approval.`);
    });

  const errorOf = (e: any) => {
    const m = e?.response?.data?.message;
    return Array.isArray(m) ? m.join('\n') : m || e?.message || 'Please try again.';
  };

  /**
   * Approve, with the same day-off rule as the web: if the trip lands on someone's
   * rostered day off, show which and offer to approve anyway (roster them on site).
   */
  const approve = async (override = false, edits?: FvApprovalEdits, editReason?: string) => {
    setBusy(true);
    try {
      await fv.approve(id, { overrideDayOff: override, edits, editReason });
      setEdit(null);
      await load();
      Alert.alert('Approved', `${visit!.requestNumber} is approved. Everyone on it has their tasks and days.`);
    } catch (e: any) {
      const data = e?.response?.data;
      if (!override && data?.code === ROSTER_DAY_OFF_CLASH) {
        Alert.alert('This trip falls on rostered days off', errorOf(e), [
          { text: 'Back', style: 'cancel' },
          { text: 'Approve and override days off', onPress: () => approve(true, edits, editReason) },
        ]);
      } else {
        Alert.alert('Could not approve', errorOf(e));
      }
    } finally {
      setBusy(false);
    }
  };

  /** Any administrator status move; APPROVED goes through the same day-off check. */
  const moveTo = async (status: string, reason?: string, override = false) => {
    setBusy(true);
    try {
      await fv.changeStatus(id, status, reason, override);
      setSheet(null);
      setStatusMenu(false);
      await load();
    } catch (e: any) {
      if (status === 'APPROVED' && !override && e?.response?.data?.code === ROSTER_DAY_OFF_CLASH) {
        Alert.alert('This trip falls on rostered days off', errorOf(e), [
          { text: 'Back', style: 'cancel' },
          { text: 'Approve and override days off', onPress: () => moveTo(status, reason, true) },
        ]);
      } else {
        Alert.alert('Could not change the status', errorOf(e));
      }
    } finally {
      setBusy(false);
    }
  };

  const onReason = (reason: string) => {
    if (sheet === 'reject') act('reject', async () => { await fv.reject(id, reason); setSheet(null); });
    else if (sheet === 'cancel') act('cancel', async () => { await fv.cancel(id, reason); setSheet(null); });
    else if (sheet === 'rejectChange') act('reject the change', async () => { await fv.rejectChange(id, reason); setSheet(null); });
    else if (sheet && typeof sheet === 'object') moveTo(sheet.status, reason || undefined);
  };

  const markComplete = () =>
    Alert.alert('Mark complete?', `${visit!.requestNumber} is closed as completed.`, [
      { text: 'Back', style: 'cancel' },
      { text: 'Mark complete', onPress: () => act('mark it complete', () => fv.complete(id)) },
    ]);

  const approveChange = () =>
    Alert.alert('Approve the change?', 'The visit, its people, tasks and days are updated to the proposal.', [
      { text: 'Back', style: 'cancel' },
      { text: 'Approve change', onPress: () => act('approve the change', () => fv.approveChange(id)) },
    ]);

  const startEdit = () => setEdit({
    location: visit!.location, startDate: visit!.startDate.slice(0, 10), endDate: visit!.endDate.slice(0, 10),
    startTime: visit!.startTime, endTime: visit!.endTime, reason: '',
  });

  /** Only what the Super Admin actually changed goes to the server. */
  const approveEdited = () => {
    if (!edit) return;
    const edits: FvApprovalEdits = {};
    if (edit.location.trim() !== visit!.location) edits.location = edit.location.trim();
    if (edit.startDate !== visit!.startDate.slice(0, 10)) edits.startDate = edit.startDate;
    if (edit.endDate !== visit!.endDate.slice(0, 10)) edits.endDate = edit.endDate;
    if (edit.startTime !== visit!.startTime) edits.startTime = edit.startTime;
    if (edit.endTime !== visit!.endTime) edits.endTime = edit.endTime;
    if (!Object.keys(edits).length) { Alert.alert('Nothing changed', 'Change something, or approve it as it is.'); return; }
    if (edit.endDate < edit.startDate) { Alert.alert('Check the dates', 'The end date is before the start date.'); return; }
    if (!edit.reason.trim()) { Alert.alert('Give a reason', 'Say why it was changed — the person who raised it is told.'); return; }
    approve(false, edits, edit.reason.trim());
  };

  const back = (
    <TouchableOpacity
      onPress={() => navigation.goBack()}
      style={styles.backButton}
      activeOpacity={0.7}
      accessibilityRole="button"
    >
      <ArrowLeft size={16} color="#0F172A" strokeWidth={2.4} />
      <Text style={styles.backButtonText}>Field Visits</Text>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <AppScreen title="Field Visit">
        {back}
        <View style={styles.centerLoader}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={styles.centerLoaderText}>Loading visit details…</Text>
        </View>
      </AppScreen>
    );
  }
  if (!visit) {
    return (
      <AppScreen title="Field Visit">
        {back}
        <View style={styles.errorBox}>
          <AlertTriangle size={32} color="#DC2626" />
          <Text style={styles.emptyTitle}>Could Not Load Visit</Text>
          <Text style={styles.emptyText}>{error}</Text>
        </View>
      </AppScreen>
    );
  }

  const s = fvStatus(visit.status);
  const canMoveStatus = isApprover;
  const radiusStr = metres(visit.geofenceRadiusM / 1000);

  return (
    <AppScreen title={visit.requestNumber} subtitle={visit.project?.isSystem ? 'General visit' : visit.project?.name}>
      <ScrollView
        contentContainerStyle={styles.scrollBody}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      >
        {/* Back Link */}
        {back}

        {/* Hero Card: Request Number, Project, Status */}
        <View style={styles.heroCard}>
          <View style={styles.heroHeaderRow}>
            <View style={styles.badgeRow}>
              <View style={styles.codeBadge}>
                <Text style={styles.codeBadgeText}>{visit.requestNumber}</Text>
              </View>
              <View style={styles.projectTag}>
                <FolderKanban size={12} color="#64748B" strokeWidth={2} />
                <Text style={styles.projectTagText} numberOfLines={1}>
                  {visit.project?.isSystem ? 'General visit' : visit.project?.name || 'General'}
                </Text>
              </View>
            </View>
            <View style={[styles.statusBadge, { backgroundColor: s.bg, borderColor: s.border }]}>
              <View style={[styles.statusDot, { backgroundColor: s.dot }]} />
              <Text style={[styles.statusBadgeText, { color: s.fg }]}>{s.label}</Text>
            </View>
          </View>

          {/* Pending change alert */}
          {!!visit.pendingChange && (
            <View style={styles.noticeBox}>
              <Clock size={16} color="#D97706" strokeWidth={2.2} />
              <Text style={styles.noticeText}>A change to this visit is waiting for approval.</Text>
            </View>
          )}

          {/* Rejection Alert */}
          {visit.status === 'REJECTED' && !!visit.rejectionReason && (
            <View style={styles.rejectionNotice}>
              <AlertTriangle size={16} color="#DC2626" strokeWidth={2.2} />
              <Text style={styles.rejectionNoticeText}>Rejected: {visit.rejectionReason}</Text>
            </View>
          )}
        </View>

        {/* Location Card */}
        <View style={styles.sectionCard}>
          <View style={styles.sectionCardHeader}>
            <View style={styles.sectionIconWrap}>
              <MapPin size={16} color="#0284C7" strokeWidth={2.2} />
            </View>
            <Text style={styles.sectionLabel}>VISIT LOCATION</Text>
          </View>
          <Text style={styles.siteMainTitle}>{visit.location}</Text>
          <View style={styles.geofenceChip}>
            <Navigation size={13} color="#15803D" strokeWidth={2.2} />
            <Text style={styles.geofenceChipText}>Target Geofence: within {radiusStr} of site</Text>
          </View>
          <TouchableOpacity
            style={styles.mapsOutlineBtn}
            activeOpacity={0.7}
            onPress={() => Linking.openURL(mapsUrl(visit.latitude, visit.longitude))}
          >
            <ExternalLink size={14} color="#1373e5" strokeWidth={2.2} />
            <Text style={styles.mapsOutlineBtnText}>Open site in Google Maps</Text>
          </TouchableOpacity>
        </View>

        {/* Schedule & Timing Card */}
        <View style={styles.sectionCard}>
          <View style={styles.scheduleGrid}>
            {/* Dates Col */}
            <View style={styles.scheduleCol}>
              <View style={styles.scheduleHeaderRow}>
                <Calendar size={14} color="#64748B" strokeWidth={2} />
                <Text style={styles.scheduleColLabel}>DATES & DURATION</Text>
              </View>
              <Text style={styles.scheduleColValue}>{range(visit)}</Text>
              <Text style={styles.scheduleColSub}>
                {visit.visitDays} day{visit.visitDays === 1 ? '' : 's'} on-site
              </Text>
            </View>

            {/* Hours Col */}
            <View style={styles.scheduleColDivider} />
            <View style={styles.scheduleCol}>
              <View style={styles.scheduleHeaderRow}>
                <Clock size={14} color="#64748B" strokeWidth={2} />
                <Text style={styles.scheduleColLabel}>SITE HOURS</Text>
              </View>
              <Text style={styles.scheduleColValue}>
                {timeLabel(visit.startTime)} – {timeLabel(visit.endTime)}
              </Text>
              <Text style={styles.scheduleColSub}>Daily work window</Text>
            </View>
          </View>
        </View>

        {/* Audit & Ownership Card */}
        <View style={styles.sectionCard}>
          <View style={styles.auditRow}>
            <View style={styles.auditAvatar}>
              <Text style={styles.auditAvatarText}>{initials(visit.raisedBy)}</Text>
            </View>
            <View style={styles.auditInfoCol}>
              <Text style={styles.auditRoleLabel}>RAISED BY</Text>
              <Text style={styles.auditPersonName}>{who(visit.raisedBy) || 'Requester'}</Text>
            </View>
          </View>

          {!!visit.reviewedBy && visit.reviewedAt && (
            <View style={[styles.auditRow, styles.auditRowSecondary]}>
              <View style={[styles.auditAvatar, { backgroundColor: '#ECFDF5' }]}>
                <Text style={[styles.auditAvatarText, { color: '#15803D' }]}>{initials(visit.reviewedBy)}</Text>
              </View>
              <View style={styles.auditInfoCol}>
                <View style={styles.verifiedRow}>
                  <Text style={styles.auditRoleLabel}>REVIEWED BY</Text>
                  <CheckCircle2 size={12} color="#16A34A" strokeWidth={2.4} />
                </View>
                <Text style={styles.auditPersonName}>
                  {who(visit.reviewedBy)} <Text style={styles.auditTimestamp}>· {whenLabel(visit.reviewedAt)}</Text>
                </Text>
              </View>
            </View>
          )}
        </View>

        {/* Team Members Section */}
        <View style={styles.sectionContainer}>
          <View style={styles.sectionHeaderBar}>
            <View style={styles.sectionHeaderLeft}>
              <Users size={16} color="#1373e5" strokeWidth={2.2} />
              <Text style={styles.sectionTitle}>People</Text>
            </View>
            <View style={styles.countBadgePill}>
              <Text style={styles.countBadgePillText}>{visit.members.length}</Text>
            </View>
          </View>
          <View style={styles.memberListWrap}>
            {visit.members.map((m) => (
              <View key={m.id} style={styles.memberItemCard}>
                <View style={styles.memberAvatar}>
                  <Text style={styles.memberAvatarText}>{initials(m.employee)}</Text>
                </View>
                <View style={styles.memberInfo}>
                  <Text style={styles.memberName}>{who(m.employee)}</Text>
                  <Text style={styles.memberRole}>Assigned Team Member</Text>
                </View>
                <View style={styles.assignedBadge}>
                  <Text style={styles.assignedBadgeText}>Assigned</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* Tasks Section */}
        <View style={styles.sectionContainer}>
          <View style={styles.sectionHeaderBar}>
            <View style={styles.sectionHeaderLeft}>
              <CheckSquare size={16} color="#7C3AED" strokeWidth={2.2} />
              <Text style={styles.sectionTitle}>Tasks</Text>
            </View>
            <View style={[styles.countBadgePill, { backgroundColor: '#FAF5FF' }]}>
              <Text style={[styles.countBadgePillText, { color: '#7E22CE' }]}>{visit.tasks.length}</Text>
            </View>
          </View>
          <View style={styles.taskListWrap}>
            {visit.tasks.map((t) => (
              <View key={t.id} style={styles.taskItemCard}>
                <View style={styles.taskKeyRow}>
                  <View style={styles.taskKeyPill}>
                    <Text style={styles.taskKeyPillText}>#{t.issue ? t.issue.key : 'TASK'}</Text>
                  </View>
                  {t.issue?.status && (
                    <View style={styles.taskStatusPill}>
                      <Text style={styles.taskStatusPillText}>{t.issue.status}</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.taskTitle}>{t.issue ? t.issue.title : t.name}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Remarks Section */}
        {!!visit.remarks && (
          <View style={styles.sectionContainer}>
            <View style={styles.sectionHeaderBar}>
              <View style={styles.sectionHeaderLeft}>
                <MessageSquare size={16} color="#D97706" strokeWidth={2.2} />
                <Text style={styles.sectionTitle}>Remarks</Text>
              </View>
            </View>
            <View style={styles.remarksCard}>
              <View style={styles.remarksBar} />
              <Text style={styles.remarksText}>{visit.remarks}</Text>
            </View>
          </View>
        )}

        {/* Attachments Section */}
        {(visit.attachments?.length ?? 0) > 0 && (
          <View style={styles.sectionContainer}>
            <View style={styles.sectionHeaderBar}>
              <View style={styles.sectionHeaderLeft}>
                <Paperclip size={16} color="#475569" strokeWidth={2.2} />
                <Text style={styles.sectionTitle}>Attachments</Text>
              </View>
              <View style={styles.countBadgePill}>
                <Text style={styles.countBadgePillText}>{visit.attachments!.length}</Text>
              </View>
            </View>
            {visit.attachments?.map((a, i) => (
              <TouchableOpacity
                key={a.id ?? i}
                style={styles.attachmentCard}
                activeOpacity={0.7}
                onPress={() => Linking.openURL(a.fileUrl)}
              >
                <View style={styles.attachmentIconWrap}>
                  <FileText size={16} color="#1373e5" strokeWidth={2} />
                </View>
                <Text style={styles.attachmentName} numberOfLines={1}>
                  {a.fileName}
                </Text>
                <ExternalLink size={14} color="#94A3B8" />
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Days on Site Attendance */}
        {days.length > 0 && (
          <View style={styles.sectionContainer}>
            <View style={styles.sectionHeaderBar}>
              <View style={styles.sectionHeaderLeft}>
                <Calendar size={16} color="#0284C7" strokeWidth={2.2} />
                <Text style={styles.sectionTitle}>Days on site</Text>
              </View>
              <View style={[styles.countBadgePill, { backgroundColor: '#F0F9FF' }]}>
                <Text style={[styles.countBadgePillText, { color: '#0284C7' }]}>{days.length}</Text>
              </View>
            </View>
            {days.map(([day, rows]) => (
              <View key={day} style={styles.dayGroupCard}>
                <View style={styles.dayGroupHeader}>
                  <Text style={styles.dayGroupDateText}>{dateLabel(day)}</Text>
                  {rows[0]?.isHoliday && (
                    <View style={styles.holidayBadge}>
                      <Text style={styles.holidayBadgeText}>🎉 Holiday</Text>
                    </View>
                  )}
                </View>

                {rows.map((a) => {
                  const hasIn = !!a.clockInTime;
                  const hasOut = !!a.clockOutTime;
                  return (
                    <View key={a.id} style={styles.attendanceMemberRow}>
                      <View style={styles.attendanceAvatar}>
                        <Text style={styles.attendanceAvatarText}>{initials(a.employee)}</Text>
                      </View>
                      <View style={styles.attendanceDetailsCol}>
                        <View style={styles.attendanceTopLine}>
                          <Text style={styles.attendanceMemberName}>{who(a.employee)}</Text>
                          <View style={[styles.attendanceStatusTag, {
                            backgroundColor: hasIn ? (hasOut ? '#F1F5F9' : '#DCFCE7') : '#F8FAFC',
                            borderColor: hasIn ? (hasOut ? '#E2E8F0' : '#86EFAC') : '#E2E8F0',
                          }]}>
                            <Text style={[styles.attendanceStatusTagText, {
                              color: hasIn ? (hasOut ? '#475569' : '#15803D') : '#64748B',
                            }]}>
                              {hasIn ? (hasOut ? 'Completed' : 'On Site') : a.status.replace(/_/g, ' ').toLowerCase()}
                            </Text>
                          </View>
                        </View>

                        {hasIn && (
                          <Text style={styles.attendanceClockLine}>
                            In <Text style={styles.boldText}>{clockAt(a.clockInTime)}</Text>
                            {a.clockInDistanceKm != null ? ` (${metres(a.clockInDistanceKm)})` : ''}
                            {hasOut && (
                              <Text> · Out <Text style={styles.boldText}>{clockAt(a.clockOutTime)}</Text>
                                {a.clockOutDistanceKm != null ? ` (${metres(a.clockOutDistanceKm)})` : ''}
                              </Text>
                            )}
                          </Text>
                        )}

                        {!!a.issue && (
                          <View style={styles.attendanceTaskLine}>
                            <Text style={styles.attendanceTaskText}>
                              #{a.issue.key} · {a.issue.title}
                            </Text>
                          </View>
                        )}
                      </View>
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
        )}

        {/* History / Timeline */}
        {timeline.length > 0 && (
          <View style={styles.sectionContainer}>
            <View style={styles.sectionHeaderBar}>
              <View style={styles.sectionHeaderLeft}>
                <History size={16} color="#475569" strokeWidth={2.2} />
                <Text style={styles.sectionTitle}>Activity History</Text>
              </View>
            </View>
            <View style={styles.timelineCard}>
              {timeline.map((t, idx) => (
                <View key={t.id} style={styles.timelineRow}>
                  <View style={styles.timelineVisualCol}>
                    <View style={styles.timelineDot} />
                    {idx < timeline.length - 1 && <View style={styles.timelineLine} />}
                  </View>
                  <View style={styles.timelineTextCol}>
                    <Text style={styles.timelineWhatText}>{t.detail || FV_ACTIVITY[t.action] || t.action}</Text>
                    <Text style={styles.timelineMetaText}>
                      {t.actor ? `${who(t.actor)} · ` : ''}{whenLabel(t.createdAt)}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Proposed Change Section */}
        {!!visit.pendingChange && (
          <View style={styles.changeBoxCard}>
            <View style={styles.changeBoxHeader}>
              <AlertTriangle size={17} color="#D97706" strokeWidth={2.2} />
              <Text style={styles.changeTitle}>Proposed Modification</Text>
            </View>
            <View style={styles.changeRowsWrap}>
              {changeRows(visit).map(([label, from, to]) => (
                <View key={label} style={styles.changeComparisonRow}>
                  <Text style={styles.changeFieldLabel}>{label}</Text>
                  <View style={styles.changeValuesRow}>
                    <Text style={styles.changeFromValue}>{from}</Text>
                    <Text style={styles.changeArrow}>→</Text>
                    <Text style={styles.changeToValue}>{to}</Text>
                  </View>
                </View>
              ))}
            </View>
            {visit.canReviewChange && (
              <View style={styles.rowBtns}>
                <TouchableOpacity
                  style={[styles.halfBtn, styles.approveBtn]}
                  activeOpacity={0.8}
                  disabled={busy}
                  onPress={approveChange}
                >
                  <Text style={styles.solidBtnText}>Approve Change</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.halfBtn, styles.rejectBtn]}
                  activeOpacity={0.8}
                  disabled={busy}
                  onPress={() => setSheet('rejectChange')}
                >
                  <Text style={styles.rejectBtnText}>Reject Change</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {/* Super Admin Inline Edit Box */}
        {edit && (
          <View style={styles.editBoxCard}>
            <Text style={styles.changeTitle}>Correct, then approve</Text>
            <Text style={styles.inputLabel}>Site name</Text>
            <TextInput
              style={styles.textInput}
              value={edit.location}
              onChangeText={(v) => setEdit({ ...edit, location: v })}
            />
            <View style={styles.rowBtns}>
              <TouchableOpacity
                style={[styles.textInput, styles.flexInput]}
                onPress={() => setEditPicker('startDate')}
              >
                <Text style={styles.pickerText}>From {dateLabel(edit.startDate)}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.textInput, styles.flexInput]}
                onPress={() => setEditPicker('endDate')}
              >
                <Text style={styles.pickerText}>To {dateLabel(edit.endDate)}</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.rowBtns}>
              <TouchableOpacity
                style={[styles.textInput, styles.flexInput]}
                onPress={() => setEditPicker('startTime')}
              >
                <Text style={styles.pickerText}>In {timeLabel(edit.startTime)}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.textInput, styles.flexInput]}
                onPress={() => setEditPicker('endTime')}
              >
                <Text style={styles.pickerText}>Out {timeLabel(edit.endTime)}</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.inputLabel}>Why it was changed *</Text>
            <TextInput
              style={[styles.textInput, styles.textArea]}
              value={edit.reason}
              multiline
              placeholder="The person who raised it is told"
              onChangeText={(v) => setEdit({ ...edit, reason: v })}
            />
            <TouchableOpacity
              style={[styles.primaryActionBtn, styles.approveBtn]}
              activeOpacity={0.85}
              disabled={busy}
              onPress={approveEdited}
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.solidBtnText}>Approve with changes</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setEdit(null)} style={styles.discardBtn}>
              <Text style={styles.discardBtnText}>Discard changes</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Action Controls Section */}
        <View style={styles.actionsContainer}>
          {visit.canReview && !edit && (
            <View style={styles.rowBtns}>
              <TouchableOpacity
                style={[styles.halfBtn, styles.approveBtn]}
                activeOpacity={0.85}
                disabled={busy}
                onPress={() => approve()}
              >
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <View style={styles.btnContentRow}>
                    <Check size={18} color="#FFFFFF" strokeWidth={2.6} />
                    <Text style={styles.solidBtnText}>Approve</Text>
                  </View>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.halfBtn, styles.rejectBtn]}
                activeOpacity={0.85}
                disabled={busy}
                onPress={() => setSheet('reject')}
              >
                <View style={styles.btnContentRow}>
                  <X size={18} color="#DC2626" strokeWidth={2.4} />
                  <Text style={styles.rejectBtnText}>Reject</Text>
                </View>
              </TouchableOpacity>
            </View>
          )}

          {visit.canReview && visit.canEdit && visit.status === 'PENDING_APPROVAL' && !edit && (
            <TouchableOpacity
              style={styles.outlineActionBtn}
              activeOpacity={0.8}
              disabled={busy}
              onPress={startEdit}
            >
              <Pencil size={16} color="#334155" strokeWidth={2} />
              <Text style={styles.outlineActionBtnText}>Edit and approve (Super Admin)</Text>
            </TouchableOpacity>
          )}

          {visit.canComplete && (
            <TouchableOpacity
              style={[styles.primaryActionBtn, styles.approveBtn]}
              activeOpacity={0.85}
              disabled={busy}
              onPress={markComplete}
            >
              <CheckCircle2 size={18} color="#FFFFFF" strokeWidth={2.4} />
              <Text style={styles.solidBtnText}>Mark visit complete</Text>
            </TouchableOpacity>
          )}

          {visit.canSubmit && (
            <TouchableOpacity
              style={styles.primaryActionBtn}
              activeOpacity={0.85}
              disabled={busy}
              onPress={sendForApproval}
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.solidBtnText}>Send for approval</Text>}
            </TouchableOpacity>
          )}

          {visit.canEdit && visit.status === 'DRAFT' && (
            <TouchableOpacity
              style={styles.outlineActionBtn}
              activeOpacity={0.8}
              disabled={busy}
              onPress={() => navigation.navigate('FieldVisitRequestForm', { mode: 'edit', id })}
            >
              <Pencil size={16} color="#334155" strokeWidth={2} />
              <Text style={styles.outlineActionBtnText}>Edit draft</Text>
            </TouchableOpacity>
          )}

          {visit.canRequestChange && (
            <TouchableOpacity
              style={styles.outlineActionBtn}
              activeOpacity={0.8}
              disabled={busy}
              onPress={() => navigation.navigate('FieldVisitRequestForm', { mode: 'change', id })}
            >
              <Pencil size={16} color="#334155" strokeWidth={2} />
              <Text style={styles.outlineActionBtnText}>Request a change</Text>
            </TouchableOpacity>
          )}

          {visit.canWithdraw && (
            <TouchableOpacity
              style={styles.outlineActionBtn}
              activeOpacity={0.8}
              disabled={busy}
              onPress={withdraw}
            >
              <RotateCcw size={16} color="#334155" strokeWidth={2} />
              <Text style={styles.outlineActionBtnText}>Withdraw to draft</Text>
            </TouchableOpacity>
          )}

          {visit.canCancel && (
            <TouchableOpacity
              style={[styles.outlineActionBtn, styles.dangerOutlineBtn]}
              activeOpacity={0.8}
              disabled={busy}
              onPress={() => setSheet('cancel')}
            >
              <Trash2 size={16} color="#DC2626" strokeWidth={2} />
              <Text style={styles.dangerOutlineBtnText}>Cancel this visit</Text>
            </TouchableOpacity>
          )}

          {canMoveStatus && (
            <TouchableOpacity
              style={styles.statusToggleBtn}
              activeOpacity={0.7}
              onPress={() => setStatusMenu((v) => !v)}
              disabled={busy}
            >
              <SlidersHorizontal size={15} color="#1373e5" strokeWidth={2} />
              <Text style={styles.statusToggleText}>
                {statusMenu ? 'Hide status controls' : 'Change status (Admin)'}
              </Text>
              {statusMenu ? (
                <ChevronUp size={15} color="#1373e5" />
              ) : (
                <ChevronDown size={15} color="#1373e5" />
              )}
            </TouchableOpacity>
          )}

          {statusMenu && (
            <View style={styles.statusMenuCard}>
              {STATUS_TARGETS.filter((t) => t.value !== visit.status).map((t) => (
                <TouchableOpacity
                  key={t.value}
                  style={styles.statusMenuItem}
                  activeOpacity={0.75}
                  disabled={busy}
                  onPress={() => (t.reason ? setSheet({ status: t.value }) : moveTo(t.value))}
                >
                  <Text style={styles.statusMenuItemText}>Move status to {t.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      <ReasonSheet
        visible={!!sheet}
        title={sheet === 'reject' ? 'Reject this request' : sheet === 'cancel' ? 'Cancel this visit'
          : sheet === 'rejectChange' ? 'Reject the change' : `Move to ${STATUS_TARGETS.find((t) => typeof sheet === 'object' && sheet && t.value === sheet.status)?.label ?? ''}`}
        message={sheet === 'cancel' ? 'Everyone on it is told.' : sheet === 'reject' || sheet === 'rejectChange' ? 'The person who raised it sees this reason.' : undefined}
        confirmLabel={sheet === 'reject' ? 'Reject' : sheet === 'cancel' ? 'Cancel visit' : sheet === 'rejectChange' ? 'Reject change' : 'Change status'}
        danger
        required={sheet === 'reject' || sheet === 'rejectChange'}
        busy={busy}
        onSubmit={onReason}
        onClose={() => setSheet(null)}
      />

      <DateTimePickerModal
        isVisible={!!editPicker}
        mode={editPicker === 'startDate' || editPicker === 'endDate' ? 'date' : 'time'}
        date={(() => {
          if (!edit || !editPicker) return new Date();
          if (editPicker === 'startDate' || editPicker === 'endDate') return new Date(`${edit[editPicker]}T00:00:00`);
          const [h, m] = edit[editPicker].split(':').map(Number); const d = new Date(); d.setHours(h, m, 0, 0); return d;
        })()}
        onConfirm={(d) => {
          if (edit && editPicker) {
            const v = editPicker === 'startDate' || editPicker === 'endDate'
              ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
              : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
            setEdit({ ...edit, [editPicker]: v });
          }
          setEditPicker(null);
        }}
        onCancel={() => setEditPicker(null)}
      />
    </AppScreen>
  );
}

/** Where an administrator may move a request (server changeStatus); `reason` asks for one first. */
const STATUS_TARGETS: { value: string; label: string; reason: boolean }[] = [
  { value: 'PENDING_APPROVAL', label: 'Waiting approval', reason: false },
  { value: 'APPROVED', label: 'Approved', reason: false },
  { value: 'REJECTED', label: 'Rejected', reason: true },
  { value: 'CANCELLED', label: 'Cancelled', reason: true },
  { value: 'COMPLETED', label: 'Completed', reason: false },
];

/** A proposed change, as "what → what" lines for the fields that differ. */
function changeRows(v: FieldVisitDetail): [string, string, string][] {
  const c = v.pendingChange || {};
  const rows: [string, string, string][] = [];
  if (c.location && c.location !== v.location) rows.push(['Site Location', v.location, c.location]);
  const from = range(v);
  const to = c.startDate && c.endDate ? range({ startDate: c.startDate, endDate: c.endDate }) : from;
  if (to !== from) rows.push(['Visit Dates', from, to]);
  const hours = `${timeLabel(v.startTime)} – ${timeLabel(v.endTime)}`;
  const newHours = `${timeLabel(c.startTime ?? v.startTime)} – ${timeLabel(c.endTime ?? v.endTime)}`;
  if (newHours !== hours) rows.push(['Site Hours', hours, newHours]);
  if (Array.isArray(c.employeeIds)) {
    const now = v.members.map((m) => m.employee.id).sort().join(',');
    if ([...c.employeeIds].sort().join(',') !== now) rows.push(['People Count', `${v.members.length} members`, `${c.employeeIds.length} members`]);
  }
  if (Array.isArray(c.tasks) && c.tasks.length !== v.tasks.length) rows.push(['Tasks Count', `${v.tasks.length} tasks`, `${c.tasks.length} tasks`]);
  if (!rows.length) rows.push(['Details', 'as approved', 'see the request']);
  return rows;
}

const styles = StyleSheet.create({
  scrollBody: {
    padding: 16,
    paddingBottom: 140,
    gap: 14,
  },
  centerLoader: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 60,
    gap: 12,
  },
  centerLoaderText: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: '500',
  },
  errorBox: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 30,
    gap: 10,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
  },
  emptyText: {
    fontSize: 13.5,
    color: '#64748B',
    textAlign: 'center',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    alignSelf: 'flex-start',
  },
  backButtonText: {
    color: '#0F172A',
    fontWeight: '700',
    fontSize: 14,
  },
  heroCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
    gap: 10,
  },
  heroHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  codeBadge: {
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 8,
    paddingVertical: 3.5,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#E0E7FF',
  },
  codeBadgeText: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#4338CA',
    letterSpacing: 0.2,
  },
  projectTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4.5,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 7.5,
    paddingVertical: 3.5,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    maxWidth: '55%',
  },
  projectTagText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5.5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusDot: {
    width: 6.5,
    height: 6.5,
    borderRadius: 3.25,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  noticeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    padding: 10,
    borderRadius: 10,
  },
  noticeText: {
    fontSize: 12.5,
    color: '#92400E',
    fontWeight: '600',
    flex: 1,
  },
  rejectionNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 10,
    padding: 10,
  },
  rejectionNoticeText: {
    fontSize: 13,
    color: '#991B1B',
    fontWeight: '600',
    flex: 1,
  },
  sectionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
    gap: 8,
  },
  sectionCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  sectionIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 7,
    backgroundColor: '#F0F9FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionLabel: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.5,
  },
  siteMainTitle: {
    fontSize: 16.5,
    fontWeight: '700',
    color: '#0F172A',
    lineHeight: 23,
    marginTop: 2,
  },
  geofenceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    paddingHorizontal: 8,
    paddingVertical: 4.5,
    borderRadius: 7,
    marginTop: 2,
  },
  geofenceChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#15803D',
  },
  mapsOutlineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginTop: 4,
  },
  mapsOutlineBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1373e5',
  },
  scheduleGrid: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  scheduleCol: {
    flex: 1,
    gap: 4,
  },
  scheduleColDivider: {
    width: 1,
    backgroundColor: '#F1F5F9',
    alignSelf: 'stretch',
    marginHorizontal: 14,
  },
  scheduleHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 2,
  },
  scheduleColLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.4,
  },
  scheduleColValue: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#0F172A',
  },
  scheduleColSub: {
    fontSize: 11.5,
    color: '#64748B',
  },
  auditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  auditRowSecondary: {
    paddingTop: 10,
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  auditAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  auditAvatarText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#4338CA',
  },
  auditInfoCol: {
    flex: 1,
  },
  auditRoleLabel: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#94A3B8',
    letterSpacing: 0.4,
  },
  auditPersonName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    marginTop: 1,
  },
  verifiedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  auditTimestamp: {
    fontWeight: '400',
    color: '#64748B',
    fontSize: 12.5,
  },
  sectionContainer: {
    gap: 8,
  },
  sectionHeaderBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#1E293B',
    letterSpacing: -0.1,
  },
  countBadgePill: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  countBadgePillText: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#1373e5',
  },
  memberListWrap: {
    gap: 8,
  },
  memberItemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  memberAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#DBEAFE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberAvatarText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#1373e5',
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    fontSize: 14.5,
    fontWeight: '700',
    color: '#0F172A',
  },
  memberRole: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 1,
  },
  assignedBadge: {
    backgroundColor: '#F0FDF4',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  assignedBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#15803D',
  },
  taskListWrap: {
    gap: 8,
  },
  taskItemCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 13,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 5,
  },
  taskKeyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  taskKeyPill: {
    backgroundColor: '#FAF5FF',
    paddingHorizontal: 7.5,
    paddingVertical: 2.5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E9D5FF',
  },
  taskKeyPillText: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#7E22CE',
  },
  taskStatusPill: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6.5,
    paddingVertical: 2,
    borderRadius: 6,
  },
  taskStatusPillText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#64748B',
  },
  taskTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1E293B',
    lineHeight: 19,
  },
  remarksCard: {
    flexDirection: 'row',
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 14,
    overflow: 'hidden',
  },
  remarksBar: {
    width: 4,
    backgroundColor: '#F59E0B',
  },
  remarksText: {
    flex: 1,
    fontSize: 13.5,
    color: '#78350F',
    lineHeight: 20,
    padding: 12,
  },
  attachmentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  attachmentIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachmentName: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: '600',
    color: '#1373e5',
  },
  dayGroupCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 8,
    gap: 10,
  },
  dayGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  dayGroupDateText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  holidayBadge: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  holidayBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#92400E',
  },
  attendanceMemberRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  attendanceAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  attendanceAvatarText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#475569',
  },
  attendanceDetailsCol: {
    flex: 1,
  },
  attendanceTopLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  attendanceMemberName: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#0F172A',
  },
  attendanceStatusTag: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  attendanceStatusTagText: {
    fontSize: 11,
    fontWeight: '700',
  },
  attendanceClockLine: {
    fontSize: 12.5,
    color: '#64748B',
    marginTop: 2,
  },
  boldText: {
    fontWeight: '700',
    color: '#1E293B',
  },
  attendanceTaskLine: {
    marginTop: 3,
  },
  attendanceTaskText: {
    fontSize: 11.5,
    color: '#7C3AED',
    fontWeight: '600',
  },
  timelineCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  timelineRow: {
    flexDirection: 'row',
    gap: 12,
  },
  timelineVisualCol: {
    alignItems: 'center',
    width: 16,
  },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#1373e5',
    marginTop: 5,
  },
  timelineLine: {
    width: 2,
    flex: 1,
    backgroundColor: '#E2E8F0',
    marginVertical: 4,
  },
  timelineTextCol: {
    flex: 1,
    paddingBottom: 14,
  },
  timelineWhatText: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#0F172A',
  },
  timelineMetaText: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  changeBoxCard: {
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 16,
    padding: 14,
    gap: 10,
  },
  changeBoxHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  changeTitle: {
    fontSize: 14.5,
    fontWeight: '800',
    color: '#92400E',
  },
  changeRowsWrap: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 10,
    gap: 8,
  },
  changeComparisonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  changeFieldLabel: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#64748B',
  },
  changeValuesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  changeFromValue: {
    fontSize: 12.5,
    color: '#94A3B8',
    textDecorationLine: 'line-through',
  },
  changeArrow: {
    fontSize: 12,
    color: '#64748B',
  },
  changeToValue: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#0F172A',
  },
  editBoxCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 8,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
    marginTop: 4,
  },
  textInput: {
    minHeight: 44,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 12,
    justifyContent: 'center',
    fontSize: 13.5,
    color: '#0F172A',
  },
  pickerText: {
    fontSize: 13,
    color: '#0F172A',
    fontWeight: '500',
  },
  flexInput: {
    flex: 1,
  },
  textArea: {
    minHeight: 70,
    paddingTop: 10,
    textAlignVertical: 'top',
  },
  discardBtn: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  discardBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  actionsContainer: {
    gap: 10,
    marginTop: 6,
  },
  rowBtns: {
    flexDirection: 'row',
    gap: 10,
  },
  halfBtn: {
    flex: 1,
    height: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnContentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  approveBtn: {
    backgroundColor: '#16A34A',
    shadowColor: '#16A34A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  rejectBtn: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  solidBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14.5,
  },
  rejectBtnText: {
    color: '#DC2626',
    fontWeight: '700',
    fontSize: 14.5,
  },
  primaryActionBtn: {
    height: 46,
    borderRadius: 12,
    backgroundColor: '#1373e5',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 7,
    shadowColor: '#1373e5',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  outlineActionBtn: {
    height: 46,
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  outlineActionBtnText: {
    color: '#334155',
    fontWeight: '700',
    fontSize: 14,
  },
  dangerOutlineBtn: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  dangerOutlineBtnText: {
    color: '#DC2626',
    fontWeight: '700',
    fontSize: 14,
  },
  statusToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    marginTop: 4,
  },
  statusToggleText: {
    color: '#1373e5',
    fontWeight: '700',
    fontSize: 13.5,
  },
  statusMenuCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
  },
  statusMenuItem: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  statusMenuItemText: {
    fontSize: 13.5,
    fontWeight: '600',
    color: '#0F172A',
  },
});
