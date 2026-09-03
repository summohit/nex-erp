import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { LucidePlus, LucideFileText, LucideCheck, LucideTrash2, LucideArrowRight, LucideX, LucideIndianRupee, LucideUpload } from '@lucide/angular';
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

interface QuotationAttachment {
  fileName: string;
  fileUrl: string;
  fileSize?: number;
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

const DEFAULT_TERMS = `1. Validity: This quotation is valid for the period stated above.
2. Payment Terms: 50% advance against Purchase Order and balance before dispatch / on delivery.
3. Taxes: Prices are exclusive of GST unless stated otherwise. GST will be charged at the applicable rate.
4. Delivery: Delivery/implementation timelines will be communicated upon order confirmation.
5. Warranty: Standard manufacturer warranty applies from the date of delivery.
6. Force Majeure: Neither party shall be liable for delays caused by events beyond reasonable control.
7. Acceptance: This proposal is subject to our standard terms of sale and acceptance of a Purchase Order.
8. Governing Law: This proposal shall be governed by the laws of India and subject to jurisdiction of the courts.`;

@Component({
  selector: 'app-quotations',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    LucidePlus, LucideFileText, LucideCheck, LucideTrash2, LucideArrowRight, LucideX, LucideIndianRupee,
    LucideUpload,
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

  readonly maxAttachments = 8;
  readonly maxAttachmentBytes = 20 * 1024 * 1024;
  uploadingCount = 0;

  newQuoteData: {
    clientId: number | null;
    leadId: number | null;
    date: string;
    validUntil: string;
    currency: string;
    taxRate: number;
    notes: string;
    terms: string;
    items: QuotationItem[];
    attachments: QuotationAttachment[];
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
      terms: DEFAULT_TERMS,
      items: [{ description: '', quantity: 1, unit: 'number', unitPrice: 0 }] as QuotationItem[],
      attachments: [] as QuotationAttachment[]
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

  /** Lowercased extension including the dot, e.g. ".pdf". */
  fileExtension(name: string): string {
    const i = (name || '').lastIndexOf('.');
    return i === -1 ? '' : name.slice(i).toLowerCase();
  }

  /** Only images get a thumbnail preview; everything else shows a typed badge. */
  isImageAttachment(fileName: string): boolean {
    return ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.heic']
      .includes(this.fileExtension(fileName).toLowerCase());
  }

  /** Short uppercase label for a non-image file, e.g. "PDF", "XLSX". */
  fileTypeLabel(fileName: string): string {
    return this.fileExtension(fileName).replace('.', '').toUpperCase() || 'FILE';
  }

  /** Groups extensions so the badge can be colour-coded by kind. */
  fileTypeClass(fileName: string): string {
    const ext = this.fileExtension(fileName);
    if (['.pdf'].includes(ext)) return 'file-pdf';
    if (['.doc', '.docx', '.odt', '.rtf'].includes(ext)) return 'file-doc';
    if (['.xls', '.xlsx', '.ods', '.csv'].includes(ext)) return 'file-sheet';
    if (['.ppt', '.pptx', '.odp'].includes(ext)) return 'file-slide';
    if (['.zip', '.rar', '.7z'].includes(ext)) return 'file-archive';
    return 'file-generic';
  }

  onAttachmentsSelected(event: any) {
    const files: File[] = Array.from(event?.target?.files || []);
    if (!files.length) return;
    this.uploadAttachmentFiles(files);
    if (event?.target) event.target.value = '';
  }

  removeAttachment(index: number) {
    if (this.uploadingCount > 0) return;
    this.newQuoteData.attachments.splice(index, 1);
  }

  private uploadAttachmentFiles(files: File[]) {
    const remaining = this.maxAttachments - this.newQuoteData.attachments.length - this.uploadingCount;
    if (remaining <= 0) {
      this.dialog.error(`You can attach at most ${this.maxAttachments} files.`);
      return;
    }
    const accepted = files.slice(0, remaining);
    if (files.length > remaining) {
      this.dialog.error(`Only ${remaining} more file${remaining === 1 ? '' : 's'} can be attached.`);
    }

    for (const file of accepted) {
      if (file.size > this.maxAttachmentBytes) {
        this.dialog.error(`"${file.name}" is larger than 20MB.`);
        continue;
      }
      this.uploadingCount++;
      const form = new FormData();
      form.append('file', file);
      this.http.post<{ url: string }>(`${environment.apiUrl}/upload`, form).subscribe({
        next: (res) => {
          this.newQuoteData.attachments = [
            ...this.newQuoteData.attachments,
            { fileName: file.name, fileUrl: res.url, fileSize: file.size },
          ];
          this.uploadingCount--;
        },
        error: () => {
          this.dialog.error(`Failed to upload "${file.name}".`);
          this.uploadingCount--;
        },
      });
    }
  }

  createQuotation() {
    this.isSubmitted = true;
    if (!this.newQuoteData.clientId || this.newQuoteData.items.length === 0) return;
    if (this.uploadingCount > 0) {
      this.dialog.error('Please wait for all attachments to finish uploading.');
      return;
    }

    this.isSaving = true;
    this.http.post(`${environment.apiUrl}/sales/quotations`, this.newQuoteData).subscribe({
      next: () => { this.isSaving = false; this.closeModal(); this.loadQuotations(); },
      error: (err) => { this.isSaving = false; this.dialog.error(err?.error?.message || 'Failed to save quotation'); }
    });
  }

  /** Mirrors the server's transition table so only valid moves are offered. */
  private readonly quoteStatusFlow: Record<string, string[]> = {
    DRAFT: ['SENT', 'REJECTED'],
    PENDING_APPROVAL: ['SENT', 'REJECTED'],
    SENT: ['ACCEPTED', 'REJECTED'],
    REJECTED: ['DRAFT'],
    ACCEPTED: [],
  };

  private readonly quoteEditable = ['DRAFT', 'PENDING_APPROVAL', 'SENT', 'REJECTED'];

  busyQuoteId: number | null = null;

  nextQuoteStatuses(q: any): string[] {
    return this.quoteStatusFlow[q?.status] ?? [];
  }

  canEditQuote(q: any): boolean {
    return this.quoteEditable.includes(q?.status);
  }

  canDeleteQuote(q: any): boolean {
    return q?.status !== 'ACCEPTED';
  }

  setQuoteStatus(q: any, status: string) {
    this.busyQuoteId = q.id;
    this.http.patch(`${environment.apiUrl}/sales/quotations/${q.id}/status`, { status })
      .subscribe({
        next: () => { this.busyQuoteId = null; this.loadQuotations(); },
        error: (err) => {
          this.busyQuoteId = null;
          this.dialog.error(err?.error?.message || 'Could not update the quotation.');
        },
      });
  }

  async deleteQuote(q: any) {
    const ok = await this.dialog.confirm(
      `Delete quotation ${q.quoteNumber}? This cannot be undone.`, 'Delete Quotation', 'Delete');
    if (!ok) return;

    this.busyQuoteId = q.id;
    this.http.delete(`${environment.apiUrl}/sales/quotations/${q.id}`).subscribe({
      next: () => { this.busyQuoteId = null; this.loadQuotations(); },
      error: (err) => {
        this.busyQuoteId = null;
        this.dialog.error(err?.error?.message || 'Could not delete the quotation.');
      },
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
