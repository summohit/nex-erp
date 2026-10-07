import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HotToastService } from '@ngneat/hot-toast';
import { LucideArrowLeft, LucideCalendarDays, LucideRefreshCw, LucideTrophy, LucideUsers } from '@lucide/angular';
import { AttendanceRecord, AttendanceService } from '../../services/attendance';

interface AttendanceRank {
  employeeId: number;
  name: string;
  designation: string;
  department: string;
  avatarUrl: string | null;
  present: number;
  halfDay: number;
  absent: number;
  onLeave: number;
  late: number;
  hours: number;
  rate: number | null;
}

@Component({
  selector: 'app-attendance-list',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideArrowLeft, LucideCalendarDays, LucideRefreshCw, LucideTrophy, LucideUsers],
  templateUrl: './attendance-list.html',
  styleUrls: ['./attendance-list.css'],
})
export class AttendanceListComponent implements OnInit {
  private attendance = inject(AttendanceService);
  private router = inject(Router);
  private toast = inject(HotToastService);

  readonly now = new Date();
  month = signal(this.now.getMonth() + 1);
  year = signal(this.now.getFullYear());
  /** An exact date overrides the month selection. */
  selectedDate = signal('');
  loading = signal(false);
  records = signal<AttendanceRecord[]>([]);
  years = Array.from({ length: 5 }, (_, index) => this.now.getFullYear() - 2 + index);
  months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  ranking = computed<AttendanceRank[]>(() => {
    const people = new Map<number, AttendanceRank>();
    for (const record of this.records()) {
      const employee = record.employee || {};
      const id = record.employeeId || employee.id;
      if (!id) continue;
      if (!people.has(id)) {
        const first = employee.firstName || '';
        const last = employee.lastName || '';
        people.set(id, {
          employeeId: id,
          name: `${first} ${last}`.trim() || employee.name || 'Unknown employee',
          designation: employee.designation?.name || employee.designation || '—',
          department: employee.department?.name || employee.department || '—',
          avatarUrl: employee.avatarUrl || employee.user?.avatarUrl || null,
          present: 0, halfDay: 0, absent: 0, onLeave: 0, late: 0, hours: 0, rate: null,
        });
      }
      const row = people.get(id)!;
      if (record.status === 'PRESENT') row.present++;
      else if (record.status === 'HALF_DAY') row.halfDay++;
      else if (record.status === 'ABSENT') row.absent++;
      else if (record.status === 'ON_LEAVE') row.onLeave++;
      if (record.isLate) row.late++;
      row.hours += Number(record.totalHours || 0);
    }
    return [...people.values()]
      .map(row => {
        const workedDays = row.present + row.halfDay * .5;
        const expectedDays = row.present + row.halfDay + row.absent;
        return { ...row, rate: expectedDays ? Math.round((workedDays / expectedDays) * 100) : null };
      })
      .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || a.absent - b.absent || a.late - b.late || b.hours - a.hours || a.name.localeCompare(b.name));
  });

  ngOnInit(): void { this.load(); }

  load(): void {
    const exact = this.selectedDate();
    this.loading.set(true);
    this.attendance.getAllEmployeesAttendance(exact
      ? { from: exact, to: exact }
      : { month: this.month(), year: this.year() })
      .subscribe({
        next: rows => { this.records.set(rows || []); this.loading.set(false); },
        error: error => { this.loading.set(false); this.toast.error(error?.error?.message || 'Could not load attendance list'); },
      });
  }

  selectMonth(): void { this.selectedDate.set(''); this.load(); }

  onDateChange(): void {
    const date = this.selectedDate();
    if (date) {
      const [year, month] = date.split('-').map(Number);
      this.year.set(year); this.month.set(month);
    }
    this.load();
  }

  periodLabel(): string {
    if (this.selectedDate()) return new Date(`${this.selectedDate()}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
    return `${this.months[this.month() - 1]} ${this.year()}`;
  }

  back(): void { this.router.navigate(['/attendance/all']); }
}
