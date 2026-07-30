import { Component, OnInit, inject, signal, Output, EventEmitter, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DragDropModule, CdkDragDrop, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import { OnboardingService, OnboardingTemplate, OnboardingBoardData } from '../../services/onboarding.service';
import { HotToastService } from '@ngneat/hot-toast';
import { LucidePlus, LucideX, LucideSettings, LucideListTodo, LucideCheckCircle2, LucideClock, LucideGripVertical, LucideLayoutGrid, LucideTable } from '@lucide/angular';
import { AgGridAngular } from 'ag-grid-angular';
import { ColDef, AllCommunityModule, ModuleRegistry } from 'ag-grid-community';

ModuleRegistry.registerModules([AllCommunityModule]);

@Component({
  selector: 'app-onboarding',
  standalone: true,
  imports: [CommonModule, FormsModule, DragDropModule, LucideX, LucideSettings, LucideListTodo, LucideCheckCircle2, LucideClock, LucideGripVertical, LucideLayoutGrid, LucideTable, AgGridAngular],
  templateUrl: './onboarding.html',
  styleUrls: ['./onboarding.css']
})
export class OnboardingComponent implements OnInit {
  private onboardingService = inject(OnboardingService);
  private toast = inject(HotToastService);

  boardData = signal<OnboardingBoardData>({ pending: [], inProgress: [], completed: [] });
  templates = signal<OnboardingTemplate[]>([]);

  viewMode = signal<'KANBAN' | 'TABLE'>('KANBAN');

  tableData = computed(() => {
    const data = this.boardData();
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
      minWidth: 250,
      cellRenderer: (params: any) => {
        if (!params.data) return '';
        const initials = this.getInitials(params.data.firstName, params.data.lastName);
        return `
          <div style="display: flex; align-items: center; gap: 10px; line-height: 1.2;">
            <div style="width: 32px; height: 32px; border-radius: 50%; background: #e5e7eb; display: flex; align-items: center; justify-content: center; font-weight: 600; color: #4b5563; font-size: 13px;">
              ${initials}
            </div>
            <div>
              <div style="font-weight: 500; color: #111827;">${params.data.firstName} ${params.data.lastName}</div>
              <div style="font-size: 12px; color: #6b7280;">${params.data.designation?.name || 'No Designation'}</div>
            </div>
          </div>
        `;
      }
    },
    { 
      field: 'onboardingStatus', 
      headerName: 'Status',
      cellRenderer: (params: any) => {
        if (!params.value) return '';
        const statusStr = params.value;
        let color = '#6b7280'; let bg = '#f3f4f6'; let label = 'Pending';
        if (statusStr === 'IN_PROGRESS') { color = '#2563eb'; bg = '#eff6ff'; label = 'In Progress'; }
        if (statusStr === 'COMPLETED') { color = '#059669'; bg = '#ecfdf5'; label = 'Completed'; }
        return `<span style="background: ${bg}; color: ${color}; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 500;">${label}</span>`;
      }
    },
    {
      headerName: 'Progress',
      valueGetter: (params) => {
        return this.getProgressPercentage(params.data?.onboardingTasks);
      },
      cellRenderer: (params: any) => {
        if (!params.data) return '';
        const percent = this.getProgressPercentage(params.data.onboardingTasks);
        const completed = this.getCompletedCount(params.data.onboardingTasks);
        const total = params.data.onboardingTasks?.length || 0;
        return `
          <div style="width: 100%; display: flex; align-items: center; gap: 8px;">
            <div style="flex: 1; height: 6px; background: #e5e7eb; border-radius: 4px; overflow: hidden;">
              <div style="width: ${percent}%; height: 100%; background: ${percent === 100 ? '#10b981' : '#f97316'};"></div>
            </div>
            <span style="font-size: 12px; color: #6b7280;">${completed}/${total}</span>
          </div>
        `;
      }
    },
    { 
      headerName: 'Checklist',
      width: 120,
      flex: 0,
      sortable: false,
      filter: false,
      cellRenderer: (params: any) => {
        return `<button class="btn-primary" style="padding: 4px 8px; font-size: 12px;">View Tasks</button>`;
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
      this.boardData.set({ ...this.boardData() }); // Trigger change detection

      // Persist the status change
      this.onboardingService.updateEmployeeStatus(movedItem.id, newStatus).subscribe({
        error: () => this.toast.error('Failed to update status')
      });
    }
  }

  ngOnInit() {
    this.loadBoard();
  }

  loadBoard() {
    this.onboardingService.getOnboardingBoard().subscribe({
      next: (data) => this.boardData.set(data),
      error: () => this.toast.error('Failed to load onboarding board')
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
    return `${firstName?.charAt(0) || ''}${lastName?.charAt(0) || ''}`.toUpperCase();
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
    // Optimistic UI update
    task.isCompleted = newStatus;
    
    // Check if we need to move the card based on overall progress
    const emp = this.selectedEmployee();
    const completedCount = this.getCompletedCount(emp.onboardingTasks);
    const totalCount = emp.onboardingTasks.length;
    
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
      // Note: In a robust app, we'd manually splice the card into the correct array in `boardData`
      // For now, reloading the board cleanly syncs everything if it changed column.
      setTimeout(() => this.loadBoard(), 1000); 
    }

    this.onboardingService.toggleAdminTask(task.id, newStatus).subscribe({
      next: (res) => {
        if (res.newStatus !== emp.onboardingStatus) {
           this.loadBoard();
        }
      },
      error: () => {
        task.isCompleted = !newStatus; // revert
        this.toast.error('Failed to update task');
      }
    });
  }
}
