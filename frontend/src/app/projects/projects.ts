import { Component, signal, inject, OnInit, computed, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule, ActivatedRoute, NavigationEnd } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs/operators';
import { AgGridModule } from 'ag-grid-angular';
import { ColDef } from 'ag-grid-community';
import {
  LucidePlus, LucideKanban,
  LucideX, LucideUser, LucideChevronLeft, LucideCheck, LucideMoreHorizontal,
  LucideStar, LucideSearch, LucideClock, LucideEdit2, LucideArchive, LucideRotateCcw, LucideBrainCircuit,
  LucideLayoutGrid, LucideList, LucideListChecks, LucideChevronDown, LucideAlertTriangle, LucideUsers,
  LucideBriefcase, LucideFolder, LucideCheckSquare, LucideCalendar, LucideFilter, LucideExternalLink, LucideLayers, LucideCheckCircle2,
  LucidePaperclip, LucideUploadCloud, LucideFileText, LucideFile, LucideTrash2, LucideLoader2,
  LucidePencil, LucideTag, LucideBuilding, LucideMail, LucidePhone, LucideFlag, LucideActivity
} from '@lucide/angular';
import { ProjectsService } from '../services/projects';
import { ClientsService } from '../services/clients';
import { MasterDataService } from '../services/master-data.service';
import { EmployeeService } from '../services/employee.service';
import { AuthService } from '../services/auth.service';
import { UploadService } from '../services/upload.service';
import { HotToastService } from '@ngneat/hot-toast';
import { DialogService } from '../shared/services/dialog.service';
import { ProjectStarCellRendererComponent } from '../shared/components/project-star-cell-renderer.component';
import { ProjectActionCellRendererComponent } from '../shared/components/project-action-cell-renderer.component';
import {
  TasksService, MyTask, TaskCapabilities, TaskType, LeadOption, TaskScope,
  PreSalesInfo, PreSalesTaskHistoryEntry,
} from '../services/tasks.service';

/**
 * Project status, as of the Delivery module: DRAFT, ACTIVE, ON_HOLD, AT_RISK,
 * COMPLETED, CLOSED, CANCELLED. The three legacy values are kept because a
 * cached response or an un-migrated row would otherwise render colourless.
 */
const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  DRAFT: { bg: '#f1f2f4', color: '#6b7280' },
  ACTIVE: { bg: '#dbeafe', color: '#1d4ed8' },
  ON_HOLD: { bg: '#fef3c7', color: '#b45309' },
  AT_RISK: { bg: '#ffedd5', color: '#c2410c' },
  COMPLETED: { bg: '#dcfce7', color: '#15803d' },
  CLOSED: { bg: '#e0e7ff', color: '#4338ca' },
  CANCELLED: { bg: '#fee2e2', color: '#b91c1c' },
  // Retired vocabulary, still possible on unmigrated rows.
  FINISHED: { bg: '#dcfce7', color: '#15803d' },
  IN_PROGRESS: { bg: '#dbeafe', color: '#1d4ed8' },
  NOT_STARTED: { bg: '#f1f2f4', color: '#6b7280' },
  ARCHIVED: { bg: '#fee2e2', color: '#b91c1c' },
  BLOCKED: { bg: '#fee2e2', color: '#b91c1c' }
};

export const PROJECT_STATUSES = [
  'DRAFT', 'ACTIVE', 'ON_HOLD', 'AT_RISK', 'COMPLETED', 'CLOSED', 'CANCELLED'
] as const;

export const PROJECT_PRIORITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;

const PRIORITY_COLORS: Record<string, { bg: string; color: string }> = {
  CRITICAL: { bg: '#fee2e2', color: '#b91c1c' },
  HIGH: { bg: '#ffedd5', color: '#c2410c' },
  MEDIUM: { bg: '#fef3c7', color: '#b45309' },
  LOW: { bg: '#f1f5f9', color: '#475569' }
};

function getStatusColors(status: string): { bg: string; color: string } {
  return STATUS_COLORS[(status || '').toUpperCase()] || { bg: '#f1f2f4', color: '#44546f' };
}

@Component({
  selector: 'app-projects',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterModule, LucidePlus, LucideKanban,
    LucideX, LucideUser, LucideChevronLeft, LucideBrainCircuit,
    LucideCheck, LucideStar, LucideSearch, LucideClock, LucideEdit2, LucideArchive, LucideRotateCcw,
    LucideLayoutGrid, LucideList, LucideListChecks, LucideChevronDown, LucideAlertTriangle, LucideUsers,
    LucideBriefcase, LucideFolder, LucideCheckSquare, LucideCalendar, LucideFilter, LucideExternalLink, LucideLayers, LucideCheckCircle2,
    LucidePaperclip, LucideUploadCloud, LucideFileText, LucideFile, LucideTrash2, LucideLoader2,
    LucidePencil, LucideTag, LucideBuilding, LucideMail, LucidePhone, LucideFlag, LucideActivity,
    AgGridModule
  ],
  templateUrl: './projects.html',
  styleUrls: ['./projects.css']
})
export class ProjectsComponent implements OnInit {
  private projectsService = inject(ProjectsService);
  private clientsService = inject(ClientsService);
  private masterDataService = inject(MasterDataService);
  private employeeService = inject(EmployeeService);
  private router = inject(Router);
  private authService = inject(AuthService);
  private tasksService = inject(TasksService);
  private uploadService = inject(UploadService);
  private toast = inject(HotToastService);
  private route = inject(ActivatedRoute);
  private dialog = inject(DialogService);
  private destroyRef = inject(DestroyRef);

  showArchiveWarningModal = false;
  pendingArchiveProjectId: number | null = null;
  archiveWarningMessage = '';

  currentUser = this.authService.currentUser;

  projects = signal<any[]>([]);
  archivedProjects = signal<any[]>([]);
  clients = signal<any[]>([]);
  /** Active departments, for the project form and the Department filter. */
  departments = signal<any[]>([]);
  /**
   * §4: the project form's Client field lists LEAD CONTACTS, not clients —
   * at the point a project is opened, the contact is who the business knows.
   * Choosing one resolves server-side to the Client the project is saved
   * against, creating it if there is not one already.
   */
  leadContacts = signal<any[]>([]);
  employees = signal<any[]>([]);
  searchQuery = signal<string>('');
  activeTab = signal<'all' | 'starred' | 'recent' | 'archived' | 'my-tasks'>(
    (() => {
      try {
        if (typeof window !== 'undefined' && window.location.pathname.startsWith('/tasks')) {
          return 'my-tasks';
        }
        if (typeof window !== 'undefined') {
          const urlParams = new URLSearchParams(window.location.search);
          const tab = urlParams.get('tab') as any;
          if (['all', 'starred', 'recent', 'archived'].includes(tab)) {
            return tab;
          }
        }
        const saved = (localStorage.getItem('projects-board-tab') || localStorage.getItem('projects-active-tab')) as any;
        return (saved && ['all', 'starred', 'recent', 'archived'].includes(saved)) ? saved : 'all';
      } catch (e) {
        return 'all';
      }
    })()
  );
  viewMode = signal<'card' | 'table'>((localStorage.getItem('projects-view-mode') as 'card' | 'table') || 'card');
  quickFilter = signal<'none' | 'overdue' | 'due-week' | 'led-by-me'>('none');

  // ── My Tasks ───────────────────────────────────────────────────────────
  myTasks = signal<MyTask[]>([]);
  myTasksLoading = signal<boolean>(false);
  myTasksLoaded = signal<boolean>(false);
  myTasksTruncated = signal<boolean>(false);
  myTasksShowDone = signal<boolean>(false);
  /** Tracks if user explicitly clicked the Assigned to me / Everyone toggle */
  userExplicitlyToggledScope = false;

  private isUserAdmin(): boolean {
    if (this.taskCapabilities().isAdmin) {
      return true;
    }
    const role = this.currentUser()?.role || this.authService.currentUser()?.role;
    if (role === 'ADMIN' || role === 'SUPERADMIN') {
      return true;
    }
    try {
      const token = localStorage.getItem('access_token');
      if (token) {
        const parts = token.split('.');
        if (parts.length > 1) {
          const payload = JSON.parse(atob(parts[1]));
          if (payload?.role === 'ADMIN' || payload?.role === 'SUPERADMIN') {
            return true;
          }
        }
      }
    } catch (e) {}
    return false;
  }

  /**
   * Whose tasks the list is showing.
   *
   * Only administrators are offered 'all'; for administrators, it defaults to 'all'
   * ("Everyone") so they see company work without having to toggle manually.
   */
  myTasksScope = signal<TaskScope>(
    (() => {
      try {
        const token = localStorage.getItem('access_token');
        if (token) {
          const parts = token.split('.');
          if (parts.length > 1) {
            const payload = JSON.parse(atob(parts[1]));
            if (payload?.role === 'ADMIN' || payload?.role === 'SUPERADMIN') {
              return 'all';
            }
          }
        }
      } catch (e) {}
      return 'mine';
    })()
  );
  /** Answered by the server so the department rule has one authority. */
  taskCapabilities = signal<TaskCapabilities>({ canCreateTask: false, canCreateGeneral: false, isAdmin: false });
  pmDropdownOpen = signal(false);
  pmSearchQuery = signal<string>('');

  projectManagerEmployees = computed(() => {
    return this.employees().filter((e: any) =>
      e.isProjectManager === true || /project.*manager|manager.*project/i.test(e.designation?.name || '')
    );
  });

  filteredPmEmployees = computed(() => {
    const q = this.pmSearchQuery().toLowerCase().trim();
    const all = this.employees() || [];
    if (!q) {
      const pms = all.filter((e: any) =>
        e.isProjectManager === true || /project.*manager|manager.*project/i.test(e.designation?.name || '')
      );
      const others = all.filter((e: any) => !pms.includes(e));
      return [...pms, ...others];
    }
    return all.filter((e: any) =>
      `${e.firstName || ''} ${e.lastName || ''}`.toLowerCase().includes(q) ||
      (e.user?.email || '').toLowerCase().includes(q) ||
      (e.designation?.name || '').toLowerCase().includes(q) ||
      (e.department?.name || '').toLowerCase().includes(q)
    );
  });

  get isProjectManager(): boolean {
    const empId = this.currentUser()?.employeeId;
    if (!empId) return false;
    return this.projectManagerEmployees().some((e: any) => e.id === empId);
  }

  getPmName(id: number): string {
    const emp = this.employees().find((e: any) => e.id === id);
    return emp ? `${emp.firstName || ''} ${emp.lastName || ''}`.trim() : '';
  }

  getPmInitial(id: number): string {
    const emp = this.employees().find((e: any) => e.id === id);
    if (!emp) return '?';
    return ((emp.firstName || '')[0] || '').toUpperCase();
  }

  getPmAvatarUrl(id: number): string | null {
    const emp = this.employees().find((e: any) => e.id === id);
    return emp?.avatarUrl || null;
  }

  getPmColor(id: number): string {
    const colors = ['#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6'];
    return colors[id % colors.length];
  }

  // --- Avatar stack (team members) ---
  readonly maxStackAvatars = 4;

  private memberDisplayName(m: any): string {
    const emp = m?.employee || m;
    return `${emp?.firstName || ''} ${emp?.lastName || ''}`.trim() || 'Unknown';
  }

  private memberInitial(m: any): string {
    const emp = m?.employee || m;
    return ((emp?.firstName || '?')[0] || '?').toUpperCase();
  }

  private memberAvatarUrl(m: any): string | null {
    return m?.employee?.avatarUrl || m?.avatarUrl || null;
  }

  getTeamStack(project: any): { visible: any[]; overflow: number } {
    const members: any[] = project?.members || [];
    const visible = members.slice(0, this.maxStackAvatars);
    const overflow = Math.max(0, members.length - visible.length);
    return { visible, overflow };
  }

  private readonly avatarBase = `width:28px;height:28px;border-radius:50%;border:2px solid #fff;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;box-shadow:0 1px 3px rgba(9,30,66,.2);flex-shrink:0;`;

  /** Builds an avatar + name chip for a single person, for use in ag-Grid cellRenderers. */
  private buildPersonHtml(person: any): string {
    if (!person) return '<span style="color:#94a3b8;font-size:12px;">—</span>';
    const name = `${person.firstName || ''} ${person.lastName || ''}`.trim() || 'Unknown';
    const initial = ((person.firstName || '?')[0] || '?').toUpperCase();
    const avatarStyle = `width:24px;height:24px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;flex-shrink:0;`;
    const avatar = person.avatarUrl
      ? `<span style="${avatarStyle}background:url('${person.avatarUrl}') center/cover no-repeat;"></span>`
      : `<span style="${avatarStyle}background:${this.getPmColor(person.id || 0)};">${initial}</span>`;
    return `<div style="display:flex;align-items:center;gap:6px;">${avatar}<span>${name}</span></div>`;
  }

  /** Builds a wrapped list of avatar + name chips, for use in ag-Grid cellRenderers. */
  private buildPeopleHtml(people: any[]): string {
    if (!people?.length) return '<span style="color:#94a3b8;font-size:12px;">—</span>';
    return `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">${people.map(p => this.buildPersonHtml(p)).join('')}</div>`;
  }

  /** Builds a raw-HTML avatar stack for use in ag-Grid cellRenderers (inline styles — no component CSS available). */
  buildTeamStackHtml(project: any): string {
    const members: any[] = project?.members || [];
    const total = members.length;
    if (total === 0) return '<span style="color:#94a3b8;font-size:12px;">—</span>';

    const visible = members.slice(0, this.maxStackAvatars);
    const overflow = Math.max(0, total - visible.length);

    const circles = visible.map((m, i) => {
      const url = this.memberAvatarUrl(m);
      const name = this.memberDisplayName(m);
      const ml = i === 0 ? '0' : '-8px';
      const z = visible.length - i;
      if (url) {
        return `<span style="${this.avatarBase}margin-left:${ml};z-index:${z};background:url('${url}') center/cover no-repeat;" title="${name}"></span>`;
      }
      const color = this.getPmColor(m.employeeId || m.id || i);
      return `<span style="${this.avatarBase}margin-left:${ml};z-index:${z};background:${color};" title="${name}">${this.memberInitial(m)}</span>`;
    }).join('');

    const overflowCircle = overflow > 0
      ? `<span style="${this.avatarBase}margin-left:-8px;background:#44546f;font-size:9px;">+${overflow}</span>`
      : '';

    const countBtn = `<button
        data-team-project-id="${project.id}"
        style="margin-left:8px;border:none;background:none;padding:2px 6px;border-radius:10px;cursor:pointer;font-size:11px;font-weight:600;color:#44546f;background:#f1f2f4;"
        title="View all members">
        ${total}
      </button>`;

    return `<div style="display:flex;align-items:center;height:100%;">${circles}${overflowCircle}${countBtn}</div>`;
  }

  // ── Assigned users ─────────────────────────────────────────────────────
  // Separate from project managers: a manager owns the delivery, a user works
  // on it. They are stored as ProjectMember MEMBER rows, and somebody picked
  // in both lists keeps the higher role — the server collapses the duplicate.
  memberDropdownOpen = signal<boolean>(false);
  memberSearchQuery = signal<string>('');

