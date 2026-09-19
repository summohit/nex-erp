import { Component, inject, signal, computed } from "@angular/core";
import { CommonModule, DatePipe } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { HotToastService } from "@ngneat/hot-toast";
import {
  LucideMegaphone, LucidePlus, LucideX, LucideMail, LucideArchive, LucideEdit2,
  LucidePaperclip, LucideUploadCloud, LucideFileText, LucideLoader2, LucideSearch,
  LucideFilter, LucideAlertTriangle, LucideCheckCircle2, LucideClock, LucideCalendar,
  LucideUser, LucideDownload, LucideTrash2, LucideSparkles, LucideChevronDown,
  LucideChevronUp, LucideRefreshCw, LucideFile, LucideImage, LucideFileSpreadsheet,
  LucideExternalLink, LucideEye, LucideBell, LucideShare2, LucideCheck
} from "@lucide/angular";
import { NoticesService, Notice, NoticeAttachment } from "../../services/notices";
import { UploadService } from "../../services/upload.service";

/**
 * Company Notice Board Component.
 * Enterprise Announcement Hub with live stats, search, filtering, and rich attachments.
 */
@Component({
  selector: "app-notices",
  standalone: true,
  imports: [
    CommonModule, FormsModule, DatePipe,
    LucideMegaphone, LucidePlus, LucideX, LucideMail, LucideArchive, LucideEdit2,
    LucidePaperclip, LucideUploadCloud, LucideFileText, LucideLoader2, LucideSearch,
    LucideFilter, LucideAlertTriangle, LucideCheckCircle2, LucideClock, LucideCalendar,
    LucideUser, LucideDownload, LucideTrash2, LucideSparkles, LucideChevronDown,
    LucideChevronUp, LucideRefreshCw, LucideFile, LucideImage, LucideFileSpreadsheet,
    LucideExternalLink, LucideEye, LucideBell, LucideShare2, LucideCheck,
  ],
  templateUrl: "./notices.html",
  styleUrls: ["./notices.css"],
})
export class NoticesComponent {
  private api = inject(NoticesService);
  private toast = inject(HotToastService);
  private uploads = inject(UploadService);

  notices = signal<Notice[]>([]);
  canPost = signal(false);
  loading = signal(true);
  saving = signal(false);
  formOpen = signal(false);
  editingId = signal<number | null>(null);

  // Search, Filter & Sort State
  searchQuery = signal("");
  statusFilter = signal<"ALL" | "ACTIVE" | "HIGH" | "ATTACHMENTS" | "SCHEDULED" | "EXPIRED">("ALL");
  priorityFilter = signal<string>("ALL");
  sortBy = signal<"NEWEST" | "OLDEST" | "PRIORITY">("NEWEST");

  // Expanded cards state (for long bodies)
  expandedNoticeIds = signal<Set<number>>(new Set());

  // In-app Retire Confirmation Modal
  retiringNotice = signal<Notice | null>(null);
  retireLoading = signal(false);

  // Quick feedback for copied notice
  copiedNoticeId = signal<number | null>(null);

  // Form State
  form = this.blank();
  attachments = signal<{ fileName: string; fileUrl: string; fileSize?: number | null }[]>([]);
  uploading = signal(false);

  // Visual Priority Options for Composer
  readonly priorityOptions = [
    {
      value: "HIGH" as const,
      label: "Urgent / High Priority",
      description: "Opens automatically on dashboards, flagged with high prominence",
      colorTag: "high",
    },
    {
      value: "NORMAL" as const,
      label: "Standard Announcement",
      description: "General company updates, policy notes, and department news",
      colorTag: "normal",
    },
    {
      value: "LOW" as const,
      label: "Informational",
      description: "Low-priority reminders, informal tips, and optional activities",
      colorTag: "low",
    },
  ];

  // Computed KPI Metrics
  totalCount = computed(() => this.notices().length);

  activeCount = computed(() =>
    this.notices().filter((n) => n.isActive && !this.hasExpired(n) && !this.isScheduled(n)).length
  );

  highPriorityCount = computed(() =>
    this.notices().filter((n) => n.priority === "HIGH" && n.isActive && !this.hasExpired(n)).length
  );

  expiredCount = computed(() =>
    this.notices().filter((n) => this.hasExpired(n) || !n.isActive).length
  );

  scheduledCount = computed(() =>
    this.notices().filter((n) => this.isScheduled(n)).length
  );

  withAttachmentsCount = computed(() =>
    this.notices().filter((n) => (n.attachments?.length || 0) > 0).length
  );

  hasActiveFilters = computed(() => {
    return (
      this.searchQuery().trim().length > 0 ||
      this.statusFilter() !== "ALL" ||
      this.priorityFilter() !== "ALL" ||
      this.sortBy() !== "NEWEST"
    );
  });

