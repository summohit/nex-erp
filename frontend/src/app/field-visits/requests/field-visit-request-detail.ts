import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { HotToastService } from '@ngneat/hot-toast';
import {
  LucideArrowLeft, LucideCheckCircle, LucideX, LucideClock,
  LucideHistory, LucideExternalLink, LucideSend, LucideBan, LucidePencil,
} from '@lucide/angular';
import {
  FieldVisitRequestsService, FieldVisitRequest, FieldVisitActivity,
} from '../../services/field-visit-requests';
import { FieldVisitRequestFormComponent } from './field-visit-request-form';

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Pending approval',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
  COMPLETED: 'Completed',
};

/**
 * One field visit, end to end (§11).
 *
 * Everything Delivery is supposed to be able to see about a trip in one place:
 * who asked, who is going, what they are doing, where the site is, and — once
 * it runs — each person's day with the times, the coordinates and how far off
 * the site they were when they clocked. The distances are shown as recorded
 * rather than as a tick, because that is what makes a marginal one arguable.
 */
@Component({
  selector: 'app-field-visit-request-detail',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterModule,
    FieldVisitRequestFormComponent,
    LucideArrowLeft, LucideCheckCircle, LucideX, LucideClock,
    LucideHistory, LucideExternalLink, LucideSend, LucideBan, LucidePencil,
  ],
  templateUrl: './field-visit-request-detail.html',
  styleUrls: ['./field-visit-request-detail.css'],
})
export class FieldVisitRequestDetailComponent implements OnInit {
  private api = inject(FieldVisitRequestsService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private sanitizer = inject(DomSanitizer);
  private toast = inject(HotToastService);

  request = signal<FieldVisitRequest | null>(null);
  timeline = signal<FieldVisitActivity[]>([]);
  isLoading = signal(true);
  isWorking = signal(false);

  isRejecting = signal(false);
  rejectionReason = '';

  /** §10: the change form, and turning a proposed change down. */
  isChanging = signal(false);
  isRejectingChange = signal(false);
  changeRejectionReason = '';

  ngOnInit(): void {
    this.load();
  }

  private get id(): number {
    return Number(this.route.snapshot.paramMap.get('id'));
  }

  load(): void {
    this.isLoading.set(true);
    this.api.getOne(this.id).subscribe({
      next: (request) => { this.request.set(request); this.isLoading.set(false); },
      error: (err) => { this.toast.error(this.messageOf(err)); this.isLoading.set(false); },
    });
    this.api.timeline(this.id).subscribe({
      next: (rows) => this.timeline.set(rows),
      error: () => this.timeline.set([]),
    });
  }

  label(status: string): string {
    return STATUS_LABELS[status] ?? status;
  }

  mapUrl(): SafeResourceUrl {
    const request = this.request();
    if (!request) return this.sanitizer.bypassSecurityTrustResourceUrl('');
    return this.sanitizer.bypassSecurityTrustResourceUrl(
      `https://maps.google.com/maps?q=${request.latitude},${request.longitude}&t=&z=16&ie=UTF8&iwloc=&output=embed`,
    );
  }

  /** Metres, from the kilometres the clock recorded. */
  metres(km?: number | null): string {
    if (km == null) return '—';
    const m = Math.round(km * 1000);
    return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
  }

  /** Whether that distance was inside the radius this trip was approved with. */
  wasInside(km?: number | null): boolean {
    const radius = this.request()?.geofenceRadiusM ?? 500;
    return km != null && Math.round(km * 1000) <= radius;
  }

  personName(person: { firstName?: string; lastName?: string } | null | undefined): string {
    return `${person?.firstName ?? ''} ${person?.lastName ?? ''}`.trim() || 'Someone';
  }

  // ─── Decisions ─────────────────────────────────────────────────────────────

  submit(): void {
    this.run(this.api.submit(this.id), 'Sent for approval');
  }

  approve(): void {
    this.run(this.api.approve(this.id), 'Approved — tasks and attendance are assigned');
  }

  reject(): void {
    const reason = this.rejectionReason.trim();
    if (!reason) {
      this.toast.error('A reason is required — it is what the manager acts on.');
      return;
    }
    this.run(this.api.reject(this.id, reason), 'Rejected', () => {
      this.isRejecting.set(false);
      this.rejectionReason = '';
    });
  }

  cancel(): void {
    this.run(this.api.cancel(this.id), 'Field visit cancelled');
  }

  withdraw(): void {
    this.run(this.api.withdraw(this.id), 'Pulled back to a draft');
  }

  // ─── §10: the proposed change ──────────────────────────────────────────────

  onChangeProposed(): void {
    this.isChanging.set(false);
    this.load();
  }

  approveChange(): void {
    this.run(this.api.approveModification(this.id), 'Change approved — the work now matches it');
  }

  rejectChange(): void {
    const reason = this.changeRejectionReason.trim();
    if (!reason) {
      this.toast.error('A reason is required — the trip carries on as approved without one.');
      return;
    }
    this.run(this.api.rejectModification(this.id, reason), 'Change declined', () => {
      this.isRejectingChange.set(false);
      this.changeRejectionReason = '';
    });
  }

  /**
   * What the proposal would actually change, field by field.
   *
   * Only the differences: an approver reading a whole second copy of the trip
   * has to spot the change themselves, which is the part they are ruling on.
   */
  changeDiff(): { field: string; from: string; to: string }[] {
    const request = this.request();
    const change = request?.pendingChange;
    if (!request || !change) return [];

    const names = (ids: number[]) => ids
      .map((id) => {
        const member = request.members.find((m) => m.employee.id === id);
        return member ? this.personName(member.employee) : `Employee ${id}`;
      })
      .join(', ');

    const rows: { field: string; from: string; to: string }[] = [];
    if (change.location !== request.location) {
      rows.push({ field: 'Site', from: request.location, to: change.location });
    }
    if (change.latitude !== request.latitude || change.longitude !== request.longitude) {
      rows.push({
        field: 'Coordinates',
        from: `${request.latitude}, ${request.longitude}`,
        to: `${change.latitude}, ${change.longitude}`,
      });
    }
    const day = (value: string) => value.slice(0, 10);
    if (day(change.startDate) !== day(request.startDate) || day(change.endDate) !== day(request.endDate)) {
      rows.push({
        field: 'Dates',
        from: `${day(request.startDate)} to ${day(request.endDate)} (${request.visitDays} days)`,
        to: `${day(change.startDate)} to ${day(change.endDate)} (${change.visitDays} days)`,
      });
    }
    if (change.startTime !== request.startTime || change.endTime !== request.endTime) {
      rows.push({
        field: 'Hours',
        from: `${request.startTime}–${request.endTime}`,
        to: `${change.startTime}–${change.endTime}`,
      });
    }
    const current = request.members.map((m) => m.employee.id);
    if ([...current].sort().join(',') !== [...change.employeeIds].sort().join(',')) {
      rows.push({
        field: 'People',
        from: request.members.map((m) => this.personName(m.employee)).join(', '),
        to: names(change.employeeIds),
      });
    }
    const currentTasks = request.tasks.map((t) => t.name);
    const proposedTasks = change.tasks.map((t) => t.name);
    if (currentTasks.join('|') !== proposedTasks.join('|')) {
      rows.push({ field: 'Tasks', from: currentTasks.join(', '), to: proposedTasks.join(', ') });
    }
    return rows;
  }

  private run(request$: any, success: string, after?: () => void): void {
    this.isWorking.set(true);
    request$.subscribe({
      next: () => {
        this.isWorking.set(false);
        this.toast.success(success);
        after?.();
        this.load();
      },
      error: (err: any) => {
        this.isWorking.set(false);
        // The server's refusals are the useful ones here — a roster clash names
        // the person and the day, and replacing that with "failed" throws away
        // the only part anybody can act on.
        this.toast.error(this.messageOf(err), { duration: 9000 });
      },
    });
  }

  back(): void {
    this.router.navigate(['/field-visits/requests']);
  }

  private messageOf(err: any): string {
    const message = err?.error?.message;
    if (Array.isArray(message)) return message.join(', ');
    return message || 'Something went wrong. Try again in a moment.';
  }
}
