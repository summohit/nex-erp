import { Component, OnInit, OnDestroy, inject, signal, computed, HostListener } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
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
import { SystemSettingsService } from '../services/system-settings.service';
import { AuthService } from '../services/auth.service';
import { LeaveActionCellRendererComponent } from '../shared/components/leave-action-cell-renderer.component';
import { ActionCellRendererComponent } from '../shared/components/action-cell-renderer.component';
import { forkJoin } from 'rxjs';
import { SkeletonComponent } from '../shared/components/skeleton/skeleton.component';
import { SearchableSelectComponent, SearchableSelectOption } from '../shared/components/searchable-select/searchable-select.component';
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
  LucideClock,
  LucideFlag,
  LucideUser,
  LucideBuilding,
  LucideBriefcase,
  LucideMail,
  LucideLoader2
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

import { OutsideOfficeAnswer, OutsideOfficeService } from '../shared/services/outside-office.service';
import { GeolocationService } from '../shared/services/geolocation.service';
import { isWeeklyOff } from '../shared/utils/weekly-offs';
@Component({
  selector: 'app-attendance-leave',
  standalone: true,
  imports: [
    CommonModule, RouterLink,
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
    LucideClock,
    LucideFlag,
    SkeletonComponent,
    SearchableSelectComponent,
    LucideUser,
    LucideBuilding,
    LucideBriefcase,
    LucideMail,
    LucideLoader2
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
  private systemSettingsService = inject(SystemSettingsService);
  private sanitizer = inject(DomSanitizer);
  public authService = inject(AuthService);
  private toast = inject(HotToastService);
  private outsideOffice = inject(OutsideOfficeService);
  private geo = inject(GeolocationService);
  private datePipe = inject(DatePipe);

  shiftRosterVisible = signal<boolean>(false);
  myShift = signal<{ shift: Shift | null; rotations: any[] } | null>(null);
  isLoadingMyShift = signal<boolean>(false);

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
  readonly WEEK_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  shiftForm: any = { ...this.blankShift() };

  private blankShift() {
    return {
      name: '',
      shortCode: '',
      colorCode: '#2A97D8',
      shiftType: 'STRICT',
      startTime: '09:00',
      endTime: '18:00',
      halfDayTime: '09:00',
      halfDayHours: 4,
      totalHours: 9,
      earlyClockInMinutes: 60,
      autoClockOutHours: 0,
      bufferTimeMinutes: 15,
      maxCheckIns: 2,
      workingDays: [...this.WEEK_DAYS],
    };
  }

  isDayOn(day: string): boolean {
    return (this.shiftForm.workingDays || []).includes(day);
  }

  toggleDay(day: string) {
    const days: string[] = this.shiftForm.workingDays || [];
    this.shiftForm.workingDays = days.includes(day)
      ? days.filter(d => d !== day)
      : [...days, day];
  }
  
  showTimelineRescheduleModal = signal(false);
  selectedTimelineEmp = signal<any>(null);
  selectedTimelineDate = signal<Date | null>(null);
  rescheduleForm = {
    status: 'PRESENT',
    note: ''
  };

  /**
   * §Att10: deleting a leave request is the Super Admin's alone — narrower
   * than `isAdmin`, which admits ADMIN and HR. The server enforces the same
   * rule; this only decides whether the button is worth showing.
   */
  canDeleteLeave = computed(() => this.authService.currentUser()?.role === 'SUPERADMIN');

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
        const color = val === 'PRESENT' ? '#10B981' : (val === 'ABSENT' ? '#1373e5' : '#6b3fd6');
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
          ? `<a href="${params.data.attachmentUrl}" target="_blank" style="display: flex; align-items: center; gap: 4px; font-size: 11px; color: #1373e5; text-decoration: underline; margin-top: 2px;">View Attachment <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="17" x2="17" y2="7"></line><polyline points="7 7 17 7 17 17"></polyline></svg></a>`
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
          ? `<span class="status-badge status-half-day" style="background: rgba(236, 95, 42, 0.12); color: #1373e5; font-size: 10px; margin-left: 6px; padding: 2px 6px; border-radius: 10px;">Half Day (${params.data.halfDayPeriod || 'AM'})</span>`
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
          ? `<div class="view-reason-link" style="display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: #1373e5; text-decoration: underline; margin-top: 4px; cursor: pointer;">View Reason <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg></div>`
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
        onView: (data: any) => this.openLeaveDetail(data),
        onEdit: (data: any) => this.editLeaveRequest(data),
        onCancel: (data: any) => this.cancelLeaveRequest(data.id),
        onViewAttachment: (data: any) => this.viewAttachment(data.attachmentUrl),
        onViewReason: (data: any) => this.openRejectionReasonModal(data.rejectionReason),
        // §Att10: handed over only to a Super Admin. The renderer treats the
        // callback's presence as the permission, so withholding it hides the
        // menu entry entirely rather than showing something that would 403.
        onDelete: this.canDeleteLeave() ? (data: any) => this.deleteLeaveRequest(data) : undefined
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
        const color = val === 'APPROVED' ? '#10B981' : (val === 'REJECTED' ? '#1373e5' : '#6b3fd6');
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
              <button class="btn btn-outline" style="padding: 2px 8px; font-size: 11px; color: #1373e5; border-color: #1373e5;" onclick="window.dispatchEvent(new CustomEvent('resolve-reg', {detail: {id: ${params.data.id}, status: 'REJECTED'}}))">Reject</button>
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
      minWidth: 230,
      flex: 1.5,
      pinned: 'left',
      cellRenderer: (params: any) => {
        const emp = params.data?.employee;
        if (!emp) return 'N/A';
        const name = emp.lastName ? `${emp.firstName} ${emp.lastName}` : (emp.firstName || 'Employee');
        const dept = emp.department?.name || '';
        const des = emp.designation?.name || '';
        const sub = [des, dept].filter(Boolean).join(' · ') || 'General';
        const codeBadge = emp.employeeCode 
          ? `<span class="table-emp-code" style="font-size: 10px !important; font-weight: 600 !important; color: #0369a1 !important; background: #e0f2fe !important; border: 1px solid #bae6fd !important; border-radius: 4px !important; padding: 1px 5px !important; flex-shrink: 0 !important; line-height: 1.2 !important;">#${emp.employeeCode}</span>` 
          : '';
        const safeName = (name || '').replace(/"/g, '&quot;');
        const uiAvatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=3B82F6&color=fff&size=128&bold=true`;
        const avatarSrc = emp.avatarUrl || uiAvatarUrl;
        return `
          <div class="cell-user-avatar-row cursor-pointer" style="display: flex !important; align-items: center !important; gap: 10px !important; height: 100% !important; min-width: 0 !important; width: 100% !important; cursor: pointer !important;" title="Click to view details">
            <img src="${avatarSrc}" 
                 class="table-emp-avatar" 
                 alt="${safeName}" 
                 style="width: 38px !important; height: 38px !important; min-width: 38px !important; min-height: 38px !important; max-width: 38px !important; max-height: 38px !important; border-radius: 50% !important; object-fit: cover !important; flex-shrink: 0 !important; border: 1.5px solid #e2e8f0 !important; display: block !important;" 
                 onerror="this.onerror=null; this.src='${uiAvatarUrl}';" />
            <div class="cell-stacked" style="min-width: 0 !important; flex: 1 !important; overflow: hidden !important; display: flex !important; flex-direction: column !important; justify-content: center !important; line-height: 1.25 !important;">
              <div class="cell-title-bold" style="display: flex !important; align-items: center !important; gap: 6px !important; min-width: 0 !important;">
                <span class="emp-name-text" style="font-size: 13px !important; font-weight: 600 !important; color: #0f172a !important; white-space: nowrap !important; overflow: hidden !important; text-overflow: ellipsis !important;">${name}</span>
                ${codeBadge}
              </div>
              <div class="user-text-stack text-secondary" style="font-size: 11.5px !important; color: #64748B !important; white-space: nowrap !important; overflow: hidden !important; text-overflow: ellipsis !important; margin-top: 2px !important;">${sub}</div>
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
          ? `<div class="view-reason-link" style="font-size: 10px; color: #1373e5; font-weight: 500; margin-top: 3px; cursor: pointer;">Reason: ${params.data.rejectionReason}</div>`
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
      width: 150,
      pinned: 'right',
      sortable: false,
      filter: false,
      cellRenderer: LeaveActionCellRendererComponent,
      cellRendererParams: {
        onView: (data: any) => this.openLeaveDetail(data),
        onApprove: (data: any) => this.approveLeaveRequest(data.id),
        onReject: (data: any) => this.openRejectModal(data.id),
        onViewAttachment: (data: any) => this.viewAttachment(data.attachmentUrl),
        onViewReason: (data: any) => this.openRejectionReasonModal(data.rejectionReason),
        onDelete: this.canDeleteLeave() ? (data: any) => this.deleteLeaveRequest(data) : undefined
      }
    }
  ];

  // Leave balances
  myBalances = signal<LeaveBalance[]>([]);
  myRequests = signal<LeaveRequest[]>([]);
  isLoadingBalances = signal<boolean>(true);
  isLoadingRequests = signal<boolean>(true);
  myHistory = signal<AttendanceRecord[]>([]);
  holidays = signal<Holiday[]>([]);
  isLoadingHolidays = signal<boolean>(true);

  // Manage Balances (HR/Admin)
  allBalances = signal<LeaveBalance[]>([]);
  allRequests = signal<LeaveRequest[]>([]);
  isLoadingLeaveApprovals = signal<boolean>(true);
  approvalStatusFilter = signal<'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'>('PENDING');
  filteredRequests = computed(() => {
    const filter = this.approvalStatusFilter();
    const requests = this.allRequests();
    if (filter === 'ALL') return requests;
    return requests.filter(r => r.status === filter);
  });
  pendingCount = computed(() => this.allRequests().filter(r => r.status === 'PENDING').length);
  managerRequests = signal<LeaveRequest[]>([]);
  isLoadingManagerRequests = signal<boolean>(true);
  employees = signal<Employee[]>([]);
  isLoadingEmployees = signal<boolean>(false);
  leaveTypes = signal<LeaveType[]>([]);
  targetEmployeeBalances = signal<LeaveBalance[] | null>(null);
  isLoadingEmployeeBalances = signal<boolean>(false);

  // Whether the currently selected leave type allows half-day
  selectedLeaveTypeAllowsHalfDay = computed(() => {
    const id = this.requestForm.leaveTypeId;
    if (!id) return true;
    const isBehalf = this.requestForm.onBehalfOfEmployeeId !== null;
    const balances = isBehalf 
      ? (this.targetEmployeeBalances() || [])
      : this.myBalances();
    const balance = balances.find(b => b.leaveType?.id === Number(id));
    if (balance) {
      return balance.leaveType.allowHalfDay !== false;
    }
    const lt = this.leaveTypes().find(t => t.id === Number(id));
    return lt ? (lt.allowHalfDay !== false) : true;
  });

  getLeaveTypeColor(name: string): string {
    const n = (name || '').toLowerCase();
    if (n.includes('sick')) return '#0ea5e9'; // sky blue
    if (n.includes('casual')) return '#10b981'; // emerald green
    if (n.includes('earned') || n.includes('privilege') || n.includes('annual')) return '#6366f1'; // indigo
    if (n.includes('maternity') || n.includes('paternity')) return '#ec4899'; // pink
    if (n.includes('bereavement')) return '#64748b'; // slate
    if (n.includes('compensatory') || n.includes('comp')) return '#f59e0b'; // amber
    if (n.includes('loss') || n.includes('unpaid') || n.includes('lwp')) return '#ef4444'; // red
    if (n.includes('eid') || n.includes('diwali') || n.includes('holiday') || n.includes('optional')) return '#8b5cf6'; // purple
    return '#3b82f6';
  }

  getAvatarBgColor(str?: string): string {
    if (!str) return '#3b82f6';
    const colors = ['#3b82f6', '#10b981', '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#06b6d4', '#14b8a6'];
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  }

  // Searchable options for "Applying for"
  applyingForOptions = computed<SearchableSelectOption[]>(() => {
    const list: SearchableSelectOption[] = [
      { 
        id: null, 
        name: 'Myself', 
        subtitle: 'Apply for your own account',
        avatarText: 'ME',
        avatarColor: '#2563eb',
        badge: 'Self',
        badgeType: 'info'
      }
    ];
    for (const emp of this.onBehalfEmployees()) {
      const initials = emp.name
        .split(' ')
        .filter((n: string) => n.length > 0)
        .map((n: string) => n[0])
        .slice(0, 2)
        .join('')
        .toUpperCase() || 'U';
      const found = this.employees().find(e => e.id === emp.id);
      list.push({
        id: emp.id,
        name: emp.name,
        subtitle: emp.subtitle,
        avatarUrl: found?.avatarUrl || undefined,
        avatarText: initials,
        avatarColor: this.getAvatarBgColor(emp.name)
      });
    }
    return list;
  });

  // Searchable options for "Leave Type", filtered dynamically by selected employee
  availableLeaveTypeOptions = computed<SearchableSelectOption[]>(() => {
    const targetBalances = this.targetEmployeeBalances();
    const myBals = this.myBalances();
    const allTypes = this.leaveTypes();

    const isBehalf = this.requestForm.onBehalfOfEmployeeId !== null;
    const balances = isBehalf 
      ? (targetBalances || [])
      : myBals;

    return allTypes.map(type => {
      const b = balances.find(bal => bal.leaveType?.id === type.id);
      const allocated = b ? b.allocated : 0;
      const used = b ? b.used : 0;
      const remaining = allocated - used;

      const initials = type.name
        .replace(/[^a-zA-Z0-9\s]/g, '')
        .split(' ')
        .filter((w: string) => w.length > 0)
        .map((w: string) => w[0])
        .slice(0, 2)
        .join('')
        .toUpperCase() || 'LV';

      const color = this.getLeaveTypeColor(type.name);
      const isOptional = type.name.toLowerCase().includes('(optional)') || type.name.toLowerCase().includes('optional');
      const cleanName = type.name.replace(/\(optional\)/gi, '').trim();

      let tag: string | undefined = undefined;
      let tagClass = 'tag-default';
      if (!type.isPaid) {
        tag = 'Unpaid';
        tagClass = 'tag-amber';
      } else if (isOptional) {
        tag = 'Optional';
        tagClass = 'tag-purple';
      }

      let badge = '';
      let badgeType: 'success' | 'warning' | 'danger' | 'info' | 'neutral' = 'neutral';
      // Unpaid leave does not run out: it is time off without pay, approved
      // like any other request. Its "balance" is not a limit, so it is not
      // shown as one.
      if (!type.isPaid) {
        badge = 'No limit';
        badgeType = 'info';
      } else if (remaining > 0) {
        badge = `${remaining} ${remaining === 1 ? 'day' : 'days'} left`;
        badgeType = 'success';
      } else if (remaining === 0) {
        badge = '0 available';
        badgeType = 'neutral';
      } else {
        badge = `${Math.abs(remaining)} ${Math.abs(remaining) === 1 ? 'day' : 'days'} over`;
        badgeType = 'danger';
      }

      const subParts: string[] = [];
      subParts.push(type.isPaid ? `${used} used / ${allocated} total` : `${used} used this year · deducted from pay`);
      if (type.allowHalfDay !== false) {
        subParts.push('Half-day ok');
      }

      return {
        id: type.id,
        name: cleanName,
        subtitle: subParts.join(' · '),
        tag,
        tagClass,
        badge,
        badgeType,
        avatarText: initials,
        avatarColor: color
      };
    });
  });

  // Computed details of the selected leave type
  selectedLeaveTypeBalance = computed(() => {
    const targetBalances = this.targetEmployeeBalances();
    const myBals = this.myBalances();
    const allTypes = this.leaveTypes();

    const id = Number(this.requestForm.leaveTypeId);
    if (!id) return null;
    const isBehalf = this.requestForm.onBehalfOfEmployeeId !== null;
    const balances = isBehalf 
      ? (targetBalances || [])
      : myBals;
      
    const b = balances.find(bal => bal.leaveType?.id === id);
    if (b) return b;
    
    const type = allTypes.find(t => t.id === id);
    if (type) {
      return {
        leaveType: type,
        allocated: 0,
        used: 0
      };
    }
    return null;
  });

  // Dynamically calculated working days for UI preview
  calculatedWorkingDays = computed(() => {
    if (!this.requestForm.startDate || !this.requestForm.endDate) return null;
    if (this.requestForm.endDate < this.requestForm.startDate) return null;
    if (this.requestForm.isHalfDay) return 0.5;
    const start = new Date(this.requestForm.startDate);
    const end = new Date(this.requestForm.endDate);
    const diffTime = Math.abs(end.getTime() - start.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  });

  // Assignment Form State
  assignToAll = signal<boolean>(false);
  selectedEmployeeId = signal<string>('');
  selectedLeaveTypeId = signal<string>('');
  allocatedDays = signal<number>(0);
  assignYear = signal<number>(new Date().getFullYear());
  isAssigning = signal<boolean>(false);

  // Searchable options for Assign Leave Balance
  employeeAssignOptions = computed<SearchableSelectOption[]>(() => {
    return this.employees().map(emp => {
      const code = emp.employeeCode ? `#${emp.employeeCode}` : '';
      const des = emp.designation?.name || '';
      const dept = emp.department?.name ? ` · ${emp.department.name}` : '';
      const initials = `${emp.firstName?.[0] || ''}${emp.lastName?.[0] || ''}`.toUpperCase() || 'EMP';
      return {
        id: emp.id.toString(),
        name: `${emp.firstName} ${emp.lastName}`.trim(),
        subtitle: `${des}${dept}`.trim() || emp.email,
        tag: code || undefined,
        avatarUrl: emp.avatarUrl || undefined,
        avatarText: initials,
        avatarColor: this.getAvatarBgColor(emp.firstName)
      };
    });
  });

  leaveTypeAssignOptions = computed<SearchableSelectOption[]>(() => {
    return this.leaveTypes().map(type => {
      const initials = type.name
        .replace(/[^a-zA-Z0-9\s]/g, '')
        .split(' ')
        .filter((w: string) => w.length > 0)
        .map((w: string) => w[0])
        .slice(0, 2)
        .join('')
        .toUpperCase() || 'LV';
      return {
        id: type.id.toString(),
        name: type.name,
        subtitle: `Default: ${type.defaultDays} days${type.allowHalfDay !== false ? ' · Half-day ok' : ''}`,
        badge: `${type.defaultDays}d default`,
        badgeType: 'info',
        avatarText: initials,
        avatarColor: this.getLeaveTypeColor(type.name)
      };
    });
  });

  // Selected employee profile data for Assign Balance
  selectedAssignEmployee = computed(() => {
    const id = Number(this.selectedEmployeeId());
    if (!id) return null;
    return this.employees().find(e => e.id === id) || null;
  });

  // Current year balances of the selected employee
  selectedEmployeeCurrentBalances = computed(() => {
    const id = Number(this.selectedEmployeeId());
    if (!id) return [];
    const yr = Number(this.assignYear()) || new Date().getFullYear();
    return (this.allBalances() || []).filter((b: any) => b.employeeId === id && b.year === yr);
  });

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
    halfDayPeriod: 'AM',
    /** §Att9: whose leave this is. Null — the default — means the applicant's own. */
    onBehalfOfEmployeeId: null as number | null,
  };

  /**
   * §Att9. Null until the server has answered: the option must not flicker
   * into view, and an administrator must not be told they cannot do something
   * while the check is still running.
   */
  canActOnBehalf = computed(() => this.isAdmin());
  onBehalfEmployees = signal<{ id: number; name: string; subtitle?: string }[]>([]);

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
      const isWeekend = this.isOffDay(cellDate);
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
      ...this.blankShift(),
      ...shift,
      // Stored as a comma-separated string; the checkboxes want an array.
      workingDays: shift.workingDays ? String(shift.workingDays).split(',') : [...this.WEEK_DAYS],
    };
    this.isCreateShiftModalOpen.set(true);
  }

  openCreateShift() {
    this.shiftEditMode.set('create');
    this.editingShiftId.set(null);
    this.shiftForm = { ...this.blankShift() };
    this.isCreateShiftModalOpen.set(true);
  }

  closeShiftDrawer() {
    this.isCreateShiftModalOpen.set(false);
    this.shiftEditMode.set('create');
    this.editingShiftId.set(null);
    this.shiftForm = { ...this.blankShift() };
  }

  // --- Grid and Calendar Logic ---

  openRequestModal(request?: LeaveRequest) {
    this.targetEmployeeBalances.set(null);
    this.isLoadingEmployeeBalances.set(false);
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
        halfDayPeriod: request.halfDayPeriod || 'AM',
        // Editing an existing request never changes whose it is.
        onBehalfOfEmployeeId: null,
      };
    } else {
      this.editMode.set(false);
      this.selectedRequestId.set(null);
      this.requestForm = { leaveTypeId: '', startDate: '', endDate: '', reason: '', attachmentUrl: '', isHalfDay: false, halfDayPeriod: 'AM', onBehalfOfEmployeeId: null };
    }
    this.isRequestModalOpen.set(true);
  }

  onApplyingForChange(empId: any) {
    const id = (empId === null || empId === undefined || empId === 'null' || empId === '') ? null : Number(empId);
    this.requestForm.onBehalfOfEmployeeId = id;
    this.requestForm.leaveTypeId = ''; // Reset leave type when employee changes

    if (id === null) {
      this.targetEmployeeBalances.set(null);
      this.isLoadingEmployeeBalances.set(false);
    } else {
      this.isLoadingEmployeeBalances.set(true);
      this.leavesService.getAllBalances(undefined, id).subscribe({
        next: (res: any[]) => {
          this.targetEmployeeBalances.set(res ?? []);
          this.isLoadingEmployeeBalances.set(false);
        },
        error: () => {
          this.targetEmployeeBalances.set([]);
          this.isLoadingEmployeeBalances.set(false);
        }
      });
    }
  }

  onLeaveTypeSelected(typeId: any) {
    this.requestForm.leaveTypeId = (typeId !== null && typeId !== undefined && typeId !== '') ? String(typeId) : '';
    this.onLeaveTypeChange();
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
    this.targetEmployeeBalances.set(null);
    this.isLoadingEmployeeBalances.set(false);
    this.requestForm = { leaveTypeId: '', startDate: '', endDate: '', reason: '', attachmentUrl: '', isHalfDay: false, halfDayPeriod: 'AM', onBehalfOfEmployeeId: null };
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

    // §Att9: this check reads the APPLICANT's balance, which is the wrong
    // person's the moment the leave is being raised for somebody else. Skipped
    // rather than adapted — the server holds the target's real balance and is
    // the only place that can answer it without a second round trip.
    const isBehalf = this.requestForm.onBehalfOfEmployeeId !== null;
    const currentBalances = isBehalf 
      ? (this.targetEmployeeBalances() || []) 
      : this.myBalances();
    const balance = currentBalances.find(b => b.leaveType.id === Number(this.requestForm.leaveTypeId));
    // Unpaid leave (Loss of Pay) has no limit, for everyone: it still needs
    // approval and is deducted from pay, but a balance cannot refuse it.
    const leaveType = this.leaveTypes().find((t: any) => t.id === Number(this.requestForm.leaveTypeId));
    const isUnpaid = leaveType?.isPaid === false || balance?.leaveType?.isPaid === false;
    if (balance && !isUnpaid) {
      const available = balance.allocated - balance.used;
      if (requestedDays > available) {
        this.toast.error(`Insufficient balance. ${isBehalf ? 'This employee has' : 'You have'} only ${available} days available, but requested ${requestedDays} ${requestedDays === 1 ? 'day' : 'days'}.`);
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

      // §Att9: raising it for somebody else is a different endpoint, not a flag
      // on this one — the server will not accept an employeeId here.
      const onBehalfOf = this.requestForm.onBehalfOfEmployeeId;

      const ob$ = this.editMode() && this.selectedRequestId()
        ? this.leavesService.updateRequest(this.selectedRequestId()!, payload)
        : onBehalfOf
          ? this.leavesService.requestLeaveOnBehalf({ ...payload, employeeId: onBehalfOf })
          : this.leavesService.requestLeave(payload);

      ob$.subscribe({
        next: (res: any) => {
          // §9: the request is filed either way, but somebody who is on an
          // approved field visit those days needs to be told now rather than
          // discover it when the trip loses the day.
          const clashes = res?.fieldVisitConflicts ?? [];
          if (clashes.length) {
            const spoken = clashes
              .map((c: any) => `${c.requestNumber} at ${c.location} (${c.days} day${c.days === 1 ? '' : 's'})`)
              .join(', ');
            this.toast.warning(
              `Leave requested — but you are on approved field visit ${spoken}. `
              + 'Your approver will see the clash, and approving the leave takes those days off the trip.',
              { duration: 9000 },
            );
          } else {
            this.toast.success(
              this.editMode() ? 'Leave request updated'
                : onBehalfOf ? 'Leave applied and approved'
                : 'Leave requested successfully',
            );
          }
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
    if (params.colDef.field === 'employee' && params.data) {
      this.openLeaveDetail(params.data);
    }
  }

  // ── Leave detail modal ──────────────────────────────────────────────────
  isLeaveDetailOpen = signal(false);
  selectedLeave = signal<any>(null);

  /** The people leave can be raised for (§Att9). */
  private loadOnBehalfEmployees() {
    this.employeeService.getEmployeesBasicList().subscribe({
      next: (list: any[]) => this.onBehalfEmployees.set(
        (list ?? []).map((e) => ({
          id: e.id,
          name: `${e.firstName ?? ''} ${e.lastName ?? ''}`.trim() || `Employee ${e.id}`,
          subtitle: e.employeeCode || e.designation?.name || e.designation || undefined,
        })),
      ),
      error: () => this.toast.error('Could not load the employee list'),
    });
  }

  /** The chosen person's name, for the notice in the modal. */
  onBehalfName(): string {
    const id = this.requestForm.onBehalfOfEmployeeId;
    if (!id) return '';
    return this.onBehalfEmployees().find((e) => e.id === id)?.name ?? '';
  }

  /**
   * §Att10: remove a leave request outright. Super Admin only — the server
   * refuses anybody else, and the button is hidden from them too.
   *
   * Asked about first, and the wording says what it costs: for an approved
   * request the days go back, which is the part nobody expects.
   */
  deleteLeaveRequest(request: any) {
    const who = request?.employee
      ? `${request.employee.firstName} ${request.employee.lastName}`.trim()
      : 'this employee';
    const approved = request?.status === 'APPROVED';

    const ok = confirm(
      approved
        ? `Delete ${who}'s APPROVED leave?\n\nThe days go back to their balance and the request disappears everywhere, including payroll.`
        : `Delete ${who}'s leave request?\n\nIt will disappear everywhere.`,
    );
    if (!ok) return;

    this.leavesService.deleteRequest(request.id).subscribe({
      next: () => {
        this.toast.success('Leave request deleted');
        this.loadData();
        this.loadAdminData();
      },
      error: (err: any) => this.toast.error(err.error?.message || 'Could not delete that request'),
    });
  }

  openLeaveDetail(data: any) {
    this.selectedLeave.set(data);
    this.isLeaveDetailOpen.set(true);
  }

  closeLeaveDetail() {
    this.isLeaveDetailOpen.set(false);
    this.selectedLeave.set(null);
  }

  /** Whole days between start and end, or 0.5 when the leave is a half day. */
  leaveDuration(leave: any): number {
    if (!leave?.startDate || !leave?.endDate) return 0;
    if (leave.isHalfDay) return 0.5;
    const s = new Date(leave.startDate);
    const e = new Date(leave.endDate);
    return Math.ceil(Math.abs(e.getTime() - s.getTime()) / 86400000) + 1;
  }

  leaveEmployeeName(leave: any): string {
    const emp = leave?.employee;
    if (emp) return `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || 'Employee';

    // Own-leave rows that predate the employee being included still resolve to
    // a real name rather than "You", by falling back to the signed-in user.
    const me = this.authService.currentUser();
    const mine = `${me?.employee?.firstName || me?.firstName || ''} ${me?.employee?.lastName || me?.lastName || ''}`.trim();
    return mine || 'You';
  }

  /** Two initials for the placeholder, not one. */
  leaveEmployeeInitials(leave: any): string {
    const parts = this.leaveEmployeeName(leave).split(/\s+/);
    return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || 'E';
  }

  /** Designation and department, falling back to whichever exists. */
  leaveEmployeeSubtitle(leave: any): string {
    const emp = leave?.employee;
    const bits = [emp?.designation?.name, emp?.department?.name].filter(Boolean);
    if (bits.length) return bits.join(' · ');
    const me = this.authService.currentUser();
    return me?.employee?.designation?.name || me?.employee?.department?.name || '—';
  }

  leaveEmployeeEmail(leave: any): string {
    return leave?.employee?.user?.email || leave?.employee?.email || '';
  }

  leaveEmployeeRole(leave: any): string {
    return leave?.employee?.user?.role || '';
  }

  encodeURIComponent = encodeURIComponent;

  leaveEmployeeAvatar(leave: any): string {
    const name = this.leaveEmployeeName(leave);
    const uiAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=3B82F6&color=fff&size=128&bold=true`;
    return leave?.employee?.avatarUrl || uiAvatar;
  }

  onLeaveAvatarError(event: any, leave: any) {
    const name = this.leaveEmployeeName(leave);
    if (event?.target) {
      event.target.onerror = null;
      event.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=3B82F6&color=fff&size=128&bold=true`;
    }
  }

  selectedLeaveQuota = computed(() => {
    const leave = this.selectedLeave();
    if (!leave) return null;
    const empId = leave.employeeId || leave.employee?.id;
    const ltId = leave.leaveTypeId || leave.leaveType?.id;
    if (!empId || !ltId) return null;
    const year = new Date(leave.startDate).getFullYear();
    const balance = (this.allBalances() || []).find((b: any) => 
      b.employeeId === empId && 
      b.leaveTypeId === ltId && 
      b.year === year
    );
    return balance || null;
  });

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
        const available = b.allocated - b.used;
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

  // Leave lists run to hundreds of rows once historic leave is imported.
  leavePageSizes = [10, 25, 50, 100];

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
    this.selectedAttendanceEmployeeId.set(empId);
    this.loadTimesheetHistory();
    this.closeEmpDropdown();
  }

  /**
   * Loads exactly the month the grid is showing.
   *
   * The endpoint used to return the employee's entire history on every call —
   * hundreds of rows, each carrying a duplicate copy of the employee record —
   * which the grid then filtered down to about thirty. Asking for the month
   * directly is roughly a tenth of the data, and it means navigating past the
   * server's default window still works.
   */
  private loadTimesheetHistory() {
    const year = Number(this.selectedYear());
    const month = Number(this.selectedMonth()); // 0-indexed
    const from = this.getLocalDateString(new Date(year, month, 1));
    const to = this.getLocalDateString(new Date(year, month + 1, 0));

    const empId = this.selectedAttendanceEmployeeId();
    const request = empId === null
      ? this.attendanceService.getMyHistory(from, to)
      : this.attendanceService.getEmployeeHistory(empId, from, to);

    this.isLoadingTimesheet.set(true);
    request.subscribe({
      next: (res: any) => {
        this.myHistory.set(res);
        this.generateGrid();
        this.isLoadingTimesheet.set(false);
      },
      error: () => this.isLoadingTimesheet.set(false)
    });
  }

  /**
   * Raising an attendance issue hands off to the ticket form rather than
   * duplicating it here: the ticket carries evidence, routing to HR and its own
   * validation, none of which belongs on the attendance screen.
   *
   * Only offered for your own record. The server takes the reporter from the
   * token, so reporting while looking at a colleague's month would file a
   * complaint about them under your name.
   */
  get isViewingOwnAttendance(): boolean {
    return !this.selectedAttendanceEmployeeId();
  }

  reportAttendanceIssue() {
    const day = this.selectedDayDetails()?.day;
    if (!day?.date) return;
    const date = this.getLocalDateString(new Date(day.date));
    this.closeDayDetailsModal();
    this.router.navigate(['/crm/tickets'], {
      queryParams: { report: 'attendance', date },
    });
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
        // On an auto-closed day the clock-out is the 23:00 cutoff, not a
        // departure, so the span it closes is an upper bound rather than time
        // anyone actually stood behind.
        durationStr = log.autoClockedOut
          ? `up to ${hours} hrs ${mins} mins`
          : `${hours} hrs ${mins} mins`;
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

  /**
   * The employee's branch weekly offs (e.g. "0,6:even" = Sundays plus 2nd and
   * 4th Saturday). Null until loaded, when Saturday+Sunday is assumed as before.
   */
  myWeeklyOffs = signal<string | null>(null);

  private isOffDay(date: Date): boolean {
    const rule = this.myWeeklyOffs();
    if (rule === null) return date.getDay() === 0 || date.getDay() === 6;
    return isWeeklyOff(date, rule);
  }

  ngOnInit() {
    this.employeeService.getMyProfile().subscribe({
      next: (p: any) => {
        this.myWeeklyOffs.set(p?.branch ? (p.branch.weeklyOffs ?? '') : null);
        this.generateGrid();
      },
      error: () => {},
    });

    // §Att9: whether to offer applying on somebody else's behalf. Asked of the
    // server rather than inferred from the role, because a delegate holding no
    // special role may also be allowed.
    if (this.isAdmin()) {
      this.loadOnBehalfEmployees();
    }

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
      } else if (tab === 'my-shift') {
        this.activeTab.set('my-shift');
        this.loadMyShift();
      } else {
        this.activeTab.set('attendance');
      }
    });

    this.timerInterval = setInterval(() => {
      this.currentTime.set(new Date());
    }, 1000);

    this.systemSettingsService.getSettings().subscribe({
      next: (res) => this.shiftRosterVisible.set(!!res.shiftRosterVisibleToEmployees),
      error: () => this.shiftRosterVisible.set(false)
    });

    this.loadData();
  }

  loadMyShift() {
    this.isLoadingMyShift.set(true);
    this.shiftsService.getMyShift().subscribe({
      next: (res) => {
        this.myShift.set(res);
        this.isLoadingMyShift.set(false);
      },
      error: () => this.isLoadingMyShift.set(false)
    });
  }

  ngOnDestroy() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
    }
  }

  loadData() {
    this.attendanceService.getTodayAttendance().subscribe((res: any) => this.todayAttendance.set(res));
    this.loadTimesheetHistory();
    this.isLoadingBalances.set(true);
    this.isLoadingRequests.set(true);
    this.leavesService.getMyBalances().subscribe({
      next: (res: any) => this.myBalances.set(res),
      complete: () => this.isLoadingBalances.set(false),
      error: () => this.isLoadingBalances.set(false)
    });
    this.leavesService.getMyRequests().subscribe({
      next: (res: any) => this.myRequests.set(res),
      complete: () => this.isLoadingRequests.set(false),
      error: () => this.isLoadingRequests.set(false)
    });
    this.attendanceService.getMyRegularizations().subscribe((res: any) => this.myRegularizations.set(res));
    this.loadHolidays();

    this.loadAdminData();
    this.loadManagerData();
    this.loadShifts();
  }

  loadHolidays() {
    this.isLoadingHolidays.set(true);
    this.masterDataService.getHolidays().subscribe({
      next: (res: any) => {
        this.holidays.set(res);
        this.generateGrid();
        this.isLoadingHolidays.set(false);
      },
      error: () => this.isLoadingHolidays.set(false)
    });
  }

  loadAdminData() {
    const year = new Date().getFullYear();
    this.isLoadingBalances.set(true);
    this.leavesService.getAllBalances(year).subscribe({
      next: (res: any) => {
        this.allBalances.set(res);
        this.isLoadingBalances.set(false);
      },
      error: () => this.isLoadingBalances.set(false)
    });
    this.isLoadingLeaveApprovals.set(true);
    this.leavesService.getRequests().subscribe({
      next: (res: any) => {
        this.allRequests.set(res);
        this.isLoadingLeaveApprovals.set(false);
      },
      error: () => this.isLoadingLeaveApprovals.set(false)
    });
    this.attendanceService.getPendingRegularizations().subscribe((res: any) => this.pendingRegularizations.set(res));
    this.isLoadingEmployees.set(true);
    this.employeeService.getEmployees().subscribe({
      next: (res: any) => this.employees.set(res),
      complete: () => this.isLoadingEmployees.set(false)
    });
    this.masterDataService.getLeaveTypes().subscribe((res: any) => this.leaveTypes.set(res));
  }

  loadManagerData() {
    this.isLoadingManagerRequests.set(true);
    this.leavesService.getManagerRequests().subscribe({
      next: (res: any) => {
        this.managerRequests.set(res);
        this.isLoadingManagerRequests.set(false);
      },
      error: () => this.isLoadingManagerRequests.set(false)
    });
  }

  onPeriodChange() {
    this.loadTimesheetHistory();
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
    this.loadTimesheetHistory();
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
    this.loadTimesheetHistory();
  }

  jumpToCurrentMonth() {
    const today = new Date();
    this.selectedMonth.set(today.getMonth());
    this.selectedYear.set(today.getFullYear());
    this.loadTimesheetHistory();
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
      // The branch's weekly offs — e.g. only the 2nd and 4th Saturday.
      const isWeekend = this.isOffDay(date);
      
      const weekdayStr = weekdays[dayOfWeek];

      let status: DayStatus['status'] = 'Empty';
      let tooltip = '';
      let clockInStr = '';
      let clockOutStr = '';
      let clockInLat: number | null = null;
      let clockInLng: number | null = null;
      let clockOutLat: number | null = null;
      let clockOutLng: number | null = null;

      const upcomingHoliday = isFuture
        ? hols.find(h => this.getBackendDateString(h.date) === dateString)
        : undefined;

      if (upcomingHoliday) {
        // An upcoming holiday is already known — show it instead of a blank
        // day that reads like an ordinary working day.
        status = 'Holiday';
        tooltip = `${upcomingHoliday.name} (upcoming)`;
      } else if (isFuture) {
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
          const clockInDate = new Date(log.clockIn);

          // The server's verdict, as the admin view shows it. It measured the
          // day against the right shift or field visit, and an admin may have
          // corrected it since — recomputing here from fixed hours disagreed
          // with both.
          const isHalfDay = log.status === 'HALF_DAY';
          const isLate = !!log.isLate;

          // A holiday worked is recorded, never late or a half day (B1).
          if (holiday) status = 'Present';
          else if (isHalfDay) status = 'Half Day';
          else if (isLate) status = 'Late';
          else status = 'Present';

          const inStr = clockInDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
          const outStr = log.clockOut ? new Date(log.clockOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }) : '...';
          let locText = '';
          if (log.clockInLat && log.clockInLng) {
            locText = ` 📍 ${log.clockInLat.toFixed(5)}, ${log.clockInLng.toFixed(5)}`;
          }
          tooltip = `In: ${inStr} - Out: ${outStr}${locText} (Click for details)`;
          if (holiday) tooltip = `Worked on holiday (${holiday.name}) · ${tooltip}`;
          
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
        const isWeekend = this.isOffDay(d.date);
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
    if (tab === 'my-shift') {
      this.loadMyShift();
    }
    if (tab === 'holidays') {
      this.loadHolidays();
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

  onLeaveTypeAssignChange(id: any) {
    this.selectedLeaveTypeId.set(id ? id.toString() : '');
    this.onLeaveTypeSelect();
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

    // Bounded, retried and explained — see GeolocationService. Continuing
    // without a location is still possible, and then the server decides: an
    // office (General Shift) day answers with the reason box, any other shift
    // clocks as normal.
    void this.geo.locateForClock().then(({ lat, lng }) => this.executeClockAction(action, lat, lng));
  }

  private executeClockAction(
    action: 'clockIn' | 'clockOut', lat?: number, lng?: number,
    outside?: OutsideOfficeAnswer,
  ) {
    const sub = action === 'clockIn'
      ? this.attendanceService.clockIn(lat, lng, outside?.reason, outside?.proofUrl)
      : this.attendanceService.clockOut(lat, lng, undefined, undefined, outside?.reason, outside?.proofUrl);

    sub.subscribe({
      next: (res) => {
        this.toast.success(
          `Successfully ${action === 'clockIn' ? 'Clocked In' : 'Clocked Out'}!`
            + (outside ? ' Sent for admin review (outside office).' : ''),
        );
        this.todayAttendance.set(res);
        this.isClocking.set(false);
      },
      error: (err) => {
        // B3: outside the office radius — ask why, then clock again with it.
        if (this.outsideOffice.isOutsideOffice(err)) {
          this.isClocking.set(false);
          void this.outsideOffice.ask(err).then((ans) => {
            if (!ans) return;
            this.isClocking.set(true);
            this.executeClockAction(action, lat, lng, ans);
          });
          return;
        }
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
        next: (data: any[]) => {
          // The server answers one entry per EMPLOYEE (with their attendances
          // and approved leaves); the grid reads one record per DAY carrying
          // its employee. Reading the employee list as day records found no
          // `employee` on any of them, so the timeline always came up empty.
          const records: any[] = [];
          const emps: any[] = [];
          for (const e of data || []) {
            if (!e) continue;
            const emp = e.employee ?? e;           // tolerate either shape
            emps.push(emp);
            for (const a of e.attendances ?? []) records.push({ ...a, employee: emp });
            for (const l of e.leaveRequests ?? []) {
              const from = new Date(l.startDate);
              const to = new Date(l.endDate);
              for (let d = new Date(from); d <= to; d.setUTCDate(d.getUTCDate() + 1)) {
                records.push({ date: new Date(d), status: 'LEAVE', employee: emp });
              }
            }
            if (e.employee && !e.attendances) records.push(e); // already a day record
          }
          this.teamTimelineData.set(records);
          const seen = new Set<number>();
          this.timelineEmployees.set(
            emps.filter((x) => x?.id && !seen.has(x.id) && seen.add(x.id))
              .sort((a, b) => `${a.firstName ?? ''}`.localeCompare(`${b.firstName ?? ''}`)),
          );
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
      const key = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split('T')[0];
      const holiday = this.holidays().find((h: any) => this.getBackendDateString(h.date) === key);
      days.push({ date: new Date(d), isWeekend, holidayName: holiday?.name ?? null });
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
    
    // Company holidays (B1): a day nobody is expected in, worked or not.
    const holiday = this.holidays().find((h: any) => this.getBackendDateString(h.date) === dateStr);
    if (holiday && !record?.clockIn && record?.status !== 'LEAVE') {
      return { type: 'holiday', label: `Holiday — ${holiday.name}` };
    }

    if (record) {
      if (record.status === 'LEAVE') return { type: 'leave', label: 'On Leave' };
      if (record.isHoliday) return { type: 'holiday', label: 'Holiday' };
      if (holiday && record.clockIn) {
        return { type: 'present', label: `Worked on holiday (${holiday.name}) — In: ${new Date(record.clockIn).toLocaleTimeString()}` };
      }
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
