import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { LucidePlus, LucideFileText, LucideCheck, LucideTrash2, LucideArrowRight, LucideX, LucideIndianRupee } from '@lucide/angular';
import { ClientsService } from '../../services/clients';
import { SearchableSelectComponent } from '../../shared/components/searchable-select/searchable-select.component';
import { DialogHostComponent } from '../../shared/components/dialog-host/dialog-host.component';
import { DialogService } from '../../shared/services/dialog.service';

interface QuotationItem {
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
}

interface Quotation {
  id: number;
  quoteNumber: string;
  client: { name: string };
  date: string;
  total: number;
  currency: string;
  status: string;
  approvalStatus: string;
}

@Component({
  selector: 'app-quotations',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    LucidePlus, LucideFileText, LucideCheck, LucideTrash2, LucideArrowRight, LucideX, LucideIndianRupee,
    SearchableSelectComponent, DialogHostComponent
  ],
  templateUrl: './quotations.html',
  styleUrls: ['./quotations.css']
})
export class QuotationsComponent implements OnInit {
  private clientsService = inject(ClientsService);
  private dialog = inject(DialogService);
  constructor(private http: HttpClient) {}

  quotations: Quotation[] = [];
  clients: any[] = [];
  leads: any[] = [];
  showCreateModal = false;
  isSubmitted = false;
  isSaving = false;

  readonly unitOptions = ['number', 'piece', 'hour', 'day', 'kg', 'litre', 'meter', 'roll', 'box', 'bundle'];
  readonly taxOptions = [0, 5, 12, 18, 28];

  newQuoteData: {
    clientId: number | null;
    leadId: number | null;
    date: string;
    validUntil: string;
    currency: string;
    taxRate: number;
    notes: string;
    items: QuotationItem[];
  } = this.freshForm();

  private freshForm() {
    return {
      clientId: null as number | null,
      leadId: null as number | null,
      date: new Date().toISOString().split('T')[0],
      validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      currency: 'INR',
      taxRate: 18,
      notes: '',
      items: [{ description: '', quantity: 1, unit: 'number', unitPrice: 0 }] as QuotationItem[]
    };
  }

  ngOnInit() {
    this.loadQuotations();
    this.loadClients();
    this.loadLeads();
  }

  loadQuotations() {
    this.http.get<Quotation[]>(`${environment.apiUrl}/sales/quotations`).subscribe(data => {
      this.quotations = data;
    });
  }

  loadClients() {
    this.clientsService.getClients('ACTIVE').subscribe((data: any[]) => {
      this.clients = data;
    });
  }

  loadLeads() {
    this.http.get<any[]>(`${environment.apiUrl}/crm/leads`).subscribe(data => {
      this.leads = data;
    });
  }

  openModal() {
    this.showCreateModal = true;
    this.isSubmitted = false;
    this.newQuoteData = this.freshForm();
  }

  closeModal() {
    this.showCreateModal = false;
    this.isSubmitted = false;
  }

  addItem() {
    this.newQuoteData.items.push({ description: '', quantity: 1, unit: 'number', unitPrice: 0 });
  }

  removeItem(index: number) {
    if (this.newQuoteData.items.length > 1) {
      this.newQuoteData.items.splice(index, 1);
    }
  }

  getSubtotal() {
    return this.newQuoteData.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  }

  getTax() {
    return this.getSubtotal() * (this.newQuoteData.taxRate / 100);
  }

  getTotal() {
    return this.getSubtotal() + this.getTax();
  }

  currencySymbol() {
    const map: Record<string, string> = { INR: '₹', USD: '$', EUR: '€', GBP: '£' };
    return map[this.newQuoteData.currency] || '₹';
  }

  createQuotation() {
    this.isSubmitted = true;
    if (!this.newQuoteData.clientId || this.newQuoteData.items.length === 0) return;

    this.isSaving = true;
    this.http.post(`${environment.apiUrl}/sales/quotations`, this.newQuoteData).subscribe({
      next: () => { this.isSaving = false; this.closeModal(); this.loadQuotations(); },
      error: (err) => { this.isSaving = false; this.dialog.error(err?.error?.message || 'Failed to save quotation'); }
    });
  }

  approveQuote(id: number) {
    this.http.put(`${environment.apiUrl}/sales/quotations/${id}/approve`, {}).subscribe(() => this.loadQuotations());
  }

  async convertToOrder(id: number) {
    const ok = await this.dialog.confirm('Convert this quotation into a confirmed sales order?', 'Convert to Order', 'Convert');
    if (!ok) return;

    this.http.post(`${environment.apiUrl}/sales/quotations/${id}/convert`, {}).subscribe({
      next: () => { this.loadQuotations(); this.dialog.success('Quotation converted to a sales order.'); },
      error: (err) => this.dialog.error(err?.error?.message || 'Failed to convert')
    });
  }
}
