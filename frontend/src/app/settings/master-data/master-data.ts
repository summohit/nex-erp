import { Component, inject, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MasterDataService, Department, Designation, Branch, LeaveType, Holiday } from '../../services/master-data.service';
import { ShiftsService } from '../../services/shifts.service';
import { HotToastService } from '@ngneat/hot-toast';
import { 
  LucidePlus, LucideX, LucideCalendar, LucideList, LucideChevronLeft, LucideChevronRight, 
  LucideClock, LucideSearch, LucideSliders, LucideUsers, LucideCheck, 
  LucideTag, LucideRotateCcw, LucideTimer, LucideMoon 
} from '@lucide/angular';
import { AgGridAngular } from 'ag-grid-angular';
import { ColDef, AllCommunityModule, ModuleRegistry, GridOptions, GridApi } from 'ag-grid-community';
import { ActionCellRendererComponent } from '../../shared/components/action-cell-renderer.component';
import { StatusToggleRendererComponent } from '../../shared/components/status-toggle-renderer.component';

ModuleRegistry.registerModules([AllCommunityModule]);

type Tab = 'departments' | 'designations' | 'branches' | 'leave-types' | 'holidays' | 'blackout-dates' | 'shifts';

export interface BlackoutDate {
  id: number;
  reason: string;
  date: string;
  departmentId?: number | null;
}

@Component({
  selector: 'app-master-data',
  standalone: true,
  imports: [
    CommonModule, FormsModule, LucidePlus, LucideX, LucideCalendar, LucideList, 
    LucideChevronLeft, LucideChevronRight, LucideClock, LucideSearch, LucideSliders, 
    LucideUsers, LucideCheck, LucideTag, LucideRotateCcw, 
    LucideTimer, LucideMoon, AgGridAngular
  ],
  templateUrl: './master-data.html',
  styleUrls: ['./master-data.css']
})
export class MasterDataComponent implements OnInit {
  private masterDataService = inject(MasterDataService);
  private shiftsService = inject(ShiftsService);
  private toast = inject(HotToastService);

  activeTab = signal<Tab>('departments');
  
  departments = signal<Department[]>([]);
  designations = signal<Designation[]>([]);
  branches = signal<Branch[]>([]);
  leaveTypes = signal<LeaveType[]>([]);
  holidays = signal<Holiday[]>([]);
  blackoutDates = signal<BlackoutDate[]>([]);
  shifts = signal<any[]>([]);
  shiftSearchText = signal('');

  // Assigned Employees Modal state
  isShiftEmployeesModalOpen = signal(false);
  selectedShiftForEmployees = signal<any | null>(null);
  shiftEmployeesList = signal<any[]>([]);
  shiftEmployeesLoading = signal(false);
  shiftEmployeesSearchText = signal('');

  filteredShiftEmployees = computed(() => {
    const text = this.shiftEmployeesSearchText().trim().toLowerCase();
    const list = this.shiftEmployeesList();
    if (!text) return list;
    return list.filter(emp => {
      const fullName = `${emp.firstName || ''} ${emp.lastName || ''}`.toLowerCase();
      const code = (emp.employeeCode || '').toLowerCase();
      const email = (emp.user?.email || '').toLowerCase();
      const dept = (emp.department?.name || '').toLowerCase();
      const desig = (emp.designation?.name || '').toLowerCase();
      return fullName.includes(text) || code.includes(text) || email.includes(text) || dept.includes(text) || desig.includes(text);
    });
  });

  filteredShifts = computed(() => {
    const q = this.shiftSearchText().toLowerCase().trim();
    const list = this.shifts();
    if (!q) return list;
    return list.filter(s => {
      const matchName = (s.name || '').toLowerCase().includes(q);
      const matchCode = (s.shortCode || '').toLowerCase().includes(q);
      const matchTiming = `${s.startTime || ''} ${s.endTime || ''}`.toLowerCase().includes(q);
      const matchType = (s.shiftType || '').toLowerCase().includes(q);
      return matchName || matchCode || matchTiming || matchType;
    });
  });

  shiftStats = computed(() => {
    const list = this.shifts();
    const total = list.length;
    const strict = list.filter(s => s.shiftType !== 'FLEXIBLE').length;
    const flexible = list.filter(s => s.shiftType === 'FLEXIBLE').length;
    const totalEmployees = list.reduce((acc, s) => acc + (s._count?.employees || 0), 0);
    return { total, strict, flexible, totalEmployees };
  });

  onShiftSearchChange(val: string) {
    this.shiftSearchText.set(val);
  }

  clearShiftSearch() {
    this.shiftSearchText.set('');
  }

  refreshShifts() {
    this.shiftsService.getShifts().subscribe({
      next: (data) => {
        this.shifts.set(data);
        this.toast.success('Shifts refreshed');
      },
      error: () => this.toast.error('Failed to refresh shifts')
    });
  }

