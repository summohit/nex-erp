import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { LucideChevronLeft, LucideChevronRight, LucideClock } from '@lucide/angular';
import { environment } from '../../environments/environment';

interface TimeLog {
  id: number;
  issueId: number;
  issueKey: string;
  issueTitle: string;
  projectId: number;
  projectName: string;
  projectColor: string;
  startedAt: string;
  endedAt: string;
  durationMin: number;
}

interface TimesheetRow {
  issueId: number;
  issueKey: string;
  issueTitle: string;
  projectId: number;
  projectName: string;
  projectColor: string;
  days: { [date: string]: number }; // duration in minutes
  total: number;
}

@Component({
  selector: 'app-timesheets',
  standalone: true,
  imports: [CommonModule, LucideChevronLeft, LucideChevronRight, LucideClock],
  templateUrl: './timesheets.html',
  styleUrls: ['./timesheets.css']
})
export class TimesheetsComponent implements OnInit {
  private http = inject(HttpClient);
  
  startDate!: Date;
  endDate!: Date;
  weekDays: { date: Date, dateString: string }[] = [];
  
  rows: TimesheetRow[] = [];
  dailyTotals: { [date: string]: number } = {};
  grandTotal: number = 0;

  ngOnInit() {
    this.currentWeek();
  }

  currentWeek() {
    const today = new Date();
    // Assuming week starts on Monday
    const day = today.getDay();
    const diff = today.getDate() - day + (day === 0 ? -6 : 1);
    this.startDate = new Date(today.setDate(diff));
    this.startDate.setHours(0, 0, 0, 0);
    
    this.endDate = new Date(this.startDate);
    this.endDate.setDate(this.startDate.getDate() + 6);
    this.endDate.setHours(23, 59, 59, 999);
    
    this.generateWeekDays();
    this.loadTimesheets();
  }

  previousWeek() {
    this.startDate.setDate(this.startDate.getDate() - 7);
    this.endDate.setDate(this.endDate.getDate() - 7);
    this.generateWeekDays();
    this.loadTimesheets();
  }

  nextWeek() {
    this.startDate.setDate(this.startDate.getDate() + 7);
    this.endDate.setDate(this.endDate.getDate() + 7);
    this.generateWeekDays();
    this.loadTimesheets();
  }

  generateWeekDays() {
    this.weekDays = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(this.startDate);
      d.setDate(d.getDate() + i);
      this.weekDays.push({
        date: d,
        dateString: d.toISOString().split('T')[0]
      });
    }
  }

  loadTimesheets() {
    const startStr = this.startDate.toISOString();
    const endStr = this.endDate.toISOString();
    
    this.http.get<TimeLog[]>(`${environment.apiUrl}/projects/timesheets/my-week?startDate=${startStr}&endDate=${endStr}`)
      .subscribe({
        next: (logs) => {
          this.processLogs(logs);
        },
        error: (err) => console.error('Failed to load timesheets', err)
      });
  }

  processLogs(logs: TimeLog[]) {
    const rowMap = new Map<number, TimesheetRow>();
    this.dailyTotals = {};
    this.grandTotal = 0;

    // Initialize daily totals
    this.weekDays.forEach(d => this.dailyTotals[d.dateString] = 0);

    logs.forEach(log => {
      const dateStr = log.startedAt.split('T')[0];
      
      if (!rowMap.has(log.issueId)) {
        rowMap.set(log.issueId, {
          issueId: log.issueId,
          issueKey: log.issueKey,
          issueTitle: log.issueTitle,
          projectId: log.projectId,
          projectName: log.projectName,
          projectColor: log.projectColor,
          days: {},
          total: 0
        });
      }
      
      const row = rowMap.get(log.issueId)!;
      row.days[dateStr] = (row.days[dateStr] || 0) + log.durationMin;
      row.total += log.durationMin;
      
      this.dailyTotals[dateStr] = (this.dailyTotals[dateStr] || 0) + log.durationMin;
      this.grandTotal += log.durationMin;
    });

    this.rows = Array.from(rowMap.values());
  }

  formatDuration(minutes: number): string {
    if (!minutes) return '';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
  }

  parseDuration(durationStr: string): number {
    if (!durationStr || !durationStr.trim()) return 0;
    
    const parts = durationStr.trim().split(' ');
    let totalMinutes = 0;
    
    for (const part of parts) {
      if (part.endsWith('h')) {
        totalMinutes += parseInt(part.replace('h', '')) * 60;
      } else if (part.endsWith('m')) {
        totalMinutes += parseInt(part.replace('m', ''));
      } else if (!isNaN(Number(part))) {
        // Assume hours if just a number
        totalMinutes += parseFloat(part) * 60;
      }
    }
    return totalMinutes;
  }

  updateTime(row: TimesheetRow, dateString: string, event: Event) {
    const input = event.target as HTMLInputElement;
    const newMinutes = this.parseDuration(input.value);
    
    const oldMinutes = row.days[dateString] || 0;
    
    if (newMinutes !== oldMinutes) {
      // Typically we'd call the API here to save a new manual time log
      // For this demo, we'll just optimistically update the UI.
      const diff = newMinutes - oldMinutes;
      row.days[dateString] = newMinutes;
      row.total += diff;
      this.dailyTotals[dateString] += diff;
      this.grandTotal += diff;
      
      // Call API
      this.http.post(`${environment.apiUrl}/projects/${row.projectId}/issues/${row.issueId}/time-log`, {
        durationMin: diff // In reality, we might need a specific endpoint to sync a day's total
      }).subscribe({
        next: () => console.log('Time updated'),
        error: (err) => console.error('Failed to update time', err)
      });
    }
    
    // Reformat input
    input.value = this.formatDuration(newMinutes);
  }
}
