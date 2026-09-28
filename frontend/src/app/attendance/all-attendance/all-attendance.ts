import { Component, OnInit, signal, computed, inject, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HotToastService } from '@ngneat/hot-toast';
import {
  LucideCalendarClock, LucideRotateCcw, LucideSearch, LucideX,
  LucideChevronDown, LucideChevronLeft, LucideChevronRight, LucideCheck, LucideFilter, LucideDownload,
  LucideRefreshCw, LucideUserCheck, LucideUserX, LucideClock,
  LucideAlertTriangle, LucideDoorOpen, LucideCalendarDays,
  LucideBuilding, LucideUser, LucideTimer, LucideTimerOff, LucideCheckCircle2,
  LucideLayers, LucideEye, LucideMapPin, LucideInbox,
  LucideArrowUpDown, LucideSparkles, LucideStarHalf, LucideAlertCircle,
  LucidePlane, LucideStar, LucideCalendar, LucideLayoutGrid, LucideList,
  LucideZap, LucideExternalLink, LucideTrophy, LucideAward
} from '@lucide/angular';
import { AttendanceService, AttendanceRecord } from '../../services/attendance';
import { isWeeklyOff } from '../../shared/utils/weekly-offs';
import { MasterDataService, Department } from '../../services/master-data.service';
import { EmployeeService, Employee } from '../../services/employee.service';

export interface DayMatrixStatus {
  dayNumber: number;
  weekdayStr: string;
  date: Date;
  dateStr: string;
  isWeekend: boolean;
  isFuture: boolean;
  status: 'Present' | 'Half Day' | 'Late' | 'Absent' | 'On Leave' | 'Holiday' | 'Day Off' | 'Empty';
  tooltip: string;
  record?: AttendanceRecord;
  /** Why this day carries the status it does — shown on hover. */
  reason?: string;
  /** This day counts towards the row's "present" tally. */
  countsPresent?: boolean;
  /** This day counts towards the row's "working days" denominator. */
  countsWorking?: boolean;
}

export interface EmployeeMatrixRow {
  employee: any;
  days: DayMatrixStatus[];
  totalPresent: number;
  totalWorkingDays: number;
}

@Component({
  selector: 'app-all-attendance',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    LucideCalendarClock, LucideRotateCcw, LucideSearch, LucideX,
    LucideChevronDown, LucideChevronLeft, LucideChevronRight, LucideCheck, LucideFilter, LucideDownload,
    LucideRefreshCw, LucideUserCheck, LucideUserX, LucideClock,
    LucideAlertTriangle, LucideDoorOpen, LucideCalendarDays,
    LucideBuilding, LucideUser, LucideTimer, LucideTimerOff, LucideCheckCircle2,
    LucideLayers, LucideEye, LucideMapPin, LucideInbox,
    LucideArrowUpDown, LucideSparkles, LucideStarHalf, LucideAlertCircle,
    LucidePlane, LucideStar, LucideCalendar, LucideLayoutGrid, LucideList,
    LucideZap, LucideExternalLink, LucideTrophy, LucideAward
  ],
  templateUrl: './all-attendance.html',
  styleUrls: ['./all-attendance.css']
})
export class AllAttendanceComponent implements OnInit {
  private attendanceService = inject(AttendanceService);
  private masterDataService = inject(MasterDataService);
  private employeeService = inject(EmployeeService);
  private toast = inject(HotToastService);

  viewMode = signal<'grid' | 'table'>('grid');
  records = signal<AttendanceRecord[]>([]);
  employees = signal<Employee[]>([]);
  departments = signal<Department[]>([]);
  holidays = signal<any[]>([]);
  isLoading = signal(false);
  selectedRecord = signal<AttendanceRecord | null>(null);

  // Selected Day Details for Modal (matching Screenshot 3)
  selectedDayDetails = signal<{
    employeeName: string;
    employeeEmail: string;
    employeeDesignation: string;
    employeeDept: string;
    employeeRole: string;
    employeeAvatarUrl: string | null;
    date: Date;
    status: string;
    logs: any[];
    durationStr: string;
    isToday: boolean;
    /** Nobody clocked out — the 23:00 sweep closed the day. */
    autoClockedOut: boolean;
    /**
     * The day was closed late (after IST midnight) and the employee was asked
     * for a reason for the missed clock-out. Showed in the day modal.
     */
    missedClockOutReason: string | null;
  } | null>(null);
  isDetailsModalOpen = signal(false);
  /** Floating tooltip state positioned dynamically to avoid table overflow clipping. */
  hoveredTooltip = signal<{
    day: DayMatrixStatus;
    top: number;
    left: number;
    placement: 'top' | 'bottom';
    arrowLeft: number;
  } | null>(null);

  months = [
    { value: 1, label: 'January' }, { value: 2, label: 'February' }, { value: 3, label: 'March' },
    { value: 4, label: 'April' }, { value: 5, label: 'May' }, { value: 6, label: 'June' },
    { value: 7, label: 'July' }, { value: 8, label: 'August' }, { value: 9, label: 'September' },
    { value: 10, label: 'October' }, { value: 11, label: 'November' }, { value: 12, label: 'December' }
  ];
  years: number[] = [];

  // Active Filter state
  filterMonth = new Date().getMonth() + 1;
  filterYear = new Date().getFullYear();
  /** Exact date (yyyy-mm-dd, local) override to show that single day only. */
  private _filterDate = signal<string | null>(null);
  get filterDate(): string | null {
    return this._filterDate();
  }
  set filterDate(v: string | null) {
    this._filterDate.set(v || null);
  }

