import { Component, EventEmitter, Input, OnInit, Output, inject, signal, computed, effect, untracked, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { HotToastService } from '@ngneat/hot-toast';
import {
  LucideX, LucidePlus, LucideTrash2, LucideCrosshair,
  LucideCalendarDays, LucideUsers, LucidePaperclip,
  LucideSearch, LucideChevronDown, LucideCheck,
  LucideUpload, LucideFileText, LucideClock, LucideMapPin,
  LucideLoader, LucideBuilding, LucideRoute, LucideExternalLink,
  LucideListChecks, LucideFilter, LucideUserRound, LucideUserPlus,
  LucideCircleAlert, LucideChevronUp,
} from '@lucide/angular';
import {
  FieldVisitRequestsService, FieldVisitRequest, FieldVisitRequestInput,
} from '../../services/field-visit-requests';
import { ProjectsService } from '../../services/projects';
import { TasksService } from '../../services/tasks.service';
import { EmployeeService } from '../../services/employee.service';
import { MasterDataService, VisitLocation } from '../../services/master-data.service';
import { RoleService } from '../../services/role.service';
import { VisitLocationRequestsService } from '../../services/visit-location-requests.service';
import { VisitLocationFormModalComponent } from '../../shared/components/visit-location-form-modal/visit-location-form-modal';
import { environment } from '../../../environments/environment';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * One task from the selected project's board, flattened for the picker.
 *
 * A task is narrowed to what the picker has to draw next to it — who it belongs
 * to, so the "these are the people going" filter can be read at a glance, and
 * whether it is finished, so work nobody should be sent to do can be left out.
 */
interface ProjectTaskOption {
  id: number;
  key: string;
  title: string;
  status: string;
  priority: string;
  dueDate?: string | null;
  assigneeId: number | null;
  assigneeName: string | null;
  assigneeAvatarUrl: string | null;
  /** Issue members, so a shared task counts as being a person's task. */
  memberIds: number[];
  memberNames: string[];
  /** PENDING_TECHNICAL / PENDING_ADMIN while the task itself awaits approval. */
  approvalState?: string | null;
}

/** Statuses that mean the work is finished, or abandoned, and not a thing to send anyone to do. */
const CLOSED_TASK_STATUSES = new Set(['DONE', 'CANCELLED', 'ARCHIVED']);

/** The only statuses a general visit may pick from. */
const GENERAL_TASK_STATUSES = new Set(['TODO', 'IN_PROGRESS']);

/** What the form is being opened for. */
export type FieldVisitFormMode = 'create' | 'edit' | 'modify';

/**
 * The one field visit form, used three ways.
 *
 * Raising a trip, editing a draft, and proposing a change to an approved one
 * (§10) all describe the same thing — a site, some days, some people and some
 * tasks — and the approver rules on what the trip would become rather than on
 * a list of edits. One form, because two would drift.
 */
@Component({
  selector: 'app-field-visit-request-form',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    LucideX, LucidePlus, LucideTrash2, LucideCrosshair,
    LucideCalendarDays, LucideUsers, LucidePaperclip,
    LucideSearch, LucideChevronDown, LucideCheck,
    LucideUpload, LucideFileText, LucideClock, LucideMapPin,
    LucideLoader, LucideBuilding, LucideRoute, LucideExternalLink,
    LucideListChecks, LucideFilter, LucideUserRound, LucideUserPlus,
    LucideCircleAlert, LucideChevronUp,
    VisitLocationFormModalComponent,
  ],
  templateUrl: './field-visit-request-form.html',
  styleUrls: ['./field-visit-request-form.css'],
})
export class FieldVisitRequestFormComponent implements OnInit {
  /** The trip being edited or changed; absent when raising a new one. */
  @Input() request: FieldVisitRequest | null = null;
  @Input() mode: FieldVisitFormMode = 'create';
  /** Project selected before the create dialog opens (for project-board entry points). */
  @Input() initialProjectId: number | null = null;

  @Output() saved = new EventEmitter<void>();
  @Output() closed = new EventEmitter<void>();

  private api = inject(FieldVisitRequestsService);
  private projectsService = inject(ProjectsService);
  private tasksService = inject(TasksService);
  private employeeService = inject(EmployeeService);
  private masterData = inject(MasterDataService);
  private roleService = inject(RoleService);
  private sanitizer = inject(DomSanitizer);
  private toast = inject(HotToastService);
  private http = inject(HttpClient);
  private locationRequests = inject(VisitLocationRequestsService);

  projects = signal<{ id: number; name: string; key: string | null }[]>([]);
  /** Sites the company keeps on file, for the location picker (§PB10). */
  visitLocations = signal<VisitLocation[]>([]);
  selectedVisitLocationId = signal<number | null>(null);
  employees = signal<{
    id: number;
    name: string;
    email: string;
    avatarUrl: string | null;
    designation?: string;
  }[]>([]);
  isSaving = signal(false);
  error = signal<string | null>(null);
  loadError = signal<string | null>(null);
  showValidationErrors = signal<boolean>(false);

  private readonly requiredFieldOrder: { id: string; field: string; label: string }[] = [
    { id: 'field-fvr-project', field: 'project', label: 'Project' },
    { id: 'field-fvr-location', field: 'location', label: 'Site Name & Address' },
    { id: 'field-fvr-coordinates', field: 'coordinates', label: 'GPS Coordinates' },
    { id: 'field-fvr-start-date', field: 'startDate', label: 'Start Date' },
    { id: 'field-fvr-end-date', field: 'endDate', label: 'End Date' },
    { id: 'field-fvr-start-time', field: 'startTime', label: 'Expected Clock-in' },
    { id: 'field-fvr-end-time', field: 'endTime', label: 'Expected Clock-out' },
    { id: 'field-fvr-members', field: 'members', label: 'Who is going (Field team)' },
    { id: 'field-fvr-tasks', field: 'tasks', label: 'Site Tasks & Scope' },
  ];

