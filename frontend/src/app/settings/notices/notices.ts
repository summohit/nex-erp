import { Component, inject, signal, computed } from "@angular/core";
import { CommonModule, DatePipe } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { HotToastService } from "@ngneat/hot-toast";
import { AgGridAngular } from "ag-grid-angular";
import { ColDef, AllCommunityModule, ModuleRegistry, GridOptions } from "ag-grid-community";
import {
  LucideMegaphone, LucidePlus, LucideX, LucideMail, LucideArchive, LucideEdit2,
  LucidePaperclip, LucideUploadCloud, LucideFileText, LucideLoader2, LucideSearch,
  LucideFilter, LucideAlertTriangle, LucideCheckCircle2, LucideClock, LucideCalendar,
  LucideUser, LucideDownload, LucideTrash2, LucideSparkles, LucideChevronDown,
  LucideChevronUp, LucideRefreshCw, LucideFile, LucideImage, LucideFileSpreadsheet,
  LucideExternalLink, LucideEye, LucideBell, LucideShare2, LucideCheck, LucideUsers,
  LucideLayoutGrid, LucideTable2,
} from "@lucide/angular";
import { QuillModule } from "ngx-quill";
import Quill from "quill";
import {
  NoticesService, Notice, NoticeAttachment, AudienceOptions, NoticeViews, NoticeAudience,
  noticeBodyHtml, noticeBodyText,
} from "../../services/notices";
import { UploadService } from "../../services/upload.service";
import { PageHeaderComponent } from "../../shared/components/page-header/page-header";
import { SearchableSelectComponent, SearchableSelectOption } from "../../shared/components/searchable-select/searchable-select.component";
import { DatePresetFilterComponent, DatePreset, DateRange } from "../../shared/components/date-preset-filter/date-preset-filter";

ModuleRegistry.registerModules([AllCommunityModule]);

/**
 * Company Notice Board Component.
 * Enterprise Announcement Hub with live stats, search, filtering, and rich attachments.
 */
