import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { AgGridAngular } from 'ag-grid-angular';
import { ColDef, AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { Router } from '@angular/router';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header';
import { SearchableSelectComponent } from '../../shared/components/searchable-select/searchable-select.component';
import { DatePresetFilterComponent, DatePreset, DateRange } from '../../shared/components/date-preset-filter/date-preset-filter';
import { CandidatesComponent } from '../candidates/candidates';

ModuleRegistry.registerModules([AllCommunityModule]);

interface Offer {
  id: number; applicationId: number; candidate: string; email: string; job: string;
  photoUrl: string | null; status: string; issuedAt: string; salary: number | null; budget: number | null;
  approvalStatus: string | null; approvalDecidedAt: string | null; approver: string | null;
}

@Component({
  selector: 'app-offer-letters', standalone: true, imports: [CommonModule, FormsModule, RouterLink, AgGridAngular, PageHeaderComponent, SearchableSelectComponent, DatePresetFilterComponent, CandidatesComponent],
  templateUrl: './offer-letters.html', styleUrls: ['./offer-letters.css']
})
export class OfferLettersComponent {
  private http = inject(HttpClient);
  offers = signal<Offer[]>([]); loading = signal(true); error = signal(false);
  search = signal(''); status = signal('ALL'); budget = signal('ALL'); from = signal(''); to = signal('');
  /** Offer amount range in ₹ (12 Nov 2026). */
  minSalary = signal<number | null>(null);
  maxSalary = signal<number | null>(null);
  activeFilters = computed(() => !!(this.search().trim() || this.status() !== 'ALL' || this.budget() !== 'ALL' || this.from() || this.to()
    || this.minSalary() != null || this.maxSalary() != null));
  acceptedCount = computed(() => this.offers().filter(o => o.status === 'ACCEPTED').length);
  overBudgetCount = computed(() => this.offers().filter(o => o.budget !== null).length);
  failedPhotos = signal<Set<number>>(new Set());
  photoFailed(id: number) { this.failedPhotos.update(ids => new Set(ids).add(id)); }
  initials(name: string): string { return name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase(); }
  filtered = computed(() => this.offers().filter(o => {
    const q = this.search().trim().toLowerCase();
    const date = new Date(o.issuedAt);
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const over = o.budget !== null;
    return (!q || `${o.candidate} ${o.email} ${o.job}`.toLowerCase().includes(q)) &&
      (this.status() === 'ALL' || o.status === this.status()) &&
      (this.budget() === 'ALL' || (this.budget() === 'OVER' ? over : !over)) &&
      (!this.from() || day >= this.from()) && (!this.to() || day <= this.to()) &&
      (this.minSalary() == null || (o.salary ?? -1) >= this.minSalary()!) &&
      (this.maxSalary() == null || (o.salary != null && o.salary <= this.maxSalary()!));
  }));
  page = signal(1);
  pageSize = signal(10);
  totalPages = computed(() => Math.max(1, Math.ceil(this.filtered().length / this.pageSize())));
  pagedOffers = computed(() => this.filtered().slice((this.page() - 1) * this.pageSize(), this.page() * this.pageSize()));
  firstResult = computed(() => this.filtered().length ? (this.page() - 1) * this.pageSize() + 1 : 0);
  lastResult = computed(() => Math.min(this.page() * this.pageSize(), this.filtered().length));
  constructor() {
    effect(() => {
      this.search(); this.status(); this.budget(); this.from(); this.to(); this.pageSize();
      this.page.set(1);
    });
    effect(() => { if (this.page() > this.totalPages()) this.page.set(this.totalPages()); });
    this.load();
  }
  load() {
    this.loading.set(true); this.error.set(false);
    this.http.get<Offer[]>(`${environment.apiUrl}/recruitment/applications/offer-letters`).subscribe({
      next: rows => { this.offers.set(rows); this.loading.set(false); },
      error: () => { this.error.set(true); this.loading.set(false); }
    });
  }
  clear() { this.search.set(''); this.status.set('ALL'); this.budget.set('ALL'); this.from.set(''); this.to.set(''); this.datePreset.set('ALL'); this.minSalary.set(null); this.maxSalary.set(null); }

  // ── Standard page parts (12 Nov 2026) ─────────────────────────────────────
  private router = inject(Router);
  readonly statusOptions = [
    { id: 'SENT', name: 'Sent' }, { id: 'ACCEPTED', name: 'Accepted' },
    { id: 'DECLINED', name: 'Declined' }, { id: 'DRAFT', name: 'Draft' },
  ];
  readonly budgetOptions = [
    { id: 'OVER', name: 'Over-budget approval recorded' }, { id: 'OTHER', name: 'No approval recorded' },
  ];
  datePreset = signal<DatePreset>('ALL');
  onDateRange(r: DateRange) {
    const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    this.from.set(r ? ymd(r.from) : '');
    this.to.set(r ? ymd(r.to) : '');
  }
  setSalary(which: 'min' | 'max', v: any) {
    const n = v === '' || v == null ? null : Number(v);
    (which === 'min' ? this.minSalary : this.maxSalary).set(n == null || isNaN(n) ? null : n);
  }

  /** KPI cards filter the table: all, accepted, over-budget. */
  kpi = computed(() => this.status() === 'ACCEPTED' && this.budget() === 'ALL' ? 'ACCEPTED'
    : this.budget() === 'OVER' && this.status() === 'ALL' ? 'OVER'
    : !this.activeFilters() ? 'ALL' : '');
  pickKpi(k: 'ALL' | 'ACCEPTED' | 'OVER') {
    this.clear();
    if (k === 'ACCEPTED') this.status.set('ACCEPTED');
    if (k === 'OVER') this.budget.set('OVER');
  }

  /** Open the offer letter PDF (signed copy when there is one). */
  viewLetter(o: Offer) {
    const tab = window.open('', '_blank');
    this.http.get<any>(`${environment.apiUrl}/recruitment/applications/${o.applicationId}/offer-letter`).subscribe({
      next: (l) => {
        const url = l?.countersignedPdfUrl || l?.pdfUrl;
        if (url && tab) tab.location.href = url;
        else { tab?.close(); alert('No PDF has been generated for this offer letter yet.'); }
      },
      error: () => { tab?.close(); alert('Could not open the offer letter.'); },
    });
  }

  goToCandidates() { this.router.navigate(['/recruitment/candidates']); }

  /** Candidate drawer opened in place, like My Interviews. */
  drawerAppId = signal<number | null>(null);

  private esc(v: any): string {
    return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any)[c]);
  }
  readonly gridDefaultColDef: ColDef = { minWidth: 120, filter: true, sortable: true, resizable: true };
  readonly gridOptions = {
    headerHeight: 44,
    rowHeight: 68,
    onCellClicked: (e: any) => {
      if ((e.event?.target as HTMLElement)?.closest('[data-act="view"]')) { this.viewLetter(e.data); return; }
      if (e.data?.applicationId) this.drawerAppId.set(e.data.applicationId);
    },
  };
  readonly gridColumns: ColDef[] = [
    {
      headerName: 'Candidate', colId: 'candidate', minWidth: 240, flex: 1.5, field: 'candidate',
      cellRenderer: (p: any) => {
        const o: Offer = p.data;
        const initials = `<span class="g-avatar">${this.esc(this.initials(o.candidate || '?'))}</span>`;
        const face = o.photoUrl
          ? `<img class="g-avatar" src="${this.esc(o.photoUrl)}" alt="" style="object-fit:cover" onerror="this.style.display='none';this.nextElementSibling.style.display='inline-flex'">`
            + initials.replace('class="g-avatar"', 'class="g-avatar" style="display:none"')
          : initials;
        return `<div class="g-person">${face}<div class="g-two"><strong>${this.esc(o.candidate)}</strong><span>${this.esc(o.email)}</span></div></div>`;
      },
    },
    { headerName: 'Job', colId: 'job', field: 'job', minWidth: 140, maxWidth: 260, flex: 0.9, wrapText: true, autoHeight: true, cellClass: 'g-wrap' },
    {
      // Status and issue date together (12 Nov 2026).
      headerName: 'Status', colId: 'status', minWidth: 150, flex: 0.9, sort: 'desc', filter: 'agNumberColumnFilter',
      valueGetter: (p: any) => p.data?.issuedAt ? new Date(p.data.issuedAt).getTime() : 0,
      cellRenderer: (p: any) => {
        const st = String(p.data?.status || '').toLowerCase();
        const day = p.data?.issuedAt ? new Date(p.data.issuedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
        return `<div class="g-two"><span class="g-pill st-${st}"><i></i>${this.esc(st.charAt(0).toUpperCase() + st.slice(1))}</span><span>Issued ${day}</span></div>`;
      },
    },
    {
      headerName: 'Budget decision', colId: 'budget', minWidth: 170, flex: 1.3, wrapText: true, autoHeight: true, cellClass: 'g-wrap', sortable: false,
      valueGetter: (p: any) => p.data?.budget !== null ? 'Over-budget request' : 'No approval recorded',
      cellRenderer: (p: any) => {
        const o: Offer = p.data;
        if (o.budget === null) return '<span class="g-muted">No approval recorded</span>';
        const n = (v: number | null) => v == null ? '—' : Number(v).toLocaleString('en-IN');
        const decision = (o.approvalStatus || 'Decision unavailable').toLowerCase();
        return `<div class="g-two"><span class="g-pill st-over">Over-budget request</span>`
          + `<span>Budget ₹${n(o.budget)} · Offer ₹${n(o.salary)} · ${this.esc(decision)}${o.approver ? ' · ' + this.esc(o.approver) : ''}</span></div>`;
      },
    },
    {
      headerName: 'Letter', colId: 'view', minWidth: 90, maxWidth: 100, sortable: false, filter: false,
      cellRenderer: () => `<button type="button" class="g-icon-btn" data-act="view" title="View offer letter" aria-label="View offer letter">`
        + `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg></button>`,
    },
  ];
}
