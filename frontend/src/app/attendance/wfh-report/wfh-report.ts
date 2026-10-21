import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HotToastService } from '@ngneat/hot-toast';
import { WfhService } from '../../services/wfh.service';
import { MasterDataService } from '../../services/master-data.service';
import { ProfileModalService } from '../../shared/profile-modal/profile-modal.service';

/**
 * WFH report for HR (21 Oct 2026): everyone's WFH in a month — approved,
 * pending, rejected and assigned per person, with every day — by department.
 * HR can cancel a day (e.g. assigned by mistake).
 */
@Component({
  selector: 'app-wfh-report',
  standalone: true,
  imports: [CommonModule],
  template: `
  <div class="wr">
    <div class="wr-head">
      <div><h1>WFH report</h1><p>Work From Home days per person, by month.</p></div>
      <div class="wr-tools">
        <button type="button" (click)="move(-1)">‹</button>
        <span class="wr-month">{{ monthLabel() }}</span>
        <button type="button" (click)="move(1)">›</button>
        <select [value]="dept()" (change)="dept.set($any($event.target).value); load()">
          <option value="">All departments</option>
          <option *ngFor="let d of departments()" [value]="d.id">{{ d.name }}</option>
        </select>
      </div>
    </div>

    <div class="wr-stats" *ngIf="data() as d">
      <div><b>{{ d.totals.approved }}</b><span>Approved days</span></div>
      <div class="pend"><b>{{ d.totals.pending }}</b><span>Pending</span></div>
      <div class="rej"><b>{{ d.totals.rejected }}</b><span>Rejected</span></div>
      <div class="asg"><b>{{ d.totals.assigned }}</b><span>Assigned by HR</span></div>
      <div><b>{{ d.totals.people }}</b><span>People · limit {{ d.limit }}/month</span></div>
    </div>

    <div class="wr-loading" *ngIf="loading()">Loading…</div>
    <div class="wr-empty" *ngIf="!loading() && data()?.people?.length === 0">No WFH this month.</div>

    <div class="wr-list" *ngIf="!loading() && data()?.people?.length">
      <div class="wr-row" *ngFor="let p of data().people">
        <button type="button" class="wr-person" (click)="profile.open(p.employee.id)">
          <span class="wr-av"><img *ngIf="p.employee.avatarUrl" [src]="p.employee.avatarUrl" alt=""><span *ngIf="!p.employee.avatarUrl">{{ (p.employee.firstName || '?').charAt(0) }}</span></span>
          <span class="wr-pt"><b>{{ p.employee.firstName }} {{ p.employee.lastName }}</b><small>{{ p.employee.designation?.name || '—' }}<ng-container *ngIf="p.employee.department?.name"> · {{ p.employee.department.name }}</ng-container></small></span>
        </button>
        <div class="wr-counts">
          <span class="c ok">{{ p.approved }} approved</span>
          <span class="c pend" *ngIf="p.pending">{{ p.pending }} pending</span>
          <span class="c rej" *ngIf="p.rejected">{{ p.rejected }} rejected</span>
          <span class="c asg" *ngIf="p.assigned">{{ p.assigned }} assigned</span>
        </div>
        <div class="wr-days">
          <span class="wr-day s-{{ d.status }}" *ngFor="let d of p.days" [title]="d.reason + (d.reviewNote ? ' — ' + d.reviewNote : '')">
            {{ d.date | date:'d MMM':'UTC' }}<em *ngIf="d.source === 'ASSIGNED'"> HR</em>
            <button type="button" *ngIf="d.status !== 'REJECTED'" (click)="cancel(d)" title="Cancel this WFH day">×</button>
          </span>
        </div>
      </div>
    </div>
  </div>`,
  styles: [`
    .wr { padding: 24px; max-width: 1200px; margin: 0 auto; }
    .wr-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
    .wr-head h1 { margin: 0; font-size: 24px; font-weight: 800; color: #0f172a; }
    .wr-head p { margin: 4px 0 0; color: #64748b; font-size: 14px; }
    .wr-tools { display: flex; align-items: center; gap: 8px; }
    .wr-tools button { width: 34px; height: 34px; border: 1px solid #e2e8f0; border-radius: 9px; background: #fff; font-weight: 800; cursor: pointer; }
    .wr-month { min-width: 130px; text-align: center; font-weight: 800; color: #0f172a; }
    .wr-tools select { height: 34px; border: 1px solid #e2e8f0; border-radius: 9px; padding: 0 10px; background: #fff; }
    .wr-stats { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; margin-bottom: 14px; }
    .wr-stats div { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 12px 14px; display: flex; flex-direction: column; }
    .wr-stats b { font-size: 24px; color: #047857; }
    .wr-stats .pend b { color: #b45309; } .wr-stats .rej b { color: #b91c1c; } .wr-stats .asg b { color: #1d4ed8; }
    .wr-stats span { font-size: 12px; font-weight: 700; color: #64748b; }
    .wr-loading, .wr-empty { padding: 32px; text-align: center; color: #94a3b8; background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; }
    .wr-list { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; }
    .wr-row { display: grid; grid-template-columns: minmax(200px, 1.2fr) auto 2fr; gap: 14px; align-items: center; padding: 12px 16px; border-bottom: 1px solid #f1f5f9; }
    .wr-row:last-child { border-bottom: 0; }
    .wr-person { display: flex; align-items: center; gap: 10px; border: 0; background: none; padding: 0; cursor: pointer; text-align: left; min-width: 0; }
    .wr-av { width: 36px; height: 36px; flex: 0 0 36px; border-radius: 50%; background: #e0e7ff; color: #3730a3; display: grid; place-items: center; font-weight: 800; overflow: hidden; }
    .wr-av img { width: 100%; height: 100%; object-fit: cover; }
    .wr-pt { display: flex; flex-direction: column; min-width: 0; }
    .wr-pt b { font-size: 13.5px; color: #0f172a; } .wr-pt small { font-size: 12px; color: #64748b; }
    .wr-counts { display: flex; gap: 6px; flex-wrap: wrap; }
    .c { font-size: 11.5px; font-weight: 800; padding: 3px 9px; border-radius: 999px; white-space: nowrap; }
    .c.ok { background: #ecfdf5; color: #047857; } .c.pend { background: #fffbeb; color: #b45309; } .c.rej { background: #fef2f2; color: #b91c1c; } .c.asg { background: #eff6ff; color: #1d4ed8; }
    .wr-days { display: flex; gap: 6px; flex-wrap: wrap; }
    .wr-day { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 700; padding: 3px 4px 3px 9px; border-radius: 8px; background: #ecfdf5; color: #047857; }
    .wr-day.s-PENDING_MANAGER, .wr-day.s-PENDING_HR { background: #fffbeb; color: #b45309; }
    .wr-day.s-REJECTED { background: #fef2f2; color: #b91c1c; padding-right: 9px; }
    .wr-day em { font-style: normal; font-size: 10px; color: #1d4ed8; }
    .wr-day button { border: 0; background: rgba(255,255,255,.7); border-radius: 50%; width: 16px; height: 16px; line-height: 1; cursor: pointer; color: #64748b; }
    @media (max-width: 860px) { .wr-row { grid-template-columns: 1fr; } .wr-stats { grid-template-columns: repeat(2, 1fr); } }
  `],
})
export class WfhReportComponent implements OnInit {
  private api = inject(WfhService);
  private master = inject(MasterDataService);
  private toast = inject(HotToastService);
  profile = inject(ProfileModalService);

