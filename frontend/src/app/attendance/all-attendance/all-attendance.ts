import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideCalendarClock, LucideRotateCcw } from '@lucide/angular';
import { AttendanceService, AttendanceRecord } from '../../services/attendance';
import { MasterDataService, Department } from '../../services/master-data.service';
import { EmployeeService, Employee } from '../../services/employee.service';

@Component({
  selector: 'app-all-attendance',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideCalendarClock, LucideRotateCcw],
  templateUrl: './all-attendance.html',
  styleUrls: ['./all-attendance.css']
})
export class AllAttendanceComponent implements OnInit {
  records = signal<AttendanceRecord[]>([]);
  employees = signal<Employee[]>([]);
  departments = signal<Department[]>([]);
  isLoading = signal(false);

  months = [
    { value: 1, label: 'January' }, { value: 2, label: 'February' }, { value: 3, label: 'March' },
    { value: 4, label: 'April' }, { value: 5, label: 'May' }, { value: 6, label: 'June' },
    { value: 7, label: 'July' }, { value: 8, label: 'August' }, { value: 9, label: 'September' },
    { value: 10, label: 'October' }, { value: 11, label: 'November' }, { value: 12, label: 'December' }
  ];
  years: number[] = [];

  filterMonth = new Date().getMonth() + 1;
  filterYear = new Date().getFullYear();
  filterEmployeeId: number | null = null;
  filterDepartmentId: number | null = null;
  filterStatus = '';

  constructor(
    private attendanceService: AttendanceService,
    private masterDataService: MasterDataService,
    private employeeService: EmployeeService
  ) {
    const current = new Date().getFullYear();
    this.years = [current - 1, current, current + 1];
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
      error: () => this.isLoading.set(false)
    });
  }

  resetFilters() {
    const now = new Date();
    this.filterMonth = now.getMonth() + 1;
    this.filterYear = now.getFullYear();
    this.filterEmployeeId = null;
    this.filterDepartmentId = null;
    this.filterStatus = '';
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
}
