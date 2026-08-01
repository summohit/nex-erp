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
  LucideInbox, LucideCalendar, LucideChevronDown,
  LucideArrowLeft, LucideEdit2, LucideImage, LucideCircle,
  LucideAlignLeft, LucideTag, LucideCheckSquare, LucideUsers
} from '@lucide/angular';
import { AuthService } from '../../services/auth.service';
import { HotToastService } from '@ngneat/hot-toast';

declare var Quill: any;

@Component({
  selector: 'app-project-detail',
  standalone: true,
  imports: [
    CommonModule, FormsModule, DragDropModule,
    LucideLayoutDashboard, LucideKanban,
    LucidePlus, LucideX, LucideClock, LucideMessageSquare,
    LucideZap, LucideSparkles, LucideFilter, LucideStar, LucideShare2, LucideMoreHorizontal,
    LucideInbox, LucideCalendar, LucideChevronDown,
    LucideArrowLeft, LucideEdit2, LucideImage, LucideCircle,
    LucideAlignLeft, LucideTag, LucideCheckSquare, LucideUsers
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
    columnId: null as number | null
  };
  
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

  openCreateIssue(columnId?: number) {
    this.selectedIssue.set(null);
    this.issueForm = {
      title: '',
      description: '',
      type: 'TASK',
      priority: 'MEDIUM',
      columnId: columnId || (this.columns().length > 0 ? this.columns()[0].id : null)
    };
    this.isDrawerOpen.set(true);
    setTimeout(() => this.initQuill(), 100);
  }

  openIssueDetails(issue: any) {
    this.selectedIssue.set(issue);
    this.issueForm = {
      title: issue.title,
      description: issue.description,
      type: issue.type,
      priority: issue.priority,
      columnId: issue.columnId
    };
    this.isDrawerOpen.set(true);
    setTimeout(() => this.initQuill(), 100);
  }

  closeDrawer() {
    this.isDrawerOpen.set(false);
    this.selectedIssue.set(null);
    this.closePopover();
  }

  togglePopover(popoverName: string) {
    if (this.activePopover() === popoverName) {
      this.closePopover();
    } else {
      this.activePopover.set(popoverName);
    }
  }

  closePopover() {
    this.activePopover.set(null);
  }

  saveIssue() {
    if (this.selectedIssue()) {
      this.projectsService.updateIssue(this.projectId, this.selectedIssue().id, this.issueForm).subscribe({
        next: () => {
          this.toast.success('Issue updated');
          this.loadBoardAndIssues();
          this.closeDrawer();
        }
      });
    } else {
      this.projectsService.createIssue(this.projectId, this.issueForm).subscribe({
        next: () => {
          this.toast.success('Issue created');
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

  initQuill() {
    if (!this.quillContainer) return;
    
    if (!this.quillInstance) {
      if (typeof Quill === 'undefined') {
        setTimeout(() => this.initQuill(), 200);
        return;
      }

      this.quillInstance = new Quill(this.quillContainer.nativeElement, {
        theme: 'snow',
        placeholder: 'Add description...'
      });

      this.quillInstance.on('text-change', () => {
        this.issueForm.description = this.quillInstance.root.innerHTML;
      });
    }

    if (this.quillInstance) {
      this.quillInstance.clipboard.dangerouslyPasteHTML(this.issueForm.description || '');
    }
  }

  goBack() {
    this.router.navigate(['/projects']);
  }
}
