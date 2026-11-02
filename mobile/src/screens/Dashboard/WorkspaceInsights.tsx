import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Image, Linking, Platform } from 'react-native';
import {
  Megaphone,
  ChevronRight,
  ChevronLeft,
  UserCheck,
  CalendarDays,
  CheckSquare,
  FolderKanban,
  Ticket,
  Timer,
  ClipboardCheck,
  Sparkles,
  Info,
  MapPin,
  FileText,
  Palmtree,
  Building2,
  Laptop,
  PartyPopper,
  Clock,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
} from 'lucide-react-native';
import { apiClient, API_URL } from '../../api/apiClient';
import { Avatar, PersonTap, PersonLite } from '../../components/PersonSheet';
import { Notice } from '../../api/teamService';

/**
 * The web dashboard's workspace sections, for mobile:
 * announcements, today at a glance, the five stat cards, the week calendar,
 * and (for people who approve things) the delivery approval queues.
 */
type Nav = (screen: string, params?: any) => void;
const WEB_URL = API_URL.replace(/\/api\/?$/, '');

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shortDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
const mondayOf = (d: Date) => {
  const m = new Date(d);
  m.setHours(0, 0, 0, 0);
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
};

type CalEvent = { date: string; type: string; title: string; subtitle?: string; avatarUrl?: string | null; mine?: boolean; employeeId?: number };
const EVENT_TONE: Record<string, { bg: string; border: string; text: string; label: string }> = {
  HOLIDAY: { bg: '#FEF2F2', border: '#FECACA', text: '#B91C1C', label: 'Holiday' },
  LEAVE: { bg: '#FFFBEB', border: '#FDE68A', text: '#B45309', label: 'Leave' },
  TASK: { bg: '#EFF6FF', border: '#BFDBFE', text: '#1D4ED8', label: 'My tasks' },
  DAY_OFF: { bg: '#F1F5F9', border: '#CBD5E1', text: '#475569', label: 'Day off' },
  BIRTHDAY: { bg: '#FDF2F8', border: '#FBCFE8', text: '#BE185D', label: 'Birthday' },
  ANNIVERSARY: { bg: '#F5F3FF', border: '#DDD6FE', text: '#6D28D9', label: 'Work anniversary' },
};
// The web hides shifts by default; so does mobile.
const HIDDEN_TYPES = new Set(['SHIFT']);

// Dashboard queue rows open the matching tab of the Approval Requests screen.
const QUEUE_TAB: Record<string, string> = {
  hours: 'HOURS', tasks: 'TASKS', budget: 'BUDGET', scope: 'SCOPE', locs: 'LOCATIONS', visits: 'VISITS', tickets: 'TICKETS',
};
const isPending = (s?: string) => !s || /^(PENDING|REQUESTED)/.test(String(s).toUpperCase());