  /** Bumped on every load() so month/year-dependent computed()s re-evaluate. */
  periodVersion = signal(0);
  filterEmployeeId: number | null = null;
  filterDepartmentId: number | null = null;

  private _filterStatus = signal<string>('');
  get filterStatus(): string {
    return this._filterStatus();
  }
  set filterStatus(v: string) {
    this._filterStatus.set(v || '');
  }

  private _filterFlag = signal<'ALL' | 'LATE' | 'EARLY' | 'ON_TIME' | 'MISSING_OUT'>('ALL');
  get filterFlag(): 'ALL' | 'LATE' | 'EARLY' | 'ON_TIME' | 'MISSING_OUT' {
    return this._filterFlag();
  }
  set filterFlag(v: 'ALL' | 'LATE' | 'EARLY' | 'ON_TIME' | 'MISSING_OUT') {
    this._filterFlag.set(v || 'ALL');
  }

  searchQuery = signal('');
  sortBy: 'date_desc' | 'date_asc' | 'name_asc' | 'hours_desc' = 'date_desc';

  // Searchable Dropdown state
  showMonthDropdown = false;
  monthSearchQuery = '';

  showYearDropdown = false;
  yearSearchQuery = '';

  showEmployeeDropdown = false;
  employeeSearchQuery = '';

  showDeptDropdown = false;
  deptSearchQuery = '';

  showStatusDropdown = false;
  statusSearchQuery = '';

  showFlagDropdown = false;
  flagSearchQuery = '';

  readonly statusOptions = [
    { value: '', label: 'All Statuses', icon: '', bgClass: '', iconClass: '' },
    { value: 'Present', label: 'Present', icon: 'check', bgClass: 'bg-present', iconClass: 'status-present' },
    { value: 'Half Day', label: 'Half Day', icon: 'star-half', bgClass: 'bg-half-day', iconClass: 'status-half-day' },
    { value: 'Late', label: 'Late', icon: 'alert-circle', bgClass: 'bg-late', iconClass: 'status-late' },
    { value: 'Absent', label: 'Absent', icon: 'x', bgClass: 'bg-absent', iconClass: 'status-absent' },
    { value: 'On Leave', label: 'On Leave', icon: 'plane', bgClass: 'bg-leave', iconClass: 'status-leave' },
    { value: 'Holiday', label: 'Holiday', icon: 'star', bgClass: 'bg-holiday', iconClass: 'status-holiday' },
    { value: 'Day Off', label: 'Day Off', icon: 'calendar', bgClass: 'bg-day-off', iconClass: 'status-day-off' },
    { value: 'Overtime', label: 'Overtime', icon: 'zap', bgClass: 'bg-overtime', iconClass: 'status-overtime' },
    { value: 'Missed Clock Out', label: 'Missed Clock Out', icon: 'timer-off', bgClass: 'bg-clockoff', iconClass: 'status-clockoff' }
  ];

  get statusTags() {
    return this.statusOptions.filter(s => !!s.value);
  }

  readonly flagOptions = [
    { value: 'ALL', label: 'All Flags / Logs' },
    { value: 'EARLY', label: 'Early Departure' }
  ];

  constructor() {
    const current = new Date().getFullYear();
    this.years = [current - 2, current - 1, current, current + 1];
  }

  ngOnInit() {
    this.employeeService.getEmployeesBasicList().subscribe({ next: (res) => this.employees.set(res || []) });
    this.masterDataService.getDepartments(true).subscribe({ next: (res) => this.departments.set(res || []) });
    this.masterDataService.getHolidays().subscribe({ next: (res: any) => this.holidays.set(res || []) });
    this.load();
  }

  load() {
    // filterMonth/filterYear are plain properties, so computed() signals can't see
    // them change. Bump this version so daysOfMonth (and the grid that derives from
    // it) recompute for the newly selected month instead of reusing the first one.
    this.periodVersion.update(v => v + 1);
    this.isLoading.set(true);
    this.attendanceService.getAllEmployeesAttendance({
      month: this.filterMonth,
      year: this.filterYear,
      employeeId: this.filterEmployeeId || undefined,
      departmentId: this.filterDepartmentId || undefined
    }).subscribe({
      next: (res) => {
        this.records.set(res || []);
        this.isLoading.set(false);
      },
      error: () => {
        this.toast.error('Failed to load attendance records');
        this.isLoading.set(false);
      }
    });
  }

  // Month navigation
  prevMonth() {
    this.filterDate = null;
    if (this.filterMonth === 1) {
      this.filterMonth = 12;
      this.filterYear--;
    } else {
      this.filterMonth--;
    }
    this.load();
  }

  nextMonth() {
    this.filterDate = null;
    if (this.filterMonth === 12) {
      this.filterMonth = 1;
      this.filterYear++;
    } else {
      this.filterMonth++;
    }
    this.load();
  }

  jumpToCurrentMonth() {
    const now = new Date();
    this.filterMonth = now.getMonth() + 1;
    this.filterYear = now.getFullYear();
    this.filterDate = null;
    this.load();
  }

  getBackendDateString(date: Date | string): string {
    const d = new Date(date);
    return d.toISOString().split('T')[0];
  }

