import { Component, OnChanges, computed, inject, input, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HotToastService } from '@ngneat/hot-toast';
import { DialogService } from '../../services/dialog.service';
import {
  TaskLocationsService, TaskLocation, IssueLocations, IssueLocationRow, LocationActivity,
  LocationStatus, LOCATION_STATUS_LABEL, locationLabel,
} from '../../../services/task-locations.service';
import { LocationPickerComponent } from './location-picker';

export interface PanelPerson { id: number; firstName: string; lastName?: string | null }

/**
 * "Location Progress" in the task details modal: one row per location the
 * task is carried out at, each with its own status, people, dates, time,
 * remarks, evidence and history. Renders nothing for a task without
 * locations unless the viewer can add some.
 */
@Component({
  selector: 'app-task-location-panel',
  standalone: true,
  imports: [DatePipe, LocationPickerComponent],
  template: `
    @if (data(); as d) {
      @if (d.locations.length || d.canManage) {
        <section class="tlp">
          <header class="tlp-head">
            <h4>Location Progress</h4>
            @if (d.canManage) {
              <button type="button" class="tlp-btn" (click)="adding.set(!adding())">{{ adding() ? 'Cancel' : '+ Add locations' }}</button>
            }
          </header>

          @if (d.progress.total) {
            <div class="tlp-overall">
              <div class="tlp-bar"><span [style.width.%]="d.progress.percent"></span></div>
              <div class="tlp-counts">
                <strong>{{ d.progress.completed }}/{{ d.progress.total }}</strong> completed ({{ d.progress.percent }}%)
                · {{ d.progress.inProgress }} in progress · {{ d.progress.notStarted }} not started
                @if (d.progress.blocked) { · <span class="bad">{{ d.progress.blocked }} blocked</span> }
                @if (d.progress.overdue) { · <span class="bad">{{ d.progress.overdue }} overdue</span> }
              </div>
            </div>
          }

          @if (adding()) {
            <div class="tlp-add">
              <app-location-picker [locations]="addable()" [(selected)]="addIds" />
              <div class="tlp-row-form">
                <label>Assign to
                  <select multiple size="3" (change)="addAssignees = selectedValues($event)">
                    @for (p of people(); track p.id) { <option [value]="p.id">{{ p.firstName }} {{ p.lastName }}</option> }
                  </select>
                </label>
                <label>Due date <input type="date" (change)="addDue = $any($event.target).value" /></label>
                <button type="button" class="tlp-btn primary" [disabled]="!addIds().length || busy()" (click)="add()">
                  Add {{ addIds().length || '' }} location{{ addIds().length === 1 ? '' : 's' }}
                </button>
              </div>
            </div>
          }

          @if (d.locations.length) {
            <div class="tlp-filters">
              <input type="search" placeholder="Search locations" [value]="search()" (input)="search.set($any($event.target).value)" />
              <select [value]="statusFilter()" (change)="statusFilter.set($any($event.target).value)">
                <option value="">All statuses</option>
                @for (s of statuses; track s) { <option [value]="s">{{ label[s] }}</option> }
                <option value="OVERDUE">Overdue</option>
                <option value="REMOVED">Removed</option>
              </select>
            </div>
          }

          <div class="tlp-rows">
            @for (r of shown(); track r.id) {
              <div class="tlp-loc" [class.open]="openId() === r.id" [class.removed]="!!r.removedAt">
                <button type="button" class="tlp-summary" (click)="toggleOpen(r)">
                  <span class="tlp-name">{{ name(r) }}</span>
                  <span class="tlp-who">{{ assigneeNames(r) }}</span>
                  @if (r.dueDate) { <span class="tlp-date" [class.bad]="r.overdue">due {{ r.dueDate | date: 'd MMM' }}</span> }
                  @if (r.removedAt) { <span class="pill removed">Removed</span> }
                  @else { <span class="pill" [class]="'pill ' + r.status">{{ label[r.status] }}</span> }
                </button>

                @if (openId() === r.id) {
                  <div class="tlp-body">
                    @if (r.removedAt) {
                      <p class="muted">Removed from the task. Its time, files and history are kept.</p>
                    } @else {
                      <div class="tlp-grid">
                        <label>Status
                          <select [value]="r.status" [disabled]="!r.canUpdate || busy()" (change)="setStatus(r, $any($event.target).value)">
                            @for (s of statuses; track s) { <option [value]="s">{{ label[s] }}</option> }
                          </select>
                        </label>
                        <label>Start
                          <input type="date" [value]="day(r.startDate)" [disabled]="!d.canManage" (change)="patch(r, { startDate: $any($event.target).value || null })" />
                        </label>
                        <label>Due
                          <input type="date" [value]="day(r.dueDate)" [disabled]="!d.canManage" (change)="patch(r, { dueDate: $any($event.target).value || null })" />
                        </label>
                        <div class="tlp-stat">Logged <strong>{{ hours(r.loggedMinutes) }}</strong> · {{ r._count.attachments }} file{{ r._count.attachments === 1 ? '' : 's' }}</div>
                      </div>
                      @if (r.status === 'BLOCKED' && r.blockedReason) { <p class="bad">Blocked: {{ r.blockedReason }}</p> }
                      @if (r.completedAt) { <p class="muted">Completed {{ r.completedAt | date: 'd MMM y, h:mm a' }}</p> }

                      @if (d.canManage) {
                        <label class="tlp-full">Assignees
                          <select multiple size="3" (change)="patch(r, { assigneeIds: selectedValues($event) })">
                            @for (p of people(); track p.id) {
                              <option [value]="p.id" [selected]="hasAssignee(r, p.id)">{{ p.firstName }} {{ p.lastName }}</option>
                            }
                          </select>
                        </label>
                      }

                      <label class="tlp-full">Remarks
                        <textarea rows="2" [value]="r.remarks ?? ''" [disabled]="!r.canUpdate" #remarks></textarea>
                      </label>
                      @if (r.canUpdate) {
                        <div class="tlp-actions">
                          <button type="button" class="tlp-btn" (click)="patch(r, { remarks: remarks.value })">Save remarks</button>
                          @if (r.status !== 'COMPLETED') {
                            <button type="button" class="tlp-btn primary" (click)="setStatus(r, 'COMPLETED')">Mark complete</button>
                          }
                          @if (d.canManage) {
                            <button type="button" class="tlp-btn danger" (click)="remove(r)">Remove</button>
                          }
                        </div>

                        <div class="tlp-inline">
                          <input type="number" min="0.25" step="0.25" placeholder="Hours" #h />
                          <input type="date" [value]="today" #logDate />
                          <input type="text" placeholder="What was done" #note />
                          <button type="button" class="tlp-btn" (click)="logTime(r, h.value, note.value, logDate.value); h.value=''; note.value=''">Log time</button>
                        </div>
                        <div class="tlp-inline">
                          <input type="text" placeholder="Add a comment" #c (keydown.enter)="comment(r, c.value); c.value=''" />
                          <button type="button" class="tlp-btn" (click)="comment(r, c.value); c.value=''">Comment</button>
                          <label class="tlp-btn file">Upload evidence
                            <input type="file" multiple hidden (change)="upload(r, $event)" />
                          </label>
                        </div>
                      }
                    }

                    <div class="tlp-history">
                      <h5>History</h5>
                      @for (f of evidence(); track f.id) {
                        <div class="tlp-ev"><a [href]="f.fileUrl" target="_blank" rel="noopener">{{ f.fileName }}</a>
                          <span class="muted">{{ f.uploader?.firstName }} · {{ f.createdAt | date: 'd MMM, h:mm a' }}</span></div>
                      }
                      @for (a of history(); track a.id) {
                        <div class="tlp-act">
                          <span class="muted">{{ a.createdAt | date: 'd MMM, h:mm a' }}</span>
                          <strong>{{ a.actor.firstName }}</strong> {{ describe(a) }}
                        </div>
                      } @empty { <p class="muted">Nothing yet.</p> }
                    </div>
                  </div>
                }
              </div>
            } @empty {
              @if (d.locations.length) { <p class="muted">No locations match.</p> }
              @else { <p class="muted">This task is not tracked by location. Add locations to track each one separately.</p> }
            }
          </div>
        </section>
      }
    }
  `,
  styles: [`
    .tlp { border: 1px solid #E2E8F0; border-radius: 12px; padding: 14px; margin: 16px 0; background: #fff; }
    .tlp-head { display: flex; justify-content: space-between; align-items: center; }
    .tlp-head h4 { margin: 0; font-size: 14px; font-weight: 700; color: #0F172A; }
    .tlp-overall { margin: 10px 0; }
    .tlp-bar { height: 8px; border-radius: 999px; background: #E2E8F0; overflow: hidden; }
    .tlp-bar span { display: block; height: 100%; background: #16A34A; transition: width .3s; }
    .tlp-counts { font-size: 12px; color: #475569; margin-top: 6px; }
    .bad { color: #DC2626; }
    .muted { color: #64748B; font-size: 12px; }
    .tlp-btn { border: 1px solid #CBD5E1; background: #fff; border-radius: 8px; padding: 5px 10px; font-size: 12px; font-weight: 600; cursor: pointer; color: #1E293B; white-space: nowrap; }
    .tlp-btn.primary { background: var(--color-primary, #1373E5); border-color: transparent; color: #fff; }
    .tlp-btn.danger { color: #DC2626; border-color: #FECACA; }
    .tlp-btn:disabled { opacity: .5; cursor: default; }
    .tlp-btn.file { display: inline-flex; align-items: center; }
    .tlp-add { margin: 10px 0; display: grid; gap: 8px; }
    .tlp-row-form, .tlp-grid { display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-end; }
    .tlp-row-form label, .tlp-grid label, .tlp-full { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #475569; }
    .tlp-full { margin-top: 8px; }
    select, input, textarea { font: inherit; font-size: 13px; padding: 6px 8px; border: 1px solid #E2E8F0; border-radius: 8px; }
    .tlp-filters { display: flex; gap: 8px; margin: 10px 0 6px; }
    .tlp-filters input { flex: 1; min-width: 0; }
    .tlp-rows { display: grid; gap: 6px; }
    .tlp-loc { border: 1px solid #F1F5F9; border-radius: 10px; }
    .tlp-loc.open { border-color: #CBD5E1; }
    .tlp-loc.removed { opacity: .65; }
    .tlp-summary { width: 100%; display: flex; gap: 10px; align-items: center; padding: 8px 10px; background: none; border: none; cursor: pointer; text-align: left; font-size: 13px; }
    .tlp-name { font-weight: 600; color: #0F172A; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tlp-who, .tlp-date { color: #64748B; font-size: 12px; white-space: nowrap; }
    .pill { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: #F1F5F9; color: #475569; white-space: nowrap; }
    .pill.IN_PROGRESS, .pill.IN_REVIEW { background: #DBEAFE; color: #1D4ED8; }
    .pill.COMPLETED { background: #DCFCE7; color: #15803D; }
    .pill.BLOCKED { background: #FEE2E2; color: #B91C1C; }
    .tlp-body { padding: 4px 12px 12px; border-top: 1px solid #F1F5F9; }
    .tlp-stat { font-size: 12px; color: #475569; padding-bottom: 8px; }
    .tlp-actions, .tlp-inline { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; align-items: center; }
    .tlp-inline input[type=text] { flex: 1; min-width: 140px; }
    .tlp-inline input[type=number] { width: 80px; }
    .tlp-history { margin-top: 12px; }
    .tlp-history h5 { margin: 0 0 6px; font-size: 12px; color: #334155; }
    .tlp-act, .tlp-ev { font-size: 12px; color: #334155; padding: 3px 0; display: flex; gap: 6px; flex-wrap: wrap; }
  `],
})
export class TaskLocationPanelComponent implements OnChanges {
  private api = inject(TaskLocationsService);
  private toast = inject(HotToastService);
  private dialog = inject(DialogService);