  isFieldInvalid(field: string): boolean {
    switch (field) {
      case 'project':
        return this.visitType() === 'PROJECT' && !(this.selectedProjectId() ?? this.form.projectId);
      case 'location':
        return !this.form.location || !this.form.location.trim();
      case 'coordinates': {
        if (
          this.form.latitude == null ||
          this.form.longitude == null ||
          this.form.latitude === ('' as any) ||
          this.form.longitude === ('' as any)
        ) {
          return true;
        }
        const lat = Number(this.form.latitude);
        const lng = Number(this.form.longitude);
        return (
          isNaN(lat) ||
          isNaN(lng) ||
          (lat === 0 && lng === 0)
        );
      }
      case 'startDate':
        return !this.form.startDate || isNaN(Date.parse(`${this.form.startDate}T00:00:00Z`));
      case 'endDate': {
        if (!this.form.endDate || isNaN(Date.parse(`${this.form.endDate}T00:00:00Z`))) return true;
        if (this.form.startDate) {
          const from = Date.parse(`${this.form.startDate}T00:00:00Z`);
          const to = Date.parse(`${this.form.endDate}T00:00:00Z`);
          if (!isNaN(from) && !isNaN(to) && to < from) return true;
        }
        return false;
      }
      case 'startTime':
        return !this.form.startTime || !this.form.startTime.trim();
      case 'endTime': {
        if (!this.form.endTime || !this.form.endTime.trim()) return true;
        if (this.form.startTime && this.form.endTime <= this.form.startTime) return true;
        return false;
      }
      case 'members':
        return this.selectedEmployeeIds().length === 0;
      case 'tasks':
        return (
          this.form.tasks.length === 0 ||
          !this.form.tasks.some((t) => (t.name && t.name.trim()) || t.issueId != null)
        );
      default:
        return false;
    }
  }

  endDateErrorMessage(): string {
    if (!this.form.endDate) return 'End date is required';
    if (this.form.startDate) {
      const from = Date.parse(`${this.form.startDate}T00:00:00Z`);
      const to = Date.parse(`${this.form.endDate}T00:00:00Z`);
      if (to < from) return 'End date cannot be before start date';
    }
    return 'Invalid end date';
  }

  endTimeErrorMessage(): string {
    if (!this.form.endTime) return 'Expected clock-out time is required';
    if (this.form.startTime && this.form.endTime <= this.form.startTime) {
      return 'Clock-out time must be after clock-in time';
    }
    return 'Invalid clock-out time';
  }

  validateForm(): boolean {
    const invalidItem = this.requiredFieldOrder.find((item) => this.isFieldInvalid(item.field));
    if (!invalidItem) {
      return true;
    }

    this.showValidationErrors.set(true);
    this.toast.error(`Please complete the required field: ${invalidItem.label}`);
    this.scrollToField(invalidItem.id);
    return false;
  }

