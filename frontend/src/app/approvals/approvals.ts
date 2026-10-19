import { Component, computed, HostListener, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HotToastService } from '@ngneat/hot-toast';
import { firstValueFrom } from 'rxjs';
import { LeavesService } from '../services/leaves';
import { AttendanceService } from '../services/attendance';
import { WfhService } from '../services/wfh.service';
import { ProfileModalService } from '../shared/profile-modal/profile-modal.service';
import { DialogService } from '../shared/services/dialog.service';

/**
 * One inbox for everything waiting on my decision (19 Oct 2026), as in the
 * app: leave, regularization, late clock-outs and out-of-office clocks. Each
 * queue is asked for separately and a tab only appears when the server lets
 * this person act on it (HR / admins the company, a manager their team).
 */
export type ApprovalKind = 'LEAVE' | 'WFH' | 'REG' | 'CLOCKOUT' | 'OUTSIDE';

export interface ApprovalRow {
  kind: ApprovalKind;
  id: number;
  employeeId: number | null;
  employeeCode: string | null;
  name: string;
  avatarUrl: string | null;
  designation: string | null;
  department: string | null;
  date: string;
  title: string;
  detail: string;
  reason: string | null;
  badge?: string | null;
  proofUrl?: string | null;
  raw: any;
}

@Component({
  selector: 'app-approvals',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './approvals.html',
  styleUrls: ['./approvals.css'],
})
export class ApprovalsComponent implements OnInit {
  private leaves = inject(LeavesService);
  private attendance = inject(AttendanceService);
  private wfh = inject(WfhService);
  private toast = inject(HotToastService);
  private dialog = inject(DialogService);
  profile = inject(ProfileModalService);

  readonly tabs: { kind: ApprovalKind; label: string; shortDesc: string; tone: string }[] = [
    { kind: 'LEAVE', label: 'Leave Requests', shortDesc: 'Time-off & half-day', tone: 'violet' },
    { kind: 'WFH', label: 'Work From Home', shortDesc: 'Remote work days', tone: 'emerald' },
    { kind: 'REG', label: 'Regularization', shortDesc: 'Attendance corrections', tone: 'blue' },
    { kind: 'CLOCKOUT', label: 'Late Clock-out', shortDesc: 'Closed on later day', tone: 'amber' },
    { kind: 'OUTSIDE', label: 'Out of Office', shortDesc: 'Outside geofence radius', tone: 'rose' },
  ];

  loading = signal(true);
  available = signal<Set<ApprovalKind>>(new Set());
  rows = signal<ApprovalRow[]>([]);
  tab = signal<ApprovalKind | 'ALL'>('ALL');
  query = signal('');
  departmentFilter = signal('');
  fromDate = signal('');
  toDate = signal('');
  quickRange = signal<'ALL' | 'TODAY' | '7' | '30' | 'MONTH' | 'CUSTOM'>('ALL');
  sortOrder = signal<'NEWEST' | 'OLDEST'>('NEWEST');

  page = signal(1);
  pageSize = signal(25);

  busy = signal<string | null>(null);
  selected = signal<Set<string>>(new Set());

  rejecting = signal<ApprovalRow | null>(null);
  bulkRejecting = signal(false);
  rejectNote = '';

  @HostListener('document:keydown.escape')
  onEscape() {
    if (this.rejecting() || this.bulkRejecting()) {
      this.closeRejectModal();
    }
  }

