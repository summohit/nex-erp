import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface DashboardPerson {
  id: number;
  firstName: string;
  lastName: string;
  avatarUrl?: string | null;
  designation?: string | null;
  department?: string | null;
}

export interface DashboardShiftDay {
  date: string;
  weekday: string;
  isDayOff: boolean;
  shiftName: string;
  shortCode: string | null;
  startTime: string | null;
  endTime: string | null;
  note: string;
  projectName: string | null;
}

export interface DashboardAppreciation {
  id: number;
  givenDate: string;
  summary: string;
  photoUrl?: string | null;
  awardTitle: string;
  awardIcon: string;
  awardColor: string;
  employee: DashboardPerson | null;
}

export interface DashboardOnLeave extends DashboardPerson {
  leaveType: string;
  isHalfDay?: boolean;
  halfDayPeriod?: string | null;
  requestId?: number;
}

export interface DashboardTicket {
  id: number;
  ticketNumber: string;
  title: string;
  status: string;
  priority: string;
  type: string;
  createdAt: string;
  resolvedAt: string | null;
}

export interface DashboardCalendarDay {
  date: string;
  label: string;
  dayNum: number;
}

export interface DashboardCalendarEvent {
  date: string;
  type: string;
  title: string;
  subtitle: string;
  mine?: boolean;
}

export interface DashboardPayload {
  role: string;
  common: {
    myLeaveBalance: any[];
    myTasks: any[];
    myTasksByStatus: { name: string; count: number }[];
    myAttendanceThisMonth: { days: any[]; presentCount: number; lateCount: number; absentCount: number };
    upcomingHolidays: { id: number; name: string; date: string }[];
    myHoursLogged: { date: string; hours: number }[];
    myShiftSchedule: DashboardShiftDay[];
    birthdays: (DashboardPerson & { upcomingDate: string; inDays: number })[];
    anniversaries: (DashboardPerson & { upcomingDate: string; inDays: number; years: number })[];
    todayJoinings: (DashboardPerson & { joiningDate: string })[];
    todayAnniversaries: (DashboardPerson & { joiningDate: string; years: number })[];
    appreciations: DashboardAppreciation[];
    onLeaveToday: DashboardOnLeave[];
    onWfhToday: DashboardOnLeave[];
    myTickets: DashboardTicket[];
    taskStats: { pending: number; overdue: number };
    projectStats: { inProgress: number; overdue: number; total: number };
    weekTimelogs: { days: { date: string; label: string; minutes: number }[]; totalMinutes: number; breakMinutes: number };
    myCalendar: { weekStart: string; weekEnd: string; days: DashboardCalendarDay[]; events: DashboardCalendarEvent[] };
    probation: { nextAppraisalDate: string | null; joiningDate: string | null; employmentCategory: string } | null;
  };
  org?: {
    headcount: { total: number; byDepartment: { name: string; count: number }[] };
    headcountTrend: { label: string; count: number }[];
    todayAttendance: { totalEmployees: number; present: number; late: number; halfDay: number; onLeave: number; notClockedIn: number };
    attendanceTrend: { date: string; present: number }[];
    pendingLeaveApprovals: any[];
    recruitmentAnalytics: { totalApplications: number; pipeline: Record<string, number>; averageScore: number };
    projectStatus: { status: string; count: number }[];
    onboardingPipeline?: { onboardingStatus: string; _count: number }[];
    leaveByType?: { name: string; count: number }[];
    celebrations?: { birthdays: any[]; anniversaries: any[] };
  };
  finance?: {
    payrollSummary?: { month: number; year: number; payslipCount: number; totalNetPay: number; totalEarnings: number; totalDeductions: number };
    pendingExpenseClaims?: { count: number; totalAmount: number; recent: any[] };
    payrollTrend: { label: string; netPay: number; earnings: number; deductions: number }[];
    deptSalaryCost: { name: string; total: number }[];
    expensesByCategory: { category: string; count: number; total: number }[];
  };
  sales?: {
    pendingQuotationApprovals?: number;
    ordersThisMonth?: { count: number; totalValue: number };
    quotationsByStatus?: { status: string; _count: number }[];
    leadsPipeline?: { byStatus: { status: string; _count: number; _sum: { value: number | null } }[]; recentLeads: any[] };
    revenueTrend: { label: string; total: number }[];
    recentOrders?: any[];
  };
}

@Injectable({
  providedIn: 'root'
})
export class DashboardService {
  private http = inject(HttpClient);
  private apiUrl = environment.apiUrl + '/dashboard';

  getDashboard(): Observable<DashboardPayload> {
    return this.http.get<DashboardPayload>(this.apiUrl);
  }
}
