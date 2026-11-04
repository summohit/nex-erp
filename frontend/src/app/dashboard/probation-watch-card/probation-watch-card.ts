import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { HotToastService } from '@ngneat/hot-toast';
import { LifecycleService, LcOverview, LcProbation } from '../../services/lifecycle.service';

/**
 * Probations needing action (4 Nov 2026), at the top of My Workspace for HR,
 * Super Admin and reporting managers: overdue, ending within 30 days, and
 * reviewed-and-waiting. Managers review from here; HR and Super Admin can
 * confirm a reviewed one in one click (Super Admin also without a review).
 * Hidden when nothing needs doing.
 */
@Component({
  selector: 'app-probation-watch-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="pwc" *ngIf="visible()">
      <header class="pwc-head">
        <div class="pwc-title">
          <span class="pwc-icon">⏳</span>
          <div>
            <h3>Probation — action needed</h3>
            <p>{{ d()!.canManageProbation ? 'Decide reviewed probations, chase overdue reviews.' : 'Review your team members before their probation ends.' }}</p>
          </div>
        </div>
        <button type="button" class="pwc-link" (click)="openAll()">Open probation →</button>
      </header>

      <div class="pwc-stats">
        <button type="button" class="pwc-stat red" [class.on]="filter() === 'overdue'" (click)="filter.set('overdue')">
          <b>{{ overdue().length }}</b><span>Overdue</span>
        </button>
        <button type="button" class="pwc-stat amber" [class.on]="filter() === 'soon'" (click)="filter.set('soon')">
          <b>{{ soon().length }}</b><span>Ending in 30 days</span>
        </button>
        <button type="button" class="pwc-stat green" [class.on]="filter() === 'reviewed'" (click)="filter.set('reviewed')">
          <b>{{ reviewed().length }}</b><span>Reviewed · awaiting decision</span>
        </button>
        <button type="button" class="pwc-stat slate" [class.on]="filter() === 'pending'" (click)="filter.set('pending')">
          <b>{{ pendingReview().length }}</b><span>Review pending</span>
        </button>
      </div>

      <div class="pwc-list">
        <div class="pwc-row" *ngFor="let r of rows().slice(0, 5)">
          <img *ngIf="r.avatarUrl" class="pwc-av" [src]="r.avatarUrl" alt="">
          <span *ngIf="!r.avatarUrl" class="pwc-av pwc-av-i">{{ initials(r.name) }}</span>
          <div class="pwc-person">
            <b>{{ r.name }}</b>
            <small>{{ r.designation || 'Staff' }} · ends {{ r.endDate | date:'d MMM y':'UTC' }}</small>
          </div>
          <span class="pwc-due" [class.red]="(r.daysLeft ?? 0) < 0" [class.amber]="(r.daysLeft ?? 0) >= 0 && (r.daysLeft ?? 0) <= 30">
            {{ (r.daysLeft ?? 0) < 0 ? (-(r.daysLeft ?? 0)) + 'd overdue' : r.daysLeft + 'd left' }}
          </span>
          <span class="pwc-rev" *ngIf="r.review as rv" [attr.data-rec]="rv.recommendation">{{ recLabel(rv) }}</span>
          <span class="pwc-rev pending" *ngIf="!r.review">Review pending</span>
          <div class="pwc-actions">
            <button type="button" class="pwc-btn" *ngIf="r.canReview && !r.review" (click)="openAll()">Review</button>
            <button type="button" class="pwc-btn ok" *ngIf="d()!.canManageProbation && (r.review?.recommendation === 'CONFIRM' || (!r.review && d()!.canOverrideReview))"
                    [disabled]="busy()" (click)="confirm(r)">Confirm</button>
            <button type="button" class="pwc-btn" (click)="openAll()">Open</button>
          </div>
        </div>
        <div class="pwc-empty" *ngIf="!rows().length">Nothing in this list.</div>
        <button type="button" class="pwc-more" *ngIf="rows().length > 5" (click)="openAll()">+ {{ rows().length - 5 }} more</button>
      </div>
    </section>
  `,
  styles: [`
    .pwc { margin-top: 16px; background: #fff; border: 1px solid #e2e8f0; border-radius: 18px; padding: 18px 20px; box-shadow: 0 4px 18px rgba(15,23,42,.05); }
    .pwc-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
    .pwc-title { display: flex; gap: 12px; align-items: center; }
    .pwc-icon { width: 42px; height: 42px; border-radius: 12px; background: #eff6ff; display: grid; place-items: center; font-size: 20px; }
    .pwc-title h3 { margin: 0; font-size: 16.5px; color: #0f172a; }
    .pwc-title p { margin: 2px 0 0; font-size: 12.5px; color: #64748b; }
    .pwc-link { border: 0; background: none; color: #2563eb; font-weight: 700; font-size: 13px; cursor: pointer; }
    .pwc-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 14px 0 12px; }
    .pwc-stat { text-align: left; border: 1.5px solid #e2e8f0; border-radius: 14px; padding: 10px 12px; background: #fff; cursor: pointer; display: flex; flex-direction: column; gap: 2px; transition: border-color .12s, background .12s; }
    .pwc-stat b { font-size: 22px; line-height: 1.1; }
    .pwc-stat span { font-size: 11.5px; color: #64748b; font-weight: 600; }
    .pwc-stat.red b { color: #dc2626; } .pwc-stat.amber b { color: #d97706; } .pwc-stat.green b { color: #059669; } .pwc-stat.slate b { color: #475569; }
    .pwc-stat.on.red { border-color: #fca5a5; background: #fef2f2; } .pwc-stat.on.amber { border-color: #fcd34d; background: #fffbeb; }
    .pwc-stat.on.green { border-color: #6ee7b7; background: #ecfdf5; } .pwc-stat.on.slate { border-color: #cbd5e1; background: #f8fafc; }
    .pwc-list { display: flex; flex-direction: column; }
    .pwc-row { display: flex; align-items: center; gap: 12px; padding: 10px 4px; border-top: 1px solid #f1f5f9; flex-wrap: wrap; }
    .pwc-av { width: 36px; height: 36px; border-radius: 50%; object-fit: cover; flex: none; }
    .pwc-av-i { display: grid; place-items: center; background: #eff6ff; color: #1d4ed8; font-weight: 700; font-size: 12px; }
    .pwc-person { flex: 1; min-width: 160px; display: flex; flex-direction: column; }
    .pwc-person b { font-size: 13.5px; color: #0f172a; } .pwc-person small { font-size: 12px; color: #64748b; }
    .pwc-due { font-size: 11.5px; font-weight: 700; padding: 3px 9px; border-radius: 999px; background: #ecfdf5; color: #047857; }
    .pwc-due.amber { background: #fffbeb; color: #b45309; } .pwc-due.red { background: #fef2f2; color: #b91c1c; }
    .pwc-rev { font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 999px; background: #ecfdf5; color: #047857; }
    .pwc-rev[data-rec="EXTEND"] { background: #fffbeb; color: #b45309; } .pwc-rev[data-rec="NOT_CONFIRM"] { background: #fef2f2; color: #b91c1c; }
    .pwc-rev.pending { background: #f1f5f9; color: #64748b; }
    .pwc-actions { display: flex; gap: 6px; }
    .pwc-btn { height: 30px; padding: 0 12px; border-radius: 8px; border: 1px solid #cbd5e1; background: #fff; font-size: 12.5px; font-weight: 600; cursor: pointer; }
    .pwc-btn.ok { border-color: #6ee7b7; background: #ecfdf5; color: #047857; }
    .pwc-btn[disabled] { opacity: .5; }
    .pwc-empty { padding: 14px 4px; color: #94a3b8; font-size: 13px; border-top: 1px solid #f1f5f9; }
    .pwc-more { margin-top: 6px; border: 0; background: none; color: #2563eb; font-weight: 600; cursor: pointer; text-align: left; }
    @media (max-width: 760px) { .pwc-stats { grid-template-columns: 1fr 1fr; } }
  `],
})
export class ProbationWatchCardComponent implements OnInit {
  private api = inject(LifecycleService);
  private router = inject(Router);
  private toast = inject(HotToastService);
  d = signal<LcOverview | null>(null);
  busy = signal(false);
  filter = signal<'overdue' | 'soon' | 'reviewed' | 'pending'>('overdue');

  private list = computed(() => this.d()?.probation ?? []);
  overdue = computed(() => this.list().filter((r) => (r.daysLeft ?? 0) < 0));
  soon = computed(() => this.list().filter((r) => (r.daysLeft ?? 0) >= 0 && (r.daysLeft ?? 0) <= 30));
  reviewed = computed(() => this.list().filter((r) => !!r.review));
  pendingReview = computed(() => this.list().filter((r) => !r.review));
  rows = computed(() => ({ overdue: this.overdue(), soon: this.soon(), reviewed: this.reviewed(), pending: this.pendingReview() })[this.filter()]);
  visible = computed(() => {
    const d = this.d();
    return !!d && (d.canManageProbation || d.isManager) && (this.overdue().length + this.soon().length + this.reviewed().length) > 0;
  });

  ngOnInit() { this.load(); }
  load() {
    this.api.overview().subscribe({
      next: (d) => {
        this.d.set(d);
        if (!this.overdue().length) this.filter.set(this.soon().length ? 'soon' : 'reviewed');
      },
      error: () => {},
    });
  }
  initials(n: string) { return n.split(' ').filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase(); }
  recLabel(rv: { recommendation: string; extendMonths?: number }) {
    return rv.recommendation === 'CONFIRM' ? 'Recommends confirm' : rv.recommendation === 'EXTEND' ? `Recommends extend ${rv.extendMonths ?? ''}m` : 'Recommends not confirm';
  }
  openAll() { this.router.navigate(['/performance'], { queryParams: { tab: 'probation' } }); }
  confirm(r: LcProbation) {
    const override = !r.review;
    if (!confirm(`${override ? 'No manager review yet. Confirm as Super Admin? ' : ''}Confirm ${r.name}? Leave for the rest of the year is credited and the confirmation letter is issued.`)) return;
    this.busy.set(true);
    this.api.confirmProbation(r.employeeId).subscribe({
      next: (x: any) => {
        this.busy.set(false);
        const leave = (x?.leaveCredited || []).map((c: any) => `${c.leaveType} ${c.days}`).join(', ');
        this.toast.success(`${r.name} confirmed${leave ? ' · leave credited: ' + leave : ''}`);
        this.load();
      },
      error: (e) => { this.busy.set(false); this.toast.error(e.error?.message || 'Could not confirm'); },
    });
  }
}
