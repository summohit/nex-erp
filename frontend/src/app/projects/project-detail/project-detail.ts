import { Component, signal, computed, inject, OnInit, ViewChild, ElementRef, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { CdkDragDrop, moveItemInArray, transferArrayItem, DragDropModule } from '@angular/cdk/drag-drop';
import { ProjectsService, ProjectSummary } from '../../services/projects';
import { 
  LucideLayoutDashboard, LucideKanban,
  LucidePlus, LucideX, LucideClock, LucideMessageSquare,
  LucideZap, LucideSparkles, LucideFilter, LucideStar, LucideShare2, LucideMoreHorizontal,
  LucideInbox, LucideCalendar, LucideChevronDown, LucideChevronLeft, LucideChevronRight, LucideChevronsLeft, LucideChevronsRight,
  LucideArrowLeft, LucideEdit2, LucidePencil, LucideImage,
  LucideAlignLeft, LucideTag, LucideCheckSquare, LucideUsers, LucideCheck, LucideTrash2, LucideRepeat,
  LucidePaperclip, LucideExternalLink, LucideDownload, LucideMail, LucideCopy, LucideLock,
  LucideGlobe, LucideList, LucideGanttChart, LucideFileText, LucideFile, LucideBarChart, LucideBox, LucideArchive,
  LucideUser, LucideSearch, LucideCornerDownLeft, LucideVideo, LucideMusic, LucideLayoutGrid
} from '@lucide/angular';
import { AuthService } from '../../services/auth.service';
import { HotToastService } from '@ngneat/hot-toast';

import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { AgGridAngular } from 'ag-grid-angular';
import { ColDef, ModuleRegistry, AllCommunityModule, ValidationModule, CellClickedEvent } from 'ag-grid-community';

ModuleRegistry.registerModules([AllCommunityModule, ValidationModule]);

declare var Quill: any;

@Component({
  selector: 'app-project-detail',
  standalone: true,
  imports: [
    CommonModule, FormsModule, DragDropModule,
    LucideLayoutDashboard, LucideKanban,
    LucidePlus, LucideX, LucideClock, LucideMessageSquare,
    LucideZap, LucideSparkles, LucideFilter, LucideStar, LucideShare2, LucideMoreHorizontal,
    LucideInbox, LucideCalendar, LucideChevronDown, LucideChevronLeft, LucideChevronRight, LucideChevronsLeft, LucideChevronsRight,
    LucideArrowLeft, LucideEdit2, LucidePencil, LucideImage,
    LucideAlignLeft, LucideTag, LucideCheckSquare, LucideUsers, LucideCheck, LucideTrash2, LucideRepeat,
    LucidePaperclip, LucideExternalLink, LucideDownload, LucideMail, LucideCopy, LucideLock,
    LucideGlobe, LucideList, LucideGanttChart, LucideFileText, LucideFile, LucideBarChart, LucideBox, LucideArchive,
    LucideUser, LucideSearch, LucideCornerDownLeft, LucideVideo, LucideMusic, LucideLayoutGrid,
    AgGridAngular
  ],
  templateUrl: './project-detail.html',
  styleUrls: ['./project-detail.css'],
  encapsulation: ViewEncapsulation.None
})
export class ProjectDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private projectsService = inject(ProjectsService);
  private authService = inject(AuthService);
  private toast = inject(HotToastService);
  private sanitizer = inject(DomSanitizer);

  projectId!: number;
  project = signal<any>(null);
  board = signal<any>(null);
  
  // Organized by columnId
  columns = signal<any[]>([]);
  issuesByColumn = signal<Map<number, any[]>>(new Map());
  allIssues = signal<any[]>([]);

  // Attachments Tab Filters
  attSearchQuery = signal<string>('');
  attFilterAddedBy = signal<number[]>([]);
  attFilterTypes = signal<string[]>([]);
  attFilterDate = signal<string>('');

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

  // Compute all attachments across the project
  projectAttachments = computed(() => {
    const issues = this.allIssues();
    let allAtts: any[] = [];
    
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
    if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp'].includes(ext)) return '#db2777';
    if (['pdf'].includes(ext)) return '#dc2626';
    if (['doc', 'docx', 'txt'].includes(ext)) return '#2563eb';
    if (['xls', 'xlsx', 'csv'].includes(ext)) return '#16a34a';
    if (['ppt', 'pptx'].includes(ext)) return '#ea580c';
    if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) return '#0284c7';
    if (['mp3', 'wav', 'ogg'].includes(ext)) return '#9333ea';
    return '#b3bac5';
  }

  openIssueDetailsById(issueId: number) {
    const issue = this.allIssues().find(i => i.id === issueId);
    if (issue) this.openIssueDetails(issue);
  }

  activeTab = signal<'board'|'backlog'|'analytics'|'settings'>('board');
  activeProjectTab = signal<string>('board');
  projectSummary = signal<ProjectSummary | null>(null);

  // List Tab Filters
  listSearchQuery = signal<string>('');
  listFilterAssigneeIds = signal<number[]>([]);
  listFilterColumnIds = signal<number[]>([]);
  listFilterPriorities = signal<string[]>([]);
  listFilterMyIssues = signal<boolean>(false);

  filteredListIssues = computed(() => {
    let issues = this.allIssues();
    
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

    if (this.listFilterColumnIds().length > 0) {
      issues = issues.filter(i => this.listFilterColumnIds().includes(i.columnId));
    }

    if (this.listFilterPriorities().length > 0) {
      issues = issues.filter(i => this.listFilterPriorities().includes(i.priority));
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

  toggleListFilterColumn(id: number) {
    const current = this.listFilterColumnIds();
    if (current.includes(id)) {
      this.listFilterColumnIds.set(current.filter(x => x !== id));
    } else {
      this.listFilterColumnIds.set([...current, id]);
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
    this.listFilterColumnIds.set([]);
    this.listFilterPriorities.set([]);
    this.listFilterMyIssues.set(false);
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
    let issues = this.allIssues();
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
  
  // Issue Drawer / Modal
  isDrawerOpen = signal(false);
  activePopover = signal<string | null>(null);
  activeMemberProfile = signal<any>(null);
  selectedIssue = signal<any>(null);
  issueForm = {
    title: '',
    description: '',
    type: 'TASK',
    priority: 'MEDIUM',
    columnId: null as number | null,
    completed: false
  };
  commentText = '';
  
  @ViewChild('quillContainer') quillContainer!: ElementRef;
  private quillInstance: any = null;
  
  currentUser = this.authService.currentUser;

  hasAccess = signal<boolean>(true);

  ngOnInit() {
    this.route.paramMap.subscribe(params => {
      const id = params.get('id');
      if (id) {
        this.projectId = +id;
        this.hasAccess.set(true);
        this.loadProjectDetails();
        this.loadBoardAndIssues();

        const savedTab = localStorage.getItem('project_active_tab');
        if (savedTab) {
          this.setProjectTab(savedTab);
        } else {
          this.setProjectTab('board');
        }
      }
    });
  }

  setProjectTab(tab: string) {
    this.activeProjectTab.set(tab);
    localStorage.setItem('project_active_tab', tab);
    if (tab === 'summary') {
      this.loadSummary();
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
      'CANCELLED': '#f87171'
    };
    return colors[status] || '#94a3b8';
  }

  getPriorityColor(priority: string): string {
    const colors: any = {
      'CRITICAL': '#ef4444',
      'HIGH': '#f97316',
      'MEDIUM': '#eab308',
      'LOW': '#22c55e'
    };
    return colors[priority] || '#94a3b8';
  }

  getAssigneeColor(index: number): string {
    const palette = ['#3b82f6', '#8b5cf6', '#ec4899', '#f43f5e', '#f59e0b', '#10b981', '#06b6d4'];
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

  loadBoardAndIssues() {
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
          }
        });
      }
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

  getColumnIssues(columnId: number): any[] {
    let issues = this.issuesByColumn().get(columnId) || [];
    
    // Keyword Filter
    const query = this.filterQuery().toLowerCase().trim();
    if (query) {
      issues = issues.filter(i => 
        i.title.toLowerCase().includes(query) || 
        i.key?.toLowerCase().includes(query)
      );
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

  toggleColumnPopover(columnId: number) {
    if (this.activeColumnPopoverId() === columnId) {
      this.activeColumnPopoverId.set(null);
    } else {
      this.activeColumnPopoverId.set(columnId);
    }
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
    if (!confirm('Are you sure you want to archive this list? Any cards inside will be moved to the backlog.')) return;
    
    this.projectsService.deleteBoardColumn(this.projectId, columnId).subscribe({
      next: () => {
        this.columns.update(cols => cols.filter(c => c.id !== columnId));
        this.issuesByColumn.update(map => {
          map.delete(columnId);
          return new Map(map);
        });
        this.activeColumnPopoverId.set(null);
        this.toast.success('List archived');
        // Reload issues to fetch the updated unassigned/backlog issues
        this.loadBoardAndIssues();
      },
      error: () => this.toast.error('Failed to archive list')
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

  getColumnName(columnId: number | null): string {
    if (!columnId) return 'Select List';
    const col = this.columns().find(c => c.id === columnId);
    return col ? col.name : 'Unknown';
  }

  getStatusDotClass(columnId: number | null): string {
    if (!columnId) return 'dot-todo';
    const col = this.columns().find(c => c.id === columnId);
    if (!col) return 'dot-todo';
    const name = col.name.toLowerCase();
    if (name.includes('progress') || name.includes('doing')) return 'dot-in-progress';
    if (name.includes('review')) return 'dot-in-review';
    if (name.includes('done') || name.includes('complete')) return 'dot-done';
    return 'dot-todo';
  }

  drop(event: CdkDragDrop<any[]>, targetColumnId: number) {
    if (event.previousContainer === event.container) {
      moveItemInArray(event.container.data, event.previousIndex, event.currentIndex);
    } else {
      transferArrayItem(
        event.previousContainer.data,
        event.container.data,
        event.previousIndex,
        event.currentIndex,
      );
      
      const issue = event.container.data[event.currentIndex];
      
      // Update backend
      this.projectsService.updateIssue(this.projectId, issue.id, { 
        columnId: targetColumnId
      }).subscribe({
        error: (err) => {
          this.toast.error('Failed to move issue');
          this.loadBoardAndIssues(); // Revert
        }
      });
    }
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
      this.projectsService.updateIssue(this.projectId, this.selectedIssue().id, { columnId }).subscribe({
        next: () => {
          this.toast.success('Status updated');
          this.loadBoardAndIssues();
        },
        error: (err) => {
          this.toast.error('Failed to update status');
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
  }

  cancelInlineAdd() {
    this.addingCardColumnId.set(null);
    this.inlineCardTitle.set('');
  }

  submitInlineCard(columnId: number) {
    const title = this.inlineCardTitle().trim();
    if (!title) return;

    const payload = {
      title,
      columnId,
      type: 'TASK',
      priority: 'MEDIUM'
    };

    this.projectsService.createIssue(this.projectId, payload).subscribe({
      next: () => {
        this.toast.success('Card added');
        this.cancelInlineAdd();
        this.loadBoardAndIssues();
      },
      error: (err) => this.toast.error('Failed to add card')
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
      completed: false
    };
    this.isDrawerOpen.set(true);
    setTimeout(() => this.initQuill(), 100);
  }

  openIssueDetails(issue: any) {
    this.selectedIssue.set(issue);
    this.isEditingDescription.set(false);
    this.issueForm = {
      title: issue.title,
      description: issue.description,
      type: issue.type,
      priority: issue.priority,
      columnId: issue.columnId,
      completed: !!issue.completed
    };
    this.isDrawerOpen.set(true);
    this.loadComments(issue.id);
    this.loadChecklists(issue.id);
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

  loadComments(issueId: number) {
    this.projectsService.getIssueComments(this.projectId, issueId).subscribe({
      next: (res) => this.comments.set(res || []),
      error: () => this.comments.set([])
    });
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

  closeDrawer() {
    this.isDrawerOpen.set(false);
    this.selectedIssue.set(null);
    this.quillInstance = null;
    this.closePopover();
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
        if (val === 'CRITICAL') color = '#dc2626';
        else if (val === 'HIGH') color = '#ea580c';
        else if (val === 'MEDIUM') color = '#ca8a04';
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
    const all = this.allIssues();
    
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
  listGridColDefs: ColDef[] = [
    { field: 'key', headerName: 'ID', width: 100, pinned: 'left' },
    { field: 'title', headerName: 'Task', minWidth: 200, flex: 1, filter: true },
    { 
      headerName: 'List', 
      width: 140,
      valueGetter: (params: any) => {
        const col = this.columns().find(c => c.id === params.data?.columnId);
        return col ? col.name : 'Unknown';
      }
    },
    { 
      field: 'status', 
      headerName: 'Status', 
      width: 140,
      cellRenderer: (params: any) => {
        const val = params.value || '';
        let color = '#94a3b8'; let bg = '#f1f5f9';
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
        if (val === 'CRITICAL') color = '#dc2626';
        else if (val === 'HIGH') color = '#ea580c';
        else if (val === 'MEDIUM') color = '#ca8a04';
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

  addProjectMember(employee: any) {
    if (!this.canManageMembers) {
      this.toast.error('Only Admins or Project Lead can add members');
      return;
    }
    this.projectsService.addProjectMember(this.projectId, employee.id).subscribe({
      next: () => {
        this.loadProjectDetails(); // Reload to get updated roles/state from server
        this.toast.success(`${employee.firstName || 'Member'} added to project`);
      },
      error: () => this.toast.error('Failed to add member to project')
    });
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
    '#0079bf', '#d29034', '#519839', '#b04632', '#89609e', '#cd5a91', '#4bbf6b', '#00aecc', '#838c91'
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
    { fill: '#fef3c7', border: '#946f00' },
    { fill: '#fed7aa', border: '#c25100' },
    { fill: '#ffd6d6', border: '#c9372c' },
    { fill: '#e9d5ff', border: '#6e5dc6' },
    // Row 2 (standard green, yellow, orange, red, purple)
    { fill: '#4bce97' },
    { fill: '#f5cd47' },
    { fill: '#fea362' },
    { fill: '#f87462' },
    { fill: '#9f8fef' },
    // Row 3 (dark green, olive, dark orange, dark red, dark purple)
    { fill: '#1f845a' },
    { fill: '#946f00' },
    { fill: '#c25100' },
    { fill: '#c9372c' },
    { fill: '#6e5dc6' },
    // Row 4 (subtle blue, sky, lime, pink, grey)
    { fill: '#cce0ff', border: '#0c66e4' },
    { fill: '#c6edfb', border: '#206a83' },
    { fill: '#d3f1a7', border: '#4c6b1f' },
    { fill: '#fdd8e5', border: '#943d73' },
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
    const darkColors = ['#1f845a', '#946f00', '#c25100', '#c9372c', '#6e5dc6', '#0c66e4', '#206a83', '#4c6b1f', '#943d73', '#505f79'];
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
  }

  formatDateToDDMMYYYY(d: Date): string {
    const dd = d.getDate().toString().padStart(2, '0');
    const mm = (d.getMonth() + 1).toString().padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }

  parseDDMMYYYY(s: string): Date | null {
    if (!s) return null;
    const parts = s.split('/');
    if (parts.length !== 3) return null;
    const d = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const y = parseInt(parts[2], 10);
    if (isNaN(d) || isNaN(m) || isNaN(y)) return null;
    return new Date(y, m, d);
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
    
    const days: any[] = [];

    // Previous month padding days
    for (let i = dayOfWeek - 1; i >= 0; i--) {
      const dNum = prevMonthLastDate - i;
      const dObj = new Date(year, month - 1, dNum);
      days.push(this.buildDayCell(dNum, dObj, false, today, startDateObj, dueDateObj));
    }

    // Current month days
    for (let i = 1; i <= daysInMonth; i++) {
      const dObj = new Date(year, month, i);
      days.push(this.buildDayCell(i, dObj, true, today, startDateObj, dueDateObj));
    }

    // Next month padding days to complete 42 cells (6 rows x 7)
    const totalCells = days.length;
    const remaining = 42 - totalCells;
    for (let i = 1; i <= remaining; i++) {
      const dObj = new Date(year, month + 1, i);
      days.push(this.buildDayCell(i, dObj, false, today, startDateObj, dueDateObj));
    }

    return days;
  }

  buildDayCell(dayNumber: number, dObj: Date, isCurrentMonth: boolean, today: Date, startDateObj: Date | null, dueDateObj: Date | null): any {
    const isToday = dObj.getFullYear() === today.getFullYear() && dObj.getMonth() === today.getMonth() && dObj.getDate() === today.getDate();
    
    let isStart = false;
    let isDue = false;
    let isInRange = false;

    if (startDateObj && this.isSameDay(dObj, startDateObj)) {
      isStart = true;
    }
    if (dueDateObj && this.isSameDay(dObj, dueDateObj)) {
      isDue = true;
    }

    if (startDateObj && dueDateObj && startDateObj < dueDateObj) {
      if (dObj > startDateObj && dObj < dueDateObj) {
        isInRange = true;
      }
    }

    return {
      dayNumber,
      dateObj: dObj,
      isCurrentMonth,
      isToday,
      isStart,
      isDue,
      isInRange
    };
  }

  isSameDay(d1: Date, d2: Date): boolean {
    return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
  }

  selectCalendarDate(dayCell: any) {
    const formatted = this.formatDateToDDMMYYYY(dayCell.dateObj);

    if (this.datesForm.enableStartDate && this.datesForm.enableDueDate) {
      const startObj = this.parseDDMMYYYY(this.datesForm.startDateStr);
      if (!startObj || dayCell.dateObj < startObj) {
        this.datesForm.startDateStr = formatted;
      } else {
        this.datesForm.dueDateStr = formatted;
      }
    } else if (this.datesForm.enableStartDate) {
      this.datesForm.startDateStr = formatted;
    } else {
      this.datesForm.enableDueDate = true;
      this.datesForm.dueDateStr = formatted;
    }
  }

  saveDates() {
    const issue = this.selectedIssue();
    if (!issue) return;

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
  memberSearchQuery = '';
  shareTab = signal<'members'|'invite'>('members');

  copyBoardLink() {
    navigator.clipboard.writeText(window.location.href);
    this.toast.success('Board link copied to clipboard!');
  }

  loadCompanyMembers() {
    this.projectsService.getCompanyMembers(this.projectId).subscribe({
      next: (res) => this.companyMembers.set(res || []),
      error: () => this.companyMembers.set([])
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
    const colors = ['#0c66e4', '#1f845a', '#c25100', '#c9372c', '#6e5dc6', '#943d73', '#206a83', '#505f79'];
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
    const file = event.target?.files?.[0];
    if (!file) return;

    const issue = this.selectedIssue();
    if (!issue) return;

    this.isUploadingAttachment.set(true);
    this.uploadProgress.set(15);

    this.uploadProgressInterval = setInterval(() => {
      this.uploadProgress.update(p => (p < 85 ? p + 15 : p));
    }, 250);

    this.uploadSubscription = this.projectsService.uploadAttachment(this.projectId, issue.id, file).subscribe({
      next: (att) => {
        clearInterval(this.uploadProgressInterval);
        this.uploadProgress.set(100);
        setTimeout(() => {
          this.isUploadingAttachment.set(false);
          this.uploadProgress.set(0);
          const updatedAtts = [att, ...(issue.attachments || [])];
          this.selectedIssue.update(i => i ? { ...i, attachments: updatedAtts } : null);
          this.toast.success(`Attached ${file.name}`);
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
      error: () => this.toast.error('Failed to toggle cover')
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
}
