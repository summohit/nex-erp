import { Component, signal, inject, OnInit, ViewChild, ElementRef, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { CdkDragDrop, moveItemInArray, transferArrayItem, DragDropModule } from '@angular/cdk/drag-drop';
import { ProjectsService } from '../../services/projects';
import { 
  LucideLayoutDashboard, LucideKanban,
  LucidePlus, LucideX, LucideClock, LucideMessageSquare,
  LucideZap, LucideSparkles, LucideFilter, LucideStar, LucideShare2, LucideMoreHorizontal,
  LucideInbox, LucideCalendar, LucideChevronDown, LucideChevronLeft, LucideChevronRight, LucideChevronsLeft, LucideChevronsRight,
  LucideArrowLeft, LucideEdit2, LucidePencil, LucideImage,
  LucideAlignLeft, LucideTag, LucideCheckSquare, LucideUsers, LucideCheck, LucideSend, LucideTrash2, LucideRepeat,
  LucidePaperclip, LucideExternalLink, LucideFileText, LucideDownload
} from '@lucide/angular';
import { AuthService } from '../../services/auth.service';
import { HotToastService } from '@ngneat/hot-toast';

import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

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
    LucideAlignLeft, LucideTag, LucideCheckSquare, LucideUsers, LucideCheck, LucideSend, LucideTrash2, LucideRepeat,
    LucidePaperclip, LucideExternalLink, LucideFileText, LucideDownload
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

  activeTab = signal<'board'|'backlog'|'analytics'|'settings'>('board');

  // Inline Quick Add Card
  addingCardColumnId = signal<number | null>(null);
  inlineCardTitle = signal<string>('');
  
  // Issue Drawer / Modal
  isDrawerOpen = signal(false);
  activePopover = signal<string | null>(null);
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

  ngOnInit() {
    this.route.paramMap.subscribe(params => {
      const id = params.get('id');
      if (id) {
        this.projectId = +id;
        this.loadProjectDetails();
        this.loadBoardAndIssues();
      }
    });
  }

  loadProjectDetails() {
    this.projectsService.getProject(this.projectId).subscribe({
      next: (res) => this.project.set(res),
      error: (err) => console.error(err)
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

  getColumnIssues(columnId: number): any[] {
    return this.issuesByColumn().get(columnId) || [];
  }

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
      this.projectsService.updateIssue(this.projectId, issue.id, { columnId: targetColumnId }).subscribe({
        error: (err) => {
          this.toast.error('Failed to move issue');
          this.loadBoardAndIssues(); // Revert
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

  togglePopover(popoverName: string) {
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
      if (popoverName === 'dates') {
        this.initDatesForm();
      }
      if (popoverName === 'members') {
        this.loadCompanyMembers();
        this.memberSearchQuery = '';
      }
      this.activePopover.set(popoverName);
    }
  }

  closePopover() {
    this.activePopover.set(null);
    this.labelPopoverMode.set('list');
    this.activeEditLabel.set(null);
    this.showTimeDropdown.set(false);
    this.showRecurringDropdown.set(false);
    this.showReminderDropdown.set(false);
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

    const progressInterval = setInterval(() => {
      this.uploadProgress.update(p => (p < 85 ? p + 15 : p));
    }, 250);

    this.projectsService.uploadAttachment(this.projectId, issue.id, file).subscribe({
      next: (att) => {
        clearInterval(progressInterval);
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
        clearInterval(progressInterval);
        this.isUploadingAttachment.set(false);
        this.uploadProgress.set(0);
        this.toast.error('Failed to upload file to ImageKit');
      }
    });
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
