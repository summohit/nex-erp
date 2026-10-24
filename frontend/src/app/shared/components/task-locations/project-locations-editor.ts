import { Component, computed, effect, input, model, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideX, LucideLock, LucidePlus, LucideGlobe, LucideBuilding2, LucideMapPin, LucideSearch } from '@lucide/angular';
import { ProjectCity, ProjectSite, TaskLocation } from '../../../services/task-locations.service';
import { INDIA_LOCATIONS } from './india-locations';

const key = (state: string, city: string) => `${state.toLowerCase()}|${city.toLowerCase()}`;

/**
 * Where a project is carried out (23 Oct 2026): pick states, then cities in
 * them, then add the project's own sites inside each city. Tasks in the
 * project can then only be placed at those cities or sites.
 *
 * The choice is India's states and cities (india-locations.ts) plus anything
 * already in the company's location list, so no master-data setup is needed;
 * the server adds what a project picks to that list. A city or site with open
 * task work is locked: the server refuses to take it off.
 */
@Component({
  selector: 'app-project-locations-editor',
  standalone: true,
  imports: [CommonModule, LucideX, LucideLock, LucidePlus, LucideGlobe, LucideBuilding2, LucideMapPin, LucideSearch],
  template: `
    @if (loading()) {
      <div class="ple-loading">Loading this project's locations…</div>
    } @else {
    <div class="ple">
      <div class="ple-label"><svg lucideGlobe size="13"></svg> States</div>
      <div class="ple-search">
        <svg lucideSearch size="13"></svg>
        <input type="text" placeholder="Search states…" [value]="stateQuery()" (input)="stateQuery.set($any($event.target).value)" />
      </div>
      <div class="ple-chips">
        @for (s of shownStates(); track s) {
          <button type="button" class="ple-chip" [class.on]="stateOn(s)" [disabled]="stateOn(s) && stateLocked(s)"
                  [title]="stateOn(s) && stateLocked(s) ? 'Has open tasks, cannot be removed' : ''" (click)="toggleState(s)">
            {{ s }}
            @if (stateOn(s) && stateLocked(s)) { <svg lucideLock size="11"></svg> }
          </button>
        }
      </div>

      @for (s of chosenStates(); track s) {
        <div class="ple-state">
          <div class="ple-state-head">
            <b>{{ s }}</b>
            <span class="ple-muted">{{ citiesOf(s).length }} {{ citiesOf(s).length === 1 ? 'city' : 'cities' }} chosen</span>
          </div>
          <div class="ple-sub"><svg lucideBuilding2 size="12"></svg> Cities</div>
          <div class="ple-chips">
            @for (c of allCitiesOf(s); track c) {
              <button type="button" class="ple-chip sm" [class.on]="cityOn(s, c)" [disabled]="cityOn(s, c) && cityLocked(s, c)"
                      [title]="cityOn(s, c) && cityLocked(s, c) ? 'Has open tasks, cannot be removed' : ''" (click)="toggleCity(s, c)">
                {{ c }}
                @if (cityOn(s, c) && cityLocked(s, c)) { <svg lucideLock size="11"></svg> }
              </button>
            }
            <span class="ple-add">
              <input #cityIn type="text" placeholder="Other city…" (keydown.enter)="$event.preventDefault(); addCity(s, cityIn)" (blur)="addCity(s, cityIn)" />
              <button type="button" (click)="addCity(s, cityIn)" title="Add city"><svg lucidePlus size="12"></svg></button>
            </span>
          </div>

          @for (c of citiesOf(s); track c.city) {
            <div class="ple-city">
              <div class="ple-city-name"><svg lucideMapPin size="12"></svg> {{ c.city }} <span class="ple-muted">· sites (optional)</span></div>
              <div class="ple-chips">
                @for (site of sitesOf(s, c.city); track $index) {
                  <span class="ple-site" [class.locked]="!!site.openTasks">
                    {{ site.name }}
                    @if (site.openTasks) {
                      <svg lucideLock size="11" [attr.title]="site.openTasks + ' open task(s)'"></svg>
                    } @else {
                      <button type="button" (click)="removeSite(site)" [attr.aria-label]="'Remove ' + site.name"><svg lucideX size="11"></svg></button>
                    }
                  </span>
                }
                <span class="ple-add">
                  <input #siteIn type="text" placeholder="Add a site…" (keydown.enter)="$event.preventDefault(); addSite(s, c.city, siteIn)" (blur)="addSite(s, c.city, siteIn)" />
                  <button type="button" (click)="addSite(s, c.city, siteIn)" title="Add site"><svg lucidePlus size="12"></svg></button>
                </span>
              </div>
            </div>
          }
        </div>
      }
      @if (cities().length) {
        <div class="ple-foot">Tasks in this project can be placed at any of these {{ cities().length }} {{ cities().length === 1 ? 'city' : 'cities' }} or {{ sites().length }} {{ sites().length === 1 ? 'site' : 'sites' }}.</div>
      } @else {
        <div class="ple-foot">No locations chosen: tasks can use any location in the company list.</div>
      }
    </div>
    }
  `,
  styles: [`
    .ple { display: flex; flex-direction: column; gap: 8px; }
    .ple-label, .ple-sub { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: #475569; }
    .ple-search { display: flex; align-items: center; gap: 6px; border: 1px solid #cbd5e1; border-radius: 8px; padding: 5px 9px; background: #fff; color: #64748b; max-width: 280px; }
    .ple-search input { border: 0; outline: none; font-size: 12.5px; flex: 1; background: transparent; }
    .ple-chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .ple-chip { border: 1px solid #cbd5e1; background: #fff; color: #334155; border-radius: 999px; padding: 4px 11px; font-size: 12.5px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; }
    .ple-chip.sm { padding: 3px 9px; font-size: 12px; }
    .ple-chip.on { background: #eff6ff; border-color: #2563eb; color: #1d4ed8; font-weight: 600; }
    .ple-chip:disabled { cursor: not-allowed; opacity: .85; }
    .ple-state { border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 12px; background: #f8fafc; display: flex; flex-direction: column; gap: 6px; }
    .ple-state-head { display: flex; justify-content: space-between; align-items: center; font-size: 13px; color: #0f172a; }
    .ple-city { border-top: 1px dashed #e2e8f0; padding-top: 6px; display: flex; flex-direction: column; gap: 5px; }
    .ple-city-name { display: flex; align-items: center; gap: 5px; font-size: 12.5px; font-weight: 600; color: #0f172a; }
    .ple-site { display: inline-flex; align-items: center; gap: 4px; background: #fff; border: 1px solid #cbd5e1; border-radius: 6px; padding: 2px 4px 2px 8px; font-size: 12px; }
    .ple-site.locked { padding-right: 8px; background: #fefce8; border-color: #fde68a; }
    .ple-site button, .ple-add button { border: 0; background: none; cursor: pointer; color: #64748b; display: grid; place-items: center; padding: 2px; }
    .ple-add { display: inline-flex; align-items: center; border: 1px dashed #94a3b8; border-radius: 6px; padding: 0 2px 0 6px; background: #fff; }
    .ple-add input { border: 0; outline: none; font-size: 12px; width: 110px; padding: 3px 0; background: transparent; }
    .ple-muted { color: #64748b; font-weight: 400; font-size: 11.5px; }
    .ple-foot { font-size: 11.5px; color: #64748b; }
    .ple-loading { font-size: 12.5px; color: #64748b; padding: 10px 12px; border: 1px dashed #cbd5e1; border-radius: 10px; background: #f8fafc; }
  `],
})
export class ProjectLocationsEditorComponent {
  /** The company's location list, so states and cities added there show too. */
  locations = input<TaskLocation[]>([]);
  /** The project's saved locations are still loading: nothing to edit yet. */
  loading = input(false);
  cities = model<ProjectCity[]>([]);
  sites = model<ProjectSite[]>([]);