export default function WorkspaceInsights({ onNavigate, reloadKey, showApprovals }: {
  onNavigate: Nav; reloadKey: number; showApprovals: boolean;
}) {
  const [common, setCommon] = useState<any>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [openGlance, setOpenGlance] = useState<string | null>(null);
  const [queues, setQueues] = useState<{ key: string; label: string; n: number; Icon: any }[]>([]);

  useEffect(() => {
    apiClient.get('/dashboard').then(({ data }) => setCommon(data?.common ?? null)).catch(() => {});
    // The web dashboard's list: only notices meant for this person.
    apiClient.get('/notices/dashboard').then(({ data }) => setNotices((data || []).slice(0, 3))).catch(() => {});
  }, [reloadKey]);

  useEffect(() => {
    const to = new Date(weekStart);
    to.setDate(to.getDate() + 6);
    apiClient.get('/dashboard/calendar', { params: { from: ymd(weekStart), to: ymd(to) } })
      .then(({ data }) => setEvents(data?.events || []))
      .catch(() => setEvents([]));
  }, [weekStart, reloadKey]);

  useEffect(() => {
    if (!showApprovals) return;
    const get = (url: string, params?: any) => apiClient.get(url, { params }).then((r) => r.data || []).catch(() => []);
    Promise.all([
      get('/task-hours-requests'),
      get('/task-approvals/pending'),
      get('/budget-requests/pending'),
      get('/scope-requests/pending'),
      get('/visit-location-requests'),
      get('/field-visit-requests', { status: 'PENDING_APPROVAL' }),
      get('/project-tickets/pending'),
    ]).then(([hours, tasks, budget, scope, locs, visits, tickets]) => {
      setQueues([
        { key: 'hours', label: 'Additional task hours', n: hours.filter((r: any) => r.status === 'REQUESTED').length, Icon: Timer },
        { key: 'tasks', label: 'Task approvals', n: tasks.length, Icon: ClipboardCheck },
        { key: 'budget', label: 'Budget', n: budget.length, Icon: Sparkles },
        { key: 'scope', label: 'Scope', n: scope.length, Icon: Info },
        { key: 'locs', label: 'Visit locations', n: locs.filter((r: any) => isPending(r.status)).length, Icon: MapPin },
        { key: 'visits', label: 'Field visits', n: visits.length, Icon: MapPin },
        { key: 'tickets', label: 'Project tickets', n: tickets.length, Icon: FileText },
      ]);
    });
  }, [showApprovals, reloadKey]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  }), [weekStart]);
  const byDay = useMemo(() => {
    const m = new Map<string, CalEvent[]>();
    for (const e of events) {
      if (HIDDEN_TYPES.has(e.type)) continue;
      const k = String(e.date).slice(0, 10);
      m.set(k, [...(m.get(k) || []), e]);
    }
    return m;
  }, [events]);
  const today = ymd(new Date());
  const weekEnd = days[6];
  const weekLabel = `${weekStart.getDate()} – ${weekEnd.getDate()} ${weekEnd.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`;
  const typeCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const list of byDay.values()) for (const e of list) c[e.type] = (c[e.type] || 0) + 1;
    return c;
  }, [byDay]);
  const shiftWeek = (n: number) => setWeekStart((w) => { const d = new Date(w); d.setDate(d.getDate() + 7 * n); return d; });

  const glance = useMemo(() => {
    if (!common) return [];
    const leave = common.onLeaveToday?.length || 0;
    const wfh = common.onWfhToday?.length || 0;
    const ms = (common.todayJoinings?.length || 0) + (common.todayAnniversaries?.length || 0);
    return [
      {
        id: 'leave',
        title: leave ? `${leave} on leave today` : 'Full team present',
        subtitle: leave ? 'Tap to view team members' : 'No scheduled leaves today',
        accent: !!leave,
        count: leave,
        people: common.onLeaveToday || [],
        note: (p: any) => p.leaveType + (p.isHalfDay ? ' (half day)' : ''),
        iconType: 'leave',
      },
      {
        id: 'wfh',
        title: wfh ? `${wfh} working remotely` : 'All working in office',
        subtitle: wfh ? 'Working from home today' : 'No remote requests today',
        accent: !!wfh,
        count: wfh,
        people: common.onWfhToday || [],
        note: () => 'Working from home',
        iconType: 'wfh',
      },
      {
        id: 'celebrations',
        title: ms ? `${ms} team celebration${ms > 1 ? 's' : ''}` : 'No celebrations today',
        subtitle: ms ? 'Work anniversaries & new joiners' : 'No anniversaries or joiners today',
        accent: !!ms,
        count: ms,
        people: [...(common.todayJoinings || []), ...(common.todayAnniversaries || [])],
        note: (p: any) =>
          p.years
            ? `${p.years} year${p.years > 1 ? 's' : ''} at company`
            : 'Joins today',
        iconType: 'celebrations',
      },
    ];
  }, [common]);

  const weekMinutes = useMemo(() => {
    const wl = common?.weekTimelogs;
    if (!wl) return null;
    if (typeof wl.totalMinutes === 'number') return wl.totalMinutes;
    if (Array.isArray(wl)) return wl.reduce((s: number, x: any) => s + (x.minutes || x.durationMin || 0), 0);
    return null;
  }, [common]);
  const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);

  const kpis = useMemo(() => {
    if (!common) return [];
    const a = common.myAttendanceThisMonth || {};
    const t = common.taskStats || {};
    const p = common.projectStats || {};
    const k = common.ticketStats || {};
    const bal: any[] = common.myLeaveBalance || [];
    // Same as the web: paid leave types only, allocated minus used.
    const paid = bal.filter((b) => b.leaveType?.isPaid !== false);
    const total = paid.reduce((s, b) => s + (Number(b.allocated) || 0), 0);
    const used = paid.reduce((s, b) => s + (Number(b.used) || 0), 0);
    const left = Math.round((total - used) * 10) / 10;
    return [
      { label: 'Days present (month)', value: a.presentCount ?? 0, sub: `${a.lateCount ?? 0} late · ${a.absentCount ?? 0} absent`, danger: false, Icon: UserCheck, color: '#059669', go: 'Attendance', params: { initialTab: 'timesheets' } },
      { label: 'Paid leave balance', value: left, sub: total ? `${used} of ${total} days used` : `${used} days used`, danger: false, Icon: CalendarDays, color: '#7C3AED', go: 'Leaves', params: undefined },
      { label: 'My open tasks', value: t.pending ?? 0, sub: t.overdue ? `${t.overdue} overdue` : 'All on schedule', danger: !!t.overdue, Icon: CheckSquare, color: '#DC2626', go: 'MyTasks', params: undefined },
      { label: 'Active projects', value: p.inProgress ?? 0, sub: `${p.total ?? 0} total · ${p.overdue ?? 0} delayed`, danger: !!p.overdue, Icon: FolderKanban, color: '#4F46E5', go: 'Projects', params: undefined },
      { label: 'Support tickets', value: k.pending ?? 0, sub: k.overdue ? `${k.overdue} overdue SLA` : 'All within SLA', danger: !!k.overdue, Icon: Ticket, color: '#D97706', go: 'Tickets', params: undefined },
    ];
  }, [common]);

  const queueTotal = queues.reduce((s, q) => s + q.n, 0);

  return (
    <View style={styles.wrap}>
      {notices.length > 0 && (
        <View style={styles.card}>
          <View style={styles.head}>
            <View style={styles.headLeft}>
              <Megaphone size={16} color="#1373E5" />
              <Text style={styles.title}>Company announcements</Text>
            </View>
            <TouchableOpacity style={styles.link} onPress={() => onNavigate('Notices')}>
              <Text style={styles.linkText}>All notices</Text>
              <ChevronRight size={14} color="#1373E5" />
            </TouchableOpacity>
          </View>
          {notices.map((n) => (
            <TouchableOpacity key={n.id} style={styles.notice} onPress={() => onNavigate('Notices')} activeOpacity={0.8}>
              <View style={styles.noticeTop}>
                {n.priority === 'HIGH' && <Text style={styles.urgent}>URGENT</Text>}
                <Text style={styles.noticeTitle} numberOfLines={1}>{n.title}</Text>
              </View>
              <Text style={styles.noticeBody} numberOfLines={1}>{String(n.body || '').replace(/<[^>]+>/g, ' ').trim()}</Text>
              <Text style={styles.noticeDate}>{shortDate(n.publishedAt)}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {glance.length > 0 && (
        <View style={styles.glanceCard}>
          {/* Header Row */}
          <View style={styles.glanceHead}>
            <View style={styles.glanceHeadLeft}>
              <View style={styles.livePulseDotWrap}>
                <View style={styles.livePulseDot} />
              </View>
              <Text style={styles.glanceLabel}>TODAY AT A GLANCE</Text>
            </View>
            <View style={styles.glanceDateBadge}>
              <Text style={styles.glanceDateBadgeText}>
                {new Date().toLocaleDateString('en-IN', {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                })}
              </Text>
            </View>
          </View>

          {/* Interactive Tiles */}
          <View style={styles.glanceTilesContainer}>
            {glance.map((g) => {
              const isOpen = openGlance === g.id;
              const hasPeople = g.people.length > 0;

              // Visual styling configuration depending on iconType and accent
              let iconBg = '#F1F5F9';
              let iconColor = '#64748B';
              let cardBg = '#F8FAFC';
              let borderColor = '#E2E8F0';
              let titleColor = '#0F172A';
              let subColor = '#64748B';
              let countPillBg = '#EFF6FF';
              let countPillColor = '#1373E5';
              let IconComp: any = CheckCircle2;

              if (g.iconType === 'leave') {
                if (g.accent) {
                  IconComp = Palmtree;
                  iconBg = '#FEF3C7';
                  iconColor = '#D97706';
                  cardBg = '#FFFBEB';
                  borderColor = '#FDE68A';
                  titleColor = '#92400E';
                  subColor = '#B45309';
                  countPillBg = '#FEF3C7';
                  countPillColor = '#B45309';
                } else {
                  IconComp = CheckCircle2;
                  iconBg = '#ECFDF5';
                  iconColor = '#10B981';
                  cardBg = '#F8FAFC';
                  borderColor = '#E2E8F0';
                  titleColor = '#0F172A';
                  subColor = '#64748B';
                }
              } else if (g.iconType === 'wfh') {
                if (g.accent) {
                  IconComp = Laptop;
                  iconBg = '#DBEAFE';
                  iconColor = '#1D4ED8';
                  cardBg = '#EFF6FF';
                  borderColor = '#BFDBFE';
                  titleColor = '#1E40AF';
                  subColor = '#2563EB';
                  countPillBg = '#DBEAFE';
                  countPillColor = '#1D4ED8';
                } else {
                  IconComp = Building2;
                  iconBg = '#F1F5F9';
                  iconColor = '#64748B';
                  cardBg = '#F8FAFC';
                  borderColor = '#E2E8F0';
                  titleColor = '#0F172A';
                  subColor = '#64748B';
                }
              } else if (g.iconType === 'celebrations') {
                if (g.accent) {
                  IconComp = PartyPopper;
                  iconBg = '#F3E8FF';
                  iconColor = '#7E22CE';
                  cardBg = '#FAF5FF';
                  borderColor = '#E9D5FF';
                  titleColor = '#6B21A8';
                  subColor = '#7E22CE';
                  countPillBg = '#F3E8FF';
                  countPillColor = '#7E22CE';
                } else {
                  IconComp = Sparkles;
                  iconBg = '#F1F5F9';
                  iconColor = '#94A3B8';
                  cardBg = '#F8FAFC';
                  borderColor = '#E2E8F0';
                  titleColor = '#475569';
                  subColor = '#94A3B8';
                }
              }

              return (
                <View key={g.id} style={styles.glanceTileWrapper}>
                  <TouchableOpacity
                    style={[
                      styles.glanceTile,
                      { backgroundColor: cardBg, borderColor },
                      isOpen && styles.glanceTileActive,
                    ]}
                    disabled={!hasPeople}
                    onPress={() => setOpenGlance((o) => (o === g.id ? null : g.id))}
                    activeOpacity={hasPeople ? 0.75 : 1}
                  >
                    <View style={[styles.glanceTileIconBox, { backgroundColor: iconBg }]}>
                      <IconComp size={16} color={iconColor} />
                    </View>

                    <View style={{ flex: 1, gap: 1 }}>
                      <Text style={[styles.glanceTileTitle, { color: titleColor }]}>
                        {g.title}
                      </Text>
                      <Text style={[styles.glanceTileSubtitle, { color: subColor }]}>
                        {g.subtitle}
                      </Text>
                    </View>

                    {hasPeople && (
                      <View style={styles.glanceTileRight}>
                        <View style={[styles.glanceCountPill, { backgroundColor: countPillBg }]}>
                          <Text style={[styles.glanceCountPillText, { color: countPillColor }]}>
                            {g.count}
                          </Text>
                        </View>
                        {isOpen ? (
                          <ChevronUp size={16} color={iconColor} />
                        ) : (
                          <ChevronDown size={16} color={iconColor} />
                        )}
                      </View>
                    )}
                  </TouchableOpacity>

                  {/* Expanded People List */}
                  {isOpen && hasPeople && (
                    <View style={styles.glanceExpandedBox}>
                      {g.people.map((p: PersonLite & any, i: number) => (
                        <PersonTap
                          key={`${p.id}-${i}`}
                          person={p}
                          style={styles.glancePersonRow}
                        >
                          <Avatar person={p} size={34} />
                          <View style={{ flex: 1 }}>
                            <Text style={styles.glancePersonName} numberOfLines={1}>
                              {`${p.firstName} ${p.lastName || ''}`.trim()}
                            </Text>
                            <Text style={styles.glancePersonRole} numberOfLines={1}>
                              {p.designation || p.department || 'Team member'}
                            </Text>
                          </View>
                          <View style={styles.glanceNotePill}>
                            <Text style={styles.glanceNotePillText} numberOfLines={1}>
                              {g.note(p)}
                            </Text>
                          </View>
                          <ChevronRight size={14} color="#CBD5E1" />
                        </PersonTap>
                      ))}
                    </View>
                  )}
                </View>
              );
            })}
          </View>

          {/* Logged This Week Bar */}
          {weekMinutes != null && (
            <TouchableOpacity
              style={styles.weekLoggedCard}
              onPress={() => onNavigate('Attendance', { initialTab: 'timesheets' })}
              activeOpacity={0.8}
            >
              <View style={styles.weekLoggedIconBox}>
                <Clock size={16} color="#1373E5" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.weekLoggedLabel}>THIS WEEK'S WORK</Text>
                <Text style={styles.weekLoggedValue}>
                  {fmtMin(weekMinutes)}{' '}
                  <Text style={styles.weekLoggedTarget}>logged</Text>
                </Text>
              </View>
              <View style={styles.weekLoggedAction}>
                <Text style={styles.weekLoggedActionText}>Timesheets</Text>
                <ChevronRight size={14} color="#1373E5" />
              </View>
            </TouchableOpacity>
          )}
        </View>
      )}

      {kpis.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.kpiRow}>
          {kpis.map(({ label, value, sub, danger, Icon, color, go, params }) => (
            <TouchableOpacity key={label} style={[styles.kpi, { borderTopColor: color }]} onPress={() => onNavigate(go, params)} activeOpacity={0.85}>
              <View style={[styles.kpiIcon, { backgroundColor: color + '18' }]}><Icon size={18} color={color} /></View>
              <Text style={styles.kpiValue}>{value}</Text>
              <Text style={styles.kpiLabel}>{label}</Text>
              <Text style={[styles.kpiSub, danger && styles.kpiDanger]} numberOfLines={2}>{sub}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      <View style={styles.card}>
        <View style={styles.head}>
          <View style={styles.headLeft}>
            <CalendarDays size={16} color="#4F46E5" />
            <Text style={styles.title}>My calendar</Text>
            <Text style={styles.pill}>{weekLabel}</Text>
          </View>
          <View style={styles.navBtns}>
            <TouchableOpacity style={styles.navBtn} onPress={() => shiftWeek(-1)}><ChevronLeft size={16} color="#334155" /></TouchableOpacity>
            <TouchableOpacity style={styles.navBtn} onPress={() => setWeekStart(mondayOf(new Date()))}><Text style={styles.todayBtn}>Today</Text></TouchableOpacity>
            <TouchableOpacity style={styles.navBtn} onPress={() => shiftWeek(1)}><ChevronRight size={16} color="#334155" /></TouchableOpacity>
          </View>
        </View>
        <View style={styles.legend}>
          {Object.entries(typeCounts).map(([t, n]) => {
            const tone = EVENT_TONE[t];
            return tone ? (
              <View key={t} style={[styles.legendChip, { backgroundColor: tone.bg, borderColor: tone.border }]}>
                <Text style={[styles.legendText, { color: tone.text }]}>{tone.label} {n}</Text>
              </View>
            ) : null;
          })}
        </View>
        {days.map((d) => {
          const k = ymd(d);
          const list = byDay.get(k) || [];
          const isToday = k === today;
          return (
            <View key={k} style={[styles.dayRow, isToday && styles.dayRowToday]}>
              <View style={styles.dayCol}>
                <Text style={[styles.dayName, isToday && styles.todayText]}>{d.toLocaleDateString('en-IN', { weekday: 'short' }).toUpperCase()}</Text>
                <Text style={[styles.dayNum, isToday && styles.todayText]}>{d.getDate()}</Text>
              </View>
              <View style={styles.dayEvents}>
                {list.length ? list.map((e, i) => {
                  const tone = EVENT_TONE[e.type] || EVENT_TONE.DAY_OFF;
                  return (
                    <PersonTap
                      key={i}
                      // Holidays and days off are nobody's; only people open a profile.
                      person={e.employeeId ? { id: e.employeeId, firstName: e.title, avatarUrl: e.avatarUrl } : null}
                      style={[styles.event, { backgroundColor: tone.bg, borderLeftColor: tone.text }]}
                    >
                      {e.employeeId ? <Avatar person={{ id: e.employeeId, firstName: e.title, avatarUrl: e.avatarUrl }} size={22} />
                        : e.avatarUrl ? <Image source={{ uri: e.avatarUrl }} style={styles.avatar} /> : null}
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.eventTitle, { color: tone.text }]} numberOfLines={1}>{e.title}</Text>
                        {!!e.subtitle && <Text style={styles.eventSub} numberOfLines={1}>{e.subtitle}</Text>}
                      </View>
                    </PersonTap>
                  );
                }) : <Text style={styles.noEvents}>—</Text>}
              </View>
            </View>
          );
        })}
      </View>

      {showApprovals && queues.length > 0 && (
        <View style={styles.card}>
          <View style={styles.head}>
            <Text style={styles.title}>Approval requests · {queueTotal}</Text>
            <TouchableOpacity style={styles.link} onPress={() => onNavigate('ApprovalRequests')}>
              <Text style={styles.linkText}>Open full page</Text>
              <ChevronRight size={14} color="#1373E5" />
            </TouchableOpacity>
          </View>
          {queues.map(({ key, label, n, Icon }) => (
            <TouchableOpacity key={key} style={styles.queueRow} onPress={() => onNavigate('ApprovalRequests', { queue: QUEUE_TAB[key] })} activeOpacity={0.7}>
              <Icon size={15} color={n ? '#1373E5' : '#94A3B8'} />
              <Text style={[styles.queueLabel, !n && styles.muted]}>{label}</Text>
              <Text style={[styles.queueNum, !n && styles.muted]}>{n}</Text>
              <ChevronRight size={14} color="#CBD5E1" />
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14, marginBottom: 14 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 18, borderWidth: 1, borderColor: '#E2E8F0', padding: 14, gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  headLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  title: { fontSize: 15, fontWeight: '800', color: '#0F172A' },
  link: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  linkText: { fontSize: 12, fontWeight: '700', color: '#1373E5' },
  notice: { backgroundColor: '#F8FAFC', borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', padding: 10, gap: 3 },
  noticeTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  urgent: { fontSize: 10, fontWeight: '800', color: '#DC2626', backgroundColor: '#FEF2F2', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, overflow: 'hidden' },
  noticeTitle: { flex: 1, fontSize: 14, fontWeight: '700', color: '#0F172A' },
  noticeBody: { fontSize: 12, color: '#64748B' },
  noticeDate: { fontSize: 11, color: '#94A3B8' },
  // -------------------------------------------------------------
  // TODAY AT A GLANCE STYLES
  // -------------------------------------------------------------
  glanceCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 16,
    gap: 12,
    ...Platform.select({
      ios: {
        shadowColor: '#0F172A',
        shadowOpacity: 0.05,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
      },
      android: {
        elevation: 2,
      },
    }),
  },
  glanceHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  glanceHeadLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  livePulseDotWrap: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#D1FAE5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  livePulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10B981',
  },
  glanceLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: 0.5,
  },
  glanceDateBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  glanceDateBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  glanceTilesContainer: {
    gap: 8,
  },
  glanceTileWrapper: {
    gap: 6,
  },
  glanceTile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  glanceTileActive: {
    borderBottomLeftRadius: 6,
    borderBottomRightRadius: 6,
  },
  glanceTileIconBox: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glanceTileTitle: {
    fontSize: 13,
    fontWeight: '800',
  },
  glanceTileSubtitle: {
    fontSize: 11,
    fontWeight: '600',
  },
  glanceTileRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  glanceCountPill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
  },
  glanceCountPillText: {
    fontSize: 11,
    fontWeight: '800',
  },
  glanceExpandedBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 4,
  },
  glancePersonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F8FAFC',
  },
  glancePersonName: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
  },
  glancePersonRole: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
    marginTop: 1,
  },
  glanceNotePill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: '#FEF3C7',
    maxWidth: 120,
  },
  glanceNotePillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#B45309',
  },
  weekLoggedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#F0F9FF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#BAE6FD',
    padding: 12,
    marginTop: 2,
  },
  weekLoggedIconBox: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  weekLoggedLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#0369A1',
    letterSpacing: 0.5,
  },
  weekLoggedValue: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0C4A6E',
    marginTop: 1,
  },
  weekLoggedTarget: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0284C7',
  },
  weekLoggedAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  weekLoggedActionText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#1373E5',
  },
  kpiRow: { gap: 10, paddingRight: 4 },
  kpi: { width: 150, backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: '#E2E8F0', borderTopWidth: 3, padding: 12, gap: 3 },
  kpiIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  kpiValue: { fontSize: 24, fontWeight: '800', color: '#0F172A' },
  kpiLabel: { fontSize: 13, fontWeight: '700', color: '#0F172A' },
  kpiSub: { fontSize: 11, color: '#64748B' },
  kpiDanger: { color: '#DC2626', fontWeight: '700' },
  pill: { fontSize: 11, fontWeight: '700', color: '#1D4ED8', backgroundColor: '#EFF6FF', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: 'hidden' },
  navBtns: { flexDirection: 'row', gap: 4 },
  navBtn: { borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 8, paddingHorizontal: 6, height: 28, alignItems: 'center', justifyContent: 'center' },
  todayBtn: { fontSize: 11, fontWeight: '700', color: '#334155' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  legendChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  legendText: { fontSize: 11, fontWeight: '700' },
  dayRow: { flexDirection: 'row', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  dayRowToday: { backgroundColor: '#F8FAFF', borderRadius: 10 },
  dayCol: { width: 40, alignItems: 'center' },
  dayName: { fontSize: 10, fontWeight: '700', color: '#64748B' },
  dayNum: { fontSize: 18, fontWeight: '800', color: '#0F172A' },
  todayText: { color: '#1373E5' },
  dayEvents: { flex: 1, gap: 6, justifyContent: 'center' },
  event: { flexDirection: 'row', alignItems: 'center', gap: 8, borderLeftWidth: 3, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 8 },
  avatar: { width: 22, height: 22, borderRadius: 11 },
  eventTitle: { fontSize: 13, fontWeight: '700' },
  eventSub: { fontSize: 11, color: '#64748B' },
  noEvents: { fontSize: 13, color: '#CBD5E1' },
  queueRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  queueLabel: { flex: 1, fontSize: 13, fontWeight: '600', color: '#0F172A' },
  queueNum: { fontSize: 14, fontWeight: '800', color: '#1373E5' },
  muted: { color: '#94A3B8' },
});
