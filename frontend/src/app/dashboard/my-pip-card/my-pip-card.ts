import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HotToastService } from '@ngneat/hot-toast';
import { LifecycleService, LcPipDetail } from '../../services/lifecycle.service';

/**
 * My PIP (19 Oct 2026), on My Workspace for the employee it concerns: the
 * plan's dates, reason, goals and check-ins, and "I have read it". Shown on
 * the dashboard so it never depends on the Performance page being open to
 * them. Nothing renders for someone without an open PIP.
 */
@Component({
  selector: 'app-my-pip-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="mpc" *ngIf="pip() as p">
      <div class="mpc-head">
        <div>
          <span class="mpc-kicker">Performance Improvement Plan</span>
          <h3>{{ p.startDate | date:'d MMM y':'UTC' }} – {{ p.endDate | date:'d MMM y':'UTC' }}</h3>
          <span class="mpc-sub">{{ p.daysLeft !== null && p.daysLeft >= 0 ? p.daysLeft + ' days left' : 'Ending' }}<ng-container *ngIf="p.raisedBy"> · by {{ p.raisedBy }}</ng-container></span>
        </div>
        <span class="mpc-ack" [class.done]="!!p.acknowledgedAt">{{ p.acknowledgedAt ? 'Acknowledged' : 'Please read and acknowledge' }}</span>
      </div>
      <div class="mpc-block"><small>Reason</small><p>{{ p.reason }}</p></div>
      <div class="mpc-block"><small>Goals to meet</small><p>{{ p.goals }}</p></div>
      <div class="mpc-block" *ngIf="p.checkIns.length">
        <small>Check-ins</small>
        <div class="mpc-check" *ngFor="let c of p.checkIns.slice(0, 3)"><b>{{ c.author || '—' }}</b> · {{ c.createdAt | date:'d MMM' }}<p>{{ c.note }}</p></div>
      </div>
      <div class="mpc-actions" *ngIf="!p.acknowledgedAt">
        <button type="button" (click)="acknowledge(p.id)" [disabled]="busy()">{{ busy() ? 'Saving…' : 'I have read it' }}</button>
      </div>
    </section>
  `,
  styles: [`
    .mpc { margin-top: 16px; padding: 20px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 16px; }
    .mpc-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; }
    .mpc-kicker { font-size: 11.5px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; color: #b45309; }
    .mpc-head h3 { margin: 2px 0; font-size: 17px; font-weight: 800; color: #0f172a; }
    .mpc-sub { font-size: 12.5px; color: #92400e; }
    .mpc-ack { font-size: 12px; font-weight: 800; padding: 4px 10px; border-radius: 999px; background: #fef3c7; color: #b45309; }
    .mpc-ack.done { background: #ecfdf5; color: #047857; }
    .mpc-block { margin-top: 10px; }
    .mpc-block small { font-size: 11px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; color: #a16207; }
    .mpc-block p { margin: 3px 0 0; font-size: 13.5px; color: #1e293b; white-space: pre-wrap; line-height: 1.5; }
    .mpc-check { margin-top: 6px; padding: 8px 10px; background: #fff; border-radius: 10px; font-size: 12px; color: #64748b; }
    .mpc-check p { margin: 2px 0 0; color: #1e293b; font-size: 13px; }
    .mpc-actions { margin-top: 14px; display: flex; justify-content: flex-end; }
    .mpc-actions button { height: 40px; padding: 0 18px; border: 0; border-radius: 10px; background: #1373e5; color: #fff; font-weight: 800; cursor: pointer; }
    .mpc-actions button:disabled { opacity: .6; }
  `],
})
export class MyPipCardComponent implements OnInit {
  private api = inject(LifecycleService);
  private toast = inject(HotToastService);
  pip = signal<LcPipDetail | null>(null);
  busy = signal(false);

  ngOnInit() {
    this.api.myPips().subscribe({
      next: (list) => {
        const open = list.find((p) => p.status === 'ACTIVE' || p.status === 'EXTENDED');
        if (open) this.api.getPip(open.id).subscribe({ next: (d) => this.pip.set(d), error: () => {} });
      },
      error: () => {},
    });
  }

  acknowledge(id: number) {
    this.busy.set(true);
    this.api.acknowledge(id).subscribe({
      next: (d) => { this.busy.set(false); this.pip.set(d); this.toast.success('Acknowledged'); },
      error: (e) => { this.busy.set(false); this.toast.error(e.error?.message || 'Could not acknowledge'); },
    });
  }
}
