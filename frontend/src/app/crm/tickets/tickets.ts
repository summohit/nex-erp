import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AgGridModule } from 'ag-grid-angular';
import { ColDef, GridApi, GridReadyEvent, AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { HotToastService } from '@ngneat/hot-toast';
import {
  LucideTicket, LucidePlus, LucideRefreshCw, LucideSearch,
  LucideChevronDown, LucideX, LucideFilter, LucideRotateCcw,
  LucideBuilding, LucideLayers, LucideAlertCircle, LucideTimer,
  LucideCheckCircle2, LucideFlame, LucideEye, LucideUser,
  LucideInbox, LucideCheck, LucideSlidersHorizontal, LucideSparkles,
  LucideLaptop, LucideSmartphone, LucideHelpCircle, LucideClock,
  LucideImagePlus, LucideTrash2, LucideLoader2
} from '@lucide/angular';
import { QuillModule } from 'ngx-quill';
import { TicketService, Ticket, TicketStats, NewTicketAttachment, TicketPermissions } from '../../services/ticket.service';
import { MasterDataService, Department } from '../../services/master-data.service';
import { AuthService } from '../../services/auth.service';
import { TicketDetailComponent } from './ticket-detail/ticket-detail';

// AG Grid v33+ renders nothing unless its modules are registered.
ModuleRegistry.registerModules([AllCommunityModule]);

@Component({
  selector: 'app-tickets',
  standalone: true,
  imports: [
    CommonModule, FormsModule, AgGridModule, QuillModule,
    LucideTicket, LucidePlus, LucideRefreshCw, LucideSearch,
    LucideChevronDown, LucideX, LucideFilter, LucideRotateCcw,
    LucideBuilding, LucideLayers, LucideAlertCircle, LucideTimer,
    LucideCheckCircle2, LucideFlame, LucideEye, LucideUser,
    LucideInbox, LucideCheck, LucideSlidersHorizontal, LucideSparkles,
    LucideLaptop, LucideSmartphone, LucideHelpCircle, LucideClock,
    LucideImagePlus, LucideTrash2, LucideLoader2,
    TicketDetailComponent,
  ],
  templateUrl: './tickets.html',
  styleUrls: ['./tickets.css'],
})
export class TicketsComponent implements OnInit {
  private ticketService = inject(TicketService);
  private masterDataService = inject(MasterDataService);
  private authService = inject(AuthService);
  private toast = inject(HotToastService);

  tickets: Ticket[] = [];
  stats: TicketStats | null = null;
  departments: Department[] = [];
  isLoading = false;
  showCreateModal = false;
  selectedTicket: Ticket | null = null;

  /** Resolved server-side; gates the triage controls in the detail drawer. */
  permissions: TicketPermissions | null = null;

  // Filters
  filterDept = '';
  filterStatus = '';
  filterPriority = '';
  filterPlatform = '';
  searchTerm = '';

  // Filter Searchable Dropdown States
  showDeptDropdown = false;
  deptSearchQuery = '';

  showStatusDropdown = false;
  statusSearchQuery = '';

  showPriorityDropdown = false;
  prioritySearchQuery = '';

  showPlatformDropdown = false;
  platformSearchQuery = '';

  // Create Modal Searchable Dropdown States
  showModalTypeDropdown = false;
  modalTypeSearchQuery = '';

  showModalPlatformDropdown = false;
  modalPlatformSearchQuery = '';

  showModalPriorityDropdown = false;
  modalPrioritySearchQuery = '';

  // Create form — department is resolved server-side (always the software dev team),
  // so the reporter only supplies the issue itself.
  newTicket: Partial<Ticket> = {
    title: '',
    description: '',
    type: 'BUG',
    priority: 'MEDIUM',
    platform: 'WEB',
  };
  creating = false;

  // Image attachments (uploaded to ImageKit before the ticket is submitted)
  pendingAttachments: NewTicketAttachment[] = [];
  uploadingCount = 0;
  isDraggingFiles = false;

  readonly maxAttachments = 8;
  private readonly maxAttachmentBytes = 10 * 1024 * 1024;

  readonly quillModules = {
    toolbar: [
      ['bold', 'italic', 'underline', 'strike'],
      [{ list: 'ordered' }, { list: 'bullet' }],
      [{ header: [1, 2, 3, false] }],
      ['blockquote', 'code-block'],
      ['link'],
      ['clean'],
    ],
  };

  private gridApi!: GridApi;

  readonly statusOptions = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'REJECTED'];
  readonly priorityOptions = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
  readonly typeOptions = ['BUG', 'FEATURE_REQUEST', 'IMPROVEMENT', 'QUESTION'];
  readonly platformOptions = ['WEB', 'MOBILE', 'BOTH'];

  readonly typeBadgeClasses: Record<string, string> = {
    BUG: 'type-bug',
    FEATURE_REQUEST: 'type-feature',
    IMPROVEMENT: 'type-improvement',
    QUESTION: 'type-question',
  };

  readonly priorityColors: Record<string, string> = {
    CRITICAL: 'priority-critical',
    HIGH: 'priority-high',
    MEDIUM: 'priority-medium',
    LOW: 'priority-low',
  };

  readonly priorityDotColors: Record<string, string> = {
    CRITICAL: '#ef4444',
    HIGH: '#f97316',
    MEDIUM: '#f59e0b',
    LOW: '#64748b',
  };

  readonly statusColors: Record<string, string> = {
    OPEN: 'status-open',
    IN_PROGRESS: 'status-in-progress',
    RESOLVED: 'status-resolved',
    CLOSED: 'status-closed',
    REJECTED: 'status-rejected',
  };

  columnDefs: ColDef[] = [
    {
      field: 'ticketNumber',
      headerName: 'TICKET ID',
      width: 115,
      pinned: 'left',
      cellRenderer: (p: any) => `<span class="ticket-num-badge">${p.value}</span>`,
    },
    {
      field: 'title',
      headerName: 'TITLE & TYPE',
      flex: 2,
      minWidth: 240,
      cellRenderer: (p: any) => {
        const typeKey = p.data?.type || 'BUG';
        const typeLabel = typeKey.replace(/_/g, ' ');
        const typeBadgeClass = this.typeBadgeClasses[typeKey] || 'type-improvement';
        return `
          <div class="cell-ticket-title-wrapper">
            <div class="cell-title-text">${this.escapeHtml(p.value || '')}</div>
            <div class="cell-meta-row">
              <span class="type-pill ${typeBadgeClass}">${typeLabel}</span>
            </div>
          </div>
        `;
      },
    },
    {
      field: 'platform',
      headerName: 'PLATFORM',
      width: 95,
      cellRenderer: (p: any) => {
        const val = p.value || 'WEB';
        return `<span class="platform-tag platform-${val.toLowerCase()}">${val}</span>`;
      },
    },
    {
      field: 'department',
      headerName: 'DEPARTMENT',
      width: 130,
      valueGetter: (p: any) => p.data?.department?.name ?? 'General',
      cellRenderer: (p: any) => `<span class="dept-cell">${this.escapeHtml(p.value)}</span>`,
    },
    {
      field: 'priority',
      headerName: 'PRIORITY',
      width: 110,
      cellRenderer: (p: any) => {
        const cls = this.priorityColors[p.value] ?? 'priority-low';
        const dotColor = this.priorityDotColors[p.value] ?? '#94a3b8';
        return `<span class="priority-pill ${cls}"><span class="priority-dot" style="background-color: ${dotColor};"></span>${p.value}</span>`;
      },
    },
    {
      field: 'status',
      headerName: 'STATUS',
      width: 120,
      cellRenderer: (p: any) => {
        const cls = this.statusColors[p.value] ?? 'status-closed';
        const label = (p.value || '').replace(/_/g, ' ');
        return `<span class="status-pill ${cls}"><span class="status-indicator-dot"></span>${label}</span>`;
      },
    },
    {
      field: 'assignee',
      headerName: 'ASSIGNEE',
      width: 155,
      cellRenderer: (p: any) => {
        const a = p.data?.assignee;
        if (!a) {
          return `<div class="user-cell unassigned"><span class="avatar-circle neutral">?</span><span class="user-name-text">Unassigned</span></div>`;
        }
        const initials = ((a.firstName?.[0] || '') + (a.lastName?.[0] || '')).toUpperCase();
        const avatarHtml = a.avatarUrl
          ? `<img class="avatar-img" src="${this.escapeHtml(a.avatarUrl)}" alt="" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';" /><span class="avatar-circle" style="display:none;">${initials}</span>`
          : `<span class="avatar-circle">${initials}</span>`;
        return `
          <div class="user-cell">
            ${avatarHtml}
            <div class="user-info">
              <span class="user-name-text">${this.escapeHtml(a.firstName)} ${this.escapeHtml(a.lastName)}</span>
            </div>
          </div>
        `;
      },
    },
    {
      field: 'reporter',
      headerName: 'REPORTER',
      width: 145,
      cellRenderer: (p: any) => {
        const r = p.data?.reporter;
        if (!r) return `<span class="text-muted">—</span>`;
        const initials = ((r.firstName?.[0] || '') + (r.lastName?.[0] || '')).toUpperCase();
        const avatarHtml = r.avatarUrl
          ? `<img class="avatar-img" src="${this.escapeHtml(r.avatarUrl)}" alt="" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';" /><span class="avatar-circle reporter-avatar" style="display:none;">${initials}</span>`
          : `<span class="avatar-circle reporter-avatar">${initials}</span>`;
        return `
          <div class="user-cell">
            ${avatarHtml}
            <div class="user-info">
              <span class="user-name-text">${this.escapeHtml(r.firstName)} ${this.escapeHtml(r.lastName)}</span>
            </div>
          </div>
        `;
      },
    },
    {
      field: 'createdAt',
      headerName: 'CREATED',
      width: 110,
      valueFormatter: (p: any) => p.value ? new Date(p.value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—',
    },
    {
      headerName: 'ACTIONS',
      width: 95,
      sortable: false,
      filter: false,
      pinned: 'right',
      cellRenderer: () => `<button class="btn-grid-action" title="View details"><svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg> <span>Details</span></button>`,
    }
  ];

  defaultColDef: ColDef = {
    sortable: true,
    filter: false,
    resizable: true,
  };

  ngOnInit() {
    this.loadAll();
  }

  onGridReady(params: GridReadyEvent) {
    this.gridApi = params.api;
  }

  loadAll() {
    this.loadTickets();
    this.loadStats();
    this.masterDataService.getDepartments().subscribe({ next: (d) => (this.departments = d) });
    this.ticketService.getMyPermissions().subscribe({
      next: (p) => (this.permissions = p),
    });
  }

  loadTickets() {
    this.isLoading = true;
    const filters: Record<string, any> = {};
    if (this.filterDept) filters['departmentId'] = this.filterDept;
    if (this.filterStatus) filters['status'] = this.filterStatus;
    if (this.filterPriority) filters['priority'] = this.filterPriority;
    if (this.filterPlatform) filters['platform'] = this.filterPlatform;

    this.ticketService.getTickets(filters).subscribe({
      next: (t) => {
        this.tickets = t;
        this.isLoading = false;
        if (this.searchTerm) {
          setTimeout(() => this.onSearch(), 50);
        }
      },
      error: () => {
        this.toast.error('Failed to load tickets');
        this.isLoading = false;
      },
    });
  }

  loadStats() {
    this.ticketService.getStats().subscribe({ next: (s) => (this.stats = s) });
  }

  onSearch() {
    this.gridApi?.setGridOption('quickFilterText', this.searchTerm);
  }

  toggleStatusCard(status: string) {
    if (this.filterStatus === status) {
      this.filterStatus = '';
    } else {
      this.filterStatus = status;
    }
    this.loadTickets();
  }

  hasActiveFilters(): boolean {
    return !!(this.searchTerm || this.filterDept || this.filterStatus || this.filterPriority || this.filterPlatform);
  }

  closeAllDropdowns() {
    this.showDeptDropdown = false;
    this.showStatusDropdown = false;
    this.showPriorityDropdown = false;
    this.showPlatformDropdown = false;
    this.showModalTypeDropdown = false;
    this.showModalPlatformDropdown = false;
    this.showModalPriorityDropdown = false;
  }

  // Filter Dropdown Handlers
  getFilteredDepartments(query: string): Department[] {
    const q = (query || '').toLowerCase().trim();
    if (!q) return this.departments;
    return this.departments.filter(d => d.name.toLowerCase().includes(q));
  }

  getFilteredStatuses(query: string): string[] {
    const q = (query || '').toLowerCase().trim();
    if (!q) return this.statusOptions;
    return this.statusOptions.filter(s => this.formatLabel(s).toLowerCase().includes(q) || s.toLowerCase().includes(q));
  }

  getFilteredPriorities(query: string): string[] {
    const q = (query || '').toLowerCase().trim();
    if (!q) return this.priorityOptions;
    return this.priorityOptions.filter(p => p.toLowerCase().includes(q));
  }

  getFilteredPlatforms(query: string): string[] {
    const q = (query || '').toLowerCase().trim();
    if (!q) return this.platformOptions;
    return this.platformOptions.filter(p => p.toLowerCase().includes(q));
  }

  getFilteredTypes(query: string): string[] {
    const q = (query || '').toLowerCase().trim();
    if (!q) return this.typeOptions;
    return this.typeOptions.filter(t => this.formatLabel(t).toLowerCase().includes(q) || t.toLowerCase().includes(q));
  }

  // Label Getters for Filters
  getSelectedDeptLabel(): string {
    if (!this.filterDept) return 'All Departments';
    const dept = this.departments.find(d => String(d.id) === String(this.filterDept));
    return dept ? dept.name : 'All Departments';
  }

  getSelectedStatusLabel(): string {
    if (!this.filterStatus) return 'All Statuses';
    return this.formatLabel(this.filterStatus);
  }

  getSelectedPriorityLabel(): string {
    if (!this.filterPriority) return 'All Priorities';
    return this.filterPriority;
  }

  getSelectedPlatformLabel(): string {
    if (!this.filterPlatform) return 'All Platforms';
    return this.filterPlatform;
  }

  // Select Action Handlers for Filters
  selectDeptFilter(deptId: any) {
    this.filterDept = deptId ? String(deptId) : '';
    this.showDeptDropdown = false;
    this.loadTickets();
  }

  selectStatusFilter(status: string) {
    this.filterStatus = status || '';
    this.showStatusDropdown = false;
    this.loadTickets();
  }

  selectPriorityFilter(priority: string) {
    this.filterPriority = priority || '';
    this.showPriorityDropdown = false;
    this.loadTickets();
  }

  selectPlatformFilter(platform: string) {
    this.filterPlatform = platform || '';
    this.showPlatformDropdown = false;
    this.loadTickets();
  }

  // Modal Select Handlers
  getSelectedModalTypeLabel(): string {
    return this.newTicket.type ? this.formatLabel(this.newTicket.type) : 'Select Type';
  }

  getSelectedModalPlatformLabel(): string {
    return this.newTicket.platform || 'Select Platform';
  }

  getSelectedModalPriorityLabel(): string {
    return this.newTicket.priority || 'Select Priority';
  }

  selectModalType(type: any) {
    this.newTicket.type = type;
    this.showModalTypeDropdown = false;
  }

  selectModalPlatform(platform: any) {
    this.newTicket.platform = platform;
    this.showModalPlatformDropdown = false;
  }

  selectModalPriority(priority: any) {
    this.newTicket.priority = priority;
    this.showModalPriorityDropdown = false;
  }

  getActiveFilterChips(): { key: string; label: string; clear: () => void }[] {
    const chips: { key: string; label: string; clear: () => void }[] = [];

    if (this.searchTerm) {
      chips.push({
        key: 'search',
        label: `Search: "${this.searchTerm}"`,
        clear: () => { this.searchTerm = ''; this.onSearch(); },
      });
    }

    if (this.filterDept) {
      const dept = this.departments.find(d => String(d.id) === String(this.filterDept));
      chips.push({
        key: 'dept',
        label: `Dept: ${dept ? dept.name : this.filterDept}`,
        clear: () => { this.filterDept = ''; this.loadTickets(); },
      });
    }

    if (this.filterStatus) {
      chips.push({
        key: 'status',
        label: `Status: ${this.formatLabel(this.filterStatus)}`,
        clear: () => { this.filterStatus = ''; this.loadTickets(); },
      });
    }

    if (this.filterPriority) {
      chips.push({
        key: 'priority',
        label: `Priority: ${this.filterPriority}`,
        clear: () => { this.filterPriority = ''; this.loadTickets(); },
      });
    }

    if (this.filterPlatform) {
      chips.push({
        key: 'platform',
        label: `Platform: ${this.filterPlatform}`,
        clear: () => { this.filterPlatform = ''; this.loadTickets(); },
      });
    }

    return chips;
  }

  clearFilters() {
    this.filterDept = '';
    this.filterStatus = '';
    this.filterPriority = '';
    this.filterPlatform = '';
    this.searchTerm = '';
    this.gridApi?.setGridOption('quickFilterText', '');
    this.loadTickets();
  }

  openCreateModal() {
    this.newTicket = {
      title: '',
      description: '',
      type: 'BUG',
      priority: 'MEDIUM',
      platform: 'WEB',
    };
    this.pendingAttachments = [];
    this.uploadingCount = 0;
    this.isDraggingFiles = false;
    this.modalTypeSearchQuery = '';
    this.modalPlatformSearchQuery = '';
    this.modalPrioritySearchQuery = '';
    this.closeAllDropdowns();
    this.showCreateModal = true;
  }

  closeCreateModal() {
    this.showCreateModal = false;
    this.closeAllDropdowns();
  }

  // ─── Image attachments ─────────────────────────────────────────────────────

  onAttachmentsPicked(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files?.length) this.uploadFiles(Array.from(input.files));
    // Reset so picking the same file twice still fires a change event.
    input.value = '';
  }

  onAttachmentDrop(event: DragEvent) {
    event.preventDefault();
    this.isDraggingFiles = false;
    const files = Array.from(event.dataTransfer?.files ?? []).filter(f => f.type.startsWith('image/'));
    if (files.length) this.uploadFiles(files);
  }

  onAttachmentDragOver(event: DragEvent) {
    event.preventDefault();
    this.isDraggingFiles = true;
  }

  onAttachmentDragLeave() {
    this.isDraggingFiles = false;
  }

  private uploadFiles(files: File[]) {
    const remaining = this.maxAttachments - this.pendingAttachments.length - this.uploadingCount;
    if (remaining <= 0) {
      this.toast.error(`You can attach at most ${this.maxAttachments} images`);
      return;
    }

    const accepted = files.slice(0, remaining);
    if (files.length > remaining) {
      this.toast.error(`Only ${remaining} more image${remaining === 1 ? '' : 's'} can be attached`);
    }

    for (const file of accepted) {
      if (file.size > this.maxAttachmentBytes) {
        this.toast.error(`"${file.name}" is larger than 10MB`);
        continue;
      }

      this.uploadingCount++;
      this.ticketService.uploadImage(file).subscribe({
        next: (res) => {
          this.pendingAttachments = [
            ...this.pendingAttachments,
            { fileName: file.name, fileUrl: res.url, fileSize: file.size },
          ];
          this.uploadingCount--;
        },
        error: () => {
          this.toast.error(`Failed to upload "${file.name}"`);
          this.uploadingCount--;
        },
      });
    }
  }

  removeAttachment(index: number) {
    this.pendingAttachments = this.pendingAttachments.filter((_, i) => i !== index);
  }

  formatFileSize(bytes?: number | null): string {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /** Quill leaves an empty document as "<p><br></p>" — treat that as no description. */
  private hasDescription(): boolean {
    const raw = this.newTicket.description ?? '';
    return raw.replace(/<[^>]*>/g, '').trim().length > 0;
  }

  canSubmit(): boolean {
    return !!this.newTicket.title?.trim() && !this.creating && this.uploadingCount === 0;
  }

  submitCreate() {
    if (!this.newTicket.title?.trim()) {
      this.toast.error('Ticket title is required');
      return;
    }
    if (this.uploadingCount > 0) {
      this.toast.error('Please wait for images to finish uploading');
      return;
    }

    this.creating = true;
    this.ticketService.createTicket({
      ...this.newTicket,
      description: this.hasDescription() ? this.newTicket.description : undefined,
      attachments: this.pendingAttachments,
    }).subscribe({
      next: (t) => {
        this.tickets = [t, ...this.tickets];
        this.loadStats();
        this.showCreateModal = false;
        this.creating = false;
        this.toast.success(`Ticket #${t.ticketNumber} created successfully!`);
      },
      error: (err) => {
        this.toast.error(err?.error?.message || 'Failed to create ticket');
        this.creating = false;
      },
    });
  }

  onRowClicked(event: any) {
    if (event.data) this.openTicketDetail(event.data.id);
  }

  openTicketDetail(id: number) {
    this.ticketService.getTicket(id).subscribe({
      next: (t) => (this.selectedTicket = t),
      error: () => this.toast.error('Failed to load ticket details'),
    });
  }

  onDetailClosed() {
    this.selectedTicket = null;
  }

  onTicketUpdated(updated: Ticket) {
    this.tickets = this.tickets.map((t) => (t.id === updated.id ? { ...t, ...updated } : t));
    this.selectedTicket = updated;
    this.loadStats();
  }

  formatLabel(val: string) {
    return (val || '').replace(/_/g, ' ');
  }

  escapeHtml(str: string): string {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