  filteredMemberEmployees = computed(() => {
    const q = this.memberSearchQuery().toLowerCase().trim();
    const all = this.employees() || [];
    if (!q) return all;
    return all.filter((e: any) =>
      `${e.firstName} ${e.lastName}`.toLowerCase().includes(q) ||
      (e.user?.email || '').toLowerCase().includes(q) ||
      (e.designation?.name || '').toLowerCase().includes(q) ||
      (e.department?.name || '').toLowerCase().includes(q)
    );
  });

  toggleMember(id: number) {
    const idx = this.projectForm.memberIds.indexOf(id);
    if (idx >= 0) {
      this.projectForm.memberIds.splice(idx, 1);
    } else {
      this.projectForm.memberIds.push(id);
    }
  }

  removeMember(id: number) {
    const idx = this.projectForm.memberIds.indexOf(id);
    if (idx >= 0) this.projectForm.memberIds.splice(idx, 1);
  }

  togglePm(id: number) {
    const idx = this.projectForm.pmIds.indexOf(id);
    if (idx >= 0) {
      this.projectForm.pmIds.splice(idx, 1);
    } else {
      this.projectForm.pmIds.push(id);
    }
  }

  removePm(id: number) {
    const idx = this.projectForm.pmIds.indexOf(id);
    if (idx >= 0) this.projectForm.pmIds.splice(idx, 1);
  }
  
  // Local persistence for Starred & Recently Viewed
  starredBoardIds = signal<number[]>([]);
  recentlyViewedIds = signal<number[]>([]);

  isCreateModalOpen = signal(false);
  isSubmitted = signal(false);
  editingProjectId = signal<number | null>(null);
  teamModalProject = signal<any | null>(null);

  openTeamModal(project: any, event?: Event) {
    if (event) event.stopPropagation();
    this.teamModalProject.set(project);
  }

  closeTeamModal() {
    this.teamModalProject.set(null);
  }

  setViewMode(mode: 'card' | 'table') {
    this.viewMode.set(mode);
    localStorage.setItem('projects-view-mode', mode);
  }

  setQuickFilter(filter: 'none' | 'overdue' | 'due-week' | 'led-by-me') {
    this.quickFilter.set(this.quickFilter() === filter ? 'none' : filter);
  }

  private isProjectClosed(p: any): boolean {
    return p.workStatus === 'FINISHED' || p.status === 'ARCHIVED';
  }

  private applyQuickFilter(list: any[]): any[] {
    const filter = this.quickFilter();
    if (filter === 'none') return list;

    if (filter === 'led-by-me') {
      const empId = this.currentUser()?.employeeId;
      return list.filter(p => p.lead?.id === empId);
    }

    const now = new Date();
    const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    return list.filter(p => {
      if (!p.endDate || this.isProjectClosed(p)) return false;
      const end = new Date(p.endDate);
      if (filter === 'overdue') return end < now;
      if (filter === 'due-week') return end >= now && end <= weekFromNow;
      return true;
    });
  }

  quickFilterCounts = computed(() => {
    const base = this.myProjects();
    const empId = this.currentUser()?.employeeId;
    const now = new Date();
    const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    let overdue = 0, dueWeek = 0, ledByMe = 0;
    for (const p of base) {
      if (p.lead?.id === empId) ledByMe++;
      if (!p.endDate || this.isProjectClosed(p)) continue;
      const end = new Date(p.endDate);
      if (end < now) overdue++;
      else if (end <= weekFromNow) dueWeek++;
    }
    return { overdue, dueWeek, ledByMe };
  });

  // AG Grid: Table View
  paginationPageSize = 20;
  paginationPageSizeOptions = [10, 20, 50, 100];
  gridApi: any;
  selectedProjects = signal<any[]>([]);

  gridOptions = {
    rowSelection: {
      mode: 'multiRow' as const,
      checkboxes: true,
      headerCheckbox: true,
      enableClickSelection: false
    }
  };

  defaultColDef: ColDef = {
    sortable: true,
    filter: true,
    resizable: true
  };

  onBoardsGridReady(params: any) {
    this.gridApi = params.api;
  }

  onBoardsSelectionChanged() {
    if (this.gridApi) this.selectedProjects.set(this.gridApi.getSelectedRows());
  }

  clearSelection() {
    this.gridApi?.deselectAll();
    this.selectedProjects.set([]);
  }

  bulkArchiveSelected() {
    const selected = this.selectedProjects();
    if (selected.length === 0) return;
    if (!confirm(`Archive ${selected.length} selected board(s)?`)) return;

    let remaining = selected.length;
    selected.forEach((p) => {
      this.projectsService.archiveProject(p.id, false).subscribe({
        next: () => {
          remaining--;
          if (remaining === 0) {
            this.clearSelection();
            this.loadProjects();
            this.loadArchivedProjects();
            this.toast.success(`${selected.length} board(s) archived`);
          }
        },
        error: (err) => {
          remaining--;
          this.toast.error(err?.error?.message || `Failed to archive "${p.name}"`);
          if (remaining === 0) {
            this.clearSelection();
            this.loadProjects();
            this.loadArchivedProjects();
          }
        }
      });
    });
  }

  /**
   * Whether money is on screen at all.
   *
   * The server decides per project and stamps each row with
   * `canViewFinancials` — a project manager sees the budget of the projects
   * they run and nobody else's, so this is not a single answer about the
   * viewer. The columns appear if any row grants them, and each cell falls
   * back to a dash for the rows that do not.
   */
  canSeeAnyFinancials = computed(() =>
    this.filteredProjects().some((p: any) => p.canViewFinancials)
  );

  private money(value: number | null | undefined, row: any): string {
    if (!row?.canViewFinancials) return '<span class="cell-muted">—</span>';
    if (value == null) return '<span class="cell-muted">—</span>';
    const symbol = row.currency === 'USD' ? '$' : row.currency === 'EUR' ? '€' : '₹';
    return `${symbol}${Number(value).toLocaleString('en-IN')}`;
  }

  private hours(value: number | null | undefined): string {
    if (value == null) return '<span class="cell-muted">—</span>';
    const rounded = Math.round(Number(value) * 10) / 10;
    return `${rounded.toLocaleString('en-IN')}h`;
  }

