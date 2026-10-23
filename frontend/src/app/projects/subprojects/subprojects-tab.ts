import { Component, computed, inject, input, output, signal } from '@angular/core';
import { Router } from '@angular/router';
import { HotToastService } from '@ngneat/hot-toast';
import { ProjectsService } from '../../services/projects';
import { EmployeeService } from '../../services/employee.service';
import { DialogService } from '../../shared/services/dialog.service';

/**
 * Subprojects of a parent project: ABC holds ABC-A, ABC-B, ABC-C.
 *
 * Everyone who can see the parent sees its subprojects listed; only an
 * administrator creates one, adds an existing project, changes a sub code,
 * detaches one, or switches the parent between separate and shared budgets.
 */
@Component({
  selector: 'app-subprojects-tab',
  standalone: true,
  template: `
    @if (project(); as p) {
      <div class="sp">
        <!-- The parent -->
        <div class="sp-parent">
          <div class="sp-parent-main">
            <svg class="sp-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="none" stroke="currentColor" stroke-width="2"/>
            </svg>
            <div>
              <div class="sp-parent-title">{{ p.key }} — {{ p.name }}</div>
              <div class="sp-sub">Parent project code: {{ p.key }}</div>
            </div>
          </div>
          @if (isAdmin()) {
            <div class="sp-mode" title="How the subprojects' budgets work">
              <span class="sp-mode-label">Budget</span>
              <button type="button" [class.on]="mode() === 'SEPARATE'" (click)="setMode('SEPARATE')" [disabled]="busy()">Separate</button>
              <button type="button" [class.on]="mode() === 'SHARED'" (click)="setMode('SHARED')" [disabled]="busy()">Shared</button>
            </div>
          } @else {
            <span class="sp-mode-ro">{{ mode() === 'SHARED' ? 'Shared budget' : 'Separate budgets' }}</span>
          }
        </div>
        <p class="sp-hint">
          {{ mode() === 'SHARED'
            ? 'Shared: the subprojects spend from ' + p.key + '\\'s budget. Its Summary counts everyone\\'s spend against it.'
            : 'Separate: each subproject has its own budget. ' + p.key + '\\'s Summary shows the combined total.' }}
        </p>

        <!-- The subprojects -->
        @for (c of p.subprojects || []; track c.id) {
          <div class="sp-child">
            <span class="sp-arrow" aria-hidden="true">↳</span>
            <button type="button" class="sp-card" (click)="open(c.id)">
              <div class="sp-card-title">{{ c.key }} — {{ c.name }}</div>
              <div class="sp-card-meta">
                <span>Code: {{ c.key }}</span>
                <span>· {{ c._count?.issues ?? 0 }} task{{ c._count?.issues === 1 ? '' : 's' }}</span>
                @if (pmNames(c)) { <span>· PM: {{ pmNames(c) }}</span> }
                @if (c.workStatus) { <span class="sp-status">{{ c.workStatus.replace('_', ' ').toLowerCase() }}</span> }
              </div>
            </button>
            @if (isAdmin()) {
              <div class="sp-actions">
                <button type="button" class="sp-link" (click)="renameSub(c)">Change code</button>
                <button type="button" class="sp-link danger" (click)="detach(c)">Detach</button>
              </div>
            }
          </div>
        } @empty {
          <p class="sp-empty">No subprojects yet.{{ isAdmin() ? ' Create one, or add an existing project under ' + p.key + '.' : '' }}</p>
        }

        @if (isAdmin()) {
          <div class="sp-add-bar">
            <button type="button" class="sp-btn primary" (click)="openForm('new')">+ New subproject</button>
            <button type="button" class="sp-btn" (click)="openForm('attach')">Add existing project</button>
          </div>

          @if (form() === 'new') {
            <div class="sp-form">
              <h4>New subproject under {{ p.key }}</h4>
              <div class="sp-grid">
                <label>Name <span class="req">*</span>
                  <input [value]="name()" (input)="name.set($any($event.target).value)" placeholder="e.g. Site A rollout" />
                </label>
                <label>Sub code <span class="req">*</span>
                  <input [value]="subCode()" (input)="subCode.set($any($event.target).value.toUpperCase())" placeholder="A" maxlength="10" />
                  <span class="sp-preview">Code: {{ p.key }}-{{ subCode() || '…' }}</span>
                </label>
                <label>Project manager <span class="req">*</span>
                  <select (change)="pmId.set(+$any($event.target).value || null)">
                    <option value="">Choose…</option>
                    @for (e of employees(); track e.id) { <option [value]="e.id">{{ e.firstName }} {{ e.lastName }}</option> }
                  </select>
                </label>
                @if (mode() === 'SEPARATE') {
                  <label>Budget ({{ p.currency || 'INR' }})
                    <input type="number" min="0" [value]="budget() ?? ''" (input)="budget.set($any($event.target).value === '' ? null : +$any($event.target).value)" />
                  </label>
                }
              </div>
              <p class="sp-note">Dates, department, category and client are taken from {{ p.key }}; they can be changed on the subproject afterwards.</p>
              <div class="sp-form-actions">
                <button type="button" class="sp-btn" (click)="form.set(null)" [disabled]="busy()">Cancel</button>
                <button type="button" class="sp-btn primary" (click)="create()" [disabled]="busy() || !name().trim() || !subCode().trim() || !pmId()">
                  {{ busy() ? 'Creating…' : 'Create subproject' }}
                </button>
              </div>
            </div>
          }

          @if (form() === 'attach') {
            <div class="sp-form">
              <h4>Add an existing project under {{ p.key }}</h4>
              <div class="sp-grid">
                <label>Project <span class="req">*</span>
                  <select (change)="attachId.set(+$any($event.target).value || null)">
                    <option value="">Choose…</option>
                    @for (o of attachable(); track o.id) { <option [value]="o.id">{{ o.key }} — {{ o.name }}</option> }
                  </select>
                </label>
                <label>Sub code <span class="req">*</span>
                  <input [value]="subCode()" (input)="subCode.set($any($event.target).value.toUpperCase())" placeholder="B" maxlength="10" />
                  <span class="sp-preview">New code: {{ p.key }}-{{ subCode() || '…' }}</span>
                </label>
              </div>
              <p class="sp-note warn">Its code and every task ID change to the new code, e.g. {{ p.key }}-{{ subCode() || 'B' }}-12. Links keep working; text that quoted an old task ID is not rewritten.</p>
              <div class="sp-form-actions">
                <button type="button" class="sp-btn" (click)="form.set(null)" [disabled]="busy()">Cancel</button>
                <button type="button" class="sp-btn primary" (click)="attach()" [disabled]="busy() || !attachId() || !subCode().trim()">
                  {{ busy() ? 'Adding…' : 'Add as subproject' }}
                </button>
              </div>
            </div>
          }
        }
      </div>
    }
  `,
  styles: [`
    .sp { display: grid; gap: 10px; max-width: 1100px; }
    .sp-parent { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; background: #EEF2FF; border: 1px solid #C7D2FE; border-radius: 14px; padding: 16px 18px; }
    .sp-parent-main { display: flex; gap: 12px; align-items: center; min-width: 0; }
    .sp-icon { color: #4338CA; flex-shrink: 0; }
    .sp-parent-title { font-size: 17px; font-weight: 700; color: #0F172A; }
    .sp-sub { font-size: 13px; color: #475569; margin-top: 2px; }
    .sp-mode { display: inline-flex; align-items: center; gap: 4px; background: #fff; border: 1px solid #E2E8F0; border-radius: 999px; padding: 3px; }
    .sp-mode-label { font-size: 12px; color: #64748B; padding: 0 6px 0 8px; }
    .sp-mode button { border: none; background: none; border-radius: 999px; padding: 5px 12px; font-size: 12px; font-weight: 600; color: #475569; cursor: pointer; }
    .sp-mode button.on { background: var(--color-primary, #1373E5); color: #fff; }
    .sp-mode-ro { font-size: 12px; font-weight: 600; color: #4338CA; background: #fff; border-radius: 999px; padding: 4px 10px; }
    .sp-hint { margin: 0 4px; font-size: 12px; color: #64748B; }
    .sp-child { display: flex; align-items: center; gap: 10px; padding-left: 14px; }
    .sp-arrow { color: #94A3B8; font-size: 18px; }
    .sp-card { flex: 1; min-width: 0; text-align: left; background: #fff; border: 1px solid #E2E8F0; border-radius: 12px; padding: 12px 16px; cursor: pointer; font: inherit; transition: border-color .15s, box-shadow .15s; }
    .sp-card:hover { border-color: #93C5FD; box-shadow: 0 2px 8px rgba(15,23,42,.06); }
    .sp-card-title { font-size: 15px; font-weight: 700; color: #0F172A; }
    .sp-card-meta { display: flex; flex-wrap: wrap; gap: 6px; font-size: 12px; color: #64748B; margin-top: 4px; }
    .sp-status { text-transform: capitalize; background: #F1F5F9; border-radius: 999px; padding: 0 8px; color: #475569; }
    .sp-actions { display: flex; flex-direction: column; gap: 2px; }
    .sp-link { background: none; border: none; color: var(--color-primary, #1373E5); font-size: 12px; font-weight: 600; cursor: pointer; padding: 2px 4px; text-align: right; white-space: nowrap; }
    .sp-link.danger { color: #DC2626; }
    .sp-empty { margin: 4px 14px; font-size: 13px; color: #94A3B8; font-style: italic; }
    .sp-add-bar { display: flex; gap: 8px; padding-left: 14px; margin-top: 4px; }
    .sp-btn { border: 1px solid #CBD5E1; background: #fff; border-radius: 8px; padding: 7px 14px; font-size: 13px; font-weight: 600; cursor: pointer; color: #1E293B; }
    .sp-btn.primary { background: var(--color-primary, #1373E5); border-color: transparent; color: #fff; }
    .sp-btn:disabled { opacity: .5; cursor: default; }
    .sp-form { margin-left: 14px; border: 1px solid #E2E8F0; border-radius: 12px; background: #fff; padding: 14px 16px; display: grid; gap: 10px; }
    .sp-form h4 { margin: 0; font-size: 14px; color: #0F172A; }
    .sp-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
    .sp-grid label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; font-weight: 600; color: #475569; }
    .sp-grid input, .sp-grid select { font: inherit; font-size: 13px; padding: 8px 10px; border: 1px solid #E2E8F0; border-radius: 8px; font-weight: 400; color: #0F172A; }
    .sp-preview { font-size: 11px; font-weight: 600; color: #4338CA; }
    .req { color: #DC2626; }
    .sp-note { margin: 0; font-size: 12px; color: #64748B; }
    .sp-note.warn { color: #B45309; }
    .sp-form-actions { display: flex; justify-content: flex-end; gap: 8px; }
  `],
})
export class SubprojectsTabComponent {
  private api = inject(ProjectsService);
  private employeesApi = inject(EmployeeService);
  private dialog = inject(DialogService);
  private toast = inject(HotToastService);
  private router = inject(Router);

