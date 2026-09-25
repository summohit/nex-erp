import { Component, EventEmitter, Input, OnInit, Output, inject, signal, computed } from '@angular/core';
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
} from '@lucide/angular';
import {
  FieldVisitRequestsService, FieldVisitRequest, FieldVisitRequestInput,
} from '../../services/field-visit-requests';
import { ProjectsService } from '../../services/projects';
import { EmployeeService } from '../../services/employee.service';
import { environment } from '../../../environments/environment';

const DAY_MS = 24 * 60 * 60 * 1000;

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
  ],
  templateUrl: './field-visit-request-form.html',
  styleUrls: ['./field-visit-request-form.css'],
})
export class FieldVisitRequestFormComponent implements OnInit {
  /** The trip being edited or changed; absent when raising a new one. */
  @Input() request: FieldVisitRequest | null = null;
  @Input() mode: FieldVisitFormMode = 'create';

  @Output() saved = new EventEmitter<void>();
  @Output() closed = new EventEmitter<void>();

  private api = inject(FieldVisitRequestsService);
  private projectsService = inject(ProjectsService);
  private employeeService = inject(EmployeeService);
  private sanitizer = inject(DomSanitizer);
  private toast = inject(HotToastService);
  private http = inject(HttpClient);

  projects = signal<{ id: number; name: string }[]>([]);
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
  isLoadingLists = signal(false);

  // Searchable Project select state
  selectedProjectId = signal<number | null>(null);
  isProjectDropdownOpen = signal(false);
  projectSearchQuery = signal('');

  // Searchable Employee picker state
  selectedEmployeeIds = signal<number[]>([]);
  employeeSearchQuery = signal('');

  // Drag and drop attachment state
  isDragging = signal(false);
  isUploading = signal(false);

  form = {
    projectId: null as number | null,
    location: '',
    latitude: null as number | null,
    longitude: null as number | null,
    startDate: '',
    endDate: '',
    startTime: '09:00',
    endTime: '18:00',
    remarks: '',
    employeeIds: [] as number[],
    tasks: [{ name: '', description: '' }],
    attachments: [] as { fileName: string; fileUrl: string; fileSize?: number }[],
  };

  get title(): string {
    if (this.mode === 'modify') return `Change ${this.request?.requestNumber ?? 'this field visit'}`;
    return this.mode === 'edit' ? 'Edit field visit request' : 'New field visit request';
  }

  ngOnInit(): void {
    if (this.request) {
      this.selectedProjectId.set(this.request.project.id);
      this.selectedEmployeeIds.set(this.request.members.map((m) => m.employee.id));
      this.form = {
        projectId: this.request.project.id,
        location: this.request.location,
        latitude: this.request.latitude,
        longitude: this.request.longitude,
        startDate: this.request.startDate.slice(0, 10),
        endDate: this.request.endDate.slice(0, 10),
        startTime: this.request.startTime,
        endTime: this.request.endTime,
        remarks: this.request.remarks ?? '',
        employeeIds: this.request.members.map((m) => m.employee.id),
        tasks: this.request.tasks.length
          ? this.request.tasks.map((t) => ({ name: t.name, description: t.description ?? '' }))
          : [{ name: '', description: '' }],
        attachments: this.request.attachments.map((a) => ({
          fileName: a.fileName, fileUrl: a.fileUrl, fileSize: a.fileSize ?? undefined,
        })),
      };
    }

    this.loadLists();
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

    this.projectsService.getProjects().subscribe({
      next: (rows: any[]) => {
        this.projects.set((rows || []).map((p) => ({ id: p.id, name: p.name })));
        done();
      },
      error: (err) => { this.projects.set([]); failed('the project list', err); },
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
   */
  visitDays = computed(() => {
    const { startDate, endDate } = this.form;
    if (!startDate || !endDate) return 0;
    const from = Date.parse(`${startDate}T00:00:00Z`);
    const to = Date.parse(`${endDate}T00:00:00Z`);
    if (Number.isNaN(from) || Number.isNaN(to) || to < from) return 0;
    return Math.round((to - from) / DAY_MS) + 1;
  });

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
    return list.filter((p) => p.name.toLowerCase().includes(q));
  });

  toggleProjectDropdown(): void {
    this.isProjectDropdownOpen.update((v) => !v);
    if (this.isProjectDropdownOpen()) {
      this.projectSearchQuery.set('');
    }
  }

  selectProject(projectId: number | null): void {
    this.selectedProjectId.set(projectId);
    this.form.projectId = projectId;
    this.isProjectDropdownOpen.set(false);
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

  // ── Tasks ───────────────────────────────────────────────────────────────
  addTask(): void {
    this.form.tasks = [...this.form.tasks, { name: '', description: '' }];
  }

  removeTask(index: number): void {
    this.form.tasks = this.form.tasks.filter((_, i) => i !== index);
    if (!this.form.tasks.length) this.addTask();
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
      projectId: Number(this.selectedProjectId() ?? this.form.projectId),
      location: this.form.location.trim(),
      latitude: Number(this.form.latitude),
      longitude: Number(this.form.longitude),
      startDate: this.form.startDate,
      endDate: this.form.endDate,
      visitDays: this.visitDays(),
      startTime: this.form.startTime,
      endTime: this.form.endTime,
      remarks: this.form.remarks.trim() || undefined,
      employeeIds: this.selectedEmployeeIds(),
      tasks: this.form.tasks
        .filter((t) => t.name.trim())
        .map((t) => ({ name: t.name.trim(), description: t.description.trim() || undefined })),
      attachments: this.form.attachments,
      submit,
    };
  }

  /** §10: the proposal goes to an approver; the trip carries on meanwhile. */
  proposeChange(): void {
    const id = this.request?.id;
    if (!id) return;
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