  projectId = input.required<number>();
  issueId = input.required<number>();
  /** Who can be put on a location — the project's people. */
  people = input<PanelPerson[]>([]);
  /** Fired after any change, so the board can refresh the card. */
  changed = output<IssueLocations>();

  data = signal<IssueLocations | null>(null);
  master = signal<TaskLocation[]>([]);
  busy = signal(false);
  adding = signal(false);
  addIds = signal<number[]>([]);
  addAssignees: number[] = [];
  addDue = '';
  search = signal('');
  statusFilter = signal('');
  openId = signal<number | null>(null);
  history = signal<LocationActivity[]>([]);
  evidence = signal<any[]>([]);

  readonly statuses: LocationStatus[] = ['NOT_STARTED', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'COMPLETED'];
  readonly label = LOCATION_STATUS_LABEL;
  readonly today = new Date().toISOString().slice(0, 10);

  ngOnChanges() { this.load(); }

  load() {
    this.api.forIssue(this.projectId(), this.issueId()).subscribe({
      next: (d) => {
        this.data.set(d);
        if (d.canManage && !this.master().length) this.api.list(true).subscribe((m) => this.master.set(m));
      },
      error: () => this.data.set(null),
    });
  }

  /** Active master locations not already (actively) on the task. */
  addable = computed(() => {
    const on = new Set((this.data()?.locations ?? []).filter((l) => !l.removedAt).map((l) => l.locationId));
    return this.master().filter((m) => !on.has(m.id));
  });

