import { Component, Input, Output, EventEmitter, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HotToastService } from '@ngneat/hot-toast';
import {
  LucideX, LucideEdit2, LucideCheck, LucideSend, LucideTrash2,
  LucideClock, LucideUser, LucideBuilding, LucideLayers,
  LucideAlertCircle, LucideCheckCircle2, LucideFlame,
  LucideMessageSquare, LucideArrowRight, LucideHistory,
  LucideSparkles, LucideCopy, LucideCalendar, LucideSearch,
  LucideChevronDown, LucideImage, LucideImagePlus
} from '@lucide/angular';
import { TicketService, Ticket, TicketComment, TicketEmployee, TicketPermissions } from '../../../services/ticket.service';
import { AuthService } from '../../../services/auth.service';

/** One row of the merged comment + activity feed. */
interface TimelineItem {
  id: number;
  createdAt: string;
  isComment?: boolean;
  isActivity?: boolean;
  // Comment fields
  body?: string;
  authorId?: number;
  author?: TicketEmployee;
  updatedAt?: string;
  // Activity fields
  action?: string;
  field?: string;
  oldValue?: string;
  newValue?: string;
  actor?: TicketEmployee;
}

/** The minimum a comment action needs — satisfied by both TicketComment and TimelineItem. */
type CommentRef = { id: number; authorId?: number; body?: string };

@Component({
  selector: 'app-ticket-detail',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    LucideX, LucideEdit2, LucideCheck, LucideSend, LucideTrash2,
    LucideClock, LucideUser, LucideBuilding, LucideLayers,
    LucideAlertCircle, LucideCheckCircle2, LucideFlame,
    LucideMessageSquare, LucideArrowRight, LucideHistory,
    LucideSparkles, LucideCopy, LucideCalendar, LucideSearch,
    LucideChevronDown, LucideImage, LucideImagePlus
  ],
  templateUrl: './ticket-detail.html',
  styleUrls: ['./ticket-detail.css'],
})
export class TicketDetailComponent implements OnInit {
  @Input() ticket!: Ticket;
  /** Server-resolved; null until loaded, which keeps triage controls hidden. */
  @Input() permissions: TicketPermissions | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() ticketUpdated = new EventEmitter<Ticket>();

  private ticketService = inject(TicketService);
  private authService = inject(AuthService);
  private toast = inject(HotToastService);

  commentBody = '';
  submittingComment = false;
  editingCommentId: number | null = null;
  editCommentBody = '';

  // Reassignment (restricted to the ticket's own department)
  showAssigneePicker = false;
  assigneeSearchQuery = '';
  assignableMembers: TicketEmployee[] = [];
  loadingMembers = false;

  showAdminStatusDropdown = false;
  adminStatusSearchQuery = '';