  holidayView = signal<'table' | 'calendar'>('table');
  calendarDate = signal(new Date());

  calendarDays = computed(() => {
    const date = this.calendarDate();
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    
    const days: any[] = [];
    // Pad previous month
    for (let i = 0; i < firstDay.getDay(); i++) {
      days.push({ empty: true });
    }
    // Current month days
    const allHolidays = this.holidays();
    for (let i = 1; i <= lastDay.getDate(); i++) {
      const isHoliday = allHolidays.find(h => {
        const hd = new Date(h.date);
        return hd.getFullYear() === year && hd.getMonth() === month && hd.getDate() === i;
      });
      days.push({
        dayNumber: i,
        holiday: isHoliday
      });
    }
    return days;
  });

  prevMonth() {
    const d = new Date(this.calendarDate());
    d.setMonth(d.getMonth() - 1);
    this.calendarDate.set(d);
  }

  nextMonth() {
    const d = new Date(this.calendarDate());
    d.setMonth(d.getMonth() + 1);
    this.calendarDate.set(d);
  }

  currentMonthName = computed(() => {
    return this.calendarDate().toLocaleString('default', { month: 'long', year: 'numeric' });
  });

  seedDefaultHolidays() {
    const year = new Date().getFullYear();
    const defaults = [
      { name: 'Republic Day', date: `${year}-01-26` },
      { name: 'Maha Shivratri', date: `${year}-02-14` },
      { name: 'Holi', date: `${year}-03-03` },
      { name: 'Good Friday', date: `${year}-04-03` },
      { name: 'Eid-ul-Fitr', date: `${year}-04-18` },
      { name: 'Buddha Purnima', date: `${year}-05-01` },
      { name: 'Independence Day', date: `${year}-08-15` },
      { name: 'Raksha Bandhan', date: `${year}-08-28` },
      { name: 'Gandhi Jayanti', date: `${year}-10-02` },
      { name: 'Dussehra', date: `${year}-10-20` },
      { name: 'Diwali', date: `${year}-11-08` },
      { name: 'Christmas Day', date: `${year}-12-25` }
    ];
    if (!confirm('This will insert standard Indian holidays for the current year. Continue?')) return;
    this.isSaving.set(true);
    this.masterDataService.seedHolidays({ holidays: defaults }).subscribe({
      next: (res) => {
        this.toast.success(`Seeded ${res.count} default holidays!`);
        this.loadData();
        this.isSaving.set(false);
      },
      error: () => {
        this.toast.error('Failed to seed holidays');
        this.isSaving.set(false);
      }
    });
  }

  defaultColDef: ColDef = {
    flex: 1,
    minWidth: 150,
    filter: true,
    sortable: true
  };

  gridOptions = {
    rowSelection: {
      mode: 'multiRow' as const,
      checkboxes: true,
      headerCheckbox: true,
      enableClickSelection: false
    }
  };

  // --- Shifts Grid Configuration ---
  shiftGridApi?: GridApi;

  shiftDefaultColDef: ColDef = {
    flex: 1,
    minWidth: 120,
    sortable: true,
    filter: true,
    resizable: true
  };

  shiftGridOptions: GridOptions = {
    rowHeight: 70,
    headerHeight: 46,
    enableCellTextSelection: true,
    animateRows: true
  };

  onShiftGridReady(params: any) {
    this.shiftGridApi = params.api;
  }