  // Filtered & Sorted Notices
  filteredNotices = computed(() => {
    let list = [...this.notices()];

    // 1. Text Search across title, body, author
    const query = this.searchQuery().trim().toLowerCase();
    if (query) {
      list = list.filter((n) => {
        const titleMatch = (n.title || "").toLowerCase().includes(query);
        const bodyMatch = (n.body || "").toLowerCase().includes(query);
        const authorMatch = n.createdBy
          ? `${n.createdBy.firstName} ${n.createdBy.lastName}`.toLowerCase().includes(query)
          : false;
        return titleMatch || bodyMatch || authorMatch;
      });
    }

    // 2. Status Filter
    const sFilter = this.statusFilter();
    if (sFilter === "ACTIVE") {
      list = list.filter((n) => n.isActive && !this.hasExpired(n) && !this.isScheduled(n));
    } else if (sFilter === "HIGH") {
      list = list.filter((n) => n.priority === "HIGH" && n.isActive && !this.hasExpired(n));
    } else if (sFilter === "ATTACHMENTS") {
      list = list.filter((n) => (n.attachments?.length || 0) > 0);
    } else if (sFilter === "SCHEDULED") {
      list = list.filter((n) => this.isScheduled(n));
    } else if (sFilter === "EXPIRED") {
      list = list.filter((n) => this.hasExpired(n) || !n.isActive);
    }

    // 3. Priority Filter (if explicitly set)
    const pFilter = this.priorityFilter();
    if (pFilter !== "ALL") {
      list = list.filter((n) => n.priority === pFilter);
    }

    // 4. Sorting
    const sort = this.sortBy();
    list.sort((a, b) => {
      if (sort === "NEWEST") {
        const dateA = new Date(a.publishedAt || a.createdAt).getTime();
        const dateB = new Date(b.publishedAt || b.createdAt).getTime();
        return dateB - dateA;
      } else if (sort === "OLDEST") {
        const dateA = new Date(a.publishedAt || a.createdAt).getTime();
        const dateB = new Date(b.publishedAt || b.createdAt).getTime();
        return dateA - dateB;
      } else if (sort === "PRIORITY") {
        const weights: Record<string, number> = { HIGH: 3, NORMAL: 2, LOW: 1 };
        const diff = (weights[b.priority] || 0) - (weights[a.priority] || 0);
        if (diff !== 0) return diff;
        return new Date(b.publishedAt || b.createdAt).getTime() - new Date(a.publishedAt || a.createdAt).getTime();
      }
      return 0;
    });

    return list;
  });

  constructor() {
    this.load();
  }

  private blank() {
    return {
      title: "",
      body: "",
      priority: "NORMAL" as "LOW" | "NORMAL" | "HIGH",
      publishedAt: "",
      expiresAt: "",
      sendEmail: true,
    };
  }

  load() {
    this.loading.set(true);
    this.api.list().subscribe({
      next: (res) => {
        this.notices.set(res?.notices || []);
        this.canPost.set(!!res?.canPost);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.toast.error(err?.error?.message || "Could not load the notice board");
      },
    });
  }

  setStatusFilter(tab: "ALL" | "ACTIVE" | "HIGH" | "ATTACHMENTS" | "SCHEDULED" | "EXPIRED") {
    this.statusFilter.set(tab);
  }

  clearAllFilters() {
    this.searchQuery.set("");
    this.statusFilter.set("ALL");
    this.priorityFilter.set("ALL");
    this.sortBy.set("NEWEST");
  }

  hasExpired(n: Notice): boolean {
    return !!n.expiresAt && new Date(n.expiresAt).getTime() < Date.now();
  }

  isScheduled(n: Notice): boolean {
    return !!n.publishedAt && new Date(n.publishedAt).getTime() > Date.now();
  }

