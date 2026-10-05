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
  LucideExternalLink, LucideEye, LucideBell, LucideShare2, LucideCheck, LucideUsers,
} from "@lucide/angular";
import { QuillModule } from "ngx-quill";
import Quill from "quill";
import {
  NoticesService, Notice, NoticeAttachment, AudienceOptions, NoticeViews, NoticeAudience,
  noticeBodyHtml, noticeBodyText,
} from "../../services/notices";
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
    LucideUsers, QuillModule,
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

  /** A posted notice's audience, shown read-only while editing it. */
  editingAudience = signal<NoticeAudience | null>(null);

  // Form State
  form = this.blank();
  attachments = signal<{ fileName: string; fileUrl: string; fileSize?: number | null }[]>([]);
  uploading = signal(false);

  // ─── Audience ────────────────────────────────────────────────────────────
  // Empty everywhere means everybody. A notice's audience is fixed once posted:
  // the recipients were resolved and stored then.
  audienceOptions = signal<AudienceOptions | null>(null);
  audienceMode = signal<"ALL" | "SELECTED">("ALL");
  pickedDepartments = signal<Set<number>>(new Set());
  pickedRoles = signal<Set<string>>(new Set());
  pickedDesignations = signal<Set<number>>(new Set());
  pickedUsers = signal<Set<number>>(new Set());
  /** Matched by the group picks, then unticked. */
  excludedUsers = signal<Set<number>>(new Set());
  personQuery = signal("");
  matchQuery = signal("");

  /**
   * Designations merged by name. Each department keeps its own copy of a
   * title, so "Trainee" can be three rows; to whoever is sending a notice it
   * is one job.
   */
  designationGroups = computed(() => {
    const opts = this.audienceOptions();
    if (!opts) return [];
    const byName = new Map<string, number[]>();
    for (const d of opts.designations) {
      const key = d.name.trim();
      byName.set(key, [...(byName.get(key) || []), d.id]);
    }
    return [...byName.entries()]
      .map(([name, ids]) => ({ name, ids }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  isDesignationGroupOn(ids: number[]) {
    return ids.some((id) => this.pickedDesignations().has(id));
  }

  toggleDesignationGroup(ids: number[]) {
    const on = this.isDesignationGroupOn(ids);
    this.pickedDesignations.update((set) => {
      const next = new Set(set);
      ids.forEach((id) => (on ? next.delete(id) : next.add(id)));
      return next;
    });
  }

  /**
   * When the picks match nobody, which kind of pick is to blame: the one
   * whose removal would bring people back.
   */
  emptyHint = computed(() => {
    const opts = this.audienceOptions();
    if (!opts || !this.hasGroup() || this.groupMatches().length) return "";
    const d = this.pickedDepartments(), r = this.pickedRoles(), g = this.pickedDesignations();
    const count = (useD: boolean, useR: boolean, useG: boolean) => opts.people.filter((p) =>
      (!useD || !d.size || (p.departmentId != null && d.has(p.departmentId)))
      && (!useR || !r.size || r.has(p.role))
      && (!useG || !g.size || (p.designationId != null && g.has(p.designationId))),
    ).length;
    const tips: string[] = [];
    if (d.size && count(false, true, true)) tips.push(`without the department pick, ${count(false, true, true)} would match`);
    if (r.size && count(true, false, true)) tips.push(`without the role pick, ${count(true, false, true)} would match`);
    if (g.size && count(true, true, false)) tips.push(`without the designation pick, ${count(true, true, false)} would match`);
    return tips.length ? tips.join("; ") : "";
  });

  private hasGroup = computed(() =>
    this.pickedDepartments().size > 0 || this.pickedRoles().size > 0 || this.pickedDesignations().size > 0,
  );

  /**
   * Everyone the department, role and designation picks match, before any
   * unticking. Each kind picked narrows the others.
   */
  groupMatches = computed(() => {
    const opts = this.audienceOptions();
    if (!opts || !this.hasGroup()) return [];
    const d = this.pickedDepartments(), r = this.pickedRoles(), g = this.pickedDesignations();
    return opts.people.filter((p) =>
      (!d.size || (p.departmentId != null && d.has(p.departmentId)))
      && (!r.size || r.has(p.role))
      && (!g.size || (p.designationId != null && g.has(p.designationId))),
    );
  });

  visibleMatches = computed(() => {
    const q = this.matchQuery().trim().toLowerCase();
    const list = this.groupMatches();
    return q ? list.filter((p) => p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q)) : list;
  });

  tickedMatchCount = computed(() =>
    this.groupMatches().filter((p) => !this.excludedUsers().has(p.userId)).length,
  );

  /** Who the current picks reach, worked out the way the server does. */
  recipientCount = computed(() => {
    const opts = this.audienceOptions();
    if (!opts) return 0;
    if (this.audienceMode() === "ALL") return opts.people.length;
    const ids = new Set(
      this.groupMatches().filter((p) => !this.excludedUsers().has(p.userId)).map((p) => p.userId),
    );
    this.pickedUsers().forEach((id) => ids.add(id));
    return ids.size;
  });

  /** The picks in words, as the server will apply them. */
  pickSummary = computed(() => {
    const opts = this.audienceOptions();
    if (!opts) return "";
    const deptNames = opts.departments.filter((x) => this.pickedDepartments().has(x.id)).map((x) => x.name);
    const desigNames = [...new Set(opts.designations.filter((x) => this.pickedDesignations().has(x.id)).map((x) => x.name.trim()))];
    const roleNames = [...this.pickedRoles()].map((x) => this.roleLabel(x));
    const parts: string[] = [];
    if (desigNames.length) parts.push(desigNames.join(" or "));
    if (roleNames.length) parts.push(`${roleNames.join(" or ")} role`);
    let group = parts.join(", ");
    if (deptNames.length) group = `${group || "Everyone"} in ${deptNames.join(" or ")}`;
    const excluded = this.groupMatches().length - this.tickedMatchCount();
    if (group && excluded) group += ` (except ${excluded})`;
    const n = this.pickedUsers().size;
    const people = n ? `${n} ${n === 1 ? "person" : "people"} by name` : "";
    return group && people ? `${group}, plus ${people}` : group || people;
  });

  personMatches = computed(() => {
    const opts = this.audienceOptions();
    const q = this.personQuery().trim().toLowerCase();
    if (!opts || !q) return [];
    return opts.people
      .filter((p) => !this.pickedUsers().has(p.userId)
        && (p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q)))
      .slice(0, 8);
  });

  pickedPeople = computed(() => {
    const opts = this.audienceOptions();
    const u = this.pickedUsers();
    return opts ? opts.people.filter((p) => u.has(p.userId)) : [];
  });

  // ─── View tracking ───────────────────────────────────────────────────────
  viewsFor = signal<Notice | null>(null);
  views = signal<NoticeViews | null>(null);
  viewsLoading = signal(false);
  viewsTab = signal<"VIEWED" | "PENDING">("PENDING");

  readonly quillModules = {
    table: true,
    toolbar: {
      container: [
        [{ header: [1, 2, 3, false] }],
        ["bold", "italic", "underline", "strike"],
        [{ list: "ordered" }, { list: "bullet" }],
        ["blockquote", "link"],
        ["table"],
        ["clean"],
      ],
      handlers: {
        table(this: { quill: Quill }) {
          (this.quill.getModule("table") as any).insertTable(3, 3);
        },
      },
    },
  };

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
        const bodyMatch = this.bodyText(n.body).toLowerCase().includes(query);
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

  bodyHtml(body: string): string {
    return noticeBodyHtml(body);
  }

  bodyText(body: string): string {
    return noticeBodyText(body);
  }

  // ─── Audience picking ────────────────────────────────────────────────────

  private loadAudienceOptions() {
    if (this.audienceOptions()) return;
    this.api.audienceOptions().subscribe({
      next: (o) => this.audienceOptions.set(o),
      error: () => this.toast.error("Could not load departments and people"),
    });
  }

  private resetAudience() {
    this.audienceMode.set("ALL");
    this.pickedDepartments.set(new Set());
    this.pickedRoles.set(new Set());
    this.pickedDesignations.set(new Set());
    this.pickedUsers.set(new Set());
    this.excludedUsers.set(new Set());
    this.personQuery.set("");
    this.matchQuery.set("");
  }

  private toggleIn<T>(sig: ReturnType<typeof signal<Set<T>>>, v: T) {
    sig.update((set) => {
      const next = new Set(set);
      next.has(v) ? next.delete(v) : next.add(v);
      return next;
    });
  }

  toggleDepartment(id: number) { this.toggleIn(this.pickedDepartments, id); }
  toggleRole(role: string) { this.toggleIn(this.pickedRoles, role); }
  toggleDesignation(id: number) { this.toggleIn(this.pickedDesignations, id); }
  toggleMatch(userId: number) { this.toggleIn(this.excludedUsers, userId); }
  isTicked(userId: number) { return !this.excludedUsers().has(userId); }

  /** Tick or untick everyone currently shown in the matches list. */
  setAllMatches(ticked: boolean) {
    const shown = this.visibleMatches().map((p) => p.userId);
    this.excludedUsers.update((set) => {
      const next = new Set(set);
      shown.forEach((id) => (ticked ? next.delete(id) : next.add(id)));
      return next;
    });
  }

  departmentName(id: number | null): string {
    return this.audienceOptions()?.departments.find((d) => d.id === id)?.name ?? "";
  }
  addPerson(userId: number) { this.toggleIn(this.pickedUsers, userId); this.personQuery.set(""); }
  removePerson(userId: number) { this.toggleIn(this.pickedUsers, userId); }

  roleLabel(role: string): string {
    return role.charAt(0) + role.slice(1).toLowerCase().replace(/_/g, " ");
  }

  /** "Everybody", or what a posted notice was addressed to, in words. */
  audienceSummary(a?: NoticeAudience | null): string {
    if (!a) return "Everybody";
    const opts = this.audienceOptions();
    const parts: string[] = [];
    const depts = (a.departmentIds || []).map((id) => opts?.departments.find((d) => d.id === id)?.name ?? `Dept #${id}`);
    if (depts.length) parts.push(depts.join(", "));
    if (a.roles?.length) parts.push(a.roles.map((r) => this.roleLabel(r)).join(", "));
    const desigs = [...new Set((a.designationIds || []).map((id) => opts?.designations.find((d) => d.id === id)?.name.trim() ?? `Designation #${id}`))];
    if (desigs.length) parts.push(desigs.join(", "));
    if (a.excludeUserIds?.length) parts.push(`except ${a.excludeUserIds.length}`);
    if (a.userIds?.length) parts.push(`${a.userIds.length} ${a.userIds.length === 1 ? "person" : "people"}`);
    return parts.join(" · ") || "Everybody";
  }

  // ─── Who has seen it ─────────────────────────────────────────────────────

  openViews(n: Notice) {
    this.viewsFor.set(n);
    this.views.set(null);
    this.viewsTab.set("PENDING");
    this.viewsLoading.set(true);
    this.loadAudienceOptions();
    this.api.views(n.id).subscribe({
      next: (v) => {
        this.views.set(v);
        this.viewsTab.set(v.pendingCount ? "PENDING" : "VIEWED");
        this.viewsLoading.set(false);
      },
      error: (err) => {
        this.viewsLoading.set(false);
        this.toast.error(err?.error?.message || "Could not load who has seen it");
      },
    });
  }

  closeViews() {
    this.viewsFor.set(null);
    this.views.set(null);
  }

  viewedPercent(n: Notice): number {
    const total = n._count?.recipients ?? 0;
    return total ? Math.round(((n._count?.reads ?? 0) / total) * 100) : 0;
  }

  /**
   * Opening the board is reading it: every live notice addressed to this
   * person is on the screen in front of them.
   */
  private markShownAsRead(list: Notice[]) {
    for (const n of list) {
      if (n.isRead === false) {
        this.api.markRead(n.id).subscribe({ error: () => {} });
      }
    }
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
        if (res?.canPost) this.loadAudienceOptions();
        else this.markShownAsRead(res?.notices || []);
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
    const html = this.bodyHtml(body);
    return this.bodyText(body).length > 240 || (html.match(/<(p|li|tr|h\d)[\s>]/g) || []).length > 4;
  }

  openNew() {
    this.form = this.blank();
    this.attachments.set([]);
    this.editingId.set(null);
    this.resetAudience();
    this.loadAudienceOptions();
    this.formOpen.set(true);
  }

  openEdit(n: Notice) {
    this.form = {
      title: n.title,
      body: this.bodyHtml(n.body),
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
    this.editingAudience.set(n.audience ?? null);
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
      "linear-gradient(135deg, #6b3fd6 0%, #4f2aa7 100%)",
      "linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)",
      "linear-gradient(135deg, #6b3fd6 0%, #6a6b6c 100%)",
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
    const text = `📢 ${n.title}\n\n${this.bodyText(n.body)}\n\n— ${author}`;
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
    const body = (this.form.body || "").trim();
    if (!title) { this.toast.error("A notice needs a title"); return; }
    if (!this.bodyText(body)) { this.toast.error("A notice needs something to say"); return; }

    const id0 = this.editingId();
    let audience: NoticeAudience | null = null;
    if (!id0 && this.audienceMode() === "SELECTED") {
      const matched = new Set(this.groupMatches().map((p) => p.userId));
      audience = {
        departmentIds: [...this.pickedDepartments()],
        roles: [...this.pickedRoles()],
        designationIds: [...this.pickedDesignations()],
        // Only exclusions that still apply to the current picks.
        excludeUserIds: [...this.excludedUsers()].filter((id) => matched.has(id)),
        userIds: [...this.pickedUsers()],
      };
      if (!this.hasGroup() && !audience.userIds!.length) {
        this.toast.error("Pick at least one department, role, designation or person");
        return;
      }
      if (!this.recipientCount()) {
        this.toast.error("Nobody matches what you picked");
        return;
      }
    }

    const payload = {
      title,
      body,
      priority: this.form.priority,
      publishedAt: this.form.publishedAt || null,
      expiresAt: this.form.expiresAt || null,
      sendEmail: this.form.sendEmail,
      attachments: this.attachments(),
      ...(id0 ? {} : { audience }),
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
             : (this.form.sendEmail
                 ? `Notice posted and emailed to ${this.recipientCount()} ${this.recipientCount() === 1 ? "person" : "people"}`
                 : "Notice posted successfully"),
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