  shiftColDefs: ColDef[] = [
    {
      field: 'name',
      headerName: 'Shift Name',
      flex: 1.8,
      minWidth: 220,
      cellRenderer: (p: any) => {
        const data = p.data || {};
        const color = data.colorCode || '#2A97D8';
        const name = data.name || 'Unnamed Shift';
        const shortCode = data.shortCode || (name.length >= 2 ? name.substring(0, 2).toUpperCase() : 'SH');
        const desc = data.description || (data.shiftType === 'FLEXIBLE' ? 'Output based schedule' : 'Fixed work timing');

        return `
          <div class="shift-name-cell">
            <div class="shift-color-dot-wrapper">
              <span class="shift-color-dot" style="background-color: ${color}; box-shadow: 0 0 0 3px ${color}25;"></span>
            </div>
            <div class="shift-name-meta">
              <div class="shift-name-top">
                <span class="shift-name-title" title="${name}">${name}</span>
                <span class="shift-code-tag" style="background: ${color}12; color: ${color}; border-color: ${color}30;">${shortCode}</span>
              </div>
              <span class="shift-name-desc" title="${desc}">${desc}</span>
            </div>
          </div>
        `;
      }
    },
    {
      field: 'shiftType',
      headerName: 'Type',
      flex: 0.9,
      minWidth: 110,
      cellRenderer: (p: any) => {
        const isFlexible = p.value === 'FLEXIBLE';
        if (isFlexible) {
          return `
            <div class="shift-type-cell">
              <span class="shift-type-pill flexible">
                <span class="type-indicator-dot"></span>
                <span>Flexible</span>
              </span>
            </div>
          `;
        }
        return `
          <div class="shift-type-cell">
            <span class="shift-type-pill strict">
              <span class="type-indicator-dot"></span>
              <span>Strict</span>
            </span>
          </div>
        `;
      }
    },
    {
      headerName: 'Timings & Hours',
      flex: 1.7,
      minWidth: 195,
      cellRenderer: (p: any) => {
        const d = p.data || {};
        if (d.shiftType === 'FLEXIBLE') {
          return `
            <div class="shift-timing-cell">
              <div class="timing-top-row">
                <span class="timing-time-main"><b>${d.totalHours || 8}</b> hrs / day</span>
              </div>
              <span class="timing-sub-text">Flexible check-in</span>
            </div>
          `;
        }

        const start = d.startTime || '—';
        const end = d.endTime || '—';
        const duration = this.calculateShiftDuration(start, end);
        const isOvernight = this.isOvernightShift(start, end);
        const start12 = this.formatTime12h(start);
        const end12 = this.formatTime12h(end);

        return `
          <div class="shift-timing-cell">
            <div class="timing-top-row">
              <span class="timing-time-main">${start12} – ${end12}</span>
              ${isOvernight ? `<span class="overnight-tag" title="Overnight Shift (ends next day)">🌙 Night</span>` : ''}
            </div>
            <div class="timing-sub-row">
              <span class="timing-duration-badge">${duration}</span>
            </div>
          </div>
        `;
      }
    },
    {
      field: 'workingDays',
      headerName: 'Schedule',
      flex: 1.3,
      minWidth: 145,
      cellRenderer: (p: any) => {
        const schedule = this.formatScheduleDetails(p.value);
        return `
          <div class="shift-schedule-cell">
            <div class="schedule-top-row">
              <span class="schedule-main-badge ${schedule.badgeClass}">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                  <line x1="16" y1="2" x2="16" y2="6"></line>
                  <line x1="8" y1="2" x2="8" y2="6"></line>
                  <line x1="3" y1="10" x2="21" y2="10"></line>
                </svg>
                <span>${schedule.title}</span>
              </span>
            </div>
            <span class="schedule-sub-text">${schedule.subtitle}</span>
          </div>
        `;
      }
    },
    {
      headerName: 'Punch Policy',
      flex: 1.6,
      minWidth: 175,
      cellRenderer: (p: any) => {
        const d = p.data || {};
        if (d.shiftType === 'FLEXIBLE') {
          const maxPunches = d.maxCheckIns ?? 2;
          return `
            <div class="shift-policy-cell">
              <span class="policy-primary">Min <b>${d.halfDayHours ?? 4}h</b> half-day</span>
              <span class="policy-secondary">Max ${maxPunches} punch${maxPunches === 1 ? '' : 'es'} / day</span>
            </div>
          `;
        }
        const grace = d.bufferTimeMinutes ? `Grace: ${d.bufferTimeMinutes}m` : 'No grace';
        const early = d.earlyClockInMinutes ? `Early: ${d.earlyClockInMinutes}m` : 'Early: Std';
        const halfDayFormatted = d.halfDayTime ? this.formatTime12h(d.halfDayTime) : '—';
        return `
          <div class="shift-policy-cell">
            <div class="policy-rule-tags">
              <span class="policy-rule-pill">${grace}</span>
              <span class="policy-rule-pill">${early}</span>
            </div>
            <span class="policy-secondary">Half-day: ${halfDayFormatted}</span>
          </div>
        `;
      }
    },
    {
      field: '_count.employees',
      headerName: 'Assigned',
      flex: 1,
      minWidth: 115,
      cellRenderer: (p: any) => {
        const count = p.data?._count?.employees ?? 0;
        if (count > 0) {
          return `
            <div class="shift-assigned-cell">
              <button type="button" class="assigned-pill-btn active" title="Click to view ${count} assigned employee${count === 1 ? '' : 's'}">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                  <circle cx="9" cy="7" r="4"></circle>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                </svg>
                <span>${count} emp</span>
              </button>
            </div>
          `;
        }
        return `
          <div class="shift-assigned-cell">
            <span class="assigned-pill-btn empty" title="Click to view shift details">0 emp</span>
          </div>
        `;
      },
      onCellClicked: (p: any) => {
        if (p.data) {
          this.openShiftEmployeesModal(p.data);
        }
      }
    },
    {
      headerName: 'Actions',
      width: 80,
      flex: 0,
      sortable: false,
      filter: false,
      cellRenderer: ActionCellRendererComponent,
      cellRendererParams: {
        onEdit: (data: any) => this.openModal('edit', data),
        onDelete: (data: any) => this.deleteItem(data.id)
      }
    }
  ];

