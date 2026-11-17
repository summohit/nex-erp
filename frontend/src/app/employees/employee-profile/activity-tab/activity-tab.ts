import { Component, Input, OnChanges, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import {
  LucideActivity,
  LucideAlertCircle,
  LucideBanknote,
  LucideBriefcase,
  LucideCalendar,
  LucideCheckCircle2,
  LucideCheckSquare,
  LucideChevronDown,
  LucideClock,
  LucideExternalLink,
  LucideFileText,
  LucideFolder,
  LucideInbox,
  LucideLaptop,
  LucideMapPin,
  LucideMegaphone,
  LucideReceipt,
  LucideRefreshCw,
  LucideRepeat,
  LucideRotateCcw,
  LucideSearch,
  LucideTarget,
  LucideTicket,
  LucideTimer,
  LucideTrophy,
  LucideX,
} from '@lucide/angular';
import { EmployeeService } from '../../../services/employee.service';

interface ActivityItem {
  at: string;
  area: string;
  title: string;
  detail?: string;
  link?: string;
  tone?: string;
}

/**
 * Employee profile → Activity tab (17 Nov 2026).
 * One timeline, newest first, built from attendance, leave, tasks, tickets,
 * field visits, timesheets, documents, joining and awards.
 */
@Component({
  selector: 'app-activity-tab',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    LucideActivity,
    LucideAlertCircle,
    LucideBanknote,
    LucideBriefcase,
    LucideCalendar,
    LucideCheckCircle2,
    LucideCheckSquare,
    LucideChevronDown,
    LucideClock,
    LucideExternalLink,
    LucideFileText,
    LucideFolder,
    LucideInbox,
    LucideLaptop,
    LucideMapPin,
    LucideMegaphone,
    LucideReceipt,
    LucideRefreshCw,
    LucideRepeat,
    LucideRotateCcw,
    LucideSearch,
    LucideTarget,
    LucideTicket,
    LucideTimer,
    LucideTrophy,
    LucideX,
  ],
  templateUrl: './activity-tab.html',
  styleUrls: ['./activity-tab.css'],
})
export class ActivityTabComponent implements OnChanges {
  @Input() employeeId: number | null = null;

  private employees = inject(EmployeeService);

  readonly areas = [
    { key: 'attendance', label: 'Attendance', icon: '🕘' },
    { key: 'requests', label: 'Requests', icon: '📝' },
    { key: 'leave', label: 'Leave', icon: '🌴' },
    { key: 'tasks', label: 'Tasks', icon: '✅' },
    { key: 'tickets', label: 'Tickets', icon: '🎫' },
    { key: 'field-visits', label: 'Field visits', icon: '📍' },
    { key: 'timesheet', label: 'Timesheet', icon: '⏱' },
    { key: 'documents', label: 'Documents', icon: '📄' },
    { key: 'employment', label: 'Employment', icon: '💼' },
    { key: 'recognition', label: 'Recognition', icon: '🏆' },
    { key: 'approvals', label: 'Approvals given', icon: '✔️' },
    { key: 'assets', label: 'Assets', icon: '💻' },
    { key: 'expenses', label: 'Expenses', icon: '💸' },
    { key: 'payroll', label: 'Payroll', icon: '💰' },
    { key: 'comp-off', label: 'Comp-off', icon: '🔁' },
    { key: 'notices', label: 'Notices', icon: '📢' },
    { key: 'performance', label: 'Performance', icon: '🎯' },
  ];

  selected = signal<Set<string>>(new Set());
  search = signal('');
  from = signal('');
  to = signal('');
  items = signal<ActivityItem[]>([]);
  nextBefore = signal<string | null>(null);
  loading = signal(false);
  loadingMore = signal(false);
  error = signal<string | null>(null);

  filteredItems = computed(() => {
    const q = this.search().trim().toLowerCase();
    const list = this.items();
    if (!q) return list;
    return list.filter((it) =>
      it.title.toLowerCase().includes(q) ||
      (it.detail || '').toLowerCase().includes(q) ||
      (this.areaOf(it.area)?.label || it.area).toLowerCase().includes(q)
    );
  });

