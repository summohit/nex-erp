import { Component, signal, computed, effect, inject, OnInit, OnDestroy, ViewChild, ElementRef, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { environment } from '../../../environments/environment';
import { HttpClient } from '@angular/common/http';
import { CdkDragDrop, moveItemInArray, transferArrayItem, DragDropModule, CdkDragEnd } from '@angular/cdk/drag-drop';
import { ProjectsService, ProjectSummary } from '../../services/projects';
import { MilestonesTabComponent } from '../milestones/milestones-tab';
import { TicketsTabComponent } from '../tickets/tickets-tab';
import { BudgetRequestsTabComponent } from '../budget-requests/budget-requests-tab';
import { TaskHoursRequestPanelComponent } from '../task-hours-requests/task-hours-request-panel';
import { DiscussionsTabComponent } from '../discussions/discussions-tab';
import { FieldVisitsService, FieldVisit } from '../../services/field-visits';
import { 
  LucideLayoutDashboard, LucideKanban,
  LucidePlus, LucideX, LucideClock, LucideMessageSquare, LucidePlay, LucideSquare,
  LucideZap, LucideSparkles, LucideFilter, LucideStar, LucideShare2, LucideMoreHorizontal,
  LucideInbox, LucideCalendar, LucideChevronDown, LucideChevronLeft, LucideChevronRight, LucideChevronsLeft, LucideChevronsRight,
  LucideArrowLeft, LucideEdit2, LucidePencil, LucideImage,
  LucideAlignLeft, LucideTag, LucideCheckSquare, LucideUsers, LucideCheck, LucideTrash2, LucideRepeat,
  LucidePaperclip,
  LucideFileCheck, LucideExternalLink, LucideDownload, LucideMail, LucideCopy, LucideLock,
  LucideGlobe, LucideList, LucideGanttChart, LucideFileText, LucideFile, LucideBarChart, LucideBox, LucideArchive, LucideFlag, LucideLayers,
  LucideTicket,
  LucideUser, LucideSearch, LucideCornerDownLeft, LucideVideo, LucideMusic, LucideLayoutGrid,
  LucidePrinter, LucideTimer, LucideLayoutTemplate, LucideTrendingUp, LucideActivity, LucideArrowRight, LucideListTree,
  LucideFileUp, LucideUpload, LucideUploadCloud,
  LucideMapPin, LucideRuler, LucideNavigation, LucideCamera, LucideCheckCircle, LucideXCircle,
  LucideCheckCircle2, LucideBuilding, LucideFolder, LucideBanknote, LucideHistory
} from '@lucide/angular';
import { AuthService } from '../../services/auth.service';
import { SocketService } from '../../services/socket.service';
import { HotToastService } from '@ngneat/hot-toast';
import { MasterDataService } from '../../services/master-data.service';

import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { AgGridAngular } from 'ag-grid-angular';
import { ColDef, ModuleRegistry, AllCommunityModule, ValidationModule, CellClickedEvent } from 'ag-grid-community';

ModuleRegistry.registerModules([AllCommunityModule, ValidationModule]);

declare var Quill: any;

@Component({
  selector: 'app-project-detail',
  standalone: true,
  imports: [
    CommonModule, FormsModule, DragDropModule, MilestonesTabComponent,
    TicketsTabComponent, BudgetRequestsTabComponent, DiscussionsTabComponent,
    TaskHoursRequestPanelComponent,
    LucideLayoutDashboard, LucideKanban,
    LucidePlus, LucideX, LucideClock, LucideMessageSquare, LucidePlay, LucideSquare,
    LucideZap, LucideSparkles, LucideFilter, LucideStar, LucideShare2, LucideMoreHorizontal,
    LucideInbox, LucideCalendar, LucideChevronDown, LucideChevronLeft, LucideChevronRight, LucideChevronsLeft, LucideChevronsRight,
    LucideArrowLeft, LucideEdit2, LucidePencil, LucideImage,
    LucideAlignLeft, LucideTag, LucideCheckSquare, LucideUsers, LucideCheck, LucideTrash2, LucideRepeat,
    LucidePaperclip, LucideExternalLink, LucideDownload, LucideMail, LucideCopy, LucideLock,
    LucideGlobe, LucideList, LucideGanttChart, LucideFileText, LucideFile, LucideBarChart, LucideArchive, LucideFlag, LucideLayers,
    LucideTicket,
    LucideUser, LucideSearch, LucideCornerDownLeft, LucideVideo, LucideMusic, LucideLayoutGrid,
    LucidePrinter, LucideTimer, LucideLayoutTemplate, LucideTrendingUp, LucideActivity, LucideArrowRight, LucideListTree,
    LucideFileUp, LucideUpload, LucideUploadCloud,
    LucideMapPin, LucideRuler, LucideNavigation, LucideCamera, LucideCheckCircle, LucideXCircle,
    LucideCheckCircle2, LucideBuilding, LucideFolder, LucideBanknote, LucideHistory,
    AgGridAngular,
    LucideFileCheck
  ],
  templateUrl: './project-detail.html',
  styleUrls: ['./project-detail.css'],
  encapsulation: ViewEncapsulation.None
})
export class ProjectDetailComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private projectsService = inject(ProjectsService);
  private authService = inject(AuthService);
  private toast = inject(HotToastService);
  private sanitizer = inject(DomSanitizer);
  private socketService = inject(SocketService);
  private fieldVisitsService = inject(FieldVisitsService);
  private http = inject(HttpClient);
  private masterDataService = inject(MasterDataService);

  Math = Math;
  paginationPageSizeSelector = [10, 25, 50, 100];

  projectId!: number;
  project = signal<any>(null);
  board = signal<any>(null);
  
  // Organized by columnId
  columns = signal<any[]>([]);
  issuesByColumn = signal<Map<number, any[]>>(new Map());
  allIssues = signal<any[]>([]);
  activeIssues = computed(() => this.allIssues().filter(i => !i.isArchived));
  archivedIssues = computed(() => this.allIssues().filter(i => i.isArchived));
  isLoading = signal<boolean>(true);

  // Owner & Project Manager computed signals
  projectOwner = computed(() => {
    const p = this.project();
    if (!p) return null;
    // Prefer the lead relation if populated
    if (p.lead) return p.lead;
    // Fallback: find owner from members
    if (p.leadId && p.members) {
      const ownerMember = p.members.find((m: any) => m.employeeId === p.leadId || m.employee?.id === p.leadId);
      return ownerMember?.employee || null;
    }
    return null;
  });

  projectManagers = computed(() => {
    const p = this.project();
    if (!p || !p.members) return [];
    return p.members.filter((m: any) => m.role === 'PROJECT_MANAGER');
  });

  /** Named beside the manager because it is the same kind of fact: who holds what. */
  projectArchitects = computed(() => {
    const p = this.project();
    if (!p || !p.members) return [];
    return p.members.filter((m: any) => m.role === 'TECHNICAL_ARCHITECT');
  });

  // Attachments Tab Filters
  attSearchQuery = signal<string>('');
  attFilterAddedBy = signal<number[]>([]);
  attFilterTypes = signal<string[]>([]);
  attFilterDate = signal<string>('');

  // Charts Computed Signals
  statusChartData = computed(() => {
    const summary = this.projectSummary();
    if (!summary || !summary.statusOverview) return null;
    
    return {
      labels: summary.statusOverview.map(s => s.status),
      datasets: [{
        data: summary.statusOverview.map(s => s.count),
        backgroundColor: summary.statusOverview.map(s => {
          if (s.status === 'TODO') return '#94a3b8'; // Slate 400
          if (s.status === 'IN_PROGRESS') return '#3b82f6'; // Blue 500
          if (s.status === 'IN_REVIEW') return '#8b5cf6'; // Violet 500
          if (s.status === 'DONE') return '#10b981'; // Emerald 500
          if (s.status === 'CANCELLED') return '#1373e5'; // Red 500
          return '#cbd5e1';
        }),
        hoverOffset: 4
      }]
    };
  });

  priorityChartData = computed(() => {
    const summary = this.projectSummary();
    if (!summary || !summary.priorityBreakdown) return null;
    
    return {
      labels: summary.priorityBreakdown.map(p => p.priority),
      datasets: [{
        label: 'Tasks',
        data: summary.priorityBreakdown.map(p => p.count),
        backgroundColor: summary.priorityBreakdown.map(p => {
          if (p.priority === 'CRITICAL') return '#1373e5'; // Red 500
          if (p.priority === 'HIGH') return '#1373e5'; // Orange 500
          if (p.priority === 'MEDIUM') return '#0f4f9c'; // Yellow 500
          if (p.priority === 'LOW') return '#3b82f6'; // Blue 500
          return '#cbd5e1';
        }),
        borderRadius: 4
      }]
    };
  });

  workloadChartData = computed(() => {
    const summary = this.projectSummary();
    if (!summary || !summary.teamWorkload) return null;
    
    // Sort by count descending
    const sorted = [...summary.teamWorkload].sort((a, b) => b.count - a.count);
    
    return {
      labels: sorted.map(w => w.name),
      datasets: [{
        label: 'Assigned Tasks',
        data: sorted.map(w => w.count),
        backgroundColor: '#6366f1', // Indigo 500
        borderRadius: 4
      }]
    };
  });

  typeChartData = computed(() => {
    const summary = this.projectSummary();
    if (!summary || !summary.typeDistribution) return null;
    
    return {
      labels: summary.typeDistribution.map((t: any) => t.type),
      datasets: [{
        data: summary.typeDistribution.map((t: any) => t.count),
        backgroundColor: summary.typeDistribution.map((t: any) => {
          if (t.type === 'BUG') return '#1373e5'; // Red
          if (t.type === 'TASK') return '#3b82f6'; // Blue
          if (t.type === 'STORY') return '#10b981'; // Green
          if (t.type === 'EPIC') return '#8b5cf6'; // Purple
          return '#cbd5e1';
        })
      }]
    };
  });

  completionTrendData = computed(() => {
    const summary = this.projectSummary();
    return summary?.completionTrends || null;
  });

  timeTrackingData = computed(() => {
    const summary = this.projectSummary();
    return summary?.timeTracking || { estimatedHours: 0, loggedHours: 0 };
  });

  recentActivityData = computed(() => {
    return this.projectSummary()?.recentActivity || [];
  });

  exportToCSV() {
    const summary = this.projectSummary();
    if (!summary) return;
    
    let csv = 'Metric,Value\n';
    csv += `Completed Last 7 Days,${summary.metrics.completedLast7Days}\n`;
    csv += `Created Last 7 Days,${summary.metrics.createdLast7Days}\n`;
    csv += `Updated Last 7 Days,${summary.metrics.updatedLast7Days}\n`;
    csv += `Due Soon Next 7 Days,${summary.metrics.dueSoonNext7Days}\n`;
    csv += `Estimated Hours,${summary.timeTracking?.estimatedHours || 0}\n`;
    csv += `Logged Hours,${summary.timeTracking?.loggedHours || 0}\n`;
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `project_report_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  exportToPDF() {
    window.print();
  }

  toggleAttFilterAddedBy(id: number) {
    const current = this.attFilterAddedBy();
    if (current.includes(id)) {
      this.attFilterAddedBy.set(current.filter(x => x !== id));
    } else {
      this.attFilterAddedBy.set([...current, id]);
    }
  }

  toggleAttFilterType(type: string) {
    const current = this.attFilterTypes();
    if (current.includes(type)) {
      this.attFilterTypes.set(current.filter(x => x !== type));
    } else {
      this.attFilterTypes.set([...current, type]);
    }
  }

  /**
   * Project-level documents (§6) — scope, proposal, agreement.
   *
   * Separate from task attachments: these belong to the project, not to a
   * work item. The Attachments tab used to show only the latter, so a file
   * uploaded against the project itself had nowhere to appear.
   */
  projectDocuments = signal<any[]>([]);
  documentsUploading = signal(false);
  renamingDocumentId = signal<number | null>(null);
  renameDraft = '';

  loadProjectDocuments() {
    this.projectsService.getProjectDocuments(this.projectId).subscribe({
      next: (docs) => this.projectDocuments.set(docs || []),
      error: () => this.projectDocuments.set([]),
    });
  }

  // Compute all attachments across the project
  projectAttachments = computed(() => {
    const issues = this.activeIssues();
    let allAtts: any[] = [];

    // Project documents first: they are the contract-level files, and they
    // are shown in the same list so there is one place to look rather than
    // two competing ideas of "the project's files".
    for (const doc of this.projectDocuments()) {
      allAtts.push({
        id: doc.id,
        fileName: doc.name,
        fileUrl: doc.url,
        createdAt: doc.createdAt,
        uploader: doc.employee,
        isProjectDocument: true,
      });
    }

    for (const issue of issues) {
      if (issue.attachments && issue.attachments.length > 0) {
        issue.attachments.forEach((a: any) => {
          allAtts.push({
            ...a,
            issueId: issue.id,
            issueKey: issue.key,
            issueTitle: issue.title
          });
        });
      }
    }
    
    // Sort by most recent first
    allAtts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Apply filters
    const search = this.attSearchQuery().toLowerCase();
    if (search) {
      allAtts = allAtts.filter(a => a.fileName.toLowerCase().includes(search));
    }

    const types = this.attFilterTypes();
    if (types.length > 0) {
      allAtts = allAtts.filter(a => {
        const ext = a.fileName.split('.').pop()?.toLowerCase();
        const isImage = ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp'].includes(ext || '');
        const isPdf = ext === 'pdf';
        const isDoc = ['doc', 'docx', 'txt'].includes(ext || '');
        const isSpreadsheet = ['xls', 'xlsx', 'csv'].includes(ext || '');
        const isPresentation = ['ppt', 'pptx'].includes(ext || '');
        const isVideo = ['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext || '');
        const isAudio = ['mp3', 'wav', 'ogg'].includes(ext || '');

        return (
          (types.includes('Images') && isImage) ||
          (types.includes('PDFs') && isPdf) ||
          (types.includes('Documents') && isDoc) ||
          (types.includes('Spreadsheets') && isSpreadsheet) ||
          (types.includes('Presentations') && isPresentation) ||
          (types.includes('Videos') && isVideo) ||
          (types.includes('Audio') && isAudio)
        );
      });
    }

    const addedBy = this.attFilterAddedBy();
    if (addedBy.length > 0) {
      allAtts = allAtts.filter(a => a.uploadedBy && addedBy.includes(a.uploadedBy));
    }

    const dateFilter = this.attFilterDate();
    if (dateFilter) {
      const now = new Date();
      allAtts = allAtts.filter(a => {
        const d = new Date(a.createdAt);
        if (dateFilter === 'Today') {
          return d.toDateString() === now.toDateString();
        } else if (dateFilter === 'Yesterday') {
          const yesterday = new Date(now);
          yesterday.setDate(yesterday.getDate() - 1);
          return d.toDateString() === yesterday.toDateString();
        } else if (dateFilter === 'Last 7 days') {
          const sevenDaysAgo = new Date(now);
          sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
          return d >= sevenDaysAgo;
        } else if (dateFilter === 'Last 30 days') {
          const thirtyDaysAgo = new Date(now);
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
          return d >= thirtyDaysAgo;
        } else if (dateFilter === 'This month') {
          return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        } else if (dateFilter === 'This year (2026)') {
          return d.getFullYear() === 2026;
        } else if (dateFilter === 'Last year (2025)') {
          return d.getFullYear() === 2025;
        }
        return true;
      });
    }

    return allAtts;
  });
  /**
   * What the Attachments and Evidence tabs each show (§2).
   *
   * One list, split by what the file is attached to. Evidence belongs to a
   * task -- that is what makes it evidence, and why it carries the task's key
   * and title. An Attachment belongs to the project itself: the contract, the
   * scope, the proposal, answerable to no work item.
   *
   * Deliberately derived from projectAttachments rather than fetched
   * separately, so both tabs share one set of filters and one sort, and a
   * search on one behaves exactly as it does on the other.
   */
  tabAttachments = computed(() => {
    const all = this.projectAttachments();
    return this.activeProjectTab() === 'evidence'
      ? all.filter((a: any) => !a.isProjectDocument)
      : all.filter((a: any) => a.isProjectDocument);
  });

  /** Counts for the tab labels, unaffected by the filters above them. */
  evidenceCount = computed(
    () => this.activeIssues().reduce((n: number, i: any) => n + (i.attachments?.length || 0), 0),
  );


  getAttachmentIcon(filename: string): string {
    const ext = filename?.split('.').pop()?.toLowerCase() || '';
    if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp'].includes(ext)) return 'lucideImage';
    if (['pdf'].includes(ext)) return 'lucideFile';
    if (['doc', 'docx', 'txt'].includes(ext)) return 'lucideFileText';
    if (['xls', 'xlsx', 'csv'].includes(ext)) return 'lucideLayoutGrid';
    if (['ppt', 'pptx'].includes(ext)) return 'lucideBarChart';
    if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) return 'lucideVideo';
    if (['mp3', 'wav', 'ogg'].includes(ext)) return 'lucideMusic';
    return 'lucideFile';
  }

  getAttachmentIconColor(filename: string): string {
    const ext = filename?.split('.').pop()?.toLowerCase() || '';
    if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp'].includes(ext)) return '#6b3fd6';
    if (['pdf'].includes(ext)) return '#1373e5';
    if (['doc', 'docx', 'txt'].includes(ext)) return '#2563eb';
    if (['xls', 'xlsx', 'csv'].includes(ext)) return '#16a34a';
    if (['ppt', 'pptx'].includes(ext)) return '#1373e5';
    if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) return '#0284c7';
    if (['mp3', 'wav', 'ogg'].includes(ext)) return '#9333ea';
    return '#b3bac5';
  }

  getAttachmentBadge(filename: string): { bg: string; color: string; label: string; iconBg: string } {
    const ext = filename?.split('.').pop()?.toLowerCase() || '';
    if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp'].includes(ext)) {
      return { bg: '#fdf2f8', color: '#6b3fd6', label: ext.toUpperCase(), iconBg: '#fce7f3' };
    }
    if (ext === 'pdf') {
      return { bg: '#eff6ff', color: '#1373e5', label: 'PDF', iconBg: '#dbeafe' };
    }
    if (['xls', 'xlsx', 'csv'].includes(ext)) {
      return { bg: '#ecfdf5', color: '#059669', label: ext.toUpperCase(), iconBg: '#d1fae5' };
    }
    if (['doc', 'docx', 'txt', 'rtf'].includes(ext)) {
      return { bg: '#eff6ff', color: '#2563eb', label: ext.toUpperCase(), iconBg: '#dbeafe' };
    }
    if (['env', 'json', 'js', 'ts', 'html', 'css', 'xml', 'yml', 'yaml'].includes(ext)) {
      return { bg: '#faf5ff', color: '#7c3aed', label: ext.toUpperCase(), iconBg: '#f3e8ff' };
    }
    if (['zip', 'rar', 'tar', 'gz', '7z'].includes(ext)) {
      return { bg: '#f3efff', color: '#6b3fd6', label: ext.toUpperCase(), iconBg: '#f3efff' };
    }
    return { bg: '#f8fafc', color: '#475569', label: (ext || 'FILE').toUpperCase(), iconBg: '#f1f5f9' };
  }

  openIssueDetailsById(issueId: number) {
    const issue = this.allIssues().find(i => i.id === issueId);
    if (issue) this.openIssueDetails(issue);
  }

  /** Set from ?task=, cleared the moment it is used. */
  private pendingTaskDeepLink: number | null = null;

  /**
   * Open the task named in the URL, then take it back out of the URL.
   *
   * Without the rewrite, refreshing the page or coming back to it would reopen
   * the modal every time — the same clean-up the lead profile does after its
   * own deep link. If the id is not on this board (archived, or the user cannot
   * see it) we land on the board silently rather than explaining a task they
   * were not going to be shown anyway.
   */
  private consumePendingTaskDeepLink() {
    const id = this.pendingTaskDeepLink;
    if (!id) return;
    this.pendingTaskDeepLink = null;
    this.openIssueDetailsById(id);
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {},
      replaceUrl: true,
    });
  }

  activeTab = signal<'board'|'backlog'|'analytics'|'settings'>('board');
  activeProjectTab = signal<string>('board');
  projectSummary = signal<ProjectSummary | null>(null);

  // Project activity feed. IssueActivity rows were already being written on
  // every status change, comment and timer action — nothing surfaced them.
  activity = signal<any[]>([]);
  activityLoading = signal(false);

  loadActivity() {
    this.activityLoading.set(true);
    this.http.get<any[]>(`${environment.apiUrl}/projects/${this.projectId}/activity`)
      .subscribe({
        next: (rows) => {
          this.activity.set(rows || []);
          this.activityLoading.set(false);
        },
        error: () => {
          this.activity.set([]);
          this.activityLoading.set(false);
        },
      });
  }

  /** Turns a raw action + field change into a readable sentence. */
  formatActivityAction(a: any): string {
    const pretty = (v?: string) => (v || '').replace(/_/g, ' ').toLowerCase();
    const verb: Record<string, string> = {
      CREATED: 'created this issue',
      STATUS_CHANGED: 'changed status',
      PRIORITY_CHANGED: 'changed priority',
      ASSIGNED: 'reassigned it',
      COMMENT_ADDED: 'added a comment',
      WORK_STARTED: 'started the timer',
      WORK_STOPPED: 'stopped the timer',
      TIME_LOGGED: 'logged time',
      APPROVED: 'approved it',
      REJECTED: 'rejected it',
    };
    const base = verb[a?.action] ?? pretty(a?.action);
    return a?.oldValue && a?.newValue
      ? `${base} from ${pretty(a.oldValue)} to ${pretty(a.newValue)}`
      : base;
  }

  // Client Visits tab
  fieldVisits = signal<FieldVisit[]>([]);
  fieldVisitsLoading = signal(false);
  fieldVisitsLoaded = false;
  selectedFieldVisit = signal<FieldVisit | null>(null);

  loadFieldVisits() {
    if (this.fieldVisitsLoaded) return;
    this.fieldVisitsLoading.set(true);
    this.fieldVisitsService.getProjectVisits(this.projectId).subscribe({
      next: (visits) => {
        this.fieldVisits.set(visits);
        this.fieldVisitsLoaded = true;
        this.fieldVisitsLoading.set(false);
      },
      error: (err) => {
        console.error('Error loading client visits', err);
        this.fieldVisitsLoading.set(false);
      }
    });
  }

  fieldVisitStatusColor(status: string) {
    if (status === 'COMPLETED') return { bg: '#dcfce7', text: '#166534' };
    if (status === 'CANCELLED') return { bg: '#dbeafe', text: '#595a5b' };
    return { bg: '#f3efff', text: '#49494a' };
  }

  fieldVisitPointCount(visit: FieldVisit): number {
    return Array.isArray(visit.routePoints) ? visit.routePoints.length : 0;
  }

  openFieldVisitDetail(visit: FieldVisit) {
    this.selectedFieldVisit.set(visit);
  }

  closeFieldVisitDetail() {
    this.selectedFieldVisit.set(null);
  }

  // List Tab Filters
  listSearchQuery = signal<string>('');
  listFilterAssigneeIds = signal<number[]>([]);
  listFilterStatuses = signal<string[]>([]);
  listFilterPriorities = signal<string[]>([]);
  listFilterMyIssues = signal<boolean>(false);

  /** The single filter for where a task sits in the workflow. A board list IS
   *  a workflow step (each column carries its status), so List and Status were
   *  the same question twice — one option set replaces both. 'ARCHIVED'
   *  reaches the rows the board normally hides. */
  listFilterStatusOptions = [
    { value: 'TODO', label: 'To Do', color: '#64748b' },
    { value: 'IN_PROGRESS', label: 'In Progress', color: '#2563eb' },
    { value: 'IN_REVIEW', label: 'In Review', color: '#9333ea' },
    { value: 'DONE', label: 'Completed', color: '#16a34a' },
    { value: 'ARCHIVED', label: 'Archived', color: '#94a3b8' },
  ];

  filteredListIssues = computed(() => {
    let issues = this.activeIssues();
    
    const search = this.listSearchQuery().toLowerCase();
    if (search) {
      issues = issues.filter(i => 
        i.title.toLowerCase().includes(search) || 
        (i.key && i.key.toLowerCase().includes(search))
      );
    }
    
    if (this.listFilterMyIssues()) {
      const myId = this.currentUser()?.id;
      if (myId) {
        issues = issues.filter(i => 
          i.assigneeId === myId || (i.members && i.members.some((m: any) => m.userId === myId))
        );
      }
    } else if (this.listFilterAssigneeIds().length > 0) {
      const selected = this.listFilterAssigneeIds();
      issues = issues.filter(i => {
        // -1 represents "Unassigned"
        if (selected.includes(-1) && !i.assigneeId && (!i.members || i.members.length === 0)) return true;
        if (i.assigneeId && selected.includes(i.assigneeId)) return true;
        if (i.members && i.members.some((m: any) => selected.includes(m.employeeId))) return true;
        return false;
      });
    }

    // Status — the single consolidated list/status filter. A board list is a
    // workflow step, so "which list" and "which status" were the same filter
    // wearing two names. 'ARCHIVED' also pulls in the rows the board hides.
    const statuses = this.listFilterStatuses();
    if (statuses.length > 0) {
      if (statuses.includes('ARCHIVED')) {
        issues = issues.concat(this.archivedIssues());
      }
      issues = issues.filter(i =>
        i.isArchived ? statuses.includes('ARCHIVED') : statuses.includes(i.status),
      );
    }

    if (this.listFilterPriorities().length > 0) {
      issues = issues.filter(i => this.listFilterPriorities().includes(i.priority));
    }

    // ── Filter Pipeline filters ──
    // Date filter (start date range)
    if (this.fdDateOn() && this.fdStartDate()) {
      const from = new Date(this.fdStartDate()!).getTime();
      issues = issues.filter(i => {
        if (!i.startDate) return false;
        const d = new Date(i.startDate).getTime();
        return !isNaN(d) && d >= from;
      });
    }

    // Type
    if (this.fdType()) {
      issues = issues.filter(i => i.type === this.fdType());
    }

    // Project
    if (this.fdProjectId()) {
      issues = issues.filter(i => i.projectId === this.fdProjectId());
    }

    // Client — issues have no direct client; map through issues' project
    if (this.fdClientId()) {
      const proj = this.fdAllProjects();
      const projClient = new Map<number, number>();
      proj.forEach((p: any) => { if (p.clientId) projClient.set(p.id, p.clientId); });
      issues = issues.filter(i => projClient.get(i.projectId) === this.fdClientId());
    }

    // Assigned To
    if (this.fdAssignToIds().length > 0) {
      const sel = this.fdAssignToIds();
      issues = issues.filter(i =>
        (i.assigneeId && sel.includes(i.assigneeId)) ||
        (i.members && i.members.some((m: any) => sel.includes(m.employeeId)))
      );
    }

    // Assigned By (reporter)
    if (this.fdAssignByIds().length > 0) {
      const sel = this.fdAssignByIds();
      issues = issues.filter(i => i.reporterId && sel.includes(i.reporterId));
    }

    // Labels
    if (this.fdLabelIds().length > 0) {
      const sel = this.fdLabelIds();
      issues = issues.filter(i =>
        i.labels && i.labels.some((il: any) => sel.includes(il.labelId || il.label?.id))
      );
    }

    // Priority (pipeline single-select)
    if (this.fdPriority()) {
      issues = issues.filter(i => i.priority === this.fdPriority());
    }

    // Task Category
    if (this.fdTaskCategoryId()) {
      issues = issues.filter(i => i.taskTypeId === this.fdTaskCategoryId());
    }

    // §8: Phase
    if (this.fdPhaseId()) {
      issues = issues.filter(i => i.phase?.id === this.fdPhaseId());
    }

    // ── Column-aligned pipeline filters ──
    // ID (matches grid "ID" column → issue key)
    if (this.fdIssueKey().trim()) {
      const q = this.fdIssueKey().trim().toLowerCase();
      issues = issues.filter(i => i.key && i.key.toLowerCase().includes(q));
    }

    // Task name (matches grid "Task" column → title)
    if (this.fdTaskName().trim()) {
      const q = this.fdTaskName().trim().toLowerCase();
      issues = issues.filter(i => i.title && i.title.toLowerCase().includes(q));
    }

    // Due Date (matches grid "Due Date" column — dueDate, falls back to startDate)
    if (this.fdDueFrom() || this.fdDueTo()) {
      const from = this.fdDueFrom() ? new Date(this.fdDueFrom()!).getTime() : null;
      const to = this.fdDueTo() ? new Date(this.fdDueTo()!).getTime() : null;
      issues = issues.filter(i => {
        const due = i.dueDate ? new Date(i.dueDate).getTime() : (i.startDate ? new Date(i.startDate).getTime() : null);
        if (!due || isNaN(due)) return false;
        if (from !== null && due < from) return false;
        if (to !== null && due > to + 86399999) return false;
        return true;
      });
    }

    // Created At (matches grid "Created At" column)
    if (this.fdCreatedFrom() || this.fdCreatedTo()) {
      const from = this.fdCreatedFrom() ? new Date(this.fdCreatedFrom()!).getTime() : null;
      const to = this.fdCreatedTo() ? new Date(this.fdCreatedTo()!).getTime() : null;
      issues = issues.filter(i => {
        if (!i.createdAt) return false;
        const d = new Date(i.createdAt).getTime();
        if (isNaN(d)) return false;
        if (from !== null && d < from) return false;
        if (to !== null && d > to + 86399999) return false;
        return true;
      });
    }

    // Updated At (matches grid "Updated At" column)
    if (this.fdUpdatedFrom() || this.fdUpdatedTo()) {
      const from = this.fdUpdatedFrom() ? new Date(this.fdUpdatedFrom()!).getTime() : null;
      const to = this.fdUpdatedTo() ? new Date(this.fdUpdatedTo()!).getTime() : null;
      issues = issues.filter(i => {
        if (!i.updatedAt) return false;
        const d = new Date(i.updatedAt).getTime();
        if (isNaN(d)) return false;
        if (from !== null && d < from) return false;
        if (to !== null && d > to + 86399999) return false;
        return true;
      });
    }

    return issues;
  });

  toggleListFilterAssignee(id: number) {
    const current = this.listFilterAssigneeIds();
    if (current.includes(id)) {
      this.listFilterAssigneeIds.set(current.filter(x => x !== id));
    } else {
      this.listFilterAssigneeIds.set([...current, id]);
    }
  }

  toggleListFilterStatus(status: string) {
    const current = this.listFilterStatuses();
    if (current.includes(status)) {
      this.listFilterStatuses.set(current.filter(x => x !== status));
    } else {
      this.listFilterStatuses.set([...current, status]);
    }
  }

  toggleListFilterPriority(priority: string) {
    const current = this.listFilterPriorities();
    if (current.includes(priority)) {
      this.listFilterPriorities.set(current.filter(x => x !== priority));
    } else {
      this.listFilterPriorities.set([...current, priority]);
    }
  }
  
  clearListFilters() {
    this.listSearchQuery.set('');
    this.listFilterAssigneeIds.set([]);
    this.listFilterStatuses.set([]);
    this.listFilterPriorities.set([]);
    this.listFilterMyIssues.set(false);
    this.fdDateOn.set(false);
    this.fdStartDate.set(null);
    this.fdType.set(null);
    this.fdProjectId.set(null);
    this.fdClientId.set(null);
    this.fdAssignToIds.set([]);
    this.fdAssignByIds.set([]);
    this.fdLabelIds.set([]);
    this.fdPriority.set(null);
    this.fdTaskCategoryId.set(null);
    this.fdPhaseId.set(null);
    this.fdIssueKey.set('');
    this.fdTaskName.set('');
    this.fdDueFrom.set(null);
    this.fdDueTo.set(null);
    this.fdCreatedFrom.set(null);
    this.fdCreatedTo.set(null);
    this.fdUpdatedFrom.set(null);
    this.fdUpdatedTo.set(null);
  }

  // ── Filter Pipeline Drawer ──────────────────────────────────────────────
  showFilterDrawer = signal<boolean>(false);
  fdDropdownOpen = signal<string | null>(null);

  // Filter values
  fdDateOn = signal<boolean>(false);
  fdStartDate = signal<string | null>(null);
  fdType = signal<string | null>(null);
  fdProjectId = signal<number | null>(null);
  fdClientId = signal<number | null>(null);
  fdAssignToIds = signal<number[]>([]);
  fdAssignByIds = signal<number[]>([]);
  fdLabelIds = signal<number[]>([]);
  fdPriority = signal<string | null>(null);
  fdTaskCategoryId = signal<number | null>(null);
  /** §8: the delivery phase to narrow the board and list to. */
  fdPhaseId = signal<number | null>(null);
  fdAllPhases = signal<any[]>([]);

  // Column-aligned pipeline filters (mirror the tasks grid columns)
  fdIssueKey = signal<string>('');
  fdTaskName = signal<string>('');
  fdDueFrom = signal<string | null>(null);
  fdDueTo = signal<string | null>(null);
  fdCreatedFrom = signal<string | null>(null);
  fdCreatedTo = signal<string | null>(null);
  fdUpdatedFrom = signal<string | null>(null);
  fdUpdatedTo = signal<string | null>(null);

  // Available options (loaded on drawer open)
  fdAllProjects = signal<any[]>([]);
  fdAllClients = signal<any[]>([]);
  fdAllLabels = signal<any[]>([]);
  fdAllTaskCategories = signal<any[]>([]);

  fdActiveFilterCount = computed(() => {
    let n = 0;
    if (this.fdDateOn() && this.fdStartDate()) n++;
    if (this.fdType()) n++;
    if (this.fdProjectId()) n++;
    if (this.fdClientId()) n++;
    if (this.fdAssignToIds().length > 0) n++;
    if (this.fdAssignByIds().length > 0) n++;
    if (this.fdLabelIds().length > 0) n++;
    if (this.fdPriority()) n++;
    if (this.fdTaskCategoryId()) n++;
    if (this.fdPhaseId()) n++;
    if (this.fdIssueKey().trim()) n++;
    if (this.fdTaskName().trim()) n++;
    if (this.fdDueFrom() || this.fdDueTo()) n++;
    if (this.fdCreatedFrom() || this.fdCreatedTo()) n++;
    if (this.fdUpdatedFrom() || this.fdUpdatedTo()) n++;
    return n;
  });

  loadFilterDrawerData() {
    this.projectsService.getProjects().subscribe({ next: (p) => this.fdAllProjects.set(p || []) });
    const projClient = this.project()?.client;
    this.fdAllClients.set(projClient ? [projClient] : []);
    if (!this.companyMembers().length) this.loadCompanyMembers();
    const usedTaskTypes = new Set(
      this.allIssues().map((i: any) => i.taskTypeId).filter((x: any) => !!x)
    );
    this.masterDataService.getTaskTypes().subscribe({ next: (t) => {
      this.fdAllTaskCategories.set((t || []).filter((tc: any) => usedTaskTypes.has(tc.id)));
    }});
    // §8: every phase actually used on this board, so the filter never offers
    // a phase that would return nothing. Same rule as task categories above.
    const usedPhases = new Set(
      this.allIssues().map((i: any) => i.phase?.id).filter((x: any) => !!x)
    );
    this.masterDataService.getProjectPhases().subscribe({ next: (p: any) => {
      this.fdAllPhases.set((p || []).filter((ph: any) => usedPhases.has(ph.id)));
    }});
    this.projectsService.getLabels(this.projectId).subscribe({ next: (l) => this.fdAllLabels.set(l || []) });
  }

  toggleFilterDrawer() {
    if (this.showFilterDrawer()) {
      this.showFilterDrawer.set(false);
      this.fdDropdownOpen.set(null);
    } else {
      if (!this.fdProjectId() && this.projectId) {
        this.fdProjectId.set(this.projectId);
      }
      this.loadFilterDrawerData();
      this.showFilterDrawer.set(true);
      this.fdDropdownOpen.set(null);
    }
  }

  toggleFdDropdown(name: string, event: MouseEvent) {
    event.stopPropagation();
    this.fdDropdownOpen.set(this.fdDropdownOpen() === name ? null : name);
  }

  fdSetSingle(signalRef: any, value: any) {
    signalRef.set(signalRef() === value ? null : value);
  }

  fdToggleArray(signalRef: any, value: any) {
    const cur = signalRef() as any[];
    signalRef.set(cur.includes(value) ? cur.filter((x: any) => x !== value) : [...cur, value]);
  }

  closeFdDropdowns() {
    this.fdDropdownOpen.set(null);
  }

  fdProjectName(id: number | null): string {
    if (!id) return 'All';
    const p = this.fdAllProjects().find(x => x.id === id);
    return p ? p.name : '—';
  }

  fdClientName(id: number | null): string {
    if (!id) return 'All';
    const c = this.fdAllClients().find(x => x.id === id);
    return c ? c.name : '—';
  }

  fdTaskCategoryName(id: number | null): string {
    if (!id) return 'All';
    const t = this.fdAllTaskCategories().find(x => x.id === id);
    return t ? t.name : '—';
  }

  fdPhaseName(id: number | null): string {
    if (!id) return 'All';
    const p = this.fdAllPhases().find((x: any) => x.id === id);
    return p ? p.name : '—';
  }

  // Time Tracking State
  isTimeLogModalOpen = signal<boolean>(false);
  timeLogHours = signal<number | null>(null);
  timeLogMinutes = signal<number | null>(null);
  isTimerLoading = signal<boolean>(false);
  showTimeLogsHistory = signal<boolean>(false);

  // Moving / Updating Issue Loader State
  updatingIssueIds = signal<Set<number>>(new Set());

  isIssueUpdating(issueId: number): boolean {
    return this.updatingIssueIds().has(issueId);
  }

  setIssueUpdating(issueId: number, isUpdating: boolean) {
    const current = new Set(this.updatingIssueIds());
    if (isUpdating) {
      current.add(issueId);
    } else {
      current.delete(issueId);
    }
    this.updatingIssueIds.set(current);
  }

  selectedIssueTimeLogged = computed(() => {
    const issue = this.selectedIssue();
    if (!issue || !issue.timeLogs) return { text: '0m', totalMin: 0, rawText: '0m' };
    const totalMin = issue.timeLogs.reduce((sum: number, log: any) => sum + (log.durationMin || 0), 0);
    if (totalMin === 0) return { text: '0m', totalMin: 0, rawText: '0m' };
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    let text = '';
    let rawText = '';
    if (h > 0) { text += `<span style="font-weight: 600; color: #172b4d;">${h}</span><span style="color: #6b778c; margin-right: 4px;">h</span> `; rawText += `${h}h `; }
    if (m > 0) { text += `<span style="font-weight: 600; color: #172b4d;">${m}</span><span style="color: #6b778c;">m</span>`; rawText += `${m}m`; }
    return { text: text.trim(), totalMin, rawText: rawText.trim() };
  });

  selectedIssueTimeEstimated = computed(() => {
    const issue = this.selectedIssue();
    if (!issue || !issue.estimatedHours) return { text: 'None', totalMin: 0, rawText: 'None' };
    const h = Math.floor(issue.estimatedHours);
    const m = Math.round((issue.estimatedHours - h) * 60);
    const totalMin = Math.round(issue.estimatedHours * 60);
    let text = '';
    let rawText = '';
    if (h > 0) { text += `<span style="font-weight: 600; color: #172b4d;">${h}</span><span style="color: #6b778c; margin-right: 4px;">h</span> `; rawText += `${h}h `; }
    if (m > 0) { text += `<span style="font-weight: 600; color: #172b4d;">${m}</span><span style="color: #6b778c;">m</span>`; rawText += `${m}m`; }
    return { text: text.trim(), totalMin, rawText: rawText.trim() };
  });

  timeTrackingProgressPercent = computed(() => {
    const logged = this.selectedIssueTimeLogged().totalMin;
    const est = this.selectedIssueTimeEstimated().totalMin;
    if (est === 0) return 0;
    return Math.min(100, (logged / est) * 100);
  });

  remainingTimeFormatted = computed(() => {
    const est = this.selectedIssueTimeEstimated().totalMin;
    const logged = this.selectedIssueTimeLogged().totalMin;
    if (est === 0) {
      return { text: '—', subtext: 'No estimate set', isOver: false, remainingMin: 0 };
    }
    const diff = est - logged;
    if (diff > 0) {
      const h = Math.floor(diff / 60);
      const m = diff % 60;
      let text = '';
      if (h > 0) text += `${h}h `;
      if (m > 0 || h === 0) text += `${m}m`;
      return { text: text.trim() + ' left', subtext: 'Within budget', isOver: false, remainingMin: diff };
    } else if (diff < 0) {
      const overMin = Math.abs(diff);
      const h = Math.floor(overMin / 60);
      const m = overMin % 60;
      let text = '+';
      if (h > 0) text += `${h}h `;
      if (m > 0 || h === 0) text += `${m}m`;
      return { text: text.trim() + ' over', subtext: 'Over budget', isOver: true, remainingMin: diff };
    } else {
      return { text: '0m left', subtext: 'Exact budget met', isOver: false, remainingMin: 0 };
    }
  });

  isTimerRunning = computed(() => {
    const issue = this.selectedIssue();
    return issue && issue.workStartedAt && !issue.workCompletedAt;
  });

  // Modal Subtasks logic
  roadmapExpandedEpics = signal<Set<number>>(new Set());
  roadmapDayWidth = 36; // px per day

  roadmapData = computed(() => {
    const issues = this.activeIssues();
    if (issues.length === 0) {
      return { start: new Date(), end: new Date(), days: [], months: [], tree: [] };
    }

    // Find min and max dates
    let minDate = new Date();
    let maxDate = new Date();
    let first = true;

    for (const issue of issues) {
      const dates = [];
      if (issue.startDate) dates.push(new Date(issue.startDate));
      if (issue.dueDate) dates.push(new Date(issue.dueDate));
      for (const d of dates) {
        if (first || d < minDate) minDate = d;
        if (first || d > maxDate) maxDate = d;
        first = false;
      }
    }

    // Pad dates: -1 month to min, +1 month to max
    const startWindow = new Date(minDate.getFullYear(), minDate.getMonth() - 1, 1);
    const endWindow = new Date(maxDate.getFullYear(), maxDate.getMonth() + 2, 0); // last day of next month

    // Generate days array
    const days = [];
    let curr = new Date(startWindow);
    while (curr <= endWindow) {
      days.push(new Date(curr));
      curr.setDate(curr.getDate() + 1);
    }

    // Generate months array
    const months = [];
    let currentMonth = -1;
    let daysInMonth = 0;
    for (const d of days) {
      if (d.getMonth() !== currentMonth) {
        if (currentMonth !== -1) {
          const mDate = new Date(d.getFullYear(), currentMonth, 1);
          const name = mDate.toLocaleString('default', { month: 'short', year: 'numeric' });
          months.push({ name, daysCount: daysInMonth });
        }
        currentMonth = d.getMonth();
        daysInMonth = 1;
      } else {
        daysInMonth++;
      }
    }
    if (daysInMonth > 0) {
      const mDate = new Date(endWindow.getFullYear(), currentMonth, 1);
      const name = mDate.toLocaleString('default', { month: 'short', year: 'numeric' });
      months.push({ name, daysCount: daysInMonth });
    }

    // Build hierarchical tree
    const tree: any[] = [];
    const epics = issues.filter((i: any) => i.type === 'EPIC');
    const childIssues = issues.filter((i: any) => i.parentId && epics.some((e: any) => e.id === i.parentId));
    
    // Add epics with their children
    for (const epic of epics) {
      const epicChildren = childIssues.filter((i: any) => i.parentId === epic.id);
      tree.push({ ...epic, isEpic: true, hasChildren: epicChildren.length > 0 });
      if (this.roadmapExpandedEpics().has(epic.id)) {
        for (const child of epicChildren) {
          tree.push({ ...child, isEpicChild: true });
        }
      }
    }

    // Add standalone issues (not epics, no epic parent)
    const epicIds = new Set(epics.map((e: any) => e.id));
    const standalone = issues.filter((i: any) => i.type !== 'EPIC' && (!i.parentId || !epicIds.has(i.parentId)));
    tree.push(...standalone.map((s: any) => ({ ...s, isStandalone: true })));

    return { start: startWindow, end: endWindow, days, months, tree };
  });

  toggleRoadmapEpic(epicId: number) {
    const set = new Set(this.roadmapExpandedEpics());
    if (set.has(epicId)) {
      set.delete(epicId);
    } else {
      set.add(epicId);
    }
    this.roadmapExpandedEpics.set(set);
  }

  getRoadmapBarStyles(issue: any, windowStart: Date): any {
    if (!issue.startDate || !issue.dueDate) return { display: 'none' };
    
    const start = new Date(issue.startDate);
    const end = new Date(issue.dueDate);
    
    const startOffsetMs = start.getTime() - windowStart.getTime();
    const durationMs = end.getTime() - start.getTime() + (24 * 60 * 60 * 1000); // include end day
    
    const startDays = startOffsetMs / (24 * 60 * 60 * 1000);
    const durationDays = durationMs / (24 * 60 * 60 * 1000);
    
    const leftPx = startDays * this.roadmapDayWidth;
    const widthPx = durationDays * this.roadmapDayWidth;
    
    let bgColor = '#0c66e4';
    if (issue.status === 'DONE') bgColor = '#16a34a';
    else if (issue.type === 'EPIC') bgColor = '#8b5cf6';
    else if (issue.status === 'IN_PROGRESS') bgColor = '#6b3fd6';
    
    return {
      left: leftPx + 'px',
      width: Math.max(widthPx, this.roadmapDayWidth) + 'px', // minimum 1 day width
      backgroundColor: bgColor
    };
  }

  updateIssueDetails(payload: any) {
    if (!this.selectedIssue()) return;
    const id = this.selectedIssue().id;
    this.projectsService.updateIssue(this.projectId, id, payload).subscribe({
      next: () => {
        // We will reload everything to keep UI completely in sync, including time tracking
        this.loadBoardAndIssues();
        // Task counts on the Milestones tab move when a task's milestone does.
        this.loadProjectMilestones();
        this.loadProjectDocuments();
        this.loadPhases();
        
        // Also manually update the selected issue right away for fast UI response
        const current = this.selectedIssue();
        this.selectedIssue.set({ ...current, ...payload });
      },
      error: () => this.toast.error('Failed to update issue')
    });
  }

  /**
   * The server's own explanation for a failed request.
   *
   * These time endpoints are called with fetch() rather than HttpClient, so
   * the body is not unwrapped for us. They used to throw a fixed string and
   * discard it, which mattered once the hours ceiling started refusing logs
   * (§3): "Failed to log time" told the user nothing about the four hours
   * they had already used or the request that would unblock them.
   */
  private async serverMessage(res: Response, fallback: string): Promise<string> {
    try {
      const body = await res.json();
      const message = body?.message;
      if (Array.isArray(message) && message.length) return String(message[0]);
      if (typeof message === 'string' && message.trim()) return message;
    } catch {
      // No JSON body -- a proxy error page, or an empty 500.
    }
    return fallback;
  }

  toggleTimeTimer() {
    const issue = this.selectedIssue();
    if (!issue) return;
    
    this.isTimerLoading.set(true);
    
    if (this.isTimerRunning()) {
      // Stop timer
      fetch(`${environment.apiUrl}/projects/${this.projectId}/issues/${issue.id}/time-stop`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.authService.getToken()}` }
      }).then(async res => {
        if (!res.ok) throw new Error(await this.serverMessage(res, 'Failed to stop timer'));
        this.toast.success('Timer stopped');
        this.loadBoardAndIssues(); // Refreshes time logs
        this.selectedIssue.set({ ...issue, workCompletedAt: new Date() }); // Optimistic
      }).catch((e) => this.toast.error(e?.message || 'Failed to stop timer'))
      .finally(() => this.isTimerLoading.set(false));
      
    } else {
      // Start timer
      fetch(`${environment.apiUrl}/projects/${this.projectId}/issues/${issue.id}/time-start`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.authService.getToken()}` }
      }).then(async res => {
        if (!res.ok) throw new Error(await this.serverMessage(res, 'Failed to start timer'));
        this.toast.success('Timer started');
        this.selectedIssue.set({ ...issue, workStartedAt: new Date(), workCompletedAt: null }); // Optimistic
        this.loadBoardAndIssues();
      }).catch((e) => this.toast.error(e?.message || 'Failed to start timer'))
      .finally(() => this.isTimerLoading.set(false));
    }
  }

  submitManualTimeLog() {
    const issue = this.selectedIssue();
    if (!issue) return;
    
    const h = this.timeLogHours() || 0;
    const m = this.timeLogMinutes() || 0;
    const totalMin = (h * 60) + m;
    
    if (totalMin <= 0) {
      this.toast.error('Please enter a valid duration');
      return;
    }
    
    this.isTimerLoading.set(true);
    fetch(`${environment.apiUrl}/projects/${this.projectId}/issues/${issue.id}/time-log`, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${this.authService.getToken()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ durationMin: totalMin })
    }).then(async res => {
      if (!res.ok) throw new Error(await this.serverMessage(res, 'Failed to log time'));
      this.toast.success('Time logged successfully');
      this.isTimeLogModalOpen.set(false);
      this.timeLogHours.set(null);
      this.timeLogMinutes.set(null);
      
      // Update selected issue time logs optimistically or reload all
      this.loadBoardAndIssues(); // This ensures tree/roadmap is updated
      
    }).catch((e) => this.toast.error(e?.message || 'Failed to log time'))
    .finally(() => this.isTimerLoading.set(false));
  }

  updateEstimatedHours() {
    const val = this.issueForm.estimatedHours !== null && this.issueForm.estimatedHours !== undefined 
      ? Number(this.issueForm.estimatedHours) 
      : 0;
    this.updateIssueDetails({ estimatedHours: val });
  }

  setEstimatePreset(hours: number) {
    this.issueForm.estimatedHours = hours;
    this.updateIssueDetails({ estimatedHours: hours });
  }

  setTimeLogPreset(hours: number, minutes: number) {
    this.timeLogHours.set(hours);
    this.timeLogMinutes.set(minutes);
  }

  formatDurationMin(durationMin: number): string {
    if (!durationMin) return '0m';
    const h = Math.floor(durationMin / 60);
    const m = durationMin % 60;
    let s = '';
    if (h > 0) s += `${h}h `;
    if (m > 0 || h === 0) s += `${m}m`;
    return s.trim();
  }

  formatTimeLogDate(dateStr: any): string {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { 
      month: 'short', 
      day: 'numeric', 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  }

  onRoadmapBarDragEnd(event: CdkDragEnd, issue: any) {
    if (!issue.startDate || !issue.dueDate) return;
    
    const movedPx = event.distance.x;
    const movedDays = Math.round(movedPx / this.roadmapDayWidth);
    
    // Reset transform visually immediately so Angular CDK doesn't leave it offset
    event.source._dragRef.reset();
    
    if (movedDays === 0) return;
    
    const start = new Date(issue.startDate);
    const end = new Date(issue.dueDate);
    
    start.setDate(start.getDate() + movedDays);
    end.setDate(end.getDate() + movedDays);
    
    const payload = {
      startDate: start.toISOString(),
      dueDate: end.toISOString()
    };
    
    this.projectsService.updateIssue(this.projectId, issue.id, payload).subscribe({
      next: () => {
        this.toast.success('Dates updated');
        this.loadBoardAndIssues();
      },
      error: () => {
        this.toast.error('Failed to update dates');
        this.loadBoardAndIssues();
      }
    });
  }

  // Calendar View State & Logic
  calendarCurrentDate = signal<Date>(new Date());
  calendarSearchQuery = signal<string>('');

  formattedCalendarMonth = computed(() => {
    const d = this.calendarCurrentDate();
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
    return `${months[d.getMonth()]} ${d.getFullYear()}`;
  });

  // Calendar Inline Add
  activeCalendarCreateDate = signal<string | null>(null);
  calendarInlineTitle = signal<string>('');
  calendarInlineType = signal<string>('TASK');
  calendarInlineAssigneeId = signal<number | null>(null);

  startCalendarInlineAdd(dateStr: string) {
    this.activeCalendarCreateDate.set(dateStr);
    this.calendarInlineTitle.set('');
    this.calendarInlineType.set('TASK');
    this.calendarInlineAssigneeId.set(null);
  }

  cancelCalendarInlineAdd() {
    this.activeCalendarCreateDate.set(null);
  }

  submitCalendarInlineCard() {
    const title = this.calendarInlineTitle().trim();
    if (!title) return;

    const col = this.columns()[0];
    if (!col) {
      this.toast.error('No lists in board to create task');
      return;
    }

    const payload = {
      title,
      columnId: col.id,
      type: this.calendarInlineType(),
      priority: 'MEDIUM',
      dueDate: this.activeCalendarCreateDate(),
      assigneeId: this.calendarInlineAssigneeId()
    };

    this.projectsService.createIssue(this.projectId, payload).subscribe({
      next: () => {
        this.toast.success('Task created');
        this.cancelCalendarInlineAdd();
        this.loadBoardAndIssues();
      },
      error: () => this.toast.error('Failed to create task')
    });
  }

  calendarWeeks = computed(() => {
    const current = this.calendarCurrentDate();
    const year = current.getFullYear();
    const month = current.getMonth();

    const firstDay = new Date(year, month, 1);
    let dayOfWeek = firstDay.getDay() - 1;
    if (dayOfWeek < 0) dayOfWeek = 6;

    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - dayOfWeek);

    const weeks: Array<Array<{ date: Date; dayNum: number; isCurrentMonth: boolean; isToday: boolean; dateStr: string }>> = [];
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    let curr = new Date(startDate);

    for (let w = 0; w < 5; w++) {
      const week: Array<{ date: Date; dayNum: number; isCurrentMonth: boolean; isToday: boolean; dateStr: string }> = [];
      for (let d = 0; d < 7; d++) {
        const dObj = new Date(curr);
        const y = dObj.getFullYear();
        const m = String(dObj.getMonth() + 1).padStart(2, '0');
        const day = String(dObj.getDate()).padStart(2, '0');
        const dateStr = `${y}-${m}-${day}`;

        week.push({
          date: dObj,
          dayNum: dObj.getDate(),
          isCurrentMonth: dObj.getMonth() === month,
          isToday: dateStr === todayStr,
          dateStr
        });

        curr.setDate(curr.getDate() + 1);
      }
      weeks.push(week);
    }

    return weeks;
  });

  calendarPrevMonth() {
    const d = new Date(this.calendarCurrentDate());
    d.setMonth(d.getMonth() - 1);
    this.calendarCurrentDate.set(d);
  }

  calendarNextMonth() {
    const d = new Date(this.calendarCurrentDate());
    d.setMonth(d.getMonth() + 1);
    this.calendarCurrentDate.set(d);
  }

  goToToday() {
    this.calendarCurrentDate.set(new Date());
  }

  calendarFilterAssignedToMe = signal<boolean>(false);
  calendarFilterDueThisWeek = signal<boolean>(false);
  calendarFilterDoneItems = signal<boolean>(false);
  calendarFilterStartDate = signal<string>('');
  calendarFilterDueDate = signal<string>('');
  calendarFilterAssigneeIds = signal<number[]>([]);
  calendarFilterColumnIds = signal<number[]>([]);
  calendarFilterPriorities = signal<string[]>([]);

  toggleCalendarFilterAssignee(id: number) {
    const current = this.calendarFilterAssigneeIds();
    if (current.includes(id)) {
      this.calendarFilterAssigneeIds.set(current.filter(x => x !== id));
    } else {
      this.calendarFilterAssigneeIds.set([...current, id]);
    }
  }

  toggleCalendarFilterColumn(id: number) {
    const current = this.calendarFilterColumnIds();
    if (current.includes(id)) {
      this.calendarFilterColumnIds.set(current.filter(x => x !== id));
    } else {
      this.calendarFilterColumnIds.set([...current, id]);
    }
  }

  toggleCalendarFilterPriority(priority: string) {
    const current = this.calendarFilterPriorities();
    if (current.includes(priority)) {
      this.calendarFilterPriorities.set(current.filter(x => x !== priority));
    } else {
      this.calendarFilterPriorities.set([...current, priority]);
    }
  }

  clearCalendarFilters() {
    this.calendarSearchQuery.set('');
    this.calendarFilterAssignedToMe.set(false);
    this.calendarFilterDueThisWeek.set(false);
    this.calendarFilterDoneItems.set(false);
    this.calendarFilterStartDate.set('');
    this.calendarFilterDueDate.set('');
    this.calendarFilterAssigneeIds.set([]);
    this.calendarFilterColumnIds.set([]);
    this.calendarFilterPriorities.set([]);
  }

  getIssuesForCalendarDate(dateStr: string): any[] {
    let issues = this.activeIssues();
    const query = (this.calendarSearchQuery() || '').trim().toLowerCase();

    if (query) {
      issues = issues.filter(i => 
        (i.title || '').toLowerCase().includes(query) || 
        (i.key || '').toLowerCase().includes(query)
      );
    }

    if (this.calendarFilterAssignedToMe()) {
      const myId = this.currentUser()?.id;
      if (myId) {
        issues = issues.filter(i => 
          i.assigneeId === myId || (i.members && i.members.some((m: any) => m.userId === myId || m.employeeId === myId))
        );
      }
    }

    if (this.calendarFilterDueThisWeek()) {
      const now = new Date();
      const currentDay = now.getDay();
      const diffToMonday = currentDay === 0 ? -6 : 1 - currentDay;
      const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diffToMonday);
      startOfWeek.setHours(0,0,0,0);
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6);
      endOfWeek.setHours(23,59,59,999);

      issues = issues.filter(i => {
        if (!i.dueDate) return false;
        const d = new Date(i.dueDate);
        return d >= startOfWeek && d <= endOfWeek;
      });
    }

    if (this.calendarFilterDoneItems()) {
      issues = issues.filter(i => i.status === 'DONE');
    }

    if (this.calendarFilterAssigneeIds().length > 0) {
      const selected = this.calendarFilterAssigneeIds();
      issues = issues.filter(i => {
        if (selected.includes(-1) && !i.assigneeId && (!i.members || i.members.length === 0)) return true;
        if (i.assigneeId && selected.includes(i.assigneeId)) return true;
        if (i.members && i.members.some((m: any) => selected.includes(m.employeeId))) return true;
        return false;
      });
    }

    if (this.calendarFilterColumnIds().length > 0) {
      issues = issues.filter(i => this.calendarFilterColumnIds().includes(i.columnId));
    }

    if (this.calendarFilterPriorities().length > 0) {
      issues = issues.filter(i => this.calendarFilterPriorities().includes(i.priority));
    }

    return issues.filter(i => {
      let targetDateStr = '';
      if (i.dueDate) {
        const d = new Date(i.dueDate);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        targetDateStr = `${y}-${m}-${day}`;
      } else if (i.startDate) {
        const d = new Date(i.startDate);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        targetDateStr = `${y}-${m}-${day}`;
      }

      if (targetDateStr !== dateStr) return false;

      if (this.calendarFilterStartDate() && targetDateStr < this.calendarFilterStartDate()) return false;
      if (this.calendarFilterDueDate() && targetDateStr > this.calendarFilterDueDate()) return false;

      return true;
    });
  }

  // Column Management
  isAddingColumn = signal(false);
  newColumnName = signal('');

  // Filtering
  filterQuery = signal('');
  filterMyIssues = signal(false);
  filterNoMembers = signal(false);
  filterSelectedMembers = signal<number[]>([]);
  filterMarkedComplete = signal(false);
  filterNotMarkedComplete = signal(false);
  filterNoDates = signal(false);
  filterOverdue = signal(false);
  filterDueNextDay = signal(false);
  filterDueNextWeek = signal(false);
  filterDueNextMonth = signal(false);
  filterNoLabels = signal(false);

  activeFilterCount = computed(() => {
    let count = 0;
    if (this.filterQuery()) count++;
    if (this.filterMyIssues()) count++;
    if (this.filterNoMembers()) count++;
    count += this.filterSelectedMembers().length;
    if (this.filterMarkedComplete()) count++;
    if (this.filterNotMarkedComplete()) count++;
    if (this.filterNoDates()) count++;
    if (this.filterOverdue()) count++;
    if (this.filterDueNextDay()) count++;
    if (this.filterDueNextWeek()) count++;
    if (this.filterDueNextMonth()) count++;
    if (this.filterNoLabels()) count++;
    count += this.filterSelectedLabels().length;
    return count;
  });

  clearAllFilters() {
    this.filterQuery.set('');
    this.filterMyIssues.set(false);
    this.filterNoMembers.set(false);
    this.filterSelectedMembers.set([]);
    this.filterMarkedComplete.set(false);
    this.filterNotMarkedComplete.set(false);
    this.filterNoDates.set(false);
    this.filterOverdue.set(false);
    this.filterDueNextDay.set(false);
    this.filterDueNextWeek.set(false);
    this.filterDueNextMonth.set(false);
    this.filterNoLabels.set(false);
    this.filterSelectedLabels.set([]);
  }

  // Column Actions
  activeColumnPopoverId = signal<number | null>(null);

  // Inline Quick Add Card
  addingCardColumnId = signal<number | null>(null);
  inlineCardTitle = signal<string>('');
  /** §3: hours for the card being added inline. Optional, but asked for. */
  inlineCardHours = signal<number | string | null>(null);
  /** §8: the phase for the card being added inline. */
  inlineCardPhaseId = signal<number | null>(null);
  
  // Issue Drawer / Modal
  isDrawerOpen = signal(false);
  archivedColumns = signal<any[]>([]);
  activePopover = signal<string | null>(null);
  activeMemberProfile = signal<any>(null);
  selectedIssue = signal<any>(null);
  issueForm = {
    title: '',
    description: '',
    type: 'TASK',
    priority: 'MEDIUM',
    columnId: null as number | null,
    completed: false,
    estimatedHours: null as number | null
  };
  commentText = '';
  
  @ViewChild('quillContainer') quillContainer!: ElementRef;
  private quillInstance: any = null;
  
  currentUser = this.authService.currentUser;

  hasAccess = signal<boolean>(true);

  goToProjectsList() {
    this.router.navigate(['/projects']);
  }

  activeTimerString = signal<string>('');
  private timerInterval: any;

  constructor() {
    effect(() => {
      if (this.isTimerRunning()) {
        const issue = this.selectedIssue();
        if (issue && issue.workStartedAt) {
          const startTime = new Date(issue.workStartedAt).getTime();
          this.updateActiveTimerString(startTime);
          if (this.timerInterval) clearInterval(this.timerInterval);
          this.timerInterval = setInterval(() => {
            this.updateActiveTimerString(startTime);
          }, 1000);
        }
      } else {
        if (this.timerInterval) {
          clearInterval(this.timerInterval);
          this.timerInterval = null;
        }
        this.activeTimerString.set('');
      }
    });
  }

  updateActiveTimerString(startTimeMs: number) {
    const diffMs = new Date().getTime() - startTimeMs;
    if (diffMs <= 0) {
      this.activeTimerString.set('00:00:00');
      return;
    }
    const totalSeconds = Math.floor(diffMs / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    this.activeTimerString.set(
      `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    );
  }

  ngOnDestroy(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
    }
    if (this.projectId) {
      this.socketService.leaveProject(this.projectId);
    }
    this.projectSocketSubscriptions.forEach(sub => sub.unsubscribe());
  }

  projectSocketSubscriptions: any[] = [];

  ngOnInit() {
    this.route.queryParamMap.subscribe(q => {
      const task = q.get('task');
      if (task && !isNaN(Number(task))) this.pendingTaskDeepLink = Number(task);
    });

    this.route.paramMap.subscribe(params => {
      const id = params.get('id');
      if (id) {
        // Switching boards reuses this component rather than rebuilding it, so
        // the previous project's socket handlers are still attached. Without
        // dropping them, every issue event would reload the board once per
        // board ever visited.
        if (this.projectId && this.projectId !== +id) {
          this.socketService.leaveProject(this.projectId);
          this.projectSocketSubscriptions.forEach(sub => sub.unsubscribe());
          this.projectSocketSubscriptions = [];
        }
        this.projectId = +id;
        this.hasAccess.set(true);
        this.loadProjectDetails();
        this.loadBoardAndIssues();
        this.loadActivity();
        // Needed by the task modal's Milestone picker, which can be opened
        // before the Milestones tab is ever visited.
        this.loadProjectMilestones();
        // And by the Attachments tab, which otherwise shows only task
        // attachments and reports a project full of documents as empty.
        this.loadProjectDocuments();
        // Counts for the tab strip: three numbers in one call, so the tabs
        // that own their own data can still show a badge without loading it.
        this.loadTabCounts();
        // §8: and by the Phase pickers on the task modal and the inline add,
        // both of which render only when there are phases to offer. This was
        // being called after an edit instead of on load, so the list was
        // always empty when a task was first opened and the picker never
        // appeared at all.
        this.loadPhases();
        
        // Socket integration for the whole project
        this.socketService.joinProject(this.projectId);
        this.projectSocketSubscriptions.push(
          this.socketService.onIssueUpdated().subscribe(issue => {
            // Reload the board when any issue changes (e.g. moved by another user)
            this.loadBoardAndIssues();
          })
        );

        // Restoring the remembered tab, not a click: the loads above have
        // just run. Summary and field visits are the exception — nothing has
        // fetched those yet, so they still need their own call.
        const savedTab = localStorage.getItem('project_active_tab') || 'board';
        const needsOwnFetch = ['summary', 'reports', 'field-visits', 'archived', 'discussions'].includes(savedTab);
        this.setProjectTab(savedTab, needsOwnFetch);
      }
    });
  }

  /**
   * Switching tab refetches that tab's data.
   *
   * Board, list and calendar all read the same issues, and they were loaded
   * once when the page opened — so a task created anywhere else (converted
   * from a ticket, added from My Tasks, moved by a colleague) was simply
   * absent until a full reload. Only summary, reports and field visits
   * refetched, which is why those three always looked right and the rest
   * drifted.
   *
   * Milestones, tickets and budget requests are not listed here: each sits
   * behind an *ngIf, so leaving the tab destroys the component and returning
   * builds a new one that loads itself.
   *
   * `refetch` is false only when restoring the remembered tab on page load,
   * where ngOnInit has already fetched the board and the documents — without
   * that, opening the page would request both twice.
   */
  setProjectTab(tab: string, refetch = true) {
    // The money tabs are role-gated: a PM-less viewer who lands with one of
    // them restored from localStorage (or pasted via the URL) falls back to
    // the board rather than seeing an empty, privileged panel.
    const restrictedTabs = ['milestones', 'budget-requests', 'reports'];
    if (restrictedTabs.includes(tab) && !this.canSeeFinancialTabs) {
      tab = 'board';
    }
    this.activeProjectTab.set(tab);
    localStorage.setItem('project_active_tab', tab);
    if (!refetch) return;

    switch (tab) {
      case 'summary':
      case 'reports':
        this.loadSummary();
        break;
      case 'field-visits':
        this.loadFieldVisits();
        break;
      case 'board':
      case 'list':
      case 'calendar':
        this.loadBoardAndIssues();
        break;
      case 'attachments':
        this.loadProjectDocuments();
        break;
      case 'archived':
        this.loadArchivedColumns();
        break;
    }
  }

  loadSummary() {
    this.projectsService.getProjectSummary(this.projectId).subscribe({
      next: (res) => this.projectSummary.set(res),
      error: (err) => console.error('Error loading project summary', err)
    });
  }

  get summaryTotalItems(): number {
    const summary = this.projectSummary();
    if (!summary || !summary.statusOverview) return 0;
    return summary.statusOverview.reduce((sum, item) => sum + item.count, 0);
  }

  getStatusColor(status: string): string {
    const colors: any = {
      'TODO': '#cbd5e1',
      'IN_PROGRESS': '#60a5fa',
      'IN_REVIEW': '#c084fc',
      'DONE': '#4ade80',
      'CANCELLED': '#b4b4b5'
    };
    return colors[status] || '#94a3b8';
  }

  getPriorityColor(priority: string): string {
    const colors: any = {
      'CRITICAL': '#1373e5',
      'HIGH': '#1373e5',
      'MEDIUM': '#0f4f9c',
      'LOW': '#22c55e'
    };
    return colors[priority] || '#94a3b8';
  }

  getPriorityLabel(priority: string | undefined | null): string {
    if (!priority) return 'None';
    return priority.charAt(0).toUpperCase() + priority.slice(1).toLowerCase();
  }

  getAssigneeColor(index: number): string {
    const palette = ['#3b82f6', '#8b5cf6', '#6b3fd6', '#6b3fd6', '#6b3fd6', '#10b981', '#06b6d4'];
    return palette[index % palette.length];
  }

  get donutGradient(): string {
    const summary = this.projectSummary();
    if (!summary || !summary.statusOverview || summary.statusOverview.length === 0) {
      return 'conic-gradient(#e2e8f0 0% 100%)';
    }
    
    let gradientParts = [];
    let currentPercentage = 0;
    const total = this.summaryTotalItems || 1;

    for (const stat of summary.statusOverview) {
      const percentage = (stat.count / total) * 100;
      const color = this.getStatusColor(stat.status);
      gradientParts.push(`${color} ${currentPercentage}% ${currentPercentage + percentage}%`);
      currentPercentage += percentage;
    }

    return `conic-gradient(${gradientParts.join(', ')})`;
  }

  get summaryCompletionRate(): number {
    const summary = this.projectSummary();
    if (!summary || !summary.statusOverview || summary.statusOverview.length === 0) return 0;
    const total = this.summaryTotalItems;
    if (!total) return 0;
    const done = summary.statusOverview.find(s => s.status === 'DONE')?.count || 0;
    return Math.round((done / total) * 100);
  }

  formatStatusName(status: string): string {
    const names: Record<string, string> = {
      'TODO': 'To Do',
      'IN_PROGRESS': 'In Progress',
      'IN_REVIEW': 'In Review',
      'DONE': 'Done',
      'CANCELLED': 'Cancelled',
      'ON_HOLD': 'On Hold'
    };
    return names[status] || status.replace(/_/g, ' ');
  }

  getStatusPercentage(count: number): number {
    const total = this.summaryTotalItems;
    if (!total) return 0;
    return Math.round((count / total) * 100);
  }

  getPriorityPercentage(count: number): number {
    const total = this.summaryTotalItems;
    if (!total) return 0;
    return Math.round((count / total) * 100);
  }

  loadProjectDetails() {
    this.projectsService.getProject(this.projectId).subscribe({
      next: (res) => {
        this.hasAccess.set(true);
        this.project.set(res);
      },
      error: (err) => {
        if (err.status === 403) {
          this.hasAccess.set(false);
        } else {
          console.error(err);
        }
      }
    });
  }

  /**
   * §15: milestones offered on the task modal's Milestone picker.
   *
   * Loaded once with the project rather than per card. The endpoint answers
   * permissions too, but only the identity is needed here — amounts never
   * appear on a task.
   */
  projectMilestones = signal<any[]>([]);

  loadProjectMilestones() {
    this.projectsService.getMilestones(this.projectId).subscribe({
      next: (res) => this.projectMilestones.set(res?.milestones || []),
      error: () => this.projectMilestones.set([]),
    });
  }

  /**
   * The company's phases, for the picker on the task detail (§8).
   *
   * Distinct from fdAllPhases, which holds only the phases already in use on
   * this board: the filter should not offer an option that returns nothing,
   * but the picker must offer every phase a task could be moved into.
   */
  allPhases = signal<any[]>([]);

  /**
   * Counts for the tabs whose data lives in their own components (§ tab
   * counts). Fetched once per project as three counts, not three lists.
   */
  tabCounts = signal<{ tickets: number; discussions: number; budgetRequests: number }>({
    tickets: 0, discussions: 0, budgetRequests: 0,
  });

  loadTabCounts() {
    this.projectsService.getTabCounts(this.projectId).subscribe({
      next: (c: any) => this.tabCounts.set(c || { tickets: 0, discussions: 0, budgetRequests: 0 }),
      // Silent: a missing badge is a smaller problem than an error toast over
      // a board that has otherwise loaded correctly.
      error: () => {},
    });
  }

  private loadPhases() {
    this.masterDataService.getProjectPhases(true).subscribe({
      next: (p: any) => this.allPhases.set(p || []),
      error: () => {},
    });
  }

  setIssuePhase(phaseId: number | null) {
    const issue = this.selectedIssue();
    if (!issue) return;
    const phase = this.allPhases().find((p: any) => p.id === phaseId) || null;
    // Optimistic on both, so the select and its label agree while the save
    // is in flight.
    this.selectedIssue.set({ ...issue, phaseId, phase });
    this.updateIssueDetails({ phaseId });
  }

  setIssueMilestone(milestoneId: number | null) {
    const issue = this.selectedIssue();
    if (!issue) return;
    // Optimistic, so the select does not snap back while the save is in
    // flight; loadBoardAndIssues reconciles it either way.
    this.selectedIssue.set({ ...issue, milestoneId });
    this.updateIssueDetails({ milestoneId });
  }

  loadBoardAndIssues() {
    this.isLoading.set(true);
    this.projectsService.getBoard(this.projectId).subscribe({
      next: (board) => {
        this.board.set(board);
        this.columns.set(board.columns || []);
        
        // After getting board, get issues
        this.projectsService.getIssues(this.projectId).subscribe({
          next: (issues) => {
            this.allIssues.set(issues);
            const map = new Map<number, any[]>();
            board.columns.forEach((c: any) => map.set(c.id, []));
            
            issues.forEach(issue => {
              if (issue.columnId && map.has(issue.columnId)) {
                map.get(issue.columnId)!.push(issue);
              }
            });
            this.issuesByColumn.set(map);
            // Re-point the open task modal at its refreshed row. Without this
            // the modal keeps rendering the copy it was opened with, so time
            // logged from inside it appears to do nothing until you close and
            // reopen the card.
            const open = this.selectedIssue();
            if (open) {
              const fresh = issues.find((i: any) => i.id === open.id);
              if (fresh) this.selectedIssue.set(fresh);
            }
            this.isLoading.set(false);
            // A task opened from My Tasks arrives as ?task=<id>. The id is
            // captured in ngOnInit but can only be acted on here, once
            // allIssues() is populated.
            this.consumePendingTaskDeepLink();
          },
          error: () => {
            this.isLoading.set(false);
          }
        });
      },
      error: () => {
        this.isLoading.set(false);
      }
    });
  }

  // ── Project document actions (§6) ──────────────────────────────────────

  onProjectDocumentPicked(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []);
    if (!files.length) return;

    this.documentsUploading.set(true);
    let remaining = files.length;

    for (const file of files) {
      this.projectsService.uploadProjectDocument(this.projectId, file).subscribe({
        next: () => {
          if (--remaining === 0) {
            this.documentsUploading.set(false);
            this.loadProjectDocuments();
            this.toast.success(files.length === 1 ? 'File uploaded' : `${files.length} files uploaded`);
          }
        },
        error: (err) => {
          if (--remaining === 0) this.documentsUploading.set(false);
          this.toast.error(err?.error?.message || `Could not upload ${file.name}`);
        },
      });
    }
    // Clearing it means picking the same file twice in a row still fires.
    input.value = '';
  }

  /**
   * Start renaming. The extension is shown but not edited — the server keeps
   * whatever the file was uploaded with, so offering it here would only invite
   * a change that is then silently undone.
   */
  startRenameDocument(doc: any) {
    this.renamingDocumentId.set(doc.id);
    this.renameDraft = this.documentBaseName(doc.fileName);
  }

  documentBaseName(fileName: string): string {
    const dot = (fileName || '').lastIndexOf('.');
    return dot > 0 ? fileName.slice(0, dot) : (fileName || '');
  }

  documentExtension(fileName: string): string {
    const dot = (fileName || '').lastIndexOf('.');
    return dot > 0 ? fileName.slice(dot) : '';
  }

  cancelRenameDocument() {
    this.renamingDocumentId.set(null);
    this.renameDraft = '';
  }

  confirmRenameDocument(doc: any) {
    const name = this.renameDraft.trim();
    if (!name) {
      this.toast.error('A file name is required');
      return;
    }
    if (name === this.documentBaseName(doc.fileName)) {
      this.cancelRenameDocument();
      return;
    }

    /**
     * Two kinds of row, two endpoints.
     *
     * A project document and a task attachment are different tables with
     * overlapping ids, and this used to send both to the project-document
     * endpoint -- so renaming evidence either failed or, worse, renamed an
     * unrelated project file that happened to share the number.
     */
    const rename$ = doc.isProjectDocument
      ? this.projectsService.renameProjectDocument(this.projectId, doc.id, name)
      : this.projectsService.renameAttachment(this.projectId, doc.issueId, doc.id, name);

    rename$.subscribe({
      next: () => {
        this.cancelRenameDocument();
        if (doc.isProjectDocument) this.loadProjectDocuments();
        else this.loadBoardAndIssues();
        this.toast.success('File renamed');
      },
      error: (err) => this.toast.error(err?.error?.message || 'Could not rename the file'),
    });
  }

  // §2: renaming an attachment from the task itself, not only from the
  // Evidence tab -- the task is where somebody notices IMG_4021.jpg.
  renamingTaskAttachmentId = signal<number | null>(null);
  taskAttachmentNameDraft = '';

  startRenameTaskAttachment(att: any) {
    this.taskAttachmentNameDraft = this.documentBaseName(att.fileName);
    this.renamingTaskAttachmentId.set(att.id);
  }

  cancelRenameTaskAttachment() {
    this.renamingTaskAttachmentId.set(null);
    this.taskAttachmentNameDraft = '';
  }

  confirmRenameTaskAttachment(att: any) {
    const name = this.taskAttachmentNameDraft.trim();
    if (!name || name === this.documentBaseName(att.fileName)) {
      this.cancelRenameTaskAttachment();
      return;
    }

    const issue = this.selectedIssue();
    this.projectsService.renameAttachment(this.projectId, att.issueId ?? issue?.id, att.id, name)
      .subscribe({
        next: (updated: any) => {
          this.cancelRenameTaskAttachment();
          // Patch the open task in place, so the new name is visible without
          // the modal blinking through a full reload.
          const current = this.selectedIssue();
          if (current) {
            this.selectedIssue.set({
              ...current,
              attachments: (current.attachments || []).map((a: any) =>
                a.id === att.id ? { ...a, fileName: updated?.fileName ?? name } : a,
              ),
            });
          }
          this.loadBoardAndIssues();
          this.toast.success('File renamed');
        },
        error: (err) => this.toast.error(err?.error?.message || 'Could not rename the file'),
      });
  }

  deleteProjectDocument(doc: any) {
    if (!confirm(`Delete "${doc.fileName}"? This cannot be undone.`)) return;

    this.projectsService.deleteProjectDocument(this.projectId, doc.id).subscribe({
      next: () => {
        this.loadProjectDocuments();
        this.toast.success('File deleted');
      },
      error: (err) => this.toast.error(err?.error?.message || 'Could not delete the file'),
    });
  }

  getBoardBackground(): string {
    const p = this.project();
    if (!p || !p.color) return 'url(https://images.unsplash.com/photo-1519501025264-65ba15a82390?w=1600&q=80) center/cover no-repeat';
    if (p.color.startsWith('http') || p.color.startsWith('url')) {
      return p.color.startsWith('url') ? `${p.color} center/cover no-repeat` : `url(${p.color}) center/cover no-repeat`;
    }
    return p.color;
  }

  getConnectedListIds(): string[] {
    return this.columns().map(c => `column-${c.id}`);
  }

  filterSelectedLabels = signal<number[]>([]);
  /** §8: phases ticked in the board's own filter bar. */
  filterSelectedPhases = signal<number[]>([]);

  toggleFilterPhase(phaseId: number) {
    this.filterSelectedPhases.update((ids) =>
      ids.includes(phaseId) ? ids.filter((i) => i !== phaseId) : [...ids, phaseId],
    );
  }

  getColumnIssues(columnId: number): any[] {
    let issues = (this.issuesByColumn().get(columnId) || []).filter(i => !i.isArchived);
    
    // Keyword Filter
    const query = this.filterQuery().toLowerCase().trim();
    if (query) {
      issues = issues.filter(i => 
        i.title.toLowerCase().includes(query) || 
        i.key?.toLowerCase().includes(query)
      );
    }

    // §8: Phase
    const phases = this.filterSelectedPhases();
    if (phases.length > 0) {
      issues = issues.filter(i => i.phase?.id && phases.includes(i.phase.id));
    }

    // Members Filter
    const myIssues = this.filterMyIssues();
    const noMembers = this.filterNoMembers();
    const selectedMembers = this.filterSelectedMembers();
    
    if (myIssues || noMembers || selectedMembers.length > 0) {
      issues = issues.filter(i => {
        let match = false;
        if (myIssues) {
          const myId = this.currentUser()?.id;
          if (myId && (i.assigneeId === myId || (i.members && i.members.some((m: any) => m.userId === myId)))) {
            match = true;
          }
        }
        if (noMembers && (!i.assigneeId && (!i.members || i.members.length === 0))) {
          match = true;
        }
        if (selectedMembers.length > 0) {
          if (selectedMembers.includes(i.assigneeId)) {
            match = true;
          }
          if (i.members && i.members.some((m: any) => selectedMembers.includes(m.employeeId))) {
            match = true;
          }
        }
        return match;
      });
    }

    // Status Filter (Marked as complete)
    const markedComplete = this.filterMarkedComplete();
    const notMarkedComplete = this.filterNotMarkedComplete();
    if (markedComplete || notMarkedComplete) {
      issues = issues.filter(i => {
        let match = false;
        if (markedComplete && i.completed) match = true;
        if (notMarkedComplete && !i.completed) match = true;
        return match;
      });
    }

    // Due Date Filters
    const noDates = this.filterNoDates();
    const overdue = this.filterOverdue();
    const dueNextDay = this.filterDueNextDay();
    const dueNextWeek = this.filterDueNextWeek();
    const dueNextMonth = this.filterDueNextMonth();
    
    if (noDates || overdue || dueNextDay || dueNextWeek || dueNextMonth) {
      issues = issues.filter(i => {
        if (noDates && !i.dueDate) return true;
        
        if (i.dueDate) {
          const due = new Date(i.dueDate).getTime();
          const now = new Date().getTime();
          const msPerDay = 24 * 60 * 60 * 1000;
          
          if (overdue && due < now) return true;
          if (dueNextDay && due >= now && due <= now + msPerDay) return true;
          if (dueNextWeek && due >= now && due <= now + 7 * msPerDay) return true;
          if (dueNextMonth && due >= now && due <= now + 30 * msPerDay) return true;
        }
        return false;
      });
    }

    // Labels Filter
    const noLabels = this.filterNoLabels();
    const selectedLabels = this.filterSelectedLabels();
    
    if (noLabels || selectedLabels.length > 0) {
      issues = issues.filter(i => {
        let match = false;
        if (noLabels && (!i.labels || i.labels.length === 0)) {
          match = true;
        }
        if (selectedLabels.length > 0 && i.labels && i.labels.some((il: any) => selectedLabels.includes(il.labelId || il.label?.id))) {
          match = true;
        }
        return match;
      });
    }

    return issues;
  }

  addColumn() {
    const name = this.newColumnName().trim();
    if (!name || !this.board()) return;
    
    this.projectsService.createBoardColumn(this.projectId, { name }).subscribe({
      next: (col) => {
        // Update local state
        this.columns.update(cols => [...cols, col]);
        this.issuesByColumn.update(map => {
          map.set(col.id, []);
          return new Map(map);
        });
        
        // Reset form
        this.isAddingColumn.set(false);
        this.newColumnName.set('');
        this.toast.success('List created');
      },
      error: () => this.toast.error('Failed to create list')
    });
  }

  loadArchivedColumns() {
    this.projectsService.getArchivedBoardColumns(this.projectId).subscribe({
      next: (cols) => this.archivedColumns.set(cols),
      error: () => this.toast.error('Failed to load archived lists')
    });
  }

  unarchiveColumn(columnId: number) {
    this.projectsService.unarchiveBoardColumn(this.projectId, columnId).subscribe({
      next: () => {
        this.toast.success('List unarchived');
        this.loadArchivedColumns();
        this.loadBoardAndIssues();
      },
      error: () => this.toast.error('Failed to unarchive list')
    });
  }

  toggleColumnPopover(columnId: number) {
    if (this.activeColumnPopoverId() === columnId) {
      this.activeColumnPopoverId.set(null);
    } else {
      this.activeColumnPopoverId.set(columnId);
    }
  }

  editingColumnId = signal<number | null>(null);

  startEditingColumn(col: any) {
    this.editingColumnId.set(col.id);
  }

  renameColumn(col: any, event: Event) {
    const target = event.target as HTMLInputElement;
    const newName = target.value.trim();
    if (!newName || newName === col.name) {
      this.editingColumnId.set(null);
      return;
    }
    
    this.projectsService.updateBoardColumn(this.projectId, col.id, { name: newName }).subscribe({
      next: () => {
        this.columns.update(cols => cols.map(c => c.id === col.id ? { ...c, name: newName } : c));
        this.editingColumnId.set(null);
        this.toast.success('List renamed');
      },
      error: (err) => {
        this.toast.error(err.error?.message || 'Failed to rename list');
        this.editingColumnId.set(null);
      }
    });
  }

  changeColumnColor(columnId: number, color: string) {
    this.projectsService.updateBoardColumn(this.projectId, columnId, { color }).subscribe({
      next: () => {
        this.columns.update(cols => 
          cols.map(c => c.id === columnId ? { ...c, color } : c)
        );
        this.activeColumnPopoverId.set(null);
      },
      error: () => this.toast.error('Failed to update list color')
    });
  }

  archiveColumn(columnId: number) {
    const col = this.columns().find(c => c.id === columnId);
    if (!col) return;
    
    if (!confirm('Are you sure you want to archive this list? Any cards inside will be moved to the backlog.')) return;
    
    this.projectsService.deleteBoardColumn(this.projectId, columnId).subscribe({
      next: () => {
        this.columns.update(cols => cols.filter(c => c.id !== columnId));
        this.issuesByColumn.update(map => {
          const newMap = new Map(map);
          newMap.delete(columnId);
          return newMap;
        });
        this.activeColumnPopoverId.set(null);
        this.toast.success('List archived');
        this.loadBoardAndIssues();
      },
      error: (err) => {
        this.toast.error(err.error?.message || 'Failed to archive list');
        this.activeColumnPopoverId.set(null);
      }
    });
  }

  toggleFilterMyIssues() { this.filterMyIssues.set(!this.filterMyIssues()); }
  toggleFilterNoMembers() { this.filterNoMembers.set(!this.filterNoMembers()); }
  toggleFilterMember(userId: number) {
    const current = this.filterSelectedMembers();
    if (current.includes(userId)) {
      this.filterSelectedMembers.set(current.filter(id => id !== userId));
    } else {
      this.filterSelectedMembers.set([...current, userId]);
    }
  }
  toggleFilterMarkedComplete() { this.filterMarkedComplete.set(!this.filterMarkedComplete()); }
  toggleFilterNotMarkedComplete() { this.filterNotMarkedComplete.set(!this.filterNotMarkedComplete()); }
  toggleFilterNoDates() { this.filterNoDates.set(!this.filterNoDates()); }
  toggleFilterOverdue() { this.filterOverdue.set(!this.filterOverdue()); }
  toggleFilterDueNextDay() { this.filterDueNextDay.set(!this.filterDueNextDay()); }
  toggleFilterDueNextWeek() { this.filterDueNextWeek.set(!this.filterDueNextWeek()); }
  toggleFilterDueNextMonth() { this.filterDueNextMonth.set(!this.filterDueNextMonth()); }
  toggleFilterNoLabels() { this.filterNoLabels.set(!this.filterNoLabels()); }

  getColumnName(columnId: string | number | null): string {
    if (!columnId) return 'Select List';
    const numId = Number(columnId);
    const col = this.columns().find(c => c.id === numId);
    return col ? col.name : 'Unknown';
  }

  getStatusDotClass(columnId: string | number | null): string {
    if (!columnId) return 'dot-todo';
    const numId = Number(columnId);
    const col = this.columns().find(c => c.id === numId);
    if (!col) return 'dot-todo';
    const name = col.name.toLowerCase();
    if (name.includes('progress') || name.includes('doing')) return 'dot-in-progress';
    if (name.includes('review')) return 'dot-in-review';
    if (name.includes('done') || name.includes('complete')) return 'dot-done';
    return 'dot-todo';
  }

  getStatusDotClassFromStatus(status?: string): string {
    if (!status) return 'dot-todo';
    const s = status.toUpperCase();
    if (s === 'IN_PROGRESS') return 'dot-in-progress';
    if (s === 'IN_REVIEW') return 'dot-in-review';
    if (s === 'DONE') return 'dot-done';
    return 'dot-todo';
  }

  getSubtaskProgress(): number {
    const issue = this.selectedIssue();
    if (!issue || !issue.children || issue.children.length === 0) return 0;
    const total = issue.children.length;
    const completed = issue.children.filter((c: any) => c.status === 'DONE').length;
    return Math.round((completed / total) * 100);
  }

  private optimisticallyUpdateIssueColumn(issueId: number, targetColumnId: number, targetIndex?: number) {
    const all = this.allIssues();
    const issueIndex = all.findIndex(i => i.id === issueId);
    if (issueIndex === -1) return;

    const prevColumnId = all[issueIndex].columnId;
    const updatedIssue = { ...all[issueIndex], columnId: targetColumnId };

    // 1. Update allIssues signal
    const updatedAll = [...all];
    updatedAll[issueIndex] = updatedIssue;
    this.allIssues.set(updatedAll);

    // 2. Update issuesByColumn Map signal
    const map = new Map(this.issuesByColumn());
    const prevList = (map.get(prevColumnId) || []).filter(i => i.id !== issueId);
    const targetList = (map.get(targetColumnId) || []).filter(i => i.id !== issueId);

    if (targetIndex !== undefined && targetIndex >= 0) {
      targetList.splice(targetIndex, 0, updatedIssue);
    } else {
      targetList.push(updatedIssue);
    }

    map.set(prevColumnId, prevList);
    map.set(targetColumnId, targetList);
    this.issuesByColumn.set(map);

    // 3. Update selectedIssue signal if open
    if (this.selectedIssue() && this.selectedIssue().id === issueId) {
      this.selectedIssue.set(updatedIssue);
    }
  }

  // Only the assignee's manager chain (upper hierarchy) may move a task to a Done/Archived column
  currentEmployeeId(): number | null {
    const u = this.currentUser();
    return u?.employeeId ?? u?.employee?.id ?? null;
  }

  isRestrictedColumn(columnId: number | null | undefined): boolean {
    const col = this.getColumnById(columnId);
    if (!col) return false;
    if (col.type === 'DONE') return true;
    const name = (col.name || '').toLowerCase();
    return name.includes('done') || name.includes('complete') || name.includes('archive');
  }

  getColumnById(columnId: number | null | undefined): any {
    return this.columns().find(c => c.id === columnId) || null;
  }

  // A task whose assignee is a Project Manager can only be moved into Review/Done by the project Owner.
  isAssigneeProjectManager(issue: any): boolean {
    if (!issue?.assigneeId) return false;
    const pmMembers = this.project()?.members?.filter((m: any) => m.role === 'PROJECT_MANAGER');
    return !!pmMembers?.some((m: any) => m.employeeId === issue.assigneeId);
  }

  canMoveIntoReviewOrDone(issue: any, columnId: number): boolean {
    if (this.isAssigneeProjectManager(issue) && this.isDoneOrArchiveColumn(columnId)) {
      return this.isProjectOwner;
    }
    if (this.isDoneOrArchiveColumn(columnId)) {
      return this.isProjectOwner || this.canCompleteIssue(issue);
    }
    return true;
  }

  canCompleteIssue(issue: any): boolean {
    if (!issue) return true;
    
    const myEmpId = this.currentEmployeeId();
    if (!myEmpId) return true;

    // Check if the current user is a PM for this project
    const pmMembers = this.project()?.members?.filter((m: any) => m.role === 'PROJECT_MANAGER');
    if (pmMembers && pmMembers.some((m: any) => m.employeeId === myEmpId)) {
      return true; 
    }

    if (issue.assigneeId) {
      return Array.isArray(issue.assigneeApproverIds) && issue.assigneeApproverIds.includes(myEmpId);
    }
    
    // Unassigned tasks: only managers (employees with subordinates) may complete/archive
    const u = this.currentUser();
    if (u && u.isManager === false) return false;
    return true;
  }

  canDropOnColumn(drag: any, columnId: number): boolean {
    return this.isAdjacentColumnMove(drag?.data, columnId);
  }

  private isAdjacentColumnMove(issue: any, targetColumnId: number): boolean {
    if (!issue || !issue.columnId) return true;
    const cols = this.columns();
    if (!cols || cols.length < 2) return true;
    const fromIndex = cols.findIndex((c: any) => c.id === issue.columnId);
    const toIndex = cols.findIndex((c: any) => c.id === targetColumnId);
    if (fromIndex === -1 || toIndex === -1) return true;
    return Math.abs(toIndex - fromIndex) === 1;
  }

  private isReviewColumn(columnId: number | null | undefined): boolean {
    const col = this.getColumnById(columnId);
    if (!col) return false;
    if (col.type === 'REVIEW') return true;
    const name = (col.name || '').toLowerCase();
    return name.includes('review');
  }

  private isDoneOrArchiveColumn(columnId: number | null | undefined): boolean {
    const col = this.getColumnById(columnId);
    if (!col) return false;
    if (col.type === 'DONE') return true;
    const name = (col.name || '').toLowerCase();
    return name.includes('done') || name.includes('complete') || name.includes('archive');
  }

  private needsProofUpload(columnId: number | null | undefined): boolean {
    return this.isReviewColumn(columnId) || this.isDoneOrArchiveColumn(columnId);
  }

  isStatusMoveBlocked(columnId: number): boolean {
    const issue = this.selectedIssue();
    if (!issue) return false;
    if ((this.isReviewColumn(columnId) || this.isDoneOrArchiveColumn(columnId)) && !this.canMoveIntoReviewOrDone(issue, columnId)) return true;
    if (!this.isAdjacentColumnMove(issue, columnId)) return true;
    return false;
  }

  /**
   * Report why a move was refused.
   *
   * The server knows exactly — "this task belongs to Mohit Singh, only their
   * manager can close it", "a task moves one column at a time", "waiting on
   * NEX-12". Every one of those arrived as a 403 or 400 with a message and was
   * thrown away in favour of "Please try again", which is advice that never
   * works: trying again does the same thing. The fallback is only for a network
   * failure, where there genuinely is no reason to report.
   */
  private reportMoveFailure(err: any, fallback: string) {
    this.toast.error(err?.error?.message || fallback);
  }

  drop(event: CdkDragDrop<any[]>, targetColumnId: number) {
    const issue = event.previousContainer.data[event.previousIndex];
    if (!issue) return;

    // Same column reorder
    if (event.previousContainer === event.container) {
      const map = new Map(this.issuesByColumn());
      const colIssues = [...(map.get(targetColumnId) || [])];
      moveItemInArray(colIssues, event.previousIndex, event.currentIndex);
      map.set(targetColumnId, colIssues);
      this.issuesByColumn.set(map);
      return;
    }

    // Review or Done column — check who's allowed to move the task in
    if ((this.isReviewColumn(targetColumnId) || this.isDoneOrArchiveColumn(targetColumnId)) && !this.canMoveIntoReviewOrDone(issue, targetColumnId)) {
      const msg = this.isAssigneeProjectManager(issue)
        ? 'Permission Denied: Only the project owner can move a task assigned to a Project Manager into this stage.'
        : 'Permission Denied: Only Project Managers, the project owner, or the assignee\'s manager are authorized to move tasks to Done.';
      this.toast.error(msg);
      this.loadBoardAndIssues();
      return;
    }

    // Review or Done column → open proof upload modal
    if (this.needsProofUpload(targetColumnId)) {
      this.openProofModal(issue, targetColumnId, event.currentIndex);
      return;
    }

    // Normal adjacent move (e.g., To Do → In Progress)
    this.optimisticallyUpdateIssueColumn(issue.id, targetColumnId, event.currentIndex);
    this.setIssueUpdating(issue.id, true);
    this.projectsService.updateIssue(this.projectId, issue.id, { columnId: targetColumnId }).subscribe({
      next: () => {
        this.setIssueUpdating(issue.id, false);
        this.loadBoardAndIssues();
      },
      error: (err) => {
        this.setIssueUpdating(issue.id, false);
        this.reportMoveFailure(err, 'Could not move the task — the server did not respond.');
        this.loadBoardAndIssues();
      }
    });
  }

  dropColumn(event: CdkDragDrop<any[]>) {
    const cols = [...this.columns()];
    moveItemInArray(cols, event.previousIndex, event.currentIndex);
    this.columns.set(cols);

    const columnIds = cols.map(c => c.id);
    this.projectsService.reorderBoardColumns(this.projectId, columnIds).subscribe({
      error: () => {
        this.toast.error('Failed to reorder lists');
        this.loadBoardAndIssues(); // Revert
      }
    });
  }

  updateStatus(columnId: number) {
    this.issueForm.columnId = columnId;
    this.closePopover();
    if (this.selectedIssue()) {
      const issue = this.selectedIssue();
      if ((this.isReviewColumn(columnId) || this.isDoneOrArchiveColumn(columnId)) && !this.canMoveIntoReviewOrDone(issue, columnId)) {
        const msg = this.isAssigneeProjectManager(issue)
          ? 'Permission Denied: Only the project owner can move a task assigned to a Project Manager into this stage.'
          : 'Permission Denied: Only Project Managers, the project owner, or the assignee\'s manager are authorized to move tasks to Done.';
        this.toast.error(msg);
        return;
      }
      if (!this.isAdjacentColumnMove(issue, columnId)) {
        this.toast.warning('Cannot skip columns. Please move the card one column at a time.');
        return;
      }
      // Review or Done → open proof upload modal
      if (this.needsProofUpload(columnId)) {
        this.openProofModal(issue, columnId, 0);
        return;
      }
      const issueId = issue.id;
      this.optimisticallyUpdateIssueColumn(issueId, columnId);
      this.setIssueUpdating(issueId, true);

      this.projectsService.updateIssue(this.projectId, issueId, { columnId }).subscribe({
        next: () => {
          this.setIssueUpdating(issueId, false);
          this.toast.success('Status updated');
          this.loadBoardAndIssues();
        },
        error: (err) => {
          this.setIssueUpdating(issueId, false);
          this.reportMoveFailure(err, 'Could not update the status — the server did not respond.');
          this.loadBoardAndIssues();
        }
      });
    }
  }

  updatePriority(priority: string) {
    this.issueForm.priority = priority;
    this.closePopover();
    if (this.selectedIssue()) {
      this.projectsService.updateIssue(this.projectId, this.selectedIssue().id, { priority }).subscribe({
        next: () => {
          this.toast.success('Priority updated');
          this.loadBoardAndIssues();
        },
        error: (err) => {
          this.toast.error('Failed to update priority');
        }
      });
    }
  }

  startInlineAdd(columnId: number) {
    this.addingCardColumnId.set(columnId);
    this.inlineCardTitle.set('');
    this.inlineCardHours.set(null);
    this.inlineCardPhaseId.set(null);
  }

  cancelInlineAdd() {
    this.addingCardColumnId.set(null);
    this.inlineCardTitle.set('');
    this.inlineCardHours.set(null);
    this.inlineCardPhaseId.set(null);
  }

  submitInlineCard(columnId: number) {
    const title = this.inlineCardTitle().trim();
    if (!title) return;

    const payload = {
      title,
      columnId,
      type: 'TASK',
      priority: 'MEDIUM',
      // §3: the hours the card is assigned, asked for right here. Without it
      // every card added from the board is unestimated, and an unestimated
      // task is unbounded -- so the ceiling would never apply to it.
      estimatedHours: this.inlineCardHours() != null && this.inlineCardHours() !== ''
        ? Number(this.inlineCardHours())
        : null,
      // §8: the delivery phase, chosen right here so a card added from the
      // board is not stranded without one.
      phaseId: this.inlineCardPhaseId() ?? null,
    };

    this.projectsService.createIssue(this.projectId, payload).subscribe({
      next: () => {
        this.toast.success('Card added');
        this.cancelInlineAdd();
        this.loadBoardAndIssues();
      },
      // Report what the server said: a card refused for want of a phase, or
      // for hours past the ceiling, is a sentence the user can act on, where
      // "Failed to add card" is a dead end.
      error: (err) => this.toast.error(err?.error?.message || 'Failed to add card')
    });
  }

  comments = signal<any[]>([]);
  checklists = signal<any[]>([]);
  activeChecklistTitle = '';

  getChecklistProgress(checklist: any): number {
    const items = checklist.items || [];
    if (!items.length) return 0;
    const completed = items.filter((i: any) => i.isCompleted).length;
    return Math.round((completed / items.length) * 100);
  }

  isEditingDescription = signal(false);

  openCreateIssue(columnId?: number) {
    this.selectedIssue.set(null);
    this.comments.set([]);
    this.checklists.set([]);
    this.isEditingDescription.set(true);
    this.issueForm = {
      title: '',
      description: '',
      type: 'TASK',
      priority: 'MEDIUM',
      columnId: columnId || (this.columns().length > 0 ? this.columns()[0].id : null),
      completed: false,
      estimatedHours: null
    };
    this.isDrawerOpen.set(true);
    setTimeout(() => this.initQuill(), 100);
  }

  socketSubscriptions: any[] = [];

  openIssueDetails(issue: any) {
    this.selectedIssue.set(issue);
    this.isEditingDescription.set(false);
    this.issueForm = {
      title: issue.title || '',
      description: issue.description || '',
      type: issue.type || 'TASK',
      priority: issue.priority || 'MEDIUM',
      columnId: issue.columnId,
      completed: issue.status === 'DONE',
      estimatedHours: issue.estimatedHours || null
    };
    this.isDrawerOpen.set(true);
    this.loadFeedItems(issue.id);
    this.loadChecklists(issue.id);

    // Socket integration
    this.socketService.joinIssue(issue.id);
    
    // Clear old subscriptions
    this.socketSubscriptions.forEach(sub => sub.unsubscribe());
    
    this.socketSubscriptions.push(
      this.socketService.onCommentAdded().subscribe(comment => {
        if (comment.issueId === issue.id) {
          this.comments.update(list => [...list, comment]);
          this.mergeFeed();
        }
      }),
      this.socketService.onActivityAdded().subscribe(activity => {
        if (activity.issueId === issue.id) {
          this.activities.update(list => [...list, activity]);
          this.mergeFeed();
        }
      })
    );
  }

  closeDrawer() {
    const issue = this.selectedIssue();
    if (issue) {
      this.socketService.leaveIssue(issue.id);
    }
    this.socketSubscriptions.forEach(sub => sub.unsubscribe());
    this.socketSubscriptions = [];
    
    this.isDrawerOpen.set(false);
    this.selectedIssue.set(null);
    this.isEditingDescription.set(false);
    this.quillInstance = null;
    this.closePopover();
  }

  startDescriptionEdit() {
    this.isEditingDescription.set(true);
    setTimeout(() => this.initQuill(), 50);
  }

  cancelDescriptionEdit() {
    const issue = this.selectedIssue();
    this.issueForm.description = issue ? (issue.description || '') : '';
    this.isEditingDescription.set(false);
  }

  clearDescription() {
    this.issueForm.description = '';
    if (this.quillInstance) {
      this.quillInstance.root.innerHTML = '';
    }
  }

  loadChecklists(issueId: number) {
    this.projectsService.getChecklists(this.projectId, issueId).subscribe({
      next: (res) => this.checklists.set(res || []),
      error: () => this.checklists.set([])
    });
  }

  addChecklist() {
    const title = this.activeChecklistTitle.trim() || 'Checklist';
    const issue = this.selectedIssue();
    if (!issue) return;

    this.projectsService.createChecklist(this.projectId, issue.id, title).subscribe({
      next: (newChecklist) => {
        this.checklists.update(list => [...list, newChecklist]);
        this.activeChecklistTitle = '';
        this.closePopover();
        this.toast.success('Checklist added');
      },
      error: () => this.toast.error('Failed to add checklist')
    });
  }

  // Used for tracking inputs per checklist
  checklistInputs: { [checklistId: number]: string } = {};

  addCheckitem(checklistId: number) {
    const title = (this.checklistInputs[checklistId] || '').trim();
    const issue = this.selectedIssue();
    if (!title || !issue) return;

    this.projectsService.addChecklistItem(this.projectId, issue.id, checklistId, title).subscribe({
      next: (newItem) => {
        this.checklists.update(list => list.map(c => 
          c.id === checklistId ? { ...c, items: [...(c.items || []), newItem] } : c
        ));
        this.checklistInputs[checklistId] = '';
        this.toast.success('Checklist item added');
      },
      error: () => this.toast.error('Failed to add checklist item')
    });
  }

  toggleCheckitem(checklistId: number, item: any) {
    const issue = this.selectedIssue();
    if (!issue) return;

    const isCompleted = !item.isCompleted;
    item.isCompleted = isCompleted;

    this.projectsService.updateChecklistItem(this.projectId, issue.id, checklistId, item.id, { isCompleted }).subscribe({
      error: () => {
        item.isCompleted = !isCompleted;
        this.toast.error('Failed to update item');
      }
    });
  }

  removeCheckitem(checklistId: number, itemId: number) {
    const issue = this.selectedIssue();
    if (!issue) return;

    this.projectsService.deleteChecklistItem(this.projectId, issue.id, checklistId, itemId).subscribe({
      next: () => {
        this.checklists.update(list => list.map(c => 
          c.id === checklistId ? { ...c, items: c.items.filter((i: any) => i.id !== itemId) } : c
        ));
        this.toast.success('Item removed');
      },
      error: () => this.toast.error('Failed to remove item')
    });
  }

  isGeneratingChecklist = signal(false);

  generateChecklist() {
    const issue = this.selectedIssue();
    if (!issue || this.isGeneratingChecklist()) return;

    this.isGeneratingChecklist.set(true);
    this.closePopover(); // close any open popover
    
    this.projectsService.generateChecklist(this.projectId, issue.id).subscribe({
      next: (newChecklist) => {
        this.checklists.update(list => [...list, newChecklist]);
        this.isGeneratingChecklist.set(false);
        this.toast.success('AI Checklist generated successfully');
      },
      error: () => {
        this.isGeneratingChecklist.set(false);
        this.toast.error('Failed to generate checklist');
      }
    });
  }

  editingChecklistId = signal<number | null>(null);
  editingChecklistTitle = '';

  startEditingChecklistTitle(checklist: any) {
    this.editingChecklistId.set(checklist.id);
    this.editingChecklistTitle = checklist.title;
  }

  saveChecklistTitle(checklist: any) {
    const newTitle = this.editingChecklistTitle.trim() || 'Checklist';
    const issue = this.selectedIssue();
    if (!issue) return;

    if (newTitle === checklist.title) {
      this.editingChecklistId.set(null);
      return;
    }

    this.projectsService.updateChecklist(this.projectId, issue.id, checklist.id, newTitle).subscribe({
      next: () => {
        this.checklists.update(list => list.map(c => c.id === checklist.id ? { ...c, title: newTitle } : c));
        this.editingChecklistId.set(null);
        this.toast.success('Checklist title updated');
      },
      error: () => this.toast.error('Failed to update title')
    });
  }

  cancelEditingChecklistTitle() {
    this.editingChecklistId.set(null);
  }

  deleteChecklist(checklistId: number) {
    const issue = this.selectedIssue();
    if (!issue) return;
    
    if (confirm('Are you sure you want to delete this checklist?')) {
      this.projectsService.deleteChecklist(this.projectId, issue.id, checklistId).subscribe({
        next: () => {
          this.checklists.update(list => list.filter(c => c.id !== checklistId));
          this.toast.success('Checklist deleted');
        },
        error: () => this.toast.error('Failed to delete checklist')
      });
    }
  }

  isEditingComment = signal(false);
  isWatching = signal(false);

  toggleWatch() {
    this.isWatching.update(v => !v);
    this.toast.success(this.isWatching() ? 'Now watching this card' : 'Stopped watching card');
  }

  deleteComment(commentId: number) {
    const issue = this.selectedIssue();
    if (!issue) return;

    this.projectsService.deleteIssueComment(this.projectId, issue.id, commentId).subscribe({
      next: () => {
        this.comments.update(list => list.filter(c => c.id !== commentId));
        this.toast.success('Comment deleted');
      },
      error: () => this.toast.error('Failed to delete comment')
    });
  }

  activities = signal<any[]>([]);
  feedItems = signal<any[]>([]);
  
  loadFeedItems(issueId: number) {
    // Fetch comments and activities, then merge and sort
    this.projectsService.getIssueComments(this.projectId, issueId).subscribe({
      next: (comms) => {
        this.comments.set(comms || []);
        this.mergeFeed();
      },
      error: () => {
        this.comments.set([]);
        this.mergeFeed();
      }
    });

    this.projectsService.getIssueActivities(this.projectId, issueId).subscribe({
      next: (acts) => {
        this.activities.set(acts || []);
        this.mergeFeed();
      },
      error: () => {
        this.activities.set([]);
        this.mergeFeed();
      }
    });
  }

  mergeFeed() {
    const c = this.comments().map(c => ({ ...c, feedType: 'COMMENT' }));
    const a = this.activities().map(a => ({ ...a, feedType: 'ACTIVITY' }));
    const merged = [...c, ...a].sort((x, y) => new Date(x.createdAt).getTime() - new Date(y.createdAt).getTime());
    this.feedItems.set(merged);
  }

  postComment() {
    const text = this.commentText.trim();
    const issue = this.selectedIssue();
    if (!text || !issue) return;

    this.projectsService.addIssueComment(this.projectId, issue.id, text).subscribe({
      next: (newComment) => {
        this.comments.update(list => [...list, newComment]);
        this.commentText = '';
        this.isEditingComment.set(false);
        this.toast.success('Comment added');
      },
      error: () => this.toast.error('Failed to post comment')
    });
  }



  // Workload Modal & AG Grid
  isWorkloadModalOpen = signal(false);
  workloadModalTitle = signal('');
  workloadGridData = signal<any[]>([]);

  workloadColDefs: ColDef[] = [
    { field: 'key', headerName: 'ID', width: 100 },
    { field: 'title', headerName: 'Task', flex: 1, filter: true },
    { 
      field: 'status', 
      headerName: 'Status', 
      width: 140,
      cellRenderer: (params: any) => {
        const val = params.value || '';
        let color = '#94a3b8'; // default gray
        let bg = '#f1f5f9';
        if (val === 'DONE') { color = '#16a34a'; bg = '#dcfce7'; }
        else if (val === 'TODO') { color = '#64748b'; bg = '#f1f5f9'; }
        else if (val === 'IN_PROGRESS') { color = '#2563eb'; bg = '#dbeafe'; }
        else if (val === 'IN_REVIEW') { color = '#9333ea'; bg = '#f3e8ff'; }
        
        return `<span style="background-color: ${bg}; color: ${color}; padding: 4px 10px; border-radius: 9999px; font-size: 12px; font-weight: 600;">${val.replace('_', ' ')}</span>`;
      }
    },
    { 
      field: 'priority', 
      headerName: 'Priority', 
      width: 130,
      cellRenderer: (params: any) => {
        const val = params.value || '';
        let color = '#94a3b8';
        if (val === 'CRITICAL') color = '#1373e5';
        else if (val === 'HIGH') color = '#1373e5';
        else if (val === 'MEDIUM') color = '#4f2aa7';
        else if (val === 'LOW') color = '#16a34a';
        
        return `<div style="display: flex; align-items: center; gap: 6px;">
                  <div style="width: 8px; height: 8px; border-radius: 50%; background-color: ${color};"></div>
                  <span style="font-size: 13px; font-weight: 500; color: #334155;">${val}</span>
                </div>`;
      }
    },
    { 
      headerName: 'Action', 
      width: 100, 
      cellRenderer: (params: any) => {
        return `<button style="background-color: #eff6ff; color: #2563eb; border: none; padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 600; transition: background-color 0.2s;" onmouseover="this.style.backgroundColor='#dbeafe'" onmouseout="this.style.backgroundColor='#eff6ff'">
                  View
                </button>`;
      }
    }
  ];

  openWorkloadModal(assigneeId: number | null, assigneeName: string) {
    this.workloadModalTitle.set(`${assigneeName}'s Assigned Tasks`);
    const all = this.activeIssues();
    
    let filtered = [];
    if (assigneeId === null) {
      filtered = all.filter(issue => 
        !issue.assigneeId && (!issue.members || issue.members.length === 0)
      );
    } else {
      filtered = all.filter(issue => 
        issue.assigneeId === assigneeId || 
        (issue.members && issue.members.some((m: any) => m.employeeId === assigneeId))
      );
    }
    
    this.workloadGridData.set(filtered);
    this.isWorkloadModalOpen.set(true);
  }

  closeWorkloadModal() {
    this.isWorkloadModalOpen.set(false);
  }

  onWorkloadGridCellClicked(event: CellClickedEvent) {
    if (event.colDef.headerName === 'Action') {
      const issue = event.data;
      if (issue) {
        this.closeWorkloadModal();
        this.openIssueDetails(issue);
      }
    }
  }

  // List Tab Grid
  /**
   * The hours picture for one task (§7): what it was assigned, what has been
   * logged against it, and what is left.
   *
   * Mirrors the server's rule in tasks/task-hours.ts deliberately -- a task
   * with no estimate is unbounded, not a task with zero hours left, so it
   * reads as a dash rather than an alarming red 0.
   */
  listTaskHours(issue: any): { assigned: number | null; logged: number; remaining: number | null } {
    const loggedMin = (issue?.timeLogs || []).reduce(
      (sum: number, l: any) => sum + (l.durationMin || 0), 0,
    );
    const logged = Math.round((loggedMin / 60) * 100) / 100;

    if (issue?.estimatedHours == null) return { assigned: null, logged, remaining: null };

    const allowed = issue.estimatedHours + (issue.additionalHours || 0);
    return {
      assigned: allowed,
      logged,
      remaining: Math.round(Math.max(0, allowed - logged) * 100) / 100,
    };
  }

  /** Attachments on a task are its evidence (§2/§7) -- the same rows. */
  listTaskEvidence(issue: any): any[] {
    return issue?.attachments || [];
  }

  /** Renders hours as "4h", or an em dash when the task was never estimated. */
  private hoursCell(value: number | null, color: string): string {
    if (value == null) return '<span style="color:#cbd5e1;">—</span>';
    return `<span style="font-size:13px;font-weight:600;color:${color};">${value}h</span>`;
  }

  listGridColDefs: ColDef[] = [
    { field: 'key', headerName: 'ID', width: 100, pinned: 'left' },
    { field: 'title', headerName: 'Task', minWidth: 200, flex: 1, filter: true },
    { 
      headerName: 'Status', 
      width: 150,
      // One column where there used to be two: a board list is a workflow
      // step (each column carries its status), so "List" and "Status" said
      // the same thing. Archived rows read as their own state.
      valueGetter: (params: any) => {
        const i = params.data;
        return i?.isArchived ? 'ARCHIVED' : (i?.status || 'TODO');
      },
      cellRenderer: (params: any) => {
        const val = params.value || 'TODO';
        let label = val.replace('_', ' ');
        let color = '#64748b'; let bg = '#f1f5f9';
        if (val === 'DONE') { label = 'Completed'; color = '#16a34a'; bg = '#dcfce7'; }
        else if (val === 'TODO') { label = 'To Do'; color = '#64748b'; bg = '#f1f5f9'; }
        else if (val === 'IN_PROGRESS') { label = 'In Progress'; color = '#2563eb'; bg = '#dbeafe'; }
        else if (val === 'IN_REVIEW') { label = 'In Review'; color = '#9333ea'; bg = '#f3e8ff'; }
        else if (val === 'ARCHIVED') { label = 'Archived'; color = '#94a3b8'; bg = '#f1f5f9'; }
        return `<span style="background-color: ${bg}; color: ${color}; padding: 4px 10px; border-radius: 9999px; font-size: 12px; font-weight: 600;">${label}</span>`;
      }
    },
    { 
      field: 'priority', 
      headerName: 'Priority', 
      width: 130,
      cellRenderer: (params: any) => {
        const val = params.value || '';
        let color = '#94a3b8';
        if (val === 'CRITICAL') color = '#1373e5';
        else if (val === 'HIGH') color = '#1373e5';
        else if (val === 'MEDIUM') color = '#4f2aa7';
        else if (val === 'LOW') color = '#16a34a';
        return `<div style="display: flex; align-items: center; gap: 6px;">
                  <div style="width: 8px; height: 8px; border-radius: 50%; background-color: ${color};"></div>
                  <span style="font-size: 13px; font-weight: 500; color: #334155;">${val}</span>
                </div>`;
      }
    },
    { 
      headerName: 'Assignee', 
      width: 160, 
      cellRenderer: (params: any) => {
        const issue = params.data;
        if (!issue) return '';
        
        const allMembers: any[] = [];
        if (issue.assignee) {
          allMembers.push(issue.assignee);
        }
        if (issue.members && issue.members.length > 0) {
          issue.members.forEach((m: any) => {
            if (m.employee) allMembers.push(m.employee);
          });
        }
        
        if (allMembers.length === 0) {
          return '<span style="color: #94a3b8; font-size: 12px;">Unassigned</span>';
        }

        const maxVisible = 3;
        const visibleMembers = allMembers.slice(0, maxVisible);
        const extraCount = allMembers.length - maxVisible;
        
        let membersHtml = '';
        visibleMembers.forEach((emp: any, index: number) => {
          const name = `${emp.firstName || ''} ${emp.lastName || ''}`.trim();
          const marginLeft = index === 0 ? '0px' : '-8px';
          const avatar = emp.avatarUrl 
            ? `<img src="${emp.avatarUrl}" title="${name}" style="width: 26px; height: 26px; border-radius: 50%; border: 2px solid white; margin-left: ${marginLeft}; object-fit: cover; box-shadow: 0 1px 2px rgba(0,0,0,0.1);">` 
            : `<div title="${name}" style="width: 26px; height: 26px; border-radius: 50%; border: 2px solid white; margin-left: ${marginLeft}; background: #6366f1; color: white; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 600; box-shadow: 0 1px 2px rgba(0,0,0,0.1);">${(emp.firstName || 'U')[0]}</div>`;
          membersHtml += avatar;
        });

        if (extraCount > 0) {
          membersHtml += `<div title="${extraCount} more assignees" style="width: 26px; height: 26px; border-radius: 50%; border: 2px solid white; margin-left: -8px; background: #e2e8f0; color: #475569; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; box-shadow: 0 1px 2px rgba(0,0,0,0.1);">+${extraCount}</div>`;
        }

        return `<div style="display: flex; align-items: center; height: 100%;">${membersHtml}</div>`;
      }
    },
    // §6: where the task came from. Sortable, so every ticket-raised task in
    // the project can be brought together in one click.
    {
      headerName: 'Origin',
      width: 130,
      valueGetter: (params: any) => params.data?.projectTicket?.ticketNumber || '',
      cellRenderer: (params: any) => {
        const tkt = params.data?.projectTicket;
        if (!tkt) return '<span style="color:#cbd5e1;">—</span>';
        const title = String(tkt.title || '').replace(/"/g, '&quot;');
        return `<span title="From ticket ${tkt.ticketNumber}: ${title}" style="display:inline-block;padding:2px 7px;background:#eff6ff;color:#4f2aa7;border:1px solid #dbeafe;border-radius:4px;font-size:11px;font-weight:600;letter-spacing:0.02em;line-height:16px;">${tkt.ticketNumber}</span>`;
      },
    },

    // §8: the delivery phase this task belongs to.
    {
      headerName: 'Phase',
      width: 130,
      valueGetter: (params: any) => params.data?.phase?.name || '',
      cellRenderer: (params: any) => {
        const name = params.data?.phase?.name;
        if (!name) return '<span style="color:#cbd5e1;">—</span>';
        // A retired phase still reads as itself, just muted -- the task is
        // genuinely in it, whatever the phase list now offers.
        const retired = params.data?.phase?.isActive === false;
        const bg = retired ? '#f1f5f9' : '#eef2ff';
        const fg = retired ? '#94a3b8' : '#4338ca';
        return `<span style="background:${bg};color:${fg};padding:3px 9px;border-radius:9999px;font-size:12px;font-weight:600;">${name}</span>`;
      },
    },

    // §7: assigned, logged and remaining as three sortable columns rather than
    // one combined cell -- "who is out of hours" is a question you answer by
    // sorting on Remaining, which a single formatted string cannot do.
    {
      headerName: 'Assigned',
      width: 110,
      type: 'numericColumn',
      valueGetter: (params: any) => this.listTaskHours(params.data).assigned,
      cellRenderer: (params: any) => this.hoursCell(params.value, '#334155'),
    },
    {
      headerName: 'Logged',
      width: 100,
      type: 'numericColumn',
      valueGetter: (params: any) => this.listTaskHours(params.data).logged,
      cellRenderer: (params: any) => this.hoursCell(params.value, '#0f766e'),
    },
    {
      headerName: 'Remaining',
      width: 115,
      type: 'numericColumn',
      valueGetter: (params: any) => this.listTaskHours(params.data).remaining,
      cellRenderer: (params: any) => {
        const v = params.value;
        if (v == null) return this.hoursCell(null, '');
        // Red at zero: the task cannot take more time without an approved
        // additional-hours request (§3).
        return this.hoursCell(v, v <= 0 ? '#0f4f9c' : '#047857');
      },
    },

    // §7/§2: evidence, previewable without opening the task.
    {
      headerName: 'Evidence',
      width: 150,
      sortable: true,
      valueGetter: (params: any) => this.listTaskEvidence(params.data).length,
      cellRenderer: (params: any) => {
        const atts = this.listTaskEvidence(params.data);
        if (!atts.length) return '<span style="color:#cbd5e1;">—</span>';

        // Up to three thumbnails, then a count. data-att-url is what the cell
        // click handler looks for, so a preview does not also open the task.
        const shown = atts.slice(0, 3);
        const thumbs = shown.map((a: any) => {
          const name = (a.fileName || 'file').replace(/"/g, '&quot;');
          const isImage = /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(a.fileName || '');
          const common = `data-att-url="${a.fileUrl}" title="${name}" style="width:24px;height:24px;border-radius:4px;border:1px solid #e2e8f0;cursor:pointer;flex-shrink:0;`;
          return isImage
            ? `<img ${common}object-fit:cover;" src="${a.fileUrl}">`
            : `<div ${common}background:#f1f5f9;color:#64748b;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;">${(a.fileName || 'F').split('.').pop()?.slice(0, 3).toUpperCase()}</div>`;
        }).join('');

        const more = atts.length > 3
          ? `<span style="font-size:11px;color:#64748b;font-weight:600;">+${atts.length - 3}</span>`
          : '';
        const count = `<span style="font-size:12px;color:#475569;font-weight:600;margin-left:2px;">${atts.length}</span>`;

        return `<div style="display:flex;align-items:center;gap:4px;height:100%;">${thumbs}${more}${count}</div>`;
      },
    },

    { 
      headerName: 'Due Date', 
      width: 150, 
      valueGetter: (params: any) => {
        if (!params.data || (!params.data.dueDate && !params.data.startDate)) return '';
        return this.formatDisplayDueDate(params.data);
      }
    },
    { 
      field: 'createdAt', 
      headerName: 'Created At', 
      width: 140, 
      valueGetter: (params: any) => {
        if (!params.data?.createdAt) return '';
        const d = new Date(params.data.createdAt);
        return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      }
    },
    { 
      field: 'updatedAt', 
      headerName: 'Updated At', 
      width: 140, 
      valueGetter: (params: any) => {
        if (!params.data?.updatedAt) return '';
        const d = new Date(params.data.updatedAt);
        return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      }
    },
    { 
      headerName: 'Action', 
      width: 100, 
      pinned: 'right',
      cellRenderer: () => {
        return `<button style="background-color: #eff6ff; color: #2563eb; border: none; padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 600; transition: background-color 0.2s;" onmouseover="this.style.backgroundColor='#dbeafe'" onmouseout="this.style.backgroundColor='#eff6ff'">
                  View
                </button>`;
      }
    }
  ];

  onListGridCellClicked(event: CellClickedEvent) {
    // An evidence thumbnail is rendered inside the row, so a click on one
    // arrives here as an ordinary cell click too. Previewing wins; anything
    // else falls through to opening the task.
    const hit = (event.event?.target as HTMLElement | undefined)
      ?.closest?.('[data-att-url]') as HTMLElement | null;
    const url = hit?.getAttribute('data-att-url');
    if (url) {
      window.open(url, '_blank', 'noopener');
      return;
    }

    const issue = event.data;
    if (issue) {
      this.openIssueDetails(issue);
    }
  }

  listGridApi: any;

  onListGridReady(params: any) {
    this.listGridApi = params.api;
  }

  exportListGrid(format: 'csv' | 'excel' | 'json') {
    const data = this.filteredListIssues();
    const fileName = `project_${this.projectId}_tasks`;

    if (format === 'csv') {
      if (this.listGridApi) {
        this.listGridApi.exportDataAsCsv({ fileName: `${fileName}.csv` });
      } else {
        let csv = 'ID,Task,Status,Priority,Due Date,Created At,Updated At\n';
        data.forEach(i => {
          csv += `"${i.key || ''}","${(i.title || '').replace(/"/g, '""')}","${i.status || ''}","${i.priority || ''}","${i.dueDate || ''}","${i.createdAt || ''}","${i.updatedAt || ''}"\n`;
        });
        this.downloadFile(csv, `${fileName}.csv`, 'text/csv');
      }
      this.toast.success('Tasks exported as CSV');
    } else if (format === 'excel') {
      let tsv = 'ID\tTask\tStatus\tPriority\tDue Date\tCreated At\tUpdated At\n';
      data.forEach(i => {
        tsv += `${i.key || ''}\t${(i.title || '').replace(/\t/g, ' ')}\t${i.status || ''}\t${i.priority || ''}\t${i.dueDate || ''}\t${i.createdAt || ''}\t${i.updatedAt || ''}\n`;
      });
      this.downloadFile(tsv, `${fileName}.xls`, 'application/vnd.ms-excel');
      this.toast.success('Tasks exported as Excel (.xls)');
    } else if (format === 'json') {
      const jsonContent = JSON.stringify(data, null, 2);
      this.downloadFile(jsonContent, `${fileName}.json`, 'application/json');
      this.toast.success('Tasks exported as JSON');
    }
  }

  /**
   * Export the roadmap for a client (§9).
   *
   * Built from the same tasks the Gantt draws, but flattened: a client reading
   * "what is planned for each week" does not want a chart they have to
   * interpret, they want rows they can scan, sort and put in a status report.
   *
   * Only dated work is included. A task with no start and no due date has no
   * place on a roadmap -- it would export as a row of blanks and invite the
   * question "when is this then", which is exactly what the roadmap is for.
   */
  exportRoadmap(format: 'csv' | 'excel') {
    const rows = this.roadmapExportRows();
    if (!rows.length) {
      this.toast.error('Nothing to export — no task on this project has dates yet.');
      return;
    }

    const headers = [
      'Project', 'Phase', 'Task', 'Week', 'Start date', 'End date', 'Status', 'Assigned to',
    ];
    const fileName = `${(this.project()?.name || 'project').replace(/[^\w-]+/g, '_')}_roadmap`;

    if (format === 'excel') {
      // Tab-separated, which Excel opens natively without a parse dialog.
      const tsv = [headers.join('\t')]
        .concat(rows.map((r) => r.map((c) => String(c).replace(/\t/g, ' ')).join('\t')))
        .join('\n');
      this.downloadFile(tsv, `${fileName}.xls`, 'application/vnd.ms-excel');
      this.toast.success('Roadmap exported as Excel (.xls)');
      return;
    }

    const csv = [headers, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    this.downloadFile(csv, `${fileName}.csv`, 'text/csv');
    this.toast.success('Roadmap exported as CSV');
  }

  /** One row per dated task, ordered as the roadmap reads: earliest first. */
  private roadmapExportRows(): string[][] {
    const projectName = this.project()?.name || '';

    return this.activeIssues()
      .filter((i: any) => i.startDate || i.dueDate)
      .sort((a: any, b: any) => {
        const at = new Date(a.startDate || a.dueDate).getTime();
        const bt = new Date(b.startDate || b.dueDate).getTime();
        return at - bt;
      })
      .map((i: any) => {
        const start = i.startDate ? new Date(i.startDate) : null;
        const end = i.dueDate ? new Date(i.dueDate) : null;
        const assignees = [
          i.assignee ? `${i.assignee.firstName} ${i.assignee.lastName}`.trim() : null,
          ...(i.members || []).map((m: any) =>
            m.employee ? `${m.employee.firstName} ${m.employee.lastName}`.trim() : null,
          ),
        ].filter(Boolean);

        return [
          projectName,
          i.phase?.name || '',
          `${i.key} — ${i.title}`,
          this.weekLabel(start || end),
          this.exportDate(start),
          this.exportDate(end),
          this.readableStatus(i.status),
          // Deduplicated: the assignee is usually a member as well, and the
          // same name twice in a client-facing document looks like an error.
          Array.from(new Set(assignees)).join(', '),
        ];
      });
  }

  /**
   * The week a task sits in, as a client would say it: "Week of 15 Sep 2026".
   *
   * An ISO week number alone ("W38") means nothing to somebody outside the
   * team, and the whole point of this export is that it can be sent out.
   */
  private weekLabel(date: Date | null): string {
    if (!date || isNaN(date.getTime())) return '';
    const monday = new Date(date);
    // getDay() is 0 for Sunday, which belongs to the week that just ended.
    const offset = (monday.getDay() + 6) % 7;
    monday.setDate(monday.getDate() - offset);
    return `Week of ${monday.toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
    })}`;
  }

  private exportDate(date: Date | null): string {
    if (!date || isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  /** TODO → "To Do": the stored value is not what a client should read. */
  private readableStatus(status: string): string {
    switch (status) {
      case 'TODO': return 'To Do';
      case 'IN_PROGRESS': return 'In Progress';
      case 'IN_REVIEW': return 'In Review';
      case 'DONE': return 'Done';
      case 'CANCELLED': return 'Cancelled';
      default: return status || '';
    }
  }

  private downloadFile(content: string, fileName: string, mimeType: string) {
    const blob = new Blob([content], { type: mimeType });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  popoverPosition = signal<{x: number, y: number, maxHeight?: number} | null>(null);
  activeMoreTasksDay = signal<{ dateStr: string, issues: any[] } | null>(null);

  togglePopover(popoverName: string, event?: MouseEvent, contextData?: any) {
    if (event) {
      event.stopPropagation();
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      
      let y = rect.bottom + 8;
      let maxHeight = window.innerHeight - y - 16;
      
      if (popoverName === 'more-tasks') {
        // Open more-tasks above the button by default
        const itemsCount = contextData?.issues?.length || 3;
        const approxHeight = (itemsCount * 34) + 60; // 30px per item + 4px gap + 60px header/padding
        
        y = rect.top - approxHeight - 8;
        
        // If it doesn't fit above, fallback to opening below
        if (y < 16) {
          y = rect.bottom + 8;
          maxHeight = window.innerHeight - y - 16;
        } else {
          maxHeight = rect.top - 16;
        }
      } else {
        // Default logic for other popovers like dates
        // If not enough space below, and more space above, open upwards
        if (maxHeight < 450 && rect.top > 450) {
          const approxHeight = 520;
          y = rect.top - approxHeight - 8;
          if (y < 16) y = 16;
          maxHeight = window.innerHeight - 32;
        } else if (maxHeight < 300) {
          // If neither fits well, just center it vertically as a fallback
          y = 32;
          maxHeight = window.innerHeight - 64;
        }
      }

      this.popoverPosition.set({ x: rect.left, y, maxHeight });
    }

    if (this.activePopover() === popoverName) {
      this.closePopover();
    } else {
      if (popoverName === 'checklist') {
        this.activeChecklistTitle = 'Checklist';
      }
      if (popoverName === 'labels') {
        this.loadProjectLabels();
        this.labelPopoverMode.set('list');
      }
      if (popoverName === 'filter') {
        this.loadProjectLabels();
      }
      if (popoverName === 'dates') {
        this.initDatesForm();
      }
      if (popoverName === 'archivedLists') {
        this.loadArchivedColumns();
      }
      if (popoverName === 'members') {
        this.loadCompanyMembers();
        this.memberSearchQuery = '';
      }
      if (popoverName === 'share') {
        this.loadCompanyMembers();
        this.memberSearchQuery = '';
        this.shareTab.set('members');
      }
      if (popoverName === 'more-tasks' && contextData) {
        this.activeMoreTasksDay.set(contextData);
      } else {
        this.activeMoreTasksDay.set(null);
      }
      
      this.activePopover.set(popoverName);
    }
  }

  get isProjectOwner(): boolean {
    const user = this.currentUser();
    if (!user) return false;
    if (user.role === 'SUPERADMIN' || user.role === 'ADMIN') return true;

    const p = this.project();
    if (!p) return false;

    const empId = user.employee?.id || user.id;
    if (p.leadId && p.leadId === empId) return true;

    // Fallback: first member treated as Owner if no leadId set on the project
    if (!p.leadId && p.members && p.members.length > 0 &&
        (p.members[0].employeeId === empId || p.members[0].employee?.id === empId)) {
      return true;
    }

    return false;
  }

  get canManageMembers(): boolean {
    const user = this.currentUser();
    if (!user) return false;
    if (user.role === 'SUPERADMIN' || user.role === 'ADMIN') return true;
    
    const p = this.project();
    if (!p) return false;
    
    const empId = user.employee?.id || user.id;
    if (p.leadId && p.leadId === empId) return true;

    const myMember = p.members?.find((m: any) => 
      m.employeeId === empId || m.employee?.id === empId || m.userId === user.id || m.employee?.userId === user.id
    );
    if (myMember && myMember.role === 'ADMIN') return true;

    return false;
  }

  /**
   * The Milestones, Budget requests and Reports tabs carry the project's
   * money story — scope, spend and cost. Only finance/accounts, the super
   * admin and the project's own manager (PROJECT_MANAGER role) may see them.
   */
  get canSeeFinancialTabs(): boolean {
    const user = this.currentUser();
    if (!user) return false;
    if (user.role === 'SUPERADMIN' || user.role === 'FINANCE') return true;

    const p = this.project();
    if (!p?.members) return false;

    const empId = user.employeeId ?? user.employee?.id ?? user.id;
    return p.members.some(
      (m: any) =>
        (m.employeeId === empId || m.employee?.id === empId) &&
        m.role === 'PROJECT_MANAGER'
    );
  }

  isProjectMember(employeeId: number): boolean {
    const p = this.project();
    if (!p || !p.members) return false;
    return p.members.some((m: any) => m.employeeId === employeeId || m.employee?.id === employeeId);
  }

  getMemberRoleLabel(employeeId: number): string {
    const p = this.project();
    if (!p) return 'Member';

    if (p.leadId && (p.leadId === employeeId || p.lead?.id === employeeId)) {
      return 'Owner';
    }

    const member = p.members?.find((m: any) => m.employeeId === employeeId || m.employee?.id === employeeId);
    if (member && (member.role === 'ADMIN' || member.role === 'OWNER')) {
      return member.role === 'OWNER' ? 'Owner' : 'Admin';
    }

    // If first member in project and role is ADMIN, treat as Owner if no leadId set
    if (!p.leadId && p.members && p.members.length > 0 && (p.members[0].employeeId === employeeId || p.members[0].employee?.id === employeeId)) {
      return 'Owner';
    }

    return 'Member';
  }

  getProjectMemberRole(employeeId: number): string {
    const p = this.project();
    if (!p || !p.members) return '';
    const member = p.members.find((m: any) => m.employeeId === employeeId || m.employee?.id === employeeId);
    return member?.role || '';
  }

  addProjectMember(employee: any) {
    if (!this.canManageMembers) {
      this.toast.error('Only Admins or Project Lead can add members');
      return;
    }
    if (this.addingMemberId() !== null) return;

    const role = this.inviteRole();
    this.addingMemberId.set(employee.id);
    this.projectsService.addProjectMember(this.projectId, employee.id, role).subscribe({
      next: () => {
        this.loadProjectDetails(); // Reload to get updated roles/state from server
        this.addingMemberId.set(null);
        this.toast.success(
          `${employee.firstName || 'Member'} added as ${this.inviteRoleLabel().toLowerCase()}`,
        );
      },
      error: (err: any) => {
        this.addingMemberId.set(null);
        this.toast.error(err?.error?.message || 'Failed to add member to project');
      },
    });
  }

  isAddingMember(employeeId: number): boolean {
    return this.addingMemberId() === employeeId;
  }

  removeProjectMember(employee: any) {
    if (!this.canManageMembers) {
      this.toast.error('Only Admins or Project Lead can remove members');
      return;
    }
    this.projectsService.removeProjectMember(this.projectId, employee.id).subscribe({
      next: () => {
        // Optimistic update
        const p = this.project();
        if (p && p.members) {
          this.project.set({
            ...p,
            members: p.members.filter((m: any) => m.employeeId !== employee.id && m.employee?.id !== employee.id)
          });
        }
        
        this.toast.success(`${employee.firstName || 'Member'} removed from project`);
        
        // If the user removed themselves, redirect to projects list
        if (this.isSelf(employee.id)) {
          this.router.navigate(['/projects']);
        } else {
          this.loadProjectDetails(); // Reload to get updated leadId/roles from server
        }
      },
      error: () => this.toast.error('Failed to remove member from project')
    });
  }

  toggleFilterLabel(labelId: number) {
    const current = this.filterSelectedLabels();
    if (current.includes(labelId)) {
      this.filterSelectedLabels.set(current.filter(id => id !== labelId));
    } else {
      this.filterSelectedLabels.set([...current, labelId]);
    }
  }

  isCurrentUserPM(): boolean {
    const myEmpId = this.currentEmployeeId();
    if (!myEmpId) return false;
    const pmMembers = this.project()?.members?.filter((m: any) => m.role === 'PROJECT_MANAGER');
    return pmMembers && pmMembers.some((m: any) => m.employeeId === myEmpId);
  }

  approveIssue(issueId: number) {
    if (!this.isCurrentUserPM()) {
      this.toast.error('Only Project Managers can approve tasks.');
      return;
    }
    this.projectsService.reviewIssue(this.projectId, issueId, { action: 'APPROVE' }).subscribe({
      next: (updatedIssue) => {
        this.toast.success('Task approved and moved to Done');
        this.loadBoardAndIssues();
      },
      error: (err) => {
        this.toast.error(err.error?.message || 'Failed to approve task');
      }
    });
  }

  rejectReason = signal<string>('');
  isRejectModalOpen = signal<boolean>(false);
  rejectingIssueId = signal<number | null>(null);

  // Proof Upload Modal State
  isProofModalOpen = signal<boolean>(false);
  proofIssue = signal<any | null>(null);
  proofTargetColumnId = signal<number | null>(null);
  proofInsertIndex = signal<number>(0);
  /**
   * Evidence staged for upload, each with the name it will be saved under (§2).
   *
   * The name rides beside the File rather than on it: File.name is read-only,
   * so a rename has to live somewhere until the upload happens.
   */
  proofFiles = signal<{ file: File; name: string }[]>([]);
  /** Index of the staged file being renamed, or null. */
  renamingProofIndex = signal<number | null>(null);
  proofNameDraft = '';
  proofNotes = signal<string>('');
  isUploadingProof = signal(false);
  proofUploadProgress = signal<number>(0);
  private proofUploadInterval: any = null;

  openProofModal(issue: any, targetColumnId: number, insertIndex: number) {
    this.proofIssue.set(issue);
    this.proofTargetColumnId.set(targetColumnId);
    this.proofInsertIndex.set(insertIndex);
    this.proofFiles.set([]);
    this.proofNotes.set('');
    this.isProofModalOpen.set(true);
  }

  closeProofModal() {
    this.isProofModalOpen.set(false);
    this.proofIssue.set(null);
    this.proofTargetColumnId.set(null);
    this.proofFiles.set([]);
    this.proofNotes.set('');
    this.isUploadingProof.set(false);
    if (this.proofUploadInterval) {
      clearInterval(this.proofUploadInterval);
      this.proofUploadInterval = null;
    }
  }

  onProofFileSelected(event: any) {
    const files = Array.from(event.target.files || []) as File[];
    this.proofFiles.update(prev => [...prev, ...files.map((f: File) => ({ file: f, name: f.name }))]);
  }

  removeProofFile(index: number) {
    this.proofFiles.update(prev => prev.filter((_, i) => i !== index));
    this.renamingProofIndex.set(null);
  }

  /** Renaming edits the NAME only; the extension comes from the real file. */
  startRenameProof(index: number) {
    const entry = this.proofFiles()[index];
    if (!entry) return;
    this.proofNameDraft = entry.name.replace(/\.[^.]+$/, '');
    this.renamingProofIndex.set(index);
  }

  confirmRenameProof(index: number) {
    const draft = this.proofNameDraft.trim();
    if (draft) {
      this.proofFiles.update(list => list.map((entry, i) =>
        i === index
          ? { ...entry, name: draft + (entry.file.name.match(/\.[^.]+$/)?.[0] || '') }
          : entry,
      ));
    }
    this.renamingProofIndex.set(null);
  }

  cancelRenameProof() {
    this.renamingProofIndex.set(null);
    this.proofNameDraft = '';
  }

  proofExtension(fileName: string): string {
    return fileName.match(/\.[^.]+$/)?.[0] || '';
  }

  /**
   * Who may raise work on this board.
   *
   * `isProjectOwner` covers administrators and the project lead, but not a
   * member carrying the PROJECT_MANAGER role -- so a PM could approve this
   * project's timesheets, own its milestones and rule on its hours requests,
   * yet had no "Add a card" button on its board. The server has always allowed
   * them (canCreateTask in tasks/task-permissions.ts); only the UI disagreed.
   */
  get canAddTasks(): boolean {
    return this.isProjectOwner || this.isCurrentUserPM();
  }

  /**
   * Who may set the hours a task is assigned (§3).
   *
   * The same people the server allows, and the same people who rule on
   * additional-hours requests. If an employee could edit this they would never
   * need to raise one, and the ceiling would enforce nothing.
   */
  get canAssignHours(): boolean {
    return this.isProjectOwner || this.isCurrentUserPM();
  }

  /**
   * Who may manage this task rather than merely work on it.
   *
   * Mirrors canManageTask on the server. An employee moves their own card,
   * logs time, comments and attaches evidence; priority, labels, members,
   * checklists, dates, the milestone and archiving belong to whoever runs the
   * project. Hiding these does not enforce anything -- the endpoints do -- it
   * just stops offering an action that would be refused on save.
   */
  get canManageTask(): boolean {
    return this.isProjectOwner || this.isCurrentUserPM();
  }

  /**
   * A technical architect, and nothing more.
   *
   * Their role is sight of the whole board without a hand on it, so the
   * affordances that change a task are taken away rather than left to fail
   * against the server. Deliberately narrow: it says nothing about ordinary
   * members, who drag their own cards exactly as they did before.
   *
   * Owner, project manager and company administrator all answer false here
   * even when they also hold the architect role — standing adds up.
   */
  get isReadOnlyArchitect(): boolean {
    if (this.isProjectOwner || this.isCurrentUserPM()) return false;
    const myEmpId = this.currentEmployeeId();
    if (!myEmpId) return false;
    return (this.project()?.members || []).some(
      (m: any) => (m.employeeId === myEmpId || m.employee?.id === myEmpId)
        && m.role === 'TECHNICAL_ARCHITECT',
    );
  }

  /** The milestone's name, for the read-only view of it. */
  selectedIssueMilestoneName(): string | null {
    const id = this.selectedIssue()?.milestoneId;
    if (!id) return null;
    return this.projectMilestones().find((m: any) => m.id === id)?.name ?? null;
  }

  // PMs and the project Owner can bypass the proof-of-completion requirement; regular
  // employees must attach at least one supporting document before moving the task.
  get canSkipProofUpload(): boolean {
    return this.isProjectOwner || this.isCurrentUserPM();
  }

  skipProofUpload() {
    const issue = this.proofIssue();
    const targetColId = this.proofTargetColumnId();
    if (!issue || !targetColId || !this.canSkipProofUpload) return;

    this.optimisticallyUpdateIssueColumn(issue.id, targetColId, this.proofInsertIndex());
    this.setIssueUpdating(issue.id, true);
    this.closeProofModal();

    this.projectsService.updateIssue(this.projectId, issue.id, { columnId: targetColId }).subscribe({
      next: () => {
        this.setIssueUpdating(issue.id, false);
        this.toast.success('Task moved.');
        this.loadBoardAndIssues();
      },
      error: (err) => {
        this.setIssueUpdating(issue.id, false);
        this.reportMoveFailure(err, 'Could not move the task — the server did not respond.');
        this.loadBoardAndIssues();
      }
    });
  }

  confirmProofUpload() {
    const issue = this.proofIssue();
    const targetColId = this.proofTargetColumnId();
    if (!issue || !targetColId) return;

    const files = this.proofFiles();
    if (files.length === 0) {
      this.toast.error('Please upload at least one proof document.');
      return;
    }

    this.isUploadingProof.set(true);
    this.proofUploadProgress.set(10);

    const colName = this.getColumnById(targetColId)?.name || '';
    this.toast.info(`Moving to "${colName}"... Uploading ${files.length} file(s).`);

    let uploadedCount = 0;
    const totalFiles = files.length;

    const uploadNext = (index: number) => {
      if (index >= files.length) {
        // All files uploaded — now move the issue
        clearInterval(this.proofUploadInterval);
        this.proofUploadProgress.set(100);
        this.isUploadingProof.set(false);

        this.optimisticallyUpdateIssueColumn(issue.id, targetColId, this.proofInsertIndex());
        this.setIssueUpdating(issue.id, true);
        this.closeProofModal();

        this.projectsService.updateIssue(this.projectId, issue.id, { columnId: targetColId }).subscribe({
          next: () => {
            this.setIssueUpdating(issue.id, false);
            this.toast.success('Task moved and proof uploaded successfully.');
            this.loadBoardAndIssues();
          },
          error: (err) => {
            this.setIssueUpdating(issue.id, false);
            // The files are already attached; only the move was refused.
            this.reportMoveFailure(
              err, 'The proof was uploaded, but the task could not be moved — the server did not respond.',
            );
            this.loadBoardAndIssues();
          }
        });
        return;
      }

      this.projectsService.uploadAttachment(
        this.projectId, issue.id, files[index].file, [files[index].name],
      ).subscribe({
        next: () => {
          uploadedCount++;
          this.proofUploadProgress.set(Math.round((uploadedCount / totalFiles) * 90));
          uploadNext(index + 1);
        },
        error: () => {
          clearInterval(this.proofUploadInterval);
          this.isUploadingProof.set(false);
          this.toast.error(`Failed to upload file: ${files[index].name}`);
        }
      });
    };

    this.proofUploadInterval = setInterval(() => {
      this.proofUploadProgress.update(p => (p < 80 ? p + 10 : p));
    }, 500);

    uploadNext(0);
  }

  openRejectModal(issueId: number) {
    if (!this.isCurrentUserPM()) {
      this.toast.error('Only Project Managers can reject tasks.');
      return;
    }
    this.rejectingIssueId.set(issueId);
    this.rejectReason.set('');
    this.isRejectModalOpen.set(true);
  }

  closeRejectModal() {
    this.isRejectModalOpen.set(false);
    this.rejectingIssueId.set(null);
  }

  confirmRejectIssue() {
    const id = this.rejectingIssueId();
    if (!id) return;
    if (!this.rejectReason().trim()) {
      this.toast.error('Reason is required to reject a task.');
      return;
    }
    this.projectsService.reviewIssue(this.projectId, id, { action: 'REJECT', reason: this.rejectReason().trim() }).subscribe({
      next: (updatedIssue) => {
        this.toast.success('Task rejected and moved back');
        this.closeRejectModal();
        this.loadBoardAndIssues();
      },
      error: (err) => {
        this.toast.error(err.error?.message || 'Failed to reject task');
      }
    });
  }

  get isProjectStarred(): boolean {
    const p = this.project();
    if (!p || !p.members) return false;
    const user = this.currentUser();
    const userId = user?.id;
    const empId = user?.employee?.id;

    const myMember = p.members.find((m: any) => 
      (empId && (m.employeeId === empId || m.employee?.id === empId)) ||
      (userId && (m.userId === userId || m.employee?.userId === userId || m.employeeId === userId))
    );
    return myMember ? !!myMember.isStarred : false;
  }

  toggleStar() {
    this.projectsService.toggleProjectStar(this.projectId).subscribe({
      next: (res) => {
        // Refresh project details from backend to ensure members array is accurate
        this.loadProjectDetails();
      },
      error: (err) => {
        console.error('Failed to star project:', err);
        this.toast.error('Failed to update star status');
      }
    });
  }

  isMenuOpen = signal(false);
  backgroundColors = [
    '#0079bf', '#838284', '#519839', '#707172', '#89609e', '#939394', '#4bbf6b', '#00aecc', '#838c91'
  ];

  toggleMenu() {
    this.isMenuOpen.set(!this.isMenuOpen());
  }

  changeBackground(color: string) {
    this.projectsService.updateProject(this.projectId, { color }).subscribe({
      next: (res) => {
        const p = this.project();
        if (p) {
          this.project.set({ ...p, color: res.color });
        }
      },
      error: () => this.toast.error('Failed to update background')
    });
  }

  closePopover() {
    this.activePopover.set(null);
    this.activeMemberActionMenu.set(null);
    this.labelPopoverMode.set('list');
    this.activeEditLabel.set(null);
    this.showTimeDropdown.set(false);
    this.showRecurringDropdown.set(false);
    this.showReminderDropdown.set(false);
  }

  openMemberProfile(member: any) {
    this.activeMemberProfile.set(member);
    this.activePopover.set('memberProfile');
  }

  projectLabels = signal<any[]>([]);
  labelSearchQuery = '';
  labelPopoverMode = signal<'list' | 'create' | 'edit'>('list');
  activeEditLabel = signal<any | null>(null);
  labelForm = { title: '', color: '#4bce97' };

  labelColorPalette = [
    // Row 1 (subtle green, yellow, orange, red, purple)
    { fill: '#baf3db', border: '#216e4e' },
    { fill: '#f3efff', border: '#4a494b' },
    { fill: '#dbeafe', border: '#616062' },
    { fill: '#eaeaeb', border: '#7a7a7b' },
    { fill: '#e9d5ff', border: '#6e5dc6' },
    // Row 2 (standard green, yellow, orange, red, purple)
    { fill: '#4bce97' },
    { fill: '#9e9d9f' },
    { fill: '#b0afb1' },
    { fill: '#acadae' },
    { fill: '#9f8fef' },
    // Row 3 (dark green, olive, dark orange, dark red, dark purple)
    { fill: '#1f845a' },
    { fill: '#4a494b' },
    { fill: '#616062' },
    { fill: '#7a7a7b' },
    { fill: '#6e5dc6' },
    // Row 4 (subtle blue, sky, lime, pink, grey)
    { fill: '#cce0ff', border: '#0c66e4' },
    { fill: '#c6edfb', border: '#206a83' },
    { fill: '#d3f1a7', border: '#4c6b1f' },
    { fill: '#eaeaeb', border: '#943d73' },
    { fill: '#dcdfe4', border: '#505f79' },
    // Row 5 (standard blue, sky, lime, pink, grey)
    { fill: '#579dff' },
    { fill: '#60c6d2' },
    { fill: '#94c748' },
    { fill: '#e774bb' },
    { fill: '#8c9bab' },
    // Row 6 (bold blue, teal, dark lime, magenta, dark grey)
    { fill: '#0c66e4' },
    { fill: '#206a83' },
    { fill: '#4c6b1f' },
    { fill: '#943d73' },
    { fill: '#505f79' }
  ];

  loadProjectLabels() {
    this.projectsService.getLabels(this.projectId).subscribe({
      next: (res) => this.projectLabels.set(res || []),
      error: () => this.projectLabels.set([])
    });
  }

  get filteredLabels() {
    const q = (this.labelSearchQuery || '').toLowerCase().trim();
    if (!q) return this.projectLabels();
    return this.projectLabels().filter(l => (l.name || '').toLowerCase().includes(q));
  }

  getLabelTextColor(bgColor: string): string {
    if (!bgColor) return '#172b4d';
    const darkColors = ['#1f845a', '#4a494b', '#616062', '#7a7a7b', '#6e5dc6', '#0c66e4', '#206a83', '#4c6b1f', '#943d73', '#505f79'];
    return darkColors.includes(bgColor.toLowerCase()) ? '#ffffff' : '#172b4d';
  }

  isLabelAttached(labelId: number): boolean {
    const issue = this.selectedIssue();
    if (!issue || !issue.labels) return false;
    return issue.labels.some((il: any) => il.labelId === labelId || il.label?.id === labelId);
  }

  toggleLabel(label: any) {
    const issue = this.selectedIssue();
    if (!issue) return;

    this.projectsService.toggleIssueLabel(this.projectId, issue.id, label.id).subscribe({
      next: (res) => {
        if (res.attached) {
          const updatedLabels = [...(issue.labels || []), { issueId: issue.id, labelId: label.id, label }];
          this.selectedIssue.update(i => i ? { ...i, labels: updatedLabels } : null);
        } else {
          const updatedLabels = (issue.labels || []).filter((il: any) => (il.labelId !== label.id && il.label?.id !== label.id));
          this.selectedIssue.update(i => i ? { ...i, labels: updatedLabels } : null);
        }
        this.loadBoardAndIssues();
      },
      error: () => this.toast.error('Failed to update label')
    });
  }

  openCreateLabel() {
    this.labelForm = { title: '', color: '#4bce97' };
    this.labelPopoverMode.set('create');
  }

  openEditLabel(label: any, event: Event) {
    event.stopPropagation();
    this.activeEditLabel.set(label);
    this.labelForm = { title: label.name || '', color: label.color || '#4bce97' };
    this.labelPopoverMode.set('edit');
  }

  saveCreateLabel() {
    this.projectsService.createLabel(this.projectId, this.labelForm.title, this.labelForm.color).subscribe({
      next: (newLabel) => {
        this.projectLabels.update(list => [...list, newLabel]);
        this.labelPopoverMode.set('list');
        this.toast.success('Label created');
      },
      error: () => this.toast.error('Failed to create label')
    });
  }

  saveEditLabel() {
    const label = this.activeEditLabel();
    if (!label) return;

    this.projectsService.updateLabel(this.projectId, label.id, this.labelForm.title, this.labelForm.color).subscribe({
      next: (updated) => {
        this.projectLabels.update(list => list.map(l => l.id === label.id ? updated : l));
        const issue = this.selectedIssue();
        if (issue && issue.labels) {
          const updatedIssueLabels = issue.labels.map((il: any) => 
            (il.labelId === label.id || il.label?.id === label.id) ? { ...il, label: updated } : il
          );
          this.selectedIssue.update(i => i ? { ...i, labels: updatedIssueLabels } : null);
        }
        this.labelPopoverMode.set('list');
        this.toast.success('Label updated');
      },
      error: () => this.toast.error('Failed to update label')
    });
  }

  deleteProjectLabel() {
    const label = this.activeEditLabel();
    if (!label) return;

    if (confirm('Are you sure you want to delete this label?')) {
      this.projectsService.deleteLabel(this.projectId, label.id).subscribe({
        next: () => {
          this.projectLabels.update(list => list.filter(l => l.id !== label.id));
          const issue = this.selectedIssue();
          if (issue && issue.labels) {
            const updatedIssueLabels = issue.labels.filter((il: any) => il.labelId !== label.id && il.label?.id !== label.id);
            this.selectedIssue.update(i => i ? { ...i, labels: updatedIssueLabels } : null);
          }
          this.labelPopoverMode.set('list');
          this.toast.success('Label deleted');
        },
        error: () => this.toast.error('Failed to delete label')
      });
    }
  }

  removeLabelColor() {
    this.labelForm.color = '#e2e8f0';
  }

  // Dates Popover State & Calendar Generator
  calendarViewDate = new Date();
  datesForm = {
    enableStartDate: false,
    startDateStr: '',
    enableDueDate: true,
    dueDateStr: '',
    dueTimeStr: '12:39',
    recurring: 'Never',
    dueReminder: '1 Day before'
  };

  showTimeDropdown = signal(false);
  showRecurringDropdown = signal(false);
  showReminderDropdown = signal(false);

  /**
   * Whether the next calendar click closes the range or starts a new one.
   *
   * A range needs two clicks and the picker has to remember which one it is
   * on. Without it, the old behaviour compared the clicked day to the start
   * and could only ever push the END around — the start date could not be
   * moved later by clicking at all, only by typing.
   */
  awaitingRangeEnd = false;

  /** The day under the cursor, so a half-made range previews before the click. */
  calendarHoverDate: Date | null = null;

  /** The last values that parsed, to fall back to when typing goes wrong. */
  private lastValidStartStr = '';
  private lastValidDueStr = '';

  recurringOptions = ['Never', 'Daily', 'Monday to Friday', 'Weekly', 'Monthly on the 26th', 'Monthly on the last Saturday'];
  reminderOptions = ['At time of due date', '5 Minutes before', '15 Minutes before', '1 Hour before', '2 Hours before', '1 Day before', '2 Days before'];

  get timeOptions(): string[] {
    const times: string[] = [];
    for (let h = 0; h < 24; h++) {
      for (let m of [0, 30]) {
        const hh = h.toString().padStart(2, '0');
        const mm = m.toString().padStart(2, '0');
        times.push(`${hh}:${mm}`);
      }
    }
    if (this.datesForm.dueTimeStr && !times.includes(this.datesForm.dueTimeStr)) {
      times.unshift(this.datesForm.dueTimeStr);
    }
    return times;
  }

  initDatesForm() {
    const issue = this.selectedIssue();
    const now = new Date();
    
    if (issue) {
      this.datesForm.enableStartDate = !!issue.startDate;
      this.datesForm.startDateStr = issue.startDate ? this.formatDateToDDMMYYYY(new Date(issue.startDate)) : this.formatDateToDDMMYYYY(now);
      
      this.datesForm.enableDueDate = !!issue.dueDate || !issue.startDate;
      const dueObj = issue.dueDate ? new Date(issue.dueDate) : new Date(now.getTime() + 86400000);
      this.datesForm.dueDateStr = this.formatDateToDDMMYYYY(dueObj);
      this.datesForm.dueTimeStr = issue.dueDate ? this.formatTimeToHHMM(dueObj) : '12:39';
      
      this.datesForm.recurring = issue.recurring || 'Never';
      this.datesForm.dueReminder = issue.dueReminder || '1 Day before';
      
      this.calendarViewDate = issue.dueDate ? new Date(issue.dueDate) : new Date(now);
    } else {
      this.datesForm.enableStartDate = false;
      this.datesForm.startDateStr = this.formatDateToDDMMYYYY(now);
      this.datesForm.enableDueDate = true;
      const dueObj = new Date(now.getTime() + 86400000);
      this.datesForm.dueDateStr = this.formatDateToDDMMYYYY(dueObj);
      this.datesForm.dueTimeStr = '12:39';
      this.datesForm.recurring = 'Never';
      this.datesForm.dueReminder = '1 Day before';
      this.calendarViewDate = new Date(now);
    }

    // Opening the picker is not the middle of a selection.
    this.awaitingRangeEnd = false;
    this.calendarHoverDate = null;
    this.lastValidStartStr = this.datesForm.startDateStr;
    this.lastValidDueStr = this.datesForm.dueDateStr;
  }

  formatDateToDDMMYYYY(d: Date): string {
    const dd = d.getDate().toString().padStart(2, '0');
    const mm = (d.getMonth() + 1).toString().padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }

  parseDDMMYYYY(s: string): Date | null {
    if (!s) return null;
    const parts = s.trim().split('/');
    if (parts.length !== 3) return null;
    const d = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const y = parseInt(parts[2], 10);
    if (isNaN(d) || isNaN(m) || isNaN(y) || y < 1000) return null;

    const date = new Date(y, m, d);
    // A Date rolls 31/02 forward into March rather than refusing it, so the
    // only way to catch an impossible day is to read it back. Saving used to
    // accept "31/02/2026" and quietly store the 3rd of March.
    if (date.getFullYear() !== y || date.getMonth() !== m || date.getDate() !== d) {
      return null;
    }
    return date;
  }

  formatTimeToHHMM(d: Date): string {
    const hh = d.getHours().toString().padStart(2, '0');
    const mm = d.getMinutes().toString().padStart(2, '0');
    return `${hh}:${mm}`;
  }

  get calendarMonthYearTitle(): string {
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return `${months[this.calendarViewDate.getMonth()]} ${this.calendarViewDate.getFullYear()}`;
  }

  prevYear() {
    this.calendarViewDate = new Date(this.calendarViewDate.getFullYear() - 1, this.calendarViewDate.getMonth(), 1);
  }

  prevMonth() {
    this.calendarViewDate = new Date(this.calendarViewDate.getFullYear(), this.calendarViewDate.getMonth() - 1, 1);
  }

  nextMonth() {
    this.calendarViewDate = new Date(this.calendarViewDate.getFullYear(), this.calendarViewDate.getMonth() + 1, 1);
  }

  nextYear() {
    this.calendarViewDate = new Date(this.calendarViewDate.getFullYear() + 1, this.calendarViewDate.getMonth(), 1);
  }

  get calendarDaysGrid(): any[] {
    const year = this.calendarViewDate.getFullYear();
    const month = this.calendarViewDate.getMonth();
    
    // First day index (Monday = 0)
    const firstDay = new Date(year, month, 1);
    const dayOfWeek = (firstDay.getDay() + 6) % 7;
    
    const prevMonthLastDate = new Date(year, month, 0).getDate();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    const today = new Date();
    const startDateObj = this.datesForm.enableStartDate ? this.parseDDMMYYYY(this.datesForm.startDateStr) : null;
    const dueDateObj = this.datesForm.enableDueDate ? this.parseDDMMYYYY(this.datesForm.dueDateStr) : null;
    // While the range is half-made, the day under the cursor stands in for the
    // end — so the range being chosen is visible before it is committed.
    const previewTo = this.awaitingRangeEnd ? this.calendarHoverDate : null;
    
    const days: any[] = [];

    // Previous month padding days
    for (let i = dayOfWeek - 1; i >= 0; i--) {
      const dNum = prevMonthLastDate - i;
      const dObj = new Date(year, month - 1, dNum);
      days.push(this.buildDayCell(dNum, dObj, false, today, startDateObj, dueDateObj, previewTo));
    }

    // Current month days
    for (let i = 1; i <= daysInMonth; i++) {
      const dObj = new Date(year, month, i);
      days.push(this.buildDayCell(i, dObj, true, today, startDateObj, dueDateObj, previewTo));
    }

    // Next month padding days to complete 42 cells (6 rows x 7)
    const totalCells = days.length;
    const remaining = 42 - totalCells;
    for (let i = 1; i <= remaining; i++) {
      const dObj = new Date(year, month + 1, i);
      days.push(this.buildDayCell(i, dObj, false, today, startDateObj, dueDateObj, previewTo));
    }

    return days;
  }

  buildDayCell(
    dayNumber: number, dObj: Date, isCurrentMonth: boolean, today: Date,
    startDateObj: Date | null, dueDateObj: Date | null, previewTo: Date | null = null,
  ): any {
    const isToday = this.isSameDay(dObj, today);

    const isStart = !!startDateObj && this.isSameDay(dObj, startDateObj);
    const isDue = !!dueDateObj && this.isSameDay(dObj, dueDateObj);

    let isInRange = false;
    if (startDateObj && dueDateObj && startDateObj < dueDateObj) {
      isInRange = dObj > startDateObj && dObj < dueDateObj;
    }

    // The range the cursor is currently proposing, drawn lighter than the one
    // already chosen. Either end may be the anchor, since picking backwards
    // swaps them.
    let isPreview = false;
    if (previewTo && startDateObj) {
      const from = previewTo < startDateObj ? previewTo : startDateObj;
      const to = previewTo < startDateObj ? startDateObj : previewTo;
      isPreview = dObj >= from && dObj <= to && !isStart && !isInRange;
    }

    return {
      dayNumber,
      dateObj: dObj,
      isCurrentMonth,
      isToday,
      isStart,
      isDue,
      isInRange,
      isPreview,
    };
  }

  isSameDay(d1: Date, d2: Date): boolean {
    return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
  }

  /**
   * Pick a day out of the calendar.
   *
   * Two ends enabled means two clicks: the first anchors the start, the second
   * closes the range, and the next one starts over. The old rule instead asked
   * "is this before the start?" on every click, which made the start date
   * impossible to move later — every click at or after it landed on the due
   * date, and there was no way back short of typing.
   */
  selectCalendarDate(dayCell: any) {
    const picked: Date = dayCell.dateObj;
    const formatted = this.formatDateToDDMMYYYY(picked);

    // A day from the greyed-out edges belongs to another month. Follow it, or
    // the selection lands somewhere the calendar is not showing.
    if (!dayCell.isCurrentMonth) {
      this.calendarViewDate = new Date(picked.getFullYear(), picked.getMonth(), 1);
    }
    this.calendarHoverDate = null;

    // Only one end in play: the click sets that one, whichever it is.
    if (!this.datesForm.enableStartDate || !this.datesForm.enableDueDate) {
      if (this.datesForm.enableStartDate) {
        this.datesForm.startDateStr = formatted;
      } else {
        this.datesForm.enableDueDate = true;
        this.datesForm.dueDateStr = formatted;
      }
      this.awaitingRangeEnd = false;
      this.rememberValidDates();
      return;
    }

    if (!this.awaitingRangeEnd) {
      // First click: anchor the start. An existing due date is kept when it
      // still makes sense, so nudging the start of a planned range does not
      // throw the end away.
      this.datesForm.startDateStr = formatted;
      const dueObj = this.parseDDMMYYYY(this.datesForm.dueDateStr);
      if (!dueObj || dueObj < picked) {
        this.datesForm.dueDateStr = formatted;
      }
      this.awaitingRangeEnd = true;
      this.rememberValidDates();
      return;
    }

    // Second click closes the range. Picking backwards is not an error — it
    // means the range runs the other way, so the two ends swap rather than the
    // click being ignored.
    const startObj = this.parseDDMMYYYY(this.datesForm.startDateStr);
    if (startObj && picked < startObj) {
      this.datesForm.startDateStr = formatted;
      this.datesForm.dueDateStr = this.formatDateToDDMMYYYY(startObj);
    } else {
      this.datesForm.dueDateStr = formatted;
    }
    this.awaitingRangeEnd = false;
    this.rememberValidDates();
  }

  /** Preview the half-made range as the cursor moves over the grid. */
  onCalendarHover(dayCell: any) {
    if (!this.awaitingRangeEnd) return;
    this.calendarHoverDate = dayCell.dateObj;
  }

  clearCalendarHover() {
    this.calendarHoverDate = null;
  }

  /**
   * Put a typed date right, or put it back.
   *
   * These inputs are free text, and `saveDates` stores a date only when it
   * parses — so typing "3/9" over a good date and saving used to clear the
   * date silently rather than complain. Now an unreadable value returns to
   * what it was, and a readable one is written out in full.
   */
  normaliseDateInput(which: 'start' | 'due') {
    const typed = which === 'start' ? this.datesForm.startDateStr : this.datesForm.dueDateStr;
    const parsed = this.parseDDMMYYYY(typed);

    if (!parsed) {
      if (which === 'start') {
        this.datesForm.startDateStr = this.lastValidStartStr;
      } else {
        this.datesForm.dueDateStr = this.lastValidDueStr;
      }
      this.toast.error(`"${typed}" is not a date. Use DD/MM/YYYY.`);
      return;
    }

    const canonical = this.formatDateToDDMMYYYY(parsed);
    if (which === 'start') {
      this.datesForm.startDateStr = canonical;
    } else {
      this.datesForm.dueDateStr = canonical;
    }

    // Typing an end before the start is the same gesture as clicking backwards
    // on the calendar, and means the same thing.
    if (this.datesForm.enableStartDate && this.datesForm.enableDueDate) {
      const startObj = this.parseDDMMYYYY(this.datesForm.startDateStr);
      const dueObj = this.parseDDMMYYYY(this.datesForm.dueDateStr);
      if (startObj && dueObj && dueObj < startObj) {
        this.datesForm.startDateStr = this.formatDateToDDMMYYYY(dueObj);
        this.datesForm.dueDateStr = this.formatDateToDDMMYYYY(startObj);
      }
    }
    this.awaitingRangeEnd = false;
    this.rememberValidDates();
  }

  private rememberValidDates() {
    if (this.parseDDMMYYYY(this.datesForm.startDateStr)) {
      this.lastValidStartStr = this.datesForm.startDateStr;
    }
    if (this.parseDDMMYYYY(this.datesForm.dueDateStr)) {
      this.lastValidDueStr = this.datesForm.dueDateStr;
    }
  }

  /** "25 Sep – 27 Sep · 3 days", so the range reads back in words. */
  get rangeSummary(): string {
    const startObj = this.datesForm.enableStartDate ? this.parseDDMMYYYY(this.datesForm.startDateStr) : null;
    const dueObj = this.datesForm.enableDueDate ? this.parseDDMMYYYY(this.datesForm.dueDateStr) : null;
    const short = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

    if (startObj && dueObj) {
      if (this.isSameDay(startObj, dueObj)) return `${short(startObj)} · 1 day`;
      const days = Math.round((dueObj.getTime() - startObj.getTime()) / 86400000) + 1;
      return `${short(startObj)} – ${short(dueObj)} · ${days} days`;
    }
    if (dueObj) return `Due ${short(dueObj)}`;
    if (startObj) return `Starts ${short(startObj)}`;
    return 'No dates set';
  }

  saveDates() {
    const issue = this.selectedIssue();
    if (!issue) return;

    // Last line of defence on the order. The calendar and the blur handler
    // both keep these the right way round, but a value typed and saved without
    // ever leaving the field would otherwise reach the database as a task that
    // ends before it starts.
    if (this.datesForm.enableStartDate && this.datesForm.enableDueDate) {
      const s0 = this.parseDDMMYYYY(this.datesForm.startDateStr);
      const d0 = this.parseDDMMYYYY(this.datesForm.dueDateStr);
      if (s0 && d0 && d0 < s0) {
        this.datesForm.startDateStr = this.formatDateToDDMMYYYY(d0);
        this.datesForm.dueDateStr = this.formatDateToDDMMYYYY(s0);
      }
    }

    let startDate: string | null = null;
    let dueDate: string | null = null;

    if (this.datesForm.enableStartDate && this.datesForm.startDateStr) {
      const sObj = this.parseDDMMYYYY(this.datesForm.startDateStr);
      if (sObj) startDate = sObj.toISOString();
    }

    if (this.datesForm.enableDueDate && this.datesForm.dueDateStr) {
      const dObj = this.parseDDMMYYYY(this.datesForm.dueDateStr);
      if (dObj) {
        const timeParts = (this.datesForm.dueTimeStr || '12:39').split(':');
        if (timeParts.length === 2) {
          dObj.setHours(parseInt(timeParts[0], 10), parseInt(timeParts[1], 10), 0, 0);
        }
        dueDate = dObj.toISOString();
      }
    }

    const payload = {
      startDate,
      dueDate,
      recurring: this.datesForm.recurring,
      dueReminder: this.datesForm.dueReminder
    };

    this.projectsService.updateIssue(this.projectId, issue.id, payload).subscribe({
      next: () => {
        this.selectedIssue.update(i => i ? { ...i, ...payload } : null);
        this.closePopover();
        this.loadBoardAndIssues();
        this.toast.success('Dates saved');
      },
      error: () => this.toast.error('Failed to save dates')
    });
  }

  removeDates() {
    const issue = this.selectedIssue();
    if (!issue) return;

    const payload = {
      startDate: null,
      dueDate: null,
      recurring: 'Never',
      dueReminder: null
    };

    this.projectsService.updateIssue(this.projectId, issue.id, payload).subscribe({
      next: () => {
        this.selectedIssue.update(i => i ? { ...i, ...payload } : null);
        this.initDatesForm();
        this.closePopover();
        this.loadBoardAndIssues();
        this.toast.success('Dates removed');
      },
      error: () => this.toast.error('Failed to remove dates')
    });
  }

  formatDisplayDueDate(issue: any): string {
    if (!issue) return '';
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
    
    if (issue.startDate && issue.dueDate) {
      const s = new Date(issue.startDate);
      const d = new Date(issue.dueDate);
      const timeStr = this.formatTimeToHHMM(d);
      return `${s.getDate()} ${months[s.getMonth()]} - ${d.getDate()} ${months[d.getMonth()]}, ${timeStr}`;
    } else if (issue.dueDate) {
      const d = new Date(issue.dueDate);
      const timeStr = this.formatTimeToHHMM(d);
      return `${d.getDate()} ${months[d.getMonth()]}, ${timeStr}`;
    } else if (issue.startDate) {
      const s = new Date(issue.startDate);
      return `${s.getDate()} ${months[s.getMonth()]}`;
    }
    return '';
  }

  saveIssue() {
    if (this.selectedIssue()) {
      this.projectsService.updateIssue(this.projectId, this.selectedIssue().id, this.issueForm).subscribe({
        next: () => {
          this.toast.success('Description saved');
          this.isEditingDescription.set(false);
          const current = this.selectedIssue();
          if (current) {
            current.description = this.issueForm.description;
          }
          this.loadBoardAndIssues();
        }
      });
    } else {
      this.projectsService.createIssue(this.projectId, this.issueForm).subscribe({
        next: () => {
          this.toast.success('Issue created');
          this.isEditingDescription.set(false);
          this.loadBoardAndIssues();
          this.closeDrawer();
        }
      });
    }
  }

  newSubtaskTitle = '';

  createSubtask() {
    const parent = this.selectedIssue();
    if (!parent || !this.newSubtaskTitle.trim()) return;

    const payload = {
      title: this.newSubtaskTitle.trim(),
      type: 'SUBTASK',
      parentId: parent.id,
      priority: parent.priority, // Inherit priority by default
      columnId: this.columns().length > 0 ? this.columns()[0].id : undefined
    };

    this.projectsService.createIssue(this.projectId, payload).subscribe({
      next: (newSubtask) => {
        this.toast.success('Subtask created');
        this.newSubtaskTitle = '';
        this.loadBoardAndIssues();
        
        // Optimistically update the selected issue's children list so UI reflects immediately if we don't refetch the modal
        const currentSelected = this.selectedIssue();
        if (currentSelected && currentSelected.id === parent.id) {
           if (!currentSelected.children) currentSelected.children = [];
           currentSelected.children.push(newSubtask);
           this.selectedIssue.set({ ...currentSelected });
        }
      }
    });
  }

  toggleTimeTracking() {
    const issue = this.selectedIssue();
    if (!issue) return;
    
    const isRunning = issue.workStartedAt && !issue.workCompletedAt;
    
    if (isRunning) {
      this.projectsService.stopTime(this.projectId, issue.id).subscribe(() => {
        this.toast.success('Time tracking stopped');
        issue.workCompletedAt = new Date();
      });
    } else {
      this.projectsService.startTime(this.projectId, issue.id).subscribe(() => {
        this.toast.success('Time tracking started');
        issue.workStartedAt = new Date();
        issue.workCompletedAt = null;
      });
    }
  }

  // Members Popover State & Methods
  companyMembers = signal<any[]>([]);
  isLoadingMembers = signal(false);
  memberSearchQuery = '';
  shareTab = signal<'members'|'invite'>('members');

  /**
   * What the next person invited is added as.
   *
   * One selector above the list rather than a control on every row: inviting
   * is usually several people in the same role, and the answer should be
   * visible before the click rather than guessed from it.
   *
   * It used to be guessed — `employee.isProjectManager` — and the endpoint
   * feeding this list does not return that field, so the flag was always
   * undefined and everybody came in as a plain member.
   */
  inviteRole = signal<'MEMBER' | 'PROJECT_MANAGER' | 'TECHNICAL_ARCHITECT'>('MEMBER');

  /**
   * The person currently being added, so the row says so.
   *
   * Adding writes a member and then reloads the whole project to pick up the
   * new roles, which is long enough for a second click to land — and long
   * enough for the first one to look ignored.
   */
  addingMemberId = signal<number | null>(null);

  inviteRoleOptions = [
    { value: 'MEMBER' as const, label: 'Member', hint: 'Sees the tasks that are theirs' },
    { value: 'PROJECT_MANAGER' as const, label: 'Project manager', hint: 'Sees everything, runs the board' },
    { value: 'TECHNICAL_ARCHITECT' as const, label: 'Technical architect', hint: 'Sees everything, changes nothing' },
  ];

  inviteRoleLabel(): string {
    return this.inviteRoleOptions.find(o => o.value === this.inviteRole())?.label ?? 'Member';
  }
  activeMemberActionMenu = signal<number | null>(null);

  toggleMemberActionMenu(employeeId: number) {
    this.activeMemberActionMenu.set(this.activeMemberActionMenu() === employeeId ? null : employeeId);
  }

  copyBoardLink() {
    navigator.clipboard.writeText(window.location.href);
    this.toast.success('Board link copied to clipboard!');
  }

  loadCompanyMembers() {
    this.isLoadingMembers.set(true);
    this.projectsService.getCompanyMembers(this.projectId).subscribe({
      next: (res) => { this.companyMembers.set(res || []); this.isLoadingMembers.set(false); },
      error: () => { this.companyMembers.set([]); this.isLoadingMembers.set(false); }
    });
  }

  get filteredMembers(): any[] {
    const q = (this.memberSearchQuery || '').toLowerCase().trim();
    const members = this.companyMembers();
    if (!q) return members;
    return members.filter(m => 
      `${m.firstName || ''} ${m.lastName || ''}`.toLowerCase().includes(q) ||
      (m.user?.email || '').toLowerCase().includes(q) ||
      (m.designation?.name || '').toLowerCase().includes(q)
    );
  }

  get filteredProjectMembers(): any[] {
    return this.filteredMembers.filter(m => this.isProjectMember(m.id));
  }

  get filteredAvailableMembers(): any[] {
    return this.filteredMembers.filter(m => !this.isProjectMember(m.id));
  }

  isSelf(employeeId: number): boolean {
    const user = this.currentUser();
    if (!user) return false;
    const empId = user.employee?.id || user.id;
    return empId === employeeId;
  }

  canRemoveMember(member: any): boolean {
    const isSelf = this.isSelf(member.id);
    
    // If it's themselves, they can remove themselves only if there are other members
    if (isSelf) {
      const p = this.project();
      if (p && p.members && p.members.length <= 1) {
        return false; // Cannot remove self if they are the only member
      }
    }
    
    // Otherwise, as long as they have manage permission, they can remove
    return this.canManageMembers;
  }

  isMemberAttached(employeeId: number): boolean {
    const issue = this.selectedIssue();
    if (!issue || !issue.members) return false;
    return issue.members.some((m: any) => m.employeeId === employeeId || m.employee?.id === employeeId);
  }

  toggleCardMember(member: any) {
    const issue = this.selectedIssue();
    if (!issue) return;

    this.projectsService.toggleIssueMember(this.projectId, issue.id, member.id).subscribe({
      next: (res) => {
        if (res.attached) {
          const newMem = res.member || { issueId: issue.id, employeeId: member.id, employee: member };
          const updatedMembers = [...(issue.members || []), newMem];
          this.selectedIssue.update(i => i ? { ...i, members: updatedMembers } : null);
          this.toast.success(`Added ${member.firstName} to card`);
        } else {
          const updatedMembers = (issue.members || []).filter((m: any) => m.employeeId !== member.id && m.employee?.id !== member.id);
          this.selectedIssue.update(i => i ? { ...i, members: updatedMembers } : null);
          this.toast.success(`Removed ${member.firstName} from card`);
        }
        this.loadBoardAndIssues();
      },
      error: () => this.toast.error('Failed to update member assignment')
    });
  }

  getIssueTimeSummary(issue: any): { display: string; isRunning: boolean; isOver: boolean; percent: number } | null {
    if (!issue) return null;
    const isRunning = !!(issue.workStartedAt && !issue.workCompletedAt);
    
    let loggedMin = 0;
    if (issue.timeLogs && issue.timeLogs.length > 0) {
      loggedMin = issue.timeLogs.reduce((acc: number, log: any) => acc + (log.durationMin || 0), 0);
    }
    
    const estHours = issue.estimatedHours || 0;
    const estMin = estHours * 60;
    
    if (!isRunning && loggedMin === 0 && estHours === 0) {
      return null;
    }

    const formatTime = (min: number) => {
      if (min < 60) return `${min}m`;
      const h = (min / 60).toFixed(1).replace('.0', '');
      return `${h}h`;
    };

    let display = '';
    let isOver = false;
    let percent = 0;

    if (isRunning) {
      display = 'Timer Active';
    } else if (estHours > 0) {
      display = `${formatTime(loggedMin)} / ${formatTime(estMin)}`;
      percent = Math.min(100, Math.round((loggedMin / estMin) * 100));
      if (loggedMin > estMin) isOver = true;
    } else {
      display = formatTime(loggedMin);
    }

    return { display, isRunning, isOver, percent };
  }

  getMemberInitials(m: any): string {
    const emp = m?.employee || m;
    const fn = (emp?.firstName || '').charAt(0).toUpperCase();
    const ln = (emp?.lastName || '').charAt(0).toUpperCase();
    return (fn + ln) || 'M';
  }

  copyEmail(email: string | undefined) {
    if (!email) return;
    navigator.clipboard.writeText(email).then(() => {
      this.toast.success('Email copied to clipboard!');
    }).catch(err => {
      this.toast.error('Failed to copy email');
    });
  }

  getMemberColor(m: any): string {
    const emp = m?.employee || m;
    const colors = ['#0c66e4', '#1f845a', '#616062', '#7a7a7b', '#6e5dc6', '#943d73', '#206a83', '#505f79'];
    const id = emp?.id || 0;
    return colors[id % colors.length];
  }

  getVisibleMembers(members: any[]): any[] {
    if (!members) return [];
    return members.slice(0, 2);
  }

  getRemainingMembersCount(members: any[]): number {
    if (!members || members.length <= 2) return 0;
    return members.length - 2;
  }

  // Attachment State & Methods
  isUploadingAttachment = signal(false);
  uploadProgress = signal<number>(0);
  private uploadSubscription: any = null;
  private uploadProgressInterval: any = null;
  attachmentLinkUrl = '';
  attachmentLinkName = '';
  previewAttachment = signal<any | null>(null);

  openImageLightbox(att: any) {
    if (this.isImageAttachment(att)) {
      this.previewAttachment.set(att);
    } else if (att.fileUrl) {
      window.open(att.fileUrl, '_blank');
    }
  }

  closeImageLightbox() {
    this.previewAttachment.set(null);
  }

  deleteAttachmentFromLightbox() {
    const att = this.previewAttachment();
    if (!att) return;
    this.closeImageLightbox();
    this.deleteAttachment(att);
  }

  toggleCoverFromLightbox() {
    const att = this.previewAttachment();
    if (!att) return;
    this.toggleCoverAttachment(att);
  }

  async downloadAttachment(att: any) {
    if (!att || !att.fileUrl) return;
    
    try {
      this.toast.loading(`Downloading ${att.fileName}...`, { id: 'downloading' });
      const response = await fetch(att.fileUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = att.fileName || 'download';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      this.toast.close('downloading');
    } catch (err) {
      this.toast.error(`Failed to download ${att.fileName}`);
    }
  }

  downloadAttachmentFromLightbox() {
    const att = this.previewAttachment();
    if (!att) return;
    this.downloadAttachment(att);
  }

  onFileSelected(event: any) {
    // §2: evidence arrives in batches, so take every file the picker returned
    // rather than only the first.
    const files: File[] = Array.from(event.target?.files || []);
    if (!files.length) return;

    const issue = this.selectedIssue();
    if (!issue) return;

    // Clearing it means picking the same file twice in a row still fires.
    if (event.target) event.target.value = '';

    this.isUploadingAttachment.set(true);
    this.uploadProgress.set(15);

    this.uploadProgressInterval = setInterval(() => {
      this.uploadProgress.update(p => (p < 85 ? p + 15 : p));
    }, 250);

    this.uploadSubscription = this.projectsService.uploadAttachment(this.projectId, issue.id, files).subscribe({
      next: (att) => {
        clearInterval(this.uploadProgressInterval);
        this.uploadProgress.set(100);
        setTimeout(() => {
          this.isUploadingAttachment.set(false);
          this.uploadProgress.set(0);
          // One file answers with the attachment, several with an array.
          const added = Array.isArray(att) ? att : [att];
          const updatedAtts = [...added, ...(issue.attachments || [])];
          this.selectedIssue.update(i => i ? { ...i, attachments: updatedAtts } : null);
          this.toast.success(
            files.length === 1 ? `Attached ${files[0].name}` : `Attached ${files.length} files`,
          );
          this.closePopover();
          this.loadBoardAndIssues();
        }, 300);
      },
      error: () => {
        clearInterval(this.uploadProgressInterval);
        this.isUploadingAttachment.set(false);
        this.uploadProgress.set(0);
        this.toast.error('Failed to upload file to ImageKit');
      }
    });
  }

  cancelUpload() {
    if (this.uploadSubscription) {
      this.uploadSubscription.unsubscribe();
      this.uploadSubscription = null;
    }
    if (this.uploadProgressInterval) {
      clearInterval(this.uploadProgressInterval);
      this.uploadProgressInterval = null;
    }
    this.isUploadingAttachment.set(false);
    this.uploadProgress.set(0);
    this.toast.info('Upload cancelled');
  }

  addLinkAttachment() {
    if (this.isUploadingAttachment()) {
      this.toast.info('File upload in progress, please wait...');
      return;
    }

    if (!this.attachmentLinkUrl || !this.attachmentLinkUrl.trim()) {
      this.toast.error('Please enter a link URL');
      return;
    }

    const issue = this.selectedIssue();
    if (!issue) return;

    this.projectsService.addLinkAttachment(this.projectId, issue.id, this.attachmentLinkUrl, this.attachmentLinkName).subscribe({
      next: (att) => {
        const updatedAtts = [att, ...(issue.attachments || [])];
        this.selectedIssue.update(i => i ? { ...i, attachments: updatedAtts } : null);
        this.toast.success('Link attached');
        this.attachmentLinkUrl = '';
        this.attachmentLinkName = '';
        this.closePopover();
        this.loadBoardAndIssues();
      },
      error: () => this.toast.error('Failed to attach link')
    });
  }

  deleteAttachment(att: any) {
    const issue = this.selectedIssue();
    if (!issue) return;

    this.projectsService.deleteAttachment(this.projectId, issue.id, att.id).subscribe({
      next: () => {
        const updatedAtts = (issue.attachments || []).filter((a: any) => a.id !== att.id);
        const newCoverUrl = att.isCover ? null : issue.coverUrl;
        this.selectedIssue.update(i => i ? { ...i, attachments: updatedAtts, coverUrl: newCoverUrl } : null);
        this.toast.success('Attachment removed');
        this.loadBoardAndIssues();
      },
      error: () => this.toast.error('Failed to delete attachment')
    });
  }

  toggleCoverAttachment(att: any) {
    const issue = this.selectedIssue();
    if (!issue) return;

    this.projectsService.toggleCoverAttachment(this.projectId, issue.id, att.id).subscribe({
      next: (res) => {
        const updatedAtts = (issue.attachments || []).map((a: any) => ({
          ...a,
          isCover: a.id === att.id ? res.isCover : false
        }));
        this.selectedIssue.update(i => i ? { ...i, attachments: updatedAtts, coverUrl: res.coverUrl } : null);
        this.toast.success(res.isCover ? 'Cover updated' : 'Cover removed');
        this.loadBoardAndIssues();
      },
      error: () => this.toast.error('Failed to update cover')
    });
  }

  toggleIssueArchive(issueId: number) {
    const issue = this.allIssues().find(i => i.id === issueId);
    if (issue && !issue.isArchived && !this.canCompleteIssue(issue)) {
      this.toast.error('Only the assignee\'s manager (or above) can archive this task');
      return;
    }
    this.projectsService.toggleIssueArchive(this.projectId, issueId).subscribe({
      next: (res) => {
        // Find if the issue is in the selected state and update it
        if (this.selectedIssue()?.id === issueId) {
          this.selectedIssue.update(i => i ? { ...i, isArchived: res.isArchived } : null);
          if (res.isArchived) {
             this.closeDrawer();
          }
        }
        
        // Update allIssues locally to reflect archive status instantly
        const updatedAll = this.allIssues().map(i => i.id === issueId ? { ...i, isArchived: res.isArchived } : i);
        this.allIssues.set(updatedAll);
        
        // Rebuild board/list/etc. is handled automatically by activeIssues and archivedIssues signals
        this.loadBoardAndIssues(); 
        
        this.toast.success(res.isArchived ? 'Issue archived' : 'Issue unarchived');
      },
      error: () => this.toast.error('Failed to toggle archive status')
    });
  }

  onImageError(att: any) {
    att.imageError = true;
  }

  isImageAttachment(att: any): boolean {
    if (!att || !att.fileUrl || att.imageError) return false;
    const url = att.fileUrl.toLowerCase();
    const name = (att.fileName || '').toLowerCase();
    const isImgExt = (str: string) => 
      str.endsWith('.png') || str.endsWith('.jpg') || str.endsWith('.jpeg') || 
      str.endsWith('.webp') || str.endsWith('.gif') || str.endsWith('.svg') ||
      str.endsWith('.avif') || str.endsWith('.bmp');

    return isImgExt(url) || isImgExt(name);
  }

  getFileExtensionBadge(att: any): string {
    if (att.fileType === 'LINK') return 'LINK';
    const name = att.fileName || att.fileUrl || '';
    const cleanName = name.split('?')[0];
    const parts = cleanName.split('.');
    if (parts.length > 1) {
      const ext = parts[parts.length - 1].toUpperCase();
      return ext.substring(0, 5);
    }
    return 'FILE';
  }

  formatFileSize(bytes?: number): string {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  getSafeHtml(htmlString: string): SafeHtml {
    if (!htmlString) return '';
    return this.sanitizer.bypassSecurityTrustHtml(htmlString);
  }

  initQuill(retryCount = 0) {
    if (!this.quillContainer || !this.quillContainer.nativeElement) {
      if (retryCount < 15) {
        setTimeout(() => this.initQuill(retryCount + 1), 50);
      }
      return;
    }

    if (typeof Quill === 'undefined') {
      if (retryCount < 15) {
        setTimeout(() => this.initQuill(retryCount + 1), 150);
      }
      return;
    }

    try {
      this.quillInstance = null;
      this.quillContainer.nativeElement.innerHTML = '';
      this.quillInstance = new Quill(this.quillContainer.nativeElement, {
        theme: 'snow',
        placeholder: "Add a more detailed description...",
        modules: {
          toolbar: [
            [{ 'header': [1, 2, 3, false] }],
            ['bold', 'italic', 'underline', 'strike'],
            ['link', 'blockquote', 'code-block'],
            [{ 'list': 'ordered'}, { 'list': 'bullet' }],
            ['clean']
          ]
        }
      });

      if (this.issueForm.description) {
        this.quillInstance.root.innerHTML = this.issueForm.description;
      }

      this.quillInstance.on('text-change', () => {
        const html = this.quillInstance.root.innerHTML;
        this.issueForm.description = (html === '<p><br></p>') ? '' : html;
      });
    } catch (err) {
      console.warn('Quill initialization warning:', err);
    }
  }

  goBack() {
    this.router.navigate(['/projects']);
  }

  // ── Board switcher ───────────────────────────────────────────────────────
  //
  // Switching used to mean going back to the projects list and picking again.
  // This opens the list where you are and swaps the board underneath you —
  // the route param changes, the paramMap subscription above reloads, and the
  // component never unmounts.

  boardSwitcherOpen = signal(false);
  boardSearch = signal('');
  switchableBoards = signal<any[]>([]);
  boardsLoading = signal(false);

  filteredBoards = computed(() => {
    const q = this.boardSearch().trim().toLowerCase();
    const list = this.switchableBoards();
    if (!q) return list;
    return list.filter((p: any) =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.key || '').toLowerCase().includes(q) ||
      (p.client?.name || '').toLowerCase().includes(q),
    );
  });

  openBoardSwitcher() {
    this.boardSwitcherOpen.set(true);
    this.boardSearch.set('');
    setTimeout(() => {
      const el = document.getElementById('bsw-search-input') as HTMLInputElement;
      el?.focus();
    }, 60);

    // Fetched once and kept: the list rarely changes inside a session, and a
    // spinner on every open makes a switcher feel heavier than the navigation
    // it replaced.
    if (this.switchableBoards().length) return;

    this.boardsLoading.set(true);
    this.projectsService.getProjects().subscribe({
      next: (projects: any[]) => {
        this.switchableBoards.set(projects || []);
        this.boardsLoading.set(false);
      },
      error: () => {
        this.boardsLoading.set(false);
        this.toast.error('Could not load your boards.');
      },
    });
  }

  closeBoardSwitcher() {
    this.boardSwitcherOpen.set(false);
    this.boardSearch.set('');
  }

  onBoardSearchEnter() {
    const list = this.filteredBoards();
    if (!list.length) return;
    const target = list.find((b: any) => b.id !== this.projectId) || list[0];
    if (target) {
      this.switchToBoard(target);
    }
  }

  switchToBoard(project: any) {
    this.closeBoardSwitcher();
    if (!project?.id || project.id === this.projectId) return;
    this.router.navigate(['/projects', project.id]);
  }
}