  /**
   * §2.1 list columns. A computed rather than a fixed array because the money
   * columns come and go with the rows the viewer is allowed to see.
   */
  boardsColumnDefs = computed<ColDef[]>(() => {
    const cols: ColDef[] = [
      {
        headerName: '',
        field: 'star',
        width: 56,
        sortable: false,
        filter: false,
        resizable: false,
        cellRenderer: ProjectStarCellRendererComponent,
        cellRendererParams: {
          isStarred: (data: any) => this.isStarred(data.id),
          onToggle: (data: any) => this.toggleStar(data.id)
        }
      },
      {
        // Rule 10: the project code is a column of its own, searchable and
        // sortable. It used to be tacked onto the end of the name cell, where
        // it could not be sorted on and read as part of the title.
        headerName: 'Code',
        field: 'key',
        width: 140,
        minWidth: 120,
        cellRenderer: (params: any) =>
          params.value ? `<span class="project-code-chip">${params.value}</span>` : '<span class="cell-muted">—</span>'
      },
      {
        headerName: 'Project',
        field: 'name',
        flex: 2,
        minWidth: 240,
        cellRenderer: (params: any) => {
          if (!params.data) return '';
          const color = this.getGradient(params.data.color, params.node?.rowIndex || 0);
          return `
            <div class="table-name-cell">
              <span class="table-color-dot" style="background:${color}"></span>
              <span class="board-title">${params.data.name}</span>
            </div>
          `;
        }
      },
      {
        headerName: 'Client',
        field: 'client.name',
        width: 170,
        valueGetter: (params: any) => params.data?.client?.name || '—'
      },
      {
        headerName: 'PM',
        field: 'pm',
        width: 170,
        sortable: false,
        valueGetter: (params: any) => {
          const pms = (params.data?.members || []).filter((m: any) => m.role === 'PROJECT_MANAGER');
          if (!pms.length) return '—';
          return pms.map((m: any) => `${m.employee?.firstName || ''} ${m.employee?.lastName || ''}`.trim()).join(', ');
        },
        cellRenderer: (params: any) => {
          const pms = (params.data?.members || [])
            .filter((m: any) => m.role === 'PROJECT_MANAGER')
            .map((m: any) => m.employee);
          return this.buildPeopleHtml(pms);
        }
      },
      {
        headerName: 'Lead',
        field: 'lead',
        width: 170,
        valueGetter: (params: any) => {
          const lead = params.data?.lead;
          return lead ? `${lead.firstName || ''} ${lead.lastName || ''}`.trim() : '—';
        },
        cellRenderer: (params: any) => this.buildPersonHtml(params.data?.lead)
      },
      {
        headerName: 'Department',
        field: 'department.name',
        width: 150,
        valueGetter: (params: any) => params.data?.department?.name || '—'
      },
      {
        headerName: 'Category',
        field: 'category',
        width: 160,
        valueGetter: (params: any) => params.data?.category || '—'
      },
      {
        headerName: 'Status',
        field: 'workStatus',
        width: 130,
        cellRenderer: (params: any) => {
          const s = params.data?.workStatus || '';
          if (!s) return '<span class="cell-muted">—</span>';
          const { bg, color } = getStatusColors(s);
          return `<span class="pstatus-pill" style="background:${bg};color:${color}">${s.replace(/_/g, ' ')}</span>`;
        }
      },
      {
        headerName: 'Priority',
        field: 'priority',
        width: 120,
        cellRenderer: (params: any) => {
          const v = (params.value || 'MEDIUM').toUpperCase();
          const { bg, color } = PRIORITY_COLORS[v] || PRIORITY_COLORS['MEDIUM'];
          return `<span class="pstatus-pill" style="background:${bg};color:${color}">${v}</span>`;
        }
      },
      {
        headerName: 'Progress',
        field: 'progress',
        width: 140,
        valueGetter: (params: any) => params.data?.progress ?? 0,
        cellRenderer: (params: any) => {
          const pct = Math.max(0, Math.min(100, Number(params.value ?? 0)));
          const color = pct === 100 ? '#16a34a' : pct >= 50 ? '#d97706' : '#dc2626';
          return `
            <div class="progress-cell">
              <div class="progress-track"><div class="progress-fill" style="width:${pct}%;background:${color}"></div></div>
              <span class="progress-label">${pct}%</span>
            </div>
          `;
        }
      },
      {
        headerName: 'Team',
        field: 'members',
        width: 150,
        sortable: false,
        filter: false,
        cellRenderer: (params: any) => this.buildTeamStackHtml(params.data),
        onCellClicked: (params: any) => {
          const btn = (params.event?.target as HTMLElement)?.closest('[data-team-project-id]');
          if (btn) this.openTeamModal(params.data);
        }
      },
      {
        headerName: 'Tasks',
        field: '_count.issues',
        width: 150,
        valueGetter: (params: any) => params.data?._count?.issues ?? 0,
        cellRenderer: (params: any) => {
          const total = params.data?.totalIssues ?? params.data?._count?.issues ?? 0;
          const remaining = params.data?.remainingIssues ?? 0;
          const done = total - remaining;
          if (total === 0) return '<span class="cell-muted">—</span>';
          const pct = Math.round((done / total) * 100);
          const color = pct === 100 ? '#16a34a' : pct >= 50 ? '#d97706' : '#dc2626';
          const bg = pct === 100 ? '#dcfce7' : pct >= 50 ? '#fef3c7' : '#fee2e2';
          return `
            <div style="display:flex;align-items:center;gap:6px;height:100%;">
              <span style="background:${bg};color:${color};font-weight:700;font-size:11.5px;padding:3px 8px;border-radius:10px;white-space:nowrap;">${remaining} left</span>
              <span style="background:#eef2ff;color:#4338ca;font-weight:700;font-size:11.5px;padding:3px 8px;border-radius:10px;white-space:nowrap;">${total} total</span>
            </div>
          `;
        }
      },
      // §8: estimated → logged → remaining, the module's core metric. Hours
      // are work, not money, so every role sees them.
      {
        headerName: 'Est. hrs',
        field: 'estimatedHours',
        width: 110,
        type: 'numericColumn',
        cellRenderer: (params: any) => this.hours(params.value)
      },
      {
        headerName: 'Logged hrs',
        field: 'loggedHours',
        width: 120,
        type: 'numericColumn',
        cellRenderer: (params: any) => this.hours(params.value)
      },
      {
        headerName: 'Remaining hrs',
        field: 'remainingHours',
        width: 140,
        type: 'numericColumn',
        cellRenderer: (params: any) => {
          if (params.value == null) return '<span class="cell-muted">—</span>';
          const over = Number(params.value) < 0;
          return `<span style="color:${over ? '#b91c1c' : 'inherit'};font-weight:${over ? 700 : 400}">${this.hours(params.value)}</span>`;
        }
      }
    ];

    // Rule 1: budget, cost and utilisation are for Admin, Finance and the
    // project's own PM. The server has already removed the values; this keeps
    // the empty columns off everyone else's screen too.
    if (this.canSeeAnyFinancials()) {
      cols.push(
        {
          headerName: 'Budget',
          field: 'budgetAmount',
          width: 140,
          type: 'numericColumn',
          cellRenderer: (params: any) => this.money(params.value, params.data)
        },
        {
          // §23: logged hours × each person's internal cost rate.
          headerName: 'Employee cost',
          field: 'employeeCost',
          width: 150,
          type: 'numericColumn',
          cellRenderer: (params: any) => {
            const base = this.money(params.value, params.data);
            const unpriced = params.data?.unratedHours ?? 0;
            if (!params.data?.canViewFinancials || unpriced <= 0) return base;
            // The figure is an understatement whenever somebody logged hours
            // without a cost rate. Saying so beats a number that looks whole.
            return `<span title="Excludes ${unpriced}h logged by people with no cost rate set">${base}<span class="cost-partial">*</span></span>`;
          }
        },
        {
          // Employee cost + approved expenses. This is what the project has
          // actually consumed, and what budget remaining is measured against.
          headerName: 'Actual cost',
          field: 'actualCost',
          width: 140,
          type: 'numericColumn',
          cellRenderer: (params: any) => this.money(params.value, params.data)
        },
        {
          headerName: 'Budget left',
          field: 'budgetRemaining',
          width: 140,
          type: 'numericColumn',
          cellRenderer: (params: any) => {
            if (!params.data?.canViewFinancials || params.value == null) {
              return '<span class="cell-muted">—</span>';
            }
            const over = Number(params.value) < 0;
            return `<span style="color:${over ? '#b91c1c' : 'inherit'};font-weight:${over ? 700 : 400}">${this.money(params.value, params.data)}</span>`;
          }
        }
      );
    }

    cols.push(
      {
        headerName: 'Start date',
        field: 'startDate',
        width: 130,
        valueFormatter: (params: any) => params.value ? new Date(params.value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
      },
      {
        // Labelled Deadline per §2.1; `endDate` is the column that has always
        // held it, and adding a second date field would leave two answers.
        headerName: 'Deadline',
        field: 'endDate',
        width: 130,
        valueFormatter: (params: any) => params.value ? new Date(params.value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
      },
      {
        headerName: '',
        field: 'actions',
        width: 70,
        sortable: false,
        filter: false,
        resizable: false,
        pinned: 'right',
        cellRenderer: ProjectActionCellRendererComponent,
        cellRendererParams: {
          showActions: () => this.isManagementAdmin,
          onEdit: (data: any) => this.openEditModal(data, new Event('click')),
          onArchive: (data: any) => this.archiveBoard(data, false, new Event('click'))
        }
      }
    );

    return cols;
  });

  onBoardRowClicked(event: any) {
    const target = event.event?.target as HTMLElement | null;
    // Don't navigate when clicking the team count button, checkbox, or action menu
    if (target?.closest('[data-team-project-id], input[type=checkbox], .ag-checkbox, button')) return;
    if (event.data) this.goToProject(event.data.id);
  }

  // Background Options (Images & Color gradients matching Trello style)
  imageBackgrounds = [
    'https://images.unsplash.com/photo-1519501025264-65ba15a82390?w=600&q=80', // Night City (matches screenshot)
    'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=600&q=80', // Mountains
    'https://images.unsplash.com/photo-1477959858617-67f30ac4ce78?w=600&q=80', // Golden Hour City
    'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=600&q=80'  // Red glow
  ];

  colorBackgrounds = [
    'linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)',
    'linear-gradient(135deg, #3b82f6 0%, #06b6d4 100%)',
    'linear-gradient(135deg, #10b981 0%, #059669 100%)',
    'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
    'linear-gradient(135deg, #ef4444 0%, #f43f5e 100%)',
    'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)'
  ];

  selectedBg = signal<string>(this.colorBackgrounds[1]);

  /**
   * A blank project.
   *
   * The same object literal used to be written out three times — here, in
   * openCreateModal and in openEditModal — so every new field had to be added
   * in three places or the form silently kept the previous project's value.
   */
  private emptyProjectForm() {
    return {
      name: '',
      visibility: 'Workspace',
      description: '',
      startDate: '',
      endDate: '',
      billingType: 'NON_BILLABLE',
      budgetAmount: null as number | null,
      hourlyRate: null as number | null,
      clientId: null as number | null,
      leadContactId: null as number | null,
      pmIds: [] as number[],
      memberIds: [] as number[],
      address: '',
      // ── Delivery (§4, §7, §9) ──
      category: '',
      priority: 'MEDIUM',
      departmentId: null as number | null,
      workStatus: 'ACTIVE',
      currency: 'INR',
      budgetNotes: '',
      estimatedHours: null as number | null,
      allowManualTimeLogging: true
    };
  }

  projectForm = this.emptyProjectForm();

  gradients = [
    'linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)',
    'linear-gradient(135deg, #3b82f6 0%, #06b6d4 100%)',
    'linear-gradient(135deg, #10b981 0%, #059669 100%)',
    'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
    'linear-gradient(135deg, #ef4444 0%, #f43f5e 100%)',
    'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)'
  ];

  get isAdmin(): boolean {
    const user = this.currentUser();
    return user?.role === 'SUPERADMIN' || user?.role === 'ADMIN';
  }

  // Management-level administrator: system admin role, or CEO/CTO by designation.
  get isManagementAdmin(): boolean {
    if (this.isAdmin) return true;
    const empId = this.currentUser()?.employeeId;
    if (!empId) return false;
    const emp = this.employees().find((e: any) => e.id === empId);
    const title = (emp?.designation?.name || '').toLowerCase();
    return title.includes('ceo') || title.includes('cto');
  }

  private myMemberOf(p: any): any {
    const empId = this.currentUser()?.employeeId;
    return p?.members?.find((m: any) => m.employeeId === empId) || null;
  }

  myProjects = computed(() => {
    // Admins get all projects from backend (no membership filter on server); non-admins are already filtered
    if (this.isAdmin) return this.projects();
    return this.projects().filter(p => !!this.myMemberOf(p));
  });

  // Filtered lists
  // ── §3 Project filters ─────────────────────────────────────────────────
  // Each is 'ALL' or an exact value; dates are ISO yyyy-mm-dd or ''. Held as
  // separate signals rather than one object so a change to any of them
  // recomputes the list without a manual trigger.
  /**
   * Files chosen in the create form (§6).
   *
   * Held in memory until the project exists: the upload endpoint is
   * /projects/:id/documents, and there is no id to upload against until the
   * create call returns. They go up immediately afterwards.
   */
  stagedFiles = signal<{ file: File; name: string }[]>([]);
  stagedUploading = signal(false);
  /** Index of the staged file being renamed, or null. */
  renamingStagedIndex = signal<number | null>(null);
  /** Documents already uploaded — shown when editing an existing project. */
  existingDocuments = signal<any[]>([]);
  renamingDocumentId = signal<number | null>(null);
  documentNameDraft = '';

  onStagedFilesPicked(event: Event) {
    const input = event.target as HTMLInputElement;
    const picked = Array.from(input.files || []);
    if (picked.length) {
      // The name is carried beside the File rather than on it: File.name is
      // read-only, so a rename has to live somewhere else until upload.
      this.stagedFiles.update(list => [...list, ...picked.map(file => ({ file, name: file.name }))]);
    }
    // Clearing it means picking the same file twice in a row still fires.
    input.value = '';
  }

  removeStagedFile(index: number) {
    this.stagedFiles.update(list => list.filter((_, i) => i !== index));
    this.renamingStagedIndex.set(null);
  }

  // ── Renaming, before and after upload ──────────────────────────────────
  // Both edit the NAME only. The extension is shown beside the input rather
  // than in it, and the server re-applies the rule on save either way.

  fileBaseName(fileName: string): string {
    const dot = (fileName || '').lastIndexOf('.');
    return dot > 0 ? fileName.slice(0, dot) : (fileName || '');
  }

  fileExtension(fileName: string): string {
    const dot = (fileName || '').lastIndexOf('.');
    return dot > 0 ? fileName.slice(dot) : '';
  }

  getFileTypeInfo(fileName: string): { bg: string; color: string; label: string } {
    const ext = (fileName || '').split('.').pop()?.toLowerCase() || '';
    if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) {
      return { bg: '#eff6ff', color: '#2563eb', label: ext.toUpperCase() };
    }
    if (ext === 'pdf') {
      return { bg: '#fef2f2', color: '#dc2626', label: 'PDF' };
    }
    if (['csv', 'xls', 'xlsx'].includes(ext)) {
      return { bg: '#ecfdf5', color: '#059669', label: ext.toUpperCase() };
    }
    if (['doc', 'docx', 'txt', 'rtf'].includes(ext)) {
      return { bg: '#f0f9ff', color: '#0284c7', label: ext.toUpperCase() };
    }
    if (['env', 'json', 'js', 'ts', 'html', 'css', 'xml'].includes(ext)) {
      return { bg: '#faf5ff', color: '#7c3aed', label: ext.toUpperCase() };
    }
    return { bg: '#f1f5f9', color: '#475569', label: ext ? ext.toUpperCase() : 'FILE' };
  }

  startRenameStaged(index: number) {
    this.renamingDocumentId.set(null);
    this.renamingStagedIndex.set(index);
    this.documentNameDraft = this.fileBaseName(this.stagedFiles()[index]?.name || '');
  }

  confirmRenameStaged(index: number) {
    const base = this.documentNameDraft.trim();
    if (!base) {
      this.toast.error('A file name is required');
      return;
    }
    this.stagedFiles.update(list => list.map((entry, i) =>
      i === index ? { ...entry, name: `${base}${this.fileExtension(entry.name)}` } : entry
    ));
    this.cancelRename();
  }

  startRenameDocument(doc: any) {
    this.renamingStagedIndex.set(null);
    this.renamingDocumentId.set(doc.id);
    this.documentNameDraft = this.fileBaseName(doc.name);
  }

  confirmRenameDocument(doc: any) {
    const base = this.documentNameDraft.trim();
    if (!base) {
      this.toast.error('A file name is required');
      return;
    }
    if (base === this.fileBaseName(doc.name)) {
      this.cancelRename();
      return;
    }

    const projectId = this.editingProjectId();
    if (!projectId) return;

    this.projectsService.renameProjectDocument(projectId, doc.id, base).subscribe({
      next: (updated) => {
        this.existingDocuments.update(list => list.map(d => d.id === doc.id ? { ...d, name: updated.name } : d));
        this.cancelRename();
      },
      error: (err) => this.toast.error(err?.error?.message || 'Could not rename the file'),
    });
  }

  cancelRename() {
    this.renamingStagedIndex.set(null);
    this.renamingDocumentId.set(null);
    this.documentNameDraft = '';
  }

  deleteExistingDocument(doc: any) {
    const projectId = this.editingProjectId();
    if (!projectId) return;
    if (!confirm(`Delete "${doc.name}"? This cannot be undone.`)) return;

    this.projectsService.deleteProjectDocument(projectId, doc.id).subscribe({
      next: () => {
        this.existingDocuments.update(list => list.filter(d => d.id !== doc.id));
        this.toast.success('File deleted');
      },
      error: (err) => this.toast.error(err?.error?.message || 'Could not delete the file'),
    });
  }

  /**
   * Upload the staged files against a project that now exists.
   *
   * Failures are reported but never block: the project has already been
   * created by this point, and refusing to navigate would strand the user on
   * a form for a project that is already saved. They can re-upload from the
   * Attachments tab.
   */
  private uploadStagedFiles(projectId: number, done: () => void) {
    const files = this.stagedFiles();
    if (!files.length) {
      done();
      return;
    }

    this.stagedUploading.set(true);
    let remaining = files.length;
    const failures: { name: string; reason: string }[] = [];

    const finish = () => {
      if (--remaining > 0) return;
      this.stagedUploading.set(false);
      this.stagedFiles.set([]);
      if (failures.length) {
        // Report what the server actually said. This used to be a bare count,
        // which made a 413 from the proxy, an expired token and a rejected
        // file name all read as the same unactionable sentence -- there was no
        // way to tell from the UI why an upload had failed.
        const [first] = failures;
        this.toast.error(
          failures.length === 1
            ? `${first.name} did not upload: ${first.reason}`
            : `${failures.length} of ${files.length} files did not upload. ${first.name}: ${first.reason}`,
        );
      }
      done();
    };

    for (const entry of files) {
      this.projectsService.uploadProjectDocument(projectId, entry.file, entry.name).subscribe({
        next: () => finish(),
        error: (err) => { failures.push({ name: entry.name, reason: this.uploadFailureReason(err) }); finish(); },
      });
    }
  }

  /**
   * A sentence explaining a failed upload, from whatever the server returned.
   *
   * 413 is called out by name because it is the one the app cannot fix from
   * here: it comes from the reverse proxy, before the request ever reaches
   * Nest, so there is no server-side message to pass on.
   */
  private uploadFailureReason(err: any): string {
    if (err?.status === 413) return 'the file is larger than the server accepts';
    if (err?.status === 0) return 'the server could not be reached';
    if (err?.status === 401 || err?.status === 403) return 'you are not signed in, or lack permission';
    return err?.error?.message || err?.message || `upload failed (HTTP ${err?.status ?? 'unknown'})`;
  }

  /** Collapsed by default — see the note in projects.html. */
  filtersOpen = signal<boolean>(false);
  filterClientId = signal<string>('ALL');
  filterPmId = signal<string>('ALL');
  filterDepartmentId = signal<string>('ALL');
  filterCategory = signal<string>('ALL');
  filterStatus = signal<string>('ALL');
  filterPriority = signal<string>('ALL');
  filterStartFrom = signal<string>('');
  filterDeadlineTo = signal<string>('');

  readonly projectStatusOptions = PROJECT_STATUSES;
  readonly projectPriorityOptions = PROJECT_PRIORITIES;

  /**
   * Filter dropdowns are built from the projects on screen, not from master
   * data: offering a department that no project uses produces an option that
   * can only ever return nothing.
   */
  private distinctFrom(pick: (p: any) => string | null | undefined): string[] {
    const seen = new Set<string>();
    for (const p of this.myProjects()) {
      const v = pick(p);
      if (v) seen.add(String(v));
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }

  clientOptions = computed(() => {
    const byId = new Map<number, string>();
    for (const p of this.myProjects()) {
      if (p.client?.id) byId.set(p.client.id, p.client.name);
    }
    return Array.from(byId, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  });

  departmentOptions = computed(() => {
    const byId = new Map<number, string>();
    for (const p of this.myProjects()) {
      if (p.department?.id) byId.set(p.department.id, p.department.name);
    }
    return Array.from(byId, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  });

  pmOptions = computed(() => {
    const byId = new Map<number, string>();
    for (const p of this.myProjects()) {
      for (const m of p.members || []) {
        if (m.role === 'PROJECT_MANAGER' && m.employee) {
          byId.set(m.employeeId, `${m.employee.firstName || ''} ${m.employee.lastName || ''}`.trim());
        }
      }
    }
    return Array.from(byId, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  });

  projectCategories: string[] = [
    'Implementation & Deployment',
    'Implementation & Migration',
    'Products',
    'AMC (Annual Maintenance Contract)',
    'FMS (Resource Contract)',
    'Rental',
    'Corporate Training',
    'POC',
    'Other',
    'Inbound',
    'Implementation',
    'Software',
    'Enterprise'
  ];

  categoryOptions = computed(() => {
    const fromProjects = this.distinctFrom(p => p.category);
    const combined = new Set([...this.projectCategories, ...fromProjects]);
    return Array.from(combined);
  });

  allBoardsForSelect = computed(() => {
    const list = this.myProjects();
    return [...list].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  });

  allTasksForSelect = computed(() => {
    const list = this.myTasks();
    return [...list].sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  });

  // Create / Edit Modal Searchable Selects
  clientDropdownOpen = signal<boolean>(false);
  clientSearchQuery = signal<string>('');

  categoryDropdownOpen = signal<boolean>(false);
  categorySearchQuery = signal<string>('');

  filteredLeadContacts = computed(() => {
    const list = this.leadContacts() || [];
    const q = this.clientSearchQuery().toLowerCase().trim();
    if (!q) return list;
    return list.filter(c => 
      (c.name && c.name.toLowerCase().includes(q)) ||
      (c.companyName && c.companyName.toLowerCase().includes(q)) ||
      (c.email && c.email.toLowerCase().includes(q)) ||
      (c.phone && c.phone.toLowerCase().includes(q))
    );
  });

  getSelectedLeadContact(): any | null {
    if (!this.projectForm.leadContactId) return null;
    return (this.leadContacts() || []).find(c => c.id === this.projectForm.leadContactId) || null;
  }

  getContactInitial(c: any): string {
    const n = c?.name || c?.companyName || '?';
    return n.charAt(0).toUpperCase();
  }

  selectLeadContact(c: any | null) {
    this.projectForm.leadContactId = c ? c.id : null;
    this.clientDropdownOpen.set(false);
    this.clientSearchQuery.set('');
  }

  filteredCategories = computed(() => {
    const q = this.categorySearchQuery().toLowerCase().trim();
    if (!q) return this.projectCategories;
    return this.projectCategories.filter(c => c.toLowerCase().includes(q));
  });

  selectCategory(cat: string) {
    this.projectForm.category = cat;
    this.categoryDropdownOpen.set(false);
    this.categorySearchQuery.set('');
  }

  departmentDropdownOpen = signal<boolean>(false);
  departmentSearchQuery = signal<string>('');

  filteredDepartments = computed(() => {
    const list = this.departments() || [];
    const q = this.departmentSearchQuery().toLowerCase().trim();
    if (!q) return list;
    return list.filter((d: any) => (d.name && d.name.toLowerCase().includes(q)));
  });

  getSelectedDepartment(): any | null {
    if (!this.projectForm.departmentId) return null;
    return (this.departments() || []).find((d: any) => d.id === this.projectForm.departmentId) || null;
  }

  selectDepartment(d: any | null) {
    this.projectForm.departmentId = d ? d.id : null;
    this.departmentDropdownOpen.set(false);
    this.departmentSearchQuery.set('');
  }

  closeAllModalDropdowns() {
    this.pmDropdownOpen.set(false);
    this.memberDropdownOpen.set(false);
    this.clientDropdownOpen.set(false);
    this.categoryDropdownOpen.set(false);
    this.departmentDropdownOpen.set(false);
  }

  // Deadline cannot precede the start date. Checked on both fields and again
  // on save, so a value typed straight into the date input cannot slip past.
  /**
   * Which required fields a NEW project is still missing.
   *
   * Names all of them at once: sending someone round the form one error at a
   * time is worse than one message listing what is left.
   */
  /**
   * Required fields in the order they appear on the form, so "the first one
   * missing" is also the first one the user would scroll past.
   */
  private readonly REQUIRED_FIELDS: { anchor: string; label: string; isMissing: () => boolean }[] = [
    { anchor: 'name',         label: 'Board title',     isMissing: () => !this.projectForm.name.trim() },
    { anchor: 'category',     label: 'Category',        isMissing: () => !this.projectForm.category?.trim() },
    { anchor: 'departmentId', label: 'Department',      isMissing: () => !this.projectForm.departmentId },
    { anchor: 'startDate',    label: 'Start date',      isMissing: () => !this.projectForm.startDate },
    { anchor: 'endDate',      label: 'Deadline',        isMissing: () => !this.projectForm.endDate },
    { anchor: 'pmIds',        label: 'Project manager', isMissing: () => this.projectForm.pmIds.length === 0 },
    { anchor: 'memberIds',    label: 'Assigned user',   isMissing: () => this.projectForm.memberIds.length === 0 },
  ];

  missingRequiredFields(): string[] {
    return this.REQUIRED_FIELDS.filter(f => f.isMissing()).map(f => f.label);
  }

  /**
   * Scroll the first missing field into view.
   *
   * The form is long enough that a toast alone leaves people hunting — and on
   * an existing project the missing field is usually one they never filled in
   * and would not think to look for.
   */
  private focusFirstInvalidField() {
    const first = this.REQUIRED_FIELDS.find(f => f.isMissing());
    if (!first) return;

    // After the toast, so the browser has painted the error states.
    setTimeout(() => {
      const label = document.querySelector(`[data-field="${first.anchor}"]`) as HTMLElement | null;
      if (!label) return;
      label.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // The anchor sits on the label; the control is its sibling, so focus has
      // to come from the surrounding group rather than from inside the label.
      const group = label.closest('.cbm-field-group') || label.parentElement;
      (group?.querySelector('input, select, textarea') as HTMLElement | null)?.focus({ preventScroll: true });
    }, 0);
  }

  /** Only a new project is held to the rules — see saveProject. */
  isRequiredMissing(field: 'startDate' | 'endDate' | 'departmentId' | 'category' | 'pmIds' | 'memberIds'): boolean {
    if (!this.isSubmitted()) return false;
    if (field === 'pmIds') return this.projectForm.pmIds.length === 0;
    if (field === 'memberIds') return this.projectForm.memberIds.length === 0;
    if (field === 'category') return !this.projectForm.category?.trim();
    return !this.projectForm[field];
  }

  isDateRangeInvalid(): boolean {
    if (!this.projectForm.startDate || !this.projectForm.endDate) return false;
    return this.projectForm.endDate < this.projectForm.startDate;
  }

  onStartDateChange() {
    if (this.projectForm.startDate && this.projectForm.endDate && this.projectForm.endDate < this.projectForm.startDate) {
      this.projectForm.endDate = this.projectForm.startDate;
    }
  }

  onEndDateChange() {
    if (this.projectForm.startDate && this.projectForm.endDate && this.projectForm.endDate < this.projectForm.startDate) {
      this.toast.warning('Deadline must be equal to or after Start Date');
    }
  }

  activeFilterCount = computed(() =>
    [
      this.filterClientId(), this.filterPmId(), this.filterDepartmentId(),
      this.filterCategory(), this.filterStatus(), this.filterPriority()
    ].filter(v => v !== 'ALL').length
    + (this.filterStartFrom() ? 1 : 0)
    + (this.filterDeadlineTo() ? 1 : 0)
  );

  clearProjectFilters() {
    this.filterClientId.set('ALL');
    this.filterPmId.set('ALL');
    this.filterDepartmentId.set('ALL');
    this.filterCategory.set('ALL');
    this.filterStatus.set('ALL');
    this.filterPriority.set('ALL');
    this.filterStartFrom.set('');
    this.filterDeadlineTo.set('');
  }

  private applyProjectFilters(list: any[]): any[] {
    const client = this.filterClientId();
    const pm = this.filterPmId();
    const dept = this.filterDepartmentId();
    const category = this.filterCategory();
    const status = this.filterStatus();
    const priority = this.filterPriority();
    const startFrom = this.filterStartFrom();
    const deadlineTo = this.filterDeadlineTo();

    return list.filter(p => {
      if (client !== 'ALL' && String(p.client?.id ?? '') !== client) return false;
      if (dept !== 'ALL' && String(p.department?.id ?? '') !== dept) return false;
      if (category !== 'ALL' && (p.category || '') !== category) return false;
      if (status !== 'ALL' && (p.workStatus || '') !== status) return false;
      if (priority !== 'ALL' && (p.priority || 'MEDIUM') !== priority) return false;

      if (pm !== 'ALL') {
        const isPm = (p.members || []).some(
          (m: any) => m.role === 'PROJECT_MANAGER' && String(m.employeeId) === pm
        );
        if (!isPm) return false;
      }

      // "Started on or after" and "due on or before" — the two halves people
      // actually ask for. A full range on both dates was four inputs for a
      // question nobody was asking.
      if (startFrom && (!p.startDate || new Date(p.startDate) < new Date(startFrom))) return false;
      if (deadlineTo && (!p.endDate || new Date(p.endDate) > new Date(deadlineTo))) return false;

      return true;
    });
  }

  filteredProjects = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();

    if (this.activeTab() === 'archived') {
      return this.applyProjectFilters(this.archivedProjects());
    }

    let list = this.myProjects();

    if (this.activeTab() === 'starred') {
      list = list.filter(p => this.myMemberOf(p)?.isStarred);
    } else if (this.activeTab() === 'recent') {
      list = list.filter(p => this.recentlyViewedIds().includes(p.id));
    }

    list = this.applyQuickFilter(list);
    list = this.applyProjectFilters(list);

    if (!q) return list;
    // §3: name, code and client are all searchable from the one box.
    return list.filter(p =>
      p.name.toLowerCase().includes(q)
      || p.key?.toLowerCase().includes(q)
      || p.client?.name?.toLowerCase().includes(q)
    );
  });

  starredProjects = computed(() => {
    if (this.isAdmin) return this.myProjects().filter(p => p.members?.some((m: any) => m.employeeId === this.currentUser()?.employeeId && m.isStarred));
    return this.myProjects().filter(p => this.myMemberOf(p)?.isStarred);
  });

  recentlyViewedProjects = computed(() => {
    return this.myProjects().filter(p => this.recentlyViewedIds().includes(p.id));
  });

  ngOnInit() {
    this.syncTabFromRoute();

    // Listen to route changes because Angular reuses this component instance
    // when navigating between /projects and /tasks (both point to ProjectsComponent).
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => {
        this.syncTabFromRoute();
      });

    const qp = this.route.snapshot.queryParamMap;
    const newTaskLeadId = Number(qp.get('newTaskLeadId'));

    this.loadStarredAndRecent();
    this.loadProjects();
    this.loadArchivedProjects();
    this.loadClients();
    this.loadDepartments();
    this.loadLeadContacts();
    this.loadEmployees();
    // Cheap, and it decides whether the Add Task button exists at all. The
    // tasks themselves wait until somebody opens the tab.
    this.tasksService.getCapabilities().subscribe({
      next: (c) => {
        this.taskCapabilities.set(c);
        if (c.isAdmin && this.myTasksScope() === 'mine' && !this.userExplicitlyToggledScope) {
          this.myTasksScope.set('all');
          if (this.activeTab() === 'my-tasks') this.loadMyTasks();
        }
      },
      error: () => {},
    });

    if (newTaskLeadId) {
      this.openComposerForLead(newTaskLeadId, Number(qp.get('newTaskAssigneeId')) || null);
      // One-shot parameters: a reload should show the list, not reopen the form.
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { tab: 'my-tasks' },
        replaceUrl: true,
      });
    }
  }

