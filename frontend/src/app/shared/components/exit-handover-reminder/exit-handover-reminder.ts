import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { environment } from '../../../../environments/environment';

/** 20 Nov 2026: the exit handover reminder comes back every 5 minutes. */
const REMIND_EVERY_MS = 5 * 60 * 1000;

interface HandoverReminder { resignationId: number; kind: 'FILL' | 'RECEIVE'; employeeName: string; lastWorkingDay: string; }

/**
 * Exit handover reminder. The leaver sees it until they submit their handover;
 * the reporting manager sees it until they mark a submitted handover received.
 * Shown when MIRA opens and every 5 minutes on any page. "Later" hides it until
 * the next round; the server decides who sees it.
 */
@Component({
  selector: 'app-exit-handover-reminder',
  standalone: true,
  imports: [CommonModule],
  template: `
  <div class="ehr-overlay" *ngIf="open() && items().length">
    <div class="ehr-card" role="dialog" aria-modal="true" aria-labelledby="ehr-title">
      <div class="ehr-head">
        <span class="ehr-icon">📋</span>
        <div>
          <h3 id="ehr-title">Exit handover pending</h3>
          <p>This reminder comes back every 5 minutes until it's done.</p>
        </div>
      </div>
      <div class="ehr-item" *ngFor="let it of items()">
        <div class="ehr-text" *ngIf="it.kind === 'FILL'">
          Your last working day is <b>{{ it.lastWorkingDay | date:'d MMM y':'UTC' }}</b>. Please fill your exit handover
          (projects, assets, documents &amp; KT) and submit it to your manager.
        </div>
        <div class="ehr-text" *ngIf="it.kind === 'RECEIVE'">
          <b>{{ it.employeeName }}</b> submitted their exit handover (last day <b>{{ it.lastWorkingDay | date:'d MMM y':'UTC' }}</b>).
          Please check it and mark it received.
        </div>
        <button type="button" class="ehr-btn primary" (click)="go(it)">{{ it.kind === 'FILL' ? 'Fill handover' : 'Review handover' }}</button>
      </div>
      <div class="ehr-foot"><button type="button" class="ehr-btn" (click)="later()">Remind me in 5 minutes</button></div>
    </div>
  </div>`,
  styles: [`
    .ehr-overlay { position: fixed; inset: 0; background: rgba(15,23,42,.45); display: flex; align-items: center; justify-content: center; z-index: 2000; padding: 16px; }
    .ehr-card { background: #fff; border-radius: 16px; width: min(520px, 100%); padding: 22px; box-shadow: 0 24px 60px rgba(15,23,42,.25); font-family: Inter, system-ui, sans-serif; }
    .ehr-head { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 14px; }
    .ehr-icon { width: 40px; height: 40px; border-radius: 10px; background: #fef3c7; display: grid; place-items: center; font-size: 20px; flex: none; }
    .ehr-head h3 { margin: 0 0 2px; font-size: 17px; color: #0f172a; font-family: Outfit, Inter, sans-serif; }
    .ehr-head p { margin: 0; font-size: 13px; color: #64748b; }
    .ehr-item { border: 1px solid #fde68a; background: #fffbeb; border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 10px; margin-bottom: 10px; }
    .ehr-text { font-size: 13.5px; color: #78350f; line-height: 1.5; }
    .ehr-foot { display: flex; justify-content: flex-end; }
    .ehr-btn { border: 1px solid #d0d5dd; background: #fff; border-radius: 8px; padding: 8px 14px; font-weight: 600; font-size: 13px; cursor: pointer; color: #344054; }
    .ehr-btn.primary { align-self: flex-start; background: #2563eb; border-color: #2563eb; color: #fff; }
  `],
})
export class ExitHandoverReminderComponent implements OnInit, OnDestroy {
  private http = inject(HttpClient);
  private router = inject(Router);
  items = signal<HandoverReminder[]>([]);
  open = signal(false);
  private timer: any = null;

  ngOnInit() {
    this.check();
    this.timer = setInterval(() => this.check(), REMIND_EVERY_MS);
  }
  ngOnDestroy() { if (this.timer) clearInterval(this.timer); }

  private check() {
    this.http.get<HandoverReminder[]>(`${environment.apiUrl}/offboarding/handover-reminders`).subscribe({
      next: (r) => { this.items.set(r || []); this.open.set((r || []).length > 0); },
      error: () => this.items.set([]),
    });
  }
  later() { this.open.set(false); }
  go(it: HandoverReminder) {
    this.open.set(false);
    this.router.navigate(['/offboarding'], { queryParams: { handover: it.resignationId } });
  }
}
