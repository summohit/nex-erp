import { Component, input, signal, computed, inject, OnInit, OnDestroy, ViewChild, ElementRef, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { HotToastService } from '@ngneat/hot-toast';
import { ProjectDiscussionsService, ProjectDiscussion, ProjectDiscussionComment } from '../../services/project-discussions.service';
import { ProjectsService } from '../../services/projects';
import { 
  LucidePlus, LucideMessageSquare, LucideArrowLeft, LucideLoader2, LucidePaperclip, LucideAtSign
} from '@lucide/angular';

declare var Quill: any;

@Component({
  selector: 'app-discussions-tab',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    LucidePlus, LucideMessageSquare, LucideArrowLeft, LucideLoader2, LucidePaperclip, LucideAtSign
  ],
  templateUrl: './discussions-tab.html',
  styleUrls: ['./discussions-tab.css'],
  encapsulation: ViewEncapsulation.None
})
export class DiscussionsTabComponent implements OnInit, OnDestroy {
  projectId = input.required<number>();

  private api = inject(ProjectDiscussionsService);
  private projectsApi = inject(ProjectsService);
  private toast = inject(HotToastService);
  private sanitizer = inject(DomSanitizer);

  view = signal<'list'|'create'|'detail'>('list');
  discussions = signal<ProjectDiscussion[]>([]);
  selectedDiscussion = signal<ProjectDiscussion | null>(null);
  
  isLoading = signal(false);
  isSubmitting = signal(false);
  isUploading = signal(false);

  newDiscussionTitle = '';
  newDiscussionContent = '';
  newCommentContent = '';
  mentionedUserIds: number[] = [];

  projectMembers: any[] = [];

  discussionSearch = '';

  filteredDiscussions = computed(() => {
    const search = this.discussionSearch.trim().toLowerCase();

    if (!search) {
      return this.discussions();
    }

    return this.discussions().filter((disc) => {
      const title = disc.title?.toLowerCase() || '';
      const firstName = disc.author?.firstName?.toLowerCase() || '';
      const lastName = disc.author?.lastName?.toLowerCase() || '';
      const author = `${firstName} ${lastName}`.trim();

      return title.includes(search) || author.includes(search);
    });
  });

  trackDiscussion(index: number, discussion: ProjectDiscussion): number {
    return discussion.id;
  }

  getInitials(firstName?: string, lastName?: string): string {
    const first = firstName?.trim()?.charAt(0) || '';
    const last = lastName?.trim()?.charAt(0) || '';

    return (`${first}${last}`.toUpperCase() || 'U');
  }

  formatRelativeDate(date: string | Date | undefined): string {
    if (!date) return '';

    const created = new Date(date).getTime();
    const diff = Date.now() - created;

    if (diff < 0) return 'Just now';

    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;

    return new Date(date).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  }

  isRecent(date: string | Date | undefined): boolean {
    if (!date) return false;

    const created = new Date(date).getTime();
    const diff = Date.now() - created;

    return diff >= 0 && diff <= 48 * 60 * 60 * 1000;
  }

  totalComments(): number {
    return this.discussions().reduce(
      (total, discussion) =>
        total + (discussion._count?.comments || 0),
      0
    );
  }


  @ViewChild('createQuillContainer', { static: false }) createQuillContainer!: ElementRef;
  @ViewChild('commentQuillContainer', { static: false }) commentQuillContainer!: ElementRef;
  
  private createQuillInstance: any;
  private commentQuillInstance: any;
  
  ngOnInit() {
    this.loadDiscussions();
    this.projectsApi.getProject(this.projectId()).subscribe({
      next: (p) => {
        this.projectMembers = p.members || [];
      }
    });
  }
  
  ngOnDestroy() {}

  loadDiscussions() {
    this.isLoading.set(true);
    this.api.list(this.projectId()).subscribe({
      next: (data) => {
        this.discussions.set(data);
        this.isLoading.set(false);
      },
      error: () => {
        this.toast.error('Failed to load discussions');
        this.isLoading.set(false);
      }
    });
  }

  openDiscussion(id: number) {
    this.isLoading.set(true);
    this.api.get(this.projectId(), id).subscribe({
      next: (disc) => {
        this.selectedDiscussion.set(disc);
        this.view.set('detail');
        this.isLoading.set(false);
        this.newCommentContent = '';
        this.mentionedUserIds = [];
        setTimeout(() => this.initCommentQuill(), 100);
      },
      error: () => {
        this.toast.error('Failed to load discussion details');
        this.isLoading.set(false);
      }
    });
  }

  openCreateView() {
    this.view.set('create');
    this.newDiscussionTitle = '';
    this.newDiscussionContent = '';
    this.mentionedUserIds = [];
    setTimeout(() => this.initCreateQuill(), 100);
  }

