import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HotToastService } from '@ngneat/hot-toast';
import {
  LucideChevronLeft, LucideChevronRight, LucideCalendarDays,
  LucideClock, LucideUsers, LucideAlertCircle, LucideInbox,
} from '@lucide/angular';
import { AttendanceService, ShiftPeriodSummary, ShiftPeriodRow } from '../../services/attendance';

/**
 * §Att7: how each shift did over a week or a month.
 *
 * Its own page rather than a panel on the roster: the roster answers "who is
 * on what next week", which is a plan, and this answers "how did the plan go",
 * which is a report. Putting a report inside a planning grid makes both harder
 * to read.
 */
@Component({
  selector: 'app-shift-summary',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    LucideChevronLeft, LucideChevronRight, LucideCalendarDays,
    LucideClock, LucideUsers, LucideAlertCircle, LucideInbox,
  ],
  templateUrl: './shift-summary.html',
  styleUrls: ['./shift-summary.css'],
})
export class ShiftSummaryComponent implements OnInit {
  private attendanceService = inject(AttendanceService);
  private toast = inject(HotToastService);

  summary = signal<ShiftPeriodSummary | null>(null);
  isLoading = signal(false);
  period = signal<'week' | 'month'>('week');

  /** The day the period is resolved around; the server decides the boundaries. */
  anchor = signal<Date>(new Date());

  ngOnInit(): void {
    this.load();
  }

  private anchorKey(): string {
    const d = this.anchor();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  load(): void {
    this.isLoading.set(true);
    this.attendanceService.getShiftPeriodSummary(this.period(), this.anchorKey()).subscribe({
      next: (data) => {
        this.summary.set(data);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.isLoading.set(false);
        this.summary.set(null);
        this.toast.error(err?.error?.message || 'Could not load the shift summary');
      },
    });
  }

  setPeriod(period: 'week' | 'month'): void {
    if (period === this.period()) return;
    this.period.set(period);
    this.load();
  }

  /** Step a whole period at a time, so the arrows move what the label says. */
  step(direction: -1 | 1): void {
    const d = new Date(this.anchor());
    if (this.period() === 'week') d.setDate(d.getDate() + 7 * direction);
    else d.setMonth(d.getMonth() + direction);
    this.anchor.set(d);
    this.load();
  }

  today(): void {
    this.anchor.set(new Date());
    this.load();
  }

  /**
   * Days present as a share of the days anybody was expected.
   *
   * Null rather than 0 when nothing was expected — a shift nobody was rostered
   * on has no attendance rate, and showing 0% would read as everybody failing
   * to turn up.
   */
  attendanceRate(row: ShiftPeriodRow): number | null {
    if (row.workingDays <= 0) return null;
    return Math.round(((row.present + row.halfDay * 0.5) / row.workingDays) * 100);
  }

  /** Average hours per day actually worked, not per day in the period. */
  averageHours(row: ShiftPeriodRow): number | null {
    const worked = row.present + row.halfDay;
    if (worked <= 0) return null;
    return Math.round((row.hours / worked) * 10) / 10;
  }

  hasRows = computed(() => (this.summary()?.shifts.length ?? 0) > 0);

  /**
   * Whether any row is the "no shift recorded" bucket, so the page can explain
   * it. Matched on shiftId rather than the label — the name is display text and
   * would silently stop matching the day somebody reworded it.
   */
  hasUnassigned = computed(() =>
    (this.summary()?.shifts ?? []).some((r) => r.shiftId === null));
}