  departments = computed(() => {
    const set = new Set<string>();
    for (const r of this.rows()) {
      if (r.department) set.add(r.department);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  });

  counts = computed(() => {
    const c: Record<string, number> = { ALL: this.rows().length };
    for (const r of this.rows()) c[r.kind] = (c[r.kind] ?? 0) + 1;
    return c;
  });

  urgentTotalCount = computed(() => this.rows().filter((r) => this.waitingDays(r) >= 7).length);

  private matchesFiltersExceptTab(r: ApprovalRow): boolean {
    const q = this.query().trim().toLowerCase();
    const dept = this.departmentFilter();
    const from = this.fromDate();
    const to = this.toDate();

    if (dept && r.department !== dept) return false;

    if (from || to) {
      const startDay = r.date;
      const endDay = r.kind === 'LEAVE' && r.raw?.endDate ? this.day(r.raw.endDate) : r.date;
      if (from && endDay < from) return false;
      if (to && startDay > to) return false;
    }

    if (q) {
      const hay = `${r.name} ${r.employeeCode ?? ''} ${r.designation ?? ''} ${r.department ?? ''} ${r.title} ${r.detail} ${r.reason ?? ''} ${r.badge ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }

    return true;
  }

  /** Number of matches across all tabs when a search/filter is active (helpful if current tab has 0). */
  allTabsMatchCount = computed(() => {
    return this.rows().filter((r) => this.matchesFiltersExceptTab(r)).length;
  });

  shown = computed(() => {
    const t = this.tab();
    const order = this.sortOrder();
    return this.rows()
      .filter((r) => t === 'ALL' || r.kind === t)
      .filter((r) => this.matchesFiltersExceptTab(r))
      .sort((a, b) => (order === 'NEWEST' ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)));
  });

  pageCount = computed(() => Math.max(1, Math.ceil(this.shown().length / this.pageSize())));

  pageRows = computed(() => {
    const size = this.pageSize();
    const p = Math.min(this.page(), this.pageCount());
    return this.shown().slice((p - 1) * size, p * size);
  });

  rangeLabel = computed(() => {
    const total = this.shown().length;
    if (!total) return '0 of 0';
    const size = this.pageSize();
    const p = Math.min(this.page(), this.pageCount());
    const start = (p - 1) * size + 1;
    return `${start}–${Math.min(total, p * size)} of ${total}`;
  });

  hasActiveFilters = computed(() => {
    return !!(
      this.query().trim() ||
      this.departmentFilter() ||
      this.fromDate() ||
      this.toDate() ||
      this.quickRange() !== 'ALL' ||
      this.tab() !== 'ALL'
    );
  });

  ngOnInit() {
    this.load();
  }

  private ymd(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  key(r: ApprovalRow) {
    return `${r.kind}-${r.id}`;
  }

  kindLabel(k: ApprovalKind) {
    return this.tabs.find((t) => t.kind === k)?.label ?? k;
  }

  initials(n: string) {
    return (n || '?')
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase();
  }

  getAvatarColor(name: string): string {
    if (!name) return '#6366f1';
    const colors = ['#6366f1', '#8b5cf6', '#ec4899', '#f97316', '#10b981', '#06b6d4', '#3b82f6'];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  }

  waitingDays(r: ApprovalRow): number {
    const d = new Date(r.date);
    if (isNaN(d.getTime())) return 0;
    return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
  }

  isStale(r: ApprovalRow): boolean {
    return this.waitingDays(r) >= 7;
  }

  formatDate(value: string): string {
    if (!value) return '—';
    const d = new Date(value + 'T00:00:00');
    if (isNaN(d.getTime())) return value;
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }

  setTab(next: ApprovalKind | 'ALL') {
    this.tab.set(next);
    this.page.set(1);
    this.selected.set(new Set());
  }

  onSearchChange(val: string) {
    this.query.set(val);
    this.page.set(1);
    this.selected.set(new Set());
  }

  onDeptChange(val: string) {
    this.departmentFilter.set(val || '');
    this.page.set(1);
    this.selected.set(new Set());
  }

  setQuickRange(r: 'ALL' | 'TODAY' | '7' | '30' | 'MONTH') {
    this.quickRange.set(r);
    const now = new Date();
    const todayStr = this.ymd(now);
    if (r === 'ALL') {
      this.fromDate.set('');
      this.toDate.set('');
    } else if (r === 'TODAY') {
      this.fromDate.set(todayStr);
      this.toDate.set(todayStr);
    } else if (r === '7' || r === '30') {
      const start = new Date();
      start.setDate(start.getDate() - (Number(r) - 1));
      this.fromDate.set(this.ymd(start));
      this.toDate.set(todayStr);
    } else if (r === 'MONTH') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      this.fromDate.set(this.ymd(start));
      this.toDate.set(todayStr);
    }
    this.page.set(1);
    this.selected.set(new Set());
  }

  onFromDateChange(val: string) {
    this.fromDate.set(val || '');
    this.quickRange.set(val || this.toDate() ? 'CUSTOM' : 'ALL');
    this.page.set(1);
    this.selected.set(new Set());
  }

  onToDateChange(val: string) {
    this.toDate.set(val || '');
    this.quickRange.set(this.fromDate() || val ? 'CUSTOM' : 'ALL');
    this.page.set(1);
    this.selected.set(new Set());
  }

  clearDateRange() {
    this.fromDate.set('');
    this.toDate.set('');
    this.quickRange.set('ALL');
    this.page.set(1);
    this.selected.set(new Set());
  }

  toggleSort() {
    this.sortOrder.update((curr) => (curr === 'NEWEST' ? 'OLDEST' : 'NEWEST'));
    this.page.set(1);
  }

  resetFilters() {
    this.query.set('');
    this.departmentFilter.set('');
    this.fromDate.set('');
    this.toDate.set('');
    this.quickRange.set('ALL');
    this.tab.set('ALL');
    this.page.set(1);
    this.selected.set(new Set());
  }

  goPage(p: number) {
    this.page.set(Math.min(Math.max(1, p), this.pageCount()));
    this.selected.set(new Set());
  }

  setPageSize(size: number) {
    this.pageSize.set(Number(size) || 25);
    this.page.set(1);
    this.selected.set(new Set());
  }

  private person(e: any) {
    const dept = e?.department?.name ?? (typeof e?.department === 'string' ? e.department : null);
    return {
      employeeId: e?.id ?? null,
      employeeCode: e?.employeeCode ? String(e.employeeCode) : null,
      name: `${e?.firstName ?? ''} ${e?.lastName ?? ''}`.trim() || 'Employee',
      avatarUrl: e?.avatarUrl ?? null,
      designation: e?.designation?.name ?? (typeof e?.designation === 'string' ? e.designation : null),
      department: dept || null,
    };
  }

  private time(v: any) {
    return v ? new Date(v).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '—';
  }

  private day(v: any) {
    return String(v ?? '').slice(0, 10);
  }

  async load() {
    this.loading.set(true);
    const settle = <T>(p: Promise<T>) =>
      p.then((v) => ({ ok: true as const, v })).catch(() => ({ ok: false as const, v: null as any }));
    const [lv, rg, coCan, ooCan] = await Promise.all([
      settle(firstValueFrom(this.leaves.getRequests()).catch(() => firstValueFrom(this.leaves.getManagerRequests()))),
      settle(firstValueFrom(this.attendance.getPendingRegularizations())),
      settle(firstValueFrom(this.attendance.canApproveClockOuts())),
      settle(firstValueFrom(this.attendance.canApproveGeofence())),
    ]);
    const wf = await settle(firstValueFrom(this.wfh.pending()));
    const [co, oo] = await Promise.all([
      coCan.ok && coCan.v?.canApprove
        ? settle(firstValueFrom(this.attendance.getPendingClockOuts()))
        : Promise.resolve({ ok: false as const, v: null }),
      ooCan.ok && ooCan.v?.canApprove
        ? settle(firstValueFrom(this.attendance.getPendingGeofence()))
        : Promise.resolve({ ok: false as const, v: null }),
    ]);

    const out: ApprovalRow[] = [];
    const avail = new Set<ApprovalKind>();
    if (lv.ok) {
      avail.add('LEAVE');
      for (const l of (lv.v ?? []).filter((x: any) => x.status === 'PENDING')) {
        const s = this.day(l.startDate),
          e = this.day(l.endDate);
        out.push({
          kind: 'LEAVE',
          id: l.id,
          ...this.person(l.employee),
          date: s,
          raw: l,
          title: l.leaveType?.name ?? 'Leave',
          detail:
            s === e
              ? `${this.formatDate(s)}${l.isHalfDay ? ' · Half day' + (l.halfDayPeriod ? ' (' + l.halfDayPeriod + ')' : '') : ' · Full day'}`
              : `${this.formatDate(s)} → ${this.formatDate(e)}`,
          reason: l.reason ?? null,
          badge: l.isHalfDay ? 'Half Day' : null,
          proofUrl: (l as any).attachmentUrl ?? (l as any).documentUrl ?? null,
        });
      }
    }
    if (wf.ok && (wf.v ?? []).length >= 0) {
      const can = await settle(firstValueFrom(this.wfh.canApprove()));
      if (can.ok && can.v?.canApprove) avail.add('WFH');
      for (const w of wf.v ?? []) {
        out.push({
          kind: 'WFH',
          id: w.id,
          ...this.person(w.employee),
          date: this.day(w.date),
          raw: w,
          title: 'Work From Home',
          detail: w.status === 'PENDING_HR' ? 'Manager approved · Awaiting HR confirmation' : 'Awaiting Reporting Manager approval',
          reason: w.reason ?? null,
          badge: w.status === 'PENDING_HR' ? 'Step 2: HR' : 'Step 1: Manager',
        });
      }
    }
    if (rg.ok) {
      avail.add('REG');
      for (const r of (rg.v ?? []).filter((x: any) => !x.status || x.status === 'PENDING')) {
        out.push({
          kind: 'REG',
          id: r.id,
          ...this.person(r.employee),
          date: this.day(r.date),
          raw: r,
          title: 'Regularization',
          detail: `In ${this.time(r.proposedClockIn)} → Out ${this.time(r.proposedClockOut)}`,
          reason: r.reason ?? null,
        });
      }
    }
    if (co.ok) {
      avail.add('CLOCKOUT');
      for (const a of co.v ?? []) {
        const where =
          a.workType === 'FIELD_VISIT'
            ? `Field visit${a.fieldVisit?.location ? ' · ' + a.fieldVisit.location : ''}`
            : a.workType === 'ON_SITE'
            ? 'On site'
            : a.workType === 'OUTSIDE'
            ? 'Outside office'
            : 'Office';
        out.push({
          kind: 'CLOCKOUT',
          id: a.id,
          ...this.person(a.employee),
          date: this.day(a.date),
          raw: a,
          title: 'Late Clock-out',
          detail: `In ${this.time(a.clockIn)} → Out ${this.time(a.clockOut)}`,
          reason: a.clockOutReason ?? null,
          badge: where !== 'Office' ? where : null,
          proofUrl: a.clockOutProofUrl ?? null,
        });
      }
    }
    if (oo.ok) {
      avail.add('OUTSIDE');
      for (const a of oo.v ?? []) {
        const parts = [
          a.clockInOutside ? `In ${a.clockInDistanceKm == null ? 'no GPS' : Number(a.clockInDistanceKm).toFixed(2) + ' km'}` : '',
          a.clockOutOutside ? `Out ${a.clockOutDistanceKm == null ? 'no GPS' : Number(a.clockOutDistanceKm).toFixed(2) + ' km'}` : '',
        ].filter(Boolean);
        out.push({
          kind: 'OUTSIDE',
          id: a.id,
          ...this.person(a.employee),
          date: this.day(a.date),
          raw: a,
          title: 'Out of Office',
          detail: `${parts.join(' · ')} from office`,
          reason: [a.clockInOutsideReason, a.clockOutOutsideReason].filter(Boolean).join(' / ') || null,
          badge: a.approvedWfh ? 'Approved WFH' : a.profileWfh ? 'WFH (Profile)' : null,
          proofUrl: a.clockInOutsideProofUrl || a.clockOutOutsideProofUrl || null,
        });
      }
    }
    this.available.set(avail);
    this.rows.set(out);
    this.selected.set(new Set());
    this.loading.set(false);
  }

  private decide(r: ApprovalRow, approve: boolean, note?: string) {
    switch (r.kind) {
      case 'LEAVE':
        return firstValueFrom(this.leaves.updateRequestStatus(r.id, approve ? 'APPROVED' : 'REJECTED', note));
      case 'WFH':
        return firstValueFrom(this.wfh.review(r.id, approve ? 'APPROVE' : 'REJECT', note));
      case 'REG':
        return firstValueFrom(this.attendance.resolveRegularization(r.id, approve ? 'APPROVED' : 'REJECTED', note));
      case 'CLOCKOUT':
        return firstValueFrom(this.attendance.reviewClockOut(r.id, approve ? 'APPROVE' : 'REJECT', note));
      case 'OUTSIDE':
        return firstValueFrom(this.attendance.reviewGeofence(r.id, approve ? 'APPROVE' : 'REJECT', note));
    }
  }

  async approve(r: ApprovalRow) {
    this.busy.set(this.key(r));
    try {
      await this.decide(r, true);
      this.rows.update((l) => l.filter((x) => this.key(x) !== this.key(r)));
      const nextSel = new Set(this.selected());
      if (nextSel.delete(this.key(r))) this.selected.set(nextSel);
      this.toast.success(`${r.title} approved for ${r.name}`);
    } catch (e: any) {
      this.toast.error(e?.error?.message || 'Could not approve');
    } finally {
      this.busy.set(null);
    }
  }

  openReject(r: ApprovalRow) {
    this.rejectNote = '';
    this.bulkRejecting.set(false);
    this.rejecting.set(r);
  }

  openBulkReject() {
    if (!this.selected().size) return;
    this.rejectNote = '';
    this.rejecting.set(null);
    this.bulkRejecting.set(true);
  }

  closeRejectModal() {
    this.rejecting.set(null);
    this.bulkRejecting.set(false);
    this.rejectNote = '';
  }

  applyQuickRejectNote(text: string) {
    this.rejectNote = text;
  }

  async confirmReject() {
    if (!this.rejectNote.trim()) {
      this.toast.error('Please provide a reason for rejection');
      return;
    }

    if (this.bulkRejecting()) {
      const list = this.shown().filter((r) => this.selected().has(this.key(r)));
      if (!list.length) {
        this.closeRejectModal();
        return;
      }
      this.busy.set('bulk');
      let ok = 0;
      const note = this.rejectNote.trim();
      for (const r of list) {
        try {
          await this.decide(r, false, note);
          ok++;
          this.rows.update((l) => l.filter((x) => this.key(x) !== this.key(r)));
        } catch {
          /* keep failed in list */
        }
      }
      this.busy.set(null);
      this.selected.set(new Set());
      this.closeRejectModal();
      this.toast.success(`Rejected ${ok} of ${list.length} requests`);
      return;
    }

    const r = this.rejecting();
    if (!r) return;
    this.busy.set(this.key(r));
    try {
      await this.decide(r, false, this.rejectNote.trim());
      this.rows.update((l) => l.filter((x) => this.key(x) !== this.key(r)));
      const nextSel = new Set(this.selected());
      if (nextSel.delete(this.key(r))) this.selected.set(nextSel);
      this.closeRejectModal();
      this.toast.success(`${r.title} rejected`);
    } catch (e: any) {
      this.toast.error(e?.error?.message || 'Could not reject');
    } finally {
      this.busy.set(null);
    }
  }

  toggle(r: ApprovalRow) {
    const s = new Set(this.selected());
    s.has(this.key(r)) ? s.delete(this.key(r)) : s.add(this.key(r));
    this.selected.set(s);
  }

  togglePageSelection() {
    const keys = this.pageRows().map((r) => this.key(r));
    const all = keys.length > 0 && keys.every((k) => this.selected().has(k));
    this.selected.set(all ? new Set() : new Set(keys));
  }

  allOnPageSelected() {
    const keys = this.pageRows().map((r) => this.key(r));
    return keys.length > 0 && keys.every((k) => this.selected().has(k));
  }

  clearSelection() {
    this.selected.set(new Set());
  }

  async approveSelected() {
    const list = this.shown().filter((r) => this.selected().has(this.key(r)));
    if (!list.length) return;
    const confirmed = await this.dialog.confirm(
      `Approve ${list.length} selected request${list.length === 1 ? '' : 's'}? They will be processed immediately.`,
      'Approve Selected Requests',
      `Approve ${list.length}`,
      'Cancel',
      'success'
    );
    if (!confirmed) return;

    this.busy.set('bulk');
    let ok = 0;
    for (const r of list) {
      try {
        await this.decide(r, true);
        ok++;
        this.rows.update((l) => l.filter((x) => this.key(x) !== this.key(r)));
      } catch {
        /* keep in list */
      }
    }
    this.busy.set(null);
    this.selected.set(new Set());
    this.toast.success(`${ok} of ${list.length} approved`);
  }
}
