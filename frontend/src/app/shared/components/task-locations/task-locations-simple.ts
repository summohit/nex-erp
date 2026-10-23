import { Component, OnChanges, computed, inject, input, output, signal } from '@angular/core';
import { HotToastService } from '@ngneat/hot-toast';
import { TaskLocationsService, TaskLocation, IssueLocations, locationLabel } from '../../../services/task-locations.service';
import { LocationPickerComponent } from './location-picker';

/**
 * The simple form of task locations, used while per-location tracking is
 * switched off: the task lists the locations it covers, and the project
 * manager can change that list. No per-location status, people or time.
 */
@Component({
  selector: 'app-task-locations-simple',
  standalone: true,
  imports: [LocationPickerComponent],
  template: `
    @if (data(); as d) {
      @if (current().length || d.canManage) {
        @if (!editing()) {
          <!-- One compact line: pin, label, the location, and Change. -->
          <div class="tls-line">
            <svg class="tls-pin" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z" fill="none" stroke="currentColor" stroke-width="2"/>
              <circle cx="12" cy="10" r="2.5" fill="none" stroke="currentColor" stroke-width="2"/>
            </svg>
            <span class="tls-label">Location</span>
            @if (current().length) {
              @for (r of current(); track r.id) { <span class="tls-chip" [title]="label(r)">{{ label(r) }}</span> }
            } @else {
              <span class="tls-empty">Not set</span>
            }
            @if (d.canManage) {
              <button type="button" class="tls-link" (click)="startEdit()">{{ current().length ? 'Change' : 'Add' }}</button>
            }
          </div>
        } @else {
          <section class="tls-edit">
            <app-location-picker [locations]="master()" [(selected)]="picked" [single]="true" />
            <div class="tls-actions">
              @if (!picked().length) { <span class="tls-err">Choose a location.</span> }
              <button type="button" class="tls-btn" (click)="editing.set(false)" [disabled]="busy()">Cancel</button>
              <button type="button" class="tls-btn primary" (click)="save()" [disabled]="busy() || !picked().length">
                {{ busy() ? 'Saving…' : 'Save' }}
              </button>
            </div>
          </section>
        }
      }
    }
  `,
  styles: [`
    .tls-line { display: flex; align-items: center; gap: 8px; margin: 10px 0; min-width: 0; font-size: 13px; }
    .tls-pin { color: #64748B; flex-shrink: 0; }
    .tls-label { font-size: 12px; font-weight: 600; color: #64748B; flex-shrink: 0; }
    .tls-chip { background: #EFF6FF; color: #1E40AF; border-radius: 999px; padding: 2px 10px; font-size: 12px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
    .tls-empty { color: #94A3B8; font-size: 12px; font-style: italic; }
    .tls-link { background: none; border: none; color: var(--color-primary, #1373E5); font-size: 12px; font-weight: 600; cursor: pointer; padding: 2px 4px; flex-shrink: 0; }
    .tls-link:hover { text-decoration: underline; }
    .tls-edit { margin: 10px 0; display: grid; gap: 8px; }
    .tls-actions { display: flex; justify-content: flex-end; align-items: center; gap: 8px; }
    .tls-btn { border: 1px solid #CBD5E1; background: #fff; border-radius: 8px; padding: 5px 12px; font-size: 12px; font-weight: 600; cursor: pointer; color: #1E293B; }
    .tls-btn.primary { background: var(--color-primary, #1373E5); border-color: transparent; color: #fff; }
    .tls-btn:disabled { opacity: .5; cursor: default; }
    .tls-err { margin-right: auto; color: #DC2626; font-size: 12px; }
  `],
})
export class TaskLocationsSimpleComponent implements OnChanges {
  private api = inject(TaskLocationsService);
  private toast = inject(HotToastService);

  projectId = input.required<number>();
  issueId = input.required<number>();
  /** Fired after a save, so the board can refresh the card. */
  changed = output<void>();

  data = signal<IssueLocations | null>(null);
  master = signal<TaskLocation[]>([]);
  editing = signal(false);
  picked = signal<number[]>([]);
  busy = signal(false);

  /** The locations still on the task. */
  current = computed(() => (this.data()?.locations ?? []).filter((r) => !r.removedAt));

  ngOnChanges() {
    this.editing.set(false);
    this.load();
  }

  load() {
    this.api.forIssue(this.projectId(), this.issueId()).subscribe({
      next: (d) => this.data.set(d),
      error: () => this.data.set(null),
    });
  }

  label(r: { location: { name: string; parent?: { name: string } | null } }) {
    return locationLabel(r.location);
  }

  startEdit() {
    this.picked.set(this.current().slice(0, 1).map((r) => r.locationId));
    this.editing.set(true);
    if (!this.master().length) this.api.list(true).subscribe((m) => this.master.set(m));
  }

  /** Replace the task's location with the one picked. */
  save() {
    const id = this.picked()[0];
    if (!id) return;
    if (this.current().length === 1 && this.current()[0].locationId === id) { this.editing.set(false); return; }
    this.busy.set(true);
    this.api.setLocation(this.projectId(), this.issueId(), id).subscribe({
      next: (d) => {
        this.busy.set(false);
        this.editing.set(false);
        this.data.set(d);
        this.toast.success('Location saved');
        this.changed.emit();
      },
      error: (e) => {
        this.busy.set(false);
        this.toast.error(e?.error?.message || 'Location not saved.');
        this.load();
      },
    });
  }
}
