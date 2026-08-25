import { Component, signal, inject, OnInit, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AgGridModule } from 'ag-grid-angular';
import { ColDef } from 'ag-grid-community';
import {
  LucidePlus, LucideKanban,
  LucideX, LucideUser, LucideChevronLeft, LucideCheck, LucideMoreHorizontal,
  LucideStar, LucideSearch, LucideClock, LucideEdit2, LucideArchive, LucideRotateCcw, LucideBrainCircuit,
  LucideLayoutGrid, LucideList, LucideChevronDown, LucideAlertTriangle, LucideUsers
} from '@lucide/angular';
import { ProjectsService } from '../services/projects';
import { ClientsService } from '../services/clients';
import { EmployeeService } from '../services/employee.service';
import { AuthService } from '../services/auth.service';
import { HotToastService } from '@ngneat/hot-toast';
import { ProjectStarCellRendererComponent } from '../shared/components/project-star-cell-renderer.component';
import { ProjectActionCellRendererComponent } from '../shared/components/project-action-cell-renderer.component';

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  FINISHED: { bg: '#dcfce7', color: '#15803d' },
  COMPLETED: { bg: '#dcfce7', color: '#15803d' },
  IN_PROGRESS: { bg: '#dbeafe', color: '#1d4ed8' },
  NOT_STARTED: { bg: '#f1f2f4', color: '#6b7280' },
  ACTIVE: { bg: '#dbeafe', color: '#1d4ed8' },
  ARCHIVED: { bg: '#fee2e2', color: '#b91c1c' },
  ON_HOLD: { bg: '#fef3c7', color: '#b45309' },
  BLOCKED: { bg: '#fee2e2', color: '#b91c1c' }
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
    LucideLayoutGrid, LucideList, LucideChevronDown, LucideAlertTriangle, LucideUsers, AgGridModule
  ],
  templateUrl: './projects.html',
  styleUrls: ['./projects.css']
})
export class ProjectsComponent implements OnInit {
  private projectsService = inject(ProjectsService);
  private clientsService = inject(ClientsService);
  private employeeService = inject(EmployeeService);
  private router = inject(Router);
  private authService = inject(AuthService);
  private toast = inject(HotToastService);

  showArchiveWarningModal = false;
  pendingArchiveProjectId: number | null = null;
  archiveWarningMessage = '';

  currentUser = this.authService.currentUser;

  projects = signal<any[]>([]);
  archivedProjects = signal<any[]>([]);
  clients = signal<any[]>([]);
  employees = signal<any[]>([]);
  searchQuery = signal<string>('');
  activeTab = signal<'all' | 'starred' | 'recent' | 'archived'>('all');
  viewMode = signal<'card' | 'table'>((localStorage.getItem('projects-view-mode') as 'card' | 'table') || 'card');
  quickFilter = signal<'none' | 'overdue' | 'due-week' | 'led-by-me'>('none');
  pmDropdownOpen = signal(false);
  pmSearchQuery = '';

  projectManagerEmployees = computed(() => {
    return this.employees().filter((e: any) =>
      e.isProjectManager === true || /project.*manager|manager.*project/i.test(e.designation?.name || '')
    );
  });