  private syncTabFromRoute() {
    const currentUrl = this.router.url;
    const path = currentUrl.split('?')[0];
    const qp = this.route.snapshot.queryParamMap;
    const forcedTab = this.route.snapshot.data['forceTab'] as
      | 'all' | 'starred' | 'recent' | 'archived' | 'my-tasks' | undefined;

    // Delivery > Tasks (/tasks) or forcedTab: always show my-tasks
    if (path.startsWith('/tasks') || forcedTab === 'my-tasks') {
      this.activeTab.set('my-tasks');
      if (this.isUserAdmin() && !this.userExplicitlyToggledScope && this.myTasksScope() !== 'all') {
        this.myTasksScope.set('all');
      }
      if (!this.myTasksLoaded()) {
        this.loadMyTasks();
      }
      return;
    }

    // Direct deep-link parameters that target a task
    const psTask = Number(qp.get('psTask'));
    if (psTask) {
      this.activeTab.set('my-tasks');
      this.highlightedPreSalesTaskId = psTask;
      if (!this.myTasksLoaded()) {
        this.loadMyTasks();
      }
      return;
    }

    const newTaskLeadId = Number(qp.get('newTaskLeadId'));
    if (newTaskLeadId) {
      this.activeTab.set('my-tasks');
      if (!this.myTasksLoaded()) {
        this.loadMyTasks();
      }
      return;
    }

    // Otherwise we are on /projects: check query param or last remembered board tab
    const qpTab = qp.get('tab') as 'all' | 'starred' | 'recent' | 'archived' | null;
    const validBoardTabs: Array<'all' | 'starred' | 'recent' | 'archived'> = ['all', 'starred', 'recent', 'archived'];

    if (qpTab && validBoardTabs.includes(qpTab)) {
      this.activeTab.set(qpTab);
      try {
        localStorage.setItem('projects-board-tab', qpTab);
      } catch (e) {}
      if (qpTab === 'archived') {
        this.loadArchivedProjects();
      }
    } else {
      let savedTab: 'all' | 'starred' | 'recent' | 'archived' = 'all';
      try {
        const saved = localStorage.getItem('projects-board-tab') as any;
        if (saved && validBoardTabs.includes(saved)) {
          savedTab = saved;
        } else {
          const legacy = localStorage.getItem('projects-active-tab') as any;
          if (legacy && validBoardTabs.includes(legacy)) {
            savedTab = legacy;
          }
        }
      } catch (e) {}
      this.activeTab.set(savedTab);
      if (savedTab === 'archived') {
        this.loadArchivedProjects();
      }
    }
  }

  /**
   * Open the composer already pointed at a deal.
   *
   * The deal options have to be in hand before the modal appears: isPreSalesTarget
   * reads the chosen deal's `flow`, so opening first would render the form in its
   * ordinary shape — a priority, a start date, everyone in the company as an
   * assignee — and then reshape it under the user a moment later.
   */
  private openComposerForLead(leadId: number, assigneeId: number | null) {
    const fill = () => {
      this.openCreateTask();
      this.taskForm.parentKind = 'LEAD';
      this.taskForm.leadId = leadId;
      if (assigneeId) this.taskForm.assigneeIds = [assigneeId];
      this.loadPreSalesInfoFor(leadId, assigneeId);
    };

    if (this.leadOptions().length) {
      fill();
      return;
    }

    this.tasksService.getLeadOptions().subscribe({
      next: (opts) => {
        this.leadOptions.set(opts);
        fill();
      },
      error: () => fill(),
    });
  }

  loadClients() {
    this.clientsService.getClients().subscribe({
      next: (res) => this.clients.set(res || []),
      error: (err) => console.error('Error loading clients', err)
    });
  }

  loadEmployees() {
    this.employeeService.getEmployees().subscribe({
      next: (res) => this.employees.set(res || []),
      error: (err) => console.error('Error loading employees', err)
    });
  }

  loadExistingDocuments(projectId: number) {
    this.projectsService.getProjectDocuments(projectId).subscribe({
      next: (docs) => this.existingDocuments.set(docs || []),
      error: () => this.existingDocuments.set([]),
    });
  }

  loadLeadContacts() {
    this.projectsService.getLeadContactOptions().subscribe({
      next: (res) => this.leadContacts.set(res || []),
      error: (err) => console.error('Error loading lead contacts', err)
    });
  }

  /** "Acme Ltd — Priya Sharma", or just the name when there is no company. */
  leadContactLabel(c: any): string {
    return c?.companyName ? `${c.companyName} — ${c.name}` : (c?.name || 'Unnamed contact');
  }

  loadDepartments() {
    // Active only: a retired department should not be offered on a new
    // project, though existing projects keep the one they were given.
    this.masterDataService.getDepartments(true).subscribe({
      next: (res) => this.departments.set(res || []),
      error: (err) => console.error('Error loading departments', err)
    });
  }