  stateQuery = signal('');
  /** States chosen, including ones whose cities are not picked yet. */
  private stateNames = signal<string[]>([]);
  /** Cities typed in with "Other city", per state. */
  private extraCities = signal<Record<string, string[]>>({});

  constructor() {
    // Show the states of the cities already on the project.
    effect(() => {
      const from = this.cities().map((c) => c.state).filter(Boolean);
      untracked(() => this.stateNames.update((s) => {
        const have = new Set(s.map((x) => x.toLowerCase()));
        return [...s, ...[...new Set(from)].filter((x) => !have.has(x.toLowerCase()))];
      }));
    });
  }

  /** Every state name with its cities: India's list, the company list and the project's own picks. */
  private catalog = computed(() => {
    const out = new Map<string, { name: string; cities: string[] }>();
    const add = (state: string, city?: string) => {
      const k = state.toLowerCase();
      if (!out.has(k)) out.set(k, { name: state, cities: [] });
      const entry = out.get(k)!;
      if (city && !entry.cities.some((c) => c.toLowerCase() === city.toLowerCase())) entry.cities.push(city);
    };
    for (const [state, cities] of Object.entries(INDIA_LOCATIONS)) { add(state); cities.forEach((c) => add(state, c)); }
    const all = this.locations();
    const byId = new Map(all.map((l) => [l.id, l]));
    for (const l of all) {
      if (l.level === 'STATE') add(l.name);
      if (l.level === 'CITY' && l.parentId != null && byId.get(l.parentId)) add(byId.get(l.parentId)!.name, l.name);
    }
    for (const c of this.cities()) add(c.state, c.city);
    for (const [state, extra] of Object.entries(this.extraCities())) extra.forEach((c) => add(state, c));
    return out;
  });

