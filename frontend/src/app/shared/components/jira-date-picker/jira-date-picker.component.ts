import {
  Component,
  Input,
  Output,
  EventEmitter,
  ElementRef,
  HostListener,
  forwardRef,
  inject,
  OnInit,
  OnChanges,
  SimpleChanges,
  ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import {
  LucideCalendar,
  LucideChevronLeft,
  LucideChevronRight,
  LucideChevronsLeft,
  LucideChevronsRight,
  LucideChevronDown,
  LucideX,
  LucideClock,
  LucideAlertCircle
} from '@lucide/angular';

export interface CalendarDayCell {
  dayNumber: number;
  dateObj: Date;
  isCurrentMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  isDisabled: boolean;
  isInRange: boolean;
}

@Component({
  selector: 'jira-date-picker, app-jira-date-picker',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideCalendar,
    LucideChevronLeft,
    LucideChevronRight,
    LucideChevronsLeft,
    LucideChevronsRight,
    LucideChevronDown,
    LucideX,
    LucideClock,
    LucideAlertCircle
  ],
  templateUrl: './jira-date-picker.component.html',
  styleUrls: ['./jira-date-picker.component.css'],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => JiraDatePickerComponent),
      multi: true
    }
  ]
})
export class JiraDatePickerComponent implements ControlValueAccessor, OnInit, OnChanges {
  private elementRef = inject(ElementRef);

  @Input() value: string | Date | null = null;
  @Input() placeholder = 'Select date';
  @Input() label = '';
  @Input() clearable = true;
  @Input() disabled = false;
  @Input() readonly = false;
  @Input() minDate: string | Date | null = null;
  @Input() maxDate: string | Date | null = null;
  @Input() rangeStart: string | Date | null = null;
  @Input() rangeEnd: string | Date | null = null;
  @Input() isDueDate = false;
  @Input() size: 'sm' | 'md' = 'md';
  @Input() showIcon = true;
  @Input() inline = false;
  @Input() showTime = false;
  @Input() timeValue = '12:00';
  @Input() panelPosition: 'auto' | 'top' | 'bottom' = 'auto';

  @Output() dateChange = new EventEmitter<string | null>();
  @Output() valueChange = new EventEmitter<string | null>();
  @Output() timeChange = new EventEmitter<string>();
  @Output() cleared = new EventEmitter<void>();

  @ViewChild('triggerBtn') triggerBtnRef?: ElementRef;

  isOpen = false;
  viewDate: Date = new Date();
  hoverDate: Date | null = null;
  selectedDate: Date | null = null;
  isYearMonthView = false;
  dropdownPosition = { top: '100%', bottom: 'auto', left: '0', right: 'auto' };

  months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  timeOptions: string[] = [];

  // ControlValueAccessor callbacks
  private onChange: (val: any) => void = () => {};
  private onTouched: () => void = () => {};

  ngOnInit() {
    this.generateTimeOptions();
    this.syncValue(this.value);
  }

  trackByCell = (_index: number, cell: CalendarDayCell): number => {
    return cell.dateObj.getTime();
  };

  trackByIndex = (index: number): number => {
    return index;
  };