  deptColDefs: ColDef[] = [
    { 
      field: 'name', 
      headerName: 'Name', 
      minWidth: 200
    },
    {
      field: 'isActive',
      headerName: 'Status',
      width: 150,
      cellRenderer: StatusToggleRendererComponent,
      cellRendererParams: {
        onToggle: this.onDepartmentToggle.bind(this)
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
        onEdit: (data: any) => this.openModal('edit', data),
        onDelete: (data: any) => this.deleteItem(data.id)
      }
    }
  ];

  desigColDefs: ColDef[] = [
    { 
      field: 'name', 
      headerName: 'Name',
      minWidth: 200
    },
    { 
      field: 'department.name', 
      headerName: 'Department',
      valueFormatter: (params) => params.value || 'Unassigned'
    },
    {
      field: 'isActive',
      headerName: 'Status',
      width: 150,
      cellRenderer: StatusToggleRendererComponent,
      cellRendererParams: {
        onToggle: this.onDesignationToggle.bind(this)
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
        onEdit: (data: any) => this.openModal('edit', data),
        onDelete: (data: any) => this.deleteItem(data.id)
      }
    }
  ];

  branchColDefs: ColDef[] = [
    { field: 'name', headerName: 'Name' },
    { field: 'address', headerName: 'Address' },
    { field: 'startTime', headerName: 'Start Time' },
    { field: 'endTime', headerName: 'End Time' },
    { 
      field: 'weeklyOffs', 
      headerName: 'Weekly Offs', 
      valueFormatter: (params) => {
        if (!params.value) return 'None';
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        return params.value.split(',').map((v: string) => {
          const parts = v.trim().split(':');
          const dayName = days[parseInt(parts[0], 10)];
          const cond = parts[1];
          if (cond === 'even') return `${dayName} (Even)`;
          if (cond === 'odd') return `${dayName} (Odd)`;
          return dayName;
        }).join(', ');
      }
    },
    {
      field: 'isActive',
      headerName: 'Status',
      width: 150,
      cellRenderer: StatusToggleRendererComponent,
      cellRendererParams: {
        onToggle: this.onBranchToggle.bind(this)
      }
    },
    { 
      headerName: 'Actions', width: 120, flex: 0, sortable: false, filter: false,
      cellRenderer: ActionCellRendererComponent,
      cellRendererParams: {
        onEdit: (data: any) => this.openModal('edit', data),
        onDelete: (data: any) => this.deleteItem(data.id)
      }
    }
  ];

  leaveTypeColDefs: ColDef[] = [
    { field: 'name', headerName: 'Name' },
    { field: 'defaultDays', headerName: 'Default Days' },
    { 
      field: 'isPaid', 
      headerName: 'Paid', 
      cellRenderer: StatusToggleRendererComponent,
      cellRendererParams: {
        activeLabel: 'Yes', inactiveLabel: 'No',
        onToggle: (data: any, isActive: boolean) => this.onLeaveTypeToggle(data, 'isPaid', isActive)
      }
    },
    { 
      field: 'carryForward', 
      headerName: 'Carry Forward', 
      cellRenderer: StatusToggleRendererComponent,
      cellRendererParams: {
        activeLabel: 'Yes', inactiveLabel: 'No',
        onToggle: (data: any, isActive: boolean) => this.onLeaveTypeToggle(data, 'carryForward', isActive)
      }
    },
    { 
      field: 'allowHalfDay', 
      headerName: 'Allow Half Day', 
      cellRenderer: StatusToggleRendererComponent,
      cellRendererParams: {
        activeLabel: 'Yes', inactiveLabel: 'No',
        onToggle: (data: any, isActive: boolean) => this.onLeaveTypeToggle(data, 'allowHalfDay', isActive)
      }
    },
    { field: 'accrualFrequency', headerName: 'Accrual Frequency' },
    { field: 'accrualAmount', headerName: 'Accrual Amount' },
    { 
      headerName: 'Actions', width: 120, flex: 0, sortable: false, filter: false,
      cellRenderer: ActionCellRendererComponent,
      cellRendererParams: {
        onEdit: (data: any) => this.openModal('edit', data),
        onDelete: (data: any) => this.deleteItem(data.id)
      }
    }
  ];

  holidayColDefs: ColDef[] = [
    { field: 'name', headerName: 'Holiday Name' },
    { field: 'date', headerName: 'Date', valueFormatter: (p) => new Date(p.value).toLocaleDateString() },
    { 
      headerName: 'Actions', width: 120, flex: 0, sortable: false, filter: false,
      cellRenderer: ActionCellRendererComponent,
      cellRendererParams: {
        onEdit: (data: any) => this.openModal('edit', data),
        onDelete: (data: any) => this.deleteItem(data.id)
      }
    }
  ];

