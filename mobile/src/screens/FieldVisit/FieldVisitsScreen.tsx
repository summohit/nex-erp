import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator, Alert, Linking,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import {
  MapPin,
  Calendar,
  Clock,
  Users,
  CheckCircle2,
  AlertTriangle,
  ChevronRight,
  Plus,
  ExternalLink,
  Briefcase,
  FolderKanban,
  LogIn,
  LogOut,
  CheckSquare,
  Square,
} from 'lucide-react-native';
import AppScreen from '../../components/AppScreen';
import {
  fieldVisitRequestService as fv, FieldVisitRequest, FvDay, FvCapabilities, VisitLocationRequest, ROSTER_DAY_OFF_CLASH,
} from '../../api/fieldVisitRequestService';
import ReasonSheet from './ReasonSheet';
import JourneyPanel from './JourneyPanel';
import { getCurrentLocation, requestLocationPermission } from '../../store/dashboardStore';
import { theme } from '../../theme/theme';
import { fvStatus, timeLabel, clockAt, range, mapsUrl, who, initials } from './fvFormat';

type Tab = 'TODAY' | 'MINE' | 'APPROVALS';

export default function FieldVisitsScreen() {
  const navigation = useNavigation<any>();
  const [tab, setTab] = useState<Tab>('TODAY');
  const [days, setDays] = useState<FvDay[]>([]);
  const [mine, setMine] = useState<FieldVisitRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [taskFor, setTaskFor] = useState<Record<number, number | undefined>>({});
  // Administrators: what waits on them, and bulk decisions on it.
  const [caps, setCaps] = useState<FvCapabilities | null>(null);
  const [siteRequests, setSiteRequests] = useState<VisitLocationRequest[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [sheet, setSheet] = useState<null | { kind: 'bulkReject' } | { kind: 'siteReject'; id: number }>(null);

  const load = useCallback(async () => {
    const [t, m, c] = await Promise.allSettled([fv.today(), fv.list(), fv.capabilities()]);
    if (t.status === 'fulfilled') setDays(t.value);
    if (m.status === 'fulfilled') setMine(m.value);
    if (c.status === 'fulfilled') {
      setCaps(c.value);
      if (c.value.isApprover) {
        fv.locationRequests().then((rows) => setSiteRequests(rows.filter((r) => r.status === 'PENDING'))).catch(() => {});
      }
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  const approver = !!caps?.isApprover;
  // Raising visits is for project managers and administrators; employees see
  // their own visits and clock in and out. (Older servers lack canRaise.)
  const canRaise = caps ? (caps.canRaise ?? caps.isProjectManager) : false;
  /** Waiting on an administrator: new requests, and changes to approved ones. */
  const awaiting = useMemo(
    () => mine.filter((r) => r.status === 'PENDING_APPROVAL' || !!r.pendingChange)
      .sort((a, b) => a.startDate.localeCompare(b.startDate)),
    [mine],
  );
  const pendingIds = awaiting.filter((r) => r.status === 'PENDING_APPROVAL').map((r) => r.id);
  const toggle = (id: number) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  /** Approve several; any that land on a rostered day off are offered the same override as one at a time. */
  const bulkApprove = async (ids: number[], override = false) => {
    setBulkBusy(true);
    try {
      const results = await fv.bulkStatus(ids, 'APPROVED', undefined, override);
      const ok = results.filter((r) => r.success).length;
      const dayOff = results.filter((r) => !r.success && r.code === ROSTER_DAY_OFF_CLASH);
      const other = results.filter((r) => !r.success && r.code !== ROSTER_DAY_OFF_CLASH);
      await load();
      setSelected([]);
      if (dayOff.length && !override) {
        Alert.alert(
          `${dayOff.length} visit${dayOff.length > 1 ? 's fall' : ' falls'} on rostered days off`,
          dayOff.map((f) => f.error).join('\n\n'),
          [{ text: 'Leave them', style: 'cancel' },
            { text: 'Approve and override days off', onPress: () => bulkApprove(dayOff.map((f) => f.id), true) }],
        );
      } else {
        Alert.alert(`${ok} of ${results.length} approved`, other.map((f) => f.error).filter(Boolean).join('\n\n') || undefined);
      }
    } catch (e: any) {
      Alert.alert('Could not approve', e?.response?.data?.message || 'Please try again.');
    } finally {
      setBulkBusy(false);
    }
  };

  const onReason = async (reason: string) => {
    if (!sheet) return;
    setBulkBusy(true);
    try {
      if (sheet.kind === 'bulkReject') {
        const results = await fv.bulkStatus(selected, 'REJECTED', reason);
        const failed = results.filter((r) => !r.success);
        Alert.alert(`${results.length - failed.length} of ${results.length} rejected`, failed.map((f) => f.error).join('\n\n') || undefined);
        setSelected([]);
      } else {
        await fv.reviewLocation(sheet.id, 'REJECTED', reason);
      }
      setSheet(null);
      await load();
    } catch (e: any) {
      Alert.alert('Could not do that', e?.response?.data?.message || 'Please try again.');
    } finally {
      setBulkBusy(false);
    }
  };

  const approveSite = (r: VisitLocationRequest) =>
    Alert.alert('Approve this site?', `${r.name} becomes a saved site everyone can pick.`, [
      { text: 'Back', style: 'cancel' },
      { text: 'Approve', onPress: async () => {
        try { await fv.reviewLocation(r.id, 'APPROVED'); await load(); } catch (e: any) {
          Alert.alert('Could not approve', e?.response?.data?.message || 'Please try again.');
        }
      } },
    ]);

  // Back from the request form: show what was just raised.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const locate = async () => {
    if (!(await requestLocationPermission())) throw new Error('Allow location for MIRA to clock in at the site.');
    return getCurrentLocation();
  };

  const clock = async (day: FvDay, direction: 'in' | 'out') => {
    if (direction === 'in' && day.tasks.length > 1 && !taskFor[day.request.id]) {
      Alert.alert('Pick a task', 'Choose the task you are working on at the site first.');
      return;
    }
    setBusy(day.id);
    try {
      const fix = await locate();
      const body = { requestId: day.request.id, lat: fix.lat, lng: fix.lng, accuracy: Math.round(fix.accuracy) };
      if (direction === 'in') {
        await fv.clockIn({ ...body, issueId: taskFor[day.request.id] ?? day.tasks[0]?.id });
      } else {
        await fv.clockOut(body);
      }
      Alert.alert(direction === 'in' ? 'Clocked in' : 'Clocked out', `${day.request.location}`);
      load();
    } catch (e: any) {
      // The server's own sentence: "You are outside the approved Field Visit
      // location… You are 1.4km from …" is the useful part.
      Alert.alert(direction === 'in' ? 'Could not clock in' : 'Could not clock out', e?.response?.data?.message || e?.message || 'Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const mineSorted = useMemo(() => [...mine].sort((a, b) => b.startDate.localeCompare(a.startDate)), [mine]);

  const renderDay = ({ item: d }: { item: FvDay }) => {
    const inside = !!d.clockInTime && !d.clockOutTime;
    const done = !!d.clockOutTime;
    const radiusStr = d.request.geofenceRadiusM >= 1000 ? `${(d.request.geofenceRadiusM / 1000).toFixed(1)} km` : `${d.request.geofenceRadiusM} m`;

    return (
      <View style={styles.card}>
        {/* Top Header Row */}
        <View style={styles.cardHeader}>
          <View style={styles.badgeRow}>
            <View style={styles.codeBadge}>
              <Text style={styles.codeBadgeText}>{d.request.requestNumber}</Text>
            </View>
            <View style={styles.projectTag}>
              <FolderKanban size={12} color="#64748B" strokeWidth={2} />
              <Text style={styles.projectTagText} numberOfLines={1}>
                {d.request.project?.name || 'General visit'}
              </Text>
            </View>
          </View>
          <View style={[styles.statusBadge, {
            backgroundColor: inside ? '#DCFCE7' : done ? '#F1F5F9' : '#EFF6FF',
            borderColor: inside ? '#86EFAC' : done ? '#E2E8F0' : '#BFDBFE',
          }]}>
            <View style={[styles.statusDot, {
              backgroundColor: inside ? '#16A34A' : done ? '#64748B' : '#2563EB',
            }]} />
            <Text style={[styles.statusBadgeText, {
              color: inside ? '#15803D' : done ? '#475569' : '#1D4ED8',
            }]}>
              {inside ? 'On Site' : done ? 'Completed' : 'Today'}
            </Text>
          </View>
        </View>

        {/* Location Section */}
        <View style={styles.locationSection}>
          <View style={styles.locationIconWrap}>
            <MapPin size={18} color="#0284C7" strokeWidth={2.2} />
          </View>
          <View style={styles.locationContent}>
            <Text style={styles.siteTitle}>{d.request.location}</Text>
            <Text style={styles.geofenceText}>
              Within {radiusStr} · {timeLabel(d.request.startTime)} – {timeLabel(d.request.endTime)}
            </Text>
          </View>
        </View>

        {/* Maps Button */}
        <TouchableOpacity
          style={styles.mapsPillBtn}
          activeOpacity={0.7}
          onPress={() => Linking.openURL(mapsUrl(d.request.latitude, d.request.longitude))}
        >
          <ExternalLink size={13} color="#1373e5" strokeWidth={2.2} />
          <Text style={styles.mapsPillBtnText}>Open site in Google Maps</Text>
        </TouchableOpacity>

        {/* Task Selection */}
        {!d.clockInTime && d.tasks.length > 0 && (
          <View style={styles.taskPickerContainer}>
            <Text style={styles.sectionSmallTitle}>Select Active Task</Text>
            {d.tasks.map((t) => {
              const on = (taskFor[d.request.id] ?? (d.tasks.length === 1 ? t.id : undefined)) === t.id;
              return (
                <TouchableOpacity
                  key={t.id}
                  style={[styles.taskOptionCard, on && styles.taskOptionCardActive]}
                  activeOpacity={0.75}
                  onPress={() => setTaskFor((p) => ({ ...p, [d.request.id]: t.id }))}
                >
                  <View style={[styles.taskRadioCircle, on && styles.taskRadioCircleActive]}>
                    {on && <View style={styles.taskRadioInner} />}
                  </View>
                  <View style={styles.taskInfoCol}>
                    <Text style={[styles.taskKeyBadge, on && styles.taskKeyBadgeActive]}>
                      #{t.key}
                    </Text>
                    <Text style={[styles.taskTitleText, on && styles.taskTitleTextActive]} numberOfLines={1}>
                      {t.title}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Clock In / Out Log */}
        {!!d.clockInTime && (
          <View style={styles.attendanceLogBox}>
            <View style={styles.logRow}>
              <View style={[styles.logIndicator, { backgroundColor: '#16A34A' }]} />
              <Text style={styles.logText}>
                Clocked in at <Text style={styles.logBold}>{clockAt(d.clockInTime)}</Text>
                {d.clockInDistanceKm != null ? ` (${Math.round(d.clockInDistanceKm * 1000)}m from site)` : ''}
              </Text>
            </View>
            {d.clockOutTime && (
              <View style={[styles.logRow, { marginTop: 6 }]}>
                <View style={[styles.logIndicator, { backgroundColor: '#64748B' }]} />
                <Text style={styles.logText}>
                  Clocked out at <Text style={styles.logBold}>{clockAt(d.clockOutTime)}</Text>
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Travel allowance: Start / End journey (Delhi NCR visits) */}
        {d.request.travelZone === 'DELHI_NCR' && <JourneyPanel day={d} onChanged={load} />}

        {/* Clock In/Out Action Button */}
        {!done && (
          <TouchableOpacity
            style={[styles.primaryActionBtn, inside && styles.dangerActionBtn]}
            activeOpacity={0.85}
            disabled={busy === d.id}
            onPress={() => clock(d, inside ? 'out' : 'in')}
          >
            {busy === d.id ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <View style={styles.btnRow}>
                {inside ? (
                  <LogOut size={18} color="#FFFFFF" strokeWidth={2.4} />
                ) : (
                  <LogIn size={18} color="#FFFFFF" strokeWidth={2.4} />
                )}
                <Text style={styles.primaryActionBtnText}>
                  {inside ? 'Clock out at site' : 'Clock in at site'}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        )}

        {done && (
          <View style={styles.completedBadgeBanner}>
            <CheckCircle2 size={16} color="#15803D" strokeWidth={2.2} />
            <Text style={styles.completedBadgeBannerText}>Attendance completed for today</Text>
          </View>
        )}
      </View>
    );
  };

  const renderRequest = ({ item: r }: { item: FieldVisitRequest }) => {
    const s = fvStatus(r.status);
    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.85}
        onPress={() => navigation.navigate('FieldVisitDetail', { id: r.id })}
      >
        {/* Top Header Row */}
        <View style={styles.cardHeader}>
          <View style={styles.badgeRow}>
            <View style={styles.codeBadge}>
              <Text style={styles.codeBadgeText}>{r.requestNumber}</Text>
            </View>
            <View style={styles.projectTag}>
              <FolderKanban size={12} color="#64748B" strokeWidth={2} />
              <Text style={styles.projectTagText} numberOfLines={1}>
                {r.project?.isSystem ? 'General visit' : r.project?.name || 'General'}
              </Text>
            </View>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: s.bg, borderColor: s.border }]}>
            <View style={[styles.statusDot, { backgroundColor: s.dot }]} />
            <Text style={[styles.statusBadgeText, { color: s.fg }]}>{s.label}</Text>
          </View>
        </View>

        {/* Location Section */}
        <View style={styles.locationSection}>
          <View style={styles.locationIconWrap}>
            <MapPin size={18} color="#0284C7" strokeWidth={2.2} />
          </View>
          <View style={styles.locationContent}>
            <Text style={styles.siteTitle} numberOfLines={2}>
              {r.location}
            </Text>
          </View>
        </View>

        {/* Metadata Chips Grid */}
        <View style={styles.chipsRow}>
          <View style={styles.metaChip}>
            <Calendar size={13} color="#64748B" strokeWidth={2} />
            <Text style={styles.metaChipText}>{range(r)}</Text>
          </View>
          <View style={styles.metaChip}>
            <Clock size={13} color="#64748B" strokeWidth={2} />
            <Text style={styles.metaChipText}>
              {r.visitDays} day{r.visitDays === 1 ? '' : 's'}
            </Text>
          </View>
          <View style={styles.metaChip}>
            <Users size={13} color="#64748B" strokeWidth={2} />
            <Text style={styles.metaChipText}>
              {r.members.length} {r.members.length === 1 ? 'person' : 'people'}
            </Text>
          </View>
        </View>

        {/* Rejection Note if rejected */}
        {r.status === 'REJECTED' && !!r.rejectionReason && (
          <View style={styles.rejectionNotice}>
            <AlertTriangle size={15} color="#DC2626" strokeWidth={2.2} />
            <Text style={styles.rejectionNoticeText} numberOfLines={2}>
              Rejected: {r.rejectionReason}
            </Text>
          </View>
        )}

        {/* Card Footer Chevron Hint */}
        <View style={styles.cardFooter}>
          <Text style={styles.footerHint}>View full trip details</Text>
          <ChevronRight size={15} color="#94A3B8" strokeWidth={2.2} />
        </View>
      </TouchableOpacity>
    );
  };

  const renderAwaiting = ({ item: r }: { item: FieldVisitRequest }) => {
    const isPending = r.status === 'PENDING_APPROVAL';
    const on = selected.includes(r.id);
    return (
      <TouchableOpacity
        style={[styles.card, on && styles.cardSelected]}
        activeOpacity={0.85}
        onPress={() => navigation.navigate('FieldVisitDetail', { id: r.id })}
        onLongPress={() => isPending && toggle(r.id)}
      >
        <View style={styles.cardHeader}>
          <View style={styles.badgeRow}>
            {isPending && (
              <TouchableOpacity onPress={() => toggle(r.id)} hitSlop={10} style={styles.checkboxTouch}>
                {on ? (
                  <CheckSquare size={20} color="#1373e5" strokeWidth={2.4} />
                ) : (
                  <Square size={20} color="#94A3B8" strokeWidth={2} />
                )}
              </TouchableOpacity>
            )}
            <View style={styles.codeBadge}>
              <Text style={styles.codeBadgeText}>{r.requestNumber}</Text>
            </View>
          </View>
          <View style={[styles.statusBadge, {
            backgroundColor: isPending ? '#FFFBEB' : '#FFF7ED',
            borderColor: isPending ? '#FDE68A' : '#FFEDD5',
          }]}>
            <View style={[styles.statusDot, { backgroundColor: isPending ? '#D97706' : '#EA580C' }]} />
            <Text style={[styles.statusBadgeText, { color: isPending ? '#92400E' : '#9A3412' }]}>
              {isPending ? 'New request' : 'Change requested'}
            </Text>
          </View>
        </View>

        <View style={styles.locationSection}>
          <View style={styles.locationIconWrap}>
            <MapPin size={18} color="#0284C7" strokeWidth={2.2} />
          </View>
          <View style={styles.locationContent}>
            <Text style={styles.siteTitle} numberOfLines={2}>
              {r.location}
            </Text>
          </View>
        </View>

        <View style={styles.chipsRow}>
          <View style={styles.metaChip}>
            <Calendar size={13} color="#64748B" strokeWidth={2} />
            <Text style={styles.metaChipText}>{range(r)}</Text>
          </View>
          <View style={styles.metaChip}>
            <Users size={13} color="#64748B" strokeWidth={2} />
            <Text style={styles.metaChipText}>
              {r.members.length} {r.members.length === 1 ? 'person' : 'people'}
            </Text>
          </View>
          <View style={styles.metaChip}>
            <FolderKanban size={13} color="#64748B" strokeWidth={2} />
            <Text style={styles.metaChipText}>
              {r.project?.isSystem ? 'General' : r.project?.name || 'Project'}
            </Text>
          </View>
        </View>

        {!!r.raisedBy && (
          <View style={styles.raisedByRow}>
            <View style={styles.raisedByAvatar}>
              <Text style={styles.raisedByAvatarText}>{initials(r.raisedBy)}</Text>
            </View>
            <Text style={styles.raisedByText}>
              Raised by <Text style={styles.raisedByName}>{who(r.raisedBy)}</Text>
            </Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const siteRequestsFooter = siteRequests.length > 0 ? (
    <View style={styles.siteRequestsWrap}>
      <Text style={styles.sectionHead}>New site requests ({siteRequests.length})</Text>
      {siteRequests.map((r) => (
        <View key={r.id} style={[styles.card, styles.siteCard]}>
          <View style={styles.locationSection}>
            <View style={[styles.locationIconWrap, { backgroundColor: '#F3E8FF', borderColor: '#E9D5FF' }]}>
              <MapPin size={18} color="#9333EA" strokeWidth={2.2} />
            </View>
            <View style={styles.locationContent}>
              <Text style={styles.siteTitle}>{r.name}</Text>
              {!!r.address && <Text style={styles.geofenceText}>{r.address}</Text>}
            </View>
          </View>

          {!!r.requestedBy && (
            <View style={[styles.raisedByRow, { marginTop: 8 }]}>
              <View style={styles.raisedByAvatar}>
                <Text style={styles.raisedByAvatarText}>{initials(r.requestedBy)}</Text>
              </View>
              <Text style={styles.raisedByText}>
                Requested by <Text style={styles.raisedByName}>{who(r.requestedBy)}</Text>
              </Text>
            </View>
          )}

          {r.latitude != null && r.longitude != null && (
            <TouchableOpacity
              style={styles.mapsPillBtn}
              activeOpacity={0.7}
              onPress={() => Linking.openURL(mapsUrl(r.latitude!, r.longitude!))}
            >
              <ExternalLink size={13} color="#1373e5" strokeWidth={2.2} />
              <Text style={styles.mapsPillBtnText}>See pin in Google Maps</Text>
            </TouchableOpacity>
          )}

          <View style={styles.rowBtns}>
            <TouchableOpacity
              style={[styles.halfBtn, styles.approveBtn]}
              activeOpacity={0.8}
              onPress={() => approveSite(r)}
            >
              <Text style={styles.solidBtnText}>Approve Site</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.halfBtn, styles.rejectBtn]}
              activeOpacity={0.8}
              onPress={() => setSheet({ kind: 'siteReject', id: r.id })}
            >
              <Text style={styles.rejectBtnText}>Reject</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}
    </View>
  ) : null;

  const tabs: Tab[] = approver ? ['TODAY', 'MINE', 'APPROVALS'] : ['TODAY', 'MINE'];
  const tabName = (t: Tab) => (t === 'TODAY' ? 'Today' : t === 'MINE' ? (approver ? 'All Visits' : 'My Visits') : 'Approvals');
  const tabCount = (t: Tab) => (t === 'TODAY' ? days.length : t === 'MINE' ? mine.length : awaiting.length + siteRequests.length);

  return (
    <AppScreen title="Field Visits" subtitle="Requests and on-site attendance">
      {/* Top Segmented Controls & Primary Action Row */}
      <View style={styles.topContainer}>
        {/* Segmented Tab Pill */}
        <View style={styles.segmentBar}>
          {tabs.map((t) => {
            const active = tab === t;
            const count = tabCount(t);
            return (
              <TouchableOpacity
                key={t}
                style={[styles.segmentTab, active && styles.segmentTabActive]}
                activeOpacity={0.8}
                onPress={() => setTab(t)}
              >
                <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]} numberOfLines={1}>
                  {tabName(t)}
                </Text>
                <View style={[styles.countBadge, active && styles.countBadgeActive]}>
                  <Text style={[styles.countBadgeText, active && styles.countBadgeTextActive]}>
                    {count}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Action & Stats Row */}
        <View style={styles.actionRow}>
          <View style={styles.actionRowLeft}>
            <Text style={styles.sectionSubtitle}>
              {tab === 'TODAY'
                ? `${days.length} visit${days.length === 1 ? '' : 's'} scheduled today`
                : tab === 'MINE'
                  ? `${mine.length} total request${mine.length === 1 ? '' : 's'}`
                  : `${awaiting.length + siteRequests.length} waiting for review`}
            </Text>
          </View>
          {canRaise && (
            <TouchableOpacity
              style={styles.primaryNewBtn}
              activeOpacity={0.85}
              onPress={() => navigation.navigate('FieldVisitRequestForm')}
            >
              <Plus size={16} color="#FFFFFF" strokeWidth={2.6} />
              <Text style={styles.primaryNewBtnText}>New Request</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Bulk Approval Action Bar */}
      {tab === 'APPROVALS' && selected.length > 0 && (
        <View style={styles.bulkBar}>
          <Text style={styles.bulkText}>{selected.length} requests selected</Text>
          <TouchableOpacity
            style={[styles.bulkBtn, styles.approveBtn]}
            activeOpacity={0.8}
            disabled={bulkBusy}
            onPress={() => bulkApprove(selected)}
          >
            {bulkBusy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.solidBtnText}>Approve</Text>}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.bulkBtn, styles.rejectBtn]}
            activeOpacity={0.8}
            disabled={bulkBusy}
            onPress={() => setSheet({ kind: 'bulkReject' })}
          >
            <Text style={styles.rejectBtnText}>Reject</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Main Content Area */}
      {loading ? (
        <View style={styles.loaderWrap}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={styles.loaderText}>Loading field visits…</Text>
        </View>
      ) : tab === 'APPROVALS' ? (
        <FlatList
          data={awaiting}
          keyExtractor={(r) => `a${r.id}`}
          renderItem={renderAwaiting}
          contentContainerStyle={styles.listContainer}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListHeaderComponent={pendingIds.length > 1 ? (
            <TouchableOpacity
              style={styles.selectAllBtn}
              onPress={() => setSelected(selected.length === pendingIds.length ? [] : pendingIds)}
            >
              <Text style={styles.selectAllText}>
                {selected.length === pendingIds.length ? 'Clear selection' : `Select all ${pendingIds.length} new requests`}
              </Text>
            </TouchableOpacity>
          ) : undefined}
          ListFooterComponent={siteRequestsFooter ?? undefined}
          ListEmptyComponent={siteRequests.length ? undefined : (
            <View style={styles.emptyContainer}>
              <View style={[styles.emptyIconCircle, { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' }]}>
                <CheckCircle2 size={34} color="#16A34A" strokeWidth={1.8} />
              </View>
              <Text style={styles.emptyTitle}>All Caught Up!</Text>
              <Text style={styles.emptySubtitle}>
                There are no field visit requests or custom site requests waiting for your approval.
              </Text>
            </View>
          )}
        />
      ) : tab === 'TODAY' ? (
        <FlatList
          data={days}
          keyExtractor={(d) => String(d.id)}
          renderItem={renderDay}
          contentContainerStyle={styles.listContainer}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <View style={[styles.emptyIconCircle, { backgroundColor: '#EFF6FF', borderColor: '#DBEAFE' }]}>
                <MapPin size={34} color="#1373e5" strokeWidth={1.8} />
              </View>
              <Text style={styles.emptyTitle}>No Visits Scheduled Today</Text>
              <Text style={styles.emptySubtitle}>
                When a field visit request is approved for today, your on-site attendance card will appear here for geofenced clock-in.
              </Text>
              {canRaise && (
                <TouchableOpacity
                  style={styles.emptyActionBtn}
                  activeOpacity={0.85}
                  onPress={() => navigation.navigate('FieldVisitRequestForm')}
                >
                  <Plus size={16} color="#FFFFFF" strokeWidth={2.6} />
                  <Text style={styles.emptyActionBtnText}>Plan a Field Visit</Text>
                </TouchableOpacity>
              )}
            </View>
          }
        />
      ) : (
        <FlatList
          data={mineSorted}
          keyExtractor={(r) => String(r.id)}
          renderItem={renderRequest}
          contentContainerStyle={styles.listContainer}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <View style={[styles.emptyIconCircle, { backgroundColor: '#F1F5F9', borderColor: '#E2E8F0' }]}>
                <Briefcase size={34} color="#64748B" strokeWidth={1.8} />
              </View>
              <Text style={styles.emptyTitle}>No Field Visits Yet</Text>
              <Text style={styles.emptySubtitle}>
                {canRaise
                  ? 'Raise a field visit request to log travel, assign team members, and record on-site attendance.'
                  : 'Field visits you are sent on by your project manager appear here.'}
              </Text>
              {canRaise && (
                <TouchableOpacity
                  style={styles.emptyActionBtn}
                  activeOpacity={0.85}
                  onPress={() => navigation.navigate('FieldVisitRequestForm')}
                >
                  <Plus size={16} color="#FFFFFF" strokeWidth={2.6} />
                  <Text style={styles.emptyActionBtnText}>Create Visit Request</Text>
                </TouchableOpacity>
              )}
            </View>
          }
        />
      )}

      <ReasonSheet
        visible={!!sheet}
        title={sheet?.kind === 'bulkReject' ? `Reject ${selected.length} request${selected.length === 1 ? '' : 's'}` : 'Reject this site'}
        message="The person who raised it sees this reason."
        confirmLabel="Reject"
        danger
        busy={bulkBusy}
        onSubmit={onReason}
        onClose={() => setSheet(null)}
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  topContainer: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    gap: 12,
  },
  segmentBar: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 14,
    padding: 4,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  segmentTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    paddingHorizontal: 8,
    borderRadius: 10,
    gap: 6,
  },
  segmentTabActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  segmentLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  segmentLabelActive: {
    color: '#0F172A',
    fontWeight: '700',
  },
  countBadge: {
    backgroundColor: '#E2E8F0',
    paddingHorizontal: 6.5,
    paddingVertical: 2,
    borderRadius: 999,
  },
  countBadgeActive: {
    backgroundColor: '#EFF6FF',
  },
  countBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
  },
  countBadgeTextActive: {
    color: '#1373e5',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 2,
  },
  actionRowLeft: {
    flex: 1,
  },
  sectionSubtitle: {
    fontSize: 13,
    fontWeight: '500',
    color: '#64748B',
  },
  primaryNewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1373e5',
    paddingHorizontal: 15,
    paddingVertical: 9,
    borderRadius: 11,
    shadowColor: '#1373e5',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  primaryNewBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  listContainer: {
    padding: 16,
    paddingBottom: 120,
    gap: 12,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 15,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  cardSelected: {
    borderColor: '#1373e5',
    backgroundColor: '#F8FBFF',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 10,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  codeBadge: {
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E0E7FF',
  },
  codeBadgeText: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#4338CA',
    letterSpacing: 0.2,
  },
  projectTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    maxWidth: '55%',
  },
  projectTagText: {
    fontSize: 11.5,
    color: '#64748B',
    fontWeight: '600',
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
  locationSection: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 2,
    marginBottom: 10,
  },
  locationIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#F0F9FF',
    borderWidth: 1,
    borderColor: '#BAE6FD',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  locationContent: {
    flex: 1,
  },
  siteTitle: {
    fontSize: 15.5,
    fontWeight: '700',
    color: '#0F172A',
    lineHeight: 21,
  },
  geofenceText: {
    fontSize: 12.5,
    color: '#64748B',
    marginTop: 3,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 2,
  },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 8,
    paddingVertical: 4.5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  metaChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
  },
  rejectionNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 10,
    padding: 9,
    marginTop: 11,
  },
  rejectionNoticeText: {
    fontSize: 12.5,
    color: '#991B1B',
    flex: 1,
    lineHeight: 17,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 10,
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F8FAFC',
  },
  footerHint: {
    fontSize: 12,
    color: '#94A3B8',
    fontWeight: '500',
  },
  mapsPillBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 9,
    marginTop: 8,
  },
  mapsPillBtnText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#1373e5',
  },
  taskPickerContainer: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  sectionSmallTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom: 8,
  },
  taskOptionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingVertical: 9,
    paddingHorizontal: 11,
    borderRadius: 10,
    marginBottom: 7,
  },
  taskOptionCardActive: {
    backgroundColor: '#EFF6FF',
    borderColor: '#1373e5',
  },
  taskRadioCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: '#94A3B8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskRadioCircleActive: {
    borderColor: '#1373e5',
  },
  taskRadioInner: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: '#1373e5',
  },
  taskInfoCol: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  taskKeyBadge: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#64748B',
  },
  taskKeyBadgeActive: {
    color: '#1373e5',
  },
  taskTitleText: {
    fontSize: 13,
    color: '#334155',
    flex: 1,
  },
  taskTitleTextActive: {
    color: '#0F172A',
    fontWeight: '600',
  },
  attendanceLogBox: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 10,
    marginTop: 11,
  },
  logRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logIndicator: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  logText: {
    fontSize: 12.5,
    color: '#475569',
  },
  logBold: {
    fontWeight: '700',
    color: '#0F172A',
  },
  primaryActionBtn: {
    marginTop: 12,
    height: 46,
    borderRadius: 12,
    backgroundColor: '#16A34A',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#16A34A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  dangerActionBtn: {
    backgroundColor: '#DC2626',
    shadowColor: '#DC2626',
  },
  btnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  primaryActionBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14.5,
  },
  completedBadgeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    paddingVertical: 10,
    borderRadius: 10,
    marginTop: 12,
  },
  completedBadgeBannerText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#15803D',
  },
  checkboxTouch: {
    paddingRight: 2,
  },
  raisedByRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F8FAFC',
  },
  raisedByAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#E0E7FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  raisedByAvatarText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#4338CA',
  },
  raisedByText: {
    fontSize: 12,
    color: '#64748B',
  },
  raisedByName: {
    fontWeight: '600',
    color: '#1E293B',
  },
  siteRequestsWrap: {
    marginTop: 16,
  },
  sectionHead: {
    fontSize: 13,
    fontWeight: '800',
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 10,
  },
  siteCard: {
    marginBottom: 10,
  },
  rowBtns: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  halfBtn: {
    flex: 1,
    height: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  approveBtn: {
    backgroundColor: '#16A34A',
  },
  rejectBtn: {
    borderWidth: 1,
    borderColor: '#FECACA',
    backgroundColor: '#FEF2F2',
  },
  solidBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13.5,
  },
  rejectBtnText: {
    color: '#DC2626',
    fontWeight: '700',
    fontSize: 13.5,
  },
  bulkBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 10,
    padding: 10,
    borderRadius: 12,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  bulkText: {
    flex: 1,
    fontWeight: '700',
    color: '#1E293B',
    fontSize: 13,
  },
  bulkBtn: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectAllBtn: {
    marginBottom: 6,
  },
  selectAllText: {
    color: '#1373e5',
    fontWeight: '700',
    fontSize: 13,
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
    paddingVertical: 50,
    paddingHorizontal: 24,
  },
  emptyIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: 'center',
    letterSpacing: -0.2,
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
    paddingVertical: 11,
    borderRadius: 11,
    marginTop: 20,
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
});