  readonly statusOptions = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'REJECTED'];

  readonly statusColors: Record<string, string> = {
    OPEN: 'status-open',
    IN_PROGRESS: 'status-in-progress',
    RESOLVED: 'status-resolved',
    CLOSED: 'status-closed',
    REJECTED: 'status-rejected',
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

  readonly typeBadgeClasses: Record<string, string> = {
    BUG: 'type-bug',
    FEATURE_REQUEST: 'type-feature',
    IMPROVEMENT: 'type-improvement',
    QUESTION: 'type-question',
  };

  // Time Tracker
  activeTimeEntry: any = null;
  timerInterval: any = null;
  elapsedSeconds = 0;

  ngOnInit() {
    this.refreshTicket();
  }

  ngOnDestroy() {
    if (this.timerInterval) clearInterval(this.timerInterval);
  }

  refreshTicket() {
    this.ticketService.getTicket(this.ticket.id).subscribe(t => {
      this.ticket = { ...this.ticket, ...t };
      this.checkActiveTimer();
    });
  }

  checkActiveTimer() {
    const active = this.ticket.timeEntries?.find(te => !te.endTime);
    if (active) {
      this.activeTimeEntry = active;
      this.startLocalTimer(new Date(active.startTime));
    } else {
      this.activeTimeEntry = null;
      if (this.timerInterval) clearInterval(this.timerInterval);
    }
  }

  startLocalTimer(startTime: Date) {
    if (this.timerInterval) clearInterval(this.timerInterval);
    const tick = () => {
      this.elapsedSeconds = Math.floor((new Date().getTime() - startTime.getTime()) / 1000);
    };
    tick();
    this.timerInterval = setInterval(tick, 1000);
  }

  get totalTrackedTime() {
    let total = this.ticket.timeEntries?.filter(te => te.duration).reduce((acc, curr) => acc + (curr.duration || 0), 0) || 0;
    if (this.activeTimeEntry) total += this.elapsedSeconds;
    return total;
  }

  formatDuration(seconds: number) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  toggleTimer() {
    if (this.activeTimeEntry) {
      this.ticketService.stopTimer(this.ticket.id, 'Session stopped').subscribe(() => this.refreshTicket());
    } else {
      this.ticketService.startTimer(this.ticket.id).subscribe(() => this.refreshTicket());
    }
  }

  // File Upload
  onAttachmentPicked(event: any) {
    const file = event.target.files?.[0];
    if (!file) return;
    this.ticketService.uploadImage(file).subscribe({
      next: (res) => {
        this.ticketService.addAttachment(this.ticket.id, { fileName: file.name, fileUrl: res.url, fileSize: file.size }).subscribe({
           next: () => {
             this.toast.success('File attached');
             this.refreshTicket();
           },
           error: () => this.toast.error('Failed to link attachment')
        });
      },
      error: () => this.toast.error('Upload failed')
    });
  }

  // Combined Timeline
  /**
   * Comments and activities merged into one chronological feed. Typed as a
   * single flat shape rather than a union: Angular templates cannot narrow a
   * union across *ngIf, so every field a branch touches must be visible here.
   */
  get historyTimeline(): TimelineItem[] {
    const comments: TimelineItem[] = (this.ticket.comments || []).map(c => ({ ...c, isComment: true }));
    const activities: TimelineItem[] = (this.ticket.activities || []).map(a => ({ ...a, isActivity: true }));
    return [...comments, ...activities].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }

  get currentUser() {
    return this.authService.currentUser as any;
  }

  formatLabel(val: string | undefined | null) {
    return (val || '').replace(/_/g, ' ');
  }

  // ─── Attachments ───────────────────────────────────────────────────────────

  private fileExtension(name: string): string {
    const i = (name || '').lastIndexOf('.');
    return i === -1 ? '' : name.slice(i).toLowerCase();
  }

  /** Only images get a thumbnail preview; everything else shows a typed badge. */
  isImageAttachment(fileName: string): boolean {
    return ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.heic']
      .includes(this.fileExtension(fileName));
  }

  fileTypeLabel(fileName: string): string {
    return this.fileExtension(fileName).replace('.', '').toUpperCase() || 'FILE';
  }

  fileTypeClass(fileName: string): string {
    const ext = this.fileExtension(fileName);
    if (['.pdf'].includes(ext)) return 'file-pdf';
    if (['.doc', '.docx', '.odt', '.rtf'].includes(ext)) return 'file-doc';
    if (['.xls', '.xlsx', '.ods', '.csv'].includes(ext)) return 'file-sheet';
    if (['.ppt', '.pptx', '.odp'].includes(ext)) return 'file-slide';
    if (['.zip', '.rar', '.7z'].includes(ext)) return 'file-archive';
    return 'file-generic';
  }

  close() {
    this.closed.emit();
  }

  copyTicketId() {
    navigator.clipboard?.writeText(this.ticket.ticketNumber);
    this.toast.success(`Copied ${this.ticket.ticketNumber} to clipboard!`);
  }

  getFilteredStatuses(query: string): string[] {
    const q = (query || '').toLowerCase().trim();
    if (!q) return this.statusOptions;
    return this.statusOptions.filter(s => this.formatLabel(s).toLowerCase().includes(q) || s.toLowerCase().includes(q));
  }

  changeStatus(status: string) {
    if (!status) return;
    this.showAdminStatusDropdown = false;
    this.ticketService.updateTicket(this.ticket.id, { status: status as any }).subscribe({
      next: (t) => {
        this.ticket = { ...this.ticket, ...t };
        this.ticketUpdated.emit(this.ticket);
        this.toast.success(`Status updated to ${this.formatLabel(status)}`);
      },
      error: () => this.toast.error('Failed to update status'),
    });
  }

  submitComment() {
    if (!this.commentBody.trim()) return;
    this.submittingComment = true;
    this.ticketService.addComment(this.ticket.id, this.commentBody.trim()).subscribe({
      next: (c) => {
        this.ticket = { ...this.ticket, comments: [...(this.ticket.comments ?? []), c] };
        this.commentBody = '';
        this.submittingComment = false;
        this.toast.success('Comment posted');
      },
      error: () => {
        this.toast.error('Failed to add comment');
        this.submittingComment = false;
      },
    });
  }

  startEditComment(comment: CommentRef) {
    this.editingCommentId = comment.id;
    this.editCommentBody = comment.body ?? '';
  }

  saveEditComment(comment: CommentRef) {
    if (!this.editCommentBody.trim()) return;
    this.ticketService.updateComment(this.ticket.id, comment.id, this.editCommentBody.trim()).subscribe({
      next: (updated) => {
        this.ticket = {
          ...this.ticket,
          comments: (this.ticket.comments ?? []).map((c) => (c.id === comment.id ? updated : c)),
        };
        this.editingCommentId = null;
        this.toast.success('Comment updated');
      },
      error: () => this.toast.error('Failed to update comment'),
    });
  }

  deleteComment(comment: CommentRef) {
    if (!confirm('Are you sure you want to delete this comment?')) return;
    this.ticketService.deleteComment(this.ticket.id, comment.id).subscribe({
      next: () => {
        this.ticket = { ...this.ticket, comments: (this.ticket.comments ?? []).filter((c) => c.id !== comment.id) };
        this.toast.success('Comment deleted');
      },
      error: () => this.toast.error('Failed to delete comment'),
    });
  }

  canEditComment(comment: CommentRef) {
    return comment.authorId === this.currentUser?.employeeId;
  }

  canDeleteComment(comment: CommentRef) {
    const isAdmin = ['SUPERADMIN', 'ADMIN'].includes(this.currentUser?.role);
    return isAdmin || comment.authorId === this.currentUser?.employeeId;
  }

  nextStatuses(): string[] {
    const flow: Record<string, string[]> = {
      OPEN: ['IN_PROGRESS', 'REJECTED'],
      IN_PROGRESS: ['RESOLVED', 'OPEN'],
      RESOLVED: ['CLOSED', 'IN_PROGRESS'],
      CLOSED: ['OPEN'],
      REJECTED: ['OPEN'],
    };
    return flow[this.ticket.status] ?? [];
  }

  /**
   * Triage rights (status changes, reassignment) come from the server, which
   * knows the user's department — the JWT does not carry it.
   */
  canManage(): boolean {
    return this.permissions?.canManage === true;
  }

  /** Free-form status override stays with management/admins. */
  isAdmin() {
    return this.permissions?.isManagement === true;
  }

  /** The person who raised the ticket. */
  isReporter(): boolean {
    const me = this.permissions?.employeeId ?? this.currentUser?.employeeId;
    return !!me && this.ticket.reporterId === me;
  }

  /**
   * Once the team marks a ticket Resolved, the reporter confirms the fix by
   * closing it themselves. That is the only change they may make.
   */
  canCloseAsReporter(): boolean {
    return !this.canManage() && this.isReporter() && this.ticket.status === 'RESOLVED';
  }

  closeAsReporter() {
    this.ticketService.updateTicket(this.ticket.id, { status: 'CLOSED' as any }).subscribe({
      next: (t) => {
        this.ticket = { ...this.ticket, ...t };
        this.ticketUpdated.emit(this.ticket);
        this.toast.success('Ticket closed — thanks for confirming!');
      },
      error: (err) => this.toast.error(err?.error?.message || 'Failed to close ticket'),
    });
  }

  // ─── Reassignment ──────────────────────────────────────────────────────────

  canReassign(): boolean {
    return this.canManage();
  }

  openAssigneePicker() {
    this.showAssigneePicker = true;
    this.assigneeSearchQuery = '';

    if (this.assignableMembers.length) return;

    this.loadingMembers = true;
    this.ticketService.getAssignableMembers(this.ticket.id).subscribe({
      next: (members) => {
        this.assignableMembers = members;
        this.loadingMembers = false;
      },
      error: () => {
        this.toast.error('Failed to load team members');
        this.loadingMembers = false;
      },
    });
  }

  filteredMembers(): TicketEmployee[] {
    const q = this.assigneeSearchQuery.toLowerCase().trim();
    if (!q) return this.assignableMembers;
    return this.assignableMembers.filter((m) =>
      `${m.firstName} ${m.lastName}`.toLowerCase().includes(q) ||
      (m.designation?.name ?? '').toLowerCase().includes(q)
    );
  }

  reassignTo(member: TicketEmployee) {
    if (this.ticket.assigneeId === member.id) {
      this.showAssigneePicker = false;
      return;
    }

    this.ticketService.updateTicket(this.ticket.id, { assigneeId: member.id }).subscribe({
      next: (t) => {
        this.ticket = { ...this.ticket, ...t };
        this.ticketUpdated.emit(this.ticket);
        this.showAssigneePicker = false;
        this.toast.success(`Reassigned to ${member.firstName} ${member.lastName}`);
      },
      error: (err) => this.toast.error(err?.error?.message || 'Failed to reassign ticket'),
    });
  }
}