  shown = computed(() => {
    const q = this.search().trim().toLowerCase();
    const f = this.statusFilter();
    return (this.data()?.locations ?? []).filter((r) => {
      if (f === 'REMOVED') { if (!r.removedAt) return false; }
      else if (r.removedAt && f) return false;
      else if (f === 'OVERDUE') { if (!r.overdue) return false; }
      else if (f && r.status !== f) return false;
      return !q || this.name(r).toLowerCase().includes(q) || this.assigneeNames(r).toLowerCase().includes(q);
    });
  });

  name(r: IssueLocationRow) { return locationLabel(r.location); }
  assigneeNames(r: IssueLocationRow) {
    return r.assignees.map((a) => a.employee.firstName).join(', ');
  }
  hasAssignee(r: IssueLocationRow, id: number) { return r.assignees.some((a) => a.employeeId === id); }
  day(d: string | null) { return d ? d.slice(0, 10) : ''; }
  hours(min = 0) { return `${Math.round((min / 60) * 100) / 100}h`; }
  selectedValues(e: Event): number[] {
    return Array.from((e.target as HTMLSelectElement).selectedOptions).map((o) => Number(o.value));
  }

  toggleOpen(r: IssueLocationRow) {
    if (this.openId() === r.id) { this.openId.set(null); return; }
    this.openId.set(r.id);
    this.loadHistory(r);
  }