  /** The parent project, as getProjectDetails returns it (with `subprojects`). */
  project = input<any>(null);
  isAdmin = input(false);
  /** Fired after any change, so the page reloads the project. */
  changed = output<void>();

  busy = signal(false);
  form = signal<'new' | 'attach' | null>(null);
  name = signal('');
  subCode = signal('');
  pmId = signal<number | null>(null);
  budget = signal<number | null>(null);
  attachId = signal<number | null>(null);
  employees = signal<any[]>([]);
  allProjects = signal<any[]>([]);

  mode = computed(() => (this.project()?.budgetMode === 'SHARED' ? 'SHARED' : 'SEPARATE'));

  /** Projects that can go under this one: not itself, not already a subproject, not a parent. */
  attachable = computed(() => {
    const me = this.project()?.id;
    const all = this.allProjects();
    const parents = new Set(all.filter((x) => x.parentId).map((x) => x.parentId));
    return all.filter((x) => x.id !== me && !x.parentId && !parents.has(x.id));
  });

  pmNames(c: any): string {
    const pms = (c.members || []).map((m: any) => m.employee?.firstName).filter(Boolean);
    if (pms.length) return pms.join(', ');
    return '';
  }

  open(id: number) {
    this.router.navigate(['/projects', id]);
  }

  openForm(kind: 'new' | 'attach') {
    this.form.set(kind);
    this.name.set('');
    this.subCode.set(this.nextFreeCode());
    this.pmId.set(null);
    this.budget.set(null);
    this.attachId.set(null);
    if (kind === 'new' && !this.employees().length) {
      this.employeesApi.getEmployeesBasicList().subscribe((e: any[]) => this.employees.set(e || []));
    }
    if (kind === 'attach' && !this.allProjects().length) {
      this.api.getProjects().subscribe((p: any) => this.allProjects.set(Array.isArray(p) ? p : []));
    }
  }