  blackoutColDefs: ColDef[] = [
    { field: 'reason', headerName: 'Reason' },
    { field: 'date', headerName: 'Date', valueFormatter: (p) => new Date(p.value).toLocaleDateString() },
    { field: 'departmentId', headerName: 'Department', valueFormatter: (p) => p.value ? (this.departments().find(d => d.id === p.value)?.name ?? 'Unknown') : 'All Departments' },
    { 
      headerName: 'Actions', width: 120, flex: 0, sortable: false, filter: false,
      cellRenderer: ActionCellRendererComponent,
      cellRendererParams: {
        onEdit: (data: any) => this.openModal('edit', data),
        onDelete: (data: any) => this.deleteItem(data.id)
      }
    }
  ];

  // Modal State
  isModalOpen = signal(false);
  modalMode = signal<'create' | 'edit'>('create');
  isSaving = signal(false);
  
  weeklyOffConditions: { [key: string]: 'all' | 'even' | 'odd' } = {};
  
  // Form Data
  formData: any = {
    id: 0,
    name: '',
    departmentId: 0,
    canEditProfiles: false,
    address: '', startTime: '09:00', endTime: '18:00', weeklyOffs: '0',
    geofenceRadius: 500, allowedIps: '',
    isActive: true,
    defaultDays: 0, isPaid: true, carryForward: false, carryForwardLimit: 0,
    accrualFrequency: 'NONE', accrualAmount: 0,
    allowHalfDay: true,
    date: ''
  };

  // Shift config. Workway distinguishes STRICT shifts (judged against a clock
  // window) from FLEXIBLE ones (judged only on hours worked).
  readonly WEEK_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  readonly SHIFT_COLORS = [
    '#2A97D8', // Primary Sky Blue
    '#4F46E5', // Indigo
    '#10B981', // Emerald Green
    '#F59E0B', // Amber
    '#EF4444', // Rose Red
    '#8B5CF6', // Violet
    '#EC4899', // Pink
    '#06B6D4', // Cyan
    '#64748B'  // Slate
  ];

  shiftDefaults() {
    return {
      shortCode: '',
      colorCode: '#2A97D8',
      shiftType: 'STRICT',
      halfDayTime: '13:30',
      halfDayHours: 4,
      totalHours: 9,
      earlyClockInMinutes: 30,
      autoClockOutHours: 0,
      bufferTimeMinutes: 15,
      maxCheckIns: 2,
      workingDays: [...this.WEEK_DAYS],
    };
  }

  isShiftDayOn(day: string): boolean {
    return (this.formData.workingDays || []).includes(day);
  }

  toggleShiftDay(day: string) {
    const days: string[] = this.formData.workingDays || [];
    this.formData.workingDays = days.includes(day)
      ? days.filter(d => d !== day)
      : [...days, day];
  }

  selectShiftColor(hex: string) {
    this.formData.colorCode = hex;
  }

  setShiftDaysPreset(preset: 'all' | 'mon-fri' | 'mon-sat') {
    if (preset === 'all') {
      this.formData.workingDays = [...this.WEEK_DAYS];
    } else if (preset === 'mon-fri') {
      this.formData.workingDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    } else if (preset === 'mon-sat') {
      this.formData.workingDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    }
  }

