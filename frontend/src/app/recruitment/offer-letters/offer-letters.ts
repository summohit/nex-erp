import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';

interface Offer {
  id: number; applicationId: number; candidate: string; email: string; job: string;
  photoUrl: string | null; status: string; issuedAt: string; salary: number | null; budget: number | null;
  approvalStatus: string | null; approvalDecidedAt: string | null; approver: string | null;
}

@Component({
  selector: 'app-offer-letters', standalone: true, imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './offer-letters.html', styleUrls: ['./offer-letters.css']
})
export class OfferLettersComponent {
  private http = inject(HttpClient);
  offers = signal<Offer[]>([]); loading = signal(true); error = signal(false);
  search = signal(''); status = signal('ALL'); budget = signal('ALL'); from = signal(''); to = signal('');
  activeFilters = computed(() => !!(this.search().trim() || this.status() !== 'ALL' || this.budget() !== 'ALL' || this.from() || this.to()));
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
      (!this.from() || day >= this.from()) && (!this.to() || day <= this.to());
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
  clear() { this.search.set(''); this.status.set('ALL'); this.budget.set('ALL'); this.from.set(''); this.to.set(''); }
}
