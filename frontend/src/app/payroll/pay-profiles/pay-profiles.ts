import { Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { HotToastService } from '@ngneat/hot-toast';
import { AuthService } from '../../services/auth.service';
import {
  PayrollService,
  PayProfileImportPreview,
  PayProfileImportRow,
  PayProfileRow,
} from '../../services/payroll.service';

type Filter = 'ALL' | 'NO_PROFILE' | 'MISSING_DETAILS' | 'UPCOMING';

/** An import row as Finance edits it before saving. */
interface ImportDraft extends PayProfileImportRow {
  selected: boolean;
  open: boolean;
}

/**
 * Payroll → Pay Profiles (Payroll plan Phase 2): who is set up, what's missing,
 * and the one-time import that turns today's salaries into version-1 profiles.
 */
@Component({
  selector: 'app-pay-profiles',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './pay-profiles.html',
  styleUrls: ['./pay-profiles.css'],
})
export class PayProfilesComponent implements OnInit {
  private payroll = inject(PayrollService);
  private auth = inject(AuthService);
  private router = inject(Router);
  private toast = inject(HotToastService);

  /** Shown as a tab inside the Payroll page: that page supplies the title and tabs. */
  @Input() embedded = false;

  rows = signal<PayProfileRow[]>([]);
  loading = signal(true);
  search = signal('');
  filter = signal<Filter>('ALL');

  /** Finance and admins change pay; HR only looks (the server enforces this too). */
  canEdit = computed(() => ['SUPERADMIN', 'SUPER_ADMIN', 'ADMIN', 'FINANCE'].includes(this.auth.currentUser()?.role));

  counts = computed(() => {
    const r = this.rows();
    return {
      all: r.length,
      withProfile: r.filter((x) => x.current).length,
      noProfile: r.filter((x) => !x.current).length,
      missingDetails: r.filter((x) => x.missing.some((m) => m !== 'Pay profile')).length,
      upcoming: r.filter((x) => x.upcoming).length,
    };
  });

  filtered = computed(() => {
    const q = this.search().trim().toLowerCase();
    const f = this.filter();
    return this.rows().filter((r) => {
      if (f === 'NO_PROFILE' && r.current) return false;
      if (f === 'MISSING_DETAILS' && !r.missing.some((m) => m !== 'Pay profile')) return false;
      if (f === 'UPCOMING' && !r.upcoming) return false;
      if (!q) return true;
      return [r.name, r.department, r.designation, r.current?.salaryGroupCode].some((v) => (v || '').toLowerCase().includes(q));
    });
  });

  // ── Import review ──
  importOpen = signal(false);
  importLoading = signal(false);
  importSaving = signal(false);
  preview = signal<PayProfileImportPreview | null>(null);
  drafts = signal<ImportDraft[]>([]);
  importStatusFilter = signal<'ALL' | 'MATCH' | 'REVIEW' | 'NO_SALARY'>('ALL');
  importEffectiveFrom = this.firstOfMonth();

  visibleDrafts = computed(() => {
    const f = this.importStatusFilter();
    return this.drafts().filter((d) => f === 'ALL' || d.status === f || (f === 'NO_SALARY' && d.status === 'NO_GROUP'));
  });
  selectedCount = computed(() => this.drafts().filter((d) => d.selected).length);

  ngOnInit() {
    this.load();
  }

  load() {
    this.loading.set(true);
    this.payroll.getPayProfiles().subscribe({
      next: (r) => { this.rows.set(r); this.loading.set(false); },
      error: (e) => { this.loading.set(false); this.toast.error(e?.error?.message || 'Failed to load pay profiles'); },
    });
  }

  open(row: PayProfileRow) {
    this.router.navigate(['/payroll/pay-profiles', row.employeeId]);
  }

  backToPayroll() {
    this.router.navigate(['/payroll/processing']);
  }

  openImport() {
    this.importOpen.set(true);
    this.importLoading.set(true);
    this.payroll.previewPayProfileImport().subscribe({
      next: (p) => {
        this.preview.set(p);
        // Rows that already match are ticked; anything to review starts unticked.
        this.drafts.set(p.rows.map((r) => ({ ...r, selected: r.status === 'MATCH', open: false })));
        this.importLoading.set(false);
      },
      error: (e) => { this.importLoading.set(false); this.toast.error(e?.error?.message || 'Failed to build the import report'); },
    });
  }

  closeImport() {
    this.importOpen.set(false);
  }

  canSelect(d: ImportDraft) {
    return !!d.salaryGroupCode && (d.annualCtc ?? 0) > 0;
  }

  toggleAll(on: boolean) {
    this.drafts.update((list) => list.map((d) => (this.visibleDrafts().includes(d) && this.canSelect(d) ? { ...d, selected: on } : d)));
  }

  touch() {
    this.drafts.update((list) => [...list]);
  }

  saveImport() {
    const rows = this.drafts()
      .filter((d) => d.selected && this.canSelect(d))
      .map((d) => ({ employeeId: d.employeeId, salaryGroupCode: d.salaryGroupCode!, annualCtc: Number(d.annualCtc) }));
    if (!rows.length) { this.toast.error('Tick at least one employee'); return; }
    if (!this.importEffectiveFrom) { this.toast.error('Pick the date the profiles start from'); return; }
    if (!confirm(`Create pay profiles for ${rows.length} employee${rows.length === 1 ? '' : 's'}, starting ${this.importEffectiveFrom}? Salaries paid today don't change.`)) return;
    this.importSaving.set(true);
    this.payroll.applyPayProfileImport(this.importEffectiveFrom, rows).subscribe({
      next: (res) => {
        this.importSaving.set(false);
        if (res.failed.length) {
          const names = new Map(this.drafts().map((d) => [d.employeeId, d.name]));
          this.toast.error(`${res.failed.length} not saved: ${res.failed.map((f) => `${names.get(f.employeeId)} (${f.error})`).join('; ')}`, { duration: 10000 });
        }
        if (res.saved) this.toast.success(`${res.saved} pay profile${res.saved === 1 ? '' : 's'} created`);
        this.closeImport();
        this.load();
      },
      error: (e) => { this.importSaving.set(false); this.toast.error(e?.error?.message || 'Failed to save'); },
    });
  }

  statusLabel(s: string) {
    return ({ MATCH: 'Matches', REVIEW: 'Review', NO_SALARY: 'No salary set up', NO_GROUP: 'No group' } as any)[s] || s;
  }

  money(n: number | null | undefined) {
    return n == null ? '—' : '₹' + Math.round(n).toLocaleString('en-IN');
  }

  private firstOfMonth() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  }
}
