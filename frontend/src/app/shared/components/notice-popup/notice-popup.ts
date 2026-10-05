import { Component, DestroyRef, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter, interval } from 'rxjs';
import {
  LucideAlertTriangle, LucideBell, LucideFileText, LucideX, LucidePaperclip, LucideImage,
  LucideFileSpreadsheet, LucideFile, LucideExternalLink, LucideChevronRight, LucideCheck,
} from '@lucide/angular';
import { NoticesService, Notice, noticeBodyHtml } from '../../../services/notices';
import { NotificationsService } from '../../../services/notifications.service';

/** How often to look again, for a notice scheduled to go live later. */
const RECHECK_MS = 5 * 60 * 1000;
/** Page changes look again too, but not more often than this. */
const NAV_RECHECK_MS = 60 * 1000;

/**
 * The high-priority notice popup, on every page rather than only the
 * dashboard.
 *
 * It looks for an unread HIGH notice addressed to this person when the app
 * opens, when the server says one has just been posted, every few minutes,
 * and on page changes. The periodic look is what catches a notice scheduled
 * for later, which nobody is told about when it is written. Closing it marks
 * it read, which is what the sender's view count counts.
 */
@Component({
  selector: 'app-notice-popup',
  standalone: true,
  imports: [
    CommonModule, DatePipe, RouterModule,
    LucideAlertTriangle, LucideBell, LucideFileText, LucideX, LucidePaperclip, LucideImage,
    LucideFileSpreadsheet, LucideFile, LucideExternalLink, LucideChevronRight, LucideCheck,
  ],
  templateUrl: './notice-popup.html',
  styleUrls: ['./notice-popup.css'],
})
export class NoticePopupComponent {
  private notices = inject(NoticesService);
  private realtime = inject(NotificationsService);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  active = signal<Notice | null>(null);
  readonly noticeHtml = noticeBodyHtml;

  /** Closed in this session, so a slow markRead cannot bring one back. */
  private closed = new Set<number>();
  private lastCheck = 0;

  constructor() {
    this.check();

    this.realtime.noticePosted
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.check());

    interval(RECHECK_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.check());

    this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (Date.now() - this.lastCheck > NAV_RECHECK_MS) this.check();
      });
  }

  private check() {
    if (this.active()) return;
    this.lastCheck = Date.now();
    this.notices.forDashboard().subscribe({
      next: (list) => {
        const urgent = (list || []).find(
          (n) => !n.isRead && n.priority === 'HIGH' && !this.closed.has(n.id),
        );
        if (urgent && !this.active()) this.active.set(urgent);
      },
      // Silent: a page that loads without its notice is better than one that
      // greets people with an error.
      error: () => {},
    });
  }

  dismiss(n: Notice | null) {
    this.active.set(null);
    if (!n) return;
    this.closed.add(n.id);
    this.notices.markRead(n.id).subscribe({ error: () => {} });
    // Another may be waiting behind this one.
    setTimeout(() => this.check(), 400);
  }

  getInitials(first?: string, last?: string): string {
    const f = (first || '').trim()[0] || '';
    const l = (last || '').trim()[0] || '';
    return (f + l).toUpperCase() || 'NB';
  }

  getAvatarBg(first?: string, last?: string): string {
    const str = `${first || ''}${last || ''}`.toLowerCase();
    const colors = [
      'linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%)',
      'linear-gradient(135deg, #10B981 0%, #047857 100%)',
      'linear-gradient(135deg, #6b3fd6 0%, #4f2aa7 100%)',
      'linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)',
      'linear-gradient(135deg, #6b3fd6 0%, #6a6b6c 100%)',
      'linear-gradient(135deg, #06B6D4 0%, #0E7490 100%)',
    ];
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  }

  getFileType(fileName?: string): 'pdf' | 'image' | 'spreadsheet' | 'doc' | 'other' {
    const ext = (fileName || '').split('.').pop()?.toLowerCase() || '';
    if (ext === 'pdf') return 'pdf';
    if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(ext)) return 'image';
    if (['xlsx', 'xls', 'csv'].includes(ext)) return 'spreadsheet';
    if (['doc', 'docx', 'txt', 'rtf'].includes(ext)) return 'doc';
    return 'other';
  }

  fileSize(bytes?: number | null): string {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
}