  getLocalDateString(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // Days in month calculation for the grid header
  daysOfMonth = computed(() => {
    this.periodVersion();          // dependency: re-run when the month/year changes
    const year = this.filterYear;
    const month = this.filterMonth;
    const totalDays = new Date(year, month, 0).getDate();
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const days = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let dayNum = 1; dayNum <= totalDays; dayNum++) {
      const date = new Date(year, month - 1, dayNum);
      // Kept only for the column header's shading. Whether the day is actually
      // OFF is a question about a person, not a date, and is answered per
      // employee below against their branch's weeklyOffs.
      const isWeekend = date.getDay() === 0 || date.getDay() === 6;
      const isFuture = date > today;
      const weekdayStr = weekdays[date.getDay()];
      const dateStr = this.getLocalDateString(date);

      days.push({
        dayNumber: dayNum,
        weekdayStr,
        date,
        dateStr,
        isWeekend,
        isFuture
      });
    }
    return days;
  });

  /**
   * The day columns the grid actually renders. A date filter means "show me
   * that day", so it narrows the grid to that one column rather than drawing
   * the whole month and tinting one cell in it.
   */
  visibleDaysOfMonth = computed(() => {
    const only = this.filterDate;
    const days = this.daysOfMonth();
    return only ? days.filter(d => d.dateStr === only) : days;
  });

  // Employee rows for the Monthly Matrix Grid
  employeeGridRows = computed<EmployeeMatrixRow[]>(() => {
    const records = this.records();
    const allEmps = this.employees();
    const holidays = this.holidays();
    const days = this.daysOfMonth();
    const q = this.searchQuery().toLowerCase().trim();

    const recordMap = new Map<string, AttendanceRecord>();
    records.forEach(r => {
      const dateStr = this.getBackendDateString(r.date);
      recordMap.set(`${r.employeeId}_${dateStr}`, r);
    });

    const empMap = new Map<number, any>();
    allEmps.forEach(e => empMap.set(e.id, { ...e }));
    records.forEach(r => {
      if (r.employee) {
        const existing = empMap.get(r.employeeId);
        if (existing) {
          empMap.set(r.employeeId, {
            ...existing,
            ...r.employee,
            department: r.employee.department || existing.department,
            designation: r.employee.designation || existing.designation,
            user: r.employee.user || existing.user,
          });
        } else {
          empMap.set(r.employeeId, r.employee);
        }
      }
    });

    let emps = Array.from(empMap.values());

    if (this.filterEmployeeId) {
      emps = emps.filter(e => e.id === this.filterEmployeeId);
    }
    if (this.filterDepartmentId) {
      emps = emps.filter(e => e.departmentId === this.filterDepartmentId || e.department?.id === this.filterDepartmentId);
    }
    if (q) {
      emps = emps.filter(e => {
        const name = `${e.firstName || ''} ${e.lastName || ''}`.toLowerCase();
        const dept = (e.department?.name || '').toLowerCase();
        const desig = (e.designation?.name || '').toLowerCase();
        const code = (e.employeeCode || '').toLowerCase();
        return name.includes(q) || dept.includes(q) || desig.includes(q) || code.includes(q);
      });
    }

    const statusFilter = this.filterStatus;
    const dateFilter = this.filterDate;

    let rows: EmployeeMatrixRow[] = emps.map(emp => {
      // This person's own days off, not a hardcoded Saturday and Sunday. Every
      // branch here is "0" — Sunday only — which made every Saturday read as a
      // day off: absences on Saturdays were invisible, and Saturdays worked
      // inflated the present tally without ever entering the denominator.
      const weeklyOffs = emp.branch?.weeklyOffs;

      const dayCells: DayMatrixStatus[] = days.map(day => {
        let countsPresent = false;
        let countsWorking = false;
        const key = `${emp.id}_${day.dateStr}`;
        const record = recordMap.get(key);
        const holiday = holidays.find(h => this.getBackendDateString(h.date) === day.dateStr);
        const isDayOff = isWeeklyOff(day.date, weeklyOffs);

        let status: 'Present' | 'Half Day' | 'Late' | 'Absent' | 'On Leave' | 'Holiday' | 'Day Off' | 'Empty' = 'Empty';
        let tooltip = '';

        if (day.isFuture) {
          status = 'Empty';
          tooltip = `${day.dayNumber} ${day.weekdayStr} - Upcoming`;
        } else if (record && record.clockIn) {
          if (record.status === 'HALF_DAY') {
            status = 'Half Day';
          } else if (record.isLate) {
            status = 'Late';
          } else {
            status = 'Present';
          }

          const inTime = this.formatTime(record.clockIn);
          const outTime = record.clockOut ? this.formatTime(record.clockOut) : '...';
          tooltip = `In: ${inTime} · Out: ${outTime}`;
          if (record.overtimeHours && record.overtimeHours > 0) {
            tooltip += ` · Overtime ${record.overtimeHours}h`;
          }
          if (record.clockOutReason) {
            tooltip += ' · Missed clock out';
          }
          if (['Present', 'Late', 'Half Day'].includes(status)) {
            countsPresent = true;
            // A day actually worked belongs in both halves of the fraction.
            // Counting it as present but not as a working day is what produced
            // totals like "23/20", where the numerator could exceed the
            // denominator and the ratio stopped meaning anything.
            countsWorking = true;
          } else if (!isDayOff && !holiday) {
            countsWorking = true;
          }
        } else if (record && record.status === 'ON_LEAVE') {
          status = 'On Leave';
          tooltip = 'On Leave';
        } else if (holiday || (record && record.status === 'HOLIDAY')) {
          status = 'Holiday';
          tooltip = (holiday && holiday.name) || 'Holiday';
        } else if (isDayOff || (record && record.status === 'WEEKLY_OFF')) {
          status = 'Day Off';
          tooltip = 'Weekly Day Off';
        } else {
          status = 'Absent';
          tooltip = 'Absent (No punch recorded)';
          countsWorking = true;
        }

        const reason = this.statusReason(status, record, holiday);

        return {
          dayNumber: day.dayNumber,
          weekdayStr: day.weekdayStr,
          date: day.date,
          dateStr: day.dateStr,
          // The cell's own answer, not the calendar's.
          isWeekend: isDayOff,
          isFuture: day.isFuture,
          status,
          tooltip: reason ? `${tooltip} · ${reason}` : tooltip,
          reason,
          record,
          countsPresent,
          countsWorking
        };
      });

      // A date filter narrows the grid to that one day, so the row's tally has
      // to describe the days on screen — a 1-column grid showing "20/22" is
      // reporting on columns the viewer cannot see.
      const visibleCells = dateFilter
        ? dayCells.filter(d => d.dateStr === dateFilter)
        : dayCells;

      return {
        employee: emp,
        days: visibleCells,
        totalPresent: visibleCells.filter(d => d.countsPresent).length,
        totalWorkingDays: visibleCells.filter(d => d.countsWorking).length || 1
      };
    });

    // When status filter is active, only show employees who have at least one matching day
    if (statusFilter) {
      rows = rows.filter(row => row.days.some(day => this.dayMatchesStatus(day)));
    }

    // When date filter is active, only show employees who have a record or are active on that date
    if (dateFilter) {
      rows = rows.filter(row => row.days.some(day => day.record || !day.isFuture));
    }

    return rows;
  });

