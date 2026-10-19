import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { LucideCalendarDays, LucideChevronLeft, LucideChevronRight, LucideX } from '@lucide/angular';
import { environment } from '../../../environments/environment';

/**
 * My Calendar (19 Oct 2026): a real month and week calendar on the dashboard
 * instead of a fixed week strip. Previous / next / Today, Month or Week,
 * colour per kind of event, and a click on a day lists everything on it.
 * Data: GET /dashboard/calendar?from&to (holidays, birthdays, anniversaries,
 * everyone's approved leave, and my own shifts, days off and tasks due).
 */
type CalEvent = {
  date: string; type: string; title: string; subtitle?: string;
  avatarUrl?: string | null; mine?: boolean; link?: string; priority?: string;
};
type Cell = { date: string; day: number; inMonth: boolean; weekend: boolean };

const KINDS: { type: string; label: string }[] = [
  { type: 'HOLIDAY', label: 'Holiday' },
  { type: 'LEAVE', label: 'Leave' },
  { type: 'TASK', label: 'My tasks' },
  { type: 'SHIFT', label: 'My shift' },
  { type: 'DAY_OFF', label: 'Day off' },
  { type: 'BIRTHDAY', label: 'Birthday' },
  { type: 'ANNIVERSARY', label: 'Work anniversary' },
];

@Component({
  selector: 'app-my-calendar',
  standalone: true,
  imports: [CommonModule, LucideCalendarDays, LucideChevronLeft, LucideChevronRight, LucideX],
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
  hidden = signal<Set<string>>(new Set(['SHIFT']));
  selected = signal<string | null>(null);
  todayKey = this.key(new Date());

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
      return { date: this.key(d), day: d.getDate(), inMonth: this.view() === 'week' || d.getMonth() === a.getMonth(), weekend: d.getDay() === 0 || d.getDay() === 6 };
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

  byDate = computed(() => {
    const hide = this.hidden();
    const order = new Map(KINDS.map((k, i) => [k.type, i]));
    const map = new Map<string, CalEvent[]>();
    for (const e of this.events()) {
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
    return d ? this.events().filter((e) => e.date === d) : [];
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

  pick(date: string) { this.selected.set(this.selected() === date ? null : date); }

  open(e: CalEvent) { if (e.link) this.router.navigateByUrl(e.link); }

  /** Month cells show a few chips and "+N more"; the week view shows all. */
  shown(date: string): CalEvent[] {
    const list = this.byDate().get(date) ?? [];
    return this.view() === 'month' ? list.slice(0, 3) : list;
  }
  more(date: string): number {
    const n = (this.byDate().get(date) ?? []).length;
    return this.view() === 'month' ? Math.max(0, n - 3) : 0;
  }

  longDate(key: string) {
    return new Date(`${key}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
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