  setActiveTab(tab: 'all' | 'starred' | 'recent' | 'archived' | 'my-tasks') {
    this.activeTab.set(tab);

    const isCurrentRouteTasks = this.router.url.split('?')[0].startsWith('/tasks') ||
      this.route.snapshot.data['forceTab'] === 'my-tasks';

    if (tab === 'my-tasks') {
      if (!isCurrentRouteTasks) {
        this.router.navigate(['/tasks']);
      }
      if (this.isUserAdmin() && !this.userExplicitlyToggledScope && this.myTasksScope() !== 'all') {
        this.myTasksScope.set('all');
      }
      if (!this.myTasksLoaded()) {
        this.loadMyTasks();
      }
      return;
    }

    // A board tab was selected: 'all' | 'starred' | 'recent' | 'archived'
    try {
      localStorage.setItem('projects-board-tab', tab);
    } catch (e) {}

    if (isCurrentRouteTasks) {
      this.router.navigate(['/projects'], {
        queryParams: tab === 'all' ? {} : { tab }
      });
    } else {
      // Update query params in URL without reload so refreshing retains the tab
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { tab: tab === 'all' ? null : tab },
        queryParamsHandling: 'merge',
        replaceUrl: true
      });
    }

    if (tab === 'archived') {
      this.loadArchivedProjects();
    }
  }

  // ── Creating a task ──────────────────────────────────────────────────────

  isCreateTaskOpen = signal(false);
  isSavingTask = signal(false);
  taskTypes = signal<TaskType[]>([]);
  /** §8: the company's active delivery phases, for the task form. */
  projectPhases = signal<any[]>([]);
  phaseDropdownOpen = signal(false);
  phaseSearch = '';
  leadOptions = signal<LeadOption[]>([]);
  assigneeSearch = signal('');

  // Dropdown open states and search signals for Add Task modal
  taskProjectDropdownOpen = signal(false);
  taskProjectSearch = signal('');

  taskLeadDropdownOpen = signal(false);
  taskLeadSearch = signal('');

  taskTypeDropdownOpen = signal(false);
  taskTypeSearch = signal('');

  taskPriorityDropdownOpen = signal(false);
  taskAssigneeDropdownOpen = signal(false);

  // Attachment upload states
  isUploadingAttachment = signal(false);
  uploadingFileName = signal('');
  isAttachmentDragOver = signal(false);

  presalesDeals = computed(() => this.leadOptions().filter((l) => l.flow === 'PRE_SALES'));
  salesLeads = computed(() => this.leadOptions().filter((l) => l.flow !== 'PRE_SALES'));

  filteredModalProjects = computed(() => {
    const q = this.taskProjectSearch().toLowerCase().trim();
    if (!q) return this.projects();
    return this.projects().filter((p) =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.key || '').toLowerCase().includes(q)
    );
  });

  filteredModalPresalesDeals = computed(() => {
    const q = this.taskLeadSearch().toLowerCase().trim();
    const deals = this.presalesDeals();
    if (!q) return deals;
    return deals.filter((l) =>
      (l.title || '').toLowerCase().includes(q) ||
      (l.companyName || '').toLowerCase().includes(q) ||
      (l.leadCode || '').toLowerCase().includes(q) ||
      (l.contactName || '').toLowerCase().includes(q)
    );
  });

  filteredModalSalesLeads = computed(() => {
    const q = this.taskLeadSearch().toLowerCase().trim();
    const leads = this.salesLeads();
    if (!q) return leads;
    return leads.filter((l) =>
      (l.title || '').toLowerCase().includes(q) ||
      (l.companyName || '').toLowerCase().includes(q) ||
      (l.leadCode || '').toLowerCase().includes(q) ||
      (l.contactName || '').toLowerCase().includes(q)
    );
  });

  filteredModalTaskTypes = computed(() => {
    const q = this.taskTypeSearch().toLowerCase().trim();
    if (!q) return this.taskTypes();
    return this.taskTypes().filter((t) => (t.name || '').toLowerCase().includes(q));
  });

  taskForm: any = this.blankTaskForm();

  private blankTaskForm() {
    return {
      title: '',
      description: '',
      parentKind: 'GENERAL' as 'PROJECT' | 'LEAD' | 'GENERAL',
      projectId: null as number | null,
      leadId: null as number | null,
      taskTypeId: null as number | null,
      phaseId: null as number | null,
      priority: 'MEDIUM',
      startDate: '',
      dueDate: '',
      // Pre-sales work is scheduled to an instant, not a day — "6:24 PM on the
      // 14th" is the whole point of a site visit or a call.
      dueTime: '',
      estimatedHours: null as number | null,
      assigneeIds: [] as number[],
      attachments: [] as { fileName: string; fileUrl: string; fileSize?: number }[],
    };
  }

  closeAllTaskDropdowns() {
    this.taskProjectDropdownOpen.set(false);
    this.taskLeadDropdownOpen.set(false);
    this.taskTypeDropdownOpen.set(false);
    this.taskPriorityDropdownOpen.set(false);
    this.taskAssigneeDropdownOpen.set(false);
  }

  openCreateTask() {
    this.taskForm = this.blankTaskForm();
    this.assigneeSearch.set('');
    this.taskProjectSearch.set('');
    this.taskLeadSearch.set('');
    this.taskTypeSearch.set('');
    this.closeAllTaskDropdowns();
    this.isAttachmentDragOver.set(false);
    this.editingPreSalesTaskId.set(null);
    this.preSalesInfo.set(null);
    this.isCreateTaskOpen.set(true);
    this.ensureTaskPickerData();
  }

  /** Task types and deals, fetched once and reused by every open of the modal. */
  private ensureTaskPickerData() {
    if (!this.taskTypes().length) {
      this.tasksService.getTaskTypes().subscribe({
        next: (t) => this.taskTypes.set(t || []),
        error: () => {},
      });
    }
    // §8: the phase list, fetched alongside the task types it sits beside.
    if (!this.projectPhases().length) {
      this.masterDataService.getProjectPhases().subscribe({
        next: (p) => this.projectPhases.set(p || []),
        error: () => {},
      });
    }
    if (!this.leadOptions().length) {
      this.tasksService.getLeadOptions().subscribe({
        next: (l) => this.leadOptions.set(l || []),
        error: () => {},
      });
    }
  }

  closeCreateTask() {
    this.closeAllTaskDropdowns();
    this.isCreateTaskOpen.set(false);
    this.editingPreSalesTaskId.set(null);
  }

  toggleTaskAssignee(employeeId: number) {
    const current = this.taskForm.assigneeIds as number[];
    // A pre-sales task has exactly one assignee: it is their hours budget it
    // spends, and only they can move its status.
    if (this.isPreSalesTarget) {
      this.taskForm.assigneeIds = current.includes(employeeId) ? [] : [employeeId];
      this.taskAssigneeDropdownOpen.set(false);
      return;
    }
    this.taskForm.assigneeIds = current.includes(employeeId)
      ? current.filter((id) => id !== employeeId)
      : [...current, employeeId];
  }

  removeTaskAssignee(employeeId: number, event?: Event) {
    if (event) event.stopPropagation();
    const current = this.taskForm.assigneeIds as number[];
    this.taskForm.assigneeIds = current.filter((id) => id !== employeeId);
  }

  isTaskAssignee(employeeId: number): boolean {
    return (this.taskForm.assigneeIds as number[]).includes(employeeId);
  }

  getEmployeeById(id: number): any {
    return this.employees().find((e: any) => e.id === id);
  }

  getEmployeeAvatar(emp: any): string | null {
    return emp?.avatarUrl || emp?.user?.avatarUrl || emp?.profilePicture || emp?.avatar || null;
  }

  leadLabel(lead: any): string {
    if (!lead) return '';
    const code = lead.leadCode ? `[${lead.leadCode}] ` : '';
    const title = (lead.title || '').trim();
    const company = (lead.companyName || '').trim();
    if (title && company) return `${code}${title} — ${company}`;
    if (title) return `${code}${title}`;
    if (company) return `${code}${company}`;
    if (lead.contactName) return `${code}${lead.contactName}`;
    return `${code}Deal #${lead.id}`;
  }

  getSelectedProject(): any {
    return this.projects().find((p) => p.id === this.taskForm.projectId);
  }

  getSelectedLead(): any {
    return this.leadOptions().find((l) => l.id === this.taskForm.leadId);
  }

  getSelectedTaskType(): any {
    return this.taskTypes().find((t) => t.id === this.taskForm.taskTypeId);
  }
  /** §8: only active phases are offered; a retired one stays on old tasks. */
  filteredModalPhases() {
    const q = (this.phaseSearch || '').toLowerCase().trim();
    const active = this.projectPhases().filter((p: any) => p.isActive);
    if (!q) return active;
    return active.filter((p: any) => (p.name || '').toLowerCase().includes(q));
  }

  getSelectedPhase() {
    return this.projectPhases().find((p: any) => p.id === this.taskForm.phaseId);
  }

  selectPhase(id: number | null) {
    this.taskForm.phaseId = id;
    this.phaseDropdownOpen.set(false);
    this.phaseSearch = '';
  }


  getPriorityDetails(priority: string): { label: string; dotClass: string } {
    switch ((priority || '').toUpperCase()) {
      case 'CRITICAL':
        return { label: 'Critical', dotClass: 'dot-critical' };
      case 'HIGH':
        return { label: 'High', dotClass: 'dot-high' };
      case 'MEDIUM':
        return { label: 'Medium', dotClass: 'dot-medium' };
      case 'LOW':
        return { label: 'Low', dotClass: 'dot-low' };
      default:
        return { label: priority || 'Medium', dotClass: 'dot-medium' };
    }
  }

  selectTaskProject(id: number) {
    this.taskForm.projectId = id;
    this.taskProjectDropdownOpen.set(false);
  }

  selectTaskLead(id: number) {
    const changed = this.taskForm.leadId !== id;
    this.taskForm.leadId = id;
    this.taskLeadDropdownOpen.set(false);
    if (!changed) return;

    // A pre-sales task may only go to someone on that deal's team, so the
    // assignee picker has to be repopulated from the deal — and anyone picked
    // from the previous list is no longer a valid choice.
    this.taskForm.assigneeIds = [];
    this.preSalesInfo.set(null);
    if (this.leadOptions().find((l) => l.id === id)?.flow === 'PRE_SALES') {
      this.loadPreSalesInfoFor(id);
    }
  }

  selectTaskType(id: number | null) {
    this.taskForm.taskTypeId = id;
    this.taskTypeDropdownOpen.set(false);
  }

  selectTaskPriority(p: string) {
    this.taskForm.priority = p;
    this.taskPriorityDropdownOpen.set(false);
  }

  // ── Attachment handling ───────────────────────────────────────────────────

  onAttachmentFilesSelected(event: any) {
    const files = event.target?.files;
    if (files && files.length) {
      this.uploadFiles(Array.from(files));
    }
    event.target.value = '';
  }

  onAttachmentDrop(event: DragEvent) {
    event.preventDefault();
    this.isAttachmentDragOver.set(false);
    if (event.dataTransfer?.files?.length) {
      this.uploadFiles(Array.from(event.dataTransfer.files));
    }
  }

  onAttachmentDragOver(event: DragEvent) {
    event.preventDefault();
    this.isAttachmentDragOver.set(true);
  }

  onAttachmentDragLeave(event: DragEvent) {
    event.preventDefault();
    this.isAttachmentDragOver.set(false);
  }

  uploadFiles(files: File[]) {
    for (const file of files) {
      if (file.size > 20 * 1024 * 1024) {
        this.toast.error(`"${file.name}" exceeds maximum size of 20MB`);
        continue;
      }
      this.isUploadingAttachment.set(true);
      this.uploadingFileName.set(file.name);
      this.uploadService.uploadFile(file).subscribe({
        next: (res: any) => {
          this.isUploadingAttachment.set(false);
          this.uploadingFileName.set('');
          const url = res?.url || res?.fileUrl;
          if (url) {
            this.taskForm.attachments.push({
              fileName: file.name,
              fileUrl: url,
              fileSize: file.size,
            });
            this.toast.success(`Attached ${file.name}`);
          }
        },
        error: (err: any) => {
          this.isUploadingAttachment.set(false);
          this.uploadingFileName.set('');
          this.toast.error(err?.error?.message || `Failed to upload "${file.name}"`);
        },
      });
    }
  }

  removeAttachment(index: number, event?: Event) {
    if (event) event.stopPropagation();
    this.taskForm.attachments.splice(index, 1);
  }

  formatFileSize(bytes?: number): string {
    if (!bytes || isNaN(bytes)) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  getFileExtension(fileName: string): string {
    if (!fileName) return 'FILE';
    const parts = fileName.split('.');
    return (parts.length > 1 ? parts.pop()! : 'FILE').toUpperCase();
  }

  saveTask() {
    if (!this.taskForm.title?.trim()) {
      this.toast.error('Give the task a title.');
      return;
    }
    if (this.taskForm.parentKind === 'PROJECT' && !this.taskForm.projectId) {
      this.toast.error('Choose a project.');
      return;
    }
    if (this.taskForm.parentKind === 'LEAD' && !this.taskForm.leadId) {
      this.toast.error('Choose a pre-sales deal or lead.');
      return;
    }

    // A pre-sales deal gets a pre-sales task — a different model, different
    // endpoint, and an hours budget the CRM enforces.
    if (this.isPreSalesTarget) {
      this.savePreSalesTask();
      return;
    }

    this.isSavingTask.set(true);
    this.tasksService.createTask({
      title: this.taskForm.title.trim(),
      description: this.taskForm.description || null,
      parentKind: this.taskForm.parentKind,
      projectId: this.taskForm.parentKind === 'PROJECT' ? Number(this.taskForm.projectId) : undefined,
      leadId: this.taskForm.parentKind === 'LEAD' ? Number(this.taskForm.leadId) : undefined,
      taskTypeId: this.taskForm.taskTypeId ? Number(this.taskForm.taskTypeId) : undefined,
      phaseId: this.taskForm.phaseId ? Number(this.taskForm.phaseId) : undefined,
      priority: this.taskForm.priority,
      startDate: this.taskForm.startDate || undefined,
      dueDate: this.taskForm.dueDate || undefined,
      estimatedHours: this.taskForm.estimatedHours != null && this.taskForm.estimatedHours !== ''
        ? Number(this.taskForm.estimatedHours) : undefined,
      assigneeIds: this.taskForm.assigneeIds,
      attachments: this.taskForm.attachments?.length ? this.taskForm.attachments : undefined,
    }).subscribe({
      next: (created: any) => {
        this.isSavingTask.set(false);
        this.isCreateTaskOpen.set(false);
        this.toast.success(`${created?.key || 'Task'} created`);
        this.loadMyTasks();
      },
      error: (err) => {
        this.isSavingTask.set(false);
        this.toast.error(err?.error?.message || 'Could not create the task.');
      },
    });
  }

  // ── My Tasks ─────────────────────────────────────────────────────────────

  myTasksFilter = signal<'all' | 'overdue' | 'due-week' | 'PROJECT' | 'PRE_SALES' | 'GENERAL'>('all');

  setMyTasksFilter(filter: 'all' | 'overdue' | 'due-week' | 'PROJECT' | 'PRE_SALES' | 'GENERAL') {
    this.myTasksFilter.set(filter);
  }

  /**
   * The administrator's company-wide view.
   *
   * Without it an admin with nothing assigned to them opened this screen onto
   * "No tasks assigned to you" while the company had open work everywhere.
   */
  setMyTasksScope(scope: TaskScope) {
    if (this.myTasksScope() === scope) return;
    this.userExplicitlyToggledScope = true;
    this.myTasksScope.set(scope);
    this.loadMyTasks();
  }

  loadMyTasks() {
    this.myTasksLoading.set(true);
    this.tasksService.getMyTasks({
      includeDone: this.myTasksShowDone(),
      scope: this.myTasksScope(),
    }).subscribe({
      next: (res) => {
        this.myTasks.set(res.items || []);
        this.myTasksTruncated.set(!!res.truncated);
        // What the server gave us, not what we asked for.
        if (res.scope) this.myTasksScope.set(res.scope);
        this.myTasksLoading.set(false);
        this.myTasksLoaded.set(true);
      },
      error: () => {
        this.myTasks.set([]);
        this.myTasksLoading.set(false);
        this.myTasksLoaded.set(true);
      },
    });
  }

  toggleMyTasksDone() {
    this.myTasksShowDone.set(!this.myTasksShowDone());
    this.loadMyTasks();
  }

  myTasksCount = computed(() => this.myTasks().length);
  myTasksOverdueCount = computed(() => this.myTasks().filter((t) => t.isOverdue).length);
  myTasksBlockedCount = computed(() => this.myTasks().filter((t) => t.blockedBy?.length).length);
  myTasksDueWeekCount = computed(() => {
    const now = new Date();
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    return this.myTasks().filter((t) => {
      if (!t.dueDate) return false;
      const d = new Date(t.dueDate);
      return d >= now && d <= nextWeek;
    }).length;
  });
  myTasksProjectCount = computed(() => this.myTasks().filter((t) => t.source === 'PROJECT').length);
  myTasksPreSalesCount = computed(() => this.myTasks().filter((t) => t.source === 'PRE_SALES').length);
  myTasksGeneralCount = computed(() => this.myTasks().filter((t) => t.source === 'GENERAL').length);

  // ── §17 Task filters ───────────────────────────────────────────────────
  // Sit alongside the quick chips rather than replacing them: the chips answer
  // "what needs me today", these answer "find the thing I am thinking of".
  taskFiltersOpen = signal<boolean>(false);
  tfProject = signal<string>('ALL');
  tfProjectCode = signal<string>('ALL');
  tfAssignee = signal<string>('ALL');
  tfStatus = signal<string>('ALL');
  tfPriority = signal<string>('ALL');

  tfMilestone = signal<string>('ALL');
  /** §8: narrow My Tasks to one delivery phase. */
  tfPhase = signal<string>('ALL');
  tfDueFrom = signal<string>('');
  tfDueTo = signal<string>('');
  tfDuration = signal<string>('ALL');

  // Dropdown states for searchable filter selects
  tfAssigneeDropdownOpen = signal<boolean>(false);
  tfAssigneeSearchQuery = signal<string>('');
  tfProjectDropdownOpen = signal<boolean>(false);
  tfProjectSearchQuery = signal<string>('');
  tfProjectCodeDropdownOpen = signal<boolean>(false);
  tfProjectCodeSearchQuery = signal<string>('');

  readonly taskStatusOptions = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'DONE', 'CANCELLED'] as const;
  readonly taskDurationOptions = ['Today', 'Last 30 Days', 'This Month', 'Last Month', 'Last 90 Days', 'Last 6 Months', 'Last 1 Year'] as const;

  /**
   * Options come from the tasks on screen, not from master data: offering a
   * project or a person with nothing in the list produces a choice that can
   * only ever return an empty table.
   */
  private taskOptionsFrom(pick: (t: MyTask) => string | null | undefined): string[] {
    const seen = new Set<string>();
    for (const t of this.myTasks()) {
      const v = pick(t);
      if (v) seen.add(String(v));
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }

  taskProjectOptions = computed(() => this.taskOptionsFrom(t => t.parent?.name));
  taskCodeOptions = computed(() => this.taskOptionsFrom(t => t.projectCode));
  taskTypeOptions = computed(() => this.taskOptionsFrom(t => t.taskType));
  taskMilestoneOptions = computed(() => this.taskOptionsFrom(t => t.milestone?.name));
  // §8: only phases actually present, so no option returns nothing.
  taskPhaseOptions = computed(() => this.taskOptionsFrom(t => t.phase));
  taskPriorityOptions = computed(() => this.taskOptionsFrom(t => t.priority));

  taskAssigneeList = computed(() => {
    const byId = new Map<number, { id: number; name: string; email?: string; avatarUrl?: string | null }>();
    for (const t of this.myTasks()) {
      for (const a of t.assignees || []) {
        if (!byId.has(a.id)) {
          const emp = this.employees().find((e: any) => e.id === a.id);
          const fullName = `${a.firstName || emp?.firstName || ''} ${a.lastName || emp?.lastName || ''}`.trim() || `User #${a.id}`;
          const avatarUrl = a.avatarUrl || emp?.avatarUrl || emp?.profilePicture || null;
          const email = emp?.email || emp?.user?.email || '';
          byId.set(a.id, { id: a.id, name: fullName, email, avatarUrl });
        }
      }
    }
    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
  });

  taskAssigneeOptions = computed(() => {
    return this.taskAssigneeList().map(u => ({ id: u.id, name: u.name }));
  });

  filteredTfAssignees = computed(() => {
    const q = this.tfAssigneeSearchQuery().toLowerCase().trim();
    const list = this.taskAssigneeList();
    if (!q) return list;
    return list.filter(u => u.name.toLowerCase().includes(q) || (u.email && u.email.toLowerCase().includes(q)));
  });

  filteredTfProjects = computed(() => {
    const q = this.tfProjectSearchQuery().toLowerCase().trim();
    const list = this.taskProjectOptions();
    if (!q) return list;
    return list.filter(p => p.toLowerCase().includes(q));
  });

  filteredTfProjectCodes = computed(() => {
    const q = this.tfProjectCodeSearchQuery().toLowerCase().trim();
    const list = this.taskCodeOptions();
    if (!q) return list;
    return list.filter(c => c.toLowerCase().includes(q));
  });

  getSelectedTaskAssignee(): { id: number; name: string; email?: string; avatarUrl?: string | null } | null {
    const selId = this.tfAssignee();
    if (!selId || selId === 'ALL') return null;
    return this.taskAssigneeList().find(a => String(a.id) === selId) || null;
  }

  selectTfAssignee(id: string | number) {
    this.tfAssignee.set(String(id));
    this.tfAssigneeDropdownOpen.set(false);
    this.tfAssigneeSearchQuery.set('');
  }

  selectTfProject(p: string) {
    this.tfProject.set(p);
    this.tfProjectDropdownOpen.set(false);
    this.tfProjectSearchQuery.set('');
  }

  selectTfProjectCode(c: string) {
    this.tfProjectCode.set(c);
    this.tfProjectCodeDropdownOpen.set(false);
    this.tfProjectCodeSearchQuery.set('');
  }

  closeTaskFilterDropdowns() {
    this.tfAssigneeDropdownOpen.set(false);
    this.tfProjectDropdownOpen.set(false);
    this.tfProjectCodeDropdownOpen.set(false);
  }

  clearAndCloseTaskFilters() {
    this.clearTaskFilters();
    this.closeTaskFilterDropdowns();
    this.taskFiltersOpen.set(false);
  }

  getUserInitials(name: string): string {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }

  activeTaskFilterCount = computed(() =>
    [
      this.tfProject(), this.tfProjectCode(), this.tfAssignee(),
      this.tfStatus(), this.tfPriority(), this.tfMilestone(), this.tfPhase(),
      this.tfDuration()
    ].filter(v => v !== 'ALL').length
    + (this.tfDueFrom() ? 1 : 0)
    + (this.tfDueTo() ? 1 : 0)
  );

  clearTaskFilters() {
    this.tfProject.set('ALL');
    this.tfProjectCode.set('ALL');
    this.tfAssignee.set('ALL');
    this.tfStatus.set('ALL');
    this.tfPriority.set('ALL');
    this.tfMilestone.set('ALL');
    this.tfPhase.set('ALL');
    this.tfDuration.set('ALL');
    this.tfDueFrom.set('');
    this.tfDueTo.set('');
  }

  private applyTaskFilters(list: MyTask[]): MyTask[] {
    const project = this.tfProject();
    const code = this.tfProjectCode();
    const assignee = this.tfAssignee();
    const status = this.tfStatus();
    const priority = this.tfPriority();
    const milestone = this.tfMilestone();
    const phase = this.tfPhase();
    const duration = this.tfDuration();
    const dueFrom = this.tfDueFrom();
    const dueTo = this.tfDueTo();

    return list.filter(t => {
      if (project !== 'ALL' && (t.parent?.name || '') !== project) return false;
      if (code !== 'ALL' && (t.projectCode || '') !== code) return false;
      if (status !== 'ALL' && t.status !== status) return false;
      if (priority !== 'ALL' && (t.priority || '') !== priority) return false;
      if (milestone !== 'ALL' && (t.milestone?.name || '') !== milestone) return false;
      if (phase !== 'ALL' && (t.phase || '') !== phase) return false;

      if (assignee !== 'ALL') {
        const has = (t.assignees || []).some((a: any) => String(a.id) === assignee);
        if (!has) return false;
      }

      if (duration !== 'ALL') {
        if (!t.dueDate) return false;
        const taskDate = new Date(t.dueDate);
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        let fd: Date | null = null;
        let td: Date | null = null;

        if (duration === 'Today') {
          fd = new Date(now);
          td = new Date(now);
          td.setHours(23, 59, 59, 999);
        } else if (duration === 'Last 30 Days') {
          fd = new Date(now);
          fd.setDate(fd.getDate() - 30);
          td = new Date(now);
          td.setHours(23, 59, 59, 999);
        } else if (duration === 'This Month') {
          fd = new Date(now.getFullYear(), now.getMonth(), 1);
          td = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
        } else if (duration === 'Last Month') {
          fd = new Date(now.getFullYear(), now.getMonth() - 1, 1);
          td = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
        } else if (duration === 'Last 90 Days') {
          fd = new Date(now);
          fd.setDate(fd.getDate() - 90);
          td = new Date(now);
          td.setHours(23, 59, 59, 999);
        } else if (duration === 'Last 6 Months') {
          fd = new Date(now);
          fd.setMonth(fd.getMonth() - 6);
          td = new Date(now);
          td.setHours(23, 59, 59, 999);
        } else if (duration === 'Last 1 Year') {
          fd = new Date(now);
          fd.setFullYear(fd.getFullYear() - 1);
          td = new Date(now);
          td.setHours(23, 59, 59, 999);
        }

        if (fd && td && (taskDate < fd || taskDate > td)) return false;
      }

      // A task with no due date is not "due before X", so it drops out of a
      // date-bounded search rather than quietly passing it.
      if (dueFrom && (!t.dueDate || new Date(t.dueDate) < new Date(dueFrom))) return false;
      if (dueTo && (!t.dueDate || new Date(t.dueDate) > new Date(dueTo))) return false;

      return true;
    });
  }

  filteredMyTasks = computed(() => {
    let list = this.myTasks();
    const filter = this.myTasksFilter();
    if (filter === 'overdue') {
      list = list.filter((t) => t.isOverdue);
    } else if (filter === 'due-week') {
      const now = new Date();
      const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      list = list.filter((t) => {
        if (!t.dueDate) return false;
        const d = new Date(t.dueDate);
        return d >= now && d <= nextWeek;
      });
    } else if (filter === 'PROJECT' || filter === 'PRE_SALES' || filter === 'GENERAL') {
      list = list.filter((t) => t.source === filter);
    }

    const q = this.searchQuery().toLowerCase().trim();
    if (q) {
      list = list.filter((t) =>
        (t.title || '').toLowerCase().includes(q) ||
        (t.refKey || '').toLowerCase().includes(q) ||
        (t.parent?.name || '').toLowerCase().includes(q) ||
        (t.taskType || '').toLowerCase().includes(q) ||
        (t.assignees || []).some((a: any) =>
          `${a.firstName || ''} ${a.lastName || ''}`.toLowerCase().includes(q)
        )
      );
    }
    return this.applyTaskFilters(list);
  });

  /**
   * Where a row goes depends on what it actually is, and the server already
   * decided — see MyTaskDto.link. Routing rules per source in one place.
   */
  onMyTaskRowClicked(event: any) {
    const task: MyTask = event?.data;
    if (!task) return;

    // The action buttons are rendered inside the row, so a click on one of
    // them arrives here as a row click too. Whichever was hit wins; only a
    // click on the row itself falls through to navigation.
    const hit = (event.event?.target as HTMLElement | undefined)?.closest?.('[data-act]') as HTMLElement | null;
    const act = hit?.getAttribute('data-act');
    if (act) {
      if (act === 'status') this.openPreSalesStatus(task, hit!.getAttribute('data-status') || 'WORKING');
      else if (act === 'history') this.openPreSalesHistory(task);
      else if (act === 'edit') this.openEditPreSalesTask(task);
      else if (act === 'delete') this.deletePreSalesTask(task);
      return;
    }

    // A pre-sales task is worked from this screen now, so its row opens its
    // trail rather than navigating to a page that no longer lists it.
    if (task.source === 'PRE_SALES') {
      this.openPreSalesHistory(task);
      return;
    }
    if (!task.link) return;
    this.router.navigate([task.link.route], { queryParams: task.link.queryParams });
  }

  // ── Pre-sales tasks ──────────────────────────────────────────────────────
  //
  // A pre-sales task used to be created and driven from the deal page. That
  // table has moved here, so everything it could do has to live here too:
  // raising one, editing it, walking it through NEW → WORKING → ON HOLD →
  // COMPLETED, reading its history, and deleting it.
  //
  // It is NOT an Issue. It is assigned within a deal's pre-sales team and it
  // spends that person's hours budget, both enforced by the CRM — so it keeps
  // its own model and its own endpoints, and the composer changes shape when
  // the chosen deal turns out to be a pre-sales engagement.

  /**
   * Ringed when a notification links straight to one row.
   *
   * A plain field, not a signal: it is read from inside an ag-Grid row-class
   * callback, which runs during the grid's own render pass, and a signal read
   * there ties grid rendering to Angular's reactive graph for no benefit — the
   * value is set once, before any rows exist.
   */
  highlightedPreSalesTaskId: number | null = null;

  /** The chosen deal's team and permissions, loaded when a deal is picked. */
  preSalesInfo = signal<PreSalesInfo | null>(null);
  preSalesInfoLoading = signal<boolean>(false);
  editingPreSalesTaskId = signal<number | null>(null);

  /**
   * True when what is being raised is a pre-sales task rather than an issue.
   *
   * Decided by the deal, not by a fourth tab in the picker: the dropdown
   * already separates "Pre-Sales Deals" from "Sales Opportunities", and asking
   * someone to state twice which kind of thing they just chose is a question
   * with only one right answer. A plain getter rather than a computed because
   * taskForm is an object, not a signal.
   */
  get isPreSalesTarget(): boolean {
    if (this.taskForm.parentKind !== 'LEAD' || !this.taskForm.leadId) return false;
    return this.getSelectedLead()?.flow === 'PRE_SALES';
  }

  /** Only ACTIVE members may be given a task — the server refuses the rest. */
  activePreSalesMembers(): any[] {
    return (this.preSalesInfo()?.members || []).filter((m: any) => m.status === 'ACTIVE');
  }

  /** Server-decided, never inferred from the role here. */
  get canCreatePreSalesTask(): boolean {
    return this.preSalesInfo()?.permissions?.canCreateTasks === true;
  }

  /**
   * Who this task may go to. For a pre-sales deal that is the deal's own team;
   * for anything else it is everybody.
   */
  taskAssigneeCandidates(): any[] {
    if (!this.isPreSalesTarget) return this.employees();
    return this.activePreSalesMembers().map((m: any) => ({
      ...(m.employee || {}),
      id: m.employeeId,
    }));
  }

  filteredTaskAssignees(): any[] {
    const q = this.assigneeSearch().toLowerCase().trim();
    const list = this.taskAssigneeCandidates();
    if (!q) return list;
    return list.filter((e: any) =>
      `${e.firstName || ''} ${e.lastName || ''}`.toLowerCase().includes(q) ||
      (e.designation?.name || '').toLowerCase().includes(q) ||
      (e.department?.name || '').toLowerCase().includes(q) ||
      (e.user?.email || '').toLowerCase().includes(q)
    );
  }

  /** Reopen the composer on an existing pre-sales task. */
  openEditPreSalesTask(task: MyTask) {
    if (!task.preSales) return;
    this.taskForm = this.blankTaskForm();
    this.taskForm.parentKind = 'LEAD';
    this.taskForm.leadId = task.preSales.leadId;
    this.taskForm.title = task.title || '';
    this.taskForm.description = task.preSales.description || '';
    this.taskForm.assigneeIds = task.preSales.assignedToId ? [task.preSales.assignedToId] : [];
    if (task.preSales.scheduledAt) {
      const when = new Date(task.preSales.scheduledAt);
      this.taskForm.dueDate = this.toDateInput(when);
      this.taskForm.dueTime = when.toTimeString().slice(0, 5);
    }
    if (task.preSales.estimatedMinutes != null) {
      this.taskForm.estimatedHours = Math.round((task.preSales.estimatedMinutes / 60) * 100) / 100;
    }
    const matchedType = this.taskTypes().find((t) => t.name === task.taskType);
    this.taskForm.taskTypeId = matchedType?.id ?? null;

    this.editingPreSalesTaskId.set(task.id);
    this.assigneeSearch.set('');
    this.closeAllTaskDropdowns();
    this.isCreateTaskOpen.set(true);
    this.ensureTaskPickerData();
    this.loadPreSalesInfoFor(task.preSales.leadId);
  }

  /** A date input wants local YYYY-MM-DD; toISOString would shift the day. */
  private toDateInput(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  /**
   * `expectAssigneeId` is the person a deal page pre-selected. It is checked
   * against the team once the team is known — someone taken off the deal since
   * that page was last loaded would otherwise sit in the form as a chip and come
   * back as a 400 on save.
   */
  private loadPreSalesInfoFor(leadId: number, expectAssigneeId: number | null = null) {
    this.preSalesInfo.set(null);
    this.preSalesInfoLoading.set(true);
    this.tasksService.getPreSalesInfo(leadId).subscribe({
      next: (info) => {
        this.preSalesInfo.set(info);
        this.preSalesInfoLoading.set(false);
        if (expectAssigneeId && !this.activePreSalesMembers().some((m: any) => m.employeeId === expectAssigneeId)) {
          this.taskForm.assigneeIds = [];
          this.toast.error('That person is no longer on this deal\u2019s pre-sales team. Choose someone else.');
        }
      },
      error: () => {
        this.preSalesInfo.set(null);
        this.preSalesInfoLoading.set(false);
      },
    });
  }

  /**
   * Save the composer as a pre-sales task.
   *
   * Duration goes over as minutes: the CRM stores minutes and the budget is
   * checked in minutes, so rounding here once beats rounding in two places.
   */
  private savePreSalesTask() {
    const leadId = Number(this.taskForm.leadId);
    const assignedToId = (this.taskForm.assigneeIds as number[])[0];
    if (!assignedToId) {
      this.toast.error('Choose the pre-sales specialist this task is for.');
      return;
    }
    if (this.isUploadingAttachment()) {
      this.toast.error('Wait for the attachments to finish uploading.');
      return;
    }

    const hours = this.taskForm.estimatedHours;
    const payload: any = {
      title: this.taskForm.title.trim(),
      description: this.taskForm.description || '',
      taskType: this.getSelectedTaskType()?.name || '',
      assignedToId,
      scheduledDate: this.taskForm.dueDate || '',
      scheduledTime: this.taskForm.dueTime || '',
      estimatedMinutes: hours != null && hours !== '' ? Math.round(Number(hours) * 60) : null,
    };
    const editingId = this.editingPreSalesTaskId();
    // The CRM only takes attachments when the task is raised; on an edit they
    // are attached through a status change instead.
    if (!editingId && this.taskForm.attachments?.length) {
      payload.attachments = this.taskForm.attachments;
    }

    this.isSavingTask.set(true);
    const request = editingId
      ? this.tasksService.updatePreSalesTask(leadId, editingId, payload)
      : this.tasksService.createPreSalesTask(leadId, payload);

    request.subscribe({
      next: () => {
        this.isSavingTask.set(false);
        this.isCreateTaskOpen.set(false);
        this.editingPreSalesTaskId.set(null);
        this.toast.success(editingId ? 'Pre-sales task updated' : 'Pre-sales task created');
        this.loadMyTasks();
      },
      error: (err) => {
        this.isSavingTask.set(false);
        this.toast.error(err?.error?.message || 'Could not save the pre-sales task.');
      },
    });
  }

  // ── pre-sales status ─────────────────────────────────────────────────────

  isPreSalesStatusOpen = signal<boolean>(false);
  preSalesStatusTask = signal<MyTask | null>(null);
  preSalesStatusForm: { status: string; remark: string; attachments: any[] } =
    { status: 'WORKING', remark: '', attachments: [] };
  isSavingPreSalesStatus = signal<boolean>(false);
  uploadingPreSalesFiles = signal<number>(0);

  /** Which moves this task can make next. COMPLETED is terminal. */
  nextPreSalesStatuses(task: MyTask | null): string[] {
    switch (String(task?.rawStatus || 'NEW')) {
      case 'NEW': return ['WORKING'];
      case 'WORKING': return ['ON_HOLD', 'COMPLETED'];
      case 'ON_HOLD': return ['WORKING', 'COMPLETED'];
      default: return [];
    }
  }

  preSalesStatusLabel(status: string): string {
    return status === 'WORKING' ? 'Start' : status === 'ON_HOLD' ? 'Hold' : 'Complete';
  }

  preSalesStatusHeading(status: string): string {
    return status === 'WORKING' ? 'Start working on this task'
      : status === 'ON_HOLD' ? 'Put this task on hold'
      : 'Mark this task as completed';
  }

  /** Required for ON_HOLD and COMPLETED — the server insists too. */
  get preSalesRemarkRequired(): boolean {
    return this.preSalesStatusForm.status === 'ON_HOLD' || this.preSalesStatusForm.status === 'COMPLETED';
  }

  openPreSalesStatus(task: MyTask, status: string) {
    this.preSalesStatusTask.set(task);
    this.preSalesStatusForm = { status, remark: '', attachments: [] };
    this.uploadingPreSalesFiles.set(0);
    this.isPreSalesStatusOpen.set(true);
  }

  closePreSalesStatus() {
    if (this.isSavingPreSalesStatus()) return;
    this.isPreSalesStatusOpen.set(false);
    this.preSalesStatusTask.set(null);
  }

  onPreSalesStatusFilesSelected(event: any) {
    const files: File[] = Array.from(event.target?.files || []);
    event.target.value = '';
    for (const file of files) {
      this.uploadingPreSalesFiles.update((n) => n + 1);
      this.uploadService.uploadFile(file).subscribe({
        next: (res: any) => {
          const url = res?.url || res?.fileUrl;
          if (url) {
            this.preSalesStatusForm.attachments = [
              ...this.preSalesStatusForm.attachments,
              { fileName: file.name, fileUrl: url, fileSize: file.size },
            ];
          }
          this.uploadingPreSalesFiles.update((n) => n - 1);
        },
        error: () => {
          this.uploadingPreSalesFiles.update((n) => n - 1);
          this.toast.error(`Failed to upload "${file.name}"`);
        },
      });
    }
  }

  savePreSalesStatus() {
    const task = this.preSalesStatusTask();
    if (!task?.preSales) return;
    if (this.preSalesRemarkRequired && !this.preSalesStatusForm.remark.trim()) {
      this.toast.error(this.preSalesStatusForm.status === 'ON_HOLD'
        ? 'Say why the task is on hold.'
        : 'Add a completion remark before marking the task complete.');
      return;
    }
    if (this.uploadingPreSalesFiles() > 0) {
      this.toast.error('Wait for the attachments to finish uploading.');
      return;
    }

    this.isSavingPreSalesStatus.set(true);
    this.tasksService.changePreSalesTaskStatus(task.preSales.leadId, task.id, this.preSalesStatusForm)
      .subscribe({
        next: () => {
          this.isSavingPreSalesStatus.set(false);
          this.isPreSalesStatusOpen.set(false);
          this.preSalesStatusTask.set(null);
          this.toast.success('Task updated');
          this.loadMyTasks();
        },
        error: (err) => {
          this.isSavingPreSalesStatus.set(false);
          this.toast.error(err?.error?.message || 'Could not update the task.');
        },
      });
  }

  // ── pre-sales history ────────────────────────────────────────────────────

  isPreSalesHistoryOpen = signal<boolean>(false);
  preSalesHistoryTask = signal<MyTask | null>(null);
  preSalesHistory = signal<PreSalesTaskHistoryEntry[]>([]);
  preSalesHistoryLoading = signal<boolean>(false);

  openPreSalesHistory(task: MyTask) {
    if (!task.preSales) return;
    this.preSalesHistoryTask.set(task);
    this.preSalesHistory.set([]);
    this.preSalesHistoryLoading.set(true);
    this.isPreSalesHistoryOpen.set(true);
    this.tasksService.getPreSalesTaskHistory(task.preSales.leadId, task.id).subscribe({
      next: (rows) => {
        this.preSalesHistory.set(rows || []);
        this.preSalesHistoryLoading.set(false);
      },
      error: () => {
        this.preSalesHistoryLoading.set(false);
        this.toast.error('Could not load the task history.');
      },
    });
  }

  closePreSalesHistory() {
    this.isPreSalesHistoryOpen.set(false);
    this.preSalesHistoryTask.set(null);
  }

  preSalesStatusClass(status: string): string {
    return 'ps-status-' + String(status || 'NEW').toLowerCase().replace('_', '-');
  }

  preSalesStatusWord(status: string): string {
    return String(status || 'NEW').replace('_', ' ');
  }

  personName(p: any): string {
    return `${p?.firstName || ''} ${p?.lastName || ''}`.trim() || '—';
  }

  // ── deleting ─────────────────────────────────────────────────────────────

  /** Deleting removes the task and its history; completing keeps the record. */
  async deletePreSalesTask(task: MyTask) {
    if (!task.preSales) return;
    const ok = await this.dialog.confirm(
      `Delete "${task.title}"? Its status history and attachments go with it.`,
      'Delete task', 'Delete', 'Cancel',
    );
    if (!ok) return;
    this.tasksService.deletePreSalesTask(task.preSales.leadId, task.id).subscribe({
      next: () => {
        this.toast.success('Task deleted');
        this.loadMyTasks();
      },
      error: (err) => this.toast.error(err?.error?.message || 'Could not delete the task.'),
    });
  }

  /** Escapes text bound for a raw-HTML ag-Grid cell. */
  private esc(v: any): string {
    return String(v ?? '').replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c]);
  }

  /**
   * Whether the grid can size itself to its rows.
   *
   * ag-Grid's 'normal' layout fills its container, and this wrapper has no
   * height of its own — so a list long enough to leave 'autoHeight' collapsed
   * to nothing but a pagination bar. Ten rows was never enough to notice; the
   * administrator's company-wide view, at two hundred, is.
   */
  myTasksGridAutoHeight = computed(() => this.filteredMyTasks().length <= 10);

  myTasksGridApi: any = null;

  onMyTasksGridReady(params: any) {
    this.myTasksGridApi = params.api;
    setTimeout(() => {
      params.api.sizeColumnsToFit();
      const scrollContainer = document.querySelector('.my-tasks-grid .ag-body-horizontal-scroll-viewport');
      if (scrollContainer) (scrollContainer as HTMLElement).scrollLeft = 0;
    }, 50);
  }

  myTasksDefaultColDef: ColDef = {
    sortable: true,
    filter: false,
    resizable: true,
  };

  /** Tints each row by status so the queue is scannable at a glance, exactly like CRM tickets. */
  myTasksRowClassRules = {
    // The row a pre-sales assignment notification pointed at.
    'row-linked': (p: any) =>
      p.data?.source === 'PRE_SALES' && p.data?.id === this.highlightedPreSalesTaskId,
    'row-status-open':        (p: any) => p.data?.status === 'TODO' || p.data?.status === 'OPEN',
    'row-status-in-progress': (p: any) => p.data?.status === 'IN_PROGRESS' || p.data?.status === 'IN_REVIEW',
    'row-status-resolved':    (p: any) => p.data?.status === 'DONE' || p.data?.status === 'RESOLVED',
    'row-status-closed':      (p: any) => p.data?.status === 'CANCELLED' || p.data?.status === 'CLOSED',
    'row-status-rejected':    (p: any) => p.data?.status === 'BLOCKED' || (p.data?.isOverdue && p.data?.status !== 'DONE' && p.data?.status !== 'CANCELLED'),
  };

  myTasksColDefs: ColDef[] = [
    {
      field: 'refKey',
      headerName: 'REF',
      width: 120,
      minWidth: 110,
      maxWidth: 140,
      pinned: 'left',
      cellRenderer: (p: any) => `<span class="ticket-num-badge" title="${this.esc(p.value)}">${this.esc(p.value || '—')}</span>`,
    },
    {
      field: 'title',
      headerName: 'TITLE & TYPE',
      flex: 1,
      minWidth: 220,
      maxWidth: 380,
      cellRenderer: (p: any) => {
        const typeKey = (p.data?.taskType || 'TASK').toUpperCase();
        const typeLabel = this.esc(p.data?.taskType || 'Task');
        let typeBadgeClass = 'type-improvement';
        if (typeKey.includes('BUG')) typeBadgeClass = 'type-bug';
        else if (typeKey.includes('FEATURE')) typeBadgeClass = 'type-feature';
        else if (typeKey.includes('QUESTION') || typeKey.includes('CALL')) typeBadgeClass = 'type-question';
        else if (typeKey.includes('ATTENDANCE')) typeBadgeClass = 'type-attendance';

        const blockers = p.data?.blockedBy?.length
          ? `<span class="type-pill type-bug" style="margin-left:4px;" title="Blocked by ${this.esc(p.data.blockedBy.map((b: any) => b.refKey).join(', '))}">BLOCKED BY ${p.data.blockedBy.length}</span>`
          : '';

        return `
          <div class="cell-ticket-title-wrapper">
            <div class="cell-title-text" title="${this.esc(p.value || '')}">${this.esc(p.value || '')}</div>
            <div class="cell-meta-row">
              <span class="type-pill ${typeBadgeClass}">${typeLabel}</span>
              ${blockers}
            </div>
          </div>
        `;
      },
    },
    {
      field: 'source',
      headerName: 'SOURCE',
      width: 100,
      minWidth: 95,
      maxWidth: 115,
      cellRenderer: (p: any) => {
        const val = (p.value || 'GENERAL').toUpperCase();
        let cls = 'platform-web';
        let label = 'GENERAL';
        if (val === 'PROJECT') { cls = 'platform-web'; label = 'PROJECT'; }
        else if (val === 'PRE_SALES') { cls = 'platform-mobile'; label = 'PRE-SALES'; }
        else if (val === 'GENERAL') { cls = 'platform-both'; label = 'GENERAL'; }
        return `<span class="platform-tag ${cls}">${label}</span>`;
      },
    },
    {
      colId: 'belongsTo',
      headerName: 'BELONGS TO',
      width: 170,
      minWidth: 150,
      valueGetter: (p: any) => p.data?.parent?.name ?? '—',
      cellRenderer: (p: any) => `<span class="dept-cell" title="${this.esc(p.value)}">${this.esc(p.value || '—')}</span>`,
    },
    {
      field: 'priority',
      headerName: 'PRIORITY',
      width: 110,
      minWidth: 110,
      cellRenderer: (p: any) => {
        const raw = String(p.value || 'LOW').toUpperCase();
        const dotColors: Record<string, string> = {
          CRITICAL: '#dc2626',
          HIGH: '#ea580c',
          MEDIUM: '#d97706',
          LOW: '#94a3b8',
        };
        const dotColor = dotColors[raw] || '#94a3b8';
        const cls = `priority-${raw.toLowerCase()}`;
        return `<span class="priority-pill ${cls}"><span class="priority-dot" style="background-color: ${dotColor};"></span>${raw}</span>`;
      },
    },
    {
      field: 'status',
      headerName: 'STATUS',
      width: 125,
      minWidth: 125,
      cellRenderer: (p: any) => {
        const raw = String(p.value || 'TODO').toUpperCase();
        const statusMap: Record<string, { cls: string; label: string }> = {
          TODO:        { cls: 'status-open', label: 'OPEN' },
          OPEN:        { cls: 'status-open', label: 'OPEN' },
          IN_PROGRESS: { cls: 'status-in-progress', label: 'IN PROGRESS' },
          IN_REVIEW:   { cls: 'status-in-progress', label: 'IN REVIEW' },
          DONE:        { cls: 'status-resolved', label: 'RESOLVED' },
          RESOLVED:    { cls: 'status-resolved', label: 'RESOLVED' },
          CLOSED:      { cls: 'status-closed', label: 'CLOSED' },
          CANCELLED:   { cls: 'status-closed', label: 'CLOSED' },
          BLOCKED:     { cls: 'status-rejected', label: 'BLOCKED' },
          REJECTED:    { cls: 'status-rejected', label: 'REJECTED' },
        };
        const s = statusMap[raw] || { cls: 'status-open', label: raw.replace(/_/g, ' ') };
        return `<span class="status-pill ${s.cls}"><span class="status-indicator-dot"></span>${s.label}</span>`;
      },
    },
    {
      field: 'dueDate',
      headerName: 'DEADLINE',
      width: 120,
      minWidth: 115,
      cellRenderer: (p: any) => {
        if (!p.value) return '<span style="color:#94a3b8;">—</span>';
        const d = new Date(p.value);
        const str = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        if (p.data?.isOverdue && p.data?.status !== 'DONE' && p.data?.status !== 'CANCELLED') {
          return `<span style="color: #dc2626; font-weight: 700; font-size: 12px;">${str}</span>`;
        }
        return `<span style="color: #475569; font-size: 12.5px; font-weight: 500;">${str}</span>`;
      },
    },
    {
      field: 'assignee',
      headerName: 'ASSIGNEE',
      width: 155,
      minWidth: 155,
      sortable: false,
      cellRenderer: (p: any) => {
        const assignees: any[] = p.data?.assignees || [];
        if (!assignees.length) {
          return `<div class="user-cell unassigned"><span class="avatar-circle neutral">?</span><span class="user-name-text">Unassigned</span></div>`;
        }
        if (assignees.length === 1) {
          const a = assignees[0];
          const name = `${a.firstName || ''} ${a.lastName || ''}`.trim();
          const initials = ((a.firstName?.[0] || '') + (a.lastName?.[0] || '')).toUpperCase() || '?';
          const avatarHtml = a.avatarUrl
            ? `<img class="avatar-img" src="${this.esc(a.avatarUrl)}" alt="" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';" /><span class="avatar-circle" style="display:none;">${initials}</span>`
            : `<span class="avatar-circle">${initials}</span>`;
          return `
            <div class="user-cell" title="${this.esc(name)}">
              ${avatarHtml}
              <div class="user-info">
                <span class="user-name-text">${this.esc(name)}</span>
              </div>
            </div>
          `;
        }
        const visible = assignees.slice(0, 3);
        const extra = assignees.length - 3;
        const stack = visible.map((a, i) => {
          const ml = i === 0 ? '0' : '-8px';
          const initials = ((a.firstName?.[0] || '') + (a.lastName?.[0] || '')).toUpperCase() || '?';
          return a.avatarUrl
            ? `<img class="avatar-img" src="${this.esc(a.avatarUrl)}" style="margin-left:${ml};z-index:${3-i};" alt="" />`
            : `<span class="avatar-circle" style="margin-left:${ml};z-index:${3-i};">${initials}</span>`;
        }).join('');
        const extraTag = extra > 0 ? `<span class="avatar-circle neutral" style="margin-left:-6px;font-size:9px;">+${extra}</span>` : '';
        return `<div class="user-cell"><div style="display:flex;align-items:center;">${stack}${extraTag}</div></div>`;
      }
    },
    {
      headerName: 'ACTIONS',
      // Wide enough for a pre-sales row, which carries its status moves as
      // well as its trail — everything the deal page used to offer.
      width: 210,
      minWidth: 190,
      sortable: false,
      filter: false,
      pinned: 'right',
      cellRenderer: (p: any) => {
        const task: MyTask = p.data;
        if (task?.source !== 'PRE_SALES') {
          return `<button class="btn-grid-action" title="View details"><svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg> <span>Details</span></button>`;
        }

        // Flags come from the server — see MyTaskDto.preSales. Rendering a
        // button the caller may not use only produces a 403 they cannot act on.
        const ps = task.preSales;
        const moves = ps?.canChangeStatus ? this.nextPreSalesStatuses(task) : [];
        const statusBtns = moves.map((st) =>
          `<button class="btn-grid-action ps-move ps-move-${st.toLowerCase().replace('_', '-')}" data-act="status" data-status="${st}" title="${this.esc(this.preSalesStatusHeading(st))}">${this.esc(this.preSalesStatusLabel(st))}</button>`,
        ).join('');

        const icon = (act: string, title: string, path: string, cls = '') =>
          `<button class="btn-grid-icon ${cls}" data-act="${act}" title="${this.esc(title)}"><svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg></button>`;

        const history = icon('history', 'Status history', '<path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/>');
        const manage = ps?.canManage
          ? icon('edit', 'Edit task', '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>')
            + icon('delete', 'Delete task', '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>', 'danger')
          : '';

        return `<div class="ps-row-actions">${statusBtns}${history}${manage}</div>`;
      },
    }
  ];

  loadStarredAndRecent() {
    try {
      const recent = localStorage.getItem('recently_viewed_board_ids');
      if (recent) this.recentlyViewedIds.set(JSON.parse(recent));
    } catch (e) {}
  }

  isLoading = signal<boolean>(true);

  loadProjects() {
    this.isLoading.set(true);
    this.projectsService.getProjects().subscribe({
      next: (res) => {
        this.projects.set(res);
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Error loading projects', err);
        this.isLoading.set(false);
      }
    });
  }

  toggleStar(projectId: number, event?: Event) {
    if (event) event.stopPropagation();
    const empId = this.currentUser()?.employeeId;

    // Call the backend service
    this.projectsService.toggleProjectStar(projectId).subscribe({
      next: () => {
        // Optimistically update local project state or reload projects
        this.projects.update(list => list.map(p => {
          if (p.id === projectId) {
            const myMember = this.myMemberOf(p);
            const updatedMembers = myMember
              ? p.members.map((m: any) => m.employeeId === empId ? { ...m, isStarred: !myMember.isStarred } : m)
              : [...(p.members || []), { employeeId: empId, isStarred: true }];
            return { ...p, members: updatedMembers };
          }
          return p;
        }));
      },
      error: (err) => console.error('Failed to toggle star', err)
    });
  }

  isStarred(projectId: number): boolean {
    const p = this.projects().find(proj => proj.id === projectId);
    return !!this.myMemberOf(p)?.isStarred;
  }

  getGradient(color: string, index: number): string {
    if (color) {
      if (color.startsWith('linear-gradient')) return color;
      if (color.startsWith('http') || color.startsWith('url')) return `url(${color})`;
    }
    return this.gradients[index % this.gradients.length];
  }

  selectBg(bg: string) {
    this.selectedBg.set(bg);
  }

  openCreateModal() {
    this.editingProjectId.set(null);
    this.projectForm = this.emptyProjectForm();
    this.stagedFiles.set([]);
    this.existingDocuments.set([]);
    this.cancelRename();
    this.selectedBg.set(this.colorBackgrounds[1]);
    this.isSubmitted.set(false);
    this.isCreateModalOpen.set(true);
  }

  openEditModal(project: any, event: Event) {
    if (event) event.stopPropagation();
    this.editingProjectId.set(project.id);
    // Files staged during an earlier Create must not follow the user into an
    // Edit of a different project — they would look attached and then upload
    // themselves to the wrong board.
    this.stagedFiles.set([]);
    this.cancelRename();
    this.loadExistingDocuments(project.id);
    this.projectForm = {
      ...this.emptyProjectForm(),
      name: project.name,
      description: project.description || '',
      startDate: project.startDate ? project.startDate.split('T')[0] : '',
      endDate: project.endDate ? project.endDate.split('T')[0] : '',
      billingType: project.billingType || 'NON_BILLABLE',
      budgetAmount: project.budgetAmount,
      hourlyRate: project.hourlyRate,
      clientId: project.clientId,
      leadContactId: project.leadContactId ?? project.leadContact?.id ?? null,
      pmIds: project.members?.filter((m: any) => m.role === 'PROJECT_MANAGER').map((m: any) => m.employeeId) || [],
      memberIds: project.members?.filter((m: any) => m.role === 'MEMBER').map((m: any) => m.employeeId) || [],
      address: project.address || '',
      category: project.category || '',
      priority: project.priority || 'MEDIUM',
      departmentId: project.department?.id ?? project.departmentId ?? null,
      workStatus: project.workStatus || 'ACTIVE',
      currency: project.currency || 'INR',
      budgetNotes: project.budgetNotes || '',
      estimatedHours: project.estimatedHours ?? null,
      allowManualTimeLogging: project.allowManualTimeLogging !== false
    };
    
    // Set the selected background (match it or use gradient as fallback)
    let color = project.color;
    if (color && color.startsWith('url(')) {
      color = color.substring(4, color.length - 1); // remove url()
    }
    this.selectedBg.set(color || this.colorBackgrounds[1]);
    
    this.isSubmitted.set(false);
    this.isCreateModalOpen.set(true);
  }

  closeCreateModal() {
    this.isCreateModalOpen.set(false);
    this.closeAllModalDropdowns();
    this.pmSearchQuery.set('');
    this.clientSearchQuery.set('');
    this.categorySearchQuery.set('');
    this.departmentSearchQuery.set('');
  }

  saveProject() {
    this.isSubmitted.set(true);
    if (!this.projectForm.name.trim()) return;

    if (this.isDateRangeInvalid()) {
      this.toast.error('Deadline must be equal to or after Start Date');
      return;
    }

    // Applies to edits as well as new projects. The server still only
    // enforces this on create, so an import or API caller is not blocked by
    // a rule that arrived after the data did — but a person going through
    // this form is expected to complete it.
    const missing = this.missingRequiredFields();
    if (missing.length) {
      this.toast.error(`${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} required`);
      this.focusFirstInvalidField();
      return;
    }

    const bgValue = this.selectedBg().startsWith('http') 
      ? `url(${this.selectedBg()})` 
      : this.selectedBg();

    const payload = {
      name: this.projectForm.name.trim(),
      description: this.projectForm.description,
      color: bgValue,
      startDate: this.projectForm.startDate || null,
      endDate: this.projectForm.endDate || null,
      billingType: this.projectForm.billingType,
      budgetAmount: this.projectForm.budgetAmount || null,
      hourlyRate: this.projectForm.hourlyRate || null,
      // The server turns this into clientId, reusing an existing client of the
      // same name. clientId is deliberately not sent: two sources for one
      // field is how they drift apart.
      leadContactId: this.projectForm.leadContactId || null,
      pmIds: this.projectForm.pmIds,
      memberIds: this.projectForm.memberIds,
      address: this.projectForm.address || null,
      category: this.projectForm.category || null,
      priority: this.projectForm.priority,
      departmentId: this.projectForm.departmentId || null,
      workStatus: this.projectForm.workStatus,
      currency: this.projectForm.currency,
      budgetNotes: this.projectForm.budgetNotes || null,
      estimatedHours: this.projectForm.estimatedHours || null,
      allowManualTimeLogging: this.projectForm.allowManualTimeLogging
    };

    if (this.editingProjectId()) {
      this.projectsService.updateProject(this.editingProjectId()!, payload).subscribe({
        next: () => {
          // Files staged while editing were previously dropped on the floor —
          // only the create path uploaded them.
          this.uploadStagedFiles(this.editingProjectId()!, () => {
            this.loadProjects();
            this.closeCreateModal();
          });
        },
        error: (err) => this.toast.error(err?.error?.message || 'Error updating project')
      });
    } else {
      this.projectsService.createProject(payload).subscribe({
        next: (res) => {
          this.loadProjects();
          // Files first, then navigate — landing on the board while uploads
          // are still in flight would show an Attachments tab that is missing
          // what the user just added.
          this.uploadStagedFiles(res.id, () => {
            this.closeCreateModal();
            this.goToProject(res.id);
          });
        },
        error: (err) => this.toast.error(err?.error?.message || 'Error creating project')
      });
    }
  }

  archiveBoard(project: any, force: boolean, event: Event) {
    event.stopPropagation();
    this.projectsService.archiveProject(project.id, force).subscribe({
      next: () => {
        this.loadProjects();
        this.loadArchivedProjects();
        this.closeArchiveModal();
      },
      error: (err) => {
        if (err.status === 409) {
          this.pendingArchiveProjectId = project.id;
          this.archiveWarningMessage = err.error?.message || 'There are active tasks remaining in this board.';
          this.showArchiveWarningModal = true;
        } else {
          console.error('Failed to archive board', err);
        }
      }
    });
  }

  loadArchivedProjects() {
    this.projectsService.getArchivedProjects().subscribe({
      next: (res) => {
        this.archivedProjects.set(res);
      },
      error: () => console.error('Failed to load archived projects')
    });
  }

  unarchiveBoard(project: any, event: Event) {
    event.stopPropagation();
    this.projectsService.unarchiveProject(project.id).subscribe({
      next: () => {
        this.loadProjects();
        this.loadArchivedProjects();
      },
      error: () => console.error('Failed to unarchive board')
    });
  }

  closeArchiveModal() {
    this.showArchiveWarningModal = false;
    this.pendingArchiveProjectId = null;
    this.archiveWarningMessage = '';
  }

  confirmArchiveBoard() {
    if (this.pendingArchiveProjectId) {
      this.archiveBoard({ id: this.pendingArchiveProjectId }, true, new Event('click'));
    }
  }

  goToProject(id: number) {
    // Record in recently viewed
    let recent = [id, ...this.recentlyViewedIds().filter(i => i !== id)].slice(0, 6);
    this.recentlyViewedIds.set(recent);
    localStorage.setItem('recently_viewed_board_ids', JSON.stringify(recent));

    this.router.navigate(['/projects', id]);
  }
}