  /**
   * §Att6: Top Attendance Performers.
   * Calculates the best attendance records based on total present days,
   * punctuality (fewest late days), and total working days.
   */
  topPerformers = computed(() => {
    const rows = this.employeeGridRows();
    if (!rows || rows.length === 0) return [];
    
    // We want employees who have recorded attendance in this period
    let candidates = rows.map(r => {
      // If employee worked extra shifts/weekends, present can exceed scheduled working days,
      // but standard attendance rate cannot exceed 100%.
      const workingDenominator = Math.max(r.totalWorkingDays, 1);
      const rawPct = (r.totalPresent / workingDenominator) * 100;
      const pct = Math.min(100, Math.round(rawPct));
      
      let onTime = 0;
      let totalPresents = 0;
      let lateCount = 0;
      r.days.forEach(d => {
        if (d.countsPresent) {
          totalPresents++;
          if (d.record && !d.record.isLate) {
            onTime++;
          } else if (d.record && d.record.isLate) {
            lateCount++;
          }
        }
      });
      
      const punctualityRate = totalPresents > 0 ? (onTime / totalPresents) * 100 : 0;
      const punctuality = Math.round(punctualityRate);

      // Composite performance score:
      // High attendance (60%) + High punctuality (40%) + bonus for extra working days
      const extraDaysBonus = Math.min(5, Math.max(0, r.totalPresent - r.totalWorkingDays));
      const compositeScore = (pct * 0.60) + (punctuality * 0.40) + extraDaysBonus;

      return {
        emp: r.employee,
        pct: pct,
        punctuality: punctuality,
        presentDays: r.totalPresent,
        workingDays: r.totalWorkingDays,
        onTimeDays: onTime,
        lateDays: lateCount,
        score: compositeScore
      };
    }).filter(c => c.presentDays > 0);

    // Sort by composite score descending, then punctuality, then presentDays
    candidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.pct !== a.pct) return b.pct - a.pct;
      if (b.punctuality !== a.punctuality) return b.punctuality - a.punctuality;
      return b.presentDays - a.presentDays;
    });

    const rankMeta = [
      { title: 'Top Performer', tier: 'Gold Tier', badge: '1st Place', class: 'rank-gold', icon: 'trophy' },
      { title: 'Runner Up', tier: 'Silver Tier', badge: '2nd Place', class: 'rank-silver', icon: 'medal' },
      { title: 'Honorable Mention', tier: 'Bronze Tier', badge: '3rd Place', class: 'rank-bronze', icon: 'award' }
    ];

    return candidates.slice(0, 3).map((c, idx) => ({
      ...c,
      meta: rankMeta[idx] || rankMeta[2],
      rankNumber: idx + 1
    }));
  });

  /**
   * Everything the filter bar narrows EXCEPT the status and flag filters.
   *
   * The KPI cards are themselves the status filter (clicking "Late" sets
   * filterStatus), so the cards have to count a set that the card's own
   * filter has not already narrowed — otherwise picking one card zeroes
   * every other card and there is no way to read your way back out.
   */
  baseFilteredRecords = computed(() => {
    let list = this.records();
    const q = this.searchQuery().toLowerCase().trim();

    // 1. Exact-date filter (show that single day only)
    if (this.filterDate) {
      list = list.filter(r => this.getBackendDateString(r.date) === this.filterDate);
    }

    // 2. Text Search (Employee name, department)
    if (q) {
      list = list.filter(r => {
        const name = `${r.employee?.firstName || ''} ${r.employee?.lastName || ''}`.toLowerCase();
        const dept = (r.employee?.department?.name || '').toLowerCase();
        return name.includes(q) || dept.includes(q);
      });
    }

    return list;
  });

  /**
   * Computed metrics. Counted over the filtered set, not the whole month, so
   * the KPI row and the table below it always describe the same records.
   *
   * Statuses come from recordDayStatus() — the same function the status
   * filter and the grid cells use — so a card's number and the rows you get
   * from clicking that card cannot disagree.
   */
  stats = computed(() => {
    const list = this.baseFilteredRecords();
    const total = list.length;
    const byStatus = (name: string) => list.filter(r => this.recordDayStatus(r) === name).length;

    const present = byStatus('Present');
    const halfDay = byStatus('Half Day');
    const absent = byStatus('Absent');
    const onLeave = byStatus('On Leave');
    const late = list.filter(r => r.isLate).length;
    const early = list.filter(r => r.isEarlyLeave).length;
    const missedClockOut = list.filter(r => this.isMissedClockOut(r)).length;

    // On-time rate is a share of the days actually worked, not of every row —
    // leave, holidays and days off are not late and should not dilute it.
    const worked = list.filter(r => !!r.clockIn).length;
    const onTime = present;
    const onTimeRate = worked > 0 ? Math.round((onTime / worked) * 100) : 0;

    return {
      total,
      present,
      halfDay,
      absent,
      onLeave,
      late,
      early,
      missedClockOut,
      onTime,
      onTimeRate
    };
  });

  // Filtered & Sorted Records
  filteredRecords = computed(() => {
    let list = [...this.baseFilteredRecords()];

    // 1. Attendance Status filter (client-side, mirrors the grid's day-status)
    if (this.filterStatus) {
      list = list.filter(r => this.recordMatchesStatus(r));
    }

    // 2. Flag filter
    if (this.filterFlag === 'LATE') {
      list = list.filter(r => r.isLate);
    } else if (this.filterFlag === 'EARLY') {
      list = list.filter(r => r.isEarlyLeave);
    } else if (this.filterFlag === 'ON_TIME') {
      list = list.filter(r => r.status === 'PRESENT' && !r.isLate);
    } else if (this.filterFlag === 'MISSING_OUT') {
      list = list.filter(r => r.status === 'PRESENT' && !r.clockOut);
    }

    // 3. Sorting
    list.sort((a, b) => {
      if (this.sortBy === 'date_desc') {
        return new Date(b.date).getTime() - new Date(a.date).getTime();
      }
      if (this.sortBy === 'date_asc') {
        return new Date(a.date).getTime() - new Date(b.date).getTime();
      }
      if (this.sortBy === 'name_asc') {
        const nameA = `${a.employee?.firstName || ''} ${a.employee?.lastName || ''}`;
        const nameB = `${b.employee?.firstName || ''} ${b.employee?.lastName || ''}`;
        return nameA.localeCompare(nameB);
      }
      if (this.sortBy === 'hours_desc') {
        const durA = this.getDurationMinutes(a.clockIn, a.clockOut);
        const durB = this.getDurationMinutes(b.clockIn, b.clockOut);
        return durB - durA;
      }
      return 0;
    });

    return list;
  });

  // Dropdown Handlers
  closeAllDropdowns() {
    this.showMonthDropdown = false;
    this.showYearDropdown = false;
    this.showEmployeeDropdown = false;
    this.showDeptDropdown = false;
    this.showStatusDropdown = false;
    this.showFlagDropdown = false;
  }

  // Filtered dropdown options getters
  getFilteredMonths(query: string) {
    const q = (query || '').toLowerCase().trim();
    if (!q) return this.months;
    return this.months.filter(m => m.label.toLowerCase().includes(q));
  }

  getFilteredYears(query: string) {
    const q = (query || '').toLowerCase().trim();
    if (!q) return this.years;
    return this.years.filter(y => String(y).includes(q));
  }

  getFilteredEmployees(query: string) {
    const q = (query || '').toLowerCase().trim();
    const emps = this.employees();
    if (!q) return emps;
    return emps.filter(e => {
      const full = `${e.firstName || ''} ${e.lastName || ''}`.toLowerCase();
      const dept = (e.department?.name || '').toLowerCase();
      const desig = (e.designation?.name || '').toLowerCase();
      return full.includes(q) || dept.includes(q) || desig.includes(q);
    });
  }

  getSelectedEmployee(): Employee | undefined {
    if (!this.filterEmployeeId) return undefined;
    return this.employees().find(e => e.id === this.filterEmployeeId);
  }

  onAvatarError(emp: any) {
    if (emp) {
      emp.avatarUrl = null;
      if (emp.user) emp.user.avatarUrl = null;
    }
  }

  getFilteredDepartments(query: string) {
    const q = (query || '').toLowerCase().trim();
    const depts = this.departments();
    if (!q) return depts;
    return depts.filter(d => d.name.toLowerCase().includes(q));
  }

  getFilteredStatuses(query: string) {
    const q = (query || '').toLowerCase().trim();
    if (!q) return this.statusOptions;
    return this.statusOptions.filter(s => s.label.toLowerCase().includes(q));
  }

  getFilteredFlags(query: string) {
    const q = (query || '').toLowerCase().trim();
    if (!q) return this.flagOptions;
    return this.flagOptions.filter(f => f.label.toLowerCase().includes(q));
  }

  // Label Getters
  getSelectedMonthLabel(): string {
    const found = this.months.find(m => m.value === this.filterMonth);
    return found ? found.label : 'Select Month';
  }

  /**
   * What the KPI numbers are counting, said plainly. The cards no longer read
   * the whole month, so the row has to admit when it is showing a narrowed
   * set — otherwise a filtered total looks like a wrong total.
   */
  statsScopeLabel = computed(() => {
    if (this.filterDate) {
      return `On ${this.formatDateLabel(this.filterDate)}`;
    }
    const scope = `${this.getSelectedMonthLabel()} ${this.filterYear}`;
    const narrowed = !!this.searchQuery().trim();
    return narrowed ? `Matching records in ${scope}` : `Logged in ${scope}`;
  });

  getSelectedEmployeeLabel(): string {
    if (!this.filterEmployeeId) return 'All Employees';
    const found = this.employees().find(e => e.id === this.filterEmployeeId);
    return found ? `${found.firstName} ${found.lastName}` : 'All Employees';
  }

  getSelectedDeptLabel(): string {
    if (!this.filterDepartmentId) return 'All Departments';
    const found = this.departments().find(d => d.id === this.filterDepartmentId);
    return found ? found.name : 'All Departments';
  }

  getSelectedStatusLabel(): string {
    if (!this.filterStatus) return 'All Statuses';
    const found = this.statusOptions.find(s => s.value === this.filterStatus);
    return found ? found.label : this.filterStatus;
  }

  getSelectedFlagLabel(): string {
    if (this.filterFlag === 'ALL') return 'All Flags';
    const found = this.flagOptions.find(f => f.value === this.filterFlag);
    return found ? found.label : 'All Flags';
  }

  // Select Actions
  selectMonth(month: number) {
    this.filterMonth = month;
    this.filterDate = null;
    this.showMonthDropdown = false;
    this.load();
  }

  selectYear(year: number) {
    this.filterYear = year;
    this.filterDate = null;
    this.showYearDropdown = false;
    this.load();
  }

  selectEmployee(empId: number | null) {
    this.filterEmployeeId = empId;
    this.showEmployeeDropdown = false;
    this.load();
  }

  selectDepartment(deptId: number | null) {
    this.filterDepartmentId = deptId;
    this.showDeptDropdown = false;
    this.load();
  }

  selectStatus(status: string) {
    this.filterStatus = status;
    this.showStatusDropdown = false;
  }

  toggleStatusFilter(status: string) {
    if (this.filterStatus === status) {
      this.clearStatusFilter();
    } else {
      this.selectStatus(status);
    }
  }

  clearStatusFilter() {
    this.filterStatus = '';
    this.showStatusDropdown = false;
  }

  selectFlag(flag: any) {
    this.filterFlag = flag;
    this.showFlagDropdown = false;
  }

  selectDate(value: string) {
    const dateStr = value || '';
    if (!dateStr) {
      this.filterDate = null;
      return;
    }
    const d = new Date(`${dateStr}T00:00:00`);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    if (year !== this.filterYear || month !== this.filterMonth) {
      this.filterYear = year;
      this.filterMonth = month;
      this.filterDate = dateStr;
      this.load();
    } else {
      this.filterDate = dateStr;
    }
  }

  clearDate() {
    this.filterDate = null;
  }

  formatDateLabel(value: string): string {
    if (!value) return '';
    return new Date(`${value}T00:00:00`).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    });
  }

  toggleKpiStatus(status: string) {
    if (this.filterStatus === status) {
      this.clearStatusFilter();
    } else {
      this.selectStatus(status);
    }
  }

  hasActiveFilters(): boolean {
    return !!(
      this.searchQuery() ||
      this.filterDate ||
      this.filterEmployeeId ||
      this.filterDepartmentId ||
      this.filterStatus ||
      this.filterFlag !== 'ALL'
    );
  }

  getActiveFilterChips(): { key: string; label: string; clear: () => void }[] {
    const chips: { key: string; label: string; clear: () => void }[] = [];

    if (this.searchQuery()) {
      chips.push({
        key: 'search',
        label: `Search: "${this.searchQuery()}"`,
        clear: () => { this.searchQuery.set(''); }
      });
    }

    if (this.filterDate) {
      chips.push({
        key: 'date',
        label: `Date: ${this.formatDateLabel(this.filterDate)}`,
        clear: () => { this.clearDate(); }
      });
    }

    if (this.filterEmployeeId) {
      chips.push({
        key: 'employee',
        label: `Employee: ${this.getSelectedEmployeeLabel()}`,
        clear: () => { this.filterEmployeeId = null; this.load(); }
      });
    }

    if (this.filterDepartmentId) {
      chips.push({
        key: 'dept',
        label: `Department: ${this.getSelectedDeptLabel()}`,
        clear: () => { this.filterDepartmentId = null; this.load(); }
      });
    }

    if (this.filterStatus) {
      chips.push({
        key: 'status',
        label: `Status: ${this.getSelectedStatusLabel()}`,
        clear: () => { this.clearStatusFilter(); }
      });
    }

    if (this.filterFlag !== 'ALL') {
      chips.push({
        key: 'flag',
        label: `Flag: ${this.getSelectedFlagLabel()}`,
        clear: () => { this.filterFlag = 'ALL'; }
      });
    }

    return chips;
  }

  resetFilters() {
    const now = new Date();
    this.filterMonth = now.getMonth() + 1;
    this.filterYear = now.getFullYear();
    this.filterEmployeeId = null;
    this.filterDepartmentId = null;
    this.filterDate = null;
    this.filterStatus = '';
    this.filterFlag = 'ALL';
    this.searchQuery.set('');
    this.closeAllDropdowns();
    this.load();
  }

  // Mirrors the grid's day-cell classification for a single record.
  recordDayStatus(r: AttendanceRecord): string {
    if (r.clockIn) {
      if (r.status === 'HALF_DAY') return 'Half Day';
      if (r.isLate) return 'Late';
      return 'Present';
    }
    if (r.status === 'ON_LEAVE') return 'On Leave';
    if (r.status === 'HOLIDAY') return 'Holiday';
    if (r.status === 'WEEKLY_OFF') return 'Day Off';
    return 'Absent';
  }

  /**
   * Why a day carries the status it does, in one short clause.
   *
   * A status badge says what was decided; it does not say why, and "Half Day"
   * or "Absent" against your own name is the kind of thing people want to
   * query. Everything here is read off the record — no thresholds are assumed,
   * so a reason is only offered where the data actually carries one.
   */
  statusReason(status: string, r?: AttendanceRecord, holiday?: any): string {
    if (status === 'Holiday') {
      return holiday?.name ? `Company holiday — ${holiday.name}` : 'Company holiday';
    }
    if (status === 'Day Off') return 'Non-working day on this roster';
    if (status === 'On Leave') return 'Approved leave for this day';
    if (status === 'Absent') return 'No clock-in recorded on a working day';
    if (!r) return '';

    const parts: string[] = [];
    if (status === 'Half Day') {
      parts.push(
        r.totalHours
          ? `Half day — ${this.formatHours(r.totalHours)} recorded`
          : 'Half day — short of a full shift'
      );
    }
    if (r.isLate) parts.push('Clocked in after shift start');
    if (r.isEarlyLeave) parts.push('Clocked out before shift end');
    if (r.overtimeHours && r.overtimeHours > 0) {
      parts.push(`Overtime — ${this.formatHours(r.overtimeHours)} past the shift`);
    }
    if (r.clockOutReason) parts.push(`Missed clock-out — "${r.clockOutReason}"`);
    else if (r.autoClockedOut) parts.push('Never clocked out — closed by the 23:00 sweep');
    else if (r.missedClockOut) parts.push('Still open — clock-out overdue');

    return parts.join(' · ');
  }

  /** Hours as "7h 30m", so a reason never reads "7.5h". */
  formatHours(hours: number): string {
    const mins = Math.round(hours * 60);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h && m) return `${h}h ${m}m`;
    return h ? `${h}h` : `${m}m`;
  }

  /** The hover reason for a table row, which has no prebuilt day cell. */
  recordReason(r: AttendanceRecord): string {
    return this.statusReason(this.recordDayStatus(r), r);
  }

  isMissedClockOut(r: AttendanceRecord): boolean {
    return !!r.clockOutReason || !!r.missedClockOut || (r.status === 'PRESENT' && !r.clockOut);
  }

  recordMatchesStatus(r: AttendanceRecord): boolean {
    const f = this.filterStatus;
    if (!f) return true;
    if (f === 'Overtime') return !!(r.overtimeHours && r.overtimeHours > 0);
    if (f === 'Missed Clock Out') return this.isMissedClockOut(r);
    return this.recordDayStatus(r) === f;
  }

  dayMatchesStatus(day: DayMatrixStatus): boolean {
    const f = this.filterStatus;
    if (!f) return true;
    if (day.status === 'Empty' || (day.isFuture && !day.record)) return false;
    if (f === 'Overtime') return !!(day.record?.overtimeHours && day.record.overtimeHours > 0);
    if (f === 'Missed Clock Out') return !!day.record && this.isMissedClockOut(day.record);
    return day.status === f;
  }

  hasMatchingDay(row: EmployeeMatrixRow): boolean {
    return row.days.some(day => this.dayMatchesStatus(day));
  }

  statusClass(status: string): string {
    if (status === 'Present') return 'status-approved';
    if (status === 'Absent') return 'status-rejected';
    if (status === 'Half Day' || status === 'Late') return 'status-pending';
    if (status === 'On Leave') return 'status-leave-badge';
    if (status === 'Holiday') return 'status-holiday-badge';
    if (status === 'Day Off') return 'status-dayoff-badge';
    if (status === 'Overtime') return 'status-overtime-badge';
    if (status === 'Missed Clock Out') return 'status-clockoff-badge';
    return 'status-pending';
  }

  formatTime(value: string | null): string {
    if (!value) return '—';
    return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  getDurationMinutes(inTime: string | null, outTime: string | null): number {
    if (!inTime || !outTime) return 0;
    const start = new Date(inTime).getTime();
    const end = new Date(outTime).getTime();
    return Math.max(0, Math.floor((end - start) / 60000));
  }

  calculateWorkHours(inTime: string | null, outTime: string | null): { text: string; isOngoing: boolean } {
    if (!inTime) return { text: '—', isOngoing: false };
    if (!outTime) return { text: 'In Progress', isOngoing: true };
    const mins = this.getDurationMinutes(inTime, outTime);
    if (mins <= 0) return { text: '—', isOngoing: false };
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return { text: `${h}h ${m}m`, isOngoing: false };
  }

  exportToCsv() {
    const data = this.filteredRecords();
    if (!data.length) {
      this.toast.error('No attendance records to export');
      return;
    }
    const headers = ['Employee', 'Department', 'Date', 'Status', 'Clock In', 'Clock Out', 'Duration', 'Late', 'Early Leave'];
    const rows = data.map(r => [
      `"${r.employee?.firstName || ''} ${r.employee?.lastName || ''}"`,
      `"${r.employee?.department?.name || '—'}"`,
      `"${new Date(r.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}"`,
      `"${r.status}"`,
      `"${this.formatTime(r.clockIn)}"`,
      `"${this.formatTime(r.clockOut)}"`,
      `"${this.calculateWorkHours(r.clockIn, r.clockOut).text}"`,
      `"${r.isLate ? 'Yes' : 'No'}"`,
      `"${r.isEarlyLeave ? 'Yes' : 'No'}"`,
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Attendance_${this.getSelectedMonthLabel()}_${this.filterYear}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    this.toast.success('Attendance report exported successfully!');
  }

  // Open Detailed Session Modal (Screenshot 3)
  openDayDetails(emp: any, day: any, record?: AttendanceRecord) {
    if (day.isFuture) return;
    this.hoveredTooltip.set(null);

    // Merge emp and record.employee so we have all fields available
    const mergedEmp = {
      ...(emp || {}),
      ...(record?.employee || {}),
      user: record?.employee?.user || emp?.user,
      department: record?.employee?.department || emp?.department,
      designation: record?.employee?.designation || emp?.designation,
    };

    const empName = `${mergedEmp.firstName || ''} ${mergedEmp.lastName || ''}`.trim() || mergedEmp.name || 'Employee';
    const empEmail = mergedEmp.user?.email || mergedEmp.email || '';
    const empDesignation = mergedEmp.designation?.name || (typeof mergedEmp.designation === 'string' ? mergedEmp.designation : '');
    const empDept = mergedEmp.department?.name || (typeof mergedEmp.department === 'string' ? mergedEmp.department : '');
    const empRole = mergedEmp.user?.role || mergedEmp.role || 'EMPLOYEE';
    const empAvatar = mergedEmp.avatarUrl || null;

    let logs: any[] = [];
    let durationStr = '—';

    if (record) {
      if (record.logs && record.logs.length > 0) {
        logs = record.logs;
      } else if (record.clockIn) {
        logs = [{
          clockIn: record.clockIn,
          clockOut: record.clockOut,
          clockInLat: record.clockInLat,
          clockInLng: record.clockInLng,
          clockOutLat: record.clockOutLat,
          clockOutLng: record.clockOutLng,
          autoClockedOut: record.autoClockedOut
        }];
      }

      if (record.clockIn && record.clockOut) {
        const diffMs = new Date(record.clockOut).getTime() - new Date(record.clockIn).getTime();
        const hours = Math.floor(diffMs / (1000 * 60 * 60));
        const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        // The clock-out is a cutoff, not a departure, so the span it closes is
        // not time anyone stood behind. Say "up to" rather than assert it.
        durationStr = record.autoClockedOut
          ? `up to ${hours} hrs ${mins} mins`
          : `${hours} hrs ${mins} mins`;
      } else if (record.clockIn) {
        // An open session is only "active" if it's today; a past day with no
        // clock-out means the person never clocked out (imported/historical).
        const dayStr = this.getLocalDateString(new Date(day.date));
        const todayStr = this.getLocalDateString(new Date());
        if (dayStr === todayStr) {
          const diffMs = new Date().getTime() - new Date(record.clockIn).getTime();
          const hours = Math.floor(diffMs / (1000 * 60 * 60));
          const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
          durationStr = `${hours} hrs ${mins} mins (Active)`;
        } else {
          durationStr = 'Did not clock out';
        }
      }
    }

    this.selectedDayDetails.set({
      employeeName: empName,
      employeeEmail: empEmail,
      employeeDesignation: empDesignation,
      employeeDept: empDept,
      employeeRole: empRole,
      employeeAvatarUrl: empAvatar,
      date: day.date,
      status: day.status,
      logs,
      durationStr,
      isToday: this.getLocalDateString(new Date(day.date)) === this.getLocalDateString(new Date()),
      autoClockedOut: !!record?.autoClockedOut,
      missedClockOutReason: record?.clockOutReason ?? null
    });

    this.isDetailsModalOpen.set(true);
  }

  closeDayDetailsModal() {
    this.isDetailsModalOpen.set(false);
    this.selectedDayDetails.set(null);
  }

  openDetail(record: AttendanceRecord) {
    const day = {
      date: new Date(record.date),
      status: record.status === 'HALF_DAY' ? 'Half Day' : record.isLate ? 'Late' : (record.clockIn || record.status === 'PRESENT') ? 'Present' : 'Absent',
      isFuture: false
    };
    this.openDayDetails(record.employee, day, record);
  }

  closeDetail() {
    this.selectedRecord.set(null);
  }

  // ── Custom Dynamic Cell Tooltip ──────────────────────────────────────────
  onCellMouseEnter(event: MouseEvent, day: DayMatrixStatus) {
    if (day.isFuture || !day.tooltip) {
      this.hoveredTooltip.set(null);
      return;
    }

    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const tooltipWidth = 270;

    // Flip to bottom if there's not enough room above (e.g. single user row right under sticky thead)
    const placeBelow = rect.top < 195;
    const placement: 'top' | 'bottom' = placeBelow ? 'bottom' : 'top';

    const badgeCenterX = rect.left + rect.width / 2;

    // Clamp horizontally to stay within viewport
    const minMargin = 12;
    const maxLeft = Math.max(minMargin, window.innerWidth - tooltipWidth - minMargin);
    const tooltipLeft = Math.max(minMargin, Math.min(maxLeft, badgeCenterX - tooltipWidth / 2));

    // Vertical coordinate
    const tooltipTop = placement === 'bottom' ? rect.bottom + 8 : rect.top - 8;

    // Arrow pointer relative to tooltip box
    const rawArrowLeft = badgeCenterX - tooltipLeft;
    const arrowLeft = Math.max(16, Math.min(tooltipWidth - 16, rawArrowLeft));

    this.hoveredTooltip.set({
      day,
      top: tooltipTop,
      left: tooltipLeft,
      placement,
      arrowLeft
    });
  }

  onCellMouseLeave() {
    this.hoveredTooltip.set(null);
  }

  onMatrixScroll() {
    if (this.hoveredTooltip()) {
      this.hoveredTooltip.set(null);
    }
  }

  @HostListener('window:scroll')
  onWindowScroll() {
    if (this.hoveredTooltip()) {
      this.hoveredTooltip.set(null);
    }
  }
}