@Component({
  selector: "app-notices",
  standalone: true,
  imports: [
    CommonModule, FormsModule, DatePipe, AgGridAngular,
    PageHeaderComponent, SearchableSelectComponent, DatePresetFilterComponent,
    LucideMegaphone, LucidePlus, LucideX, LucideMail, LucideArchive, LucideEdit2,
    LucidePaperclip, LucideUploadCloud, LucideFileText, LucideLoader2, LucideSearch,
    LucideFilter, LucideAlertTriangle, LucideCheckCircle2, LucideClock, LucideCalendar,
    LucideUser, LucideDownload, LucideTrash2, LucideSparkles, LucideChevronDown,
    LucideChevronUp, LucideRefreshCw, LucideFile, LucideImage, LucideFileSpreadsheet,
    LucideExternalLink, LucideEye, LucideBell, LucideShare2, LucideCheck,
    LucideUsers, LucideLayoutGrid, LucideTable2, QuillModule,
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
  /** Posted within: last 7 / 30 / 60 days or a custom range (11 Nov 2026). */
  dateRange = signal<"ALL" | "7" | "30" | "60" | "CUSTOM">("ALL");
  customFrom = signal("");
  customTo = signal("");
  dateFilter = signal("");
  datePreset = signal<DatePreset>("ALL");
  viewMode = signal<"CARDS" | "TABLE">(this.readViewMode());
  selectedNotice = signal<Notice | null>(null);

  // Pagination config
  paginationPageSize = 20;
  paginationPageSizeSelector = [20, 50, 100, 200];

  // Searchable select options for MIRA filter bar
  statusSelectOptions = computed<SearchableSelectOption[]>(() => {
    const opts: SearchableSelectOption[] = [
      { id: "ACTIVE", name: "Active notices" },
      { id: "HIGH", name: "High priority" },
      { id: "ATTACHMENTS", name: "With attachments" },
    ];
    if (this.canPost() && this.scheduledCount() > 0) {
      opts.push({ id: "SCHEDULED", name: "Scheduled" });
    }
    if (this.canPost()) {
      opts.push({ id: "EXPIRED", name: "Expired / Archived" });
    }
    return opts;
  });

  readonly prioritySelectOptions: SearchableSelectOption[] = [
    { id: "HIGH", name: "High priority" },
    { id: "NORMAL", name: "Normal priority" },
    { id: "LOW", name: "Low priority" },
  ];

  readonly sortSelectOptions: SearchableSelectOption[] = [
    { id: "NEWEST", name: "Sort: Newest first" },
    { id: "OLDEST", name: "Sort: Oldest first" },
    { id: "PRIORITY", name: "Sort: Priority first" },
  ];

  onDateRangeChange(r: DateRange) {
    if (!r) {
      this.dateRange.set("ALL");
      this.customFrom.set("");
      this.customTo.set("");
      return;
    }
    const ymd = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    this.dateRange.set("CUSTOM");
    this.customFrom.set(ymd(r.from));
    this.customTo.set(ymd(r.to));
  }

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
      this.datePreset() !== "ALL" ||
      this.dateRange() !== "ALL" ||
      this.dateFilter() !== "" ||
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

    // 4. Posted date
    const range = this.dateRange();
    const posted = (n: Notice) => new Date(n.publishedAt || n.createdAt).getTime();
    if (range === "7" || range === "30" || range === "60") {
      const since = Date.now() - Number(range) * 24 * 60 * 60 * 1000;
      list = list.filter((n) => posted(n) >= since);
    } else if (range === "CUSTOM") {
      // Local-day bounds: "to" includes the whole of that day.
      const from = this.customFrom() ? new Date(`${this.customFrom()}T00:00:00`).getTime() : -Infinity;
      const to = this.customTo() ? new Date(`${this.customTo()}T23:59:59.999`).getTime() : Infinity;
      list = list.filter((n) => posted(n) >= from && posted(n) <= to);
    }
    const date = this.dateFilter();
    if (date) list = list.filter((n) => this.noticeDateKey(n) === date);

    // 5. Sorting
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

  // ─── AG Grid Configuration (Employee Directory Standard) ────────────────
  readonly defaultColDef: ColDef = {
    sortable: true,
    filter: true,
    resizable: true,
  };

  readonly gridOptions: GridOptions = {
    headerHeight: 44,
    rowHeight: 58,
    suppressCellFocus: true,
    enableCellTextSelection: true,
    onCellClicked: (event: any) => this.onGridCellClicked(event),
  };

  private esc(v: any): string {
    return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as any)[c]);
  }

  formatDisplayDate(val?: string | null): string {
    if (!val) return "—";
    const d = new Date(val);
    if (Number.isNaN(d.getTime())) return "—";
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
  }

  private statusDot(label: string, tone: "good" | "wait" | "blue" | "bad" | "off", title = ""): string {
    const [dot, bg, text] = {
      good: ["#059669", "#ecfdf5", "#047857"],
      wait: ["#d97706", "#fffbeb", "#b45309"],
      blue: ["#2563eb", "#eff6ff", "#1d4ed8"],
      bad: ["#dc2626", "#fef2f2", "#b91c1c"],
      off: ["#94a3b8", "#f1f5f9", "#475569"],
    }[tone];
    return `<span title="${this.esc(title)}" style="display:inline-flex; align-items:center; gap:6px; height:24px; padding:0 8px; border-radius:6px; background:${bg}; font-size:12px; font-weight:500; color:${text}; white-space:nowrap;">`
      + `<span style="width:6px; height:6px; border-radius:50%; background:${dot}; flex-shrink:0;"></span>${this.esc(label)}</span>`;
  }

  noticeColDefs = computed<ColDef[]>(() => {
    const canManage = this.canPost();
    // Touch audienceOptions so audience column refreshes when loaded
    this.audienceOptions();
    this.copiedNoticeId();

    return [
      {
        field: "title",
        headerName: "Title",
        minWidth: 280,
        flex: 2.2,
        cellRenderer: (params: any) => {
          const n: Notice = params.data;
          if (!n) return "";
          const title = this.esc(n.title || "Untitled Notice");
          return `<div class="nb-grid-title" style="font-weight:600; color:#0f172a; font-size:13.5px; line-height:1.35; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; width:100%; transition:color .15s ease;" title="${title}">${title}</div>`;
        },
      },
      {
        field: "priority",
        headerName: "Priority",
        width: 130,
        minWidth: 120,
        flex: 0,
        cellRenderer: (params: any) => {
          const p = params.value as Notice["priority"];
          if (p === "HIGH") return this.statusDot("High priority", "bad", "Urgent / high priority");
          if (p === "NORMAL") return this.statusDot("Normal", "blue", "Standard announcement");
          return this.statusDot("Low", "off", "Informational notice");
        },
      },
      {
        colId: "author",
        headerName: "Posted By",
        minWidth: 180,
        flex: 1.2,
        valueGetter: (params: any) => {
          const n: Notice = params.data;
          return n?.createdBy ? `${n.createdBy.firstName} ${n.createdBy.lastName}` : "Administration";
        },
        cellRenderer: (params: any) => {
          const n: Notice = params.data;
          const fn = n?.createdBy?.firstName || "";
          const ln = n?.createdBy?.lastName || "";
          const fullName = n?.createdBy ? `${fn} ${ln}`.trim() : "Administration";
          const initials = this.esc(this.getInitials(fn, ln));
          const avatarUrl = n?.createdBy?.avatarUrl;
          const avatarHtml = avatarUrl
            ? `<img src="${this.esc(avatarUrl)}" alt="" style="width:32px; height:32px; border-radius:50%; object-fit:cover; flex-shrink:0; box-shadow:0 0 0 1px rgba(15,23,42,.08);" onerror="this.style.display='none';this.nextElementSibling.style.display='inline-flex';" />`
              + `<span style="display:none; width:32px; height:32px; border-radius:50%; background:#e0e9ff; color:#2563eb; font-weight:700; font-size:12px; align-items:center; justify-content:center; flex-shrink:0;">${initials}</span>`
            : `<span style="display:inline-flex; width:32px; height:32px; border-radius:50%; background:#e0e9ff; color:#2563eb; font-weight:700; font-size:12px; align-items:center; justify-content:center; flex-shrink:0;">${initials}</span>`;
          return `
            <div style="display:flex; align-items:center; gap:10px; min-width:0; width:100%; overflow:hidden;">
              ${avatarHtml}
              <span style="font-weight:600; color:#0f172a; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${this.esc(fullName)}</span>
            </div>
          `;
        },
      },
      {
        field: "publishedAt",
        headerName: "Posted On",
        width: 125,
        minWidth: 115,
        flex: 0,
        cellRenderer: (params: any) => {
          const d = this.formatDisplayDate(params.value || params.data?.createdAt);
          return `<span style="color:#475569; font-size:12.5px; font-weight:500; font-variant-numeric:tabular-nums; white-space:nowrap;">${this.esc(d)}</span>`;
        },
      },
      {
        field: "expiresAt",
        headerName: "Expires",
        width: 125,
        minWidth: 115,
        flex: 0,
        cellRenderer: (params: any) => {
          const d = params.value ? this.formatDisplayDate(params.value) : "—";
          return `<span style="color:${params.value ? "#475569" : "#94a3b8"}; font-size:12.5px; font-weight:500; font-variant-numeric:tabular-nums; white-space:nowrap;">${this.esc(d)}</span>`;
        },
      },
      {
        colId: "status",
        headerName: "Status",
        width: 115,
        minWidth: 105,
        flex: 0,
        valueGetter: (params: any) => {
          const n: Notice = params.data;
          if (!n) return "";
          if (!n.isActive) return "Retired";
          if (this.hasExpired(n)) return "Expired";
          if (this.isScheduled(n)) return "Scheduled";
          return "Active";
        },
        cellRenderer: (params: any) => {
          const st = params.value;
          if (st === "Active") return this.statusDot("Active", "good", "Live on dashboards");
          if (st === "Scheduled") return this.statusDot("Scheduled", "wait", "Scheduled for later");
          if (st === "Expired") return this.statusDot("Expired", "wait", "Past expiration date");
          return this.statusDot("Retired", "off", "Archived notice");
        },
      },
      {
        colId: "actions",
        headerName: "Actions",
        width: canManage ? 104 : 68,
        minWidth: canManage ? 104 : 68,
        flex: 0,
        sortable: false,
        filter: false,
        resizable: false,
        cellRenderer: (params: any) => {
          const n: Notice = params.data;
          if (!n) return "";
          if (!canManage) {
            return `<div style="display:flex; align-items:center; gap:6px;"><button type="button" class="g-icon-btn" data-act="view" title="View notice" aria-label="View notice"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg></button></div>`;
          }
          const editBtn = `<button type="button" class="g-icon-btn" data-act="edit" title="Edit notice" aria-label="Edit notice"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg></button>`;
          const retireBtn = n.isActive
            ? `<button type="button" class="g-icon-btn g-icon-warn" data-act="retire" title="Retire notice" aria-label="Retire notice"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg></button>`
            : "";
          return `<div style="display:flex; align-items:center; gap:6px;">${editBtn}${retireBtn}</div>`;
        },
      },
    ];
  });

  onGridCellClicked(event: any) {
    const n: Notice | undefined = event?.data;
    if (!n) return;
    const target = event?.event?.target as HTMLElement | null;
    const actEl = target?.closest("[data-act]") as HTMLElement | null;
    if (actEl) {
      const act = actEl.getAttribute("data-act");
      if (act === "view") this.openNotice(n);
      else if (act === "views") this.openViews(n);
      else if (act === "copy") this.copyNoticeText(n);
      else if (act === "edit") this.openEdit(n);
      else if (act === "retire") this.openRetireModal(n);
      return;
    }
    if (event.colDef?.colId === "actions") return;
    this.openNotice(n);
  }

  constructor() {
    this.load();
  }

  private readViewMode(): "CARDS" | "TABLE" {
    try { return localStorage.getItem("notice-board-view") === "CARDS" ? "CARDS" : "TABLE"; }
    catch { return "TABLE"; }
  }

  setViewMode(view: "CARDS" | "TABLE") {
    this.viewMode.set(view);
    try { localStorage.setItem("notice-board-view", view); } catch { /* storage unavailable */ }
  }

  openNotice(n: Notice) { this.selectedNotice.set(n); }
  closeNotice() { this.selectedNotice.set(null); }

  noticeDateKey(n: Notice): string {
    const d = new Date(n.publishedAt || n.createdAt);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
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
    this.datePreset.set("ALL");
    this.dateRange.set("ALL");
    this.customFrom.set("");
    this.customTo.set("");
    this.dateFilter.set("");
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
