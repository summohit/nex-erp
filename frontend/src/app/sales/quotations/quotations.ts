import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { LucidePlus, LucideFileText, LucideCheck, LucideTrash2, LucideArrowRight, LucideX } from '@lucide/angular';

interface QuotationItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total?: number;
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
  approvedBy?: { firstName: string, lastName: string };
}

@Component({
  selector: 'app-quotations',
  standalone: true,
  imports: [CommonModule, FormsModule, LucidePlus, LucideFileText, LucideCheck, LucideTrash2, LucideArrowRight, LucideX],
  templateUrl: './quotations.html',
  styleUrls: ['./quotations.css']
})
export class QuotationsComponent implements OnInit {
  quotations: Quotation[] = [];
  clients: any[] = [];
  leads: any[] = [];

  showCreateModal = false;
  isSubmitted = false;

  newQuoteData = {
    clientId: null as number | null,
    leadId: null as number | null,
    date: new Date().toISOString().split('T')[0],
    validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    currency: 'USD',
    items: [{ description: '', quantity: 1, unitPrice: 0 }] as QuotationItem[]
  };

  constructor(private http: HttpClient) {}

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
    this.http.get<any[]>(`${environment.apiUrl}/clients`).subscribe(data => {
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
    this.newQuoteData = {
      clientId: null,
      leadId: null,
      date: new Date().toISOString().split('T')[0],
      validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      currency: 'USD',
      items: [{ description: '', quantity: 1, unitPrice: 0 }]
    };
  }

  closeModal() {
    this.showCreateModal = false;
    this.isSubmitted = false;
  }

  addItem() {
    this.newQuoteData.items.push({ description: '', quantity: 1, unitPrice: 0 });
  }

  removeItem(index: number) {
    if (this.newQuoteData.items.length > 1) {
      this.newQuoteData.items.splice(index, 1);
    }
  }

  calculateTotal() {
    let subtotal = 0;
    this.newQuoteData.items.forEach(item => {
      subtotal += (item.quantity * item.unitPrice);
    });
    const tax = subtotal * 0.10;
    return subtotal + tax;
  }

  createQuotation() {
    this.isSubmitted = true;
    if (!this.newQuoteData.clientId || this.newQuoteData.items.length === 0) {
      return;
    }

    this.http.post(`${environment.apiUrl}/sales/quotations`, this.newQuoteData).subscribe({
      next: () => {
        this.closeModal();
        this.loadQuotations();
      },
      error: (err) => {
        console.error('Failed to create quotation', err);
      }
    });
  }

  approveQuote(id: number) {
    this.http.put(`${environment.apiUrl}/sales/quotations/${id}/approve`, {}).subscribe(() => {
      this.loadQuotations();
    });
  }

  convertToOrder(id: number) {
    this.http.post(`${environment.apiUrl}/sales/quotations/${id}/convert`, {}).subscribe(() => {
      this.loadQuotations();
      alert('Quotation successfully converted to Sales Order!');
    }, error => {
      alert(error.error.message || 'Failed to convert quote');
    });
  }
}
