import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { HotToastService } from '@ngneat/hot-toast';
import { environment } from '../../../environments/environment';
import {
  LucidePlus, LucideChevronLeft, LucideEdit2, LucideCopy, LucideCopyPlus,
  LucideLink2, LucideTrash2, LucideGripVertical, LucideSave, LucideRotateCcw,
  LucideExternalLink, LucideFileText,
  LucideEye, LucideEyeOff, LucideSearch
} from '@lucide/angular';

interface BuilderField {
  fieldKey: string;
  label: string;
  type: string;
  enabled: boolean;
  required: boolean;
  isName?: boolean;
  options?: string[];
}

const DEFAULT_FIELDS: BuilderField[] = [
  { fieldKey: 'name', label: 'Name', type: 'text', enabled: true, required: true, isName: true },
  { fieldKey: 'email', label: 'Email', type: 'email', enabled: true, required: false },
  { fieldKey: 'companyName', label: 'Company Name', type: 'text', enabled: true, required: false },
  { fieldKey: 'website', label: 'Website', type: 'url', enabled: true, required: false },
  { fieldKey: 'address', label: 'Address', type: 'textarea', enabled: true, required: false },
  { fieldKey: 'mobile', label: 'Mobile', type: 'tel', enabled: true, required: false },
  { fieldKey: 'message', label: 'Message', type: 'textarea', enabled: true, required: false },
  { fieldKey: 'city', label: 'City', type: 'text', enabled: true, required: false },
  { fieldKey: 'state', label: 'State', type: 'text', enabled: true, required: false },
  { fieldKey: 'country', label: 'Country', type: 'select', enabled: true, required: false },
  { fieldKey: 'postalCode', label: 'Postal Code', type: 'text', enabled: true, required: false },
  { fieldKey: 'source', label: 'Source', type: 'select', enabled: true, required: false },
  { fieldKey: 'product', label: 'Product', type: 'select', enabled: true, required: false },
];

const BASE_OPTIONS: Record<string, string[]> = {
  country: ['India', 'United Arab Emirates', 'United States', 'United Kingdom', 'Saudi Arabia', 'Qatar', 'Kuwait', 'Oman', 'Bahrain', 'Singapore', 'Australia', 'Canada', 'Germany', 'Other'],
  source: ['Website / Inbound', 'Referral', 'Social Media', 'Cold Outreach', 'Email Campaign', 'Event / Trade Show', 'Partner / Reseller', 'Paid Ads', 'Direct / Walk-In', 'Other'],
};

@Component({
  selector: 'app-lead-forms',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterModule, DragDropModule,
    LucidePlus, LucideChevronLeft, LucideEdit2, LucideCopy, LucideCopyPlus,
    LucideLink2, LucideTrash2, LucideGripVertical, LucideSave, LucideRotateCcw,
    LucideExternalLink, LucideFileText,
    LucideEye, LucideEyeOff, LucideSearch
  ],
  templateUrl: './lead-forms.html',
  styleUrls: ['./lead-forms.css']
})
export class LeadFormsComponent implements OnInit {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private toast = inject(HotToastService);

  mode: 'list' | 'builder' = 'list';

  // list state
  forms: any[] = [];
  formsLoading = false;
  formSearch = '';

  // builder state
  formId: number | null = null;
  formKey: string = '';
  isNew = false;
  saving = false;
  loadingForm = false;
  dirty = false;

  formName = '';
  formDescription = '';
  formSource = 'Lead Form';
  formSuccessMessage = 'Thank you! Your enquiry has been received.';
  formRedirectUrl = '';
  captchaEnabled = false;
  productOptionsText = '';
  fields: BuilderField[] = [];

  // snapshot for reset
  private savedSnapshot: any = null;

  get filteredForms(): any[] {
    const q = (this.formSearch || '').trim().toLowerCase();
    if (!q) return this.forms;
    return this.forms.filter((f: any) =>
      (f.name || '').toLowerCase().includes(q) ||
      (f.source || '').toLowerCase().includes(q)
    );
  }

  get enabledFields(): BuilderField[] {
    return this.fields.filter((f) => f.enabled);
  }

