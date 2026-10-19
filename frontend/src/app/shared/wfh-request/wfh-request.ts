import { Component, inject, Input, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HotToastService } from '@ngneat/hot-toast';
import { WfhRequest, WfhService } from '../../services/wfh.service';

/**
 * "Request WFH" (19 Oct 2026): the button, the request form, and my requests.
 * WFH used to be a leave type; it is its own request now, approved by the
 * reporting manager and then HR, with a monthly allowance set by HR here.
 */
@Component({
  selector: 'app-wfh-request',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <button type="button" class="wfh-btn" (click)="openForm()">🏠 Request WFH</button>

    <div class="wfh-overlay" *ngIf="open()" (click)="open.set(false)">
      <div class="wfh-dialog" (click)="$event.stopPropagation()">
        <div class="wfh-head">
          <h3>Work From Home</h3>
          <button type="button" class="wfh-x" (click)="open.set(false)">✕</button>
        </div>
        <p class="wfh-allow">
          {{ limit() === 0 ? 'WFH requests are switched off.' : 'You can work from home ' + limit() + ' day' + (limit() === 1 ? '' : 's') + ' a month.' }}
          <b>{{ used() }} of {{ limit() }}</b> used this month (pending or approved).
        </p>

        <label class="wfh-field"><span>Date</span><input type="date" [min]="today" [(ngModel)]="date" /></label>
        <label class="wfh-field"><span>Reason</span><textarea rows="3" [(ngModel)]="reason" placeholder="Why you need to work from home"></textarea></label>
        <p class="wfh-note">Your reporting manager approves first, then HR.</p>
        <div class="wfh-actions">
          <button type="button" class="wfh-b" (click)="open.set(false)">Close</button>
          <button type="button" class="wfh-b primary" (click)="submit()" [disabled]="busy() || !date || !reason.trim()">{{ busy() ? 'Sending…' : 'Send request' }}</button>
        </div>

        <ng-container *ngIf="canSetLimit">
          <div class="wfh-sub">Setting (HR)</div>
          <div class="wfh-limit">
            <span>WFH days allowed per month</span>
            <input type="number" min="0" max="31" [(ngModel)]="limitInput" />
            <button type="button" class="wfh-b" (click)="saveLimit()" [disabled]="busy()">Save</button>
          </div>
        </ng-container>

        <div class="wfh-sub">My WFH requests</div>
        <div class="wfh-empty" *ngIf="!requests().length">None yet.</div>
        <div class="wfh-row" *ngFor="let r of requests()">
          <div>
            <b>{{ r.date | date:'EEE, d MMM y':'UTC' }}</b>
            <small>{{ r.reason }}</small>
            <small *ngIf="r.reviewNote && r.status === 'REJECTED'" class="wfh-rej">“{{ r.reviewNote }}”</small>
          </div>
          <span class="wfh-st s-{{ r.status }}">{{ statusLabel(r.status) }}</span>
          <button type="button" class="wfh-link" *ngIf="canCancel(r)" (click)="cancel(r)">Cancel</button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .wfh-btn { height: 40px; padding: 0 14px; border: 1px solid #a7f3d0; border-radius: 10px; background: #ecfdf5; color: #047857; font-weight: 800; font-size: 13px; cursor: pointer; white-space: nowrap; }
    .wfh-overlay { position: fixed; inset: 0; z-index: 1300; background: rgba(15,23,42,.5); display: flex; align-items: center; justify-content: center; padding: 16px; }
    .wfh-dialog { width: min(480px, 100%); max-height: calc(100vh - 32px); overflow-y: auto; background: #fff; border-radius: 16px; padding: 22px; display: flex; flex-direction: column; gap: 10px; }
    .wfh-head { display: flex; justify-content: space-between; align-items: center; }
    .wfh-head h3 { margin: 0; font-size: 18px; font-weight: 800; color: #0f172a; }
    .wfh-x { width: 32px; height: 32px; border: 0; border-radius: 8px; background: #f1f5f9; color: #64748b; cursor: pointer; }
    .wfh-allow { margin: 0; font-size: 13px; color: #475569; background: #f8fafc; border-radius: 10px; padding: 10px 12px; }
    .wfh-field { display: flex; flex-direction: column; gap: 6px; font-size: 12.5px; font-weight: 700; color: #334155; }
    .wfh-field input, .wfh-field textarea { border: 1px solid #cbd5e1; border-radius: 10px; padding: 9px 12px; font-size: 13.5px; font-family: inherit; }
    .wfh-note { margin: 0; font-size: 12px; color: #94a3b8; }
    .wfh-actions { display: flex; justify-content: flex-end; gap: 8px; }
    .wfh-b { height: 38px; padding: 0 14px; border: 1px solid #e2e8f0; border-radius: 10px; background: #fff; font-weight: 700; font-size: 13px; color: #334155; cursor: pointer; }
    .wfh-b.primary { background: #1373e5; border-color: #1373e5; color: #fff; }
    .wfh-b:disabled { opacity: .55; cursor: not-allowed; }
    .wfh-sub { margin-top: 8px; font-size: 11.5px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; color: #94a3b8; }
    .wfh-limit { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #334155; }
    .wfh-limit input { width: 70px; height: 36px; border: 1px solid #cbd5e1; border-radius: 8px; padding: 0 8px; }
    .wfh-empty { font-size: 13px; color: #94a3b8; }
    .wfh-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-top: 1px solid #f1f5f9; }
    .wfh-row > div { flex: 1; display: flex; flex-direction: column; min-width: 0; }
    .wfh-row b { font-size: 13.5px; color: #0f172a; }
    .wfh-row small { font-size: 12px; color: #64748b; }
    .wfh-rej { color: #b91c1c !important; }
    .wfh-st { font-size: 11.5px; font-weight: 800; padding: 2px 9px; border-radius: 999px; background: #f1f5f9; color: #475569; white-space: nowrap; }
    .wfh-st.s-PENDING_MANAGER, .wfh-st.s-PENDING_HR { background: #fffbeb; color: #b45309; }
    .wfh-st.s-APPROVED { background: #ecfdf5; color: #047857; }
    .wfh-st.s-REJECTED { background: #fef2f2; color: #b91c1c; }
    .wfh-link { border: 0; background: none; color: #b91c1c; font-weight: 700; font-size: 12.5px; cursor: pointer; }
  `],
})
export class WfhRequestComponent implements OnInit {
  private api = inject(WfhService);
  private toast = inject(HotToastService);

  /** HR and admins can change the monthly allowance from the same dialog. */
  @Input() canSetLimit = false;

  open = signal(false);
  busy = signal(false);
  limit = signal(1);
  used = signal(0);
  requests = signal<WfhRequest[]>([]);
  today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  date = '';
  reason = '';
  limitInput = 1;

  ngOnInit() { this.load(); }

  load() {
    this.api.mine().subscribe({
      next: (r) => { this.limit.set(r.limit); this.limitInput = r.limit; this.used.set(r.usedThisMonth); this.requests.set(r.requests); },
      error: () => {},
    });
  }

  openForm() { this.date = this.today; this.reason = ''; this.load(); this.open.set(true); }

  submit() {
    this.busy.set(true);
    this.api.create(this.date, this.reason.trim()).subscribe({
      next: () => { this.busy.set(false); this.toast.success('WFH request sent to your manager'); this.reason = ''; this.load(); },
      error: (e) => { this.busy.set(false); this.toast.error(e.error?.message || 'Could not send the request'); },
    });
  }

  cancel(r: WfhRequest) {
    if (!confirm('Cancel this WFH request?')) return;
    this.api.cancel(r.id).subscribe({
      next: () => { this.toast.success('Cancelled'); this.load(); },
      error: (e) => this.toast.error(e.error?.message || 'Could not cancel'),
    });
  }

  saveLimit() {
    this.busy.set(true);
    this.api.saveSettings(Number(this.limitInput)).subscribe({
      next: (r) => { this.busy.set(false); this.limit.set(r.wfhDaysPerMonth); this.toast.success('WFH limit saved'); },
      error: (e) => { this.busy.set(false); this.toast.error(e.error?.message || 'Could not save'); },
    });
  }

  canCancel(r: WfhRequest) {
    return r.status === 'PENDING_MANAGER' || r.status === 'PENDING_HR' || (r.status === 'APPROVED' && r.date.slice(0, 10) >= this.today);
  }

  statusLabel(s: string) {
    return ({ PENDING_MANAGER: 'With manager', PENDING_HR: 'With HR', APPROVED: 'Approved', REJECTED: 'Rejected', CANCELLED: 'Cancelled' } as any)[s] ?? s;
  }
}