  ngOnChanges(changes: SimpleChanges) {
    if (changes['value']) {
      const incoming = changes['value'].currentValue;
      const parsed = incoming ? (incoming instanceof Date ? incoming : this.parseDateString(incoming)) : null;
      const curTime = this.selectedDate ? new Date(this.selectedDate.getFullYear(), this.selectedDate.getMonth(), this.selectedDate.getDate()).getTime() : null;
      const newTime = parsed ? new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()).getTime() : null;
      if (curTime !== newTime) {
        this.syncValue(this.value);
      }
    }
  }

  private generateTimeOptions() {
    const list: string[] = [];
    for (let h = 0; h < 24; h++) {
      for (const m of [0, 30]) {
        const hh = h.toString().padStart(2, '0');
        const mm = m.toString().padStart(2, '0');
        list.push(`${hh}:${mm}`);
      }
    }
    if (this.timeValue && !list.includes(this.timeValue)) {
      list.unshift(this.timeValue);
    }
    this.timeOptions = list;
  }

  // ControlValueAccessor methods
  writeValue(obj: any): void {
    this.syncValue(obj);
  }

  registerOnChange(fn: any): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: any): void {
    this.onTouched = fn;
  }

  setDisabledState?(isDisabled: boolean): void {
    this.disabled = isDisabled;
  }

  private syncValue(val: string | Date | null) {
    if (!val) {
      this.selectedDate = null;
      return;
    }

    if (val instanceof Date) {
      this.selectedDate = isNaN(val.getTime()) ? null : new Date(val);
    } else if (typeof val === 'string') {
      const parsed = this.parseDateString(val);
      this.selectedDate = parsed;
    } else {
      this.selectedDate = null;
    }

    if (this.selectedDate) {
      this.viewDate = new Date(this.selectedDate);
    }
  }

  parseDateString(str: string): Date | null {
    if (!str || !str.trim()) return null;
    str = str.trim();

    // Check if ISO date string (YYYY-MM-DD or full ISO)
    if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
      const d = new Date(str);
      return isNaN(d.getTime()) ? null : d;
    }

    // Check if DD/MM/YYYY
    if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(str)) {
      const parts = str.split('/');
      const day = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const year = parseInt(parts[2], 10);
      const d = new Date(year, month, day);
      if (d.getFullYear() === year && d.getMonth() === month && d.getDate() === day) {
        return d;
      }
    }

    const fallback = new Date(str);
    return isNaN(fallback.getTime()) ? null : fallback;
  }

  get formattedDisplay(): string {
    if (!this.selectedDate) return '';
    const day = this.selectedDate.getDate();
    const month = this.months[this.selectedDate.getMonth()].substring(0, 3);
    const year = this.selectedDate.getFullYear();
    return `${day} ${month} ${year}`;
  }

  get isOverdue(): boolean {
    if (!this.isDueDate || !this.selectedDate) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const sel = new Date(this.selectedDate);
    sel.setHours(0, 0, 0, 0);
    return sel.getTime() < today.getTime();
  }

  get isDueToday(): boolean {
    if (!this.isDueDate || !this.selectedDate) return false;
    return this.isSameDay(this.selectedDate, new Date());
  }

  get relativeBadge(): string | null {
    if (!this.isDueDate || !this.selectedDate) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const sel = new Date(this.selectedDate);
    sel.setHours(0, 0, 0, 0);
    const diffDays = Math.round((sel.getTime() - today.getTime()) / 86400000);
    if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`;
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Tomorrow';
    return null;
  }

  get currentMonthName(): string {
    return this.months[this.viewDate.getMonth()];
  }

  get currentYear(): number {
    return this.viewDate.getFullYear();
  }

  get availableYears(): number[] {
    const curr = this.currentYear;
    const years: number[] = [];
    for (let y = curr - 5; y <= curr + 7; y++) {
      years.push(y);
    }
    return years;
  }

  get isTodayDisabled(): boolean {
    return this.isDateDisabled(new Date());
  }

  get calendarGrid(): CalendarDayCell[] {
    const year = this.viewDate.getFullYear();
    const month = this.viewDate.getMonth();

    const firstDay = new Date(year, month, 1);
    // Monday = 0, Sunday = 6
    const dayOfWeek = (firstDay.getDay() + 6) % 7;

    const prevMonthLastDate = new Date(year, month, 0).getDate();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const today = new Date();
    const cells: CalendarDayCell[] = [];

    // Prev month padding
    for (let i = dayOfWeek - 1; i >= 0; i--) {
      const dNum = prevMonthLastDate - i;
      const dObj = new Date(year, month - 1, dNum);
      cells.push(this.createCell(dNum, dObj, false, today));
    }

    // Current month
    for (let i = 1; i <= daysInMonth; i++) {
      const dObj = new Date(year, month, i);
      cells.push(this.createCell(i, dObj, true, today));
    }

    // Next month padding to fill 42 cells (6 full weeks)
    const total = cells.length;
    const remaining = 42 - total;
    for (let i = 1; i <= remaining; i++) {
      const dObj = new Date(year, month + 1, i);
      cells.push(this.createCell(i, dObj, false, today));
    }

    return cells;
  }

  private createCell(dayNumber: number, dObj: Date, isCurrentMonth: boolean, today: Date): CalendarDayCell {
    const isToday = this.isSameDay(dObj, today);
    const isSelected = !!this.selectedDate && this.isSameDay(dObj, this.selectedDate);
    const isDisabled = this.isDateDisabled(dObj);
    const isInRange = this.isDateInRange(dObj);

    return {
      dayNumber,
      dateObj: dObj,
      isCurrentMonth,
      isToday,
      isSelected,
      isDisabled,
      isInRange
    };
  }

  private isSameDay(d1: Date, d2: Date): boolean {
    return (
      d1.getFullYear() === d2.getFullYear() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getDate() === d2.getDate()
    );
  }

  private isDateDisabled(d: Date): boolean {
    const dZero = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

    if (this.minDate) {
      const min = typeof this.minDate === 'string' ? this.parseDateString(this.minDate) : this.minDate;
      if (min && !isNaN(min.getTime())) {
        const minZero = new Date(min.getFullYear(), min.getMonth(), min.getDate()).getTime();
        if (dZero < minZero) return true;
      }
    }
    if (this.maxDate) {
      const max = typeof this.maxDate === 'string' ? this.parseDateString(this.maxDate) : this.maxDate;
      if (max && !isNaN(max.getTime())) {
        const maxZero = new Date(max.getFullYear(), max.getMonth(), max.getDate()).getTime();
        if (dZero > maxZero) return true;
      }
    }
    return false;
  }

  private isDateInRange(d: Date): boolean {
    const dTime = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    
    // When rangeStart is set (e.g. startDate), and we are picking due date
    if (this.rangeStart && !this.rangeEnd) {
      const start = typeof this.rangeStart === 'string' ? this.parseDateString(this.rangeStart) : this.rangeStart;
      if (start && !isNaN(start.getTime())) {
        const startTime = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
        const targetTime = this.hoverDate 
          ? new Date(this.hoverDate.getFullYear(), this.hoverDate.getMonth(), this.hoverDate.getDate()).getTime()
          : (this.selectedDate ? new Date(this.selectedDate.getFullYear(), this.selectedDate.getMonth(), this.selectedDate.getDate()).getTime() : null);
        if (targetTime && targetTime >= startTime) {
          return dTime >= startTime && dTime <= targetTime;
        }
      }
    }

    // When rangeStart and rangeEnd are both set
    if (this.rangeStart && this.rangeEnd) {
      const start = typeof this.rangeStart === 'string' ? this.parseDateString(this.rangeStart) : this.rangeStart;
      const end = typeof this.rangeEnd === 'string' ? this.parseDateString(this.rangeEnd) : this.rangeEnd;
      if (start && end && !isNaN(start.getTime()) && !isNaN(end.getTime())) {
        const sTime = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
        const eTime = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
        if (sTime <= eTime) {
          return dTime >= sTime && dTime <= eTime;
        }
      }
    }

    return false;
  }

  onCellHover(cell: CalendarDayCell) {
    if (this.rangeStart && !this.rangeEnd && !cell.isDisabled) {
      if (!this.hoverDate || this.hoverDate.getTime() !== cell.dateObj.getTime()) {
        this.hoverDate = cell.dateObj;
      }
    }
  }

  onCellLeave() {
    if (this.hoverDate) {
      this.hoverDate = null;
    }
  }

  toggleDropdown(event?: MouseEvent) {
    if (this.disabled || this.readonly) return;
    if (event) {
      event.stopPropagation();
    }

    if (this.isOpen) {
      this.closeDropdown();
    } else {
      this.openDropdown();
    }
  }

  openDropdown() {
    if (this.disabled || this.readonly) return;
    if (this.selectedDate) {
      this.viewDate = new Date(this.selectedDate);
    } else if (this.minDate) {
      const min = typeof this.minDate === 'string' ? this.parseDateString(this.minDate) : this.minDate;
      this.viewDate = min && !isNaN(min.getTime()) ? new Date(min) : new Date();
    } else {
      this.viewDate = new Date();
    }
    this.isYearMonthView = false;
    this.calculatePosition();
    this.isOpen = true;
  }

  closeDropdown() {
    this.isOpen = false;
    this.isYearMonthView = false;
    this.hoverDate = null;
    this.onTouched();
  }

  private calculatePosition() {
    if (!this.elementRef) return;
    const rect = this.elementRef.nativeElement.getBoundingClientRect();
    const dropdownHeight = 330;
    const windowHeight = window.innerHeight;

    let openUpward = false;
    if (this.panelPosition === 'top') {
      openUpward = true;
    } else if (this.panelPosition === 'bottom') {
      openUpward = false;
    } else {
      // Auto: if not enough space below and enough space above
      const spaceBelow = windowHeight - rect.bottom;
      if (spaceBelow < dropdownHeight && rect.top > dropdownHeight) {
        openUpward = true;
      }
    }

    if (openUpward) {
      this.dropdownPosition = {
        top: 'auto',
        bottom: 'calc(100% + 4px)',
        left: '0',
        right: 'auto'
      };
    } else {
      this.dropdownPosition = {
        top: 'calc(100% + 4px)',
        bottom: 'auto',
        left: '0',
        right: 'auto'
      };
    }
  }

  prevMonth(event?: MouseEvent) {
    if (event) event.stopPropagation();
    this.viewDate = new Date(this.viewDate.getFullYear(), this.viewDate.getMonth() - 1, 1);
  }

  nextMonth(event?: MouseEvent) {
    if (event) event.stopPropagation();
    this.viewDate = new Date(this.viewDate.getFullYear(), this.viewDate.getMonth() + 1, 1);
  }

  prevYear(event?: MouseEvent) {
    if (event) event.stopPropagation();
    this.viewDate = new Date(this.viewDate.getFullYear() - 1, this.viewDate.getMonth(), 1);
  }

  nextYear(event?: MouseEvent) {
    if (event) event.stopPropagation();
    this.viewDate = new Date(this.viewDate.getFullYear() + 1, this.viewDate.getMonth(), 1);
  }

  setMonth(monthIndex: number, event?: MouseEvent) {
    if (event) event.stopPropagation();
    this.viewDate = new Date(this.viewDate.getFullYear(), monthIndex, 1);
    this.isYearMonthView = false;
  }

  setYear(year: number, event?: MouseEvent) {
    if (event) event.stopPropagation();
    this.viewDate = new Date(year, this.viewDate.getMonth(), 1);
  }

  toggleYearMonthView(event?: MouseEvent) {
    if (event) event.stopPropagation();
    this.isYearMonthView = !this.isYearMonthView;
  }

  selectDay(cell: CalendarDayCell, event?: MouseEvent) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (cell.isDisabled) return;

    const d = cell.dateObj;
    this.selectedDate = new Date(d);

    // If day was from edge month, update view
    if (!cell.isCurrentMonth) {
      this.viewDate = new Date(d.getFullYear(), d.getMonth(), 1);
    }

    this.emitSelection(this.selectedDate);
    if (!this.inline) {
      this.closeDropdown();
    }
  }

  selectToday(event?: MouseEvent) {
    if (event) event.stopPropagation();
    const today = new Date();
    if (this.isDateDisabled(today)) return;

    this.selectedDate = new Date(today);
    this.viewDate = new Date(today);
    this.emitSelection(this.selectedDate);
    if (!this.inline) {
      this.closeDropdown();
    }
  }

  clearDate(event?: MouseEvent) {
    if (event) event.stopPropagation();
    if (this.disabled || this.readonly) return;

    this.selectedDate = null;
    this.emitSelection(null);
    this.cleared.emit();
    if (!this.inline) {
      this.closeDropdown();
    }
  }

  onTimeChange(val: string) {
    this.timeValue = val;
    this.timeChange.emit(val);
    if (this.selectedDate) {
      this.emitSelection(this.selectedDate);
    }
  }

  private emitSelection(date: Date | null) {
    if (!date) {
      this.value = null;
      this.onChange(null);
      this.dateChange.emit(null);
      this.valueChange.emit(null);
      return;
    }

    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');

    let isoOutput: string;
    if (this.showTime && this.timeValue) {
      const timeParts = this.timeValue.split(':');
      const h = parseInt(timeParts[0] || '12', 10);
      const m = parseInt(timeParts[1] || '0', 10);
      const withTime = new Date(year, date.getMonth(), date.getDate(), h, m, 0);
      isoOutput = withTime.toISOString();
    } else {
      // Clean ISO date string at noon to prevent any timezone shifts
      const localDate = new Date(year, date.getMonth(), date.getDate(), 12, 0, 0);
      isoOutput = localDate.toISOString();
    }

    this.value = isoOutput;
    this.onChange(isoOutput);
    this.dateChange.emit(isoOutput);
    this.valueChange.emit(isoOutput);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (this.inline) return;
    if (!this.isOpen) return;

    const clickedInside = this.elementRef.nativeElement.contains(event.target);
    if (!clickedInside) {
      this.closeDropdown();
    }
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    if (this.isOpen) {
      this.closeDropdown();
    }
  }
}
