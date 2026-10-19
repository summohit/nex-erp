import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { LucideAlertTriangle, LucideChevronRight, LucideUserCheck } from '@lucide/angular';
import { LifecycleService, LcOverview, LcPip } from '../../services/lifecycle.service';

type Item = { kind: 'Probation' | 'Notice' | 'PIP'; name: string; avatarUrl: string | null; date: string | null; daysLeft: number | null };

@Component({
  selector: 'app-people-watch-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RouterModule, LucideAlertTriangle, LucideChevronRight, LucideUserCheck],
  template: `
    <!-- Own PIP now shows in app-my-pip-card (19 Oct 2026). -->
    <div class="pwc-card pwc-alert" *ngIf="false && minePip() as p">
      <div class="pwc-mine">
        <div class="pwc-mine-left">
          <div class="pwc-alert-ico">
            <svg lucideAlertTriangle size="18"></svg>
          </div>
          <div>
            <b>You have an active Performance Improvement Plan</b>
            <span>{{ p.startDate | date:'d MMM y' }} – {{ p.endDate | date:'d MMM y' }}{{ p.acknowledgedAt ? '' : ' · Please open and acknowledge it' }}</span>
          </div>
        </div>
        <a routerLink="/performance" [queryParams]="{ tab: 'people' }" class="pwc-btn">
          <span>Review Plan</span>
          <svg lucideChevronRight size="14"></svg>
        </a>
      </div>
    </div>

    <div class="pwc-card" *ngIf="data() as d">
      <div class="pwc-head">
        <div class="pwc-title-group">
          <div class="pwc-icon-badge">
            <svg lucideUserCheck size="17"></svg>
          </div>
          <div>
            <div class="pwc-title-row">
              <h3>Lifecycle Watch: PIP · Notice</h3>
              <span class="pwc-inline-zero" *ngIf="!items().length">All clear · 0 active deadlines</span>
            </div>
            <span class="pwc-sub">Employee lifecycle checkpoints &amp; transition progress</span>
          </div>
        </div>
        <a routerLink="/performance" [queryParams]="{ tab: 'people' }" class="pwc-link">
          <span>Manage Lifecycle</span>
          <svg lucideChevronRight size="14"></svg>
        </a>
      </div>

      <div class="pwc-body">
        <!-- Compact Stat Chips with Mini Progress Bars -->
        <div class="pwc-counts">
          <!-- Probation hidden for now (19 Oct 2026) -->
          <div class="pwc-stat indigo" *ngIf="false">
            <div class="pwc-stat-top">
              <span>On Probation</span>
              <b>{{ d.probation.length }}</b>
            </div>
            <div class="pwc-mini-bar"><i [style.width.%]="chipBarWidth(d.probation.length, 8)"></i></div>
          </div>

          <div class="pwc-stat amber">
            <div class="pwc-stat-top">
              <span>Serving Notice</span>
              <b>{{ d.notice.length }}</b>
            </div>
            <div class="pwc-mini-bar"><i [style.width.%]="chipBarWidth(d.notice.length, 5)"></i></div>
          </div>

          <div class="pwc-stat rose">
            <div class="pwc-stat-top">
              <span>Active PIPs</span>
              <b>{{ d.pips.length }}</b>
            </div>
            <div class="pwc-mini-bar"><i [style.width.%]="chipBarWidth(d.pips.length, 4)"></i></div>
          </div>
        </div>

        <div class="pwc-list" *ngIf="items().length > 0">
          <div class="pwc-item" *ngFor="let i of items(); trackBy: trackByItem">
            <span class="pwc-av">
              <img *ngIf="i.avatarUrl" [src]="i.avatarUrl" alt="" (error)="i.avatarUrl = null">
              <span *ngIf="!i.avatarUrl">{{ initials(i.name) }}</span>
            </span>
            <div class="pwc-text">
              <b>{{ i.name }}</b>
              <span>
                <span class="pwc-kind-pill" [class]="'k-' + i.kind.toLowerCase()">{{ i.kind }}</span>
                <ng-container *ngIf="i.date"> · Ends {{ i.date | date:'d MMM y' }}</ng-container>
              </span>
            </div>
            <span
              class="pwc-due"
              [class.soon]="i.daysLeft !== null && i.daysLeft >= 0 && i.daysLeft <= 7"
              [class.over]="i.daysLeft !== null && i.daysLeft < 0"
            >
              {{ due(i.daysLeft) }}
            </span>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .pwc-card {
      background: var(--dash-surface, #ffffff);
      border: 1px solid var(--dash-border, #e2e8f0);
      border-radius: 16px;
      padding: 20px;
      box-shadow: var(--dash-shadow, 0 1px 3px rgba(15, 23, 42, 0.03), 0 8px 24px -6px rgba(15, 23, 42, 0.04));
    }
    .pwc-alert {
      background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%);
      border-color: #fde68a;
      margin-bottom: 16px;
    }
    .pwc-mine { display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; }
    .pwc-mine-left { display: flex; align-items: center; gap: 12px; }
    .pwc-alert-ico {
      width: 38px; height: 38px; border-radius: 10px;
      background: #ffffff; border: 1px solid #fde68a; color: #d97706;
      display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
    }
    .pwc-mine b { display: block; font-size: 14px; font-weight: 800; color: #92400e; }
    .pwc-mine span { font-size: 12.5px; color: #b45309; font-weight: 500; }
    .pwc-btn {
      height: 34px; padding: 0 14px; border-radius: 9px;
      background: #d97706; color: #ffffff; font-weight: 700; font-size: 12px;
      display: inline-flex; align-items: center; gap: 5px; text-decoration: none;
    }

    .pwc-head {
      display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;
      margin-bottom: 14px; flex-wrap: wrap;
    }
    .pwc-title-group { display: flex; align-items: center; gap: 12px; }
    .pwc-icon-badge {
      width: 38px; height: 38px; border-radius: 10px;
      background: #eef2ff; border: 1px solid #e0e7ff; color: #4f46e5;
      display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
    }
    .pwc-title-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .pwc-head h3 { margin: 0; font-size: 16px; font-weight: 800; color: var(--dash-text-primary, #0f172a); line-height: 1.2; }
    .pwc-inline-zero {
      padding: 2px 8px; border-radius: 999px;
      background: #ecfdf5; border: 1px solid #a7f3d0; color: #047857;
      font-size: 11px; font-weight: 700;
    }
    .pwc-sub { font-size: 12px; font-weight: 500; color: var(--dash-text-muted, #64748b); display: block; margin-top: 2px; }
    .pwc-link {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 5px 10px; border-radius: 8px;
      background: #eff6ff; font-size: 12px; font-weight: 700; color: #1373e5; text-decoration: none;
    }

    .pwc-counts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
    .pwc-stat {
      padding: 10px 14px; border-radius: 12px; border: 1px solid #e2e8f0;
      background: var(--dash-surface-subtle, #f8fafc); display: flex; flex-direction: column; gap: 7px;
    }
    .pwc-stat-top { display: flex; align-items: baseline; justify-content: space-between; gap: 6px; }
    .pwc-stat-top span { font-size: 12px; font-weight: 700; color: var(--dash-text-muted, #64748b); }
    .pwc-stat-top b { font-size: 18px; font-weight: 800; line-height: 1; font-variant-numeric: tabular-nums; }
    .pwc-mini-bar { height: 5px; border-radius: 999px; background: rgba(148, 163, 184, 0.2); overflow: hidden; }
    .pwc-mini-bar i { display: block; height: 100%; border-radius: 999px; transition: width 0.3s ease; }

    .pwc-stat.indigo { background: #eef2ff; border-color: #e0e7ff; }
    .pwc-stat.indigo b { color: #4338ca; }
    .pwc-stat.indigo .pwc-mini-bar i { background: #4f46e5; }

    .pwc-stat.amber { background: #fffbeb; border-color: #fef3c7; }
    .pwc-stat.amber b { color: #b45309; }
    .pwc-stat.amber .pwc-mini-bar i { background: #d97706; }

    .pwc-stat.rose { background: #fff1f2; border-color: #ffe4e6; }
    .pwc-stat.rose b { color: #be123c; }
    .pwc-stat.rose .pwc-mini-bar i { background: #e11d48; }

    .pwc-list { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; }
    .pwc-item {
      display: flex; align-items: center; gap: 12px;
      padding: 9px 12px; border-radius: 12px;
      background: var(--dash-surface-subtle, #f8fafc); border: 1px solid var(--dash-border, #eef2f6);
    }
    .pwc-av {
      width: 32px; height: 32px; flex: 0 0 32px; border-radius: 50%;
      background: #e0e7ff; color: #3730a3; border: 1px solid #c7d2fe;
      display: grid; place-items: center; font-size: 11px; font-weight: 800; overflow: hidden;
    }
    .pwc-av img { width: 100%; height: 100%; object-fit: cover; }
    .pwc-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .pwc-text b { font-size: 13px; font-weight: 700; color: var(--dash-text-primary, #0f172a); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pwc-text span { font-size: 11.5px; color: var(--dash-text-muted, #64748b); display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
    .pwc-kind-pill {
      font-size: 10px; font-weight: 800; padding: 1px 6px; border-radius: 5px;
      background: #eef2ff; color: #4338ca; border: 1px solid #e0e7ff;
    }
    .pwc-kind-pill.k-notice { background: #fffbeb; color: #b45309; border-color: #fde68a; }
    .pwc-kind-pill.k-pip { background: #fff1f2; color: #be123c; border-color: #fecdd3; }
    .pwc-due {
      font-size: 11px; font-weight: 800; padding: 3px 8px; border-radius: 999px;
      background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    .pwc-due.soon { background: #fffbeb; color: #b45309; border-color: #fde68a; }
    .pwc-due.over { background: #fef2f2; color: #b91c1c; border-color: #fecaca; }
    @media (max-width: 640px) {
      .pwc-counts { grid-template-columns: 1fr; }
    }
  `],
})
export class PeopleWatchCardComponent implements OnInit {
  private api = inject(LifecycleService);
  data = signal<LcOverview | null>(null);
  minePip = signal<LcPip | null>(null);

