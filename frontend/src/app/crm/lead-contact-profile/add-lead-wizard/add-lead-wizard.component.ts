import { Component, EventEmitter, Input, OnInit, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import {
  LucideUser, LucideX, LucideCheckCircle, LucideSearch, LucideUsers,
  LucideChevronDown, LucideLoader2
} from '@lucide/angular';
import { environment } from '../../../../environments/environment';
import { DialogService } from '../../../shared/services/dialog.service';

@Component({
  selector: 'app-add-lead-wizard',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    LucideUser, LucideX, LucideCheckCircle, LucideSearch, LucideUsers,
    LucideChevronDown, LucideLoader2
  ],
  templateUrl: './add-lead-wizard.html',
  styleUrls: ['./add-lead-wizard.css']
})
export class AddLeadWizardComponent implements OnInit {
  private http = inject(HttpClient);
  private dialog = inject(DialogService);

  /** The lead contact this wizard is opened from. The new deal is linked to them. */
  @Input() contact: any = null;
  /** Everyone the profile already loaded, so the owner dropdown needs no extra request. */
  @Input() employees: any[] = [];

  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<any>();

  // Same pipeline stages and sources as the Leads board wizard.
  readonly LEAD_STATUSES = [
    'New', 'Interested', 'Proposal Sent', 'Schedule Meeting', 'Negotiation',
    'Win', 'On Hold', 'Lost'
  ];

  readonly LEAD_SOURCES = [
    'Google Search',
    'Website',
    'Social Media (LinkedIn, Facebook, Instagram)',
    'Client Reference',
    'Email Campaign',
    'Events',
    'Paid Ads',
    'Partner Reference',
    'Direct Approach',
    'Other'
  ];

  readonly DEAL_CATEGORIES = [
    { id: 'Implementation & Deployment', name: 'Implementation & Deployment', hint: 'Implementation and deployment services' },
    { id: 'Implementation & Migration', name: 'Implementation & Migration', hint: 'Implementation and migration projects' },
    { id: 'Products', name: 'Products', hint: 'Product sales' },
    { id: 'AMC (Annual Maintenance Contract)', name: 'AMC (Annual Maintenance Contract)', hint: 'Annual maintenance contracts' },
    { id: 'FMS (Resource Contract)', name: 'FMS (Resource Contract)', hint: 'Resource / facility management contracts' },
    { id: 'Rental', name: 'Rental', hint: 'Equipment or asset rentals' },
    { id: 'Corporate Training', name: 'Corporate Training', hint: 'Corporate training programs' },
    { id: 'POC', name: 'POC', hint: 'Proof of concept engagements' },
    { id: 'Other', name: 'Other', hint: 'Specify a custom category' }
  ];

