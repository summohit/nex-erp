import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HotToastService } from '@ngneat/hot-toast';
import { firstValueFrom } from 'rxjs';
import { LeavesService } from '../services/leaves';
import { AttendanceService } from '../services/attendance';
import { WfhService } from '../services/wfh.service';
import { ProfileModalService } from '../shared/profile-modal/profile-modal.service';

/**
 * One inbox for everything waiting on my decision (19 Oct 2026), as in the
 * app: leave, regularization, late clock-outs and out-of-office clocks. Each
 * queue is asked for separately and a tab only appears when the server lets
 * this person act on it (HR / admins the company, a manager their team).
 */
type Kind = 'LEAVE' | 'WFH' | 'REG' | 'CLOCKOUT' | 'OUTSIDE';
type Row = {
  kind: Kind; id: number; employeeId: number | null; name: string; avatarUrl: string | null;
  designation: string | null; date: string; title: string; detail: string; reason: string | null;
  badge?: string | null; raw: any;
};

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
  profile = inject(ProfileModalService);

  readonly tabs: { kind: Kind; label: string }[] = [
    { kind: 'LEAVE', label: 'Leave' },
    { kind: 'WFH', label: 'WFH' },
    { kind: 'REG', label: 'Regularization' },
    { kind: 'CLOCKOUT', label: 'Late clock-out' },
    { kind: 'OUTSIDE', label: 'Out of office' },
  ];

  loading = signal(true);
  available = signal<Set<Kind>>(new Set());
  rows = signal<Row[]>([]);
  tab = signal<Kind | 'ALL'>('ALL');
  query = signal('');
  busy = signal<string | null>(null);
  selected = signal<Set<string>>(new Set());
  rejecting = signal<Row | null>(null);
  rejectNote = '';

  counts = computed(() => {
    const c: Record<string, number> = { ALL: this.rows().length };
    for (const r of this.rows()) c[r.kind] = (c[r.kind] ?? 0) + 1;
    return c;
  });

  shown = computed(() => {
    const t = this.tab();
    const q = this.query().trim().toLowerCase();
    return this.rows()
      .filter((r) => t === 'ALL' || r.kind === t)
      .filter((r) => !q || `${r.name} ${r.designation ?? ''} ${r.title} ${r.reason ?? ''}`.toLowerCase().includes(q))
      .sort((a, b) => b.date.localeCompare(a.date));
  });

  ngOnInit() { this.load(); }

  key(r: Row) { return `${r.kind}-${r.id}`; }
  kindLabel(k: Kind) { return this.tabs.find((t) => t.kind === k)?.label ?? k; }
  initials(n: string) { return (n || '?').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase(); }

  private person(e: any) {
    return {
      employeeId: e?.id ?? null,
      name: `${e?.firstName ?? ''} ${e?.lastName ?? ''}`.trim() || 'Employee',
      avatarUrl: e?.avatarUrl ?? null,
      designation: e?.designation?.name ?? (typeof e?.designation === 'string' ? e.designation : null),
    };
  }
  private time(v: any) {
    return v ? new Date(v).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '—';
  }
  private day(v: any) { return String(v ?? '').slice(0, 10); }

  async load() {
    this.loading.set(true);
    const settle = <T>(p: Promise<T>) => p.then((v) => ({ ok: true as const, v })).catch(() => ({ ok: false as const, v: null as any }));
    const [lv, rg, coCan, ooCan] = await Promise.all([
      // HR and admins: every pending leave in the company; else my team's.
      settle(firstValueFrom(this.leaves.getRequests()).catch(() => firstValueFrom(this.leaves.getManagerRequests()))),
      settle(firstValueFrom(this.attendance.getPendingRegularizations())),
      settle(firstValueFrom(this.attendance.canApproveClockOuts())),
      settle(firstValueFrom(this.attendance.canApproveGeofence())),
    ]);
    const wf = await settle(firstValueFrom(this.wfh.pending()));
    const [co, oo] = await Promise.all([
      coCan.ok && coCan.v?.canApprove ? settle(firstValueFrom(this.attendance.getPendingClockOuts())) : Promise.resolve({ ok: false as const, v: null }),
      ooCan.ok && ooCan.v?.canApprove ? settle(firstValueFrom(this.attendance.getPendingGeofence())) : Promise.resolve({ ok: false as const, v: null }),
    ]);

    const out: Row[] = [];
    const avail = new Set<Kind>();
    if (lv.ok) {
      avail.add('LEAVE');
      for (const l of (lv.v ?? []).filter((x: any) => x.status === 'PENDING')) {
        const s = this.day(l.startDate), e = this.day(l.endDate);
        out.push({
          kind: 'LEAVE', id: l.id, ...this.person(l.employee), date: s, raw: l,
          title: l.leaveType?.name ?? 'Leave',
          detail: s === e ? `${s}${l.isHalfDay ? ' · half day' + (l.halfDayPeriod ? ' (' + l.halfDayPeriod + ')' : '') : ''}` : `${s} → ${e}`,
          reason: l.reason ?? null,
        });
      }
    }
    if (wf.ok && (wf.v ?? []).length >= 0) {
      const can = await settle(firstValueFrom(this.wfh.canApprove()));
      if (can.ok && can.v?.canApprove) avail.add('WFH');
      for (const w of wf.v ?? []) {
        out.push({
          kind: 'WFH', id: w.id, ...this.person(w.employee), date: this.day(w.date), raw: w,
          title: 'Work From Home', detail: `${this.day(w.date)} · ${w.status === 'PENDING_HR' ? 'manager approved, needs HR' : 'needs the reporting manager'}`,
          reason: w.reason ?? null,
        });
      }
    }
    if (rg.ok) {
      avail.add('REG');
      for (const r of (rg.v ?? []).filter((x: any) => !x.status || x.status === 'PENDING')) {
        out.push({
          kind: 'REG', id: r.id, ...this.person(r.employee), date: this.day(r.date), raw: r,
          title: 'Regularization', detail: `${this.day(r.date)} · In ${this.time(r.proposedClockIn)} · Out ${this.time(r.proposedClockOut)}`,
          reason: r.reason ?? null,
        });
      }
    }
    if (co.ok) {
      avail.add('CLOCKOUT');
      for (const a of co.v ?? []) {
        const where = a.workType === 'FIELD_VISIT' ? `Field visit${a.fieldVisit?.location ? ' · ' + a.fieldVisit.location : ''}`
          : a.workType === 'ON_SITE' ? 'On site' : a.workType === 'OUTSIDE' ? 'Outside office' : 'Office';
        out.push({
          kind: 'CLOCKOUT', id: a.id, ...this.person(a.employee), date: this.day(a.date), raw: a,
          title: 'Late clock-out', detail: `${this.day(a.date)} · In ${this.time(a.clockIn)} · Out ${this.time(a.clockOut)}`,
          reason: a.clockOutReason ?? null, badge: where,
        });
      }
    }
    if (oo.ok) {
      avail.add('OUTSIDE');
      for (const a of oo.v ?? []) {
        const parts = [
          a.clockInOutside ? `In ${a.clockInDistanceKm == null ? 'no GPS' : a.clockInDistanceKm + ' km'}` : '',
          a.clockOutOutside ? `Out ${a.clockOutDistanceKm == null ? 'no GPS' : a.clockOutDistanceKm + ' km'}` : '',
        ].filter(Boolean);
        out.push({
          kind: 'OUTSIDE', id: a.id, ...this.person(a.employee), date: this.day(a.date), raw: a,
          title: 'Out of office', detail: `${this.day(a.date)} · ${parts.join(' · ')} from office`,
          reason: [a.clockInOutsideReason, a.clockOutOutsideReason].filter(Boolean).join(' / ') || null,
          badge: a.approvedWfh ? 'Approved WFH' : a.profileWfh ? 'WFH (profile)' : null,
        });
      }
    }
    this.available.set(avail);
    this.rows.set(out);
    this.selected.set(new Set());
    this.loading.set(false);
  }

  private decide(r: Row, approve: boolean, note?: string) {
    switch (r.kind) {
      case 'LEAVE': return firstValueFrom(this.leaves.updateRequestStatus(r.id, approve ? 'APPROVED' : 'REJECTED', note));
      case 'WFH': return firstValueFrom(this.wfh.review(r.id, approve ? 'APPROVE' : 'REJECT', note));
      case 'REG': return firstValueFrom(this.attendance.resolveRegularization(r.id, approve ? 'APPROVED' : 'REJECTED', note));
      case 'CLOCKOUT': return firstValueFrom(this.attendance.reviewClockOut(r.id, approve ? 'APPROVE' : 'REJECT', note));
      case 'OUTSIDE': return firstValueFrom(this.attendance.reviewGeofence(r.id, approve ? 'APPROVE' : 'REJECT', note));
    }
  }

  async approve(r: Row) {
    this.busy.set(this.key(r));
    try {
      await this.decide(r, true);
      this.rows.update((l) => l.filter((x) => this.key(x) !== this.key(r)));
      this.toast.success(`${r.title} approved for ${r.name}`);
    } catch (e: any) {
      this.toast.error(e?.error?.message || 'Could not approve');
    } finally { this.busy.set(null); }
  }

  openReject(r: Row) { this.rejectNote = ''; this.rejecting.set(r); }

  async confirmReject() {
    const r = this.rejecting();
    if (!r) return;
    if (!this.rejectNote.trim()) { this.toast.error('Write why'); return; }
    this.busy.set(this.key(r));
    try {
      await this.decide(r, false, this.rejectNote.trim());
      this.rows.update((l) => l.filter((x) => this.key(x) !== this.key(r)));
      this.rejecting.set(null);
      this.toast.success(`${r.title} rejected`);
    } catch (e: any) {
      this.toast.error(e?.error?.message || 'Could not reject');
    } finally { this.busy.set(null); }
  }

  toggle(r: Row) {
    const s = new Set(this.selected());
    s.has(this.key(r)) ? s.delete(this.key(r)) : s.add(this.key(r));
    this.selected.set(s);
  }
  toggleAll() {
    const keys = this.shown().map((r) => this.key(r));
    const all = keys.length > 0 && keys.every((k) => this.selected().has(k));
    this.selected.set(all ? new Set() : new Set(keys));
  }
  allSelected() {
    const keys = this.shown().map((r) => this.key(r));
    return keys.length > 0 && keys.every((k) => this.selected().has(k));
  }

  async approveSelected() {
    const list = this.shown().filter((r) => this.selected().has(this.key(r)));
    if (!list.length) return;
    if (!confirm(`Approve ${list.length} item${list.length === 1 ? '' : 's'}?`)) return;
    this.busy.set('bulk');
    let ok = 0;
    for (const r of list) {
      try { await this.decide(r, true); ok++; this.rows.update((l) => l.filter((x) => this.key(x) !== this.key(r))); } catch { /* keep in list */ }
    }
    this.busy.set(null);
    this.selected.set(new Set());
    this.toast.success(`${ok} of ${list.length} approved`);
  }
}