  items = computed<Item[]>(() => {
    const d = this.data();
    if (!d) return [];
    const all: Item[] = [
      // Probation hidden for now (19 Oct 2026).
      ...[].map((p: any) => ({ kind: 'Probation' as const, name: p.name, avatarUrl: p.avatarUrl, date: p.endDate, daysLeft: p.daysLeft })),
      ...d.notice.map((n) => ({ kind: 'Notice' as const, name: n.name, avatarUrl: n.avatarUrl, date: n.lastWorkingDay, daysLeft: n.daysLeft })),
      ...d.pips.map((p) => ({ kind: 'PIP' as const, name: p.name, avatarUrl: p.avatarUrl, date: p.endDate, daysLeft: p.daysLeft })),
    ];
    return all.sort((a, b) => (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999)).slice(0, 5);
  });

  ngOnInit() {
    this.api.overview().subscribe({
      next: (d) => this.data.set(d.canManageProbation || d.isManager ? d : null),
      error: () => this.data.set(null),
    });
    this.api.myPips().subscribe({
      next: (l) => this.minePip.set(l.find((p) => p.status === 'ACTIVE' || p.status === 'EXTENDED') ?? null),
      error: () => {},
    });
  }

  chipBarWidth(count: number, scaleMax: number): number {
    if (!count) return 6;
    return Math.min(100, Math.max(16, Math.round((count / scaleMax) * 100)));
  }

  trackByItem = (idx: number, i: Item) => `${i.kind}-${i.name}-${idx}`;

  initials(n: string) { return n.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase(); }
  due(d: number | null) {
    if (d === null) return '';
    if (d < 0) return `${-d}d overdue`;
    if (d === 0) return 'Today';
    return `${d}d left`;
  }
}
