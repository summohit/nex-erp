import { Component, ElementRef, EventEmitter, HostListener, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideChevronDown, LucideChevronLeft, LucideChevronRight } from '@lucide/angular';

export interface DateRange {
  /** YYYY-MM-DD, inclusive. */
  from: string;
  to: string;
  /** The preset picked, or 'Custom Range'. */
  label: string;
}

interface CalDay { date: Date; dayNumber: number; isCurrentMonth: boolean }

/**
 * "Duration" button with a preset list and a two-month calendar, the same
 * look as the Timesheets filter. Emits `rangeChange` on a preset click or on
 * Apply for a custom range.
 */
@Component({
  selector: 'app-date-range-picker',
  standalone: true,
  imports: [CommonModule, LucideChevronDown, LucideChevronLeft, LucideChevronRight],
  templateUrl: './date-range-picker.html',
  styleUrl: './date-range-picker.css',
})
export class DateRangePickerComponent implements OnInit {
  private host = inject(ElementRef);

  /** The preset to start on. */
  @Input() initial = 'This Month';
  /** Popover edge to line up with the button. */
  @Input() align: 'left' | 'right' = 'right';
  @Output() rangeChange = new EventEmitter<DateRange>();

  readonly PRESETS = ['Today', 'Last 30 Days', 'This Month', 'Last Month', 'Last 90 Days', 'Last 6 Months', 'Last 1 Year', 'Custom Range'];
  readonly DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  open = signal(false);
  /** What is applied. */
  label = signal('This Month');
  start = signal<Date>(new Date());
  end = signal<Date>(new Date());
  /** What is being picked, until Apply. */
  pickLabel = signal('This Month');
  pickStart = signal<Date | null>(null);
  pickEnd = signal<Date | null>(null);
  month1 = signal(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  month2 = computed(() => new Date(this.month1().getFullYear(), this.month1().getMonth() + 1, 1));
  days1 = computed(() => this.daysOf(this.month1()));
  days2 = computed(() => this.daysOf(this.month2()));

  buttonText = computed(() => `${this.fmt(this.start())} To ${this.fmt(this.end())}`);
  pickText = computed(() => {
    const s = this.pickStart();
    if (!s) return 'Pick a start date';
    const e = this.pickEnd();
    return e ? `${this.fmt(s)} To ${this.fmt(e)}` : `${this.fmt(s)} To …`;
  });

  ngOnInit() {
    const [s, e] = this.rangeFor(this.initial) ?? this.rangeFor('This Month')!;
    this.label.set(this.initial);
    this.start.set(s);
    this.end.set(e);
    // Report the starting range so the page can load for it. Deferred so the
    // parent isn't changed in the middle of its own change detection.
    queueMicrotask(() => this.rangeChange.emit({ from: this.key(s), to: this.key(e), label: this.initial }));
  }

  @HostListener('document:click', ['$event'])
  onDocClick(ev: MouseEvent) {
    if (this.open() && !this.host.nativeElement.contains(ev.target)) this.open.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    this.open.set(false);
  }

  toggle() {
    if (this.open()) { this.open.set(false); return; }
    this.pickLabel.set(this.label());
    this.pickStart.set(this.start());
    this.pickEnd.set(this.end());
    this.month1.set(new Date(this.start().getFullYear(), this.start().getMonth(), 1));
    this.open.set(true);
  }

  choosePreset(p: string) {
    this.pickLabel.set(p);
    if (p === 'Custom Range') return;
    const [s, e] = this.rangeFor(p)!;
    this.commit(p, s, e);
  }

  clickDay(d: CalDay) {
    const day = new Date(d.date);
    const s = this.pickStart();
    this.pickLabel.set('Custom Range');
    if (!s || this.pickEnd()) {
      this.pickStart.set(day);
      this.pickEnd.set(null);
    } else if (day < s) {
      this.pickStart.set(day);
      this.pickEnd.set(s);
    } else {
      this.pickEnd.set(day);
    }
  }

  apply() {
    const s = this.pickStart();
    if (!s) return;
    this.commit('Custom Range', s, this.pickEnd() ?? s);
  }

  cancel() {
    this.open.set(false);
  }

  shiftMonth(by: number) {
    const m = this.month1();
    this.month1.set(new Date(m.getFullYear(), m.getMonth() + by, 1));
  }

  monthName(d: Date) {
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  isStart(d: Date) { return !!this.pickStart() && this.key(d) === this.key(this.pickStart()!); }
  isEnd(d: Date) { return !!this.pickEnd() && this.key(d) === this.key(this.pickEnd()!); }
  inRange(d: Date) {
    const s = this.pickStart(), e = this.pickEnd();
    return !!s && !!e && d > s && d < e;
  }

  private commit(label: string, s: Date, e: Date) {
    this.label.set(label);
    this.start.set(s);
    this.end.set(e);
    this.open.set(false);
    this.rangeChange.emit({ from: this.key(s), to: this.key(e), label });
  }

  private rangeFor(p: string): [Date, Date] | null {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const back = (days: number) => { const d = new Date(now); d.setDate(d.getDate() - days); return d; };
    switch (p) {
      case 'Today': return [new Date(now), new Date(now)];
      case 'Last 30 Days': return [back(29), new Date(now)];
      case 'This Month': return [new Date(now.getFullYear(), now.getMonth(), 1), new Date(now.getFullYear(), now.getMonth() + 1, 0)];
      case 'Last Month': return [new Date(now.getFullYear(), now.getMonth() - 1, 1), new Date(now.getFullYear(), now.getMonth(), 0)];
      case 'Last 90 Days': return [back(89), new Date(now)];
      case 'Last 6 Months': { const d = new Date(now); d.setMonth(d.getMonth() - 6); return [d, new Date(now)]; }
      case 'Last 1 Year': { const d = new Date(now); d.setFullYear(d.getFullYear() - 1); return [d, new Date(now)]; }
      default: return null;
    }
  }

  private daysOf(month: Date): CalDay[] {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const startAt = new Date(first);
    startAt.setDate(1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(startAt);
      d.setDate(startAt.getDate() + i);
      return { date: d, dayNumber: d.getDate(), isCurrentMonth: d.getMonth() === month.getMonth() };
    });
  }

  private key(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private fmt(d: Date) {
    return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
  }
}