  calculateShiftDuration(start?: string, end?: string): string {
    if (!start || !end || !start.includes(':') || !end.includes(':')) return '—';
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) return '—';
    let totalMins = (eh * 60 + em) - (sh * 60 + sm);
    if (totalMins <= 0) {
      totalMins += 24 * 60; // Overnight
    }
    const hrs = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    return mins > 0 ? `${hrs}h ${mins}m` : `${hrs} hrs`;
  }

  isOvernightShift(start?: string, end?: string): boolean {
    if (!start || !end || !start.includes(':') || !end.includes(':')) return false;
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    return (eh * 60 + em) <= (sh * 60 + sm);
  }

  formatTime12h(timeStr?: string): string {
    if (!timeStr || !timeStr.includes(':')) return timeStr || '—';
    const parts = timeStr.split(':');
    let hours = parseInt(parts[0], 10);
    const minutes = parts[1] || '00';
    if (isNaN(hours)) return timeStr;
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    const formattedHour = hours < 10 ? `0${hours}` : `${hours}`;
    return `${formattedHour}:${minutes} ${ampm}`;
  }

  formatScheduleDetails(raw: any): { title: string; subtitle: string; badgeClass: string } {
    const days: string[] = Array.isArray(raw)
      ? raw
      : (typeof raw === 'string' && raw.length ? raw.split(',').map((s: string) => s.trim()) : ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']);

    if (days.length === 7) {
      return { title: 'All 7 Days', subtitle: 'Mon – Sun (Daily)', badgeClass: 'badge-all' };
    }
    const isMonFri = days.length === 5 && days.includes('Monday') && days.includes('Friday') && !days.includes('Saturday') && !days.includes('Sunday');
    if (isMonFri) {
      return { title: 'Mon – Fri', subtitle: '5 days / week (Weekdays)', badgeClass: 'badge-mon-fri' };
    }
    const isMonSat = days.length === 6 && !days.includes('Sunday');
    if (isMonSat) {
      return { title: 'Mon – Sat', subtitle: '6 days / week', badgeClass: 'badge-mon-sat' };
    }
    const dayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const sorted = [...days].sort((a, b) => dayOrder.indexOf(a) - dayOrder.indexOf(b));
    const shortNames = sorted.map((d: string) => d.slice(0, 3)).join(', ');
    return { title: shortNames || 'Custom', subtitle: `${days.length} days / week`, badgeClass: 'badge-custom' };
  }

  openShiftEmployeesModal(shift: any) {
    this.selectedShiftForEmployees.set(shift);
    this.isShiftEmployeesModalOpen.set(true);
    this.shiftEmployeesSearchText.set('');
    this.shiftEmployeesLoading.set(true);
    this.shiftEmployeesList.set([]);

    this.shiftsService.getShiftEmployees(shift.id).subscribe({
      next: (res) => {
        this.shiftEmployeesList.set(res.employees || []);
        this.shiftEmployeesLoading.set(false);
      },
      error: (err) => {
        console.error('Error fetching shift employees:', err);
        this.toast.error('Failed to load assigned employees');
        this.shiftEmployeesLoading.set(false);
      }
    });
  }

  closeShiftEmployeesModal() {
    this.isShiftEmployeesModalOpen.set(false);
    this.selectedShiftForEmployees.set(null);
    this.shiftEmployeesList.set([]);
    this.shiftEmployeesSearchText.set('');
  }

  getAvatarBg(name?: string): string {
    if (!name) return '#64748B';
    const colors = ['#2A97D8', '#6366F1', '#EC4899', '#8B5CF6', '#10B981', '#F59E0B', '#06B6D4', '#3B82F6'];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  }

  getModalShiftDurationText(): string {
    if (this.formData.shiftType === 'FLEXIBLE') {
      return `${this.formData.totalHours || 8} hrs required`;
    }
    return this.calculateShiftDuration(this.formData.startTime, this.formData.endTime);
  }

  isModalOvernight(): boolean {
    if (this.formData.shiftType === 'FLEXIBLE') return false;
    return this.isOvernightShift(this.formData.startTime, this.formData.endTime);
  }

  weekDays = [
    { label: 'Sunday', value: '0' },
    { label: 'Monday', value: '1' },
    { label: 'Tuesday', value: '2' },
    { label: 'Wednesday', value: '3' },
    { label: 'Thursday', value: '4' },
    { label: 'Friday', value: '5' },
    { label: 'Saturday', value: '6' }
  ];

  isWeeklyOff(val: string): boolean {
    return !!this.weeklyOffConditions[val];
  }

  toggleWeeklyOff(val: string) {
    if (this.weeklyOffConditions[val]) {
      delete this.weeklyOffConditions[val];
    } else {
      this.weeklyOffConditions[val] = 'all';
    }
    this.syncWeeklyOffs();
  }

  updateWeeklyOffCondition(val: string, condition: 'all' | 'even' | 'odd') {
    if (this.weeklyOffConditions[val]) {
      this.weeklyOffConditions[val] = condition;
      this.syncWeeklyOffs();
    }
  }

  syncWeeklyOffs() {
    this.formData.weeklyOffs = Object.keys(this.weeklyOffConditions)
      .map(k => `${k}:${this.weeklyOffConditions[k]}`)
      .join(',');
  }

  ngOnInit() {
    this.loadData();
  }

  loadData() {
    this.masterDataService.getDepartments().subscribe({ next: (data) => this.departments.set(data) });
    this.masterDataService.getDesignations().subscribe({ next: (data) => this.designations.set(data) });
    this.masterDataService.getBranches().subscribe({ next: (data) => this.branches.set(data) });
    this.masterDataService.getLeaveTypes().subscribe({ next: (data) => this.leaveTypes.set(data) });
    this.masterDataService.getHolidays().subscribe({ next: (data) => this.holidays.set(data) });
    this.masterDataService.getBlackoutDates().subscribe({ next: (data) => this.blackoutDates.set(data) });
    this.shiftsService.getShifts().subscribe({ next: (data) => this.shifts.set(data) });
  }

  switchTab(tab: Tab) {
    this.activeTab.set(tab);
  }

  openModal(mode: 'create' | 'edit', item?: any) {
    this.modalMode.set(mode);
    if (mode === 'edit' && item) {
      this.formData = { ...item };
      if (this.activeTab() === 'shifts') {
        this.formData = {
          ...this.shiftDefaults(), ...item,
          // Stored comma-separated; the checkboxes want an array.
          workingDays: item.workingDays ? String(item.workingDays).split(',') : [...this.WEEK_DAYS],
        };
      }
      if (this.activeTab() === 'holidays') {
        this.formData.date = item.date ? new Date(item.date).toISOString().split('T')[0] : '';
      }
      if (this.activeTab() === 'branches') {
        this.weeklyOffConditions = {};
        if (this.formData.weeklyOffs) {
          this.formData.weeklyOffs.split(',').forEach((rule: string) => {
            const parts = rule.trim().split(':');
            this.weeklyOffConditions[parts[0]] = (parts[1] as any) || 'all';
          });
        }
      }
    } else {
      this.formData = {
        id: 0, name: '', departmentId: 0, canEditProfiles: false,
        address: '', startTime: '09:00', endTime: '18:00', weeklyOffs: '0',
        geofenceRadius: 500, allowedIps: '',
        isActive: true,
        defaultDays: 0, isPaid: true, carryForward: false, carryForwardLimit: 0,
        accrualFrequency: 'NONE', accrualAmount: 0,
        allowHalfDay: true,
        date: '',
        ...this.shiftDefaults()
      };
      if (this.activeTab() === 'branches') {
        this.weeklyOffConditions = { '0': 'all' }; // Default Sunday off
      }
    }
    this.isModalOpen.set(true);
  }

  closeModal() {
    this.isModalOpen.set(false);
  }

  save() {
    if (!this.formData.name || !this.formData.name.trim()) {
      this.toast.error('Name is required');
      return;
    }

    this.isSaving.set(true);
    const tab = this.activeTab();
    const mode = this.modalMode();
    const id = this.formData.id;

    const onSuccess = (msg: string) => {
      this.toast.success(msg);
      this.loadData();
      this.closeModal();
      this.isSaving.set(false);
    };
    const onError = (err: any) => {
      const msg = err.error?.message || err.message || 'An error occurred';
      this.toast.error(msg);
      this.isSaving.set(false);
    };

    if (tab === 'departments') {
      if (mode === 'create') this.masterDataService.createDepartment(this.formData).subscribe({ next: () => onSuccess('Department created'), error: onError });
      else this.masterDataService.updateDepartment(id, this.formData).subscribe({ next: () => onSuccess('Department updated'), error: onError });
    } else if (tab === 'designations') {
      if (mode === 'create') this.masterDataService.createDesignation(this.formData).subscribe({ next: () => onSuccess('Designation created'), error: onError });
      else this.masterDataService.updateDesignation(id, this.formData).subscribe({ next: () => onSuccess('Designation updated'), error: onError });
    } else if (tab === 'branches') {
      if (mode === 'create') this.masterDataService.createBranch(this.formData).subscribe({ next: () => onSuccess('Branch created'), error: onError });
      else this.masterDataService.updateBranch(id, this.formData).subscribe({ next: () => onSuccess('Branch updated'), error: onError });
    } else if (tab === 'leave-types') {
      // parse numeric
      this.formData.defaultDays = Number(this.formData.defaultDays);
      this.formData.carryForwardLimit = Number(this.formData.carryForwardLimit);
      if (mode === 'create') this.masterDataService.createLeaveType(this.formData).subscribe({ next: () => onSuccess('Leave Type created'), error: onError });
      else this.masterDataService.updateLeaveType(id, this.formData).subscribe({ next: () => onSuccess('Leave Type updated'), error: onError });
    } else if (tab === 'holidays') {
      if (!this.formData.name || this.formData.name.trim().length === 0) {
        this.toast.error('Holiday name is required');
        this.isSaving.set(false);
        return;
      }
      if (this.formData.name.length > 100) {
        this.toast.error('Holiday name must be 100 characters or less');
        this.isSaving.set(false);
        return;
      }
      if (!this.formData.date) {
        this.toast.error('Holiday date is required');
        this.isSaving.set(false);
        return;
      }
      if (mode === 'create') this.masterDataService.createHoliday(this.formData).subscribe({ next: () => onSuccess('Holiday created'), error: onError });
      else this.masterDataService.updateHoliday(id, this.formData).subscribe({ next: () => onSuccess('Holiday updated'), error: onError });
    } else if (tab === 'blackout-dates') {
      if (mode === 'create') this.masterDataService.createBlackoutDate(this.formData).subscribe({ next: () => onSuccess('Blackout date created'), error: onError });
      else this.masterDataService.updateBlackoutDate(id, this.formData).subscribe({ next: () => onSuccess('Blackout date updated'), error: onError });
    } else if (tab === 'shifts') {
      if (this.formData.shiftType === 'FLEXIBLE') {
        if (!this.formData.totalHours || Number(this.formData.totalHours) <= 0) {
          this.toast.error('Total hours are required for flexible shift');
          this.isSaving.set(false);
          return;
        }
      } else {
        if (!this.formData.startTime || !this.formData.endTime) {
          this.toast.error('Start time and end time are required for strict shift');
          this.isSaving.set(false);
          return;
        }
      }

      const payload = {
        ...this.formData,
        name: this.formData.name.trim(),
        shortCode: this.formData.shortCode ? this.formData.shortCode.trim().toUpperCase() : '',
        bufferTimeMinutes: this.formData.bufferTimeMinutes !== '' && this.formData.bufferTimeMinutes != null ? Number(this.formData.bufferTimeMinutes) : 0,
        earlyClockInMinutes: this.formData.earlyClockInMinutes !== '' && this.formData.earlyClockInMinutes != null ? Number(this.formData.earlyClockInMinutes) : 0,
        autoClockOutHours: this.formData.autoClockOutHours !== '' && this.formData.autoClockOutHours != null ? Number(this.formData.autoClockOutHours) : 0,
        maxCheckIns: this.formData.maxCheckIns !== '' && this.formData.maxCheckIns != null ? Number(this.formData.maxCheckIns) : 2,
        halfDayHours: this.formData.halfDayHours !== '' && this.formData.halfDayHours != null ? Number(this.formData.halfDayHours) : 4,
        totalHours: this.formData.totalHours !== '' && this.formData.totalHours != null ? Number(this.formData.totalHours) : 9,
        workingDays: Array.isArray(this.formData.workingDays) ? this.formData.workingDays.join(',') : (this.formData.workingDays || '')
      };

      if (mode === 'create') this.shiftsService.createShift(payload).subscribe({ next: () => onSuccess('Shift created'), error: onError });
      else this.shiftsService.updateShift(id, payload).subscribe({ next: () => onSuccess('Shift updated'), error: onError });
    }
  }

  deleteItem(id: number) {
    if (!confirm('Are you sure you want to delete this item?')) return;

    const tab = this.activeTab();
    let deleteSub: any;

    if (tab === 'departments') deleteSub = this.masterDataService.deleteDepartment(id);
    else if (tab === 'designations') deleteSub = this.masterDataService.deleteDesignation(id);
    else if (tab === 'branches') deleteSub = this.masterDataService.deleteBranch(id);
    else if (tab === 'leave-types') deleteSub = this.masterDataService.deleteLeaveType(id);
    else if (tab === 'holidays') deleteSub = this.masterDataService.deleteHoliday(id);
    else if (tab === 'blackout-dates') deleteSub = this.masterDataService.deleteBlackoutDate(id);
    else if (tab === 'shifts') deleteSub = this.shiftsService.deleteShift(id);

    deleteSub.subscribe({
      next: () => {
        this.toast.success('Item deleted');
        this.loadData();
      },
      error: () => this.toast.error('Failed to delete item.')
    });
  }

  onDepartmentToggle(data: any, isActive: boolean) {
    this.masterDataService.updateDepartment(data.id, { isActive }).subscribe({
      next: () => {
        this.toast.success(`Department is now ${isActive ? 'Active' : 'Inactive'}`);
        // Reload to sync cascaded changes to Designations tab
        this.loadData();
      },
      error: (err) => {
        console.error(err);
        this.toast.error('Failed to update status');
        this.loadData();
      }
    });
  }

  onDesignationToggle(data: any, isActive: boolean) {
    this.masterDataService.updateDesignation(data.id, { isActive }).subscribe({
      next: () => {
        this.toast.success(`Designation is now ${isActive ? 'Active' : 'Inactive'}`);
      },
      error: (err) => {
        console.error(err);
        this.toast.error('Failed to update status');
        this.loadData();
      }
    });
  }

  onBranchToggle(data: any, isActive: boolean) {
    this.masterDataService.updateBranch(data.id, { isActive }).subscribe({
      next: () => {
        this.toast.success(`Branch is now ${isActive ? 'Active' : 'Inactive'}`);
      },
      error: (err) => {
        console.error(err);
        this.toast.error('Failed to update status');
        this.loadData();
      }
    });
  }

  onLeaveTypeToggle(data: any, field: string, isActive: boolean) {
    this.masterDataService.updateLeaveType(data.id, { [field]: isActive }).subscribe({
      next: () => {
        this.toast.success(`Leave Type updated`);
      },
      error: (err) => {
        console.error(err);
        this.toast.error('Failed to update leave type');
        this.loadData();
      }
    });
  }
}
