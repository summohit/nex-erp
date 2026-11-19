import { ProfileModalService } from '../../shared/profile-modal/profile-modal.service';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header';
import { DocumentRequirementsComponent } from './document-requirements/document-requirements';
import { WaiverQueueComponent } from './waiver-queue/waiver-queue';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { DatePresetFilterComponent, DatePreset, DateRange, inDateRange } from '../../shared/components/date-preset-filter/date-preset-filter';
import { UploadService } from '../../services/upload.service';
import { HotToastService } from '@ngneat/hot-toast';
import { EmployeeService, ExemptEmployee, ProfileCompletenessReport, ProfileLock } from '../../services/employee.service';
import {
  LucideArrowLeft,
  LucideRefreshCw,
  LucideDownload,
  LucideUsers,
  LucideCheckCircle2,
  LucideAlertCircle,
  LucideSparkles,
  LucideSearch,
  LucideX,
  LucideChevronDown,
  LucideChevronUp,
  LucideFileQuestion,
  LucideBuilding,
  LucideUserCheck,
  LucideLock,
  LucideFileText,
  LucideClock
} from '@lucide/angular';

/**
 * HR's view of the profile-completion drive (16 Oct 2026): who still has
 * documents or details missing, what exactly, and their reporting manager,
 * so HR can follow up. Exempt accounts are not listed.
 */
@Component({
  selector: 'app-profile-completion',
  standalone: true,
  imports: [
    CommonModule,
    PageHeaderComponent,
    DocumentRequirementsComponent,
    WaiverQueueComponent,
    FormsModule,
    RouterModule,
    DatePresetFilterComponent,
    LucideArrowLeft,
    LucideRefreshCw,
    LucideDownload,
    LucideUsers,
    LucideCheckCircle2,
    LucideAlertCircle,
    LucideSparkles,
    LucideSearch,
    LucideX,
    LucideChevronDown,
    LucideChevronUp,
    LucideFileQuestion,
    LucideBuilding,
    LucideUserCheck,
    LucideLock,
    LucideFileText,
    LucideClock
  ],
  templateUrl: './profile-completion.html',
  styleUrl: './profile-completion.css',
})
export class ProfileCompletionComponent implements OnInit {
  /** Document requirements editor (16 Nov 2026). */
  showDocRules = signal(false);

  private employees = inject(EmployeeService);
  profileModal = inject(ProfileModalService);
  private uploads = inject(UploadService);
  private toastSvc = inject(HotToastService);

  // ── #35 (19 Nov 2026): documents window ──
  docsFor = signal<any | null>(null);
  docs = signal<any[]>([]);
  docsLoading = signal(false);
  docBusy = signal<number | null>(null);
  docTypes = signal<string[]>([]);

  openDocs(row: any) {
    this.docsFor.set(row);
    this.loadDocs();
    if (!this.docTypes().length) {
      this.employees.getDocumentTypes().subscribe({ next: (r) => this.docTypes.set(r?.all || []), error: () => {} });
    }
  }
  closeDocs() { this.docsFor.set(null); this.docs.set([]); }
  private loadDocs() {
    const id = this.docsFor()?.employee?.id;
    if (!id) return;
    this.docsLoading.set(true);
    this.employees.getProfile(id).subscribe({
      next: (p: any) => { this.docs.set((p?.documents || []).sort((a: any, b: any) => String(b.createdAt).localeCompare(String(a.createdAt)))); this.docsLoading.set(false); },
      error: (e: any) => { this.docsLoading.set(false); this.toastSvc.error(e?.error?.message || 'Could not load documents'); },
    });
  }
  private empId(): number { return this.docsFor()?.employee?.id; }
  private done(msg: string) { this.docBusy.set(null); this.toastSvc.success(msg); this.loadDocs(); this.load(); }
  private fail(e: any) { this.docBusy.set(null); this.toastSvc.error(e?.error?.message || 'Could not save'); }

  changeType(doc: any, type: string) {
    if (!type || type === doc.documentType) return;
    this.docBusy.set(doc.id);
    this.employees.updateDocumentType(this.empId(), doc.id, type).subscribe({ next: () => this.done(`Saved as ${type}`), error: (e) => this.fail(e) });
  }
  verify(doc: any, status: 'VERIFIED' | 'REJECTED') {
    let note: string | undefined;
    if (status === 'REJECTED') { note = prompt('Why is this document rejected?') || ''; if (!note.trim()) return; }
    this.docBusy.set(doc.id);
    this.employees.verifyDocument(this.empId(), doc.id, status, note).subscribe({ next: () => this.done(status === 'VERIFIED' ? 'Marked verified' : 'Marked rejected'), error: (e) => this.fail(e) });
  }
  remove(doc: any) {
    if (!confirm(`Delete "${doc.fileName}"? This can't be undone.`)) return;
    this.docBusy.set(doc.id);
    this.employees.deleteDocument(this.empId(), doc.id).subscribe({ next: () => this.done('Document deleted'), error: (e) => this.fail(e) });
  }
  replace(doc: any, ev: Event) {
    const file = (ev.target as HTMLInputElement).files?.[0];
    (ev.target as HTMLInputElement).value = '';
    if (!file) return;
    this.docBusy.set(doc.id);
    this.uploads.uploadFile(file).subscribe({
      next: (u: any) => {
        const url = u?.url || u?.fileUrl;
        if (!url) { this.fail({ error: { message: 'Upload failed' } }); return; }
        this.employees.addDocument(this.empId(), { fileName: file.name, fileUrl: url, documentType: doc.documentType }).subscribe({
          next: () => this.employees.deleteDocument(this.empId(), doc.id).subscribe({ next: () => this.done('File replaced'), error: (e) => this.fail(e) }),
          error: (e) => this.fail(e),
        });
      },
      error: (e) => this.fail(e),
    });
  }