  readonly phoneCountryCodes: { code: string; name: string }[] = [
    { code: '+91', name: 'India' },
    { code: '+1', name: 'United States / Canada' },
    { code: '+44', name: 'United Kingdom' },
    { code: '+971', name: 'UAE' },
    { code: '+966', name: 'Saudi Arabia' },
    { code: '+974', name: 'Qatar' },
    { code: '+965', name: 'Kuwait' },
    { code: '+968', name: 'Oman' },
    { code: '+973', name: 'Bahrain' },
    { code: '+962', name: 'Jordan' },
    { code: '+61', name: 'Australia' },
    { code: '+64', name: 'New Zealand' },
    { code: '+81', name: 'Japan' },
    { code: '+82', name: 'South Korea' },
    { code: '+86', name: 'China' },
    { code: '+852', name: 'Hong Kong' },
    { code: '+886', name: 'Taiwan' },
    { code: '+65', name: 'Singapore' },
    { code: '+60', name: 'Malaysia' },
    { code: '+66', name: 'Thailand' },
    { code: '+62', name: 'Indonesia' },
    { code: '+63', name: 'Philippines' },
    { code: '+84', name: 'Vietnam' },
    { code: '+855', name: 'Cambodia' },
    { code: '+95', name: 'Myanmar' },
    { code: '+880', name: 'Bangladesh' },
    { code: '+92', name: 'Pakistan' },
    { code: '+977', name: 'Nepal' },
    { code: '+975', name: 'Bhutan' },
    { code: '+960', name: 'Maldives' },
    { code: '+94', name: 'Sri Lanka' },
    { code: '+98', name: 'Iran' },
    { code: '+964', name: 'Iraq' },
    { code: '+972', name: 'Israel' },
    { code: '+7', name: 'Russia / Kazakhstan' },
    { code: '+380', name: 'Ukraine' },
    { code: '+90', name: 'Turkey' },
    { code: '+49', name: 'Germany' },
    { code: '+33', name: 'France' },
    { code: '+39', name: 'Italy' },
    { code: '+34', name: 'Spain' },
    { code: '+351', name: 'Portugal' },
    { code: '+31', name: 'Netherlands' },
    { code: '+32', name: 'Belgium' },
    { code: '+41', name: 'Switzerland' },
    { code: '+43', name: 'Austria' },
    { code: '+420', name: 'Czech Republic' },
    { code: '+48', name: 'Poland' },
    { code: '+46', name: 'Sweden' },
    { code: '+47', name: 'Norway' },
    { code: '+45', name: 'Denmark' },
    { code: '+358', name: 'Finland' },
    { code: '+353', name: 'Ireland' },
    { code: '+357', name: 'Cyprus' },
    { code: '+30', name: 'Greece' },
    { code: '+36', name: 'Hungary' },
    { code: '+40', name: 'Romania' },
    { code: '+20', name: 'Egypt' },
    { code: '+212', name: 'Morocco' },
    { code: '+27', name: 'South Africa' },
    { code: '+234', name: 'Nigeria' },
    { code: '+254', name: 'Kenya' },
    { code: '+251', name: 'Ethiopia' },
    { code: '+55', name: 'Brazil' },
    { code: '+54', name: 'Argentina' },
    { code: '+56', name: 'Chile' },
    { code: '+57', name: 'Colombia' },
    { code: '+52', name: 'Mexico' },
    { code: '+93', name: 'Afghanistan' },
  ];

  isSaving = false;
  isSubmitted = false;
  activeTab = 1;
customSource = '';
  customCategory = '';

  ownerSearchQuery = '';
  showOwnerDropdown = false;

  newLeadData: any = {};
  lockedFromContact = true;
  selectedContactCode: string | null = null;

  ngOnInit() {
    this.resetForm();
  }

  resetForm() {
    const c = this.contact;
    const contactSource = (c?.leadSource && this.LEAD_SOURCES.includes(c.leadSource)) ? c.leadSource : 'Google Search';
    this.isSaving = false;
    this.isSubmitted = false;
    this.activeTab = 1;
    this.customSource = '';
    this.customCategory = '';
    this.showOwnerDropdown = false;
    this.ownerSearchQuery = '';
    this.newLeadData = {
      title: '',
      subjectLine: '',
      dealCategory: 'Implementation & Deployment',
      companyName: c?.companyName || '',
      contactName: c?.name || '',
      email: c?.email || '',
      phone: '',
      phoneCode: '+91',
      website: c?.website || '',
      address: c?.address || '',
      value: 0,
      currency: 'INR',
      expectedCloseDate: '',
      status: 'New',
      source: contactSource,
      assignedToId: null as number | null,
      addedById: null as number | null,
      broughtByContactId: c?.id ?? null,
      description: '',
      qualificationReason: ''
    };
    // Re-split the contact's stored number into dial code + local part.
    this.applyPhone(c?.phone || c?.mobile || '');
    this.lockedFromContact = true;
    this.selectedContactCode = c?.contactCode || null;
  }

  getFilteredEmployees(): any[] {
    let reps = this.employees.filter((e: any) => {
      const dept = e.department?.name?.toLowerCase() || '';
      const role = e.user?.role?.toUpperCase() || '';
      return dept.includes('finance') || dept.includes('sales') || role === 'ADMIN' || role === 'SUPERADMIN';
    });

    if (this.ownerSearchQuery.trim()) {
      const q = this.ownerSearchQuery.toLowerCase();
      reps = reps.filter((e: any) =>
        `${e.firstName} ${e.lastName}`.toLowerCase().includes(q) ||
        e.designation?.name?.toLowerCase().includes(q) ||
        e.department?.name?.toLowerCase().includes(q)
      );
    }
    return reps;
  }

  getSelectedOwner(): any {
    if (!this.newLeadData.assignedToId) return null;
    return this.employees.find(e => e.id === this.newLeadData.assignedToId);
  }

