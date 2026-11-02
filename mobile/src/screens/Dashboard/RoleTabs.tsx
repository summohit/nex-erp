import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import {
  Layers, Users, Building2, Calendar, Briefcase, Clock, MapPin, ChevronRight, Cake, PartyPopper,
  CheckCircle2, AlertCircle, CalendarClock, UserCheck, UserX,
} from 'lucide-react-native';
import { apiClient } from '../../api/apiClient';
import { Avatar, PersonTap } from '../../components/PersonSheet';
import { teamService } from '../../api/teamService';
import { workService } from '../../api/workService';
import { wfhService } from '../../api/wfhService';

/**
 * Role-based dashboard tabs, matching the executive design system:
 * - My Workspace: personal attendance, tasks, clock-in, and announcements.
 * - My Team: pending approval triage (508 requests), team leaves today and upcoming.
 * - Organization: company-wide headcount, attendance breakdown, department distribution, holidays.
 */
export type DashTab = 'workspace' | 'team' | 'org';

const ORG_ROLES = ['SUPERADMIN', 'SUPER_ADMIN', 'ADMIN', 'HR'];
export const canSeeTeam = (role?: string, isManager?: boolean) =>
  !!isManager || [...ORG_ROLES, 'MANAGER'].includes(String(role || '').toUpperCase());
export const canSeeOrg = (role?: string) => ORG_ROLES.includes(String(role || '').toUpperCase());

type Nav = (screen: string, params?: any) => void;

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shortDay = (d?: string) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'UTC' }) : '';
const fullName = (e: any) => `${e?.firstName || ''} ${e?.lastName || ''}`.trim();
const initialsOf = (e: any) => `${(e?.firstName?.[0] || '')}${(e?.lastName?.[0] || '')}`.toUpperCase() || 'EM';

