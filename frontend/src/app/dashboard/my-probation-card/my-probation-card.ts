import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LifecycleService } from '../../services/lifecycle.service';

/**
 * My probation (4 Nov 2026), on My Workspace while the employee is on
 * probation: the end date and what it means for leave. Renders nothing once
 * they are confirmed.
 */
@Component({
  selector: 'app-my-probation-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="mprc" *ngIf="p() as p">
      <div class="mprc-head">
        <div>
          <span class="mprc-kicker">Probation</span>
          <h3>Until {{ p.endDate | date:'d MMM y':'UTC' }}</h3>
          <span class="mprc-sub">{{ p.daysLeft !== null && p.daysLeft! >= 0 ? p.daysLeft + ' days left' : 'Review in progress' }}<ng-container *ngIf="p.extensions"> · extended {{ p.extensions }}×</ng-container></span>
        </div>
      </div>
      <p class="mprc-text">While on probation there is no paid leave — any absence is loss of pay. Once you are confirmed, leave for the rest of the year is credited to you.</p>
    </section>
  `,
  styles: [`
    .mprc { margin-top: 16px; padding: 18px 20px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 16px; }
    .mprc-kicker { font-size: 11.5px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; color: #1d4ed8; }
    .mprc-head h3 { margin: 2px 0; font-size: 18px; color: #0f172a; }
    .mprc-sub { font-size: 12.5px; color: #475569; }
    .mprc-text { margin: 10px 0 0; font-size: 13px; color: #334155; }
  `],
})
export class MyProbationCardComponent implements OnInit {
  private api = inject(LifecycleService);
  p = signal<{ endDate?: string; daysLeft?: number | null; extensions?: number } | null>(null);
  ngOnInit() {
    this.api.myProbation().subscribe({ next: (r) => this.p.set(r.onProbation ? r : null), error: () => {} });
  }
}
