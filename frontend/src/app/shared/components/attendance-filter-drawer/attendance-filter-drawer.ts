import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideCalendarDays, LucideSearch, LucideSlidersHorizontal, LucideX } from '@lucide/angular';

export type AttendanceDatePreset =
  | 'ALL'
  | 'TODAY'
  | 'THIS_WEEK'
  | 'THIS_MONTH'
  | 'THIS_YEAR'
  | 'LAST_WEEK'
  | 'LAST_MONTH'
  | 'LAST_YEAR'
  | 'CUSTOM';

export interface AttendanceFilterValue {
  preset: AttendanceDatePreset;
  startDate: string;
  endDate: string;
  employeeQuery: string;
  date?: string;
  periodMonth?: number;
  periodYear?: number;
  filters: Record<string, string>;
}

export interface AttendanceFilterOption {
  value: string;
  label: string;
}

export interface AttendanceFilterGroup {
  key: string;
  label: string;
  options: AttendanceFilterOption[];
  placeholder?: string;
}

@Component({
  selector: 'app-attendance-filter-drawer',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideCalendarDays, LucideSearch, LucideSlidersHorizontal, LucideX],
  templateUrl: './attendance-filter-drawer.html',
  styleUrls: ['./attendance-filter-drawer.css'],
})
export class AttendanceFilterDrawerComponent {
  @Input() open = false;
  @Input() showDates = true;
  @Input() showEmployee = true;
  @Input() employeeLabel = 'Employee name or ID';
  @Input() employeePlaceholder = '';
  @Input() employeeHint = 'Matches employee name and employee ID/code.';
  @Input() title = 'Filters';
  @Input() description = 'Refine the records shown on this page.';
  @Input() filterGroups: AttendanceFilterGroup[] = [];
  @Input() filterValues: Record<string, string> = {};
  @Input() startDate = '';
  @Input() endDate = '';
  @Input() employeeQuery = '';
  @Input() preset: AttendanceDatePreset = 'ALL';
  @Input() datePresetOptions: AttendanceDatePreset[] | null = null;
  @Input() showPeriodControls = false;
  @Input() periodMonth = 0;
  @Input() periodYear = new Date().getFullYear();
  @Input() months: string[] = [];
  @Input() years: number[] = [];
  @Input() showSingleDate = false;
  @Input() selectedDate = '';

  @Output() closed = new EventEmitter<void>();
  @Output() applied = new EventEmitter<AttendanceFilterValue>();

  draftStartDate = '';
  draftEndDate = '';
  draftEmployeeQuery = '';
  draftPreset: AttendanceDatePreset = 'ALL';
  draftPeriodMonth = 0;
  draftPeriodYear = new Date().getFullYear();
  draftDate = '';
  draftFilters: Record<string, string> = {};

  readonly datePresets: { value: AttendanceDatePreset; label: string }[] = [
    { value: 'ALL', label: 'All dates' },
    { value: 'TODAY', label: 'Today' },
    { value: 'THIS_WEEK', label: 'This week' },
    { value: 'THIS_MONTH', label: 'This month' },
    { value: 'THIS_YEAR', label: 'This year' },
    { value: 'LAST_WEEK', label: 'Last week' },
    { value: 'LAST_MONTH', label: 'Last month' },
    { value: 'LAST_YEAR', label: 'Last year' },
    { value: 'CUSTOM', label: 'Custom range' },
  ];

  get availableDatePresets(): { value: AttendanceDatePreset; label: string }[] {
    return this.datePresetOptions
      ? this.datePresets.filter((item) => this.datePresetOptions!.includes(item.value))
      : this.datePresets;
  }

  get invalidDateRange(): boolean {
    const hasStart = !!this.draftStartDate;
    const hasEnd = !!this.draftEndDate;
    return hasStart !== hasEnd || (hasStart && hasEnd && this.draftStartDate > this.draftEndDate);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.open || !changes['open']?.currentValue) return;
    this.draftStartDate = this.startDate;
    this.draftEndDate = this.endDate;
    this.draftEmployeeQuery = this.employeeQuery;
    this.draftPreset = this.preset;
    this.draftPeriodMonth = this.periodMonth;
    this.draftPeriodYear = this.periodYear;
    this.draftDate = this.selectedDate;
    this.draftFilters = { ...this.filterValues };
  }

  onPresetChange(value: AttendanceDatePreset): void {
    this.draftPreset = value;
    if (value === 'CUSTOM') return;
    if (value === 'ALL') {
      this.draftStartDate = '';
      this.draftEndDate = '';
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let start = new Date(today);
    let end = new Date(today);

    switch (value) {
      case 'THIS_WEEK':
        start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
        end = new Date(start);
        end.setDate(end.getDate() + 6);
        break;
      case 'THIS_MONTH':
        start = new Date(today.getFullYear(), today.getMonth(), 1);
        end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        break;
      case 'THIS_YEAR':
        start = new Date(today.getFullYear(), 0, 1);
        end = new Date(today.getFullYear(), 11, 31);
        break;
      case 'LAST_WEEK':
        start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - 7);
        end = new Date(start);
        end.setDate(end.getDate() + 6);
        break;
      case 'LAST_MONTH':
        start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        end = new Date(today.getFullYear(), today.getMonth(), 0);
        break;
      case 'LAST_YEAR':
        start = new Date(today.getFullYear() - 1, 0, 1);
        end = new Date(today.getFullYear() - 1, 11, 31);
        break;
    }

    this.draftStartDate = this.toDateInput(start);
    this.draftEndDate = this.toDateInput(end);
  }

  setDraftPeriodMonth(month: number): void {
    this.draftPeriodMonth = month;
    this.draftDate = '';
  }

  setDraftPeriodYear(year: number): void {
    this.draftPeriodYear = year;
    this.draftDate = '';
  }

  setDraftDate(date: string): void {
    this.draftDate = date;
    if (!date) return;
    const [year, month] = date.split('-').map(Number);
    this.draftPeriodMonth = month - 1;
    this.draftPeriodYear = year;
  }

  apply(): void {
    if (this.invalidDateRange) return;
    this.applied.emit({
      preset: this.draftPreset,
      startDate: this.draftStartDate,
      endDate: this.draftEndDate,
      employeeQuery: this.draftEmployeeQuery.trim(),
      date: this.draftDate,
      periodMonth: this.draftPeriodMonth,
      periodYear: this.draftPeriodYear,
      filters: { ...this.draftFilters },
    });
  }

  reset(): void {
    this.draftPreset = 'ALL';
    this.draftStartDate = '';
    this.draftEndDate = '';
    this.draftEmployeeQuery = '';
    this.draftDate = '';
    this.draftPeriodMonth = new Date().getMonth();
    this.draftPeriodYear = new Date().getFullYear();
    this.draftFilters = Object.fromEntries(this.filterGroups.map((group) => [group.key, '']));
    this.apply();
  }

  private toDateInput(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
