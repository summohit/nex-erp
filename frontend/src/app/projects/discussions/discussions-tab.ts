import {
  Component,
  input,
  signal,
  inject,
  OnInit,
  OnDestroy,
  ViewChild,
  ElementRef,
  ViewEncapsulation,
  computed
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { HotToastService } from '@ngneat/hot-toast';

import {
  ProjectDiscussionsService,
  ProjectDiscussion
} from '../../services/project-discussions.service';

import { ProjectsService } from '../../services/projects';

import {
  LucidePlus,
  LucideMessageSquare,
  LucideArrowLeft,
  LucideLoader2,
  LucidePaperclip,
  LucideAtSign,
  LucideSearch,
  LucideRefreshCw,
  LucideChevronRight,
  LucideInfo,
  LucideSend,
  LucideFileText,
  LucideExternalLink,
  LucideMoreHorizontal,
  LucideCalendarDays
} from '@lucide/angular';

declare var Quill: any;

export interface MentionMember {
  id: number;
  value: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  roleBadgeClass: string;
  avatarUrl: string;
  initials: string;
  order: number;
}

@Component({
  selector: 'app-discussions-tab',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucidePlus,
    LucideMessageSquare,
    LucideArrowLeft,
    LucideLoader2,
    LucidePaperclip,
    LucideAtSign,
    LucideSearch,
    LucideRefreshCw,
    LucideChevronRight,
    LucideInfo,
    LucideSend,
    LucideFileText,
    LucideExternalLink,
    LucideMoreHorizontal,
    LucideCalendarDays
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

  view = signal<'list' | 'create' | 'detail'>('list');

  discussions = signal<ProjectDiscussion[]>([]);
  selectedDiscussion = signal<ProjectDiscussion | null>(null);

  isLoading = signal(false);
  isSubmitting = signal(false);
  isUploading = signal(false);

  discussionSearch = '';

  newDiscussionTitle = '';
  newDiscussionContent = '';
  newCommentContent = '';

  mentionedUserIds: number[] = [];
  projectMembers: any[] = [];
  mentionMembers: MentionMember[] = [];
  private rawProject: any = null;
  private rawCompanyMembers: any[] = [];

  @ViewChild('createQuillContainer', { static: false })
  createQuillContainer!: ElementRef;

  @ViewChild('commentQuillContainer', { static: false })
  commentQuillContainer!: ElementRef;

  private createQuillInstance: any = null;
  private commentQuillInstance: any = null;

  filteredDiscussions = computed(() => {
    const query = this.discussionSearch.trim().toLowerCase();

    if (!query) {
      return this.discussions();
    }

    return this.discussions().filter((discussion: any) => {
      const title = String(discussion?.title || '').toLowerCase();
      const firstName = String(discussion?.author?.firstName || '').toLowerCase();
      const lastName = String(discussion?.author?.lastName || '').toLowerCase();

      return (
        title.includes(query) ||
        firstName.includes(query) ||
        lastName.includes(query)
      );
    });
  });

  ngOnInit(): void {
    this.loadDiscussions();
    this.loadMembers();
  }

  loadMembers(): void {
    // 1. Fetch project details to capture project Owner/Lead and all project members
    this.projectsApi.getProject(this.projectId()).subscribe({
      next: (project) => {
        this.rawProject = project;
        this.projectMembers = project.members || [];
        this.buildMentionMembers();
      },
      error: () => {
        this.projectMembers = [];
      }
    });

    // 2. Fetch company members so that any coworker can be mentioned in discussions
    this.projectsApi.getCompanyMembers(this.projectId()).subscribe({
      next: (compMembers) => {
        this.rawCompanyMembers = compMembers || [];
        this.buildMentionMembers();
      },
      error: () => {
        this.rawCompanyMembers = [];
      }
    });
  }

  private buildMentionMembers(): void {
    const map = new Map<number, MentionMember>();

    // 1. Project Owner / Lead
    if (this.rawProject?.lead) {
      const lead = this.rawProject.lead;
      const id = lead.userId || lead.user?.id || lead.id;
      const firstName = lead.firstName || '';
      const lastName = lead.lastName || '';
      const fullName = `${firstName} ${lastName}`.trim() || 'Project Owner';
      if (id) {
        map.set(id, {
          id,
          value: fullName,
          firstName,
          lastName,
          email: lead.user?.email || '',
          role: 'Owner',
          roleBadgeClass: 'role-badge-owner',
          avatarUrl: lead.avatarUrl || '',
          initials: this.getInitials(firstName, lastName),
          order: 1
        });
      }
    }

    // 2. Project Members (including Project Managers and Members)
    const members = this.rawProject?.members || [];
    for (const m of members) {
      const emp = m.employee || m;
      const id = emp.userId || emp.user?.id || m.userId || emp.id;
      if (!id) continue;

      const firstName = emp.firstName || '';
      const lastName = emp.lastName || '';
      const fullName = `${firstName} ${lastName}`.trim() || 'Member';
      const isPm = m.role === 'PROJECT_MANAGER';
      const isAdmin = m.role === 'ADMIN';
      const role = isPm ? 'Project Manager' : isAdmin ? 'Admin' : 'Member';
      const roleBadgeClass = isPm ? 'role-badge-pm' : isAdmin ? 'role-badge-admin' : 'role-badge-member';
      const order = isPm ? 2 : 3;

      if (!map.has(id)) {
        map.set(id, {
          id,
          value: fullName,
          firstName,
          lastName,
          email: emp.user?.email || '',
          role,
          roleBadgeClass,
          avatarUrl: emp.avatarUrl || '',
          initials: this.getInitials(firstName, lastName),
          order
        });
      }
    }

    // 3. Company Members (team members across the company)
    for (const cm of this.rawCompanyMembers) {
      const id = cm.userId || cm.user?.id || cm.id;
      if (!id) continue;

      if (!map.has(id)) {
        const firstName = cm.firstName || '';
        const lastName = cm.lastName || '';
        const fullName = `${firstName} ${lastName}`.trim() || 'Team Member';
        map.set(id, {
          id,
          value: fullName,
          firstName,
          lastName,
          email: cm.user?.email || '',
          role: cm.designation?.name || 'Team',
          roleBadgeClass: 'role-badge-team',
          avatarUrl: cm.avatarUrl || '',
          initials: this.getInitials(firstName, lastName),
          order: 4
        });
      }
    }

    this.mentionMembers = Array.from(map.values()).sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      return a.value.localeCompare(b.value);
    });
  }

  triggerMention(type: 'create' | 'comment' = 'comment'): void {
    const quill = type === 'create' ? this.createQuillInstance : this.commentQuillInstance;
    if (!quill) return;
    quill.focus();
    const range = quill.getSelection(true);
    const index = range ? range.index : quill.getLength();
    quill.insertText(index, '@');
    quill.setSelection(index + 1);
  }

  ngOnDestroy(): void {
    this.destroyQuillInstances();
  }

  trackDiscussion(index: number, discussion: ProjectDiscussion): number {
    return discussion.id;
  }

  totalComments(): number {
    return this.discussions().reduce(
      (total: number, discussion: any) =>
        total + Number(discussion?._count?.comments || 0),
      0
    );
  }

  getInitials(firstName?: string, lastName?: string): string {
    const first = (firstName || '').trim();
    const last = (lastName || '').trim();

    if (!first && !last) {
      return '?';
    }

    return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
  }

  formatRelativeDate(dateValue?: string | Date | null): string {
    if (!dateValue) {
      return '';
    }

    const date = new Date(dateValue);
    const now = new Date();

    const diffMs = now.getTime() - date.getTime();
    const diffMinutes = Math.floor(diffMs / 60000);

    if (diffMinutes < 1) {
      return 'just now';
    }

    if (diffMinutes < 60) {
      return `${diffMinutes}m ago`;
    }

    const diffHours = Math.floor(diffMinutes / 60);

    if (diffHours < 24) {
      return `${diffHours}h ago`;
    }

    const diffDays = Math.floor(diffHours / 24);

    if (diffDays < 7) {
      return `${diffDays}d ago`;
    }

    const diffWeeks = Math.floor(diffDays / 7);

    if (diffWeeks < 5) {
      return `${diffWeeks}w ago`;
    }

    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear()
        ? 'numeric'
        : undefined
    });
  }

  isRecent(dateValue?: string | Date | null): boolean {
    if (!dateValue) {
      return false;
    }

    const date = new Date(dateValue);
    const diffMs = Date.now() - date.getTime();

    return diffMs >= 0 && diffMs < 1000 * 60 * 60 * 24;
  }

  loadDiscussions(): void {
    this.isLoading.set(true);

    this.api.list(this.projectId()).subscribe({
      next: (data) => {
        this.discussions.set(data || []);
        this.isLoading.set(false);
      },
      error: () => {
        this.toast.error('Failed to load discussions');
        this.isLoading.set(false);
      }
    });
  }

  openDiscussion(id: number): void {
    this.isLoading.set(true);

    this.api.get(this.projectId(), id).subscribe({
      next: (discussion) => {
        this.selectedDiscussion.set(discussion);
        this.view.set('detail');

        this.newCommentContent = '';
        this.mentionedUserIds = [];

        this.destroyCommentQuill();

        this.isLoading.set(false);

        setTimeout(() => {
          this.initCommentQuill();
        }, 100);
      },
      error: () => {
        this.toast.error('Failed to load discussion');
        this.isLoading.set(false);
      }
    });
  }

  openCreateView(): void {
    this.view.set('create');

    this.newDiscussionTitle = '';
    this.newDiscussionContent = '';
    this.mentionedUserIds = [];

    this.destroyCreateQuill();

    setTimeout(() => {
      this.initCreateQuill();
    }, 100);
  }

  initCreateQuill(): void {
    if (!this.createQuillContainer) {
      setTimeout(() => this.initCreateQuill(), 100);
      return;
    }

    this.createQuillInstance = this.setupQuill(
      this.createQuillContainer.nativeElement,
      'Add context, details, links or a question...',
      (html: string) => {
        this.newDiscussionContent = html;
      }
    );
  }

  initCommentQuill(): void {
    if (!this.commentQuillContainer) {
      setTimeout(() => this.initCommentQuill(), 100);
      return;
    }

    this.commentQuillInstance = this.setupQuill(
      this.commentQuillContainer.nativeElement,
      'Write your reply...',
      (html: string) => {
        this.newCommentContent = html;
      }
    );
  }

  private setupQuill(
    element: HTMLElement,
    placeholder: string,
    onChange: (html: string) => void
  ): any {
    element.innerHTML = '';

    const mentionSource = (
      searchTerm: string,
      renderList: (items: any[], searchTerm: string) => void
    ) => {
      const members = this.mentionMembers || [];

      if (!searchTerm?.trim().length) {
        renderList(members, searchTerm);
        return;
      }

      const term = searchTerm.toLowerCase().trim();
      const filtered = members.filter((member: MentionMember) =>
        member.value.toLowerCase().includes(term) ||
        member.email.toLowerCase().includes(term) ||
        member.role.toLowerCase().includes(term)
      );

      renderList(filtered, searchTerm);
    };

    const quill = new Quill(element, {
      theme: 'snow',
      placeholder,
      modules: {
        toolbar: [
          ['bold', 'italic', 'underline', 'strike'],
          ['link', 'blockquote', 'code-block'],
          [{ list: 'ordered' }, { list: 'bullet' }],
          ['clean']
        ],
        mention: {
          allowedChars: /^[A-Za-z0-9\s._\-ÅÄÖåäö]*$/,
          mentionDenotationChars: ['@'],
          source: mentionSource,
          renderItem: (item: any) => {
            const avatarHtml = item.avatarUrl
              ? `<img src="${item.avatarUrl}" class="mention-avatar-img" alt="${item.value}" />`
              : `<div class="mention-avatar-placeholder">${item.initials || '?'}</div>`;

            const badgeHtml = item.role
              ? `<span class="mention-role-pill ${item.roleBadgeClass || ''}">${item.role}</span>`
              : '';

            const emailHtml = item.email
              ? `<span class="mention-email">${item.email}</span>`
              : '';

            return `
              <div class="mention-item-card">
                <div class="mention-avatar-circle">${avatarHtml}</div>
                <div class="mention-info">
                  <div class="mention-name-row">
                    <span class="mention-name">${item.value}</span>
                    ${badgeHtml}
                  </div>
                  ${emailHtml}
                </div>
              </div>
            `;
          }
        }
      }
    });

    quill.on('text-change', () => {
      const html =
        quill.root.innerHTML === '<p><br></p>'
          ? ''
          : quill.root.innerHTML;

      onChange(html);
      this.updateMentionedUsers(quill);
    });

    return quill;
  }

  private updateMentionedUsers(quill: any): void {
    const ids = new Set<number>();
    const mentionNodes = quill.root.querySelectorAll('.mention');

    mentionNodes.forEach((node: HTMLElement) => {
      const id = node.getAttribute('data-id');

      if (id) {
        const parsedId = Number(id);

        if (!Number.isNaN(parsedId)) {
          ids.add(parsedId);
        }
      }
    });

    this.mentionedUserIds = Array.from(ids);
  }

  createDiscussion(): void {
    if (!this.newDiscussionTitle.trim()) {
      this.toast.error('Discussion title is required');
      return;
    }

    if (!this.newDiscussionContent.trim()) {
      this.toast.error('Discussion message is required');
      return;
    }

    this.isSubmitting.set(true);

    this.api.create(this.projectId(), {
      title: this.newDiscussionTitle.trim(),
      content: this.newDiscussionContent,
      mentionedUserIds: this.mentionedUserIds
    }).subscribe({
      next: () => {
        this.toast.success('Discussion created');

        this.newDiscussionTitle = '';
        this.newDiscussionContent = '';
        this.mentionedUserIds = [];

        this.destroyCreateQuill();
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

  addComment(): void {
    if (!this.newCommentContent.trim()) {
      this.toast.error('Reply cannot be empty');
      return;
    }

    const discussion = this.selectedDiscussion();

    if (!discussion?.id) {
      return;
    }

    this.isSubmitting.set(true);

    this.api.addComment(this.projectId(), discussion.id, {
      content: this.newCommentContent,
      mentionedUserIds: this.mentionedUserIds
    }).subscribe({
      next: (comment) => {
        this.toast.success('Reply posted');

        const current = this.selectedDiscussion();

        if (current) {
          const comments = [
            ...(current.comments || []),
            comment
          ];

          this.selectedDiscussion.set({
            ...current,
            comments,
            _count: {
              ...(current as any)._count,
              comments: comments.length
            }
          });
        }

        this.newCommentContent = '';
        this.mentionedUserIds = [];

        if (this.commentQuillInstance?.root) {
          this.commentQuillInstance.root.innerHTML = '';
        }

        this.loadDiscussions();

        this.isSubmitting.set(false);
      },
      error: () => {
        this.toast.error('Failed to post reply');
        this.isSubmitting.set(false);
      }
    });
  }

  onFileSelected(event: any): void {
    const file = event.target?.files?.[0];
    const discussion = this.selectedDiscussion();

    if (!file || !discussion) {
      return;
    }

    this.isUploading.set(true);

    this.api.uploadAttachment(
      this.projectId(),
      discussion.id,
      file
    ).subscribe({
      next: (attachment) => {
        this.toast.success('File uploaded');

        const updatedAttachments = [
          ...(discussion.attachments || []),
          attachment
        ];

        this.selectedDiscussion.set({
          ...discussion,
          attachments: updatedAttachments
        });

        this.isUploading.set(false);

        if (event.target) {
          event.target.value = '';
        }
      },
      error: () => {
        this.toast.error('Failed to upload file');
        this.isUploading.set(false);

        if (event.target) {
          event.target.value = '';
        }
      }
    });
  }

  getSafeHtml(html: string | undefined): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(html || '');
  }

  private destroyCreateQuill(): void {
    try {
      if (this.createQuillInstance?.root) {
        this.createQuillInstance.root.innerHTML = '';
      }
    } catch {}

    this.createQuillInstance = null;
  }

  private destroyCommentQuill(): void {
    try {
      if (this.commentQuillInstance?.root) {
        this.commentQuillInstance.root.innerHTML = '';
      }
    } catch {}

    this.commentQuillInstance = null;
  }

  private destroyQuillInstances(): void {
    this.destroyCreateQuill();
    this.destroyCommentQuill();
  }
}
