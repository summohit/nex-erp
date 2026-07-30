import { Component, inject, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MasterDataService, Department, Designation, Branch, LeaveType, Holiday } from '../../services/master-data.service';
import { HotToastService } from '@ngneat/hot-toast';
import { LucidePlus, LucideX, LucideCalendar, LucideList, LucideChevronLeft, LucideChevronRight } from '@lucide/angular';
import { AgGridAngular } from 'ag-grid-angular';
import { ColDef, AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { ActionCellRendererComponent } from '../../shared/components/action-cell-renderer.component';
import { StatusToggleRendererComponent } from '../../shared/components/status-toggle-renderer.component';

ModuleRegistry.registerModules([AllCommunityModule]);

type Tab = 'departments' | 'designations' | 'branches' | 'leave-types' | 'holidays';

@Component({
  selector: 'app-master-data',
  standalone: true,
  imports: [CommonModule, FormsModule, LucidePlus, LucideX, LucideCalendar, LucideList, LucideChevronLeft, LucideChevronRight, AgGridAngular],
  templateUrl: './master-data.html',
  styleUrls: ['./master-data.css']
})
export class MasterDataComponent implements OnInit {
  private masterDataService = inject(MasterDataService);
  private toast = inject(HotToastService);

  activeTab = signal<Tab>('departments');
  
  departments = signal<Department[]>([]);
  designations = signal<Designation[]>([]);
  branches = signal<Branch[]>([]);
  leaveTypes = signal<LeaveType[]>([]);
  holidays = signal<Holiday[]>([]);

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
    rowSelection: 'multiple' as const,
    suppressRowClickSelection: true
  };

  deptColDefs: ColDef[] = [
    { 
      field: 'name', 
      headerName: 'Name', 
      headerCheckboxSelection: true, 
      checkboxSelection: true,
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
      headerCheckboxSelection: true, 
      checkboxSelection: true,
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
    { field: 'name', headerName: 'Name', headerCheckboxSelection: true, checkboxSelection: true },
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
      headerName: 'Actions', width: 120, flex: 0, sortable: false, filter: false,
      cellRenderer: ActionCellRendererComponent,
      cellRendererParams: {
        onEdit: (data: any) => this.openModal('edit', data),
        onDelete: (data: any) => this.deleteItem(data.id)
      }
    }
  ];

  leaveTypeColDefs: ColDef[] = [
    { field: 'name', headerName: 'Name', headerCheckboxSelection: true, checkboxSelection: true },
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
      headerName: 'Actions', width: 120, flex: 0, sortable: false, filter: false,
      cellRenderer: ActionCellRendererComponent,
      cellRendererParams: {
        onEdit: (data: any) => this.openModal('edit', data),
        onDelete: (data: any) => this.deleteItem(data.id)
      }
    }
  ];

  holidayColDefs: ColDef[] = [
    { field: 'name', headerName: 'Holiday Name', headerCheckboxSelection: true, checkboxSelection: true },
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
    defaultDays: 0, isPaid: true, carryForward: false, carryForwardLimit: 0,
    date: ''
  };

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
  }

  switchTab(tab: Tab) {
    this.activeTab.set(tab);
  }

  openModal(mode: 'create' | 'edit', item?: any) {
    this.modalMode.set(mode);
    if (mode === 'edit' && item) {
      this.formData = { ...item };
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
        address: '', startTime: '09:00', endTime: '18:00', weeklyOffs: '0', latitude: null, longitude: null,
        defaultDays: 0, isPaid: true, carryForward: false, carryForwardLimit: 0, date: ''
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
    if (!this.formData.name.trim()) {
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
    const onError = (msg: string) => {
      this.toast.error(msg);
      this.isSaving.set(false);
    };

    if (tab === 'departments') {
      if (mode === 'create') this.masterDataService.createDepartment(this.formData).subscribe({ next: () => onSuccess('Department created'), error: () => onError('Error') });
      else this.masterDataService.updateDepartment(id, this.formData).subscribe({ next: () => onSuccess('Department updated'), error: () => onError('Error') });
    } else if (tab === 'designations') {
      if (mode === 'create') this.masterDataService.createDesignation(this.formData).subscribe({ next: () => onSuccess('Designation created'), error: () => onError('Error') });
      else this.masterDataService.updateDesignation(id, this.formData).subscribe({ next: () => onSuccess('Designation updated'), error: () => onError('Error') });
    } else if (tab === 'branches') {
      if (mode === 'create') this.masterDataService.createBranch(this.formData).subscribe({ next: () => onSuccess('Branch created'), error: () => onError('Error') });
      else this.masterDataService.updateBranch(id, this.formData).subscribe({ next: () => onSuccess('Branch updated'), error: () => onError('Error') });
    } else if (tab === 'leave-types') {
      // parse numeric
      this.formData.defaultDays = Number(this.formData.defaultDays);
      this.formData.carryForwardLimit = Number(this.formData.carryForwardLimit);
      if (mode === 'create') this.masterDataService.createLeaveType(this.formData).subscribe({ next: () => onSuccess('Leave Type created'), error: () => onError('Error') });
      else this.masterDataService.updateLeaveType(id, this.formData).subscribe({ next: () => onSuccess('Leave Type updated'), error: () => onError('Error') });
    } else if (tab === 'holidays') {
      if (mode === 'create') this.masterDataService.createHoliday(this.formData).subscribe({ next: () => onSuccess('Holiday created'), error: () => onError('Error') });
      else this.masterDataService.updateHoliday(id, this.formData).subscribe({ next: () => onSuccess('Holiday updated'), error: () => onError('Error') });
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