  stateList = computed(() => [...this.catalog().values()].map((v) => v.name).sort((a, b) => a.localeCompare(b)));
  shownStates = computed(() => {
    const q = this.stateQuery().trim().toLowerCase();
    return q ? this.stateList().filter((s) => s.toLowerCase().includes(q) || this.stateOn(s)) : this.stateList();
  });
  chosenStates = computed(() => this.stateList().filter((s) => this.stateOn(s)));

  allCitiesOf(state: string) {
    return [...(this.catalog().get(state.toLowerCase())?.cities ?? [])].sort((a, b) => a.localeCompare(b));
  }
  citiesOf(state: string) {
    return this.cities().filter((c) => c.state.toLowerCase() === state.toLowerCase());
  }
  sitesOf(state: string, city: string) {
    return this.sites().filter((s) => key(s.state, s.city) === key(state, city));
  }

  stateOn(state: string) { return this.stateNames().some((s) => s.toLowerCase() === state.toLowerCase()); }
  cityOn(state: string, city: string) { return this.cities().some((c) => key(c.state, c.city) === key(state, city)); }

  cityLocked(state: string, city: string) {
    const c = this.cities().find((x) => key(x.state, x.city) === key(state, city));
    return !!c?.openTasks || this.sitesOf(state, city).some((s) => !!s.openTasks);
  }
  stateLocked(state: string) {
    return this.citiesOf(state).some((c) => this.cityLocked(state, c.city));
  }

  toggleState(state: string) {
    if (this.stateOn(state)) {
      if (this.stateLocked(state)) return;
      const k = state.toLowerCase();
      this.cities.set(this.cities().filter((c) => c.state.toLowerCase() !== k));
      this.sites.set(this.sites().filter((s) => s.state.toLowerCase() !== k));
      this.stateNames.set(this.stateNames().filter((s) => s.toLowerCase() !== k));
    } else {
      this.stateNames.set([...this.stateNames(), state]);
    }
  }

  toggleCity(state: string, city: string) {
    if (this.cityOn(state, city)) {
      if (this.cityLocked(state, city)) return;
      this.cities.set(this.cities().filter((c) => key(c.state, c.city) !== key(state, city)));
      this.sites.set(this.sites().filter((s) => key(s.state, s.city) !== key(state, city)));
    } else {
      this.cities.set([...this.cities(), { state, city }]);
    }
  }

  addCity(state: string, el: HTMLInputElement) {
    const city = el.value.trim().replace(/\s+/g, ' ');
    el.value = '';
    if (!city) return;
    const existing = this.allCitiesOf(state).find((c) => c.toLowerCase() === city.toLowerCase());
    if (!existing) this.extraCities.update((m) => ({ ...m, [state]: [...(m[state] ?? []), city] }));
    if (!this.cityOn(state, existing ?? city)) this.cities.set([...this.cities(), { state, city: existing ?? city }]);
  }

  addSite(state: string, city: string, el: HTMLInputElement) {
    const name = el.value.trim().replace(/\s+/g, ' ');
    el.value = '';
    if (!name) return;
    if (!this.sitesOf(state, city).some((s) => s.name.toLowerCase() === name.toLowerCase())) {
      this.sites.set([...this.sites(), { name, state, city }]);
    }
  }

  removeSite(site: ProjectSite) {
    if (site.openTasks) return;
    this.sites.set(this.sites().filter((s) => s !== site));
  }
}
