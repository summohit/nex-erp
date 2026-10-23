import { Component, computed, input, model, signal } from '@angular/core';
import { TaskLocation } from '../../../services/task-locations.service';

interface Group { state: TaskLocation | null; items: { loc: TaskLocation; depth: number }[] }

/**
 * Choose the locations a task is carried out at.
 *
 * Grouped by state, searchable, with the bulk moves a 17-state task needs:
 * everything shown, a whole state with what is under it, or nothing. Selected
 * locations show as chips so the choice stays visible while scrolling.
 */
@Component({
  selector: 'app-location-picker',
  standalone: true,
  template: `
    <div class="lp">
      <div class="lp-bar">
        <input class="lp-search" type="search" placeholder="Search states, cities, sites…"
               [value]="query()" (input)="query.set($any($event.target).value)" />
        <button type="button" class="lp-link" (click)="selectShown()" [disabled]="!shownIds().length">Select all shown</button>
        <button type="button" class="lp-link" (click)="selected.set([])" [disabled]="!selected().length">Clear</button>
      </div>

      @if (selected().length) {
        <div class="lp-chips">
          @for (id of selected(); track id) {
            <span class="lp-chip">{{ nameOf(id) }}
              <button type="button" (click)="toggle(id)" [attr.aria-label]="'Remove ' + nameOf(id)">×</button>
            </span>
          }
        </div>
      }

      <div class="lp-list">
        @for (g of groups(); track g.state?.id ?? 0) {
          <div class="lp-group">
            @if (g.state) {
              <div class="lp-state">
                <label>
                  <input type="checkbox" [checked]="isOn(g.state.id)" (change)="toggle(g.state.id)" />
                  <strong>{{ g.state.name }}</strong>
                </label>
                @if (g.items.length) {
                  <button type="button" class="lp-link" (click)="toggleState(g)">
                    {{ stateFullyOn(g) ? 'Clear state' : 'Whole state' }}
                  </button>
                }
              </div>
            }
            @for (it of g.items; track it.loc.id) {
              <label class="lp-item" [style.padding-left.px]="12 + it.depth * 16">
                <input type="checkbox" [checked]="isOn(it.loc.id)" (change)="toggle(it.loc.id)" />
                {{ it.loc.name }} <span class="lp-level">{{ it.loc.level.toLowerCase() }}</span>
              </label>
            }
          </div>
        } @empty {
          <p class="lp-empty">{{ locations().length ? 'Nothing matches that search.' : 'No locations are set up yet.' }}</p>
        }
      </div>
      <div class="lp-foot">{{ selected().length }} selected</div>
    </div>
  `,
  styles: [`
    .lp { border: 1px solid #E2E8F0; border-radius: 10px; background: #fff; }
    .lp-bar { display: flex; gap: 8px; align-items: center; padding: 8px; border-bottom: 1px solid #F1F5F9; flex-wrap: wrap; }
    .lp-search { flex: 1; min-width: 160px; padding: 7px 10px; border: 1px solid #E2E8F0; border-radius: 8px; font-size: 13px; }
    .lp-link { background: none; border: none; color: var(--color-primary, #1373E5); font-size: 12px; font-weight: 600; cursor: pointer; padding: 4px; }
    .lp-link:disabled { color: #94A3B8; cursor: default; }
    .lp-chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px; border-bottom: 1px solid #F1F5F9; max-height: 96px; overflow: auto; }
    .lp-chip { display: inline-flex; align-items: center; gap: 4px; background: #EFF6FF; color: #1E40AF; border-radius: 999px; padding: 2px 4px 2px 10px; font-size: 12px; }
    .lp-chip button { border: none; background: none; cursor: pointer; color: #1E40AF; font-size: 14px; line-height: 1; padding: 0 4px; }
    .lp-list { max-height: 240px; overflow: auto; padding: 4px 0; }
    .lp-state { display: flex; justify-content: space-between; align-items: center; padding: 6px 12px; background: #F8FAFC; }
    .lp-state label, .lp-item { display: flex; gap: 8px; align-items: center; font-size: 13px; cursor: pointer; }
    .lp-item { padding: 5px 12px; color: #334155; }
    .lp-item:hover { background: #F8FAFC; }
    .lp-level { color: #94A3B8; font-size: 11px; }
    .lp-empty { color: #64748B; font-size: 13px; padding: 12px; margin: 0; }
    .lp-foot { font-size: 12px; color: #64748B; padding: 6px 12px; border-top: 1px solid #F1F5F9; }
  `],
})
export class LocationPickerComponent {
  /** Active locations to choose from. */
  locations = input<TaskLocation[]>([]);
  selected = model<number[]>([]);
  query = signal('');

  private byId = computed(() => new Map(this.locations().map((l) => [l.id, l])));

  private childrenOf(id: number): TaskLocation[] {
    return this.locations().filter((l) => l.parentId === id);
  }

  /** The location and everything beneath it. */
  private subtree(id: number): number[] {
    const out = [id];
    for (let i = 0; i < out.length; i++) for (const c of this.childrenOf(out[i])) out.push(c.id);
    return out;
  }

  groups = computed<Group[]>(() => {
    const q = this.query().trim().toLowerCase();
    const all = this.locations();
    const ids = new Set(all.map((l) => l.id));
    // A location whose parent is gone or inactive still has to be choosable.
    const roots = all.filter((l) => l.parentId == null || !ids.has(l.parentId));
    const groups: Group[] = [];
    for (const root of roots) {
      const items: { loc: TaskLocation; depth: number }[] = [];
      const walk = (id: number, depth: number) => {
        for (const c of this.childrenOf(id)) { items.push({ loc: c, depth }); walk(c.id, depth + 1); }
      };
      walk(root.id, 0);
      const rootHit = !q || root.name.toLowerCase().includes(q);
      const shown = q && !rootHit ? items.filter((i) => i.loc.name.toLowerCase().includes(q)) : items;
      if (rootHit || shown.length) groups.push({ state: root, items: shown });
    }
    return groups;
  });

  shownIds = computed(() => this.groups().flatMap((g) => [...(g.state ? [g.state.id] : []), ...g.items.map((i) => i.loc.id)]));

  nameOf(id: number): string {
    const l = this.byId().get(id);
    if (!l) return `#${id}`;
    const p = l.parentId != null ? this.byId().get(l.parentId) : null;
    return p ? `${l.name}, ${p.name}` : l.name;
  }

  isOn(id: number) { return this.selected().includes(id); }

  toggle(id: number) {
    this.selected.update((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  stateFullyOn(g: Group) {
    return !!g.state && this.subtree(g.state.id).every((id) => this.isOn(id));
  }

  toggleState(g: Group) {
    if (!g.state) return;
    const ids = this.subtree(g.state.id);
    this.selected.update((s) => this.stateFullyOn(g)
      ? s.filter((x) => !ids.includes(x))
      : [...new Set([...s, ...ids])]);
  }

  selectShown() {
    this.selected.update((s) => [...new Set([...s, ...this.shownIds()])]);
  }
}
