import { Component, OnInit, inject, signal, Output, EventEmitter, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header';
import { FormsModule } from '@angular/forms';
import { DragDropModule, CdkDragDrop, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import { OnboardingService, OnboardingTemplate, OnboardingBoardData } from '../../services/onboarding.service';
import { HotToastService } from '@ngneat/hot-toast';
import { ProfileModalService } from '../../shared/profile-modal/profile-modal.service';
import { DatePresetFilterComponent, DatePreset, DateRange, inDateRange } from '../../shared/components/date-preset-filter/date-preset-filter';
import {
  LucidePlus,
  LucideX,
  LucideSettings,
  LucideListTodo,
  LucideCheckCircle2,
  LucideClock,
  LucideGripVertical,
  LucideLayoutGrid,
  LucideTable,
  LucideSearch,
  LucideUser,
  LucideUsers,
  LucideExternalLink,
  LucideAlertCircle,
  LucideCheck,
  LucideCalendar,
  LucideSparkles,
  LucideTrash2,
  LucideRefreshCw
} from '@lucide/angular';
import { AgGridAngular } from 'ag-grid-angular';
import { ColDef, AllCommunityModule, ModuleRegistry } from 'ag-grid-community';

ModuleRegistry.registerModules([AllCommunityModule]);

@Component({
  selector: 'app-onboarding',
  standalone: true,
  imports: [
    CommonModule,
    PageHeaderComponent,
    DatePresetFilterComponent,
    FormsModule,
    DragDropModule,
    LucidePlus,
    LucideX,
    LucideSettings,
    LucideListTodo,
    LucideCheckCircle2,
    LucideClock,
    LucideGripVertical,
    LucideLayoutGrid,
    LucideTable,
    LucideSearch,
    LucideUser,
    LucideUsers,
    LucideExternalLink,
    LucideAlertCircle,
    LucideCheck,
    LucideCalendar,
    LucideSparkles,
    LucideTrash2,
    LucideRefreshCw,
    AgGridAngular
  ],
  templateUrl: './onboarding.html',
  styleUrls: ['./onboarding.css']
})
export class OnboardingComponent implements OnInit {
  private onboardingService = inject(OnboardingService);
  private toast = inject(HotToastService);
  profileModal = inject(ProfileModalService);

  boardData = signal<OnboardingBoardData>({ pending: [], inProgress: [], completed: [] });
  templates = signal<OnboardingTemplate[]>([]);
  isLoading = signal<boolean>(true);

  viewMode = signal<'KANBAN' | 'TABLE'>('TABLE');
  searchTerm = signal('');
  /** Department and joining-date filters (12 Nov 2026), as on the other Employee pages. */
  selectedDepartment = signal<string>('ALL');
  datePreset = signal<DatePreset>('ALL');
  dateRange = signal<DateRange>(null);
  departments = computed(() => {
    const d = this.boardData();
    const all = [...(d?.pending || []), ...(d?.inProgress || []), ...(d?.completed || [])];
    return [...new Set(all.map((e: any) => e.department?.name).filter(Boolean))].sort() as string[];
  });

  resetFilters() {
    this.searchTerm.set('');
    this.selectedDepartment.set('ALL');
    this.datePreset.set('ALL');
    this.dateRange.set(null);
  }

  // Summary Metrics
  totalCount = computed(() => {
    const d = this.boardData();
    return (d.pending?.length || 0) + (d.inProgress?.length || 0) + (d.completed?.length || 0);
  });
  pendingCount = computed(() => this.boardData().pending?.length || 0);
  inProgressCount = computed(() => this.boardData().inProgress?.length || 0);
  completedCount = computed(() => this.boardData().completed?.length || 0);
  completionRate = computed(() => {
    const total = this.totalCount();
    if (!total) return 0;
    return Math.round((this.completedCount() / total) * 100);
  });

  filteredBoardData = computed(() => {
    const term = this.searchTerm().toLowerCase().trim();
    const dept = this.selectedDepartment();
    const range = this.dateRange();
    const data = this.boardData();
    if (!term && dept === 'ALL' && !range) return data;

    const filterFn = (emp: any) => {
      if (dept !== 'ALL' && emp.department?.name !== dept) return false;
      if (!inDateRange(emp.joiningDate, range)) return false;
      if (!term) return true;
      const name = `${emp.firstName || ''} ${emp.lastName || ''}`.toLowerCase();
      const designation = (emp.designation?.name || '').toLowerCase();
      const department = (emp.department?.name || '').toLowerCase();
      const code = (emp.employeeCode || '').toLowerCase();
      return name.includes(term) || designation.includes(term) || department.includes(term) || code.includes(term);
    };

    return {
      pending: data.pending.filter(filterFn),
      inProgress: data.inProgress.filter(filterFn),
      completed: data.completed.filter(filterFn)
    };
  });

  tableData = computed(() => {
    const data = this.filteredBoardData();
    return [...data.pending, ...data.inProgress, ...data.completed];
  });

  defaultColDef: ColDef = {
    flex: 1,
    minWidth: 150,
    filter: true,
    sortable: true
  };

  colDefs: ColDef[] = [
    { 
      headerName: 'Employee',
      field: 'firstName',
      minWidth: 280,
      cellRenderer: (params: any) => {
        if (!params.data) return '';
        const initials = this.getInitials(params.data.firstName, params.data.lastName);
        const bg = this.getAvatarBg(params.data.id);
        const avatar = params.data.avatarUrl
          ? `<img src="${params.data.avatarUrl}" style="width:34px;height:34px;border-radius:50%;object-fit:cover;flex-shrink:0;border:1px solid #e2e8f0;" onerror="this.style.display='none'" />`
          : `<div style="width:34px;height:34px;border-radius:50%;background:${bg};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;flex-shrink:0;">${initials}</div>`;
        return `
          <div style="display: flex; align-items: center; gap: 10px; line-height: 1.25; cursor: pointer;">
            ${avatar}
            <div style="min-width: 0; overflow: hidden;">
              <div style="font-weight: 600; color: #0f172a; white-space: nowrap; text-overflow: ellipsis; overflow: hidden;">${params.data.firstName} ${params.data.lastName || ''}</div>
              <div style="font-size: 11.5px; color: #64748b; margin-top: 1px;">#${params.data.employeeCode || 'N/A'} • ${params.data.designation?.name || 'No Designation'}</div>
            </div>
          </div>
        `;
      },
      onCellClicked: (params: any) => {
        this.openUserProfile(params.data?.id);
      }
    },
    {
      headerName: 'Department',
      field: 'department.name',
      valueGetter: (params) => params.data?.department?.name || '—',
      minWidth: 160
    },
    { 
      field: 'onboardingStatus', 
      headerName: 'Status',
      minWidth: 140,
      cellRenderer: (params: any) => {
        if (!params.value) return '';
        const statusStr = params.value;
        let color = '#d97706'; let bg = '#fef3c7'; let label = 'Not Started';
        if (statusStr === 'IN_PROGRESS') { color = '#2563eb'; bg = '#eff6ff'; label = 'In Progress'; }
        if (statusStr === 'COMPLETED') { color = '#059669'; bg = '#ecfdf5'; label = 'Completed'; }
        // align-self/height: the grid cell is a stretching flex box, which pulled the tag to full row height.
        return `<span style="align-self: center; height: auto; line-height: 1.4; background: ${bg}; color: ${color}; padding: 3px 10px; border-radius: 999px; font-size: 11.5px; font-weight: 600; display: inline-flex; align-items: center; gap: 4px; white-space: nowrap;">${label}</span>`;
      }
    },
    {
      headerName: 'Progress',
      minWidth: 180,
      valueGetter: (params) => {
        return this.getProgressPercentage(params.data?.onboardingTasks);
      },
      cellRenderer: (params: any) => {
        if (!params.data) return '';
        const percent = this.getProgressPercentage(params.data.onboardingTasks);
        const completed = this.getCompletedCount(params.data.onboardingTasks);
        const total = params.data.onboardingTasks?.length || 0;
        const color = percent === 100 ? '#10b981' : (percent > 0 ? '#2563eb' : '#94a3b8');
        return `
          <div style="width: 100%; display: flex; align-items: center; gap: 10px;">
            <div style="flex: 1; height: 6px; background: #f1f5f9; border-radius: 4px; overflow: hidden;">
              <div style="width: ${percent}%; height: 100%; background: ${color}; border-radius: 4px;"></div>
            </div>
            <span style="font-size: 12px; font-weight: 600; color: #475569; min-width: 42px;">${completed}/${total}</span>
          </div>
        `;
      }
    },
    { 
      headerName: 'Action',
      width: 120,
      flex: 0,
      sortable: false,
      filter: false,
      cellRenderer: () => {
        return `<button style="padding: 5px 12px; font-size: 12px; font-weight: 600; border-radius: 6px; background: #eff6ff; color: #2563eb; border: 1px solid #bfdbfe; cursor: pointer;">View Tasks</button>`;
      },
      onCellClicked: (params: any) => {
        this.openChecklist(params.data);
      }
    }
  ];

  isTemplateModalOpen = signal(false);
  newTemplate = { title: '', description: '' };
  isSaving = signal(false);

  selectedEmployee = signal<any>(null);
  isChecklistPanelOpen = signal(false);

  @Output() statusChanged = new EventEmitter<{ empId: number, status: string }>();

  drop(event: CdkDragDrop<any[]>) {
    if (event.previousContainer === event.container) {
      moveItemInArray(event.container.data, event.previousIndex, event.currentIndex);
    } else {
      transferArrayItem(
        event.previousContainer.data,
        event.container.data,
        event.previousIndex,
        event.currentIndex,
      );
      
      const movedItem = event.container.data[event.currentIndex];
      let newStatus = 'PENDING';
      if (event.container.id === 'inProgressList') newStatus = 'IN_PROGRESS';
      if (event.container.id === 'completedList') newStatus = 'COMPLETED';
      
      this.statusChanged.emit({ empId: movedItem.id, status: newStatus });
      this.boardData.set({ ...this.boardData() });

      this.onboardingService.updateEmployeeStatus(movedItem.id, newStatus).subscribe({
        error: () => this.toast.error('Failed to update status')
      });
    }
  }

  ngOnInit() {
    this.loadBoard();
  }

  loadBoard() {
    this.isLoading.set(true);
    this.onboardingService.getOnboardingBoard().subscribe({
      next: (data) => {
        this.boardData.set(data);
        this.isLoading.set(false);
      },
      error: () => {
        this.toast.error('Failed to load onboarding board');
        this.isLoading.set(false);
      }
    });
  }

  loadTemplates() {
    this.onboardingService.getTemplates().subscribe({
      next: (data) => this.templates.set(data),
      error: () => this.toast.error('Failed to load templates')
    });
  }

  openTemplateModal() {
    this.loadTemplates();
    this.isTemplateModalOpen.set(true);
  }

  closeTemplateModal() {
    this.isTemplateModalOpen.set(false);
    this.newTemplate = { title: '', description: '' };
  }

  addTemplate() {
    if (!this.newTemplate.title.trim()) {
      this.toast.error('Title is required');
      return;
    }
    
    this.isSaving.set(true);
    this.onboardingService.addTemplate(this.newTemplate).subscribe({
      next: () => {
        this.toast.success('Task template added');
        this.newTemplate = { title: '', description: '' };
        this.loadTemplates();
        this.isSaving.set(false);
      },
      error: () => {
        this.toast.error('Failed to add template');
        this.isSaving.set(false);
      }
    });
  }

  deleteTemplate(id: number) {
    if (!confirm('Remove this task from the default checklist?')) return;
    this.onboardingService.deleteTemplate(id).subscribe({
      next: () => {
        this.toast.success('Template removed');
        this.loadTemplates();
      },
      error: () => this.toast.error('Failed to remove template')
    });
  }

  getCompletedCount(tasks: any[]): number {
    if (!tasks || !tasks.length) return 0;
    return tasks.filter(t => t.isCompleted).length;
  }

  getProgressPercentage(tasks: any[]): number {
    if (!tasks || !tasks.length) return 0;
    return Math.round((this.getCompletedCount(tasks) / tasks.length) * 100);
  }
  
  getInitials(firstName: string, lastName: string): string {
    const f = (firstName || '').trim().charAt(0);
    const l = (lastName || '').trim().charAt(0);
    return `${f}${l}`.toUpperCase() || 'E';
  }

  getAvatarBg(id: number): string {
    const colors = [
      '#3b82f6', // blue
      '#8b5cf6', // violet
      '#10b981', // emerald
      '#f59e0b', // amber
      '#ec4899', // pink
      '#06b6d4', // cyan
      '#6366f1', // indigo
      '#14b8a6', // teal
    ];
    return colors[Math.abs(id || 0) % colors.length];
  }

  openUserProfile(empId: number, event?: Event) {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }
    if (empId) {
      this.profileModal.open(empId);
    }
  }

  openChecklist(employee: any) {
    this.selectedEmployee.set(employee);
    this.isChecklistPanelOpen.set(true);
  }

  closeChecklist() {
    this.isChecklistPanelOpen.set(false);
    this.selectedEmployee.set(null);
  }

  toggleTask(task: any) {
    const newStatus = !task.isCompleted;
    task.isCompleted = newStatus;
    
    const emp = this.selectedEmployee();
    const completedCount = this.getCompletedCount(emp.onboardingTasks);
    const totalCount = emp.onboardingTasks.length;
    
    const previousStatus = emp.onboardingStatus;
    
    let expectedStatus = emp.onboardingStatus;
    if (completedCount === totalCount && totalCount > 0) {
      expectedStatus = 'COMPLETED';
    } else if (completedCount > 0) {
      expectedStatus = 'IN_PROGRESS';
    } else {
      expectedStatus = 'PENDING';
    }

    if (expectedStatus !== emp.onboardingStatus) {
      emp.onboardingStatus = expectedStatus;
      setTimeout(() => this.loadBoard(), 1000); 
    }

    this.onboardingService.toggleAdminTask(task.id, newStatus).subscribe({
      next: (res) => {
        if (res.newStatus === 'COMPLETED' && previousStatus !== 'COMPLETED') {
           this.toast.success('Employee successfully onboarded!');
        }
        if (res.newStatus !== emp.onboardingStatus) {
           this.loadBoard();
        }
      },
      error: () => {
        task.isCompleted = !newStatus;
        this.toast.error('Failed to update task');
      }
    });
  }
}