  selectOwner(emp: any) {
    this.newLeadData.assignedToId = emp ? emp.id : null;
    this.showOwnerDropdown = false;
    this.ownerSearchQuery = '';
  }

  /**
   * Split an international number into dial code + local part, or keep it as a
   * bare number. Stored numbers like "+91 98765 43210" and "+919876543210" are
   * both understood.
   */
  applyPhone(phone: string) {
    const v = (phone || '').trim();
    if (!v) {
      this.newLeadData.phone = '';
      return;
    }
    const intl = /^\+([1-9][0-9]{0,3})[\s-]*(.*)$/.exec(v);
    if (intl) {
      const code = '+' + intl[1];
      if (this.phoneCountryCodes.some(c => c.code === code)) {
        this.newLeadData.phoneCode = code;
        this.newLeadData.phone = intl[2].trim();
        return;
      }
    }
    this.newLeadData.phone = v.replace(/^\+/, '');
  }

  /** The stored phone: dial code + local number, without doubling an embedded code. */
  buildPhone(): string {
    const code = this.newLeadData.phoneCode || '';
    const codeDigits = code.replace(/[^0-9]/g, '');
    const raw = (this.newLeadData.phone || '').trim().replace(/^\+/, '');
    if (!raw) return '';
    const digits = raw.replace(/[^0-9]/g, '');
    if (!codeDigits) return raw;
    if (digits.startsWith(codeDigits) && digits.length > codeDigits.length) {
      return `${code} ${raw.slice(codeDigits.length)}`;
    }
    return `${code} ${raw}`;
  }

  get phoneInvalid(): boolean {
    const raw = (this.newLeadData.phone || '').trim();
    if (!raw) return false;
    return !/^[0-9+\-()\s]+$/.test(raw) || raw.replace(/[^0-9]/g, '').length < 6;
  }

  get emailInvalid(): boolean {
    const e = (this.newLeadData.email || '').trim();
    if (!e) return false;
    return !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  }

  preventNegative(event: KeyboardEvent) {
    if (event.key === '-' || event.key === 'e' || event.key === 'E' || event.key === '+') {
      event.preventDefault();
    }
  }

  validateDealValue() {
    if (this.newLeadData.value !== undefined && this.newLeadData.value !== null) {
      if (this.newLeadData.value < 0) {
        this.newLeadData.value = 0;
      }
    }
  }

  close() {
    if (this.isSaving) return;
    this.closed.emit();
  }

  createLead() {
    this.isSubmitted = true;

    // Validation: Title is required on tab 1 (phone/email only need to be valid
    // when filled in — they are optional).
    const isTab1Valid = this.newLeadData.title.trim()
      && !this.phoneInvalid
      && !this.emailInvalid;

    if (!isTab1Valid) {
      this.activeTab = 1;
      return;
    }

    // Validation: Stage, Source, Lead Category, Deal Value, and Close Date are required on tab 2
    const isTab2Valid = this.newLeadData.status?.trim()
      && this.newLeadData.source?.trim()
      && this.newLeadData.dealCategory?.trim()
      && this.newLeadData.value !== null && this.newLeadData.value !== undefined && this.newLeadData.value > 0
      && this.newLeadData.expectedCloseDate;

    if (!isTab2Valid) {
      this.activeTab = 2;
      return;
    }

    this.isSaving = true;

    const payload: any = {
      ...this.newLeadData,
      phone: this.buildPhone(),
    };
    // phoneCode is a form-only helper — the backend stores the combined phone.
    delete payload.phoneCode;
    if (payload.value !== undefined && payload.value !== null) {
      payload.value = Math.max(0, Number(payload.value) || 0);
    }
    if (payload.source === 'Other' && this.customSource.trim()) {
      payload.source = this.customSource.trim();
    }
    if (payload.dealCategory === 'Other' && this.customCategory.trim()) {
      payload.dealCategory = this.customCategory.trim();
    }

    this.http.post<any>(`${environment.apiUrl}/crm/leads`, payload).subscribe({
      next: (created) => {
        this.isSaving = false;
        this.dialog.success('Lead created successfully');
        this.saved.emit(created);
      },
      error: (err) => {
        this.isSaving = false;
        this.dialog.error(err?.error?.message || 'Failed to save lead.');
      }
    });
  }
}