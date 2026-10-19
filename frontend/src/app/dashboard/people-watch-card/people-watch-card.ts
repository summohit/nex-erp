import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { LifecycleService, LcOverview, LcPip } from '../../services/lifecycle.service';

/**
 * Dashboard card (19 Oct 2026): for HR, admins and managers, who is on
 * probation, serving notice or on a PIP, ending soonest first; for someone
 * with an open PIP of their own, a reminder to open and acknowledge it.
 */
type Item = { kind: 'Probation' | 'Notice' | 'PIP'; name: string; avatarUrl: string | null; date: string | null; daysLeft: number | null };

@Component({
  selector: 'app-people-watch-card',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="dashboard-card pwc" *ngIf="minePip() as p">
      <div class="pwc-mine">
        <div>
          <b>You have a Performance Improvement Plan</b>
          <span>{{ p.startDate | date:'d MMM' }} – {{ p.endDate | date:'d MMM y' }}{{ p.acknowledgedAt ? '' : ' · please open and acknowledge it' }}</span>
        </div>
        <a routerLink="/performance" [queryParams]="{ tab: 'people' }" class="pwc-btn">Open</a>
      </div>
    </div>

    <div class="dashboard-card pwc" *ngIf="data() as d">
      <div class="pwc-head">
        <h3>Probation, Notice & PIP</h3>
        <a routerLink="/performance" [queryParams]="{ tab: 'people' }" class="pwc-link">View all</a>
      </div>
      <div class="pwc-counts">
        <div><b>{{ d.probation.length }}</b><span>Probation</span></div>
        <div><b>{{ d.notice.length }}</b><span>Notice period</span></div>
        <div><b>{{ d.pips.length }}</b><span>Open PIPs</span></div>
      </div>
      <div class="pwc-empty" *ngIf="!items().length">Nothing coming up.</div>
      <div class="pwc-item" *ngFor="let i of items()">
        <span class="pwc-av"><img *ngIf="i.avatarUrl" [src]="i.avatarUrl" alt=""><span *ngIf="!i.avatarUrl">{{ initials(i.name) }}</span></span>
        <div class="pwc-text"><b>{{ i.name }}</b><span>{{ i.kind }}{{ i.date ? ' · ends ' + (i.date | date:'d MMM') : '' }}</span></div>
        <span class="pwc-due" [class.soon]="i.daysLeft !== null && i.daysLeft <= 7" [class.over]="i.daysLeft !== null && i.daysLeft < 0">{{ due(i.daysLeft) }}</span>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .pwc { padding: 16px 18px; margin-bottom: 0; }
    .pwc + .pwc { margin-top: 16px; }
    .pwc-mine { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
    .pwc-mine b { display: block; color: #92400e; }
    .pwc-mine span { font-size: 12.5px; color: #b45309; }
    .pwc-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
    .pwc-head h3 { margin: 0; font-size: 15px; font-weight: 800; color: #0f172a; }
    .pwc-link { font-size: 12.5px; font-weight: 700; color: #1373e5; text-decoration: none; }
    .pwc-btn { height: 34px; padding: 0 14px; border-radius: 9px; background: #1373e5; color: #fff; font-weight: 700; font-size: 12.5px; display: inline-flex; align-items: center; text-decoration: none; }
    .pwc-counts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 10px; }
    .pwc-counts div { padding: 10px; border-radius: 10px; background: #f8fafc; display: flex; flex-direction: column; }
    .pwc-counts b { font-size: 20px; color: #0f172a; }
    .pwc-counts span { font-size: 11.5px; font-weight: 700; color: #64748b; }
    .pwc-empty { font-size: 12.5px; color: #94a3b8; padding: 6px 0; }
    .pwc-item { display: flex; align-items: center; gap: 10px; padding: 7px 0; border-top: 1px solid #f1f5f9; }
    .pwc-av { width: 30px; height: 30px; flex: 0 0 30px; border-radius: 50%; background: #e0e7ff; color: #3730a3; display: grid; place-items: center; font-size: 11px; font-weight: 800; overflow: hidden; }
    .pwc-av img { width: 100%; height: 100%; object-fit: cover; }
    .pwc-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .pwc-text b { font-size: 13px; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pwc-text span { font-size: 11.5px; color: #64748b; }
    .pwc-due { font-size: 11.5px; font-weight: 800; color: #15803d; white-space: nowrap; }
    .pwc-due.soon { color: #b45309; }
    .pwc-due.over { color: #b91c1c; }
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
      ...d.probation.map((p) => ({ kind: 'Probation' as const, name: p.name, avatarUrl: p.avatarUrl, date: p.endDate, daysLeft: p.daysLeft })),
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

  initials(n: string) { return n.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase(); }
  due(d: number | null) {
    if (d === null) return '';
    if (d < 0) return `${-d}d overdue`;
    if (d === 0) return 'Today';
    return `${d}d left`;
  }
}