  scrollToField(elementId: string): void {
    setTimeout(() => {
      const targetEl = document.getElementById(elementId);
      if (!targetEl) return;

      const modalBody =
        (targetEl.closest('.modal-body') as HTMLElement | null) ||
        (document.querySelector('.modal-body') as HTMLElement | null);

      if (modalBody) {
        const bodyRect = modalBody.getBoundingClientRect();
        const targetRect = targetEl.getBoundingClientRect();
        const targetOffsetTop = targetRect.top - bodyRect.top + modalBody.scrollTop;
        modalBody.scrollTo({
          top: Math.max(0, targetOffsetTop - 24),
          behavior: 'smooth',
        });
      }

      targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });

      targetEl.classList.remove('field-attention-pulse');
      void targetEl.offsetWidth;
      targetEl.classList.add('field-attention-pulse');

      const innerTrigger = targetEl.querySelector<HTMLElement>(
        '.searchable-select-trigger, input, textarea, .member-picker-grid, .scope-trigger',
      );
      if (innerTrigger) {
        innerTrigger.classList.remove('field-attention-pulse');
        void innerTrigger.offsetWidth;
        innerTrigger.classList.add('field-attention-pulse');
      }

      setTimeout(() => {
        targetEl.classList.remove('field-attention-pulse');
        if (innerTrigger) innerTrigger.classList.remove('field-attention-pulse');
      }, 2000);

      const focusable = targetEl.querySelector<HTMLElement>(
        'input:not([type="hidden"]), select, button:not([disabled]), textarea',
      );
      if (focusable) {
        focusable.focus();
      }
    }, 100);
  }

  isAdmin = this.roleService.isAdmin;

  /**
   * Adding a site from inside the form, so a missing one doesn't mean leaving
   * a half-filled trip. An admin's site is saved at once; anyone else's goes to
   * an administrator for approval (Delivery → Requests), same as the Add Visit
   * Location button on the requests page.
   */
  canAddVisitLocation = signal(false);
  isLocationModalOpen = signal(false);
  locationSubmissionMode = computed<'direct' | 'request'>(() => this.isAdmin() ? 'direct' : 'request');

  openAddVisitLocation(): void {
    this.isLocationDropdownOpen.set(false);
    this.isLocationModalOpen.set(true);
  }

  onVisitLocationSaved(): void {
    this.isLocationModalOpen.set(false);
    // A requested site is not on the list until it's approved; only a direct
    // save can be picked straight away.
    if (this.locationSubmissionMode() !== 'direct') return;
    const known = new Set(this.visitLocations().map((l) => l.id));
    this.masterData.getVisitLocations(true).subscribe({
      next: (rows) => {
        this.visitLocations.set(rows || []);
        const added = (rows || []).find((l) => !known.has(l.id));
        if (added) this.onVisitLocationPicked(added.id);
      },
    });
  }
  isLoadingLists = signal(false);
  /** The project picker shows a loader, not "no projects", until this is false. */
  isLoadingProjects = signal(true);

  /**
   * PROJECT is the original flow. GENERAL belongs to no project: the people
   * are picked first, and the scope is their own To Do / In Progress general
   * tasks rather than a project's board.
   */
  visitType = signal<'PROJECT' | 'GENERAL'>('PROJECT');

  setVisitType(type: 'PROJECT' | 'GENERAL'): void {
    // The "General" choice in the project dropdown and this toggle are one
    // setting; keep them in step whichever way it was picked.
    this.isGeneralVisit.set(type === 'GENERAL');
    if (this.visitType() === type) return;
    this.visitType.set(type);
    // The two kinds pick tasks from different places, so nothing picked
    // carries across.
    this.form.tasks = [];
    this.projectTasks.set([]);
    this.tasksError.set(null);
    this.tasksLoadedFor = null;
    if (type === 'GENERAL') {
      this.selectedProjectId.set(null);
      this.form.projectId = null;
      this.isProjectDropdownOpen.set(false);
      this.showAllProjectTasks.set(false);
      this.loadGeneralTasks(this.selectedEmployeeIds());
    } else {
      this.showAllProjectTasks.set(true);
    }
  }

  /** A general visit's task list follows whoever is picked to go. */
  private generalTasksFollowPeople = effect(() => {
    const people = this.selectedEmployeeIds();
    if (untracked(() => this.visitType()) !== 'GENERAL') return;
    untracked(() => this.loadGeneralTasks(people));
  });

  private generalLoadSeq = 0;

  loadGeneralTasks(employeeIds: number[]): void {
    const seq = ++this.generalLoadSeq;
    this.tasksError.set(null);
    if (!employeeIds.length) {
      this.projectTasks.set([]);
      this.isLoadingTasks.set(false);
      this.form.tasks = [];
      return;
    }
    this.isLoadingTasks.set(true);
    this.api.getGeneralTasks(employeeIds).subscribe({
      next: (rows) => {
        if (seq !== this.generalLoadSeq) return;
        this.isLoadingTasks.set(false);
        const options = (rows || []).map((i: any) => this.toTaskOption(i));
        this.projectTasks.set(options);
        // A task belonging only to someone just taken off the trip goes with them.
        const open = new Set(options.map((o) => o.id));
        this.form.tasks = this.form.tasks.filter((t) => t.issueId != null && open.has(t.issueId));
      },
      error: (err) => {
        if (seq !== this.generalLoadSeq) return;
        this.isLoadingTasks.set(false);
        this.projectTasks.set([]);
        this.tasksError.set(`Could not load their general tasks: ${this.messageOf(err)}.`);
      },
    });
  }

  private toTaskOption(i: any): ProjectTaskOption {
    return {
      id: i.id,
      key: i.key,
      title: i.title,
      status: i.status,
      priority: i.priority,
      dueDate: i.dueDate ?? null,
      assigneeId: i.assigneeId ?? null,
      approvalState: i.approvalState ?? null,
      assigneeName: i.assignee
        ? `${i.assignee.firstName ?? ''} ${i.assignee.lastName ?? ''}`.trim()
        : null,
      assigneeAvatarUrl: i.assignee?.avatarUrl ?? null,
      memberIds: (i.members ?? []).map((m: any) => m.employeeId ?? m.employee?.id).filter((id: any) => id != null),
      memberNames: (i.members ?? [])
        .map((m: any) => `${m.employee?.firstName ?? ''} ${m.employee?.lastName ?? ''}`.trim())
        .filter((n: string) => n.length > 0),
    };
  }

  // Searchable Project select state
  selectedProjectId = signal<number | null>(null);
  /** A General visit has no customer project; the API maps it to the General workspace. */
  isGeneralVisit = signal(false);
  canCreateGeneralTask = signal(false);
  isCreatingGeneralTask = signal(false);
  generalTaskTitle = '';
  generalTaskDescription = '';
  isProjectDropdownOpen = signal(false);
  projectSearchQuery = signal('');

  // Searchable Location select state (§PB10)
  isLocationDropdownOpen = signal(false);
  locationSearchQuery = signal('');

  // Searchable Employee picker state
  selectedEmployeeIds = signal<number[]>([]);
  employeeSearchQuery = signal('');

  // ── Project task picker ────────────────────────────────────────────────
  /** The selected project's own tasks, loaded when the project is picked. */
  projectTasks = signal<ProjectTaskOption[]>([]);
  isLoadingTasks = signal(false);
  tasksError = signal<string | null>(null);
  isTaskDropdownOpen = signal(false);
  taskSearchQuery = signal('');
  /**
   * On by default: the dropdown is the project's task list, in full.
   *
   * Filtering by the people going is a shortcut for the common case, not the
   * starting position — a trip is often raised for work that has not been
   * assigned to anybody yet, and for a colleague's backlog item, and hiding
   * those behind a switch makes people conclude the project has no tasks. Turned
   * off, the list narrows to the Step 3 people plus anything unassigned.
   */
  showAllProjectTasks = signal(true);

  // Drag and drop attachment state
  isDragging = signal(false);
  isUploading = signal(false);
  /**
   * The picked tasks, in the order they were picked.
   *
   * `issueId` null means free text — new work approval will mint a card for.
   * Carried on the row rather than looked up on render, so a task that has been
   * archived or reassigned since it was picked still shows what the trip is
   * committed to rather than silently turning into a blank.
   */
  /** One line of the trip's scope, as the form holds it. */
  form = {
    projectId: null as number | null,
    location: '',
    visitLocationId: null as number | null,
    latitude: null as number | null,
    longitude: null as number | null,
    startDate: '',
    endDate: '',
    startTime: '09:00',
    endTime: '18:00',
    remarks: '',
    employeeIds: [] as number[],
    tasks: [] as {
      issueId: number | null;
      name: string;
      description: string;
      key?: string;
      status?: string;
    }[],
    attachments: [] as { fileName: string; fileUrl: string; fileSize?: number }[],
  };

  get title(): string {
    if (this.mode === 'modify') return `Change ${this.request?.requestNumber ?? 'this field visit'}`;
    return this.mode === 'edit' ? 'Edit field visit request' : 'New field visit request';
  }

  ngOnInit(): void {
    if (this.request?.project?.isSystem) {
      this.visitType.set('GENERAL');
      this.showAllProjectTasks.set(false);
    }
    if (this.request) {
      if (this.visitType() === 'PROJECT') this.selectedProjectId.set(this.request.project.id);
      this.selectedVisitLocationId.set((this.request as any).visitLocationId ?? null);
      this.selectedEmployeeIds.set(this.request.members.map((m) => m.employee.id));
      this.form = {
        projectId: this.visitType() === 'GENERAL' ? null : this.request.project.id,
        location: this.request.location,
        visitLocationId: (this.request as any).visitLocationId ?? null,
        latitude: this.request.latitude,
        longitude: this.request.longitude,
        startDate: this.request.startDate.slice(0, 10),
        endDate: this.request.endDate.slice(0, 10),
        startTime: this.request.startTime,
        endTime: this.request.endTime,
        remarks: this.request.remarks ?? '',
        employeeIds: this.request.members.map((m) => m.employee.id),
        // A line saved before this picker existed, or one describing work that
        // is not on the board, comes back as free text. Keeping it renders
        // honestly as "not a board task" instead of pretending it has a key it
        // does not have.
        tasks: this.request.tasks.map((t) => ({
          issueId: t.issueId ?? null,
          name: t.name,
          description: t.description ?? '',
          key: t.issue?.key,
          status: t.issue?.status,
        })),
        attachments: this.request.attachments.map((a) => ({
          fileName: a.fileName, fileUrl: a.fileUrl, fileSize: a.fileSize ?? undefined,
        })),
      };
    } else if (this.initialProjectId != null && Number.isInteger(this.initialProjectId)) {
      // A request raised from a project board must stay tied to that board;
      // preselecting it also loads that board's task picker below.
      this.selectedProjectId.set(this.initialProjectId);
      this.form.projectId = this.initialProjectId;
    }

    this.loadLists();
    // The trip's own board, so the picker can show what is already picked as
    // picked and offer everything else. Started after the request has been read
    // into the form, or the first render would come back emptied.
    if (this.visitType() === 'PROJECT' && this.selectedProjectId()) {
      this.loadProjectTasks(this.selectedProjectId()!);
    }
  }

  /** The projects and people the form picks from. */
  loadLists(): void {
    this.loadError.set(null);
    this.isLoadingLists.set(true);

    let pending = 2;
    const done = () => { if (--pending === 0) this.isLoadingLists.set(false); };
    const failed = (what: string, err: any) => {
      this.loadError.set(
        `Could not load ${what}: ${this.messageOf(err)}`,
      );
      done();
    };

    // Non-fatal: a company that has not set any up must still be able to raise
    // a trip by typing the address, which is how this worked before the list
    // existed.
    this.masterData.getVisitLocations(true).subscribe({
      next: (rows) => this.visitLocations.set(rows || []),
      error: () => this.visitLocations.set([]),
    });

    this.locationRequests.capabilities().subscribe({
      next: (c) => this.canAddVisitLocation.set(!!c?.canAdd),
      error: () => this.canAddVisitLocation.set(false),
    });

    // The server owns this permission; the UI only mirrors it.
    this.tasksService.getCapabilities().subscribe({
      next: (capabilities) => this.canCreateGeneralTask.set(!!capabilities?.canCreateGeneral),
      error: () => this.canCreateGeneralTask.set(false),
    });

    this.isLoadingProjects.set(true);
    this.projectsService.getProjects().subscribe({
      next: (rows: any[]) => {
        this.projects.set((rows || []).map((p) => ({ id: p.id, name: p.name, key: p.key ?? null })));
        this.isLoadingProjects.set(false);
        done();
      },
      error: (err) => {
        this.projects.set([]);
        this.isLoadingProjects.set(false);
        failed('the project list', err);
      },
    });
    this.employeeService.getEmployeesBasicList().subscribe({
      next: (rows: any[]) => {
        this.employees.set((rows || []).map((e: any) => ({
          id: e.id,
          name: `${e.firstName ?? ''} ${e.lastName ?? ''}`.trim() || e.user?.email || `Employee ${e.id}`,
          email: e.user?.email || e.email || '',
          avatarUrl: e.avatarUrl || null,
          designation: e.designation?.name || '',
        })));
        done();
      },
      error: (err) => { this.employees.set([]); failed('the employee list', err); },
    });
  }

  /**
   * Days from the first to the last inclusive, shown live.
   *
   * The server derives this the same way and refuses a request whose count
   * disagrees, so showing it here means nobody types "3 days" over a five-day
   * range and finds out at submit.
   *
   * A method rather than a computed(): `form` is a plain object driven by
   * ngModel, not a signal, so a computed() over it took a dependency on
   * nothing, ran once while both dates were still empty, and cached 0 — the
   * field read "—" no matter what dates you picked.
   */
  visitDays(): number {
    const { startDate, endDate } = this.form;
    if (!startDate || !endDate) return 0;
    const from = Date.parse(`${startDate}T00:00:00Z`);
    const to = Date.parse(`${endDate}T00:00:00Z`);
    if (Number.isNaN(from) || Number.isNaN(to) || to < from) return 0;
    return Math.round((to - from) / DAY_MS) + 1;
  }

  /** The last range complaint raised, so one bad range toasts once. */
  private lastDateComplaint: string | null = null;

  /**
   * Duration is derived, so the only way a date range can fail is silently —
   * the pill drops back to "—" and nothing says why. Say why instead.
   */
  onScheduleDateChange(): void {
    const { startDate, endDate } = this.form;
    if (!startDate || !endDate) {
      this.lastDateComplaint = null;
      return;
    }

    const from = Date.parse(`${startDate}T00:00:00Z`);
    const to = Date.parse(`${endDate}T00:00:00Z`);

    let complaint: string | null = null;
    if (Number.isNaN(from) || Number.isNaN(to)) {
      complaint = 'That date could not be read — pick the start and end from the calendar.';
    } else if (to < from) {
      complaint = 'The end date is before the start date, so the visit has no duration.';
    }

    if (complaint && complaint !== this.lastDateComplaint) {
      this.toast.error(complaint);
    }
    this.lastDateComplaint = complaint;
  }

  /**
   * Fill the site from the picker (§PB10).
   *
   * The name, address and pin are copied onto the request rather than read
   * through the link. Where somebody actually went is a fact about that trip,
   * so retiring or re-pinning a site later must not rewrite trips already
   * made — the link records which site was chosen, the copy records where it
   * was at the time.
   *
   * Nothing is cleared when the picker is cleared: somebody who picked a site
   * and then adjusted the pin by hand has done that deliberately.
   */
  onVisitLocationPicked(id: number | null): void {
    this.selectedVisitLocationId.set(id);
    this.form.visitLocationId = id;
    if (id == null) return;

    const site = this.visitLocations().find((l) => l.id === id);
    if (!site) return;

    this.form.location = [site.name, site.address].filter(Boolean).join(' – ');
    if (site.latitude != null) this.form.latitude = site.latitude;
    if (site.longitude != null) this.form.longitude = site.longitude;
  }

  mapUrl(): SafeResourceUrl {
    const { latitude, longitude } = this.form;
    if (latitude == null || longitude == null) {
      return this.sanitizer.bypassSecurityTrustResourceUrl('');
    }
    return this.sanitizer.bypassSecurityTrustResourceUrl(
      `https://maps.google.com/maps?q=${latitude},${longitude}&t=&z=16&ie=UTF8&iwloc=&output=embed`,
    );
  }

  /** Drop the pin where the person raising it is standing. */
  useMyLocation(): void {
    if (!navigator.geolocation) {
      this.toast.error('This browser cannot report your location.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        this.form.latitude = Number(pos.coords.latitude.toFixed(6));
        this.form.longitude = Number(pos.coords.longitude.toFixed(6));
        if (!this.form.location) {
          this.form.location = await this.reverseGeocode(this.form.latitude, this.form.longitude);
        }
      },
      () => this.toast.error('Could not read your location.'),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  /** A name for the pin, so the schedule does not read as a pair of numbers. */
  private async reverseGeocode(lat: number, lng: number): Promise<string> {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18`,
        { headers: { 'Accept-Language': 'en' } },
      );
      if (res.ok) {
        const data = await res.json();
        return data.display_name || '';
      }
    } catch {
      // Falls back to the person typing it, which is no worse than before.
    }
    return '';
  }

    // ── Searchable Project Select ──────────────────────────────────────────
  selectedProject = computed(() => {
    return this.projects().find((p) => p.id === this.selectedProjectId()) || null;
  });

  filteredProjects = computed(() => {
    const q = this.projectSearchQuery().trim().toLowerCase();
    const list = this.projects();
    if (!q) return list;
    // By code as well as name: several projects share a name pattern
    // ("F5 uDNS_Phase-11 …") and the code is what tells them apart.
    return list.filter((p) =>
      p.name.toLowerCase().includes(q) || (p.key ?? '').toLowerCase().includes(q));
  });

  toggleProjectDropdown(): void {
    this.isProjectDropdownOpen.update((v) => !v);
    if (this.isProjectDropdownOpen()) {
      this.projectSearchQuery.set('');
    }
  }

  selectProject(projectId: number | null): void {
    this.isGeneralVisit.set(false);
    this.selectedProjectId.set(projectId);
    this.form.projectId = projectId;
    this.isProjectDropdownOpen.set(false);

    // A task belongs to the project it was picked from, so a different project
    // means a different set of tasks. Anything already picked goes with the old
    // one rather than being quietly re-pointed at a board it was never on.
    if (projectId !== this.tasksLoadedFor) {
      this.form.tasks = [];
      this.projectTasks.set([]);
      this.tasksError.set(null);
      this.showAllProjectTasks.set(true);
      if (projectId != null) this.loadProjectTasks(projectId);
    }
  }

  selectGeneralVisit(): void {
    // Same as the Project | General toggle: a general visit picks from the
    // people's general tasks, and can create new ones (below).
    this.setVisitType('GENERAL');
    this.isGeneralVisit.set(true);
    this.selectedProjectId.set(null);
    this.form.projectId = null;
    this.form.tasks = [];
    this.projectTasks.set([]);
    this.tasksError.set(null);
    this.isTaskDropdownOpen.set(false);
    this.isProjectDropdownOpen.set(false);
  }

  createGeneralTask(): void {
    const title = this.generalTaskTitle.trim();
    if (!title || this.isCreatingGeneralTask()) return;
    this.isCreatingGeneralTask.set(true);
    this.tasksService.createTask({
      title,
      description: this.generalTaskDescription.trim() || undefined,
      parentKind: 'GENERAL',
      assigneeIds: this.selectedEmployeeIds(),
    }).subscribe({
      next: (created: any) => {
        this.isCreatingGeneralTask.set(false);
        this.form.tasks = [...this.form.tasks, {
          issueId: created.id, name: created.title || title,
          description: this.generalTaskDescription.trim(), key: created.key,
          status: created.status || 'TODO',
        }];
        this.generalTaskTitle = '';
        this.generalTaskDescription = '';
        this.toast.success(`${created.key || 'Task'} created and added to this visit`);
      },
      error: (err) => {
        this.isCreatingGeneralTask.set(false);
        this.toast.error(this.messageOf(err) || 'Could not create the general task.');
      },
    });
  }

  // ── Project task picker ─────────────────────────────────────────────────

  /** Which project's board `projectTasks` currently holds, so a re-pick is a no-op. */
  private tasksLoadedFor: number | null = null;

  /**
   * The project's own tasks, read once per project.
   *
   * Failed loads are not fatal in the way the project list failing is: a
   * person can still raise a trip with a scope they type, so the error is said
   * in place rather than replacing the whole form with a retry.
   */
  loadProjectTasks(projectId: number): void {
    this.tasksLoadedFor = projectId;
    this.isLoadingTasks.set(true);
    this.tasksError.set(null);

    this.projectsService.getIssues(projectId).subscribe({
      next: (rows: any[]) => {
        this.isLoadingTasks.set(false);
        this.projectTasks.set((rows || []).map((i: any) => this.toTaskOption(i)));
      },
      error: (err) => {
        this.isLoadingTasks.set(false);
        this.projectTasks.set([]);
        this.tasksError.set(
          `Could not load this project's tasks: ${this.messageOf(err)}.`
          + ' You can still add the scope by hand below.',
        );
      },
    });
  }

  /**
   * The tasks on offer, in the order they should be read.
   *
   * Three filters, each answering a question the person is implicitly asking.
   * Whose work it is: only the people going, unless the whole board is asked
   * for — plus anything nobody owns, which is often exactly the backlog item a
   * trip exists to pick up. Whether it is worth going: finished and cancelled
   * work is left out, since sending somebody to a site to do a task the board
   * has already closed helps nobody. And what is already picked, which is
   * dropped so the list only ever offers something that changes the trip.
   */
  /**
   * The tasks still offered, picked ones excluded. A plain method, not a
   * computed: the picks live in form.tasks, which is not a signal, so a
   * computed never saw a pick and kept offering what was already chosen.
   */
  filteredProjectTasks(): ProjectTaskOption[] {
    const q = this.taskSearchQuery().trim().toLowerCase();
    const people = this.selectedEmployeeIds();
    const picked = this.form.tasks.map((t) => t.issueId).filter((id): id is number => id != null);
    const showAll = this.showAllProjectTasks();

    const general = this.visitType() === 'GENERAL';
    // General visits only take work that is still to be done or under way.
    const isClosed = (t: ProjectTaskOption) => general
      ? !GENERAL_TASK_STATUSES.has(t.status)
      : CLOSED_TASK_STATUSES.has(t.status);
    const isTheirs = (t: ProjectTaskOption) =>
      (t.assigneeId != null && people.includes(t.assigneeId))
      || t.memberIds.some((id) => people.includes(id));

    return this.projectTasks()
      .filter((t) => showAll || isTheirs(t) || (!general && t.assigneeId == null && t.memberIds.length === 0))
      .filter((t) => !isClosed(t) || picked.includes(t.id))
      .filter((t) => !picked.includes(t.id))
      .filter((t) => !q || t.title.toLowerCase().includes(q) || t.key.toLowerCase().includes(q))
      .sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
  }

  /** Why the list is short, so an empty one does not read as "nothing to do". */
  /** Why the list is empty or short. A method for the same reason as above. */
  projectTaskFilterNote(): string {
    if (this.visitType() === 'GENERAL') {
      if (this.isLoadingTasks()) return 'Loading their general tasks…';
      if (!this.selectedEmployeeIds().length) return 'Pick who is going in Step 3 to see their general tasks.';
      if (!this.filteredProjectTasks().length && !this.taskSearchQuery()) {
        return 'None of the people going has a general task in To Do or In Progress.';
      }
      return '';
    }
    if (this.isLoadingTasks()) return 'Loading this project\'s tasks…';
    if (!this.projectTasks().length) return 'This project has no tasks on its board yet.';
    if (this.showAllProjectTasks()) return '';
    if (!this.selectedEmployeeIds().length) {
      return 'Pick who is going in Step 3 to see their tasks — or show the whole project.';
    }
    if (!this.filteredProjectTasks().length) {
      return 'No open task belongs to the people going. Show all project tasks, or add the scope by hand.';
    }
    return '';
  }

  toggleTaskDropdown(): void {
    this.isTaskDropdownOpen.update((v) => !v);
    if (this.isTaskDropdownOpen()) this.taskSearchQuery.set('');
  }

  /** Whether a task (by id) is still waiting for its own approval. */
  isTaskAwaitingApproval(issueId: number | null | undefined): boolean {
    if (issueId == null) return false;
    const state = this.projectTasks().find((t) => t.id === issueId)?.approvalState;
    return state === 'PENDING_TECHNICAL' || state === 'PENDING_ADMIN';
  }

  /**
   * Who a picked task belongs to among the people going: its assignee or
   * members who are on this visit. Empty means nobody going owns it, so
   * nobody can clock in against it (field visit clock-in offers each person
   * only their own tasks).
   */
  taskOwnersGoing(issueId: number | null | undefined): string[] {
    if (issueId == null) return [];
    const t = this.projectTasks().find((o) => o.id === issueId);
    if (!t) return [];
    const going = new Set(this.selectedEmployeeIds());
    const names: string[] = [];
    if (t.assigneeId != null && going.has(t.assigneeId) && t.assigneeName) names.push(t.assigneeName);
    t.memberIds.forEach((id, i) => {
      if (going.has(id) && id !== t.assigneeId && t.memberNames[i]) names.push(t.memberNames[i]);
    });
    return names;
  }

  /** The task's owner on the board, whoever it is, for display. */
  taskOwnerLabel(issueId: number | null | undefined): string {
    const going = this.taskOwnersGoing(issueId);
    if (going.length) return going.join(', ');
    const t = issueId == null ? undefined : this.projectTasks().find((o) => o.id === issueId);
    return t?.assigneeName || 'Unassigned';
  }

  /** Picked board tasks that nobody going owns. */
  pickedNotOwnedByAnyoneGoing(): { key: string; name: string; owner: string }[] {
    return this.form.tasks
      .filter((t) => t.issueId != null && !this.taskOwnersGoing(t.issueId).length)
      .map((t) => ({ key: t.key ?? '', name: t.name, owner: this.taskOwnerLabel(t.issueId) }));
  }

  /** Picked tasks still awaiting approval, for the warning under Step 4. */
  pickedAwaitingApproval(): { key: string; name: string }[] {
    return this.form.tasks
      .filter((t) => this.isTaskAwaitingApproval(t.issueId))
      .map((t) => ({ key: t.key ?? '', name: t.name }));
  }

  toggleTaskOption(option: ProjectTaskOption): void {
    this.form.tasks = [
      ...this.form.tasks,
      {
        issueId: option.id,
        name: option.title,
        description: '',
        key: option.key,
        status: option.status,
      },
    ];
  }

  /**
   * Drop one line of scope.
   *
   * Clearing a task that was picked off the board is a no-op on the board
   * itself — the trip stops claiming it, and nothing else happens. Only the
   * cards approval minted for a described task follow the line out, which is
   * what the server reconciles on re-approval.
   */
  removeTaskAt(index: number): void {
    this.form.tasks = this.form.tasks.filter((_, i) => i !== index);
  }

  /**
   * The escape hatch, for work that is not on the board.
   *
   * Deliberately not the front door: a trip whose scope is a set of existing
   * tasks is one the board and the trip cannot disagree about, and that is the
   * whole reason this replaced free typing. Offered only from the empty state
   * and the link below the list, because a project with no tasks at all would
   * otherwise be unable to raise a visit.
   */
  addTaskManually(name?: string): void {
    const title = String(name ?? '').trim();
    if (!title) return;
    this.form.tasks = [
      ...this.form.tasks,
      { issueId: null, name: title, description: '' },
    ];
  }

  /** The half-typed free-text line, kept so a click on Add can read it. */
  manualTaskName = '';

  addManualTaskFromInput(value: string): void {
    this.manualTaskName = value;
  }

  commitManualTask(): void {
    this.addTaskManually(this.manualTaskName);
    this.manualTaskName = '';
  }

  /**
   * A board status in words, rather than a code.
   *
   * Read next to a title somebody is about to commit a day of somebody's
   * working life to, so "IN_REVIEW" and "TODO" are translated rather than shown
   * as the column names they are stored as.
   */
  statusLabel(status: string): string {
    return ({
      TODO: 'To do',
      IN_PROGRESS: 'In progress',
      IN_REVIEW: 'In review',
      DONE: 'Done',
      CANCELLED: 'Cancelled',
    } as Record<string, string>)[status] ?? status.replace(/_/g, ' ').toLowerCase();
  }

  // ── Searchable Visit Location Picker (§PB10) ───────────────────────────
  selectedVisitLocation = computed(() => {
    const id = this.selectedVisitLocationId();
    if (id == null) return null;
    return this.visitLocations().find((l) => l.id === id) || null;
  });

  filteredVisitLocations = computed(() => {
    const q = this.locationSearchQuery().trim().toLowerCase();
    const list = this.visitLocations();
    if (!q) return list;
    return list.filter((l) =>
      l.name.toLowerCase().includes(q) ||
      (l.address && l.address.toLowerCase().includes(q)) ||
      (l.leadContact?.companyName && l.leadContact.companyName.toLowerCase().includes(q))
    );
  });

  toggleLocationDropdown(): void {
    this.isLocationDropdownOpen.update((v) => !v);
    if (this.isLocationDropdownOpen()) {
      this.locationSearchQuery.set('');
      this.isProjectDropdownOpen.set(false);
    }
  }

  selectVisitLocation(locId: number | null): void {
    this.onVisitLocationPicked(locId);
    this.isLocationDropdownOpen.set(false);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('.searchable-select-container')) {
      this.isProjectDropdownOpen.set(false);
      this.isLocationDropdownOpen.set(false);
      this.isTaskDropdownOpen.set(false);
    }
  }

  // ── Searchable Employee Picker ──────────────────────────────────────────
  filteredEmployees = computed(() => {
    const q = this.employeeSearchQuery().trim().toLowerCase();
    const list = this.employees();
    if (!q) return list;
    return list.filter((e) =>
      e.name.toLowerCase().includes(q) ||
      e.email.toLowerCase().includes(q) ||
      (e.designation && e.designation.toLowerCase().includes(q))
    );
  });

  selectedEmployees = computed(() => {
    const ids = this.selectedEmployeeIds();
    return this.employees().filter((e) => ids.includes(e.id));
  });

  selectAllFilteredEmployees(): void {
    const idsToAdd = this.filteredEmployees().map((e) => e.id);
    const set = new Set([...this.selectedEmployeeIds(), ...idsToAdd]);
    const updated = Array.from(set);
    this.selectedEmployeeIds.set(updated);
    this.form.employeeIds = updated;
  }

  clearSelectedEmployees(): void {
    this.selectedEmployeeIds.set([]);
    this.form.employeeIds = [];
  }

  toggleEmployee(id: number): void {
    const current = this.selectedEmployeeIds();
    const updated = current.includes(id)
      ? current.filter((e) => e !== id)
      : [...current, id];
    this.selectedEmployeeIds.set(updated);
    this.form.employeeIds = updated;
  }

  isPicked(id: number): boolean {
    return this.selectedEmployeeIds().includes(id);
  }

  getInitials(name: string): string {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }

  // ── Drag & Drop Attachments ──────────────────────────────────────────────
  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);
    if (event.dataTransfer?.files?.length) {
      this.uploadFiles(Array.from(event.dataTransfer.files));
    }
  }

  onAttachmentPicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files?.length) {
      this.uploadFiles(Array.from(input.files));
    }
    input.value = '';
  }

  uploadFiles(files: File[]): void {
    if (!files || !files.length) return;
    this.isUploading.set(true);
    let completed = 0;
    const total = files.length;

    files.forEach((file) => {
      const body = new FormData();
      body.append('file', file);
      this.http.post<{ url?: string; fileUrl?: string; path?: string }>(
        `${environment.apiUrl}/upload`, body,
      ).subscribe({
        next: (res) => {
          const fileUrl = res.url || res.fileUrl || res.path;
          if (fileUrl) {
            this.form.attachments = [
              ...this.form.attachments,
              { fileName: file.name, fileUrl, fileSize: file.size },
            ];
          }
          completed++;
          if (completed === total) {
            this.isUploading.set(false);
            this.toast.success(`${total > 1 ? `${total} files` : 'File'} attached successfully`);
          }
        },
        error: (err) => {
          completed++;
          if (completed === total) {
            this.isUploading.set(false);
          }
          this.toast.error(`Failed to upload ${file.name}: ${this.messageOf(err)}`);
        },
      });
    });
  }

  removeAttachment(index: number): void {
    this.form.attachments = this.form.attachments.filter((_, i) => i !== index);
  }

  formatFileSize(bytes?: number): string {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  getFileBadgeClass(fileName: string): string {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) return 'badge-image';
    if (['pdf'].includes(ext)) return 'badge-pdf';
    if (['xls', 'xlsx', 'csv'].includes(ext)) return 'badge-sheet';
    if (['doc', 'docx', 'txt'].includes(ext)) return 'badge-doc';
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'badge-archive';
    return 'badge-generic';
  }

  getFileExtLabel(fileName: string): string {
    return (fileName.split('.').pop() || 'FILE').toUpperCase().slice(0, 4);
  }

  private payload(submit: boolean): FieldVisitRequestInput {
    return {
      visitType: this.visitType(),
      projectId: this.visitType() === 'GENERAL'
        ? undefined
        : Number(this.selectedProjectId() ?? this.form.projectId),
      location: this.form.location.trim(),
      visitLocationId: this.form.visitLocationId ?? undefined,
      latitude: Number(this.form.latitude),
      longitude: Number(this.form.longitude),
      startDate: this.form.startDate,
      endDate: this.form.endDate,
      visitDays: this.visitDays(),
      startTime: this.form.startTime,
      endTime: this.form.endTime,
      remarks: this.form.remarks.trim() || undefined,
      employeeIds: this.selectedEmployeeIds(),
      // `issueId` is what makes a line an adopted task rather than a phrase;
      // `name` alone would have approval mint a second card for work the
      // project already has.
      tasks: this.form.tasks
        .filter((t) => t.issueId != null || t.name.trim())
        .map((t) => ({
          issueId: t.issueId ?? undefined,
          name: t.name.trim(),
          description: t.description.trim() || undefined,
        })),
      attachments: this.form.attachments,
      submit,
    };
  }

  /** §10: the proposal goes to an approver; the trip carries on meanwhile. */
  proposeChange(): void {
    const id = this.request?.id;
    if (!id) return;
    if (!this.validateForm()) {
      return;
    }
    this.error.set(null);
    this.isSaving.set(true);

    this.api.requestModification(id, this.payload(false)).subscribe({
      next: () => {
        this.isSaving.set(false);
        this.toast.success('Change sent for approval — the trip runs as approved until it is decided');
        this.saved.emit();
      },
      error: (err: any) => {
        this.isSaving.set(false);
        this.error.set(this.messageOf(err));
      },
    });
  }

  save(submit: boolean): void {
    if (submit) {
      if (!this.validateForm()) {
        return;
      }
    } else {
      if (this.isFieldInvalid('project')) {
        this.showValidationErrors.set(true);
        this.toast.error('Please select a project before saving a draft');
        this.scrollToField('field-fvr-project');
        return;
      }
    }

    this.error.set(null);
    this.isSaving.set(true);

    const id = this.request?.id;
    const request$ = this.mode === 'edit' && id
      ? this.api.update(id, this.payload(false))
      : this.api.create(this.payload(submit));

    request$.subscribe({
      next: (saved) => {
        // Editing a draft and pressing Submit is two steps: the edit, then the
        // hand-off. Doing them as one call would mean an edit that failed
        // halfway could still submit. The button stays disabled across both,
        // so a second click cannot land between them.
        if (this.mode === 'edit' && id && submit) {
          this.api.submit(id).subscribe({
            next: () => { this.isSaving.set(false); this.done(true, saved.requestNumber); },
            error: (err) => { this.isSaving.set(false); this.error.set(this.messageOf(err)); },
          });
          return;
        }
        this.isSaving.set(false);
        this.done(submit, saved.requestNumber);
      },
      error: (err) => {
        this.error.set(this.messageOf(err));
        this.isSaving.set(false);
      },
    });
  }

  private done(submitted: boolean, requestNumber?: string): void {
    this.toast.success(
      submitted
        ? `${requestNumber ? requestNumber + ' ' : ''}sent for approval`
        : 'Saved as a draft',
    );
    this.saved.emit();
  }

  close(): void {
    this.closed.emit();
  }

  private messageOf(err: any): string {
    const message = err?.error?.message;
    if (Array.isArray(message)) return message.join(', ');
    if (message) return message;
    // status 0 is the browser saying it never got a reply — the API being
    // down, or the request never leaving the machine.
    if (err?.status === 0) return 'the server did not respond';
    if (err?.status) return `the server returned ${err.status}`;
    return 'something went wrong';
  }
}
