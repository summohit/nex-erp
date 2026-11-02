import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Image, Linking } from 'react-native';
import {
  Megaphone, ChevronRight, ChevronLeft, UserCheck, CalendarDays, CheckSquare, FolderKanban, Ticket,
  Timer, ClipboardCheck, Sparkles, Info, MapPin, FileText,
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

type CalEvent = { date: string; type: string; title: string; subtitle?: string; avatarUrl?: string | null; mine?: boolean };
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
      { text: leave ? `${leave} on leave today` : 'Full team present', accent: !!leave, people: common.onLeaveToday || [], note: (p: any) => p.leaveType + (p.isHalfDay ? ' (half day)' : '') },
      { text: wfh ? `${wfh} working remotely` : 'No WFH today', accent: !!wfh, people: common.onWfhToday || [], note: () => 'Working from home' },
      { text: ms ? `${ms} celebration${ms > 1 ? 's' : ''} today` : 'No joinings or anniversaries today', accent: !!ms,
        people: [...(common.todayJoinings || []), ...(common.todayAnniversaries || [])],
        note: (p: any) => (p.years ? `${p.years} year${p.years > 1 ? 's' : ''} at the company` : 'Joins today') },
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
        <View style={styles.glance}>
          <View style={styles.headLeft}>
            <View style={styles.dot} />
            <Text style={styles.glanceLabel}>TODAY AT A GLANCE</Text>
          </View>
          {glance.map((g) => (
            <View key={g.text}>
              <TouchableOpacity disabled={!g.people.length} onPress={() => setOpenGlance((o) => (o === g.text ? null : g.text))}>
                <Text style={[styles.glanceItem, g.accent && styles.glanceAccent]}>
                  • {g.text}{g.people.length ? (openGlance === g.text ? '  ▲' : '  ▼') : ''}
                </Text>
              </TouchableOpacity>
              {openGlance === g.text && g.people.map((p: PersonLite & any, i: number) => (
                <PersonTap key={`${p.id}-${i}`} person={p} style={styles.glancePerson}>
                  <Avatar person={p} size={30} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.glanceName} numberOfLines={1}>{`${p.firstName} ${p.lastName || ''}`.trim()}</Text>
                    <Text style={styles.glanceNote} numberOfLines={1}>{[g.note(p), p.designation].filter(Boolean).join(' · ')}</Text>
                  </View>
                </PersonTap>
              ))}
            </View>
          ))}
          {weekMinutes != null && <Text style={styles.glanceWeek}>This week: <Text style={styles.bold}>{fmtMin(weekMinutes)}</Text> logged</Text>}
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
                    <View key={i} style={[styles.event, { backgroundColor: tone.bg, borderLeftColor: tone.text }]}>
                      {e.avatarUrl ? <Image source={{ uri: e.avatarUrl }} style={styles.avatar} /> : null}
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.eventTitle, { color: tone.text }]} numberOfLines={1}>{e.title}</Text>
                        {!!e.subtitle && <Text style={styles.eventSub} numberOfLines={1}>{e.subtitle}</Text>}
                      </View>
                    </View>
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
            <TouchableOpacity style={styles.link} onPress={() => Linking.openURL(`${WEB_URL}/task-requests`)}>
              <Text style={styles.linkText}>Open full page</Text>
              <ChevronRight size={14} color="#1373E5" />
            </TouchableOpacity>
          </View>
          {queues.map(({ key, label, n, Icon }) => (
            <View key={key} style={styles.queueRow}>
              <Icon size={15} color={n ? '#1373E5' : '#94A3B8'} />
              <Text style={[styles.queueLabel, !n && styles.muted]}>{label}</Text>
              <Text style={[styles.queueNum, !n && styles.muted]}>{n}</Text>
            </View>
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
  glance: { backgroundColor: '#FFFFFF', borderRadius: 18, borderWidth: 1, borderColor: '#E2E8F0', padding: 14, gap: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#10B981' },
  glanceLabel: { fontSize: 12, fontWeight: '800', color: '#0F172A', letterSpacing: 0.5 },
  glancePerson: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, paddingLeft: 12 },
  glanceName: { fontSize: 13, fontWeight: '700', color: '#0F172A' },
  glanceNote: { fontSize: 11, color: '#64748B' },
  glanceItem: { fontSize: 13, color: '#334155' },
  glanceAccent: { color: '#1373E5', fontWeight: '700' },
  glanceWeek: { fontSize: 12, color: '#64748B', marginTop: 2 },
  bold: { fontWeight: '800', color: '#0F172A' },
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