  private now = new Date(Date.now() + 330 * 60_000);
  month = signal(this.now.getUTCMonth() + 1);
  year = signal(this.now.getUTCFullYear());
  dept = signal('');
  departments = signal<any[]>([]);
  data = signal<any>(null);
  loading = signal(true);
  monthLabel = computed(() => new Date(Date.UTC(this.year(), this.month() - 1, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }));

  ngOnInit() {
    this.master.getDepartments(true).subscribe({ next: (d: any) => this.departments.set(d || []), error: () => {} });
    this.load();
  }

  load() {
    this.loading.set(true);
    this.api.report(this.month(), this.year(), this.dept() || undefined).subscribe({
      next: (d) => { this.data.set(d); this.loading.set(false); },
      error: (e) => { this.loading.set(false); this.toast.error(e.error?.message || 'Could not load the WFH report'); },
    });
  }

  move(step: number) {
    let m = this.month() + step, y = this.year();
    if (m < 1) { m = 12; y--; } else if (m > 12) { m = 1; y++; }
    this.month.set(m); this.year.set(y); this.load();
  }

  cancel(d: any) {
    if (!confirm('Cancel this WFH day? The person is notified.')) return;
    this.api.adminCancel(d.id).subscribe({
      next: () => { this.toast.success('Cancelled'); this.load(); },
      error: (e) => this.toast.error(e.error?.message || 'Could not cancel'),
    });
  }
}
