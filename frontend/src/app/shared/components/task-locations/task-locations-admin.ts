import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { HotToastService } from '@ngneat/hot-toast';
import { DialogService } from '../../services/dialog.service';
import { TaskLocationsService, TaskLocation } from '../../../services/task-locations.service';

/**
 * Master Data → Task Locations: the state / city / site hierarchy tasks are
 * carried out at. Bulk add takes one name per line, so seventeen states is
 * one paste. A location tasks already used is disabled rather than deleted.
 */
@Component({
  selector: 'app-task-locations-admin',
  standalone: true,
  template: `
    <div class="tla">
      <div class="tla-add">
        <h3>Add locations</h3>
        <div class="tla-form">
          <label>Level
            <select [value]="level()" (change)="level.set($any($event.target).value); parentId.set(null)">
              <option value="STATE">State</option>
              <option value="CITY">City</option>
              <option value="SITE">Site</option>
            </select>
          </label>
          @if (level() !== 'STATE') {
            <label>Inside
              <select [value]="parentId() ?? ''" (change)="parentId.set(+$any($event.target).value || null)">
                <option value="">Choose…</option>
                @for (p of parentOptions(); track p.id) { <option [value]="p.id">{{ pathOf(p) }}</option> }
              </select>
            </label>
          }
          <label class="grow">Names, one per line
            <textarea rows="4" [value]="names()" (input)="names.set($any($event.target).value)"
              placeholder="Maharashtra&#10;Gujarat&#10;Karnataka"></textarea>
          </label>
          <button type="button" class="btn-primary" [disabled]="busy() || !names().trim() || (level() !== 'STATE' && !parentId())" (click)="bulkAdd()">Add</button>
        </div>
      </div>

      <div class="tla-tools">
        <input type="search" placeholder="Search locations" [value]="query()" (input)="query.set($any($event.target).value)" />
        <label><input type="checkbox" [checked]="showInactive()" (change)="showInactive.set(!showInactive())" /> Show disabled</label>
        <span class="muted">{{ all().length }} locations</span>
      </div>

      <table class="tla-table">
        <thead><tr><th>Name</th><th>Level</th><th>Code</th><th>Used by</th><th>Active</th><th></th></tr></thead>
        <tbody>
          @for (r of rows(); track r.loc.id) {
            <tr [class.off]="!r.loc.isActive">
              <td [style.padding-left.px]="12 + r.depth * 20">
                @if (editingId() === r.loc.id) {
                  <input [value]="r.loc.name" #n (keydown.enter)="rename(r.loc, n.value)" (blur)="rename(r.loc, n.value)" />
                } @else {
                  <span (dblclick)="editingId.set(r.loc.id)">{{ r.loc.name }}</span>
                }
              </td>
              <td>{{ r.loc.level.toLowerCase() }}</td>
              <td><input class="code" [value]="r.loc.code ?? ''" (change)="save(r.loc, { code: $any($event.target).value })" /></td>
              <td>{{ r.loc.usageCount || 0 }} task{{ r.loc.usageCount === 1 ? '' : 's' }}</td>
              <td><input type="checkbox" [checked]="r.loc.isActive" (change)="save(r.loc, { isActive: !r.loc.isActive })" /></td>
              <td class="act">
                <button type="button" class="link" (click)="editingId.set(r.loc.id)">Rename</button>
                <button type="button" class="link danger" (click)="remove(r.loc)">Delete</button>
              </td>
            </tr>
          } @empty {
            <tr><td colspan="6" class="muted">No locations yet. Add your states above, then cities and sites inside them.</td></tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styles: [`
    .tla { display: grid; gap: 16px; padding: 4px 0; }
    .tla-add { background: #fff; border: 1px solid #E2E8F0; border-radius: 14px; padding: 16px; }
    .tla-add h3 { margin: 0 0 10px; font-size: 15px; }
    .tla-form { display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-end; }
    .tla-form label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #475569; }
    .tla-form .grow { flex: 1; min-width: 220px; }
    select, input, textarea { font: inherit; font-size: 13px; padding: 7px 10px; border: 1px solid #E2E8F0; border-radius: 8px; }
    .tla-tools { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; font-size: 13px; }
    .tla-tools input[type=search] { min-width: 220px; }
    .muted { color: #64748B; font-size: 12px; }
    .tla-table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 14px; overflow: hidden; font-size: 13px; }
    .tla-table th { text-align: left; background: #F8FAFC; padding: 10px 12px; font-weight: 700; color: #1E293B; }
    .tla-table td { padding: 8px 12px; border-top: 1px solid #F1F5F9; color: #334155; }
    .tla-table tr.off td { color: #94A3B8; }
    .code { width: 90px; padding: 4px 8px; }
    .act { white-space: nowrap; text-align: right; }
    .link { background: none; border: none; color: var(--color-primary, #1373E5); cursor: pointer; font-weight: 600; font-size: 12px; }
    .link.danger { color: #DC2626; }
  `],
})
export class TaskLocationsAdminComponent implements OnInit {
  private api = inject(TaskLocationsService);
  private toast = inject(HotToastService);
  private dialog = inject(DialogService);

  all = signal<TaskLocation[]>([]);
  level = signal<'STATE' | 'CITY' | 'SITE'>('STATE');
  parentId = signal<number | null>(null);
  names = signal('');
  query = signal('');
  showInactive = signal(true);
  busy = signal(false);
  editingId = signal<number | null>(null);

  ngOnInit() { this.load(); }

  load() {
    this.api.list(false).subscribe({
      next: (l) => this.all.set(l),
      error: () => this.toast.error('Could not load task locations.'),
    });
  }

  private byId = computed(() => new Map(this.all().map((l) => [l.id, l])));

  pathOf(l: TaskLocation): string {
    const parts = [l.name];
    let p = l.parentId != null ? this.byId().get(l.parentId) : undefined;
    while (p) { parts.push(p.name); p = p.parentId != null ? this.byId().get(p.parentId) : undefined; }
    return parts.join(' › ');
  }

  /** A city sits in a state; a site in a city (or straight in a state). */
  parentOptions = computed(() => this.all().filter((l) =>
    l.isActive && (this.level() === 'CITY' ? l.level === 'STATE' : l.level !== 'SITE')));

  rows = computed(() => {
    const q = this.query().trim().toLowerCase();
    const list = this.all().filter((l) => this.showInactive() || l.isActive);
    const ids = new Set(list.map((l) => l.id));
    const out: { loc: TaskLocation; depth: number }[] = [];
    const walk = (parent: number | null, depth: number) => {
      for (const l of list.filter((x) => (parent == null ? x.parentId == null || !ids.has(x.parentId) : x.parentId === parent))) {
        out.push({ loc: l, depth });
        walk(l.id, depth + 1);
      }
    };
    walk(null, 0);
    return q ? out.filter((r) => this.pathOf(r.loc).toLowerCase().includes(q)) : out;
  });

  bulkAdd() {
    const names = this.names().split('\n').map((n) => n.trim()).filter(Boolean);
    this.busy.set(true);
    this.api.bulkCreate({ names, level: this.level(), parentId: this.parentId() }).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.names.set('');
        this.toast.success(`${r.created} added${r.skipped ? `, ${r.skipped} already existed` : ''}`);
        this.load();
      },
      error: (e) => { this.busy.set(false); this.toast.error(e?.error?.message || 'Could not add.'); },
    });
  }

  save(l: TaskLocation, data: Partial<TaskLocation>) {
    this.api.update(l.id, data).subscribe({
      next: () => this.load(),
      error: (e) => { this.toast.error(e?.error?.message || 'Could not save.'); this.load(); },
    });
  }

  rename(l: TaskLocation, name: string) {
    this.editingId.set(null);
    if (name.trim() && name.trim() !== l.name) this.save(l, { name: name.trim() });
  }

  async remove(l: TaskLocation) {
    const ok = await this.dialog.confirm(
      `Delete ${l.name} and everything inside it? Locations tasks already use are disabled instead.`,
      'Delete location', 'Delete', 'Cancel', 'danger');
    if (!ok) return;
    this.api.remove(l.id).subscribe({
      next: (r) => { this.toast.success(r.deleted ? 'Deleted' : (r.message || 'Disabled')); this.load(); },
      error: (e) => this.toast.error(e?.error?.message || 'Could not delete.'),
    });
  }
}
