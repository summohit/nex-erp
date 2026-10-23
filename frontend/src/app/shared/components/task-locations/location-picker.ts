import { Component, computed, input, model, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  LucideSearch, LucideX, LucideGlobe, LucideBuilding2, LucideMapPin,
  LucideCheck, LucideLayers
} from '@lucide/angular';
import { TaskLocation } from '../../../services/task-locations.service';

interface Group {
  state: TaskLocation | null;
  items: { loc: TaskLocation; depth: number }[];
}

/**
 * Choose the locations a task is carried out at.
 * Grouped by state, searchable, with bulk selection options.
 */
let pickerSeq = 0;

@Component({
  selector: 'app-location-picker',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideSearch, LucideX, LucideGlobe, LucideBuilding2, LucideMapPin,
    LucideCheck, LucideLayers
  ],
  template: `
    <div class="lp-card">
      <div class="lp-header-bar">
        <div class="lp-search-box">
          <svg lucideSearch size="14" class="lp-search-icon"></svg>
          <input
            class="lp-search-input"
            type="text"
            placeholder="Search states, cities, sites…"
            [value]="query()"
            (input)="query.set($any($event.target).value)"
          />
          @if (query()) {
            <button type="button" class="lp-clear-btn" (click)="query.set('')" title="Clear search">
              <svg lucideX size="13"></svg>
            </button>
          }
        </div>
        <div class="lp-actions">
          @if (!single()) {
            <button type="button" class="lp-action-btn" (click)="selectShown()" [disabled]="!shownIds().length">
              Select all shown
            </button>
          }
          <button type="button" class="lp-action-btn" (click)="selected.set([])" [disabled]="!selected().length">
            Clear
          </button>
        </div>
      </div>

      @if (selected().length) {
        <div class="lp-chips-bar">
          <span class="lp-chips-label">Selected:</span>
          <div class="lp-chips-list">
            @for (id of selected(); track id) {
              <span class="lp-selected-chip">
                <span>{{ nameOf(id) }}</span>
                <button type="button" class="lp-remove-chip-btn" (click)="toggle(id)" [attr.aria-label]="'Remove ' + nameOf(id)">
                  <svg lucideX size="12"></svg>
                </button>
              </span>
            }
          </div>
        </div>
      }

      <div class="lp-tree-list">
        @for (g of groups(); track g.state?.id ?? 0) {
          <div class="lp-state-group">
            @if (g.state) {
              <div class="lp-state-header">
                <label class="lp-checkbox-label">
                  @if (!g.state.headerOnly) {
                    <input
                      [type]="single() ? 'radio' : 'checkbox'"
                      [name]="radioName"
                      class="lp-custom-check"
                      [checked]="isOn(g.state.id)"
                      (change)="toggle(g.state.id)"
                    />
                  }
                  <span class="lp-level-icon state"><svg lucideGlobe size="13"></svg></span>
                  <strong class="lp-state-name">{{ g.state.name }}</strong>
                  <span class="lp-child-tag" *ngIf="g.items.length">{{ g.items.length }} sub-locations</span>
                </label>
                @if (g.items.length && !single()) {
                  <button type="button" class="lp-state-toggle-btn" (click)="toggleState(g)">
                    {{ stateFullyOn(g) ? 'Clear state' : 'Whole state' }}
                  </button>
                }
              </div>
            }
            @for (it of g.items; track it.loc.id) {
              <label class="lp-item-row" [style.padding-left.px]="20 + it.depth * 18">
                <input
                  [type]="single() ? 'radio' : 'checkbox'"
                  [name]="radioName"
                  class="lp-custom-check"
                  [checked]="isOn(it.loc.id)"
                  (change)="toggle(it.loc.id)"
                />
                <span class="lp-level-icon" [ngClass]="it.loc.level.toLowerCase()">
                  @if (it.loc.level === 'CITY') {
                    <svg lucideBuilding2 size="12"></svg>
                  } @else {
                    <svg lucideMapPin size="12"></svg>
                  }
                </span>
                <span class="lp-item-name">{{ it.loc.name }}</span>
                <span class="lp-level-pill" [ngClass]="it.loc.level.toLowerCase()">
                  {{ it.loc.level.toLowerCase() }}
                </span>
              </label>
            }
          </div>
        } @empty {
          <div class="lp-empty-state">
            <svg lucideSearch size="20"></svg>
            <p>{{ locations().length ? 'Nothing matches that search.' : 'No locations are set up yet.' }}</p>
          </div>
        }
      </div>

      <div class="lp-footer">
        <span class="lp-selected-count">
          <strong>{{ selected().length }}</strong> location{{ selected().length === 1 ? '' : 's' }} selected
        </span>
      </div>
    </div>
  `,
  styles: [`
    .lp-card {
      border: 1px solid #E2E8F0;
      border-radius: 10px;
      background: #FFFFFF;
      overflow: hidden;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04);
      display: flex;
      flex-direction: column;
    }

    .lp-header-bar {
      display: flex;
      gap: 10px;
      align-items: center;
      padding: 8px 10px;
      background: #FFFFFF;
      border-bottom: 1px solid #F1F5F9;
      flex-wrap: wrap;
    }

    .lp-search-box {
      position: relative;
      display: flex;
      align-items: center;
      flex: 1;
      min-width: 180px;
    }

    .lp-search-icon {
      position: absolute;
      left: 10px;
      color: #94A3B8;
      pointer-events: none;
    }

    .lp-search-input {
      width: 100%;
      height: 32px;
      padding: 0 28px 0 30px;
      border: 1px solid #E2E8F0;
      border-radius: 6px;
      font-size: 12.5px;
      background: #F8FAFC;
      color: #0F172A;
      outline: none;
      transition: all 0.15s ease;
    }

    .lp-search-input:focus {
      background: #FFFFFF;
      border-color: #1373E5;
      box-shadow: 0 0 0 2px rgba(19, 115, 229, 0.12);
    }

    .lp-clear-btn {
      position: absolute;
      right: 6px;
      background: none;
      border: none;
      color: #94A3B8;
      cursor: pointer;
      padding: 3px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .lp-actions {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .lp-action-btn {
      background: none;
      border: 1px solid transparent;
      border-radius: 6px;
      color: #1373E5;
      font-size: 11.5px;
      font-weight: 600;
      cursor: pointer;
      padding: 4px 8px;
      transition: all 0.15s ease;
    }

    .lp-action-btn:hover:not(:disabled) {
      background: #EFF6FF;
    }

    .lp-action-btn:disabled {
      color: #CBD5E1;
      cursor: default;
    }

    .lp-chips-bar {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 6px 10px;
      background: #F8FAFC;
      border-bottom: 1px solid #F1F5F9;
      max-height: 80px;
      overflow-y: auto;
    }

    .lp-chips-label {
      font-size: 11px;
      font-weight: 600;
      color: #64748B;
      padding-top: 3px;
    }

    .lp-chips-list {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      flex: 1;
    }

    .lp-selected-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: #EFF6FF;
      color: #1E40AF;
      border: 1px solid #BFDBFE;
      border-radius: 12px;
      padding: 2px 6px 2px 8px;
      font-size: 11.5px;
      font-weight: 500;
    }

    .lp-remove-chip-btn {
      background: none;
      border: none;
      color: #1E40AF;
      cursor: pointer;
      display: flex;
      align-items: center;
      padding: 1px;
      border-radius: 50%;
    }

    .lp-remove-chip-btn:hover {
      background: #DBEAFE;
    }

    .lp-tree-list {
      max-height: 240px;
      overflow-y: auto;
      padding: 4px 0;
    }

    .lp-state-group {
      border-bottom: 1px solid #F8FAFC;
    }

    .lp-state-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 10px;
      background: #F8FAFC;
    }

    .lp-checkbox-label {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      font-size: 12.5px;
      min-width: 0;
    }

    .lp-custom-check {
      accent-color: #1373E5;
      width: 14px;
      height: 14px;
      cursor: pointer;
    }

    .lp-level-icon {
      width: 20px;
      height: 20px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .lp-level-icon.state { background: #EFF6FF; color: #1373E5; }
    .lp-level-icon.city { background: #ECFDF5; color: #059669; }
    .lp-level-icon.site { background: #F5F3FF; color: #7C3AED; }

    .lp-state-name {
      color: #0F172A;
      font-size: 13px;
    }

    .lp-child-tag {
      font-size: 11px;
      color: #64748B;
      padding: 1px 6px;
      background: #F1F5F9;
      border-radius: 10px;
    }

    .lp-state-toggle-btn {
      background: none;
      border: none;
      color: #1373E5;
      font-size: 11.5px;
      font-weight: 600;
      cursor: pointer;
      padding: 3px 6px;
      border-radius: 4px;
    }

    .lp-state-toggle-btn:hover {
      background: #E2E8F0;
    }

    .lp-item-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 10px;
      cursor: pointer;
      transition: background-color 0.15s ease;
    }

    .lp-item-row:hover {
      background: #F8FAFC;
    }

    .lp-item-name {
      font-size: 12.5px;
      color: #334155;
      flex: 1;
    }

    .lp-level-pill {
      font-size: 10.5px;
      font-weight: 600;
      padding: 1px 6px;
      border-radius: 4px;
      text-transform: capitalize;
    }

    .lp-level-pill.city { background: #ECFDF5; color: #065F46; }
    .lp-level-pill.site { background: #F5F3FF; color: #5B21B6; }

    .lp-empty-state {
      padding: 24px 16px;
      text-align: center;
      color: #94A3B8;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
    }

    .lp-empty-state p {
      margin: 0;
      font-size: 12.5px;
    }

    .lp-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 10px;
      background: #F8FAFC;
      border-top: 1px solid #F1F5F9;
      font-size: 11.5px;
      color: #64748B;
    }

    .lp-selected-count strong {
      color: #0F172A;
    }
  `]
})
export class LocationPickerComponent {
  /** Active locations to choose from. */
  locations = input<TaskLocation[]>([]);
  selected = model<number[]>([]);
  /** One location only: picking another replaces it, and the bulk actions go. */
  single = input(false);
  /** Unique per picker, so two open pickers' radio buttons never share a group. */
  readonly radioName = `lp-pick-${++pickerSeq}`;
  query = signal('');