  get productOptions(): string[] {
    return this.productOptionsText.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);
  }

  get siteUrl(): string {
    return window.location.origin;
  }

  get productFieldEnabled(): boolean {
    return this.fields.some((f) => f.fieldKey === 'product' && f.enabled);
  }

  get publicUrl(): string {
    return this.formKey ? `${this.siteUrl}/lead-form/${this.formKey}` : '';
  }

  get embedCode(): string {
    return `<iframe src="${this.publicUrl}" frameborder="0" scrolling="yes" style="display:block; width:100%; height:60vh;"></iframe>`;
  }

  ngOnInit() {
    this.route.paramMap.subscribe((params) => {
      const id = params.get('id');
      if (id) {
        this.mode = 'builder';
        if (id === 'new') this.initNewForm();
        else this.loadForm(+id);
      } else {
        this.mode = 'list';
        this.loadForms();
      }
    });
  }

  // ───────────── LIST ─────────────
  loadForms() {
    this.formsLoading = true;
    this.http.get<any[]>(`${environment.apiUrl}/crm/lead-forms`).subscribe({
      next: (data) => { this.forms = data || []; this.formsLoading = false; },
      error: () => { this.formsLoading = false; this.toast.error('Failed to load lead forms.'); }
    });
  }

  goToList() {
    this.router.navigate(['/crm/lead-forms']);
  }

  newForm() {
    this.router.navigate(['/crm/lead-forms/new']);
  }

  editForm(id: number) {
    this.router.navigate(['/crm/lead-forms', id]);
  }

  async duplicateForm(form: any) {
    this.http.post<any>(`${environment.apiUrl}/crm/lead-forms/${form.id}/duplicate`, {}).subscribe({
      next: (clone) => {
        this.toast.success('Form duplicated.');
        this.loadForms();
      },
      error: () => this.toast.error('Failed to duplicate form.')
    });
  }

  toggleStatus(form: any) {
    const next = form.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    this.http.patch<any>(`${environment.apiUrl}/crm/lead-forms/${form.id}/status`, { status: next }).subscribe({
      next: (updated) => {
        form.status = updated.status;
        this.toast.success(`Form ${next === 'ACTIVE' ? 'activated' : 'deactivated'}.`);
      },
      error: () => this.toast.error('Failed to update form status.')
    });
  }

  async deleteForm(form: any) {
    if (!window.confirm(`Delete "${form.name}"? This cannot be undone.`)) return;
    this.http.delete(`${environment.apiUrl}/crm/lead-forms/${form.id}`).subscribe({
      next: () => { this.toast.success('Form deleted.'); this.loadForms(); },
      error: () => this.toast.error('Failed to delete form.')
    });
  }

  statusClass(status: string): string {
    return status === 'ACTIVE' ? 'lf-status-active' : 'lf-status-inactive';
  }

  copyText(text: string, message: string) {
    navigator.clipboard?.writeText(text).then(
      () => this.toast.success(message),
      () => this.toast.error('Failed to copy.')
    );
  }

  // ───────────── BUILDER ─────────────
  initNewForm() {
    this.isNew = true;
    this.formId = null;
    this.formKey = '';
    this.formName = '';
    this.formDescription = '';
    this.formSource = 'Lead Form';
    this.formSuccessMessage = 'Thank you! Your enquiry has been received.';
    this.formRedirectUrl = '';
    this.captchaEnabled = false;
    this.productOptionsText = '';
    this.fields = DEFAULT_FIELDS.map((f) => ({ ...f, options: f.type === 'select' ? [...(BASE_OPTIONS[f.fieldKey] || ['Option']) ] : undefined }));
    this.dirty = false;
    this.savedSnapshot = null;
    this.loadingForm = false;
  }

  loadForm(id: number) {
    this.loadingForm = true;
    this.http.get<any>(`${environment.apiUrl}/crm/lead-forms/${id}`).subscribe({
      next: (form) => {
        this.isNew = false;
        this.formId = form.id;
        this.formKey = form.formKey || '';
        this.formName = form.name || '';
        this.formDescription = form.description || '';
        this.formSource = form.source || 'Lead Form';
        this.formSuccessMessage = form.successMessage || 'Thank you! Your enquiry has been received.';
        this.formRedirectUrl = form.redirectUrl || '';
        this.captchaEnabled = !!form.captchaEnabled;
        const productOptions = Array.isArray(form.productOptions) ? form.productOptions : [];
        this.productOptionsText = productOptions.join(', ');
        this.fields = (form.fields || []).map((f: any) => ({
          fieldKey: f.fieldKey,
          label: f.label,
          type: f.type,
          enabled: f.enabled !== false,
          required: !!f.required,
          isName: !!f.isName,
          options: f.type === 'select' ? this.optionsFor(f.fieldKey, f.options) : undefined
        }));
        this.savedSnapshot = this.snapshot();
        this.dirty = false;
        this.loadingForm = false;
      },
      error: () => {
        this.loadingForm = false;
        this.toast.error('Failed to load lead form.');
        this.goToList();
      }
    });
  }

  private optionsFor(fieldKey: string, stored: any): string[] {
    if (Array.isArray(stored) && stored.length) return stored;
    if (fieldKey === 'product' && this.productOptions.length) return this.productOptions;
    return BASE_OPTIONS[fieldKey] || ['Option'];
  }

  onFieldListDrop(event: CdkDragDrop<BuilderField[]>) {
    moveItemInArray(this.fields, event.previousIndex, event.currentIndex);
    this.markDirty();
  }

  toggleFieldEnabled(field: BuilderField) {
    field.enabled = !field.enabled;
    this.markDirty();
  }

  toggleRequired(field: BuilderField) {
    field.required = !field.required;
    this.markDirty();
  }

  markDirty() {
    this.dirty = true;
  }

  private snapshot(): any {
    return JSON.stringify({
      name: this.formName,
      description: this.formDescription,
      source: this.formSource,
      successMessage: this.formSuccessMessage,
      redirectUrl: this.formRedirectUrl,
      captchaEnabled: this.captchaEnabled,
      productOptionsText: this.productOptionsText,
      fields: this.fields,
    });
  }

  reset() {
    if (this.savedSnapshot) {
      const snap = JSON.parse(this.savedSnapshot);
      this.formName = snap.name || '';
      this.formDescription = snap.description || '';
      this.formSource = snap.source || 'Lead Form';
      this.formSuccessMessage = snap.successMessage || 'Thank you! Your enquiry has been received.';
      this.formRedirectUrl = snap.redirectUrl || '';
      this.captchaEnabled = !!snap.captchaEnabled;
      this.productOptionsText = snap.productOptionsText || '';
      this.fields = snap.fields || [];
    } else {
      this.initNewForm();
    }
    this.dirty = false;
    this.toast.info('Reset to last saved state.');
  }

  backToList() {
    this.goToList();
  }

  save() {
    if (!this.formName.trim()) {
      this.toast.error('Form name is required.');
      return;
    }
    if (!this.fields.some((f) => f.enabled)) {
      this.toast.error('At least one field must be enabled.');
      return;
    }
    this.saving = true;
    const payload: any = {
      name: this.formName.trim(),
      description: this.formDescription,
      source: this.formSource || 'Lead Form',
      successMessage: this.formSuccessMessage || 'Thank you! Your enquiry has been received.',
      redirectUrl: this.formRedirectUrl || null,
      captchaEnabled: this.captchaEnabled,
      productOptions: this.productOptions,
      fields: this.fields.map((f, i) => ({
        fieldKey: f.fieldKey,
        label: f.label,
        type: f.type,
        enabled: f.enabled,
        required: f.required,
        isName: f.isName,
        sortOrder: i,
        options: f.type === 'select' ? (f.options || []) : undefined
      }))
    };

    const req = this.isNew
      ? this.http.post<any>(`${environment.apiUrl}/crm/lead-forms`, payload)
      : this.http.put<any>(`${environment.apiUrl}/crm/lead-forms/${this.formId}`, payload);

    req.subscribe({
      next: (saved) => {
        this.saving = false;
        this.isNew = false;
        this.formId = saved.id;
        this.formKey = saved.formKey || '';
        this.dirty = false;
        this.savedSnapshot = this.snapshot();
        this.toast.success('Lead form saved.');
        this.router.navigate(['/crm/lead-forms', saved.id], { replaceUrl: true });
      },
      error: (err) => {
        this.saving = false;
        this.toast.error(err?.error?.message || 'Failed to save lead form.');
      }
    });
  }

  fieldPlaceholder(field: BuilderField): string {
    switch (field.fieldKey) {
      case 'name': return 'Your full name';
      case 'email': return 'you@company.com';
      case 'companyName': return 'Company name';
      case 'website': return 'https://example.com';
      case 'mobile': return 'Phone number';
      case 'message': return 'Write your message...';
      case 'city': return 'City';
      case 'state': return 'State';
      case 'postalCode': return 'Postal code';
      case 'address': return 'Street address';
      default: return '';
    }
  }

  fieldTypeLabel(type: string): string {
    const map: any = {
      text: 'Text', email: 'Email', tel: 'Phone', url: 'URL',
      textarea: 'Text area', select: 'Dropdown'
    };
    return map[type] || type;
  }

  selectOptions(field: BuilderField): string[] {
    if (field.fieldKey === 'product' && this.productOptions.length) return this.productOptions;
    return (field.options && field.options.length) ? field.options : ['Option'];
  }

  enabledFieldCount(form: any): number {
    return (Array.isArray(form?.fields) ? form.fields : []).filter((f: any) => f.enabled).length;
  }
}