  /** The next unused letter, as a starting suggestion: A, then B, then C. */
  private nextFreeCode(): string {
    const used = new Set((this.project()?.subprojects || []).map((c: any) => c.subCode));
    for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') if (!used.has(ch)) return ch;
    return '';
  }

  private run(obs: any, ok: string) {
    this.busy.set(true);
    obs.subscribe({
      next: () => {
        this.busy.set(false);
        this.form.set(null);
        this.toast.success(ok);
        this.changed.emit();
      },
      error: (e: any) => {
        this.busy.set(false);
        this.toast.error(e?.error?.message || 'That did not save.');
      },
    });
  }

  create() {
    const p = this.project();
    this.run(this.api.createSubproject(p.id, {
      name: this.name().trim(), subCode: this.subCode().trim(), pmIds: [this.pmId()!],
      budgetAmount: this.mode() === 'SEPARATE' ? this.budget() : null,
    }), `${p.key}-${this.subCode().trim()} created`);
  }

  async attach() {
    const p = this.project();
    const target = this.allProjects().find((x) => x.id === this.attachId());
    const ok = await this.dialog.confirm(
      `${target?.key} — ${target?.name} becomes ${p.key}-${this.subCode().trim()}, and all its task IDs change with it. Continue?`,
      'Add as subproject', 'Add as subproject', 'Cancel', 'warning');
    if (!ok) return;
    this.run(this.api.attachSubproject(p.id, this.attachId()!, this.subCode().trim()), `${target?.name} is now a subproject`);
  }

  async renameSub(c: any) {
    const code = await this.dialog.prompt(
      `New sub code for ${c.key}. Its code and all its task IDs change to match.`, 'Change sub code',
      { placeholder: c.subCode, confirmLabel: 'Change code', required: true });
    if (!code?.trim()) return;
    this.run(this.api.changeSubCode(c.id, code.trim().toUpperCase()), 'Code changed');
  }

  async detach(c: any) {
    const ok = await this.dialog.confirm(
      `${c.key} — ${c.name} stops being a subproject of ${this.project()?.key}. It keeps its current code and everything on it.`,
      'Detach subproject', 'Detach', 'Cancel', 'danger');
    if (!ok) return;
    this.run(this.api.detachSubproject(c.id), `${c.name} detached`);
  }

  setMode(mode: 'SEPARATE' | 'SHARED') {
    if (mode === this.mode()) return;
    this.run(this.api.setBudgetMode(this.project().id, mode), mode === 'SHARED' ? 'Subprojects now share the budget' : 'Subprojects now have separate budgets');
  }
}