  report = signal<ProfileCompletenessReport | null>(null);
  loading = signal(true);
  error = signal<string | null>(null);
  filter = signal<'INCOMPLETE' | 'COMPLETE' | 'ALL'>('INCOMPLETE');
  selectedDepartment = signal<string>('ALL');
  query = signal('');
  /** Joined within (12 Nov 2026), same date filter as the other Employee pages. */
  datePreset = signal<DatePreset>('ALL');
  dateRange = signal<DateRange>(null);
  expandedRows = signal<Set<number>>(new Set<number>());
  allExpanded = signal<boolean>(false);

  departments = computed(() => {
    const r = this.report();
    if (!r) return [];
    const depts = new Set<string>();
    for (const row of r.rows) {
      if (row.employee.department) depts.add(row.employee.department);
    }
    return Array.from(depts).sort();
  });

  completionRate = computed(() => {
    const r = this.report();
    if (!r || !r.total) return 0;
    return Math.round((r.complete / r.total) * 100);
  });

  incompleteRate = computed(() => {
    const r = this.report();
    if (!r || !r.total) return 0;
    return Math.round((r.incomplete / r.total) * 100);
  });

  rows = computed(() => {
    const r = this.report();
    if (!r) return [];
    const q = this.query().trim().toLowerCase();
    const dept = this.selectedDepartment();
    const range = this.dateRange();

    return r.rows.filter((row) => {
      if (!inDateRange(row.employee.joiningDate, range)) return false;
      if (this.filter() === 'INCOMPLETE' && row.complete) return false;
      if (this.filter() === 'COMPLETE' && !row.complete) return false;
      if (dept !== 'ALL' && row.employee.department !== dept) return false;
      if (!q) return true;
      const e = row.employee;
      const missingStr = row.missing ? row.missing.join(' ') : '';
      const searchable = `${e.firstName || ''} ${e.lastName || ''} ${e.employeeCode || ''} ${e.email || ''} ${e.department || ''} ${e.designation || ''} ${row.manager || ''} ${missingStr}`.toLowerCase();
      return searchable.includes(q);
    });
  });

  /** Paging, like the Directory's table: 20 a page by default (12 Nov 2026). */
  readonly pageSizes = [20, 50, 100, 200];
  page = signal(0);
  pageSize = signal(20);
  pageCount = computed(() => Math.max(1, Math.ceil(this.rows().length / this.pageSize())));
  pageStart = computed(() => Math.min(this.page(), this.pageCount() - 1) * this.pageSize());
  pageEnd = computed(() => Math.min(this.pageStart() + this.pageSize(), this.rows().length));
  pagedRows = computed(() => this.rows().slice(this.pageStart(), this.pageEnd()));
  setPageSize(n: number) { this.pageSize.set(Number(n)); this.page.set(0); }

  /**
   * HR's document lock (17 Oct 2026): when on (from the start date, or at once),
   * the reminder cannot be closed until every required document and detail is
   * uploaded. Exempt accounts are never locked.
   */
  lock = signal<ProfileLock | null>(null);
  lockEnabled = false;
  lockFrom = '';
  savingLock = signal(false);
  lockSaved = signal(false);

  /**
   * Excused from the reminder and lock (17 Oct 2026): HR searches for a person
   * and adds them; the built-in accounts are listed but cannot be removed.
   */
  exempt = signal<ExemptEmployee[]>([]);
  exemptQuery = signal('');
  exemptBusy = signal<number | null>(null);
  exemptMatches = computed(() => {
    const q = this.exemptQuery().trim().toLowerCase();
    if (!q) return [];
    const taken = new Set(this.exempt().map((e) => e.id));
    return (this.report()?.rows ?? [])
      .map((r) => r.employee)
      .filter((e) => !taken.has(e.id))
      .filter((e) => `${e.firstName || ''} ${e.lastName || ''} ${e.employeeCode || ''} ${e.email || ''}`.toLowerCase().includes(q))
      .slice(0, 8);
  });