  private byId = computed(() => new Map(this.locations().map((l) => [l.id, l])));

  private childrenOf(id: number): TaskLocation[] {
    return this.locations().filter((l) => l.parentId === id);
  }

  /** The location and everything beneath it. */
  private subtree(id: number): number[] {
    const out = [id];
    for (let i = 0; i < out.length; i++) {
      for (const c of this.childrenOf(out[i])) out.push(c.id);
    }
    return out;
  }

  groups = computed<Group[]>(() => {
    const q = this.query().trim().toLowerCase();
    const all = this.locations();
    const ids = new Set(all.map((l) => l.id));
    const roots = all.filter((l) => l.parentId == null || !ids.has(l.parentId));
    const groups: Group[] = [];

    for (const root of roots) {
      const items: { loc: TaskLocation; depth: number }[] = [];
      const walk = (id: number, depth: number) => {
        for (const c of this.childrenOf(id)) {
          items.push({ loc: c, depth });
          walk(c.id, depth + 1);
        }
      };
      walk(root.id, 0);
      const rootHit = !q || root.name.toLowerCase().includes(q);
      const shown = q && !rootHit
        ? items.filter((i) => i.loc.name.toLowerCase().includes(q))
        : items;

      if (rootHit || shown.length) {
        groups.push({ state: root, items: shown });
      }
    }
    return groups;
  });