  private loadHistory(r: IssueLocationRow) {
    this.history.set([]);
    this.evidence.set([]);
    this.api.activity(this.projectId(), this.issueId(), r.id).subscribe((h) => {
      this.history.set(h.activity);
      this.evidence.set(h.evidence);
    });
  }

  private apply(obs: any, ok?: string, row?: IssueLocationRow) {
    this.busy.set(true);
    obs.subscribe({
      next: (d: IssueLocations) => {
        this.busy.set(false);
        if (d && 'locations' in d) { this.data.set(d); this.changed.emit(d); }
        else this.load();
        if (ok) this.toast.success(ok);
        if (row && this.openId() === row.id) this.loadHistory(row);
      },
      error: (e: any) => {
        this.busy.set(false);
        this.toast.error(e?.error?.message || 'That did not save.');
        this.load();
      },
    });
  }

  add() {
    this.apply(this.api.add(this.projectId(), this.issueId(), {
      locationIds: this.addIds(), assigneeIds: this.addAssignees, dueDate: this.addDue || null,
    }), 'Locations added');
    this.addIds.set([]);
    this.adding.set(false);
  }

  async setStatus(r: IssueLocationRow, status: LocationStatus) {
    const body: any = { status };
    if (status === 'BLOCKED') {
      const reason = await this.dialog.prompt('What is blocking this location?', 'Location blocked', { required: true, confirmLabel: 'Mark blocked' });
      if (!reason?.trim()) { this.load(); return; }
      body.blockedReason = reason.trim();
    }
    this.apply(this.api.updateRow(this.projectId(), this.issueId(), r.id, body), undefined, r);
  }