  /** Items grouped by IST day: "Today", "Yesterday", "Mon, 16 Nov". */
  groups = computed(() => {
    const out: { label: string; items: ActivityItem[] }[] = [];
    for (const it of this.filteredItems()) {
      const label = this.dayLabel(it.at);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(it);
      else out.push({ label, items: [it] });
    }
    return out;
  });

  ngOnChanges() { this.reload(); }

  toggleArea(key: string) {
    const s = new Set(this.selected());
    s.has(key) ? s.delete(key) : s.add(key);
    this.selected.set(s);
    this.reload();
  }

  selectAllAreas() {
    if (this.selected().size === 0) return;
    this.selected.set(new Set());
    this.reload();
  }

  /** Quick ranges, same as the Timesheet page (17 Nov 2026). */
  readonly ranges = [
    { days: 7, label: 'Week' },
    { days: 14, label: '2 weeks' },
    { days: 30, label: '30 days' },
    { days: 90, label: '90 days' },
  ];

  private ymd(d: Date) {
    return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  }

  /** Last N days up to today; picking the active one again clears it. */
  setRange(days: number) {
    if (this.activeRange() === days) { this.from.set(''); this.to.set(''); this.reload(); return; }
    const today = new Date();
    this.from.set(this.ymd(new Date(today.getTime() - (days - 1) * 86400000)));
    this.to.set(this.ymd(today));
    this.reload();
  }

  /** Which quick range the From/To dates currently match, if any. */
  activeRange = computed(() => {
    if (!this.from() || this.to() !== this.ymd(new Date())) return null;
    const span = Math.round((new Date(this.to()).getTime() - new Date(this.from()).getTime()) / 86400000) + 1;
    return this.ranges.find((r) => r.days === span)?.days ?? null;
  });

  clearFilters() {
    this.selected.set(new Set());
    this.search.set('');
    this.from.set('');
    this.to.set('');
    this.reload();
  }

  hasFilters = computed(() => this.selected().size > 0 || !!this.from() || !!this.to() || !!this.search().trim());

  reload() {
    if (!this.employeeId) return;
    this.loading.set(true);
    this.error.set(null);
    this.fetch(undefined, (res) => {
      this.items.set(this.dedupe(res.items));
      this.nextBefore.set(res.nextBefore);
      this.loading.set(false);
    }, () => this.loading.set(false));
  }

  loadMore() {
    const before = this.nextBefore();
    if (!before || this.loadingMore()) return;
    this.loadingMore.set(true);
    this.fetch(before, (res) => {
      this.items.set(this.dedupe([...this.items(), ...res.items]));
      this.nextBefore.set(res.nextBefore);
      this.loadingMore.set(false);
    }, () => this.loadingMore.set(false));
  }

  private fetch(before: string | undefined, ok: (r: { items: ActivityItem[]; nextBefore: string | null }) => void, fail: () => void) {
    this.employees.getActivity(this.employeeId!, {
      before,
      areas: [...this.selected()].join(','),
      from: this.from(),
      to: this.to(),
    }).subscribe({
      next: ok,
      error: (e) => {
        this.error.set(e?.status === 403 ? "You don't have access to this person's activity." : 'Could not load activity.');
        fail();
      },
    });
  }

  /** The same record can come back on two pages; show it once. */
  private dedupe(list: ActivityItem[]) {
    const seen = new Set<string>();
    return list.filter((i) => {
      const k = `${i.at}|${i.title}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  areaOf(key: string) { return this.areas.find((a) => a.key === key); }

  linkPath(link: string) { return link.split('?')[0]; }

  linkQuery(link: string): Record<string, string> | null {
    const q = link.split('?')[1];
    if (!q) return null;
    const out: Record<string, string> = {};
    new URLSearchParams(q).forEach((v, k) => (out[k] = v));
    return out;
  }

  private dayLabel(iso: string): string {
    const fmt = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const d = new Date(iso);
    const today = new Date();
    const yest = new Date(Date.now() - 86400000);
    if (fmt(d) === fmt(today)) return 'Today';
    if (fmt(d) === fmt(yest)) return 'Yesterday';
    return d.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric', timeZone: 'Asia/Kolkata' });
  }
}
