import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
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
  LucideFileText,
  LucideUploadCloud,
  LucideFile,
  LucidePaperclip
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
    LucidePaperclip
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

  isAdmin = computed(() => {
    const role = this.authService.currentUser()?.role;
    return role === 'ADMIN' || role === 'HR' || role === 'SUPERADMIN';
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
    }
  ];

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

  shiftDefaultColDef: ColDef = {
    flex: 1,
    minWidth: 120,
    filter: true,
    sortable: true
  };

  shiftGridOptions = {
    rowSelection: { mode: 'multiRow' as const, enableClickSelection: false }
  };

  hrRequestsColDefs = [
    { 
      headerName: 'Employee', 
      valueGetter: (params: any) => `${params.data.employee?.firstName} ${params.data.employee?.lastName}`,
      flex: 1 
    },
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
      valueGetter: (params: any) => `${this.datePipe.transform(params.data.startDate, 'MMM d, yyyy')} - ${this.datePipe.transform(params.data.endDate, 'MMM d, yyyy')}`,
      flex: 1.5 
    },
    { 
      headerName: 'Status', 
      field: 'status',
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
      flex: 1.5,
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
  employees = signal<Employee[]>([]);
  leaveTypes = signal<LeaveType[]>([]);
  
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
    attachmentUrl: ''
  };

  // Reject Modal
  isRejectModalOpen = signal<boolean>(false);
  rejectReason = signal<string>('');
  rejectingRequestId = signal<number | null>(null);

  // Rejection Reason Modal
  isRejectionReasonModalOpen = signal<boolean>(false);
  currentRejectionReason = signal<string>('');

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
        attachmentUrl: request.attachmentUrl || ''
      };
    } else {
      this.editMode.set(false);
      this.selectedRequestId.set(null);
      this.requestForm = { leaveTypeId: '', startDate: '', endDate: '', reason: '', attachmentUrl: '' };
    }
    this.isRequestModalOpen.set(true);
  }

  closeRequestModal() {
    this.isRequestModalOpen.set(false);
    this.showFormErrors.set(false);
    this.editMode.set(false);
    this.selectedRequestId.set(null);
    this.selectedFile = null;
    this.requestForm = { leaveTypeId: '', startDate: '', endDate: '', reason: '', attachmentUrl: '' };
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

  submitLeaveRequest() {
    this.showFormErrors.set(true);
    
    if (!this.requestForm.leaveTypeId || !this.requestForm.startDate || !this.requestForm.endDate) {
      this.toast.error('Please fill in all required fields');
      return;
    }
    
    if (this.requestForm.endDate < this.requestForm.startDate) {
      this.toast.error('End Date cannot be before Start Date');
      return;
    }

    const start = new Date(this.requestForm.startDate);
    const end = new Date(this.requestForm.endDate);
    const diffTime = Math.abs(end.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

    const balance = this.myBalances().find(b => b.leaveType.id === Number(this.requestForm.leaveTypeId));
    if (balance) {
      const available = balance.allocated + balance.carriedOver - balance.used;
      if (diffDays > available) {
        this.toast.error(`Insufficient balance. You requested ${diffDays} days but only have ${available} days available.`);
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
        attachmentUrl: this.requestForm.attachmentUrl
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
    balances.forEach((b: any) => {
      if (b.leaveType && b.leaveType.name) {
        types.add(b.leaveType.name);
      }
    });

    Array.from(types).forEach(type => {
      cols.push({
        headerName: `${type} (Avail / Total)`,
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
    theme: 'legacy' as const,
    rowSelection: {
      mode: 'multiRow' as const,
      headerCheckbox: true,
      enableClickSelection: false
    }
  };

  // Grid / UI State
  viewMode = signal<'grid' | 'list'>('grid');
  months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  years = [2024, 2025, 2026, 2027, 2028]; // can dynamically generate
  selectedMonth = signal<number>(new Date().getMonth());
  selectedYear = signal<number>(new Date().getFullYear());

  monthlyGrid = signal<DayStatus[]>([]);
  totalPresent = signal<number>(0);
  totalWorkingDays = signal<number>(0);

  rowClassRules = {
    'row-approved': (params: any) => params.data && params.data.status === 'APPROVED',
    'row-rejected': (params: any) => params.data && params.data.status === 'REJECTED'
  };

  currentTime = signal<Date>(new Date());
  private timerInterval: any;

  ngOnInit() {
    this.route.paramMap.subscribe(params => {
      const tab = params.get('tab');
      if (tab === 'timesheets' || tab === 'attendance') {
        this.activeTab.set('attendance');
      } else if (tab === 'balances' || tab === 'approvals') {
        this.activeTab.set(tab as any);
        this.loadAdminData();
      } else if (tab) {
        this.activeTab.set(tab);
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
      this.generateGrid();
    });
    this.masterDataService.getHolidays().subscribe((res: any) => {
      this.holidays.set(res);
      this.generateGrid();
    });

    this.loadAdminData();
    this.loadShifts();
  }

  loadAdminData() {
    this.leavesService.getAllBalances().subscribe((res: any) => this.allBalances.set(res));
    this.leavesService.getRequests().subscribe((res: any) => this.allRequests.set(res));
    this.employeeService.getEmployees().subscribe((res: any) => this.employees.set(res));
    this.masterDataService.getLeaveTypes().subscribe((res: any) => this.leaveTypes.set(res));
  }

  onPeriodChange() {
    this.generateGrid();
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
      const dateString = date.toISOString().split('T')[0];
      const isFuture = date > today;
      const dayOfWeek = date.getDay();
      const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
      
      const weekdayStr = weekdays[dayOfWeek];

      let status: DayStatus['status'] = 'Empty';
      let tooltip = '';

      if (isFuture) {
        status = 'Empty';
      } else {
        // Find if holiday
        const holiday = hols.find(h => new Date(h.date).toISOString().split('T')[0] === dateString);
        
        // Find if on leave
        const leave = reqs.find(r => {
          const s = new Date(r.startDate).toISOString().split('T')[0];
          const e = new Date(r.endDate).toISOString().split('T')[0];
          return dateString >= s && dateString <= e;
        });

        // Find attendance
        const log = logs.find(l => new Date(l.date).toISOString().split('T')[0] === dateString);

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

          const inStr = clockInDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const outStr = log.clockOut ? new Date(log.clockOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '...';
          tooltip = `In: ${inStr} - Out: ${outStr}`;
          
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
        isFuture
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

    let csv = 'Date,Day,Status,Notes\n';
    for (const d of grid) {
      csv += `${d.date.toISOString().split('T')[0]},${d.weekdayStr},${d.status},"${d.tooltip || ''}"\n`;
    }

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `attendance_${this.months[this.selectedMonth()]}_${this.selectedYear()}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  setTab(tab: string) {
    this.activeTab.set(tab);
    if (tab === 'balances' || tab === 'approvals') {
      this.loadAdminData();
    }
    if (tab === 'shifts') {
      this.loadShifts();
    }
    this.router.navigate(['/attendance', tab]);
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
}
