import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import {
  TaskLocationsService, TaskLocation, IssueLocationRow, LocationReportRow,
  LOCATION_STATUS_LABEL, LocationStatus, locationLabel,
} from '../../../services/task-locations.service';

/**
 * Tasks → By location. Every location of every task the viewer can see as
 * its own row, filterable by state, city, location, status and person; and a
 * report per parent task of what is completed, pending, overdue and blocked.
 */
@Component({
  selector: 'app-location-executions',
  standalone: true,
  imports: [DatePipe],
  template: `
    <div class="lx">
      <div class="lx-tabs">
        <button type="button" [class.on]="mode() === 'list'" (click)="mode.set('list')">Executions</button>
        <button type="button" [class.on]="mode() === 'report'" (click)="mode.set('report')">Location report</button>
      </div>

      <div class="lx-filters">
        <input type="search" placeholder="Search task or location" [value]="search()" (input)="search.set($any($event.target).value); reload()" />
        <select [value]="stateId() ?? ''" (change)="stateId.set(+$any($event.target).value || null); cityId.set(null); locationId.set(null); reload()">
          <option value="">All states</option>
          @for (s of states(); track s.id) { <option [value]="s.id">{{ s.name }}</option> }
        </select>
        <select [value]="cityId() ?? ''" [disabled]="!cities().length" (change)="cityId.set(+$any($event.target).value || null); locationId.set(null); reload()">
          <option value="">All cities</option>
          @for (c of cities(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }
        </select>
        <select [value]="locationId() ?? ''" [disabled]="!sites().length" (change)="locationId.set(+$any($event.target).value || null); reload()">
          <option value="">All sites</option>
          @for (c of sites(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }
        </select>
        @if (mode() === 'list') {
          <select [value]="status()" (change)="status.set($any($event.target).value); reload()">
            <option value="">All statuses</option>
            <option value="PENDING">Pending (not completed)</option>
            @for (s of statuses; track s) { <option [value]="s">{{ label[s] }}</option> }
            <option value="OVERDUE">Overdue</option>
          </select>
          <select [value]="assigneeId() ?? ''" (change)="assigneeId.set(+$any($event.target).value || null); reload()">
            <option value="">Anyone</option>
            @for (p of people(); track p.id) { <option [value]="p.id">{{ p.name }}</option> }
          </select>
        }
      </div>

      @if (loading()) {
        <p class="muted">Loading…</p>
      } @else if (mode() === 'list') {
        <div class="lx-summary muted">{{ rows().length }} location{{ rows().length === 1 ? '' : 's' }}
          · {{ countOf('COMPLETED') }} completed · {{ overdueCount() }} overdue · {{ countOf('BLOCKED') }} blocked</div>
        <div class="lx-table-wrap">
          <table class="lx-table">
            <thead><tr><th>Task</th><th>Location</th><th>Status</th><th>Assignees</th><th>Due</th><th>Completed</th></tr></thead>
            <tbody>
              @for (r of rows(); track r.id) {
                <tr (click)="open(r)">
                  <td><span class="key">{{ r.issue?.key }}</span> {{ r.issue?.title }}
                    <div class="muted">{{ r.issue?.project?.name }}</div></td>
                  <td>{{ name(r) }}</td>
                  <td><span [class]="'pill ' + r.status">{{ label[r.status] }}</span>
                    @if (r.status === 'BLOCKED' && r.blockedReason) { <div class="muted bad">{{ r.blockedReason }}</div> }</td>
                  <td>{{ who(r) || '—' }}</td>
                  <td [class.bad]="r.overdue">{{ r.dueDate ? (r.dueDate | date: 'd MMM y') : '—' }}</td>
                  <td>{{ r.completedAt ? (r.completedAt | date: 'd MMM y') : '' }}</td>
                </tr>
              } @empty {
                <tr><td colspan="6" class="muted">No task locations match these filters.</td></tr>
              }
            </tbody>
          </table>
        </div>
      } @else {
        <div class="lx-table-wrap">
          <table class="lx-table">
            <thead><tr><th>Task</th><th>Progress</th><th>Completed</th><th>Pending</th><th>Overdue</th><th>Blocked</th><th>Pending at</th></tr></thead>
            <tbody>
              @for (r of report(); track r.issue?.id) {
                <tr (click)="openIssue(r.issue)">
                  <td><span class="key">{{ r.issue?.key }}</span> {{ r.issue?.title }}
                    <div class="muted">{{ r.issue?.project?.name }}</div></td>
                  <td class="prog"><div class="bar"><span [style.width.%]="r.percent"></span></div>{{ r.completed }}/{{ r.total }}</td>
                  <td>{{ r.completed }}</td>
                  <td>{{ r.pending }}</td>
                  <td [class.bad]="r.overdue">{{ r.overdue }}</td>
                  <td [class.bad]="r.blocked">{{ r.blocked }}</td>
                  <td class="muted pend">{{ r.pendingLocations.join(', ') }}</td>
                </tr>
              } @empty {
                <tr><td colspan="7" class="muted">No location-tracked tasks match these filters.</td></tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
  styles: [`
    .lx { background: #fff; border: 1px solid #E2E8F0; border-radius: 16px; padding: 16px; margin-top: 16px; }
    .lx-tabs { display: flex; gap: 4px; margin-bottom: 12px; }
    .lx-tabs button { border: 1px solid #E2E8F0; background: #fff; border-radius: 999px; padding: 6px 14px; font-size: 13px; font-weight: 600; cursor: pointer; color: #475569; }
    .lx-tabs button.on { background: var(--color-primary, #1373E5); border-color: transparent; color: #fff; }
    .lx-filters { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
    .lx-filters input { flex: 1; min-width: 180px; }
    select, input { font: inherit; font-size: 13px; padding: 7px 10px; border: 1px solid #E2E8F0; border-radius: 8px; background: #fff; max-width: 100%; }
    .muted { color: #64748B; font-size: 12px; }
    .bad { color: #DC2626; }
    .lx-summary { margin-bottom: 8px; }
    .lx-table-wrap { overflow-x: auto; }
    .lx-table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 720px; }
    .lx-table th { text-align: left; background: #F8FAFC; padding: 10px; font-weight: 700; color: #1E293B; white-space: nowrap; }
    .lx-table td { padding: 9px 10px; border-top: 1px solid #F1F5F9; color: #334155; vertical-align: top; }
    .lx-table tbody tr { cursor: pointer; }
    .lx-table tbody tr:hover td { background: #F8FAFC; }
    .key { font-weight: 700; color: #1E40AF; margin-right: 4px; }
    .pill { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: #F1F5F9; color: #475569; white-space: nowrap; }
    .pill.IN_PROGRESS, .pill.IN_REVIEW { background: #DBEAFE; color: #1D4ED8; }
    .pill.COMPLETED { background: #DCFCE7; color: #15803D; }
    .pill.BLOCKED { background: #FEE2E2; color: #B91C1C; }
    .prog { min-width: 120px; }
    .bar { height: 6px; background: #E2E8F0; border-radius: 999px; overflow: hidden; margin-bottom: 3px; }
    .bar span { display: block; height: 100%; background: #16A34A; }
    .pend { max-width: 280px; }
  `],
})
export class LocationExecutionsComponent implements OnInit {
  private api = inject(TaskLocationsService);
  private router = inject(Router);

  mode = signal<'list' | 'report'>('list');
  master = signal<TaskLocation[]>([]);
  rows = signal<IssueLocationRow[]>([]);
  report = signal<LocationReportRow[]>([]);
  loading = signal(false);
  search = signal('');
  stateId = signal<number | null>(null);
  cityId = signal<number | null>(null);
  locationId = signal<number | null>(null);
  status = signal('');
  assigneeId = signal<number | null>(null);

  readonly statuses: LocationStatus[] = ['NOT_STARTED', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'COMPLETED'];
  readonly label = LOCATION_STATUS_LABEL;
  private timer: any;

  states = computed(() => this.master().filter((l) => l.parentId == null));
  cities = computed(() => this.stateId() ? this.master().filter((l) => l.parentId === this.stateId()) : []);
  sites = computed(() => {
    const under = this.cityId() ?? this.stateId();
    return under ? this.master().filter((l) => l.parentId === under && l.level === 'SITE') : [];
  });
  /** People who appear on the loaded rows — enough to filter by, no directory call. */
  private seenPeople = signal(new Map<number, string>());
  people = computed(() => [...this.seenPeople()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)));
  overdueCount = computed(() => this.rows().filter((r) => r.overdue).length);

  ngOnInit() {
    this.api.list(false).subscribe((m) => this.master.set(m));
    this.fetch();
  }

  /** Debounced, so typing in the search box is one request, not twelve. */
  reload() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.fetch(), 250);
  }

  private filters() {
    return {
      search: this.search(),
      stateId: this.stateId(),
      cityId: this.cityId(),
      locationId: this.locationId(),
      status: this.status(),
      assigneeId: this.assigneeId(),
    };
  }

  private fetch() {
    this.loading.set(true);
    this.api.executions(this.filters()).subscribe({
      next: (rows) => {
        this.rows.set(rows);
        const seen = new Map(this.seenPeople());
        for (const r of rows) for (const a of r.assignees) seen.set(a.employeeId, `${a.employee.firstName} ${a.employee.lastName ?? ''}`.trim());
        this.seenPeople.set(seen);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
    this.api.report({ ...this.filters(), status: '', assigneeId: null }).subscribe((r) => this.report.set(r));
  }

  countOf(s: LocationStatus) { return this.rows().filter((r) => r.status === s).length; }
  name(r: IssueLocationRow) { return locationLabel(r.location); }
  who(r: IssueLocationRow) { return r.assignees.map((a) => a.employee.firstName).join(', '); }

  open(r: IssueLocationRow) { this.openIssue(r.issue); }
  openIssue(issue: IssueLocationRow['issue']) {
    if (issue) this.router.navigate(['/projects', issue.projectId], { queryParams: { task: issue.id } });
  }
}