  filteredPmEmployees = computed(() => {
    const q = this.pmSearchQuery.toLowerCase().trim();
    const list = this.projectManagerEmployees();
    if (!q) return list;
    return list.filter((e: any) =>
      `${e.firstName || ''} ${e.lastName || ''}`.toLowerCase().includes(q) ||
      (e.user?.email || '').toLowerCase().includes(q)
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

  boardsColDefs: ColDef[] = [
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
      headerName: 'Name',
      field: 'name',
      flex: 2.2,
      minWidth: 260,
      cellRenderer: (params: any) => {
        if (!params.data) return '';
        const color = this.getGradient(params.data.color, params.node?.rowIndex || 0);
        const key = params.data.key ? `<span style="margin-left:8px;font-weight:700;">${params.data.key}</span>` : '';
        return `
          <div class="table-name-cell">
            <span class="table-color-dot" style="background:${color}"></span>
            <span class="board-title">${params.data.name}</span>
            ${key}
          </div>
        `;
      }
    },
    {
      headerName: 'Lead',
      field: 'lead',
      flex: 1.2,
      minWidth: 160,
      valueGetter: (params: any) => {
        const lead = params.data?.lead;
        return lead ? `${lead.firstName || ''} ${lead.lastName || ''}`.trim() : '—';
      },
      cellRenderer: (params: any) => this.buildPersonHtml(params.data?.lead)
    },
    {
      headerName: 'PM',
      field: 'pm',
      flex: 1.2,
      minWidth: 160,
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
      headerName: 'Status',
      field: 'workStatus',
      flex: 1,
      minWidth: 130,
      cellRenderer: (params: any) => {
        const s = params.data?.workStatus || params.data?.status || '';
        if (!s) return '—';
        const { bg, color } = getStatusColors(s);
        return `<span class="pstatus-pill" style="background:${bg};color:${color}">${s.replace(/_/g, ' ')}</span>`;
      }
    },
    {
      headerName: 'Team',
      field: 'members',
      flex: 1,
      minWidth: 160,
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
      flex: 1,
      minWidth: 150,
      valueGetter: (params: any) => params.data?._count?.issues ?? 0,
      cellRenderer: (params: any) => {
        const total = params.data?._count?.issues ?? 0;
        const remaining = params.data?.remainingIssues ?? 0;
        const done = total - remaining;
        if (total === 0) return '<span style="color:#94a3b8;font-size:12px;">—</span>';
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
    {
      headerName: 'Paid Expense',
      field: 'paidExpenseTotal',
      flex: 0.9,
      minWidth: 130,
      valueGetter: (params: any) => params.data?.paidExpenseTotal ?? 0,
      valueFormatter: (params: any) => `₹${(params.value ?? 0).toLocaleString('en-IN')}`
    },
    {
      headerName: 'Start date',
      field: 'startDate',
      flex: 1,
      minWidth: 120,
      valueFormatter: (params: any) => params.value ? new Date(params.value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
    },
    {
      headerName: 'End date',
      field: 'endDate',
      flex: 1,
      minWidth: 120,
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
  ];

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

  projectForm = {
    name: '',
    visibility: 'Workspace',
    description: '',
    startDate: '',
    endDate: '',
    billingType: 'NON_BILLABLE',
    budgetAmount: null as number | null,
    hourlyRate: null as number | null,
    clientId: null as number | null,
    pmIds: [] as number[]
  };

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
  filteredProjects = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();

    if (this.activeTab() === 'archived') {
      return this.archivedProjects();
    }

    let list = this.myProjects();

    if (this.activeTab() === 'starred') {
      list = list.filter(p => this.myMemberOf(p)?.isStarred);
    } else if (this.activeTab() === 'recent') {
      list = list.filter(p => this.recentlyViewedIds().includes(p.id));
    }

    list = this.applyQuickFilter(list);

    if (!q) return list;
    return list.filter(p => p.name.toLowerCase().includes(q) || p.key?.toLowerCase().includes(q));
  });

  starredProjects = computed(() => {
    if (this.isAdmin) return this.myProjects().filter(p => p.members?.some((m: any) => m.employeeId === this.currentUser()?.employeeId && m.isStarred));
    return this.myProjects().filter(p => this.myMemberOf(p)?.isStarred);
  });

  recentlyViewedProjects = computed(() => {
    return this.myProjects().filter(p => this.recentlyViewedIds().includes(p.id));
  });

  ngOnInit() {
    this.loadStarredAndRecent();
    this.loadProjects();
    this.loadArchivedProjects();
    this.loadClients();
    this.loadEmployees();
  }

  loadEmployees() {
    this.employeeService.getEmployees().subscribe({
      next: (res) => this.employees.set(res || []),
      error: (err) => console.error('Error loading employees', err)
    });
  }

  loadClients() {
    this.clientsService.getClients().subscribe({
      next: (res) => this.clients.set(res || []),
      error: (err) => console.error('Error loading clients', err)
    });
  }

  setActiveTab(tab: 'all' | 'starred' | 'recent' | 'archived') {
    this.activeTab.set(tab);
    if (tab === 'archived') {
      this.loadArchivedProjects();
    }
  }

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
    this.projectForm = { 
      name: '', 
      visibility: 'Workspace', 
      description: '',
      startDate: '',
      endDate: '',
      billingType: 'NON_BILLABLE',
      budgetAmount: null as number | null,
      hourlyRate: null as number | null,
      clientId: null as number | null,
      pmIds: [] as number[]
    };
    this.selectedBg.set(this.colorBackgrounds[1]);
    this.isSubmitted.set(false);
    this.isCreateModalOpen.set(true);
  }

  openEditModal(project: any, event: Event) {
    if (event) event.stopPropagation();
    this.editingProjectId.set(project.id);
    this.projectForm = { 
      name: project.name, 
      visibility: 'Workspace', 
      description: project.description || '',
      startDate: project.startDate ? project.startDate.split('T')[0] : '',
      endDate: project.endDate ? project.endDate.split('T')[0] : '',
      billingType: project.billingType || 'NON_BILLABLE',
      budgetAmount: project.budgetAmount,
      hourlyRate: project.hourlyRate,
      clientId: project.clientId,
      pmIds: project.members?.filter((m: any) => m.role === 'PROJECT_MANAGER').map((m: any) => m.employeeId) || []
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
    this.pmDropdownOpen.set(false);
    this.pmSearchQuery = '';
  }

  saveProject() {
    this.isSubmitted.set(true);
    if (!this.projectForm.name.trim()) return;

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
      clientId: this.projectForm.clientId || null,
      pmIds: this.projectForm.pmIds
    };

    if (this.editingProjectId()) {
      this.projectsService.updateProject(this.editingProjectId()!, payload).subscribe({
        next: (res) => {
          this.loadProjects();
          this.closeCreateModal();
        },
        error: (err) => this.toast.error(err?.error?.message || 'Error updating project')
      });
    } else {
      this.projectsService.createProject(payload).subscribe({
        next: (res) => {
          this.loadProjects();
          this.closeCreateModal();
          this.goToProject(res.id);
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
