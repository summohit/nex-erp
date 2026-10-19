import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import {
  LucideAward,
  LucideCake,
  LucideCalendar,
  LucideCalendarDays,
  LucideCheckSquare,
  LucideChevronLeft,
  LucideChevronRight,
  LucideClock,
  LucideExternalLink,
  LucideRefreshCw,
  LucideSparkles,
  LucideUserCheck,
  LucideX,
} from '@lucide/angular';
import { environment } from '../../../environments/environment';

/**
 * My Calendar (19 Oct 2026): a real month and week calendar on the dashboard
 * instead of a fixed week strip. Previous / next / Today, Month or Week,
 * colour per kind of event, and a click on a day lists everything on it.
 * Data: GET /dashboard/calendar?from&to (holidays, birthdays, anniversaries,
 * everyone's approved leave, and my own shifts, days off and tasks due).
 */
export type CalEvent = {
  date: string; type: string; title: string; subtitle?: string;
  avatarUrl?: string | null; mine?: boolean; link?: string; priority?: string;
};
type Cell = { date: string; day: number; monthShort: string; isFirstOfMonth: boolean; inMonth: boolean; weekend: boolean };

const KINDS: { type: string; label: string }[] = [
  { type: 'HOLIDAY', label: 'Holiday' },
  { type: 'LEAVE', label: 'Leave' },
  { type: 'TASK', label: 'My tasks' },
  { type: 'SHIFT', label: 'My shift' },
  { type: 'DAY_OFF', label: 'Day off' },
  { type: 'BIRTHDAY', label: 'Birthday' },
  { type: 'ANNIVERSARY', label: 'Work anniversary' },
];

const DEFAULT_HIDDEN = ['SHIFT'];

@Component({
  selector: 'app-my-calendar',
  standalone: true,
  imports: [
    CommonModule,
    LucideCalendarDays,
    LucideChevronLeft,
    LucideChevronRight,
    LucideX,
    LucideCake,
    LucideAward,
    LucideSparkles,
    LucideCheckSquare,
    LucideClock,
    LucideCalendar,
    LucideUserCheck,
    LucideExternalLink,
    LucideRefreshCw,
  ],
  templateUrl: './my-calendar.html',
  styleUrls: ['./my-calendar.css'],
})
export class MyCalendarComponent implements OnInit {
  private http = inject(HttpClient);
  private router = inject(Router);

  readonly kinds = KINDS;
  readonly weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  view = signal<'month' | 'week'>('month');
  /** Any day inside the period on screen. */
  anchor = signal<Date>(this.startOfDay(new Date()));
  events = signal<CalEvent[]>([]);
  loading = signal(false);
  hidden = signal<Set<string>>(new Set(DEFAULT_HIDDEN));
  onlyMine = signal(false);
  selected = signal<string | null>(null);
  todayKey = this.key(new Date());

  /** True when the user has toggled any filter chip or 'Only Mine' away from defaults. */
  hasCustomFilters = computed(() => {
    if (this.onlyMine()) return true;
    const h = this.hidden();
    if (h.size !== DEFAULT_HIDDEN.length) return true;
    return DEFAULT_HIDDEN.some((k) => !h.has(k));
  });

  cells = computed<Cell[]>(() => {
    const a = this.anchor();
    let first: Date; let count: number;
    if (this.view() === 'month') {
      const m1 = new Date(a.getFullYear(), a.getMonth(), 1);
      first = this.mondayOf(m1);
      const mLast = new Date(a.getFullYear(), a.getMonth() + 1, 0);
      const lastSun = this.addDays(this.mondayOf(mLast), 6);
      count = Math.round((lastSun.getTime() - first.getTime()) / 86400000) + 1;
    } else {
      first = this.mondayOf(a);
      count = 7;
    }
    return Array.from({ length: count }, (_, i) => {
      const d = this.addDays(first, i);
      return {
        date: this.key(d),
        day: d.getDate(),
        monthShort: d.toLocaleDateString('en-IN', { month: 'short' }),
        isFirstOfMonth: d.getDate() === 1,
        inMonth: this.view() === 'week' || d.getMonth() === a.getMonth(),
        weekend: d.getDay() === 0 || d.getDay() === 6,
      };
    });
  });

  title = computed(() => {
    const a = this.anchor();
    if (this.view() === 'month') return a.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    const c = this.cells();
    const f = new Date(c[0].date); const l = new Date(c[6].date);
    const sameMonth = f.getMonth() === l.getMonth();
    return `${f.getDate()}${sameMonth ? '' : ' ' + f.toLocaleDateString('en-IN', { month: 'short' })} – ${l.getDate()} ${l.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`;
  });

  /** Events filtered by 'Only Mine' scope (before legend chip toggles). */
  scopedEvents = computed(() => {
    const mineOnly = this.onlyMine();
    return this.events().filter((e) => !mineOnly || e.mine || e.type === 'HOLIDAY');
  });

  /** Count per event kind in the current range so filter chips show live numbers. */
  kindCounts = computed(() => {
    const counts = new Map<string, number>();
    for (const k of KINDS) counts.set(k.type, 0);
    for (const e of this.scopedEvents()) {
      counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
    }
    return counts;
  });

