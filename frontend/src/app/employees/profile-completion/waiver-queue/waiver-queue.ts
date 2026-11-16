import { Component, EventEmitter, OnInit, Output, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { HotToastService } from '@ngneat/hot-toast';
import { DocumentWaiver, EmployeeService } from '../../../services/employee.service';

/**
 * The Super Admin's queue of document waivers HR asked for (16 Nov 2026).
 * Approve = the document is no longer required for that person; reject needs
 * a reason. Shows nothing when the queue is empty or the viewer may not decide.
 */
@Component({
  selector: 'app-waiver-queue',
  standalone: true,
  imports: [CommonModule, DatePipe],
  template: `
    @if (items().length) {
      <section class="wq">
        <header class="wq-head">
          <strong>Document waiver requests</strong>
          <span class="wq-count">{{ items().length }} waiting</span>
        </header>
        @for (w of items(); track w.id) {
          <div class="wq-row">
            <div class="wq-main">
              <div class="wq-title">{{ w.employee?.firstName }} {{ w.employee?.lastName }}
                <span class="wq-code">#{{ w.employee?.employeeCode }}</span> — <b>{{ w.documentType }}</b></div>
              <div class="wq-reason">“{{ w.reason }}”</div>
              <div class="wq-meta">Asked by {{ w.requestedBy?.firstName }} {{ w.requestedBy?.lastName }} · {{ w.createdAt | date:'d MMM, h:mm a' }}</div>
            </div>
            <div class="wq-actions">
              <button type="button" class="wq-reject" (click)="decide(w, 'REJECT')" [disabled]="busy() === w.id">Reject</button>
              <button type="button" class="wq-approve" (click)="decide(w, 'APPROVE')" [disabled]="busy() === w.id">Approve</button>
            </div>
          </div>
        }
      </section>
    }
  `,
  styles: [`
    .wq { margin: 0 0 16px; border: 1px solid #fde68a; background: #fffbeb; border-radius: 12px; padding: 14px 16px; }
    .wq-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-size: 14px; color: #0f172a; }
    .wq-count { font-size: 12px; font-weight: 600; color: #b45309; }
    .wq-row { display: flex; gap: 12px; align-items: center; justify-content: space-between; flex-wrap: wrap; padding: 10px 0; border-top: 1px solid #fde68a; }
    .wq-main { flex: 1; min-width: 220px; }
    .wq-title { font-size: 13.5px; color: #0f172a; }
    .wq-code { color: #64748b; font-size: 12px; }
    .wq-reason { font-size: 13px; color: #334155; margin-top: 2px; }
    .wq-meta { font-size: 12px; color: #64748b; margin-top: 2px; }
    .wq-actions { display: flex; gap: 8px; }
    .wq-actions button { border-radius: 8px; padding: 6px 14px; font-weight: 600; font-size: 13px; cursor: pointer; }
    .wq-reject { border: 1px solid #fecaca; background: #fff; color: #b91c1c; }
    .wq-approve { border: 0; background: #16a34a; color: #fff; }
    .wq-actions button:disabled { opacity: .6; cursor: default; }
  `],
})
export class WaiverQueueComponent implements OnInit {
  @Output() changed = new EventEmitter<void>();
  private employees = inject(EmployeeService);
  private toast = inject(HotToastService);
  items = signal<DocumentWaiver[]>([]);
  busy = signal<number | null>(null);

  ngOnInit() { this.load(); }

  load() {
    // Only the Super Admin may read the queue; anyone else gets a 403 and sees nothing.
    this.employees.getPendingWaivers().subscribe({ next: (w) => this.items.set(w || []), error: () => this.items.set([]) });
  }

  decide(w: DocumentWaiver, action: 'APPROVE' | 'REJECT') {
    let note: string | undefined;
    if (action === 'REJECT') {
      const r = window.prompt(`Reject the waiver of "${w.documentType}"? Say why (the employee must then upload it).`);
      if (r == null) return;
      if (!r.trim()) { this.toast.error('A rejection has to say why.'); return; }
      note = r.trim();
    }
    this.busy.set(w.id);
    this.employees.decideDocumentWaiver(w.id, action, note).subscribe({
      next: () => {
        this.busy.set(null);
        this.toast.success(action === 'APPROVE' ? `${w.documentType} waived` : 'Waiver rejected');
        this.items.set(this.items().filter(x => x.id !== w.id));
        this.changed.emit();
      },
      error: (e) => { this.busy.set(null); this.toast.error(e?.error?.message || 'Could not save the decision'); },
    });
  }
}