  uniqueExempt = computed(() => {
    const list = this.exempt();
    const seen = new Set<string>();
    const out: ExemptEmployee[] = [];
    for (const item of list) {
      const key = `${item.firstName || ''}_${item.lastName || ''}`.toLowerCase().trim();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(item);
      }
    }
    return out;
  });

  loadExempt() {
    this.employees.getProfileExempt().subscribe({ next: (l) => this.exempt.set(l), error: () => this.exempt.set([]) });
  }

  setExempt(employeeId: number, exempt: boolean) {
    this.exemptBusy.set(employeeId);
    this.employees.setProfileExempt(employeeId, exempt).subscribe({
      next: (l) => {
        this.exempt.set(l);
        this.exemptQuery.set('');
        this.exemptBusy.set(null);
        this.load(); // the report leaves exempt people out
      },
      error: () => this.exemptBusy.set(null),
    });
  }

  ngOnInit() {
    this.load();
    this.loadExempt();
    this.employees.getProfileLock().subscribe({
      next: (l) => { this.lock.set(l); this.lockEnabled = l.enabled; this.lockFrom = l.from ?? ''; },
      error: () => this.lock.set(null),
    });
  }

  saveLock() {
    this.savingLock.set(true);
    this.lockSaved.set(false);
    this.employees.setProfileLock({ enabled: this.lockEnabled, from: this.lockFrom || null }).subscribe({
      next: (l) => {
        this.lock.set(l);
        this.lockEnabled = l.enabled;
        this.lockFrom = l.from ?? '';
        this.savingLock.set(false);
        this.lockSaved.set(true);
      },
      error: () => this.savingLock.set(false),
    });
  }

  get lockDirty(): boolean {
    const l = this.lock();
    return !!l && (l.enabled !== this.lockEnabled || (l.from ?? '') !== this.lockFrom);
  }

  load() {
    this.loading.set(true);
    this.error.set(null);
    this.employees.getProfileCompletenessReport().subscribe({
      next: (r) => {
        this.report.set(r);
        this.loading.set(false);
      },
      error: (e) => {
        this.error.set(e?.error?.message || 'Could not load profile completion report.');
        this.loading.set(false);
      },
    });
  }

  isRowExpanded(employeeId: number): boolean {
    if (this.allExpanded()) return true;
    return this.expandedRows().has(employeeId);
  }

  toggleRow(employeeId: number) {
    if (this.allExpanded()) {
      const current = new Set<number>();
      const r = this.report();
      if (r) {
        for (const row of r.rows) {
          if (row.employee.id !== employeeId) current.add(row.employee.id);
        }
      }
      this.allExpanded.set(false);
      this.expandedRows.set(current);
      return;
    }
    const current = new Set(this.expandedRows());
    if (current.has(employeeId)) {
      current.delete(employeeId);
    } else {
      current.add(employeeId);
    }
    this.expandedRows.set(current);
  }

  toggleAllExpanded() {
    const next = !this.allExpanded();
    this.allExpanded.set(next);
    if (!next) {
      this.expandedRows.set(new Set());
    }
  }

  getDisplayMissing(row: ProfileCompletenessReport['rows'][number]): string[] {
    if (!row.missing) return [];
    if (this.isRowExpanded(row.employee.id)) {
      return row.missing;
    }
    return row.missing.slice(0, 3);
  }

  getInitials(firstName: string, lastName?: string | null): string {
    const f = firstName?.trim() ? firstName.trim()[0].toUpperCase() : '';
    const l = lastName?.trim() ? lastName.trim()[0].toUpperCase() : '';
    return (f + l) || 'EM';
  }

  getAvatarBg(id: number): string {
    const colors = [
      '#3b82f6', // blue
      '#8b5cf6', // violet
      '#10b981', // emerald
      '#f59e0b', // amber
      '#ec4899', // pink
      '#06b6d4', // cyan
      '#6366f1', // indigo
      '#14b8a6', // teal
    ];
    return colors[Math.abs(id) % colors.length];
  }

  getAvatarColor(id: number): string {
    return '#ffffff';
  }

  clearFilters() {
    this.query.set('');
    this.selectedDepartment.set('ALL');
    this.filter.set('INCOMPLETE');
    this.datePreset.set('ALL');
    this.dateRange.set(null);
  }

  /** CSV for HR to share with managers. */
  download() {
    const rows = this.rows();
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [
      ['Employee', 'Code', 'Email', 'Department', 'Manager', 'Status', 'Missing Items Count', 'Missing', 'Files in Other'].map(esc).join(','),
      ...rows.map((r) => [
        `${r.employee.firstName} ${r.employee.lastName ?? ''}`.trim(),
        r.employee.employeeCode ?? '',
        r.employee.email ?? '',
        r.employee.department ?? '',
        r.manager ?? '',
        r.complete ? 'Complete' : 'Incomplete',
        r.missing ? r.missing.length : 0,
        r.missing ? r.missing.join('; ') : '',
        r.uploadedAsOther ?? 0,
      ].map(esc).join(',')),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `profile-completion-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
}