  initCreateQuill() {
    if (!this.createQuillContainer) {
      setTimeout(() => this.initCreateQuill(), 100);
      return;
    }
    this.createQuillInstance = this.setupQuill(this.createQuillContainer.nativeElement, 'Start a discussion...', (html) => {
      this.newDiscussionContent = html;
    });
  }

  initCommentQuill() {
    if (!this.commentQuillContainer) {
      setTimeout(() => this.initCommentQuill(), 100);
      return;
    }
    this.commentQuillInstance = this.setupQuill(this.commentQuillContainer.nativeElement, 'Write a comment...', (html) => {
      this.newCommentContent = html;
    });
  }

  private setupQuill(el: HTMLElement, placeholder: string, onChange: (html: string) => void) {
    el.innerHTML = '';
    const mentionSource = (searchTerm: string, renderList: (data: any[], searchTerm: string) => void) => {
      if (searchTerm.length === 0) {
        renderList(this.projectMembers.map(m => ({ id: m.employee.userId, value: `${m.employee.firstName} ${m.employee.lastName}` })), searchTerm);
      } else {
        const matches = this.projectMembers.filter(m => {
          const name = `${m.employee.firstName} ${m.employee.lastName}`.toLowerCase();
          return name.includes(searchTerm.toLowerCase());
        }).map(m => ({ id: m.employee.userId, value: `${m.employee.firstName} ${m.employee.lastName}` }));
        renderList(matches, searchTerm);
      }
    };

    const q = new Quill(el, {
      theme: 'snow',
      placeholder,
      modules: {
        toolbar: [
          ['bold', 'italic', 'underline', 'strike'],
          ['link', 'blockquote', 'code-block'],
          [{ 'list': 'ordered'}, { 'list': 'bullet' }],
          ['clean']
        ],
        mention: {
          allowedChars: /^[A-Za-z\sÅÄÖåäö]*$/,
          mentionDenotationChars: ["@"],
          source: mentionSource
        }
      }
    });

    q.on('text-change', () => {
      const html = q.root.innerHTML === '<p><br></p>' ? '' : q.root.innerHTML;
      onChange(html);
      
      // Extract mentions
      const mentionNodes = q.root.querySelectorAll('.mention');
      const ids = new Set<number>();
      mentionNodes.forEach((n: any) => {
        const id = n.getAttribute('data-id');
        if (id) ids.add(Number(id));
      });
      this.mentionedUserIds = Array.from(ids);
    });
    return q;
  }

  createDiscussion() {
    if (!this.newDiscussionTitle.trim() || !this.newDiscussionContent.trim()) {
      this.toast.error('Title and content are required');
      return;
    }
    this.isSubmitting.set(true);
    this.api.create(this.projectId(), {
      title: this.newDiscussionTitle,
      content: this.newDiscussionContent,
      mentionedUserIds: this.mentionedUserIds
    }).subscribe({
      next: (disc) => {
        this.toast.success('Discussion created');
        this.newDiscussionTitle = '';
        this.newDiscussionContent = '';
        this.mentionedUserIds = [];
        this.view.set('list');
        this.loadDiscussions();
        this.isSubmitting.set(false);
      },
      error: () => {
        this.toast.error('Failed to create discussion');
        this.isSubmitting.set(false);
      }
    });
  }

  addComment() {
    if (!this.newCommentContent.trim()) {
      this.toast.error('Comment cannot be empty');
      return;
    }
    const discId = this.selectedDiscussion()?.id;
    if (!discId) return;

    this.isSubmitting.set(true);
    this.api.addComment(this.projectId(), discId, {
      content: this.newCommentContent,
      mentionedUserIds: this.mentionedUserIds
    }).subscribe({
      next: (comment) => {
        this.toast.success('Comment added');
        this.newCommentContent = '';
        this.mentionedUserIds = [];
        if (this.commentQuillInstance) {
          this.commentQuillInstance.root.innerHTML = '';
        }
        
        // Update local state
        const curr = this.selectedDiscussion();
        if (curr) {
          const comments = [...(curr.comments || []), comment];
          this.selectedDiscussion.set({ ...curr, comments });
        }
        this.isSubmitting.set(false);
      },
      error: () => {
        this.toast.error('Failed to add comment');
        this.isSubmitting.set(false);
      }
    });
  }

  onFileSelected(event: any) {
    const file = event.target.files?.[0];
    if (!file) return;
    const disc = this.selectedDiscussion();
    if (!disc) return;

    this.isUploading.set(true);
    this.api.uploadAttachment(this.projectId(), disc.id, file).subscribe({
      next: (att) => {
        this.toast.success('File uploaded');
        const updated = [...(disc.attachments || []), att];
        this.selectedDiscussion.set({ ...disc, attachments: updated });
        this.isUploading.set(false);
      },
      error: () => {
        this.toast.error('Failed to upload file');
        this.isUploading.set(false);
      }
    });
  }

  getSafeHtml(html: string | undefined): SafeHtml {
    if (!html) return this.sanitizer.bypassSecurityTrustHtml('');
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }
}