  patch(r: IssueLocationRow, body: any) {
    this.apply(this.api.updateRow(this.projectId(), this.issueId(), r.id, body), 'Saved', r);
  }

  async remove(r: IssueLocationRow) {
    const ok = await this.dialog.confirm(
      `Remove ${this.name(r)} from this task? If work was recorded there, its time, files and history are kept.`,
      'Remove location', 'Remove', 'Cancel', 'danger');
    if (!ok) return;
    this.apply(this.api.removeRow(this.projectId(), this.issueId(), r.id), 'Location removed');
  }

  logTime(r: IssueLocationRow, hours: string, note: string, date: string) {
    const durationMin = Math.round(Number(hours) * 60);
    if (!durationMin || durationMin <= 0) { this.toast.error('Enter the hours spent.'); return; }
    this.apply(this.api.logTime(this.projectId(), this.issueId(), r.id, { durationMin, note, date }), 'Time logged', r);
  }

  comment(r: IssueLocationRow, body: string) {
    if (!body.trim()) return;
    this.api.comment(this.projectId(), this.issueId(), r.id, body.trim()).subscribe({
      next: () => this.loadHistory(r),
      error: (e) => this.toast.error(e?.error?.message || 'Comment not saved.'),
    });
  }

  upload(r: IssueLocationRow, e: Event) {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (!files.length) return;
    this.busy.set(true);
    this.api.uploadToTask(this.projectId(), this.issueId(), files).subscribe({
      next: (res) => {
        const ids = (Array.isArray(res) ? res : [res]).map((a: any) => a.id);
        this.apply(this.api.linkEvidence(this.projectId(), this.issueId(), r.id, ids), 'Evidence uploaded', r);
      },
      error: (err) => { this.busy.set(false); this.toast.error(err?.error?.message || 'Upload failed.'); },
    });
  }

  describe(a: LocationActivity): string {
    switch (a.action) {
      case 'ADDED': return 'added this location';
      case 'REMOVED': return 'removed this location';
      case 'RESTORED': return 'added this location back';
      case 'ASSIGNED': return `assigned ${a.personName ?? 'someone'}`;
      case 'UNASSIGNED': return `unassigned ${a.personName ?? 'someone'}`;
      case 'STATUS_CHANGED':
        return `moved it from ${this.label[a.oldValue as LocationStatus] ?? a.oldValue} to ${this.label[a.newValue as LocationStatus] ?? a.newValue}`
          + (a.body ? ` — ${a.body}` : '');
      case 'COMMENT': return `commented: ${a.body}`;
      case 'TIME_LOGGED': return `logged ${this.hours(Number(a.newValue))}${a.body ? ` — ${a.body}` : ''}`;
      case 'EVIDENCE_ADDED': return `added evidence: ${a.body}`;
      case 'UPDATED': return `changed ${a.field === 'blockedReason' ? 'the block reason' : a.field} to ${a.newValue || '(empty)'}`;
      default: return a.action.toLowerCase();
    }
  }
}
