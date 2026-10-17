import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator, Alert, Linking, Image,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import {
  MapPin,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ChevronRight,
  Plus,
  ExternalLink,
  Navigation2,
  Crosshair,
  Briefcase,
  FolderKanban,
  LogIn,
  LogOut,
  CheckSquare,
  Square,
} from 'lucide-react-native';
import AppScreen from '../../components/AppScreen';
import GradientHero from '../../components/GradientHero';
import { ds, colors as dsColors, status as dsStatus } from '../../theme/ds';
import {
  fieldVisitRequestService as fv, FieldVisitRequest, FvDay, FvCapabilities, VisitLocationRequest, ROSTER_DAY_OFF_CLASH,
} from '../../api/fieldVisitRequestService';
import ReasonSheet from './ReasonSheet';
import JourneyPanel from './JourneyPanel';
import { getCurrentLocation, requestLocationPermission } from '../../store/dashboardStore';
import { theme } from '../../theme/theme';
import { fvStatus, timeLabel, clockAt, mapsUrl, who, initials } from './fvFormat';

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
  /** Waiting on an administrator: new requests, and changes to approved ones (newest on top). */
  const awaiting = useMemo(
    () => mine.filter((r) => r.status === 'PENDING_APPROVAL' || !!r.pendingChange)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '') || (b.id - a.id)),
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

  /** Newly created visits always appear on top. */
  const daysSorted = useMemo(
    () => [...days].sort((a, b) => (b.request?.id ?? b.id) - (a.request?.id ?? a.id)),
    [days],
  );
  const mineSorted = useMemo(
    () => [...mine].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '') || (b.id - a.id)),
    [mine],
  );

  /** "Noida Sector 62 – CES Office" → main line and sub line. */
  const splitSite = (loc: string) => {
    const parts = (loc || '').split(/\s+[–—-]\s+/);
    return { main: parts[0] || loc, sub: parts.length > 1 ? parts.slice(1).join(' - ') : null };
  };
  /** Visit dates are stored as UTC midnight: read them as the day they name. */
  const dayNum = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', timeZone: 'UTC' });
  const monShort = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' }).toUpperCase();
  const shortRange = (r: { startDate: string; endDate: string }) => {
    const f = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    return r.startDate.slice(0, 10) === r.endDate.slice(0, 10) ? f(r.startDate) : `${f(r.startDate)} – ${f(r.endDate)}`;
  };

  /** Up to three faces, then "+n": who is going, at a glance. */
  const AvatarStack = ({ people }: { people: { id: number; firstName: string; lastName?: string | null; avatarUrl?: string | null }[] }) => (
    <View style={styles.stack}>
      {people.slice(0, 3).map((p, i) => (
        <View key={p.id} style={[styles.stackItem, { marginLeft: i ? -8 : 0, zIndex: 3 - i }]}>
          {p.avatarUrl
            ? <Image source={{ uri: p.avatarUrl }} style={styles.stackImg} />
            : <Text style={styles.stackInitials}>{initials(p)}</Text>}
        </View>
      ))}
      {people.length > 3 && (
        <View style={[styles.stackItem, styles.stackMore, { marginLeft: -8 }]}>
          <Text style={styles.stackMoreText}>+{people.length - 3}</Text>
        </View>
      )}
    </View>
  );

  const StatusPill = ({ tone, label }: { tone: { bg: string; border: string; fg: string; strong?: string }; label: string }) => (
    <View style={[ds.pill, { backgroundColor: tone.bg, borderColor: tone.border }]}>
      <View style={[styles.statusDot, { backgroundColor: tone.fg }]} />
      <Text style={[ds.pillText, { color: tone.strong ?? tone.fg }]}>{label}</Text>
    </View>
  );

  const renderDay = ({ item: d }: { item: FvDay }) => {
    const inside = !!d.clockInTime && !d.clockOutTime;
    const done = !!d.clockOutTime;
    const radiusStr = d.request.geofenceRadiusM >= 1000 ? `${(d.request.geofenceRadiusM / 1000).toFixed(1)} km` : `${d.request.geofenceRadiusM} m`;
    const site = splitSite(d.request.location);
    const tone = inside ? dsStatus.success : done ? dsStatus.neutral : dsStatus.info;
    const chosenTask = taskFor[d.request.id] ?? (d.tasks.length === 1 ? d.tasks[0].id : undefined);

    return (
      <View style={[styles.card, styles.dayCard, inside && styles.dayCardLive]}>
        {/* Band: when, and the state of the day */}
        <View style={[styles.dayBand, { backgroundColor: tone.bg, borderBottomColor: tone.border }]}>
          <Clock size={13} color={tone.strong} strokeWidth={2.4} />
          <Text style={[styles.dayBandText, { color: tone.strong }]}>
            {timeLabel(d.request.startTime)} – {timeLabel(d.request.endTime)}
          </Text>
          <Text style={styles.dayBandCode}>{d.request.requestNumber}</Text>
          <StatusPill tone={tone} label={inside ? 'On site' : done ? 'Completed' : 'Today'} />
        </View>

        <View style={styles.cardInner}>
          {/* Site */}
          <View style={styles.siteRow}>
            <View style={[styles.siteIcon, inside && { backgroundColor: dsStatus.success.bg, borderColor: dsStatus.success.border }]}>
              <MapPin size={20} color={inside ? dsStatus.success.strong : dsColors.primary} strokeWidth={2.2} />
            </View>
            <View style={styles.flex1}>
              <Text style={styles.siteTitle} numberOfLines={1}>{site.main}</Text>
              {!!site.sub && <Text style={styles.siteSub} numberOfLines={1}>{site.sub}</Text>}
              <View style={styles.inlineMeta}>
                <FolderKanban size={11} color={dsColors.textFaint} />
                <Text style={styles.inlineMetaText} numberOfLines={1}>{d.request.project?.name || 'General visit'}</Text>
              </View>
              <View style={styles.radiusPill}>
                <Crosshair size={11} color="#7C3AED" strokeWidth={2.4} />
                <Text style={styles.radiusPillText}>Clock in within {radiusStr}</Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.directionsBtn}
              activeOpacity={0.75}
              onPress={() => navigation.navigate('FieldVisitMap', { requestId: d.request.id })}
            >
              <Navigation2 size={14} color={dsColors.primary} strokeWidth={2.4} />
              <Text style={styles.directionsText}>Route</Text>
            </TouchableOpacity>
          </View>

          {/* Timeline: clock in → clock out */}
          <View style={styles.timeline}>
            <View style={styles.tlStep}>
              <View style={[styles.tlDot, d.clockInTime ? styles.tlDotDone : styles.tlDotTodo]}>
                <LogIn size={12} color={d.clockInTime ? '#FFFFFF' : dsColors.textFaint} strokeWidth={2.6} />
              </View>
              <View>
                <Text style={styles.tlLabel}>Clock in</Text>
                <Text style={[styles.tlValue, !d.clockInTime && styles.tlValueTodo]}>
                  {d.clockInTime ? clockAt(d.clockInTime) : '--:--'}
                </Text>
                {d.clockInDistanceKm != null && (
                  <Text style={styles.tlSub}>{Math.round(d.clockInDistanceKm * 1000)} m from site</Text>
                )}
              </View>
            </View>
            <View style={[styles.tlLine, d.clockOutTime && styles.tlLineDone]} />
            <View style={styles.tlStep}>
              <View style={[styles.tlDot, d.clockOutTime ? styles.tlDotOut : styles.tlDotTodo]}>
                <LogOut size={12} color={d.clockOutTime ? '#FFFFFF' : dsColors.textFaint} strokeWidth={2.6} />
              </View>
              <View>
                <Text style={styles.tlLabel}>Clock out</Text>
                <Text style={[styles.tlValue, !d.clockOutTime && styles.tlValueTodo]}>
                  {d.clockOutTime ? clockAt(d.clockOutTime) : '--:--'}
                </Text>
              </View>
            </View>
          </View>

          {/* Task to clock in against */}
          {!d.clockInTime && d.tasks.length > 0 && (
            <View style={styles.taskBlock}>
              <Text style={styles.blockLabel}>{d.tasks.length > 1 ? 'PICK THE TASK YOU ARE ON' : 'TASK'}</Text>
              {d.tasks.map((t) => {
                const on = chosenTask === t.id;
                return (
                  <TouchableOpacity
                    key={t.id}
                    style={[styles.taskRow, on && styles.taskRowOn]}
                    activeOpacity={0.75}
                    onPress={() => setTaskFor((p) => ({ ...p, [d.request.id]: t.id }))}
                  >
                    <View style={[styles.taskRadioCircle, on && styles.taskRadioCircleActive]}>
                      {on && <View style={styles.taskRadioInner} />}
                    </View>
                    <Text style={[styles.taskKey, on && { color: dsColors.primary }]}>{t.key}</Text>
                    <Text style={[styles.taskTitle, on && { color: dsColors.text }]} numberOfLines={1}>{t.title}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* Travel allowance: Start / End journey (Delhi NCR visits) */}
          {d.request.travelZone === 'DELHI_NCR' && <JourneyPanel day={d} onChanged={load} />}

          {!done ? (
            <TouchableOpacity
              style={[styles.clockBtn, inside && styles.clockBtnOut]}
              activeOpacity={0.85}
              disabled={busy === d.id}
              onPress={() => clock(d, inside ? 'out' : 'in')}
            >
              {busy === d.id ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  {inside ? <LogOut size={17} color="#FFFFFF" strokeWidth={2.4} /> : <LogIn size={17} color="#FFFFFF" strokeWidth={2.4} />}
                  <Text style={styles.clockBtnText}>{inside ? 'Clock out at site' : 'Clock in at site'}</Text>
                </>
              )}
            </TouchableOpacity>
          ) : (
            <View style={styles.doneStrip}>
              <CheckCircle2 size={15} color={dsStatus.success.strong} strokeWidth={2.4} />
              <Text style={styles.doneStripText}>Attendance completed for today</Text>
            </View>
          )}
        </View>
      </View>
    );
  };

  /** One visit in a list (mine, or waiting on an approver). */
  const VisitCard = ({ r, pill, top, bottom }: {
    r: FieldVisitRequest; pill: React.ReactNode; top?: React.ReactNode; bottom?: React.ReactNode;
  }) => {
    const site = splitSite(r.location);
    const people = r.members.map((m) => m.employee);
    return (
      <View style={styles.cardInner}>
        <View style={styles.visitTop}>
          {top}
          <View style={ds.dateBox}>
            <Text style={ds.dateBoxNum}>{dayNum(r.startDate)}</Text>
            <Text style={ds.dateBoxDay}>{monShort(r.startDate)}</Text>
          </View>
          <View style={styles.flex1}>
            <View style={styles.visitTitleRow}>
              <Text style={[styles.siteTitle, styles.flex1]} numberOfLines={1}>{site.main}</Text>
              {pill}
            </View>
            {!!site.sub && <Text style={styles.siteSub} numberOfLines={1}>{site.sub}</Text>}
            <Text style={styles.visitWhen}>
              {shortRange(r)} · {r.visitDays} {r.visitDays === 1 ? 'day' : 'days'}
            </Text>
          </View>
        </View>

        <View style={styles.visitFooter}>
          <View style={[ds.chip, styles.flexShrink]}>
            <FolderKanban size={11} color={dsColors.textMuted} />
            <Text style={[ds.chipText, styles.flexShrink]} numberOfLines={1}>
              {r.project?.isSystem ? 'General visit' : r.project?.name || 'General'}
            </Text>
          </View>
          <View style={[ds.chip, styles.codeChip]}>
            <Text style={[ds.chipText, styles.codeChipText]}>{r.requestNumber}</Text>
          </View>
          <View style={styles.flex1} />
          {people.length > 0 && <AvatarStack people={people} />}
          <ChevronRight size={16} color={dsColors.textFaint} strokeWidth={2.2} />
        </View>
        {bottom}
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
        <VisitCard
          r={r}
          pill={<StatusPill tone={{ bg: s.bg, border: s.border, fg: s.dot, strong: s.fg }} label={s.label} />}
          bottom={r.status === 'REJECTED' && !!r.rejectionReason ? (
            <View style={styles.rejectionNotice}>
              <AlertTriangle size={14} color={dsStatus.danger.strong} strokeWidth={2.2} />
              <Text style={styles.rejectionNoticeText} numberOfLines={2}>{r.rejectionReason}</Text>
            </View>
          ) : undefined}
        />
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
        <VisitCard
          r={r}
          top={isPending ? (
            <TouchableOpacity onPress={() => toggle(r.id)} hitSlop={10} style={styles.checkboxTouch}>
              {on ? <CheckSquare size={20} color={dsColors.primary} strokeWidth={2.4} /> : <Square size={20} color={dsColors.textFaint} strokeWidth={2} />}
            </TouchableOpacity>
          ) : undefined}
          pill={<StatusPill tone={isPending ? dsStatus.warning : { bg: '#FFF7ED', border: '#FED7AA', fg: '#EA580C', strong: '#9A3412' }} label={isPending ? 'New' : 'Change'} />}
          bottom={r.raisedBy ? (
            <View style={styles.raisedByRow}>
              {r.raisedBy.avatarUrl
                ? <Image source={{ uri: r.raisedBy.avatarUrl }} style={styles.raisedByAvatar} />
                : <View style={styles.raisedByAvatar}><Text style={styles.raisedByAvatarText}>{initials(r.raisedBy)}</Text></View>}
              <Text style={styles.raisedByText}>
                Raised by <Text style={styles.raisedByName}>{who(r.raisedBy)}</Text>
              </Text>
            </View>
          ) : undefined}
        />
      </TouchableOpacity>
    );
  };

  const siteRequestsFooter = siteRequests.length > 0 ? (
    <View style={styles.siteRequestsWrap}>
      <Text style={styles.sectionHead}>New site requests ({siteRequests.length})</Text>
      {siteRequests.map((r) => (
        <View key={r.id} style={[styles.card, styles.siteCard, styles.cardInner]}>
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

  // Hero figures: what is on today, and what is coming or waiting.
  const todayKey = new Date().toISOString().slice(0, 10);
  const onSite = days.filter((d) => d.clockInTime && !d.clockOutTime).length;
  const doneToday = days.filter((d) => d.clockOutTime).length;
  const upcoming = mine.filter((r) => r.status === 'APPROVED' && r.startDate.slice(0, 10) > todayKey).length;
  const waiting = approver ? awaiting.length + siteRequests.length : mine.filter((r) => r.status === 'PENDING_APPROVAL').length;
  const nextDay = days.find((d) => !d.clockOutTime) ?? days[0];

  const header = (
    <View>
      <GradientHero
        id="fvHeroGrad"
        overline="FIELD VISITS · TODAY"
        value={days.length}
        unit={days.length === 1 ? 'visit today' : 'visits today'}
        caption={nextDay ? `${(nextDay.request.location || '').split(/\s+[–—-]\s+/)[0]} · ${timeLabel(nextDay.request.startTime)}` : 'Nothing scheduled for today'}
        action={canRaise ? (
          <TouchableOpacity style={ds.heroButton} activeOpacity={0.85} onPress={() => navigation.navigate('FieldVisitRequestForm')}>
            <Plus size={14} color={dsColors.text} strokeWidth={2.6} />
            <Text style={ds.heroButtonText}>New</Text>
          </TouchableOpacity>
        ) : undefined}
        stats={[
          { label: 'On site', value: onSite, color: '#A7F3D0' },
          { label: 'Done today', value: doneToday },
          { label: 'Upcoming', value: upcoming, color: '#BAE6FD' },
          { label: approver ? 'To review' : 'Pending', value: waiting, color: '#FDE68A' },
        ]}
      />
      <View style={ds.segmented}>
        {tabs.map((t) => {
          const active = tab === t;
          return (
            <TouchableOpacity key={t} style={[ds.segment, styles.segmentRow, active && ds.segmentActive]} activeOpacity={0.85} onPress={() => setTab(t)}>
              <Text style={[ds.segmentText, active && ds.segmentTextActive]} numberOfLines={1}>{tabName(t)}</Text>
              <View style={[styles.countBadge, active && styles.countBadgeActive]}>
                <Text style={[styles.countBadgeText, active && styles.countBadgeTextActive]}>{tabCount(t)}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );

  const emptyState = (icon: React.ReactNode, title: string, text: string, action?: { label: string; onPress: () => void }) => (
    <View style={ds.empty}>
      <View style={ds.emptyIcon}>{icon}</View>
      <Text style={ds.emptyTitle}>{title}</Text>
      <Text style={[ds.emptyText, !action && { marginBottom: 0 }]}>{text}</Text>
      {action && (
        <TouchableOpacity style={ds.primaryButton} activeOpacity={0.85} onPress={action.onPress}>
          <Plus size={14} color="#FFFFFF" strokeWidth={2.6} />
          <Text style={ds.primaryButtonText}>{action.label}</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  return (
    <AppScreen title="Field Visits" subtitle="Requests and on-site attendance">
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
        <View style={[styles.listContainer, { flex: 1 }]}>
          {header}
          <View style={styles.loaderWrap}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={styles.loaderText}>Loading field visits…</Text>
          </View>
        </View>
      ) : tab === 'APPROVALS' ? (
        <FlatList
          data={awaiting}
          keyExtractor={(r) => `a${r.id}`}
          renderItem={renderAwaiting}
          contentContainerStyle={styles.listContainer}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListHeaderComponent={
            <>
              {header}
              {pendingIds.length > 1 && (
                <TouchableOpacity
                  style={[ds.softButton, styles.selectAllBtn]}
                  onPress={() => setSelected(selected.length === pendingIds.length ? [] : pendingIds)}
                >
                  <CheckSquare size={13} color={dsColors.primary} />
                  <Text style={ds.softButtonText}>
                    {selected.length === pendingIds.length ? 'Clear selection' : `Select all ${pendingIds.length} new requests`}
                  </Text>
                </TouchableOpacity>
              )}
            </>
          }
          ListFooterComponent={siteRequestsFooter ?? undefined}
          ListEmptyComponent={siteRequests.length ? undefined : emptyState(
            <CheckCircle2 size={22} color={dsStatus.success.strong} />,
            'All caught up',
            'No field visit requests or site requests are waiting for your approval.',
          )}
        />
      ) : tab === 'TODAY' ? (
        <FlatList
          data={daysSorted}
          keyExtractor={(d) => String(d.id)}
          renderItem={renderDay}
          contentContainerStyle={styles.listContainer}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListHeaderComponent={header}
          ListEmptyComponent={emptyState(
            <MapPin size={22} color={dsColors.primary} />,
            'No visits today',
            'When a field visit is approved for today, it appears here so you can clock in at the site.',
            canRaise ? { label: 'Plan a field visit', onPress: () => navigation.navigate('FieldVisitRequestForm') } : undefined,
          )}
        />
      ) : (
        <FlatList
          data={mineSorted}
          keyExtractor={(r) => String(r.id)}
          renderItem={renderRequest}
          contentContainerStyle={styles.listContainer}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListHeaderComponent={header}
          ListEmptyComponent={emptyState(
            <Briefcase size={22} color={dsColors.primary} />,
            'No field visits yet',
            canRaise
              ? 'Raise a field visit to plan travel, add the team, and record attendance at the site.'
              : 'Field visits your project manager sends you on appear here.',
            canRaise ? { label: 'New visit request', onPress: () => navigation.navigate('FieldVisitRequestForm') } : undefined,
          )}
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
  cardInner: { padding: 14 },
  flex1: { flex: 1, minWidth: 0 },
  flexShrink: { flexShrink: 1 },
  /* Today card */
  dayCard: {},
  dayCardLive: { borderColor: dsStatus.success.border },
  dayBand: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderBottomWidth: 1,
  },
  dayBandText: { fontSize: 12.5, fontWeight: '800', fontVariant: ['tabular-nums'] },
  dayBandCode: { flex: 1, textAlign: 'right', fontSize: 11, fontWeight: '700', color: dsColors.textFaint, marginRight: 4 },
  siteRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  siteIcon: {
    width: 46, height: 46, borderRadius: 15, backgroundColor: dsColors.primarySoft,
    borderWidth: 1, borderColor: dsColors.primaryBorder, alignItems: 'center', justifyContent: 'center',
  },
  siteSub: { fontSize: 12.5, fontWeight: '500', color: dsColors.textSecondary, marginTop: 1 },
  inlineMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  inlineMetaText: { fontSize: 11.5, fontWeight: '600', color: dsColors.textMuted, flexShrink: 1 },
  radiusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginTop: 5,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
    backgroundColor: '#F3E8FF', borderWidth: 1, borderColor: '#DDD6FE',
  },
  radiusPillText: { fontSize: 11, fontWeight: '800', color: '#6D28D9' },
  directionsBtn: {
    alignItems: 'center', gap: 2, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 12,
    backgroundColor: dsColors.primarySoft, borderWidth: 1, borderColor: dsColors.primaryBorder,
  },
  directionsText: { fontSize: 10.5, fontWeight: '800', color: dsColors.primary },
  timeline: {
    flexDirection: 'row', alignItems: 'center', marginTop: 14, padding: 12, borderRadius: 16,
    backgroundColor: dsColors.bg, borderWidth: 1, borderColor: dsColors.borderSoft,
  },
  tlStep: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tlDot: { width: 26, height: 26, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  tlDotDone: { backgroundColor: dsStatus.success.fg },
  tlDotOut: { backgroundColor: dsColors.textMuted },
  tlDotTodo: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: dsColors.border },
  tlLine: { flex: 1, height: 2, borderRadius: 1, backgroundColor: dsColors.border, marginHorizontal: 10 },
  tlLineDone: { backgroundColor: dsStatus.success.border },
  tlLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5, color: dsColors.textFaint, textTransform: 'uppercase' },
  tlValue: { fontSize: 14, fontWeight: '900', color: dsColors.text, fontVariant: ['tabular-nums'] },
  tlValueTodo: { color: dsColors.textFaint },
  tlSub: { fontSize: 10.5, fontWeight: '600', color: dsColors.textMuted },
  taskBlock: { marginTop: 12, gap: 6 },
  blockLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.7, color: dsColors.textFaint, marginBottom: 2 },
  taskRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 9,
    borderRadius: 12, borderWidth: 1, borderColor: dsColors.border, backgroundColor: '#FFFFFF',
  },
  taskRowOn: { borderColor: dsColors.primaryRing, backgroundColor: dsColors.primarySoft },
  taskKey: { fontSize: 11, fontWeight: '800', color: dsColors.textMuted },
  taskTitle: { flex: 1, fontSize: 13, fontWeight: '700', color: dsColors.textBody },
  clockBtn: {
    marginTop: 14, height: 48, borderRadius: 14, backgroundColor: dsStatus.success.fg,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    shadowColor: dsStatus.success.fg, shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.25, shadowRadius: 10, elevation: 4,
  },
  clockBtnOut: { backgroundColor: dsStatus.danger.fg, shadowColor: dsStatus.danger.fg },
  clockBtnText: { color: '#FFFFFF', fontSize: 14.5, fontWeight: '800' },
  doneStrip: {
    marginTop: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11,
    borderRadius: 14, backgroundColor: dsStatus.success.bg, borderWidth: 1, borderColor: dsStatus.success.border,
  },
  doneStripText: { fontSize: 13, fontWeight: '800', color: dsStatus.success.strong },
  /* List cards */
  visitTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  visitTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  visitWhen: { fontSize: 12.5, fontWeight: '700', color: dsColors.textBody, marginTop: 4 },
  visitFooter: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: dsColors.borderSoft,
  },
  codeChip: { backgroundColor: '#EEF2FF', borderColor: '#E0E7FF' },
  codeChipText: { color: '#4338CA', fontWeight: '800' },
  stack: { flexDirection: 'row', alignItems: 'center', marginRight: 2 },
  stackItem: {
    width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: '#FFFFFF', backgroundColor: dsColors.primarySoft,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  stackImg: { width: '100%', height: '100%' },
  stackInitials: { fontSize: 9.5, fontWeight: '900', color: dsColors.primary },
  stackMore: { backgroundColor: dsColors.borderSoft },
  stackMoreText: { fontSize: 9.5, fontWeight: '900', color: dsColors.textMuted },
  segmentRow: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
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
    gap: 10,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: dsColors.border,
    overflow: 'hidden',
    shadowColor: dsColors.shadow,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  cardSelected: {
    borderColor: dsColors.primaryRing,
    backgroundColor: '#FBFDFF',
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
    gap: 6,
    flex: 1,
    minWidth: 0,
  },
  codeBadge: {
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E0E7FF',
    flexShrink: 0,
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
    flexShrink: 1,
    minWidth: 0,
  },
  projectTagText: {
    fontSize: 11.5,
    color: '#64748B',
    fontWeight: '600',
    flexShrink: 1,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 3.5,
    borderRadius: 999,
    borderWidth: 1,
    flexShrink: 0,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  locationSection: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 2,
    marginBottom: 8,
  },
  locationIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: dsColors.primarySoft,
    borderWidth: 1,
    borderColor: dsColors.primaryBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationContent: {
    flex: 1,
    minWidth: 0,
  },
  siteTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: dsColors.text,
  },
  siteSubAddress: {
    fontSize: 12.5,
    color: '#475569',
    marginTop: 2,
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
    fontSize: 11.5,
    fontWeight: '700',
    color: dsColors.textBody,
  },
  rejectionNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: dsStatus.danger.bg,
    borderWidth: 1,
    borderColor: dsStatus.danger.border,
    borderRadius: 12,
    padding: 10,
    marginTop: 10,
  },
  rejectionNoticeText: {
    fontSize: 12.5,
    color: dsStatus.danger.strong,
    fontWeight: '600',
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
    borderTopColor: dsColors.borderSoft,
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
    marginTop: 4,
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
    paddingVertical: 10,
    paddingHorizontal: 12,
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
    marginRight: -2,
  },
  raisedByRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: dsColors.borderSoft,
  },
  raisedByAvatar: {
    width: 24,
    height: 24,
    borderRadius: 8,
    backgroundColor: dsColors.primarySoft,
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
    alignSelf: 'flex-start',
    marginBottom: 10,
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