  shownIds = computed(() =>
    this.groups().flatMap((g) => [
      ...(g.state && !g.state.headerOnly ? [g.state.id] : []),
      ...g.items.map((i) => i.loc.id),
    ])
  );

  nameOf(id: number): string {
    const l = this.byId().get(id);
    if (!l) return `#${id}`;
    const p = l.parentId != null ? this.byId().get(l.parentId) : null;
    return p ? `${l.name}, ${p.name}` : l.name;
  }

  isOn(id: number) {
    return this.selected().includes(id);
  }

  toggle(id: number) {
    if (this.single()) {
      this.selected.set(this.selected().includes(id) ? [] : [id]);
      return;
    }
    this.selected.update((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id]
    );
  }

  stateFullyOn(g: Group) {
    return !!g.state && this.subtree(g.state.id).filter((id) => !this.byId().get(id)?.headerOnly).every((id) => this.isOn(id));
  }

  toggleState(g: Group) {
    if (!g.state) return;
    const ids = this.subtree(g.state.id).filter((id) => !this.byId().get(id)?.headerOnly);
    this.selected.update((s) =>
      this.stateFullyOn(g)
        ? s.filter((x) => !ids.includes(x))
        : [...new Set([...s, ...ids])]
    );
  }

  selectShown() {
    this.selected.update((s) => [...new Set([...s, ...this.shownIds()])]);
  }
}