  byDate = computed(() => {
    const hide = this.hidden();
    const order = new Map(KINDS.map((k, i) => [k.type, i]));
    const map = new Map<string, CalEvent[]>();
    for (const e of this.scopedEvents()) {
      if (hide.has(e.type)) continue;
      if (!map.has(e.date)) map.set(e.date, []);
      map.get(e.date)!.push(e);
    }
    for (const list of map.values()) {
      list.sort((x, y) => (order.get(x.type) ?? 99) - (order.get(y.type) ?? 99) || Number(!!y.mine) - Number(!!x.mine));
    }
    return map;
  });

  selectedEvents = computed(() => {
    const d = this.selected();
    if (!d) return [];
    const order = new Map(KINDS.map((k, i) => [k.type, i]));
    return this.scopedEvents()
      .filter((e) => e.date === d)
      .sort((x, y) => (order.get(x.type) ?? 99) - (order.get(y.type) ?? 99) || Number(!!y.mine) - Number(!!x.mine));
  });

  ngOnInit() { this.load(); }

  load() {
    const c = this.cells();
    const from = c[0].date; const to = c[c.length - 1].date;
    this.loading.set(true);
    this.http.get<{ events: CalEvent[] }>(`${environment.apiUrl}/dashboard/calendar`, { params: { from, to } }).subscribe({
      next: (r) => { this.events.set(r.events ?? []); this.loading.set(false); },
      error: () => { this.events.set([]); this.loading.set(false); },
    });
  }

  setView(v: 'month' | 'week') {
    if (this.view() === v) return;
    this.view.set(v);
    this.load();
  }

  move(step: number) {
    const a = this.anchor();
    this.anchor.set(this.view() === 'month'
      ? new Date(a.getFullYear(), a.getMonth() + step, 1)
      : this.addDays(a, 7 * step));
    this.selected.set(null);
    this.load();
  }

  today() {
    this.anchor.set(this.startOfDay(new Date()));
    this.selected.set(this.todayKey);
    this.load();
  }

  toggleKind(type: string) {
    const s = new Set(this.hidden());
    s.has(type) ? s.delete(type) : s.add(type);
    this.hidden.set(s);
  }

  toggleOnlyMine() {
    this.onlyMine.set(!this.onlyMine());
  }

  resetFilters() {
    this.hidden.set(new Set(DEFAULT_HIDDEN));
    this.onlyMine.set(false);
  }

  isPersonEvent(e: CalEvent): boolean {
    return e.type === 'LEAVE' || e.type === 'BIRTHDAY' || e.type === 'ANNIVERSARY' || !!e.avatarUrl;
  }

  pick(date: string) { this.selected.set(this.selected() === date ? null : date); }

  open(e: CalEvent, ev?: Event) {
    if (ev) ev.stopPropagation();
    if (e.link) this.router.navigateByUrl(e.link);
  }

  /** Whether a cell has a visible DAY_OFF event (shown as a compact header pill in month view). */
  isDayOff(date: string): boolean {
    const list = this.byDate().get(date) ?? [];
    return list.some((e) => e.type === 'DAY_OFF');
  }

  /** Events stacked inside the cell body (in month view, DAY_OFF is elevated to the cell header). */
  private cellBodyEvents(date: string): CalEvent[] {
    const list = this.byDate().get(date) ?? [];
    return this.view() === 'month' ? list.filter((e) => e.type !== 'DAY_OFF') : list;
  }

  /** Month cells show up to 3 chips and "+N more"; the week view shows all. */
  shown(date: string): CalEvent[] {
    const list = this.cellBodyEvents(date);
    return this.view() === 'month' ? list.slice(0, 3) : list;
  }

  more(date: string): number {
    const n = this.cellBodyEvents(date).length;
    return this.view() === 'month' ? Math.max(0, n - 3) : 0;
  }

  totalForDay(date: string): number {
    return (this.byDate().get(date) ?? []).length;
  }

  countForKind(type: string): number {
    return this.kindCounts().get(type) ?? 0;
  }

  longDate(key: string) {
    return new Date(`${key}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  relativeDayLabel(key: string): string {
    if (key === this.todayKey) return 'Today';
    const target = new Date(`${key}T00:00:00`).getTime();
    const today = new Date(`${this.todayKey}T00:00:00`).getTime();
    const diff = Math.round((target - today) / 86400000);
    if (diff === 1) return 'Tomorrow';
    if (diff === -1) return 'Yesterday';
    if (diff > 1 && diff <= 14) return `In ${diff} days`;
    if (diff < -1 && diff >= -14) return `${Math.abs(diff)} days ago`;
    return '';
  }

  kindLabel(type: string) { return KINDS.find((k) => k.type === type)?.label ?? type; }
  initials(t: string) { return t.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase(); }

  private startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  private addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  private mondayOf(d: Date) { const dow = d.getDay(); return this.addDays(this.startOfDay(d), dow === 0 ? -6 : 1 - dow); }
  private key(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}
