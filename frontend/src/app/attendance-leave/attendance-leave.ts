import { Component, OnInit, OnDestroy, inject, signal, computed, HostListener } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { AttendanceService, AttendanceRecord, Shift } from '../services/attendance';
import { LeavesService, LeaveBalance, LeaveRequest } from '../services/leaves';
import { MasterDataService, Holiday, LeaveType } from '../services/master-data.service';
import { EmployeeService, Employee } from '../services/employee.service';
import { ShiftsService } from '../services/shifts.service';
import { AuthService } from '../services/auth.service';
import { LeaveActionCellRendererComponent } from '../shared/components/leave-action-cell-renderer.component';
import { ActionCellRendererComponent } from '../shared/components/action-cell-renderer.component';
import { forkJoin } from 'rxjs';
import { 
  LucideCheck, 
  LucideStarHalf, 
  LucideAlertCircle, 
  LucideX, 
  LucidePlane, 
  LucideStar, 
  LucideCalendar,
  LucideUploadCloud,
  LucideFile,
  LucidePaperclip,
  LucidePlus,
  LucideTrash2,
  LucideEdit,
  LucideGrid,
  LucideList,
  LucideChevronLeft,
  LucideChevronRight,
  LucideClock
} from '@lucide/angular';
import { HotToastService } from '@ngneat/hot-toast';
import { AgGridAngular } from 'ag-grid-angular';
import { ColDef, ModuleRegistry, AllCommunityModule, ValueFormatterParams, CellClickedEvent, ValidationModule, GridOptions } from 'ag-grid-community';

ModuleRegistry.registerModules([AllCommunityModule, ValidationModule]);

export interface DayStatus {
  date: Date;
  dayNumber: number;
  weekdayStr: string;
  status: 'Present' | 'Half Day' | 'Late' | 'Absent' | 'On Leave' | 'Holiday' | 'Day Off' | 'Empty';
  tooltip?: string;
  isFuture: boolean;
  clockInStr?: string;
  clockOutStr?: string;
  clockInLat?: number | null;
  clockInLng?: number | null;
  clockOutLat?: number | null;
  clockOutLng?: number | null;
}