  toggleExpand(id: number) {
    this.expandedNoticeIds.update((set) => {
      const next = new Set(set);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  isExpanded(id: number): boolean {
    return this.expandedNoticeIds().has(id);
  }

  isLongBody(body: string): boolean {
    return (body || "").length > 240 || (body || "").split("\n").length > 4;
  }

  openNew() {
    this.form = this.blank();
    this.attachments.set([]);
    this.editingId.set(null);
    this.formOpen.set(true);
  }

  openEdit(n: Notice) {
    this.form = {
      title: n.title,
      body: n.body,
      priority: n.priority,
      publishedAt: n.publishedAt ? n.publishedAt.slice(0, 10) : "",
      expiresAt: n.expiresAt ? n.expiresAt.slice(0, 10) : "",
      sendEmail: false,
    };
    this.attachments.set(
      n.attachments
        ? n.attachments.map((a) => ({
            fileName: a.fileName,
            fileUrl: a.fileUrl,
            fileSize: a.fileSize,
          }))
        : []
    );
    this.editingId.set(n.id);
    this.formOpen.set(true);
  }

  close() {
    this.formOpen.set(false);
    this.editingId.set(null);
  }

  selectPriority(val: "LOW" | "NORMAL" | "HIGH") {
    this.form.priority = val;
  }

  setExpiryDays(days: number) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    this.form.expiresAt = d.toISOString().slice(0, 10);
  }

  clearExpiry() {
    this.form.expiresAt = "";
  }

  onFilesPicked(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []);
    input.value = "";
    if (!files.length) return;

    this.uploading.set(true);
    let remaining = files.length;

    for (const file of files) {
      this.uploads.uploadFile(file).subscribe({
        next: (res: any) => {
          const url = res?.url || res?.fileUrl || res?.secure_url;
          if (url) {
            this.attachments.update((list) => [
              ...list,
              { fileName: file.name, fileUrl: url, fileSize: file.size },
            ]);
          } else {
            this.toast.error(`${file.name} uploaded but returned no link`);
          }
          if (--remaining === 0) this.uploading.set(false);
        },
        error: (err) => {
          if (--remaining === 0) this.uploading.set(false);
          this.toast.error(err?.error?.message || `Could not upload ${file.name}`);
        },
      });
    }
  }

  removeAttachment(index: number) {
    this.attachments.update((list) => list.filter((_, i) => i !== index));
  }

  fileSize(bytes?: number | null): string {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  getFileType(fileName: string): "pdf" | "image" | "spreadsheet" | "doc" | "other" {
    const ext = (fileName || "").split(".").pop()?.toLowerCase() || "";
    if (ext === "pdf") return "pdf";
    if (["png", "jpg", "jpeg", "webp", "gif", "svg"].includes(ext)) return "image";
    if (["xlsx", "xls", "csv"].includes(ext)) return "spreadsheet";
    if (["doc", "docx", "txt", "rtf"].includes(ext)) return "doc";
    return "other";
  }

  getInitials(first?: string, last?: string): string {
    const f = (first || "").trim()[0] || "";
    const l = (last || "").trim()[0] || "";
    return (f + l).toUpperCase() || "NB";
  }

  getAvatarBg(first?: string, last?: string): string {
    const str = `${first || ""}${last || ""}`.toLowerCase();
    const colors = [
      "linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%)",
      "linear-gradient(135deg, #10B981 0%, #047857 100%)",
      "linear-gradient(135deg, #F59E0B 0%, #B45309 100%)",
      "linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)",
      "linear-gradient(135deg, #EC4899 0%, #BE185D 100%)",
      "linear-gradient(135deg, #06B6D4 0%, #0E7490 100%)",
    ];
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  }

  copyNoticeText(n: Notice) {
    const author = n.createdBy ? `${n.createdBy.firstName} ${n.createdBy.lastName}` : "Company Announcement";
    const text = `📢 ${n.title}\n\n${n.body}\n\n— ${author}`;
    navigator.clipboard.writeText(text).then(() => {
      this.copiedNoticeId.set(n.id);
      this.toast.success("Notice copied to clipboard");
      setTimeout(() => {
        if (this.copiedNoticeId() === n.id) {
          this.copiedNoticeId.set(null);
        }
      }, 2500);
    }).catch(() => {
      this.toast.error("Failed to copy notice");
    });
  }

  save() {
    const title = this.form.title.trim();
    const body = this.form.body.trim();
    if (!title) { this.toast.error("A notice needs a title"); return; }
    if (!body) { this.toast.error("A notice needs something to say"); return; }

    const payload = {
      title,
      body,
      priority: this.form.priority,
      publishedAt: this.form.publishedAt || null,
      expiresAt: this.form.expiresAt || null,
      sendEmail: this.form.sendEmail,
      attachments: this.attachments(),
    };

    this.saving.set(true);
    const id = this.editingId();
    const req$ = id ? this.api.update(id, payload) : this.api.create(payload as any);

    req$.subscribe({
      next: () => {
        this.saving.set(false);
        this.close();
        this.load();
        this.toast.success(
          id ? "Notice updated successfully"
             : (this.form.sendEmail ? "Notice posted and emailed to team" : "Notice posted successfully"),
        );
      },
      error: (err) => {
        this.saving.set(false);
        this.toast.error(err?.error?.message || "Could not save the notice");
      },
    });
  }

  openRetireModal(n: Notice) {
    this.retiringNotice.set(n);
  }

  closeRetireModal() {
    this.retiringNotice.set(null);
    this.retireLoading.set(false);
  }

  confirmRetire() {
    const n = this.retiringNotice();
    if (!n) return;

    this.retireLoading.set(true);
    this.api.retire(n.id).subscribe({
      next: () => {
        this.retireLoading.set(false);
        this.closeRetireModal();
        this.load();
        this.toast.success(`Notice "${n.title}" has been retired`);
      },
      error: (err) => {
        this.retireLoading.set(false);
        this.toast.error(err?.error?.message || "Could not retire the notice");
      },
    });
  }
}
