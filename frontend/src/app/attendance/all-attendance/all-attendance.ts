import { Component, OnInit, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HotToastService } from '@ngneat/hot-toast';
import {
  LucideCalendarClock, LucideRotateCcw, LucideSearch, LucideX,
  LucideChevronDown, LucideCheck, LucideFilter, LucideDownload,
  LucideRefreshCw, LucideUserCheck, LucideUserX, LucideClock,
  LucideAlertTriangle, LucideDoorOpen, LucideCalendarDays,
  LucideBuilding, LucideUser, LucideTimer, LucideCheckCircle2,
  LucideLayers, LucideEye, LucideMapPin, LucideInbox,
  LucideArrowUpDown, LucideSparkles
} from '@lucide/angular';
import { AttendanceService, AttendanceRecord } from '../../services/attendance';
import { MasterDataService, Department } from '../../services/master-data.service';
import { EmployeeService, Employee } from '../../services/employee.service';

@Component({
  selector: 'app-all-attendance',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    LucideCalendarClock, LucideRotateCcw, LucideSearch, LucideX,
    LucideChevronDown, LucideCheck, LucideFilter, LucideDownload,
    LucideRefreshCw, LucideUserCheck, LucideUserX, LucideClock,
    LucideAlertTriangle, LucideDoorOpen, LucideCalendarDays,
    LucideBuilding, LucideUser, LucideTimer, LucideCheckCircle2,
    LucideLayers, LucideEye, LucideMapPin, LucideInbox,
    LucideArrowUpDown, LucideSparkles
  ],
  templateUrl: './all-attendance.html',
  styleUrls: ['./all-attendance.css']
})
export class AllAttendanceComponent implements OnInit {
  private attendanceService = inject(AttendanceService);
  private masterDataService = inject(MasterDataService);
  private employeeService = inject(EmployeeService);
  private toast = inject(HotToastService);

  records = signal<AttendanceRecord[]>([]);
  employees = signal<Employee[]>([]);
  departments = signal<Department[]>([]);
  isLoading = signal(false);
  selectedRecord = signal<AttendanceRecord | null>(null);

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
  filterEmployeeId: number | null = null;
  filterDepartmentId: number | null = null;
  filterStatus = '';
  filterFlag: 'ALL' | 'LATE' | 'EARLY' | 'ON_TIME' | 'MISSING_OUT' = 'ALL';
  searchQuery = '';
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
    { value: '', label: 'All Statuses' },
    { value: 'PRESENT', label: 'Present' },
    { value: 'HALF_DAY', label: 'Half Day' },
    { value: 'ABSENT', label: 'Absent' }
  ];

  readonly flagOptions = [
    { value: 'ALL', label: 'All Flags / Logs' },
    { value: 'LATE', label: 'Late Arrival' },
    { value: 'EARLY', label: 'Early Departure' },
    { value: 'ON_TIME', label: 'On Time Only' },
    { value: 'MISSING_OUT', label: 'Still Clocked In' }
  ];

  constructor() {
    const current = new Date().getFullYear();
    this.years = [current - 2, current - 1, current, current + 1];
  }

  ngOnInit() {
    this.employeeService.getEmployeesBasicList().subscribe({ next: (res) => this.employees.set(res) });
    this.masterDataService.getDepartments(true).subscribe({ next: (res) => this.departments.set(res) });
    this.load();
  }

  load() {
    this.isLoading.set(true);
    this.attendanceService.getAllEmployeesAttendance({
      month: this.filterMonth,
      year: this.filterYear,
      employeeId: this.filterEmployeeId || undefined,
      departmentId: this.filterDepartmentId || undefined,
      status: this.filterStatus || undefined
    }).subscribe({
      next: (res) => {
        this.records.set(res);
        this.isLoading.set(false);
      },
      error: () => {
        this.toast.error('Failed to load attendance records');
        this.isLoading.set(false);
      }
    });
  }

  // Computed metrics
  stats = computed(() => {
    const list = this.records();
    const total = list.length;
    const present = list.filter(r => r.status === 'PRESENT').length;
    const halfDay = list.filter(r => r.status === 'HALF_DAY').length;
    const absent = list.filter(r => r.status === 'ABSENT').length;
    const late = list.filter(r => r.isLate).length;
    const early = list.filter(r => r.isEarlyLeave).length;
    const onTime = list.filter(r => r.status === 'PRESENT' && !r.isLate).length;
    const onTimeRate = total > 0 ? Math.round((onTime / total) * 100) : 0;

    return {
      total,
      present,
      halfDay,
      absent,
      late,
      early,
      onTime,
      onTimeRate
    };
  });

  // Filtered & Sorted Records
  filteredRecords = computed(() => {
    let list = [...this.records()];
    const q = this.searchQuery.toLowerCase().trim();

    // 1. Text Search (Employee name, department)
    if (q) {
      list = list.filter(r => {
        const name = `${r.employee?.firstName || ''} ${r.employee?.lastName || ''}`.toLowerCase();
        const dept = (r.employee?.department?.name || '').toLowerCase();
        return name.includes(q) || dept.includes(q);
      });
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
      return full.includes(q) || dept.includes(q);
    });
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
    this.showMonthDropdown = false;
    this.load();
  }

  selectYear(year: number) {
    this.filterYear = year;
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
    this.load();
  }

  selectFlag(flag: any) {
    this.filterFlag = flag;
    this.showFlagDropdown = false;
  }

  toggleKpiStatus(status: string) {
    if (this.filterStatus === status) {
      this.filterStatus = '';
    } else {
      this.filterStatus = status;
    }
    this.load();
  }

  toggleKpiFlag(flag: 'LATE' | 'EARLY') {
    if (this.filterFlag === flag) {
      this.filterFlag = 'ALL';
    } else {
      this.filterFlag = flag;
    }
  }

  hasActiveFilters(): boolean {
    return !!(
      this.searchQuery ||
      this.filterEmployeeId ||
      this.filterDepartmentId ||
      this.filterStatus ||
      this.filterFlag !== 'ALL'
    );
  }

  getActiveFilterChips(): { key: string; label: string; clear: () => void }[] {
    const chips: { key: string; label: string; clear: () => void }[] = [];

    if (this.searchQuery) {
      chips.push({
        key: 'search',
        label: `Search: "${this.searchQuery}"`,
        clear: () => { this.searchQuery = ''; }
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
        clear: () => { this.filterStatus = ''; this.load(); }
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
    this.filterStatus = '';
    this.filterFlag = 'ALL';
    this.searchQuery = '';
    this.closeAllDropdowns();
    this.load();
  }

  statusClass(status: string): string {
    if (status === 'PRESENT') return 'status-approved';
    if (status === 'ABSENT') return 'status-rejected';
    if (status === 'HALF_DAY') return 'status-pending';
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

  openDetail(record: AttendanceRecord) {
    this.selectedRecord.set(record);
  }

  closeDetail() {
    this.selectedRecord.set(null);
  }
}