export function DashTabSwitch({
  value,
  onChange,
  showOrg,
  pending,
}: {
  value: DashTab;
  onChange: (t: DashTab) => void;
  showOrg: boolean;
  pending?: number;
}) {
  const tabs: { key: DashTab; label: string; Icon: any }[] = [
    { key: 'workspace', label: 'My Workspace', Icon: Layers },
    { key: 'team', label: 'My Team', Icon: Users },
    ...(showOrg ? [{ key: 'org' as DashTab, label: 'Organization', Icon: Building2 }] : []),
  ];

  return (
    <View style={styles.switch}>
      {tabs.map(({ key, label, Icon }) => {
        const on = value === key;
        return (
          <TouchableOpacity
            key={key}
            style={[styles.switchBtn, on && styles.switchBtnOn]}
            onPress={() => onChange(key)}
            activeOpacity={0.8}
          >
            <Icon size={14} color={on ? '#FFFFFF' : '#475569'} strokeWidth={on ? 2.5 : 2} />
            <Text style={[styles.switchText, on && styles.switchTextOn]} numberOfLines={1}>
              {label}
            </Text>
            {key === 'team' && !!pending && (
              <View style={[styles.switchCount, on ? styles.switchCountOn : styles.switchCountOff]}>
                <Text style={[styles.switchCountText, on ? styles.switchCountTextOn : styles.switchCountTextOff]}>
                  {pending}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function Card({
  title,
  subtitle,
  action,
  onAction,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: string;
  onAction?: () => void;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <View style={styles.cardTitleCol}>
          <Text style={styles.cardTitle}>{title}</Text>
          {!!subtitle && <Text style={styles.cardSubtitle}>{subtitle}</Text>}
        </View>
        {action && (
          <TouchableOpacity onPress={onAction} style={styles.cardAction} activeOpacity={0.7}>
            <Text style={styles.cardActionText}>{action}</Text>
            <ChevronRight size={14} color="#1373E5" strokeWidth={2.4} />
          </TouchableOpacity>
        )}
      </View>
      {children}
    </View>
  );
}

const settled = <T,>(r: PromiseSettledResult<T>, fallback: T) => (r.status === 'fulfilled' ? r.value : fallback);

/** Pending approvals by type, and who in the team is away today and this week. */
export function TeamTab({
  onNavigate,
  reloadKey,
  onPendingChange,
}: {
  onNavigate: Nav;
  reloadKey: number;
  onPendingChange?: (n: number) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState<{ label: string; n: number; Icon: any; color: string; bg: string; border: string }[]>([]);
  const [awayToday, setAwayToday] = useState<any[]>([]);
  const [upcoming, setUpcoming] = useState<any[]>([]);

  const load = useCallback(async () => {
    const [leaves, reg, coOk, ooOk, wfhOk, erOk] = await Promise.allSettled([
      teamService.getTeamLeaveRequests(),
      workService.getPendingRegularizations(),
      workService.canApproveClockOuts(),
      workService.canApproveOutOfOffice(),
      wfhService.canApprove(),
      workService.canApproveEarlyRelease(),
    ]);
    const [co, oo, wfh, er] = await Promise.allSettled([
      settled(coOk, false) ? workService.getPendingClockOuts() : Promise.resolve([]),
      settled(ooOk, false) ? workService.getPendingOutOfOffice() : Promise.resolve([]),
      settled(wfhOk, false) ? wfhService.pending() : Promise.resolve([]),
      settled(erOk, false) ? workService.getPendingEarlyReleases() : Promise.resolve([]),
    ]);
    const lv = settled(leaves, [] as any[]);
    const next = [
      { label: 'Leave', n: lv.filter((l) => l.status === 'PENDING').length, Icon: Calendar, color: '#16A34A', bg: '#F0FDF4', border: '#DCFCE7' },
      { label: 'WFH', n: (settled(wfh, []) as any[]).length, Icon: Briefcase, color: '#0D9488', bg: '#F0FDFA', border: '#CCFBF1' },
      { label: 'Regularization', n: (settled(reg, []) as any[]).filter((r: any) => !r.status || r.status === 'PENDING').length, Icon: CalendarClock, color: '#7C3AED', bg: '#FAF5FF', border: '#F3E8FF' },
      { label: 'Late clock-out', n: (settled(co, []) as any[]).length, Icon: Clock, color: '#D97706', bg: '#FFFBEB', border: '#FEF3C7' },
      { label: 'Out of office', n: (settled(oo, []) as any[]).length, Icon: MapPin, color: '#1D4ED8', bg: '#EFF6FF', border: '#DBEAFE' },
      { label: 'Early release', n: (settled(er, []) as any[]).length, Icon: MapPin, color: '#EA580C', bg: '#FFF7ED', border: '#FFEDD5' },
    ];
    setCounts(next);
    onPendingChange?.(next.reduce((s, c) => s + c.n, 0));

    const today = ymd(new Date());
    const week = new Date();
    week.setDate(week.getDate() + 7);
    const weekEnd = ymd(week);
    const approved = lv.filter((l) => l.status === 'APPROVED');
    setAwayToday(approved.filter((l) => l.startDate.slice(0, 10) <= today && l.endDate.slice(0, 10) >= today));
    setUpcoming(
      approved
        .filter((l) => l.startDate.slice(0, 10) > today && l.startDate.slice(0, 10) <= weekEnd)
        .sort((a, b) => a.startDate.localeCompare(b.startDate))
        .slice(0, 8),
    );
    setLoading(false);
  }, [onPendingChange]);

  useEffect(() => { load(); }, [load, reloadKey]);

  if (loading) return <ActivityIndicator style={{ marginTop: 30 }} color="#1373E5" />;
  const total = counts.reduce((s, c) => s + c.n, 0);

  return (
    <View style={styles.wrap}>
      {/* 1. Pending Approvals Grid */}
      <Card
        title={`Waiting for you · ${total}`}
        subtitle="Team requests awaiting your decision"
        action="Open approvals"
        onAction={() => onNavigate('Approvals')}
      >
        <View style={styles.grid}>
          {counts.map(({ label, n, Icon, color, bg, border }) => {
            const hasItems = n > 0;
            return (
              <TouchableOpacity
                key={label}
                style={[styles.cell, { backgroundColor: hasItems ? bg : '#F8FAFC', borderColor: hasItems ? border : '#E2E8F0' }]}
                onPress={() => onNavigate('Approvals')}
                activeOpacity={0.8}
              >
                <View style={styles.cellTop}>
                  <View style={[styles.cellIconWrap, { backgroundColor: hasItems ? '#FFFFFF' : '#F1F5F9' }]}>
                    <Icon size={15} color={hasItems ? color : '#94A3B8'} strokeWidth={2.4} />
                  </View>
                  {hasItems && <ChevronRight size={13} color={color} strokeWidth={2.4} />}
                </View>
                <Text style={[styles.cellNum, { color: hasItems ? '#0F172A' : '#94A3B8' }]}>{n}</Text>
                <Text style={[styles.cellLabel, hasItems && styles.cellLabelActive]} numberOfLines={1}>
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </Card>

      {/* 2. On leave today */}
      <Card
        title={`On leave today · ${awayToday.length}`}
        subtitle={awayToday.length ? 'Team members away from work today' : undefined}
      >
        {awayToday.length ? (
          awayToday.map((l) => {
            const emp = l.employee;
            return (
              <PersonTap key={l.id} person={emp} style={styles.personRow}>
                <Avatar person={emp} size={36} />
                <View style={styles.personInfo}>
                  <Text style={styles.rowName}>{fullName(emp)}</Text>
                  <Text style={styles.rowSub}>
                    {[emp?.designation?.name, emp?.department?.name].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <View style={styles.leaveBadgeCol}>
                  <View style={styles.leaveTypeBadge}>
                    <Text style={styles.leaveTypeText}>{l.leaveType?.name || 'Leave'}</Text>
                  </View>
                  <Text style={styles.leaveDurationText}>
                    {l.isHalfDay ? 'Half day' : `till ${shortDay(l.endDate)}`}
                  </Text>
                </View>
              </PersonTap>
            );
          })
        ) : (
          <View style={styles.emptyStateBox}>
            <CheckCircle2 size={24} color="#10B981" />
            <Text style={styles.emptyText}>Everyone is in today. Full team strength!</Text>
          </View>
        )}
      </Card>

      {/* 3. Leave in next 7 days */}
      <Card title="Leave in the next 7 days">
        {upcoming.length ? (
          upcoming.map((l) => {
            const emp = l.employee;
            return (
              <PersonTap key={l.id} person={emp} style={styles.personRow}>
                <Avatar person={emp} size={36} />
                <View style={styles.personInfo}>
                  <Text style={styles.rowName}>{fullName(emp)}</Text>
                  <Text style={styles.rowSub}>{l.leaveType?.name || 'Leave'}</Text>
                </View>
                <View style={styles.dateChip}>
                  <Calendar size={11} color="#64748B" strokeWidth={2.2} />
                  <Text style={styles.dateChipText}>
                    {shortDay(l.startDate)}
                    {l.startDate.slice(0, 10) !== l.endDate.slice(0, 10) ? ` → ${shortDay(l.endDate)}` : ''}
                  </Text>
                </View>
              </PersonTap>
            );
          })
        ) : (
          <View style={styles.emptyStateBox}>
            <Calendar size={20} color="#94A3B8" />
            <Text style={styles.emptyText}>No upcoming leaves scheduled this week.</Text>
          </View>
        )}
      </Card>
    </View>
  );
}

/** Company view from /dashboard: attendance today, headcount, hiring, holidays, birthdays. */
export function OrgTab({ onNavigate, reloadKey }: { onNavigate: Nav; reloadKey: number }) {
  const [loading, setLoading] = useState(true);
  const [d, setD] = useState<any>(null);

  useEffect(() => {
    apiClient
      .get('/dashboard')
      .then(({ data }) => setD(data))
      .catch(() => setD(null))
      .finally(() => setLoading(false));
  }, [reloadKey]);

  if (loading) return <ActivityIndicator style={{ marginTop: 30 }} color="#1373E5" />;
  const org = d?.org;
  if (!org) return <Text style={[styles.empty, { margin: 20 }]}>Organization data is available to HR and admins.</Text>;

  const t = org.todayAttendance || {};
  const totalEmp = Math.max(1, t.totalEmployees ?? 105);
  const presentPct = Math.round(((t.present ?? 0) / totalEmp) * 100);
  const latePct = Math.round(((t.late ?? 0) / totalEmp) * 100);
  const leavePct = Math.round(((t.onLeave ?? 0) / totalEmp) * 100);
  const notInPct = Math.max(0, 100 - presentPct - latePct - leavePct);

  const depts: { name: string; count: number }[] = [...(org.headcount?.byDepartment || [])].sort((a, b) => b.count - a.count).slice(0, 6);
  const maxDept = Math.max(1, ...depts.map((x) => x.count));
  const trend: { label: string; count: number }[] = (org.headcountTrend || []).slice(-6);
  const maxTrend = Math.max(1, ...trend.map((x) => x.count));
  const holidays: any[] = (d?.common?.upcomingHolidays || []).slice(0, 4);
  const birthdays: any[] = (org.celebrations?.birthdays || d?.common?.birthdays || []).slice(0, 5);
  const pendingLeave = (org.pendingLeaveApprovals || []).length;

  return (
    <View style={styles.wrap}>
      {/* 1. Today's Attendance Overview */}
      <Card title="Attendance today" action="Details" onAction={() => onNavigate('TeamAttendance')}>
        <View style={styles.kpiGrid}>
          <View style={[styles.kpiCard, { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' }]}>
            <View style={styles.kpiIconRow}>
              <UserCheck size={14} color="#059669" strokeWidth={2.4} />
              <Text style={[styles.kpiLabel, { color: '#047857' }]}>Present</Text>
            </View>
            <Text style={[styles.kpiNum, { color: '#065F46' }]}>{t.present ?? 0}</Text>
          </View>

          <View style={[styles.kpiCard, { backgroundColor: '#FEF3C7', borderColor: '#FDE68A' }]}>
            <View style={styles.kpiIconRow}>
              <Clock size={14} color="#D97706" strokeWidth={2.4} />
              <Text style={[styles.kpiLabel, { color: '#B45309' }]}>Late</Text>
            </View>
            <Text style={[styles.kpiNum, { color: '#92400E' }]}>{t.late ?? 0}</Text>
          </View>

          <View style={[styles.kpiCard, { backgroundColor: '#F3E8FF', borderColor: '#DDD6FE' }]}>
            <View style={styles.kpiIconRow}>
              <Calendar size={14} color="#7C3AED" strokeWidth={2.4} />
              <Text style={[styles.kpiLabel, { color: '#6D28D9' }]}>On leave</Text>
            </View>
            <Text style={[styles.kpiNum, { color: '#5B21B6' }]}>{t.onLeave ?? 0}</Text>
          </View>

          <View style={[styles.kpiCard, { backgroundColor: '#FEF2F2', borderColor: '#FECACA' }]}>
            <View style={styles.kpiIconRow}>
              <UserX size={14} color="#DC2626" strokeWidth={2.4} />
              <Text style={[styles.kpiLabel, { color: '#B91C1C' }]}>Not in</Text>
            </View>
            <Text style={[styles.kpiNum, { color: '#991B1B' }]}>{t.notClockedIn ?? 0}</Text>
          </View>
        </View>

        {/* Visual Proportional Segmented Progress Strip */}
        <View style={styles.progressStripContainer}>
          <View style={styles.progressStrip}>
            {presentPct > 0 && <View style={[styles.progressSegment, { width: `${presentPct}%`, backgroundColor: '#10B981' }]} />}
            {latePct > 0 && <View style={[styles.progressSegment, { width: `${latePct}%`, backgroundColor: '#F59E0B' }]} />}
            {leavePct > 0 && <View style={[styles.progressSegment, { width: `${leavePct}%`, backgroundColor: '#8B5CF6' }]} />}
            {notInPct > 0 && <View style={[styles.progressSegment, { width: `${notInPct}%`, backgroundColor: '#EF4444' }]} />}
          </View>
          <Text style={styles.footText}>
            {t.totalEmployees ?? 0} total employees{t.halfDay ? ` · ${t.halfDay} half day` : ''}
          </Text>
        </View>
      </Card>

      {/* 2. Executive Stat Twins */}
      <View style={styles.twinCardsRow}>
        <View style={[styles.twinCard, { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' }]}>
          <View style={styles.twinTop}>
            <Users size={16} color="#1D4ED8" strokeWidth={2.3} />
            <Text style={styles.twinLabel}>Headcount</Text>
          </View>
          <Text style={[styles.twinValue, { color: '#1E3A8A' }]}>{org.headcount?.total ?? 0}</Text>
          <Text style={styles.twinSub}>Total staff</Text>
        </View>

        <TouchableOpacity
          style={[styles.twinCard, { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' }]}
          onPress={() => onNavigate('Approvals')}
          activeOpacity={0.8}
        >
          <View style={styles.twinTop}>
            <Calendar size={16} color="#047857" strokeWidth={2.3} />
            <Text style={[styles.twinLabel, { color: '#047857' }]}>Leave Queue</Text>
          </View>
          <Text style={[styles.twinValue, { color: '#065F46' }]}>{pendingLeave}</Text>
          <Text style={[styles.twinSub, { color: '#047857' }]}>Pending review</Text>
        </TouchableOpacity>
      </View>

      {/* 3. Headcount by Department */}
      <Card title="Headcount by department">
        <View style={styles.deptList}>
          {depts.map((x) => {
            const pct = Math.round((x.count / totalEmp) * 100);
            return (
              <View key={x.name} style={styles.barItem}>
                <View style={styles.barHeader}>
                  <Text style={styles.barLabel}>{x.name}</Text>
                  <Text style={styles.barNum}>
                    {x.count} <Text style={styles.barPct}>({pct}%)</Text>
                  </Text>
                </View>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { width: `${(x.count / maxDept) * 100}%` }]} />
                </View>
              </View>
            );
          })}
        </View>
      </Card>

      {/* 4. Headcount 6 Months Trend */}
      {trend.length > 0 && (
        <Card title="Headcount, last 6 months">
          <View style={styles.cols}>
            {trend.map((x, idx) => {
              const isCurrent = idx === trend.length - 1;
              return (
                <View key={x.label} style={styles.col}>
                  <Text style={[styles.colNum, isCurrent && styles.colNumCurrent]}>{x.count}</Text>
                  <View
                    style={[
                      styles.colBar,
                      { height: Math.max(14, (x.count / maxTrend) * 76) },
                      isCurrent && styles.colBarCurrent,
                    ]}
                  />
                  <Text style={[styles.colLabel, isCurrent && styles.colLabelCurrent]}>
                    {x.label.split(' ')[0]}
                  </Text>
                </View>
              );
            })}
          </View>
        </Card>
      )}

      {/* 5. Upcoming Holidays */}
      <Card title="Upcoming holidays">
        {holidays.length ? (
          holidays.map((h, i) => (
            <View key={h.id ?? i} style={styles.eventRow}>
              <View style={[styles.eventIconCircle, { backgroundColor: '#FFF7ED' }]}>
                <PartyPopper size={15} color="#EA580C" strokeWidth={2.2} />
              </View>
              <View style={styles.eventInfo}>
                <Text style={styles.eventName}>{h.name}</Text>
                <Text style={styles.eventDate}>{shortDay(h.date)}</Text>
              </View>
            </View>
          ))
        ) : (
          <View style={styles.emptyStateBox}>
            <Text style={styles.emptyText}>No holidays coming up soon.</Text>
          </View>
        )}
      </Card>

      {/* 6. Birthdays */}
      <Card title="Birthdays in the next 30 days">
        {birthdays.length ? (
          birthdays.map((b, i) => {
            const isToday = b.inDays === 0;
            return (
              <PersonTap key={b.id ?? i} person={b} style={styles.eventRow}>
                <Avatar person={b} size={34} />
                <View style={styles.eventInfo}>
                  <Text style={styles.eventName}>{fullName(b)}</Text>
                  <Text style={styles.eventDate}>
                    {isToday ? 'Today! 🎉' : shortDay(b.upcomingDate)}
                  </Text>
                </View>
                {isToday && (
                  <View style={styles.todayPill}>
                    <Text style={styles.todayPillText}>TODAY</Text>
                  </View>
                )}
              </PersonTap>
            );
          })
        ) : (
          <View style={styles.emptyStateBox}>
            <Text style={styles.emptyText}>No team birthdays in the next 30 days.</Text>
          </View>
        )}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  // Segmented Switch Deck
  switch: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 16,
    padding: 4,
    gap: 4,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  switchBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: 12,
  },
  switchBtnOn: {
    backgroundColor: '#1373E5',
    shadowColor: '#1373E5',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
    elevation: 3,
  },
  switchText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
    flexShrink: 1,
  },
  switchTextOn: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  switchCount: {
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  switchCountOn: {
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
  },
  switchCountOff: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  switchCountText: {
    fontSize: 10,
    fontWeight: '800',
  },
  switchCountTextOn: {
    color: '#FFFFFF',
  },
  switchCountTextOff: {
    color: '#1D4ED8',
  },

  // Cards & Layout
  wrap: { gap: 14 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 16,
    gap: 12,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 8,
    elevation: 2,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTitleCol: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 15.5,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.2,
  },
  cardSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  cardAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  cardActionText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1373E5',
  },

  // Team Grid (3 Columns)
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  cell: {
    width: '31.5%',
    borderRadius: 14,
    borderWidth: 1,
    padding: 11,
    gap: 4,
  },
  cellTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cellIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellNum: {
    fontSize: 21,
    fontWeight: '800',
    marginTop: 4,
  },
  cellLabel: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  cellLabelActive: {
    color: '#334155',
    fontWeight: '700',
  },

  // Person Rows (Leaves)
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  avatarCircle: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#1373E5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarCircleMuted: {
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  avatarText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  avatarTextMuted: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  personInfo: {
    flex: 1,
  },
  rowName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  rowSub: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 1,
  },
  leaveBadgeCol: {
    alignItems: 'flex-end',
    gap: 2,
  },
  leaveTypeBadge: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  leaveTypeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#B45309',
  },
  leaveDurationText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  dateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  dateChipText: {
    fontSize: 11.5,
    color: '#475569',
    fontWeight: '600',
  },

  // KPI Grid (Org Tab)
  kpiGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  kpiCard: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    padding: 10,
    gap: 4,
  },
  kpiIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  kpiNum: {
    fontSize: 20,
    fontWeight: '900',
    marginTop: 2,
  },
  kpiLabel: {
    fontSize: 10.5,
    fontWeight: '700',
  },

  // Progress Strip
  progressStripContainer: {
    gap: 6,
    marginTop: 4,
  },
  progressStrip: {
    flexDirection: 'row',
    height: 7,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: '#F1F5F9',
  },
  progressSegment: {
    height: '100%',
  },
  footText: {
    fontSize: 11.5,
    color: '#64748B',
    fontWeight: '600',
  },

  // Twin KPI Cards
  twinCardsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  twinCard: {
    flex: 1,
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    gap: 2,
  },
  twinTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  twinLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1D4ED8',
  },
  twinValue: {
    fontSize: 26,
    fontWeight: '900',
    marginTop: 4,
  },
  twinSub: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },

  // Department Distribution
  deptList: {
    gap: 10,
  },
  barItem: {
    gap: 5,
  },
  barHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  barLabel: {
    fontSize: 12.5,
    color: '#1E293B',
    fontWeight: '700',
  },
  barNum: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#0F172A',
  },
  barPct: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  barTrack: {
    height: 7,
    backgroundColor: '#F1F5F9',
    borderRadius: 4,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    backgroundColor: '#1373E5',
    borderRadius: 4,
  },

  // Trend Columns
  cols: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: 120,
    paddingTop: 10,
  },
  col: {
    flex: 1,
    alignItems: 'center',
    gap: 5,
  },
  colNum: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
  },
  colNumCurrent: {
    color: '#1373E5',
    fontWeight: '800',
  },
  colBar: {
    width: 22,
    backgroundColor: '#BFDBFE',
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
  },
  colBarCurrent: {
    backgroundColor: '#1373E5',
  },
  colLabel: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  colLabelCurrent: {
    color: '#1373E5',
    fontWeight: '800',
  },

  // Events (Holidays / Birthdays)
  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  eventIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eventInfo: {
    flex: 1,
  },
  eventName: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#0F172A',
  },
  eventDate: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 1,
  },
  todayPill: {
    backgroundColor: '#FDF2F8',
    borderWidth: 1,
    borderColor: '#FBCFE8',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  todayPillText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#DB2777',
  },

  // Empty state fallback
  emptyStateBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  emptyText: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '500',
  },
  empty: {
    fontSize: 13,
    color: '#94A3B8',
  },
});
