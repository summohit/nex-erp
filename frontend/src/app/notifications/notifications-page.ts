import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import {
  LucideCheck, LucideCheckCheck, LucideInbox,
  LucideRefreshCw, LucideChevronLeft, LucideChevronRight,
  LucideSettings, LucideBellOff, LucideLock, LucideX,
} from '@lucide/angular';
import {
  NotificationsService, NotificationItem, NotificationTypeCount, NotificationPrefs,
} from '../services/notifications.service';
import { SkeletonComponent } from '../shared/components/skeleton/skeleton.component';

@Component({
  selector: 'app-notifications-page',
  standalone: true,
  imports: [
    CommonModule, SkeletonComponent,
    LucideCheck, LucideCheckCheck, LucideInbox,
    LucideRefreshCw, LucideChevronLeft, LucideChevronRight,
    LucideSettings, LucideBellOff, LucideLock, LucideX,
  ],
  templateUrl: './notifications-page.html',
  styleUrls: ['./notifications-page.css'],
})
export class NotificationsPageComponent implements OnInit {
  private notificationsService = inject(NotificationsService);
  private router = inject(Router);

  items = signal<NotificationItem[]>([]);
  types = signal<NotificationTypeCount[]>([]);
  total = signal(0);
  isLoading = signal(true);

  /**
   * The filter chips only show types this user has actually received, but the
   * preference panel has to list everything they COULD receive — otherwise you
   * can't mute a type until after it has already interrupted you once.
   */
  readonly allTypes: { type: string; label: string; hint: string }[] = [
    { type: 'ACTION_REQUIRED', label: 'Needs your action', hint: 'Approvals and requests waiting on you' },
    { type: 'ASSIGNMENT',      label: 'Assigned to you',   hint: 'Tickets, deals and interviews you now own' },
    { type: 'LEAVE',           label: 'Leave',             hint: 'Leave requests and their outcomes' },
    { type: 'SUCCESS',         label: 'Completed',         hint: 'Work finished or approved' },
    { type: 'WARNING',         label: 'Warnings',          hint: 'Due dates and rejections' },
    { type: 'INFO',            label: 'Updates',           hint: 'Comments, status changes and general activity' },
    { type: 'PAYROLL',         label: 'Payroll',           hint: 'Payslips and pay run updates' },
  ];

  showPrefs = signal(false);
  prefsAvailable = signal(true);
  mutedTypes = signal<string[]>([]);
  unmutableTypes = signal<string[]>([]);
  savingType = signal<string | null>(null);

  filterType = signal<string>('');
  unreadOnly = signal(false);
  skip = signal(0);
  readonly pageSize = 25;

  /** Unread across everything, not just this page — matches the bell badge. */
  unreadCount = this.notificationsService.unreadCount;

  page = computed(() => Math.floor(this.skip() / this.pageSize) + 1);
  pageCount = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize)));
  hasPrev = computed(() => this.skip() > 0);
  hasNext = computed(() => this.skip() + this.pageSize < this.total());

  // Keys must match the strings the backend actually writes. LEAVE_REQUEST was
  // never one of them, so every leave notification fell through to the default.
  readonly typeStyles: Record<string, string> = {
    ACTION_REQUIRED: 'type-action',
    INFO: 'type-info',
    SUCCESS: 'type-success',
    WARNING: 'type-warning',
    LEAVE: 'type-leave',
    ASSIGNMENT: 'type-assignment',
    PAYROLL: 'type-payroll',
  };

  ngOnInit() {
    this.load();
    this.notificationsService.getTypes().subscribe({
      next: (t) => this.types.set(t || []),
      error: () => this.types.set([]),
    });

    this.notificationsService.getPreferences().subscribe({
      next: (p) => this.applyPrefs(p),
      error: () => { /* preferences unavailable — everything stays on */ },
    });
  }

  private applyPrefs(p: NotificationPrefs) {
    this.prefsAvailable.set(p?.available !== false);
    this.mutedTypes.set(p?.muted ?? []);
    this.unmutableTypes.set(p?.unmutable ?? []);
  }

  togglePrefs() {
    this.showPrefs.set(!this.showPrefs());
  }

  isMuted(type: string): boolean {
    return this.mutedTypes().includes(type);
  }

  /** Genuinely unmutable by policy — distinct from "not set up yet". */
  isLocked(type: string): boolean {
    return this.unmutableTypes().includes(type);
  }

  toggleMute(type: string) {
    if (this.isLocked(type) || !this.prefsAvailable()) return;
    const muted = !this.isMuted(type);

    // Optimistic, so the switch responds immediately; reverted if the call fails.
    const previous = this.mutedTypes();
    this.mutedTypes.set(muted ? [...previous, type] : previous.filter((t) => t !== type));
    this.savingType.set(type);

    this.notificationsService.setPreference(type, muted).subscribe({
      next: (p) => { this.applyPrefs(p); this.savingType.set(null); },
      error: () => { this.mutedTypes.set(previous); this.savingType.set(null); },
    });
  }

  load() {
    this.isLoading.set(true);
    this.notificationsService.fetchPage({
      type: this.filterType() || undefined,
      unreadOnly: this.unreadOnly(),
      skip: this.skip(),
      take: this.pageSize,
    }).subscribe({
      next: (res) => {
        this.items.set(res.notifications || []);
        this.total.set(res.total ?? 0);
        this.isLoading.set(false);
      },
      error: () => {
        this.items.set([]);
        this.total.set(0);
        this.isLoading.set(false);
      },
    });
  }

  /** Any filter change resets to the first page, or the pager lands out of range. */
  setType(type: string) {
    this.filterType.set(type);
    this.skip.set(0);
    this.load();
  }

  toggleUnreadOnly() {
    this.unreadOnly.set(!this.unreadOnly());
    this.skip.set(0);
    this.load();
  }

  prevPage() {
    if (!this.hasPrev()) return;
    this.skip.set(Math.max(0, this.skip() - this.pageSize));
    this.load();
  }

  nextPage() {
    if (!this.hasNext()) return;
    this.skip.set(this.skip() + this.pageSize);
    this.load();
  }

  open(item: NotificationItem) {
    if (!item.isRead) this.markRead(item);
    if (item.linkUrl) this.router.navigateByUrl(item.linkUrl);
  }

  markRead(item: NotificationItem, event?: Event) {
    event?.stopPropagation();
    if (item.isRead) return;
    // Optimistic: the row is already visibly "read" before the call returns.
    item.isRead = true;
    this.notificationsService.markAsRead(item.id);
  }

  markAllRead() {
    this.notificationsService.markAllAsRead();
    this.items.update((list) => list.map((n) => ({ ...n, isRead: true })));
    // Re-fetch when filtered to unread, since those rows no longer qualify.
    if (this.unreadOnly()) this.load();
  }

  formatType(type: string): string {
    return (type || '').replace(/_/g, ' ');
  }

  typeClass(type: string): string {
    return this.typeStyles[type] ?? 'type-info';
  }
}