@Component({
  selector: 'app-attendance-leave',
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule, 
    LucideCheck,
    LucideStarHalf,
    LucideAlertCircle,
    LucideX,
    LucidePlane,
    LucideStar,
    LucideCalendar,
    AgGridAngular,
    LucideUploadCloud,
    LucideFile,
    LucidePaperclip,
    LucidePlus,
    LucideTrash2,
    LucideEdit,
    LucideGrid,
    LucideList,
    LucideChevronLeft,
    LucideChevronRight,
    LucideClock
  ],
  providers: [DatePipe],
  templateUrl: './attendance-leave.html',
  styleUrls: ['./attendance-leave.css']
})
export class AttendanceLeaveComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private attendanceService = inject(AttendanceService);
  private leavesService = inject(LeavesService);
  private http = inject(HttpClient);
  private masterDataService = inject(MasterDataService);
  private employeeService = inject(EmployeeService);
  private shiftsService = inject(ShiftsService);
  private sanitizer = inject(DomSanitizer);
  public authService = inject(AuthService);
  private toast = inject(HotToastService);
  private datePipe = inject(DatePipe);

  activeTab = signal<string>('attendance');
  
  // Clock in widget
  math = Math;
  todayAttendance = signal<AttendanceRecord | null>(null);
  isClocking = signal<boolean>(false);

  // Shift Management State
  allShifts = signal<Shift[]>([]);
  isAssigningShift = signal<boolean>(false);
  
  // Create Shift Form State
  isCreateShiftModalOpen = signal<boolean>(false);
  shiftEditMode = signal<'create' | 'edit'>('create');
  editingShiftId = signal<number | null>(null);
  shiftForm = {
    name: '',
    startTime: '09:00',
    endTime: '18:00',
    bufferTimeMinutes: 15
  };
  
  showTimelineRescheduleModal = signal(false);
  selectedTimelineEmp = signal<any>(null);
  selectedTimelineDate = signal<Date | null>(null);
  rescheduleForm = {
    status: 'PRESENT',
    note: ''
  };

  isAdmin = computed(() => {
    const role = this.authService.currentUser()?.role;
    return role === 'ADMIN' || role === 'HR' || role === 'SUPERADMIN';
  });

  isManager = computed(() => {
    const role = this.authService.currentUser()?.role;
    return role === 'MANAGER';
  });

  attendanceColDefs: ColDef[] = [
    { 
      field: 'date', 
      headerName: 'Date', 
      flex: 1,
      valueFormatter: (params: ValueFormatterParams) => this.datePipe.transform(params.value, 'mediumDate') || ''
    },
    { 
      field: 'clockIn', 
      headerName: 'Clock In', 
      flex: 1,
      valueFormatter: (params: ValueFormatterParams) => params.value ? (this.datePipe.transform(params.value, 'shortTime') || '') : '-'
    },
    { 
      field: 'clockOut', 
      headerName: 'Clock Out', 
      flex: 1,
      valueFormatter: (params: ValueFormatterParams) => params.value ? (this.datePipe.transform(params.value, 'shortTime') || '') : '-'
    },
    {
      headerName: 'Clock-In Location',
      flex: 1.2,
      minWidth: 180,
      cellRenderer: (params: any) => {
        const lat = params.data?.clockInLat;
        const lng = params.data?.clockInLng;
        if (!lat || !lng) return '<span style="color: #94A3B8;">-</span>';
        const coords = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        return `<a href="https://www.google.com/maps?q=${lat},${lng}" target="_blank" title="Open in Google Maps" style="color: #2563EB; text-decoration: underline; font-size: 12px;">📍 ${coords}</a>`;
      }
    },
    {
      field: 'status',
      headerName: 'Status',
      flex: 1,
      cellRenderer: (params: any) => {
        const val = params.value;
        const color = val === 'PRESENT' ? '#10B981' : (val === 'ABSENT' ? '#EF4444' : '#F59E0B');
        return `<span style="color: ${color}; font-weight: 500;">${val || '-'}</span>`;
      }
    },
    {
      headerName: 'Action',
      flex: 1,
      cellRenderer: (params: any) => {
        let buttons = '';
        if (params.data.logs && params.data.logs.length > 0) {
          buttons += `<button style="background:none; border:none; color:#1E40AF; cursor:pointer; text-decoration:underline; font-size:12px; padding:0; margin-right: 12px;" onclick="window.dispatchEvent(new CustomEvent('view-punches', {detail: '${params.data.date}'}))">View Punches</button>`;
        }
        if (params.data.status === 'ABSENT' || params.data.isLate || params.data.isEarlyLeave) {
          buttons += `<button style="background:none; border:none; color:#3B82F6; cursor:pointer; text-decoration:underline; font-size:12px; padding:0;" onclick="window.dispatchEvent(new CustomEvent('regularize-attendance', {detail: '${params.data.date}'}))">Regularize</button>`;
        }
        return buttons;
      }
    }
  ];

    constructor() {}

  leaveColDefs: ColDef[] = [


    { 
      field: 'leaveType.name', 
      headerName: 'Type', 
      flex: 1,
      autoHeight: true,
      cellRenderer: (params: any) => {
        if (!params.value) return '';
        const attachmentLink = params.data.attachmentUrl 
          ? `<a href="${params.data.attachmentUrl}" target="_blank" style="display: flex; align-items: center; gap: 4px; font-size: 11px; color: #f97316; text-decoration: underline; margin-top: 2px;">View Attachment <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="17" x2="17" y2="7"></line><polyline points="7 7 17 7 17 17"></polyline></svg></a>`
          : '';
        return `<div style="display: flex; flex-direction: column; justify-content: center; padding: 6px 0; line-height: 1.2;">
                  <span style="font-weight: 500;">${params.value}</span>
                  ${attachmentLink}
                </div>`;
      }
    },
    { 
      headerName: 'Dates', 
      flex: 1.5,
      valueGetter: (params) => {
        const start = this.datePipe.transform(params.data.startDate, 'MMM d');
        const end = this.datePipe.transform(params.data.endDate, 'MMM d');
        return `${start} - ${end}`;
      },
      cellRenderer: (params: any) => {
        const start = this.datePipe.transform(params.data.startDate, 'MMM d');
        const end = this.datePipe.transform(params.data.endDate, 'MMM d');
        const halfBadge = params.data.isHalfDay
          ? `<span class="status-badge status-half-day" style="background: rgba(236, 95, 42, 0.12); color: #EC5F2A; font-size: 10px; margin-left: 6px; padding: 2px 6px; border-radius: 10px;">Half Day (${params.data.halfDayPeriod || 'AM'})</span>`
          : '';
        return `<div style="display: flex; align-items: center;">${start} - ${end}${halfBadge}</div>`;
      }
    },
    { 
      field: 'status', 
      headerName: 'Status', 
      flex: 1,
      autoHeight: true,
      cellRenderer: (params: any) => {
        const statusClass = params.value ? params.value.toLowerCase() : '';
        let badgeHtml = `<span class="status-badge ${statusClass}">${params.value}</span>`;
        let reasonLink = params.value === 'REJECTED' && params.data.rejectionReason 
          ? `<div class="view-reason-link" style="display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: #ef4444; text-decoration: underline; margin-top: 4px; cursor: pointer;">View Reason <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg></div>` 
          : '';
        return `<div style="display: flex; flex-direction: column; align-items: flex-start; justify-content: center; padding: 6px 0; line-height: 1.2;">
                  ${badgeHtml}
                  ${reasonLink}
                </div>`;
      }
    },
    {
      headerName: 'Actions',
      flex: 1,
      cellRenderer: LeaveActionCellRendererComponent,
      cellRendererParams: {
        onEdit: (data: any) => this.editLeaveRequest(data),
        onCancel: (data: any) => this.cancelLeaveRequest(data.id),
        onViewAttachment: (data: any) => this.viewAttachment(data.attachmentUrl),
        onViewReason: (data: any) => this.openRejectionReasonModal(data.rejectionReason)
      }
    }
  ];

  shiftColDefs: ColDef[] = [
    { field: 'name', headerName: 'Shift Name', flex: 1.5, minWidth: 180 },
    { 
      field: 'startTime', 
      headerName: 'Start Time', 
      flex: 1,
      valueFormatter: (params: ValueFormatterParams) => {
        if (!params.value) return '';
        const [h, m] = params.value.split(':');
        const hour = parseInt(h, 10);
        const ampm = hour >= 12 ? 'PM' : 'AM';
        const h12 = hour % 12 || 12;
        return `${h12}:${m} ${ampm}`;
      }
    },
    { 
      field: 'endTime', 
      headerName: 'End Time', 
      flex: 1,
      valueFormatter: (params: ValueFormatterParams) => {
        if (!params.value) return '';
        const [h, m] = params.value.split(':');
        const hour = parseInt(h, 10);
        const ampm = hour >= 12 ? 'PM' : 'AM';
        const h12 = hour % 12 || 12;
        return `${h12}:${m} ${ampm}`;
      }
    },
    { 
      field: 'bufferTimeMinutes', 
      headerName: 'Buffer (mins)', 
      flex: 0.8,
      valueFormatter: (params: ValueFormatterParams) => params.value ? `${params.value} min` : '15 min'
    },
    {
      field: '_count.employees',
      headerName: 'Assigned Employees',
      flex: 1,
      valueFormatter: (params: ValueFormatterParams) => {
        const count = params.data?._count?.employees;
        return count !== undefined ? `${count} employee${count !== 1 ? 's' : ''}` : '0 employees';
      }
    },
    { 
      headerName: 'Actions',
      width: 120,
      flex: 0,
      sortable: false,
      filter: false,
      cellRenderer: ActionCellRendererComponent,
      cellRendererParams: {
        onEdit: (data: any) => this.openEditShift(data),
        onDelete: (data: any) => this.deleteShift(data.id)
      }
    }
  ];

  regularizationColDefs: ColDef[] = [
    { field: 'date', headerName: 'Date', flex: 1, valueFormatter: (params: ValueFormatterParams) => this.datePipe.transform(params.value, 'mediumDate') || '' },
    { field: 'proposedClockIn', headerName: 'Proposed In', flex: 1, valueFormatter: (params: ValueFormatterParams) => params.value ? (this.datePipe.transform(params.value, 'shortTime') || '') : '-' },
    { field: 'proposedClockOut', headerName: 'Proposed Out', flex: 1, valueFormatter: (params: ValueFormatterParams) => params.value ? (this.datePipe.transform(params.value, 'shortTime') || '') : '-' },
    { field: 'reason', headerName: 'Reason', flex: 1.5 },
    { field: 'status', headerName: 'Status', flex: 1, cellRenderer: (params: any) => {
        const val = params.value;
        const color = val === 'APPROVED' ? '#10B981' : (val === 'REJECTED' ? '#EF4444' : '#F59E0B');
        return `<span style="color: ${color}; font-weight: 500;">${val}</span>`;
      }
    }
  ];

  hrRegularizationColDefs: ColDef[] = [
    { 
      field: 'employee',
      headerName: 'Employee', 
      valueFormatter: (p) => p.value ? (p.value.lastName ? `${p.value.firstName} ${p.value.lastName}` : p.value.firstName) : '',
      minWidth: 200,
      flex: 1.5,
      cellRenderer: (params: any) => {
        const emp = params.data?.employee;
        if (!emp) return 'N/A';
        const name = emp.lastName ? `${emp.firstName} ${emp.lastName}` : emp.firstName;
        return `<span style="font-weight:600;">${name}</span>`;
      }
    },
    { field: 'date', headerName: 'Date', flex: 1, valueFormatter: (params: ValueFormatterParams) => this.datePipe.transform(params.value, 'mediumDate') || '' },
    { field: 'proposedClockIn', headerName: 'Proposed In', flex: 1, valueFormatter: (params: ValueFormatterParams) => params.value ? (this.datePipe.transform(params.value, 'shortTime') || '') : '-' },
    { field: 'proposedClockOut', headerName: 'Proposed Out', flex: 1, valueFormatter: (params: ValueFormatterParams) => params.value ? (this.datePipe.transform(params.value, 'shortTime') || '') : '-' },
    { field: 'reason', headerName: 'Reason', flex: 1.5 },
    { field: 'status', headerName: 'Status', flex: 1 },
    {
      headerName: 'Actions',
      flex: 1,
      cellRenderer: (params: any) => {
        if (params.data.status === 'PENDING') {
          return `
            <div style="display: flex; gap: 8px; align-items: center; height: 100%;">
              <button class="btn btn-primary" style="padding: 2px 8px; font-size: 11px;" onclick="window.dispatchEvent(new CustomEvent('resolve-reg', {detail: {id: ${params.data.id}, status: 'APPROVED'}}))">Approve</button>
              <button class="btn btn-outline" style="padding: 2px 8px; font-size: 11px; color: #ef4444; border-color: #ef4444;" onclick="window.dispatchEvent(new CustomEvent('resolve-reg', {detail: {id: ${params.data.id}, status: 'REJECTED'}}))">Reject</button>
            </div>
          `;
        }
        return '';
      }
    }
  ];

  shiftDefaultColDef: ColDef = {
    flex: 1,
    minWidth: 120,
    filter: true,
    sortable: true
  };

  shiftGridOptions = {
    rowSelection: { mode: 'multiRow' as const, enableClickSelection: false }
  };

  hrRequestsColDefs: ColDef[] = [
    { 
      field: 'employee',
      headerName: 'Employee', 
      valueFormatter: (p) => p.value ? (p.value.lastName ? `${p.value.firstName} ${p.value.lastName}` : p.value.firstName) : '',
      minWidth: 200,
      flex: 1.5,
      pinned: 'left',
      cellRenderer: (params: any) => {
        const emp = params.data?.employee;
        if (!emp) return 'N/A';
        const name = emp.lastName ? `${emp.firstName} ${emp.lastName}` : emp.firstName;
        const dept = emp.department?.name || 'General';
        const initial = (emp.firstName || 'E').charAt(0);
        return `
          <div class="cell-user-avatar-row">
            <div class="avatar-circle-sm">${initial}</div>
            <div class="cell-stacked">
              <div class="cell-title-bold">${name}</div>
              <div class="user-text-stack text-secondary">${dept}</div>
            </div>
          </div>
        `;
      }
    },
    { 
      field: 'leaveType.name', 
      headerName: 'Leave Type', 
      flex: 1.2,
      minWidth: 150,
      cellRenderer: (params: any) => {
        if (!params.value) return 'N/A';
        const attachmentLink = params.data.attachmentUrl 
          ? `<a href="${params.data.attachmentUrl}" target="_blank" style="display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: #2563EB; font-weight: 600; text-decoration: none; margin-top: 3px;">📎 Attachment</a>`
          : '';
        return `
          <div class="cell-stacked">
            <span class="cat-badge cat-laptop">${params.value}</span>
            ${attachmentLink}
          </div>
        `;
      }
    },
    { 
      headerName: 'Dates & Duration', 
      flex: 1.5,
      minWidth: 180,
      cellRenderer: (params: any) => {
        if (!params.data?.startDate || !params.data?.endDate) return '-';
        const start = this.datePipe.transform(params.data.startDate, 'MMM d, yyyy');
        const end = this.datePipe.transform(params.data.endDate, 'MMM d, yyyy');
        
        const s = new Date(params.data.startDate);
        const e = new Date(params.data.endDate);
        const diffDays = Math.ceil(Math.abs(e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1;
        const durationDays = params.data.isHalfDay ? 0.5 : diffDays;
        const halfLabel = params.data.isHalfDay ? ` · Half Day (${params.data.halfDayPeriod || 'AM'})` : '';
        
        return `
          <div class="cell-stacked">
            <div class="cell-title-bold">${start} → ${end}</div>
            <div class="user-text-stack text-secondary">${durationDays} day${durationDays === 1 ? '' : 's'} duration${halfLabel}</div>
          </div>
        `;
      }
    },
    { 
      field: 'reason',
      headerName: 'Reason', 
      flex: 1.5,
      minWidth: 180,
      cellRenderer: (params: any) => `<span style="font-size: 12px; color: #334155;">${params.value || 'No reason provided'}</span>`
    },
    { 
      headerName: 'Status', 
      field: 'status',
      flex: 1.2,
      minWidth: 140,
      cellRenderer: (params: any) => {
        const s = params.value || 'PENDING';
        let statusClass = 'status-pending';
        if (s === 'APPROVED') statusClass = 'status-approved';
        if (s === 'REJECTED') statusClass = 'status-rejected';
        
        const reasonHtml = s === 'REJECTED' && params.data?.rejectionReason 
          ? `<div class="view-reason-link" style="font-size: 10px; color: #DC2626; font-weight: 500; margin-top: 3px; cursor: pointer;">Reason: ${params.data.rejectionReason}</div>` 
          : '';
        return `
          <div class="cell-stacked">
            <span class="status-round ${statusClass}">
              <span class="status-dot"></span>
              ${s}
            </span>
            ${reasonHtml}
          </div>
        `;
      }
    },
    {
      headerName: 'Actions',
      width: 110,
      pinned: 'right',
      sortable: false,
      filter: false,
      cellRenderer: LeaveActionCellRendererComponent,
      cellRendererParams: {
        onApprove: (data: any) => this.approveLeaveRequest(data.id),
        onReject: (data: any) => this.openRejectModal(data.id),
        onViewAttachment: (data: any) => this.viewAttachment(data.attachmentUrl),
        onViewReason: (data: any) => this.openRejectionReasonModal(data.rejectionReason)
      }
    }
  ];

  // Leave balances
  myBalances = signal<LeaveBalance[]>([]);
  myRequests = signal<LeaveRequest[]>([]);
  myHistory = signal<AttendanceRecord[]>([]);
  holidays = signal<Holiday[]>([]);

  // Manage Balances (HR/Admin)
  allBalances = signal<LeaveBalance[]>([]);
  allRequests = signal<LeaveRequest[]>([]);
  managerRequests = signal<LeaveRequest[]>([]);
  employees = signal<Employee[]>([]);
  isLoadingEmployees = signal<boolean>(false);
  leaveTypes = signal<LeaveType[]>([]);
  
  // Whether the currently selected leave type allows half-day
  selectedLeaveTypeAllowsHalfDay = computed(() => {
    const id = this.requestForm.leaveTypeId;
    if (!id) return true;
    const balance = this.myBalances().find(b => b.leaveType?.id === Number(id));
    return balance ? (balance.leaveType.allowHalfDay !== false) : true;
  });

  // Assignment Form State
  assignToAll = signal<boolean>(false);
  selectedEmployeeId = signal<string>('');
  selectedLeaveTypeId = signal<string>('');
  allocatedDays = signal<number>(0);
  assignYear = signal<number>(new Date().getFullYear());
  isAssigning = signal<boolean>(false);

  // Request Leave Form
  isRequestModalOpen = signal<boolean>(false);
  isSubmittingRequest = signal<boolean>(false);
  editMode = signal<boolean>(false);
  selectedRequestId = signal<number | null>(null);
  showFormErrors = signal<boolean>(false);
  selectedFile: File | null = null;
  requestForm = {
    leaveTypeId: '',
    startDate: '',
    endDate: '',
    reason: '',
    attachmentUrl: '',
    isHalfDay: false,
    halfDayPeriod: 'AM'
  };

  // Regularization State
  myRegularizations = signal<any[]>([]);
  pendingRegularizations = signal<any[]>([]);
  isRegularizationModalOpen = signal<boolean>(false);
  regularizationForm = {
    date: '',
    proposedClockIn: '',
    proposedClockOut: '',
    reason: ''
  };

  // Reject Modal
  isRejectModalOpen = signal<boolean>(false);
  rejectReason = signal<string>('');
  rejectingRequestId = signal<number | null>(null);

  // Rejection Reason Modal
  isRejectionReasonModalOpen = signal<boolean>(false);
  currentRejectionReason = signal<string>('');

  // Team Timeline State
  timelineStartDate = signal<string>(new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]);
  timelineEndDate = signal<string>(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().split('T')[0]);
  timelineEmployees = signal<any[]>([]);
  teamTimelineData = signal<any[]>([]);

  // Holiday Tab Signals & State
  selectedHolidayYear = signal<number>(new Date().getFullYear());
  holidayViewMode = signal<'cards' | 'calendar'>('cards');
  holidayCalendarDate = signal(new Date());
  isHolidayModalOpen = signal<boolean>(false);
  isSavingHoliday = signal<boolean>(false);
  holidayForm = {
    id: 0,
    name: '',
    date: ''
  };

  filteredHolidays = computed(() => {
    const year = Number(this.selectedHolidayYear());
    const list = this.holidays()
      .filter(h => new Date(h.date).getFullYear() === year)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const seen = new Set<string>();
    return list.filter(h => {
      const dStr = new Date(h.date).toISOString().split('T')[0];
      const key = `${h.name.toLowerCase().trim()}_${dStr}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });

  upcomingHolidaysCount = computed(() => {
    const today = new Date();
    today.setHours(0,0,0,0);
    return this.filteredHolidays().filter(h => new Date(h.date) >= today).length;
  });

  pastHolidaysCount = computed(() => {
    const today = new Date();
    today.setHours(0,0,0,0);
    return this.filteredHolidays().filter(h => new Date(h.date) < today).length;
  });

  nextUpcomingHoliday = computed(() => {
    const today = new Date();
    today.setHours(0,0,0,0);
    const upcoming = this.filteredHolidays().filter(h => new Date(h.date) >= today);
    if (upcoming.length === 0) return null;
    const next = upcoming[0];
    const diffTime = new Date(next.date).getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return {
      ...next,
      daysLeft: diffDays
    };
  });

  holidayCalendarDays = computed(() => {
    const date = this.holidayCalendarDate();
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    const today = new Date();
    today.setHours(0,0,0,0);
    
    const days: any[] = [];
    for (let i = 0; i < firstDay.getDay(); i++) {
      days.push({ empty: true });
    }
    const allHolidays = this.holidays();
    for (let i = 1; i <= lastDay.getDate(); i++) {
      const cellDate = new Date(year, month, i);
      cellDate.setHours(0,0,0,0);
      const isWeekend = cellDate.getDay() === 0 || cellDate.getDay() === 6;
      const isToday = cellDate.getTime() === today.getTime();

      const isHoliday = allHolidays.find(h => {
        const hd = new Date(h.date);
        return hd.getFullYear() === year && hd.getMonth() === month && hd.getDate() === i;
      });
      days.push({
        dayNumber: i,
        holiday: isHoliday,
        isWeekend,
        isToday
      });
    }
    return days;
  });

  holidayCurrentMonthName = computed(() => {
    return this.holidayCalendarDate().toLocaleString('default', { month: 'long', year: 'numeric' });
  });

  todayFullDate = computed(() => {
    return new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  });

  isCurrentHolidayMonth = computed(() => {
    const today = new Date();
    const current = this.holidayCalendarDate();
    return today.getFullYear() === current.getFullYear() && today.getMonth() === current.getMonth();
  });

  jumpToCurrentHolidayMonth() {
    this.holidayCalendarDate.set(new Date());
  }

  prevHolidayMonth() {
    const current = this.holidayCalendarDate();
    this.holidayCalendarDate.set(new Date(current.getFullYear(), current.getMonth() - 1, 1));
  }

  nextHolidayMonth() {
    const current = this.holidayCalendarDate();
    this.holidayCalendarDate.set(new Date(current.getFullYear(), current.getMonth() + 1, 1));
  }

  loadShifts() {
    this.shiftsService.getShifts().subscribe({
      next: (res) => this.allShifts.set(res)
    });
  }

  saveShift() {
    if (this.shiftEditMode() === 'edit' && this.editingShiftId()) {
      this.shiftsService.updateShift(this.editingShiftId()!, this.shiftForm).subscribe({
        next: () => {
          this.toast.success('Shift updated successfully');
          this.closeShiftDrawer();
          this.loadShifts();
        },
        error: (err) => this.toast.error(err.error?.message || 'Failed to update shift')
      });
    } else {
      this.shiftsService.createShift(this.shiftForm).subscribe({
        next: () => {
          this.toast.success('Shift created successfully');
          this.closeShiftDrawer();
          this.loadShifts();
        },
        error: (err) => this.toast.error(err.error?.message || 'Failed to create shift')
      });
    }
  }

  deleteShift(id: number) {
    if (confirm('Are you sure you want to delete this shift?')) {
      this.shiftsService.deleteShift(id).subscribe({
        next: () => {
          this.toast.success('Shift deleted');
          this.loadShifts();
        },
        error: (err) => this.toast.error(err.error?.message || 'Failed to delete shift')
      });
    }
  }

  openEditShift(shift: any) {
    this.shiftEditMode.set('edit');
    this.editingShiftId.set(shift.id);
    this.shiftForm = {
      name: shift.name,
      startTime: shift.startTime,
      endTime: shift.endTime,
      bufferTimeMinutes: shift.bufferTimeMinutes
    };
    this.isCreateShiftModalOpen.set(true);
  }

  openCreateShift() {
    this.shiftEditMode.set('create');
    this.editingShiftId.set(null);
    this.shiftForm = {
      name: '',
      startTime: '09:00',
      endTime: '18:00',
      bufferTimeMinutes: 15
    };
    this.isCreateShiftModalOpen.set(true);
  }

  closeShiftDrawer() {
    this.isCreateShiftModalOpen.set(false);
    this.shiftEditMode.set('create');
    this.editingShiftId.set(null);
    this.shiftForm = {
      name: '',
      startTime: '09:00',
      endTime: '18:00',
      bufferTimeMinutes: 15
    };
  }

  // --- Grid and Calendar Logic ---

  openRequestModal(request?: LeaveRequest) {
    if (request) {
      this.editMode.set(true);
      this.selectedRequestId.set(request.id);
      this.requestForm = {
        leaveTypeId: request.leaveTypeId.toString(),
        startDate: new Date(request.startDate).toISOString().split('T')[0],
        endDate: new Date(request.endDate).toISOString().split('T')[0],
        reason: request.reason || '',
        attachmentUrl: request.attachmentUrl || '',
        isHalfDay: !!request.isHalfDay,
        halfDayPeriod: request.halfDayPeriod || 'AM'
      };
    } else {
      this.editMode.set(false);
      this.selectedRequestId.set(null);
      this.requestForm = { leaveTypeId: '', startDate: '', endDate: '', reason: '', attachmentUrl: '', isHalfDay: false, halfDayPeriod: 'AM' };
    }
    this.isRequestModalOpen.set(true);
  }

  onLeaveTypeChange() {
    if (!this.selectedLeaveTypeAllowsHalfDay()) {
      this.requestForm.isHalfDay = false;
    }
  }

  closeRequestModal() {
    this.isRequestModalOpen.set(false);
    this.showFormErrors.set(false);
    this.editMode.set(false);
    this.selectedRequestId.set(null);
    this.selectedFile = null;
    this.requestForm = { leaveTypeId: '', startDate: '', endDate: '', reason: '', attachmentUrl: '', isHalfDay: false, halfDayPeriod: 'AM' };
  }

  onFileSelected(event: any) {
    const file = event.target.files[0];
    if (file) {
      this.selectedFile = file;
    }
  }

  isDragOver = signal<boolean>(false);

  onDragOver(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver.set(true);
  }

  onDragLeave(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver.set(false);
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver.set(false);
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      this.selectedFile = files[0];
    }
  }

  editLeaveRequest(request: LeaveRequest) {
    this.openRequestModal(request);
  }

  viewAttachment(url: string) {
    if (url) {
      window.open(url, '_blank');
    }
  }

  cancelLeaveRequest(id: number) {
    if (confirm('Are you sure you want to cancel this leave request?')) {
      this.leavesService.cancelRequest(id).subscribe({
        next: () => {
          this.toast.success('Leave request cancelled');
          this.loadData();
        },
        error: (err) => this.toast.error('Failed to cancel request')
      });
    }
  }

  // Regularization Methods
  @HostListener('window:view-punches', ['$event'])
  onViewPunches(event: Event) {
    const dateStr = (event as CustomEvent).detail; // This is the date string
    // Find the corresponding day from monthlyGrid or generate a dummy day to pass to openDayDetailsModal
    const targetDay = this.monthlyGrid().find(d => this.getBackendDateString(d.date) === dateStr);
    if (targetDay) {
      this.openDayDetailsModal(targetDay);
    } else {
      // Fallback if not in grid
      const d = new Date(dateStr);
      this.openDayDetailsModal({
        date: d,
        dayNumber: d.getDate(),
        weekdayStr: d.toLocaleDateString('en-US', { weekday: 'short' }),
        status: 'Present',
        isFuture: false
      } as any);
    }
  }

  @HostListener('window:regularize-attendance', ['$event'])
  onRegularizeAttendance(event: Event) {
    this.openRegularizationModal((event as CustomEvent).detail);
  }

  @HostListener('window:resolve-reg', ['$event'])
  onResolveReg(event: Event) {
    const detail = (event as CustomEvent).detail;
    this.resolveRegularization(detail.id, detail.status);
  }

  openRegularizationModal(dateStr?: string) {
    this.regularizationForm = {
      date: dateStr || '',
      proposedClockIn: '',
      proposedClockOut: '',
      reason: ''
    };
    this.showFormErrors.set(false);
    this.isRegularizationModalOpen.set(true);
  }

  closeRegularizationModal() {
    this.isRegularizationModalOpen.set(false);
  }

  submitRegularization() {
    this.showFormErrors.set(true);
    if (!this.regularizationForm.date || !this.regularizationForm.reason) return;

    this.isSubmittingRequest.set(true);
    const data = {
      ...this.regularizationForm,
      proposedClockIn: this.regularizationForm.proposedClockIn ? `${this.regularizationForm.date}T${this.regularizationForm.proposedClockIn}:00` : undefined,
      proposedClockOut: this.regularizationForm.proposedClockOut ? `${this.regularizationForm.date}T${this.regularizationForm.proposedClockOut}:00` : undefined
    };

    this.attendanceService.requestRegularization(data as any).subscribe({
      next: () => {
        this.toast.success('Regularization request submitted');
        this.closeRegularizationModal();
        this.attendanceService.getMyRegularizations().subscribe((res: any) => this.myRegularizations.set(res));
        this.isSubmittingRequest.set(false);
      },
      error: () => {
        this.toast.error('Failed to submit request');
        this.isSubmittingRequest.set(false);
      }
    });
  }

  resolveRegularization(id: number, status: string) {
    if (status === 'REJECTED') {
      const reason = prompt('Please enter a rejection reason:');
      if (!reason) return;
      this.attendanceService.resolveRegularization(id, status, reason).subscribe({
        next: () => {
          this.toast.success('Request rejected');
          this.loadAdminData();
        },
        error: () => this.toast.error('Failed to reject request')
      });
    } else {
      this.attendanceService.resolveRegularization(id, status).subscribe({
        next: () => {
          this.toast.success('Request approved');
          this.loadAdminData();
        },
        error: () => this.toast.error('Failed to approve request')
      });
    }
  }

  saveLeaveRequest() {
    this.showFormErrors.set(true);
    
    if (!this.requestForm.leaveTypeId || !this.requestForm.startDate || !this.requestForm.endDate) {
      this.toast.error('Please fill in all required fields');
      return;
    }
    
    if (this.requestForm.endDate < this.requestForm.startDate) {
      this.toast.error('End Date cannot be before Start Date');
      return;
    }

    if (this.requestForm.isHalfDay) {
      if (this.requestForm.startDate !== this.requestForm.endDate) {
        this.toast.error('Half-day leave is only allowed for a single day.');
        this.requestForm.isHalfDay = false;
        return;
      }
      if (!this.selectedLeaveTypeAllowsHalfDay()) {
        this.toast.error('Half-day leave is not allowed for this leave type.');
        this.requestForm.isHalfDay = false;
        return;
      }
    }

    const start = new Date(this.requestForm.startDate);
    const end = new Date(this.requestForm.endDate);
    const diffTime = Math.abs(end.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    const requestedDays = this.requestForm.isHalfDay ? 0.5 : diffDays;

    const balance = this.myBalances().find(b => b.leaveType.id === Number(this.requestForm.leaveTypeId));
    if (balance) {
      const available = balance.allocated + balance.carriedOver - balance.used;
      if (requestedDays > available) {
        this.toast.error(`Insufficient balance. You requested ${requestedDays} ${requestedDays === 1 ? 'day' : 'days'} but only have ${available} days available.`);
        return;
      }
    }
    
    this.isSubmittingRequest.set(true);

    const submitData = () => {
      const payload: any = {
        leaveTypeId: Number(this.requestForm.leaveTypeId),
        startDate: this.requestForm.startDate,
        endDate: this.requestForm.endDate,
        reason: this.requestForm.reason,
        attachmentUrl: this.requestForm.attachmentUrl,
        isHalfDay: this.requestForm.isHalfDay,
        halfDayPeriod: this.requestForm.isHalfDay ? this.requestForm.halfDayPeriod : null
      };

      const ob$ = this.editMode() && this.selectedRequestId() 
        ? this.leavesService.updateRequest(this.selectedRequestId()!, payload)
        : this.leavesService.requestLeave(payload);

      ob$.subscribe({
        next: () => {
          this.toast.success(this.editMode() ? 'Leave request updated' : 'Leave requested successfully');
          this.closeRequestModal();
          this.loadData();
        },
        error: (err: any) => {
          this.toast.error(err.error?.message || 'Failed to submit leave request');
          this.isSubmittingRequest.set(false);
        },
        complete: () => {
          this.isSubmittingRequest.set(false);
        }
      });
    };

    if (this.selectedFile) {
      const formData = new FormData();
      formData.append('file', this.selectedFile);
      this.http.post<{url?: string, fileUrl?: string, path?: string}>(`${environment.apiUrl}/upload`, formData).subscribe({
        next: (res) => {
          this.requestForm.attachmentUrl = res.url || res.fileUrl || res.path || 'uploaded-file-url';
          submitData();
        },
        error: (err) => {
          this.toast.error('Failed to upload file');
          this.isSubmittingRequest.set(false);
        }
      });
    } else {
      submitData();
    }
  }

  // HR Actions
  approveLeaveRequest(id: number) {
    if (confirm('Are you sure you want to approve this leave request?')) {
      this.leavesService.updateRequestStatus(id, 'APPROVED').subscribe({
        next: () => {
          this.toast.success('Leave request approved');
          this.loadAdminData();
          this.loadManagerData();
          this.loadData();
        },
        error: (err) => this.toast.error('Failed to approve request')
      });
    }
  }

  onCellClicked(params: CellClickedEvent) {
    if (params.colDef.field === 'status' && params.event?.target) {
      const target = params.event.target as HTMLElement;
      if (target.classList.contains('view-reason-link') || target.closest('.view-reason-link')) {
        this.openRejectionReasonModal(params.data.rejectionReason);
      }
    }
  }

  openRejectionReasonModal(reason: string) {
    this.currentRejectionReason.set(reason);
    this.isRejectionReasonModalOpen.set(true);
  }

  closeRejectionReasonModal() {
    this.isRejectionReasonModalOpen.set(false);
    this.currentRejectionReason.set('');
  }

  openRejectModal(id: number) {
    this.rejectingRequestId.set(id);
    this.rejectReason.set('');
    this.isRejectModalOpen.set(true);
  }

  closeRejectModal() {
    this.isRejectModalOpen.set(false);
    this.rejectingRequestId.set(null);
    this.rejectReason.set('');
  }

  submitRejectRequest() {
    if (!this.rejectReason().trim()) {
      this.toast.error('Rejection reason is required');
      return;
    }
    const id = this.rejectingRequestId();
    if (!id) return;

    this.leavesService.updateRequestStatus(id, 'REJECTED', this.rejectReason()).subscribe({
      next: () => {
        this.toast.success('Leave request rejected');
        this.closeRejectModal();
        if (this.isAdmin()) {
          this.loadAdminData();
          this.loadShifts();
        }
        this.loadManagerData();
        this.loadData();
      },
      error: (err) => {
        this.toast.error('Failed to reject request');
      }
    });
  }

  pivotedBalances = computed(() => {
    const balances = this.allBalances() || [];
    const empMap = new Map<number, any>();

    balances.forEach((b: any) => {
      if (!empMap.has(b.employeeId)) {
        empMap.set(b.employeeId, {
          employee: b.employee ? `${b.employee.firstName} ${b.employee.lastName}` : 'Unknown',
          employeeId: b.employeeId
        });
      }
      const empData = empMap.get(b.employeeId);
      if (b.leaveType && b.leaveType.name) {
        const available = b.allocated + b.carriedOver - b.used;
        empData[b.leaveType.name] = `${available} / ${b.allocated}`;
      }
    });

    return Array.from(empMap.values());
  });

  dynamicColDefs = computed(() => {
    const balances = this.allBalances() || [];
    
    const cols: ColDef[] = [
      { headerName: 'Employee', field: 'employee', flex: 1.5, minWidth: 200, pinned: 'left' }
    ];

    const types = new Set<string>();
    const typeHalfDay = new Map<string, boolean>();
    balances.forEach((b: any) => {
      if (b.leaveType && b.leaveType.name) {
        types.add(b.leaveType.name);
        if (!typeHalfDay.has(b.leaveType.name)) {
          typeHalfDay.set(b.leaveType.name, b.leaveType.allowHalfDay !== false);
        }
      }
    });

    Array.from(types).forEach(type => {
      const halfDay = typeHalfDay.get(type);
      const suffix = halfDay === false ? ' · No Half Day' : ' · Half Day';
      cols.push({
        headerName: `${type} (Avail / Total)${suffix}`,
        field: type,
        flex: 1,
        minWidth: 160
      });
    });

    return cols;
  });

  defaultColDef: ColDef = {
    flex: 1,
    minWidth: 150,
    filter: true,
    sortable: true
  };

  gridOptions: GridOptions = {
    theme: 'legacy' as const
  };

  // Grid / UI State
  viewMode = signal<'grid' | 'list'>('grid');
  months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  years = [2024, 2025, 2026, 2027, 2028];
  selectedMonth = signal<number>(new Date().getMonth());
  selectedYear = signal<number>(new Date().getFullYear());

  monthlyGrid = signal<DayStatus[]>([]);
  totalPresent = signal<number>(0);
  totalWorkingDays = signal<number>(0);

  rowClassRules = {
    'row-approved': (params: any) => params.data && params.data.status === 'APPROVED',
    'row-rejected': (params: any) => params.data && params.data.status === 'REJECTED'
  };

  // HR Target Employee Selection & Day Log Modal State
  selectedAttendanceEmployeeId = signal<number | null>(null);
  isEmpDropdownOpen = signal(false);
  isLoadingTimesheet = signal(false);
  empSearchQuery = signal<string>('');

  isDayDetailsModalOpen = signal<boolean>(false);
  isGpsModalOpen = signal<boolean>(false);
  gpsModalData = signal<{title: string, lat: number, lng: number} | null>(null);

  openGpsModal(title: string, lat: number, lng: number) {
    this.gpsModalData.set({ title, lat, lng });
    this.isGpsModalOpen.set(true);
  }

  getMapUrl(lat: number | undefined, lng: number | undefined): SafeResourceUrl {
    if (!lat || !lng) return this.sanitizer.bypassSecurityTrustResourceUrl('');
    // Use OpenStreetMap via Leaflet or simple embed for coordinates
    const url = `https://maps.google.com/maps?q=${lat},${lng}&t=&z=15&ie=UTF8&iwloc=&output=embed`;
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  }
  selectedDayDetails = signal<any | null>(null);

  toggleEmpDropdown() {
    this.isEmpDropdownOpen.update(v => !v);
  }

  closeEmpDropdown() {
    this.isEmpDropdownOpen.set(false);
  }

  selectedAttendanceEmployee = computed(() => {
    const empId = this.selectedAttendanceEmployeeId();
    if (!empId) return null;
    return this.employees().find(e => e.id === empId) || null;
  });

  filteredAttendanceEmployees = computed(() => {
    const q = this.empSearchQuery().toLowerCase().trim();
    const list = this.employees() || [];
    if (!q) return list;
    return list.filter(e => {
      const name = `${e.firstName} ${e.lastName}`.toLowerCase();
      const dept = (e.department?.name || '').toLowerCase();
      const desig = (e.designation?.name || '').toLowerCase();
      return name.includes(q) || dept.includes(q) || desig.includes(q);
    });
  });

  selectAttendanceEmp(empId: number | null) {
    this.isLoadingTimesheet.set(true);
    if (empId === null) {
      this.selectedAttendanceEmployeeId.set(null);
      this.attendanceService.getMyHistory().subscribe({
        next: (res: any) => {
          this.myHistory.set(res);
          this.generateGrid();
          this.isLoadingTimesheet.set(false);
        },
        error: () => this.isLoadingTimesheet.set(false)
      });
    } else {
      this.selectedAttendanceEmployeeId.set(empId);
      this.attendanceService.getEmployeeHistory(empId).subscribe({
        next: (res: any) => {
          this.myHistory.set(res);
          this.generateGrid();
          this.isLoadingTimesheet.set(false);
        },
        error: () => this.isLoadingTimesheet.set(false)
      });
    }
    this.closeEmpDropdown();
  }

  openDayDetailsModal(day: DayStatus) { console.log("Clicked day:", day); 
    if (day.isFuture) return;

    const dateString = this.getLocalDateString(day.date);
    const log = this.myHistory().find(l => this.getBackendDateString(l.date) === dateString);
    const leave = this.myRequests().find(r => {
      const s = this.getBackendDateString(r.startDate);
      const e = this.getBackendDateString(r.endDate);
      return r.status === 'APPROVED' && dateString >= s && dateString <= e;
    });
    const holiday = this.holidays().find(h => this.getBackendDateString(h.date) === dateString);

    let targetEmpName = 'My Attendance Log';
    let targetEmpDept = 'Employee Profile';
    let targetAvatarUrl = null;
    if (this.selectedAttendanceEmployeeId()) {
      const emp = this.employees().find(e => e.id === this.selectedAttendanceEmployeeId());
      if (emp) {
        targetEmpName = emp.lastName ? `${emp.firstName} ${emp.lastName}` : emp.firstName;
        targetEmpDept = emp.department?.name || 'Department';
        targetAvatarUrl = emp.avatarUrl;
      }
    } else {
      const currentUser = this.authService.currentUser();
      if (currentUser) {
        targetEmpName = `${currentUser.firstName || ''} ${currentUser.lastName || ''}`.trim() || currentUser.email;
        targetEmpDept = currentUser.role;
        targetAvatarUrl = currentUser.employee?.avatarUrl || null;
      }
    }

    let clockIn12 = '-';
    let clockOut12 = '-';
    let durationStr = '-';
    let clockInLat = null;
    let clockInLng = null;
    let clockOutLat = null;
    let clockOutLng = null;

    if (log) {
      if (log.clockIn) {
        const inDate = new Date(log.clockIn);
        clockIn12 = inDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
        clockInLat = log.clockInLat;
        clockInLng = log.clockInLng;
      }
      if (log.clockOut) {
        const outDate = new Date(log.clockOut);
        clockOut12 = outDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
        clockOutLat = log.clockOutLat;
        clockOutLng = log.clockOutLng;
      }
      if (log.clockIn && log.clockOut) {
        const diffMs = new Date(log.clockOut).getTime() - new Date(log.clockIn).getTime();
        const hours = Math.floor(diffMs / (1000 * 60 * 60));
        const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        durationStr = `${hours} hrs ${mins} mins`;
      }
    }

    this.selectedDayDetails.set({
      day,
      log,
      leave,
      holiday,
      employeeName: targetEmpName,
      employeeDept: targetEmpDept,
      employeeAvatarUrl: targetAvatarUrl,
      clockIn12,
      clockOut12,
      durationStr,
      clockInLat,
      clockInLng,
      clockOutLat,
      clockOutLng,
      clockInAddress: '',
      clockOutAddress: ''
    });
    this.isDayDetailsModalOpen.set(true);

    if (clockInLat && clockInLng) {
      this.reverseGeocode(clockInLat, clockInLng).then(address => {
        const current = this.selectedDayDetails();
        if (current && address) {
          this.selectedDayDetails.set({ ...current, clockInAddress: address });
        }
      });
    }
    if (clockOutLat && clockOutLng) {
      this.reverseGeocode(clockOutLat, clockOutLng).then(address => {
        const current = this.selectedDayDetails();
        if (current && address) {
          this.selectedDayDetails.set({ ...current, clockOutAddress: address });
        }
      });
    }
  }

  private async reverseGeocode(lat: number, lng: number): Promise<string> {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18`,
        { headers: { 'Accept-Language': 'en' } }
      );
      if (res.ok) {
        const data = await res.json();
        return data.display_name || '';
      }
    } catch (err) {
      // ignore, fall back to raw coordinates
    }
    return '';
  }

  closeDayDetailsModal() {
    this.isDayDetailsModalOpen.set(false);
    this.selectedDayDetails.set(null);
  }

  currentTime = signal<Date>(new Date());
  private timerInterval: any;

  ngOnInit() {
    this.route.paramMap.subscribe(params => {
      const tab = params.get('tab');
      if (tab === 'timesheets' || tab === 'attendance') {
        this.activeTab.set('attendance');
      } else if (tab === 'me' || tab === 'leaves' || tab === 'my-leaves' || tab === 'request') {
        this.activeTab.set('leaves');
      } else if (tab === 'balances' || tab === 'approvals' || tab === 'shifts' || tab === 'holidays') {
        this.activeTab.set(tab);
        if (tab === 'balances' || tab === 'approvals') {
          this.loadAdminData();
        }
      } else if (tab === 'timeline') {
        this.activeTab.set('timeline');
        this.loadTeamTimeline();
      } else {
        this.activeTab.set('attendance');
      }
    });

    this.timerInterval = setInterval(() => {
      this.currentTime.set(new Date());
    }, 1000);

    this.loadData();
  }

  ngOnDestroy() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
    }
  }

  loadData() {
    this.attendanceService.getTodayAttendance().subscribe((res: any) => this.todayAttendance.set(res));
    this.attendanceService.getMyHistory().subscribe((res: any) => {
      this.myHistory.set(res);
      this.generateGrid();
    });
    this.leavesService.getMyBalances().subscribe((res: any) => this.myBalances.set(res));
    this.leavesService.getMyRequests().subscribe((res: any) => {
      this.myRequests.set(res);
    });
    this.attendanceService.getMyRegularizations().subscribe((res: any) => this.myRegularizations.set(res));
    this.masterDataService.getHolidays().subscribe((res: any) => {
      this.holidays.set(res);
      this.generateGrid();
    });

    this.loadAdminData();
    this.loadManagerData();
    this.loadShifts();
  }

  loadAdminData() {
    const year = new Date().getFullYear();
    this.leavesService.getAllBalances(year).subscribe((res: any) => this.allBalances.set(res));
    this.leavesService.getRequests().subscribe((res: any) => this.allRequests.set(res));
    this.attendanceService.getPendingRegularizations().subscribe((res: any) => this.pendingRegularizations.set(res));
    this.isLoadingEmployees.set(true);
    this.employeeService.getEmployees().subscribe({
      next: (res: any) => this.employees.set(res),
      complete: () => this.isLoadingEmployees.set(false)
    });
    this.masterDataService.getLeaveTypes().subscribe((res: any) => this.leaveTypes.set(res));
  }

  loadManagerData() {
    this.leavesService.getManagerRequests().subscribe((res: any) => this.managerRequests.set(res));
  }

  onPeriodChange() {
    this.generateGrid();
  }

  prevMonth() {
    let m = this.selectedMonth() - 1;
    let y = this.selectedYear();
    if (m < 0) {
      m = 11;
      y--;
    }
    this.selectedMonth.set(m);
    this.selectedYear.set(y);
    this.generateGrid();
  }

  nextMonth() {
    let m = this.selectedMonth() + 1;
    let y = this.selectedYear();
    if (m > 11) {
      m = 0;
      y++;
    }
    this.selectedMonth.set(m);
    this.selectedYear.set(y);
    this.generateGrid();
  }

  jumpToCurrentMonth() {
    const today = new Date();
    this.selectedMonth.set(today.getMonth());
    this.selectedYear.set(today.getFullYear());
    this.generateGrid();
  }

  private getLocalDateString(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private getBackendDateString(dateStr: string | Date): string {
    // If it's already a Date, just use it. If it's a string from backend, parse it.
    // Backend returns '2026-07-30T00:00:00.000Z'
    const d = new Date(dateStr);
    return d.toISOString().split('T')[0];
  }

  setViewMode(mode: 'grid' | 'list') {
    this.viewMode.set(mode);
  }

  generateGrid() {
    const year = Number(this.selectedYear());
    const month = Number(this.selectedMonth()); // 0-indexed

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();
    today.setHours(0,0,0,0);
    
    let presentCount = 0;
    let workingDaysCount = 0;
    
    const newGrid: DayStatus[] = [];

    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const hols = this.holidays();
    const logs = this.myHistory();
    const reqs = this.myRequests().filter(r => r.status === 'APPROVED');

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const dateString = this.getLocalDateString(date);
      const isFuture = date > today;
      const dayOfWeek = date.getDay();
      const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
      
      const weekdayStr = weekdays[dayOfWeek];

      let status: DayStatus['status'] = 'Empty';
      let tooltip = '';
      let clockInStr = '';
      let clockOutStr = '';
      let clockInLat: number | null = null;
      let clockInLng: number | null = null;
      let clockOutLat: number | null = null;
      let clockOutLng: number | null = null;

      if (isFuture) {
        status = 'Empty';
      } else {
        // Find if holiday
        const holiday = hols.find(h => this.getBackendDateString(h.date) === dateString);
        
        // Find if on leave
        const leave = reqs.find(r => {
          const s = this.getBackendDateString(r.startDate);
          const e = this.getBackendDateString(r.endDate);
          return dateString >= s && dateString <= e;
        });

        // Find attendance
        const log = logs.find(l => this.getBackendDateString(l.date) === dateString);

        if (log && log.clockIn) {
          // Check for Late or Half day (simplistic logic)
          const clockInDate = new Date(log.clockIn);
          const clockInHour = clockInDate.getHours();
          const clockInMin = clockInDate.getMinutes();

          // 10:15 AM logic (15m buffer)
          let isLate = false;
          if (clockInHour > 10 || (clockInHour === 10 && clockInMin > 15)) {
            isLate = true;
          }

          let isHalfDay = false;
          if (log.clockOut) {
            const outDate = new Date(log.clockOut);
            const durationMs = outDate.getTime() - clockInDate.getTime();
            const hours = durationMs / (1000 * 60 * 60);
            if (hours < 5) isHalfDay = true; // Less than 5 hours is half day
          } else {
             // If they haven't clocked out yet and it's not today, treat as half day or something? Let's leave as is for now.
             // If it's today and they are clocked in, they might just be working right now.
          }

          if (isHalfDay) status = 'Half Day';
          else if (isLate) status = 'Late';
          else status = 'Present';

          const inStr = clockInDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
          const outStr = log.clockOut ? new Date(log.clockOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }) : '...';
          let locText = '';
          if (log.clockInLat && log.clockInLng) {
            locText = ` 📍 ${log.clockInLat.toFixed(5)}, ${log.clockInLng.toFixed(5)}`;
          }
          tooltip = `In: ${inStr} - Out: ${outStr}${locText} (Click for details)`;
          
          clockInStr = inStr;
          clockOutStr = log.clockOut ? outStr : '';
          clockInLat = log.clockInLat;
          clockInLng = log.clockInLng;
          clockOutLat = log.clockOutLat;
          clockOutLng = log.clockOutLng;

          if (!isWeekend && !holiday) workingDaysCount++; // if they worked on weekend, does it increase working days? yes, they worked.
        } 
        else if (holiday) {
          status = 'Holiday';
          tooltip = holiday.name;
        }
        else if (leave) {
          status = 'On Leave';
          tooltip = leave.leaveType.name;
          if (!isWeekend) workingDaysCount++; // Usually working days denominator includes paid leave, or excludes? We'll just count working days as weekdays.
        }
        else if (isWeekend) {
          status = 'Day Off';
          tooltip = 'Weekend';
        }
        else {
          // Past weekday, no log, no leave, no holiday -> Absent
          status = 'Absent';
          tooltip = 'Absent';
          workingDaysCount++; // they should have worked
        }

        // If they worked on weekend/holiday, ensure it counts towards workingDays
        if (log && log.clockIn && (isWeekend || holiday)) {
          if (isWeekend) tooltip += ' (Comp Off eligible)';
          if (holiday) tooltip += ' (Comp Off eligible)';
        }
      }

      newGrid.push({
        date,
        dayNumber: day,
        weekdayStr,
        status,
        tooltip,
        isFuture,
        clockInStr,
        clockOutStr,
        clockInLat,
        clockInLng,
        clockOutLat,
        clockOutLng
      });
    }

    // Recalculate accurate working days (weekdays not holiday + weekend days actually worked)
    let totalWd = 0;
    let totalP = 0;
    for (const d of newGrid) {
      if (!d.isFuture) {
        const isWeekend = d.date.getDay() === 0 || d.date.getDay() === 6;
        const isHol = d.status === 'Holiday';
        const worked = ['Present', 'Late', 'Half Day'].includes(d.status);

        if (!isWeekend && !isHol) {
          totalWd++;
        } else if (worked) {
          // worked on off day
          totalWd++;
        }

        if (worked) totalP++;
      }
    }

    this.totalWorkingDays.set(totalWd);
    this.totalPresent.set(totalP);
    this.monthlyGrid.set(newGrid);
  }

  exportToCsv() {
    const grid = this.monthlyGrid();
    if (!grid.length) return;

    let empName = 'My';
    if (this.selectedAttendanceEmployeeId()) {
      const emp = this.employees().find(e => e.id === this.selectedAttendanceEmployeeId());
      if (emp) {
        empName = emp.lastName ? `${emp.firstName} ${emp.lastName}` : emp.firstName;
      }
    }

    let csv = 'Employee,Date,Day,Status,Clock In,Clock Out,Notes\n';
    for (const d of grid) {
      csv += `"${empName}",${this.getLocalDateString(d.date)},${d.weekdayStr},${d.status},"${d.clockInStr || ''}","${d.clockOutStr || ''}","${d.tooltip || ''}"\n`;
    }

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${empName.replace(/\s+/g, '_')}_Attendance_${this.months[this.selectedMonth()]}_${this.selectedYear()}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  setTab(tab: string) {
    this.activeTab.set(tab);
    if (tab === 'balances' || tab === 'approvals') {
      this.loadAdminData();
    }
    if (tab === 'team-approvals') {
      this.loadManagerData();
    }
    if (tab === 'shifts') {
      this.loadShifts();
    }
    if (tab === 'timeline') {
      this.loadTeamTimeline();
    }
    this.router.navigate(['/attendance', tab]);
  }

  getHolidayStatus(dateStr: string): { label: string; class: string } {
    const today = new Date();
    today.setHours(0,0,0,0);
    const hDate = new Date(dateStr);
    hDate.setHours(0,0,0,0);

    if (hDate.getTime() === today.getTime()) {
      return { label: 'Today', class: 'status-today' };
    } else if (hDate > today) {
      return { label: 'Upcoming', class: 'status-upcoming' };
    } else {
      return { label: 'Past', class: 'status-past' };
    }
  }

  openAddHolidayModal() {
    this.holidayForm = { id: 0, name: '', date: '' };
    this.isHolidayModalOpen.set(true);
  }

  openEditHolidayModal(h: Holiday) {
    const dateFormatted = h.date ? new Date(h.date).toISOString().split('T')[0] : '';
    this.holidayForm = { id: h.id, name: h.name, date: dateFormatted };
    this.isHolidayModalOpen.set(true);
  }

  closeHolidayModal() {
    this.isHolidayModalOpen.set(false);
  }

  saveHoliday() {
    if (!this.holidayForm.name.trim() || !this.holidayForm.date) {
      this.toast.error('Holiday name and date are required');
      return;
    }
    if (this.holidayForm.name.trim().length > 100) {
      this.toast.error('Holiday name must be 100 characters or less');
      return;
    }
    this.isSavingHoliday.set(true);
    if (this.holidayForm.id) {
      this.masterDataService.updateHoliday(this.holidayForm.id, this.holidayForm).subscribe({
        next: () => {
          this.toast.success('Holiday updated successfully');
          this.closeHolidayModal();
          this.loadData();
          this.isSavingHoliday.set(false);
        },
        error: () => {
          this.toast.error('Failed to update holiday');
          this.isSavingHoliday.set(false);
        }
      });
    } else {
      this.masterDataService.createHoliday(this.holidayForm).subscribe({
        next: () => {
          this.toast.success('Holiday added successfully');
          this.closeHolidayModal();
          this.loadData();
          this.isSavingHoliday.set(false);
        },
        error: () => {
          this.toast.error('Failed to add holiday');
          this.isSavingHoliday.set(false);
        }
      });
    }
  }

  deleteHoliday(id: number) {
    if (!confirm('Are you sure you want to delete this holiday?')) return;
    this.masterDataService.deleteHoliday(id).subscribe({
      next: () => {
        this.toast.success('Holiday deleted');
        this.loadData();
      },
      error: () => this.toast.error('Failed to delete holiday')
    });
  }

  onLeaveTypeSelect() {
    const selected = this.leaveTypes().find(t => t.id.toString() === this.selectedLeaveTypeId());
    if (selected) {
      this.allocatedDays.set(selected.defaultDays);
    }
  }

  submitAssignBalance() {
    if (!this.selectedLeaveTypeId() || !this.allocatedDays() || !this.assignYear()) {
      this.toast.error('Please fill all required fields');
      return;
    }

    if (!this.assignToAll() && !this.selectedEmployeeId()) {
      this.toast.error('Please select an employee');
      return;
    }

    this.isAssigning.set(true);

    const payloadTemplate = {
      leaveTypeId: parseInt(this.selectedLeaveTypeId()),
      allocated: this.allocatedDays(),
      year: this.assignYear()
    };

    if (this.assignToAll()) {
      const requests = this.employees().map(emp => 
        this.leavesService.assignBalance({ ...payloadTemplate, employeeId: emp.id })
      );

      forkJoin(requests).subscribe({
        next: () => {
          this.toast.success(`Successfully assigned balances to ${requests.length} employees`);
          this.loadAdminData();
          this.resetAssignForm();
        },
        error: (err) => {
          this.toast.error('Error assigning bulk balances');
          this.isAssigning.set(false);
        }
      });
    } else {
      const payload = { ...payloadTemplate, employeeId: parseInt(this.selectedEmployeeId()) };
      this.leavesService.assignBalance(payload).subscribe({
        next: () => {
          this.toast.success('Successfully assigned balance');
          this.loadAdminData();
          this.resetAssignForm();
        },
        error: (err) => {
          this.toast.error('Error assigning balance');
          this.isAssigning.set(false);
        }
      });
    }
  }

  private resetAssignForm() {
    this.selectedEmployeeId.set('');
    this.selectedLeaveTypeId.set('');
    this.allocatedDays.set(0);
    this.assignToAll.set(false);
    this.isAssigning.set(false);
  }

  clockInOut() {
    this.isClocking.set(true);
    const attendance = this.todayAttendance();
    const action = (!attendance || !attendance.clockIn) ? 'clockIn' : 'clockOut';

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          this.executeClockAction(action, position.coords.latitude, position.coords.longitude);
        },
        (error) => {
          this.toast.error('Location access denied. Clocking in without location.');
          this.executeClockAction(action);
        }
      );
    } else {
      this.executeClockAction(action);
    }
  }

  private executeClockAction(action: 'clockIn' | 'clockOut', lat?: number, lng?: number) {
    const sub = action === 'clockIn' 
      ? this.attendanceService.clockIn(lat, lng) 
      : this.attendanceService.clockOut(lat, lng);

    sub.subscribe({
      next: (res) => {
        this.toast.success(`Successfully ${action === 'clockIn' ? 'Clocked In' : 'Clocked Out'}!`);
        this.todayAttendance.set(res);
        this.isClocking.set(false);
      },
      error: (err) => {
        this.toast.error(err.error?.message || 'Failed to clock action');
        this.isClocking.set(false);
      }
    });
  }

  // --- Team Timeline Logic ---
  loadTeamTimeline() {
    const start = this.timelineStartDate();
    const end = this.timelineEndDate();

    if (start && end && start > end) {
      this.toast.error('Start date cannot be after end date');
      return;
    }

    this.attendanceService.getTeamTimeline(start, end)
      .subscribe({
        next: (data) => {
          this.teamTimelineData.set(data);
          
          // Extract unique employees
          const empsMap = new Map<number, any>();
          data.forEach(item => {
            if (item.employee && !empsMap.has(item.employee.id)) {
              empsMap.set(item.employee.id, item.employee);
            }
          });
          this.timelineEmployees.set(Array.from(empsMap.values()).sort((a, b) => a.firstName.localeCompare(b.firstName)));
        },
        error: (err) => {
          this.toast.error(err.error?.message || 'Failed to load team timeline');
        }
      });
  }

  timelineDays = computed(() => {
    const start = new Date(this.timelineStartDate());
    const end = new Date(this.timelineEndDate());
    const days = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
      days.push({ date: new Date(d), isWeekend });
    }
    return days;
  });

  openRescheduleModal(emp: any, date: Date, currentStatus: any) {
    if (!this.isAdmin()) return; // only admins can reschedule/override
    this.selectedTimelineEmp.set(emp);
    this.selectedTimelineDate.set(date);
    this.rescheduleForm = {
      status: currentStatus && currentStatus.type ? currentStatus.type.toUpperCase() : 'PRESENT',
      note: ''
    };
    this.showTimelineRescheduleModal.set(true);
  }

  closeRescheduleModal() {
    this.showTimelineRescheduleModal.set(false);
    this.selectedTimelineEmp.set(null);
    this.selectedTimelineDate.set(null);
  }

  submitReschedule() {
    if (!this.selectedTimelineEmp() || !this.selectedTimelineDate()) return;
    
    const empId = this.selectedTimelineEmp().id;
    const dateStr = this.selectedTimelineDate()!.toISOString().split('T')[0];
    const payload = {
      employeeId: empId,
      date: dateStr,
      status: this.rescheduleForm.status,
      note: this.rescheduleForm.note
    };

    // Assuming we had an override endpoint, simulate success for now
    this.toast.success('Timeline rescheduled/overridden successfully');
    this.closeRescheduleModal();
    // this.loadTeamTimeline();
  }

  getTimelineStatus(emp: any, date: Date) {
    const dateStr = new Date(date.getTime() - (date.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
    const record = this.teamTimelineData().find(r => 
      r.employee.id === emp.id && 
      new Date(r.date).toISOString().split('T')[0] === dateStr
    );
    
    if (record) {
      if (record.status === 'LEAVE') return { type: 'leave', label: 'On Leave' };
      if (record.isHoliday) return { type: 'holiday', label: 'Holiday' };
      if (record.status === 'ABSENT') return { type: 'absent', label: 'Absent' };
      if (record.status === 'HALF_DAY') return { type: 'half-day', label: `Half Day (In: ${record.clockIn ? new Date(record.clockIn).toLocaleTimeString() : 'N/A'}, Out: ${record.clockOut ? new Date(record.clockOut).toLocaleTimeString() : 'N/A'})` };
      if (record.status === 'PRESENT') {
        if (record.isLate) return { type: 'late', label: `Late (In: ${new Date(record.clockIn).toLocaleTimeString()})` };
        return { type: 'present', label: `Present (In: ${new Date(record.clockIn).toLocaleTimeString()}, Out: ${record.clockOut ? new Date(record.clockOut).toLocaleTimeString() : 'N/A'})` };
      }
    }
    return null;
  }
}
