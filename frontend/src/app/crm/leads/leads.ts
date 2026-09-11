import { Component, OnInit, HostListener } from '@angular/core';
import { Router } from '@angular/router';

import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { CdkDragDrop, DragDropModule, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import { SkeletonComponent } from '../../shared/components/skeleton/skeleton.component';
import { AuthService } from '../../services/auth.service';
import { HotToastService } from '@ngneat/hot-toast';
import {
  LucidePlus,
  LucideGripVertical,
  LucideBuilding,
  LucidePhone,
  LucideMail,
  LucideCheckCircle,
  LucideX,
  LucideLoader2,
  LucideSearch,
  LucideUser,
  LucideTrash2,
  LucideFilter,
  LucideEye,
  LucideCalendar,
  LucideFileText,
  LucideEdit2,
  LucideMoreVertical,
  LucideMapPin,
  LucideChevronDown,
  LucideChevronUp, LucideLayoutGrid, LucideList,
  LucideGlobe, LucideTag, LucideUserCheck,
  LucideClock, LucideCalendarClock, LucideVideo, LucideCheck, LucideHistory,
  LucideUsers, LucideAward, LucideExternalLink,
  LucideTrendingUp, LucideLayers, LucideBuilding2, LucideGhost,
  LucideRotateCcw, LucideSlidersHorizontal, LucideIndianRupee, LucideArrowUpDown, LucideSparkles,
  LucideUpload, LucideDownload, LucideCalendarRange, LucideFolder, LucideChevronRight, LucideBriefcase
} from '@lucide/angular';

export interface FollowUp {
  id: number;
  leadId: number;
  title: string;
  contactPerson?: string;
  contactPhone?: string;
  contactEmail?: string;
  type: 'CALL' | 'MEETING' | 'DEMO' | 'EMAIL' | 'FIELD_VISIT' | 'NOTE' | 'OTHER';
  scheduledAt: string;
  notes?: string;
  status?: string;
  assignedToId?: number;
  assignedTo?: { id: number, firstName: string, lastName: string, avatarUrl?: string, designation?: { name: string } };
  createdAt: string;
  files?: { id: number; fileName: string; fileUrl: string; fileType?: string; createdAt: string }[];
}

interface Lead {
  id: number;
  /** Human-readable reference, e.g. L0926-001. Null for rows predating codes. */
  leadCode?: string | null;
  title: string;
  subjectLine?: string;
  dealCategory?: string;
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  value: number;
  currency: string;
  status: string;
  source?: string;
  website?: string;
  address?: string;
  expectedCloseDate?: string;
  assignedTo?: { id: number, firstName: string, lastName: string, avatarUrl?: string, designation?: { name: string }, department?: { name: string } };
  addedBy?: { id: number, firstName: string, lastName: string, avatarUrl?: string, designation?: { name: string }, department?: { name: string } };
  broughtByContact?: { id: number, name: string, companyName?: string };
  description?: string;
  qualificationReason?: string;
  proposalDate?: string;
  createdAt: string;
  followUps?: FollowUp[];
  quotations?: { id: number }[];
}

@Component({
  selector: 'app-leads',
  standalone: true,
  imports: [
    SkeletonComponent,
    CommonModule, 
    FormsModule, 
    DragDropModule, 
    LucidePlus, 
    LucideGripVertical, 
    LucideBuilding, 
    LucidePhone,
    LucideMail,
    LucideCheckCircle,
    LucideX, 
    LucideLoader2,
    LucideSearch,
    LucideUser,
    LucideTrash2,
    LucideFilter,
    LucideEye,
    LucideCalendar,
    LucideFileText,
    LucideEdit2,
  LucideMoreVertical,
    LucideMapPin,
    LucideChevronDown,
    LucideChevronUp, LucideLayoutGrid, LucideList,
    LucideGlobe, LucideTag, LucideUserCheck,
    LucideClock, LucideCalendarClock, LucideVideo, LucideCheck, LucideHistory,
    LucideUsers, LucideAward, LucideExternalLink,
    LucideTrendingUp, LucideLayers, LucideBuilding2, LucideGhost,
    LucideRotateCcw, LucideSlidersHorizontal, LucideIndianRupee, LucideArrowUpDown, LucideSparkles,
    LucideUpload, LucideDownload,
    LucideBriefcase, LucideCalendarRange, LucideChevronRight,
  ],
  templateUrl: './leads.html',
  styleUrls: ['./leads.css']
})
export class LeadsComponent implements OnInit {
  leads: Lead[] = [];
  isLoading = true;
  isSaving = false;
  isSubmitted = false;
  saveContactFromLead: boolean | null = null;
  showCreateModal = false;
  showDetailModal = false;
  selectedLead: Lead | null = null;
  
  // Filter states
  searchQuery = '';
  selectedStages: string[] = []; // empty = all stages
  showStageDropdown = false;
  stageSearchQuery = '';
  
  selectedRepId: number | 'ALL' | 'UNASSIGNED' = 'ALL';
  showRepDropdown = false;
  repSearchQuery = '';

  selectedCategory = 'ALL';
  showCategoryDropdown = false;
  categorySearchQuery = '';

  selectedSource = 'ALL';
  showSourceDropdown = false;
  sourceSearchQuery = '';

  selectedContactId: number | 'ALL' = 'ALL';
  showContactDropdown = false;
  contactFilterSearchQuery = '';

  selectedAddedById: number | 'ALL' = 'ALL';
  showAddedByDropdown = false;
  addedByFilterSearchQuery = '';

  selectedQuotationStatus: 'ALL' | 'QUOTED' | 'NOT_QUOTED' = 'ALL';
  selectedFollowUpStatus: 'ALL' | 'OVERDUE' | 'SCHEDULED' | 'NONE' = 'ALL';

  // Quick "My Leads" toggle in the filter bar (admin/superadmin only).
  // Admins normally see every lead; turning this on narrows the board to
  // leads the current user owns or created.
  myLeadsOnly = false;

  // NOTE: the "Category" filter that used these was removed. It compared service
  // names against Lead.dealCategory, which only ever holds a DEAL_CATEGORIES
  // value (Inbound/Outbound/...), so it could never match a row. Restoring it
  // needs a real serviceCategory field on Lead plus a control on the lead form.

  minValue: number | null = null;
  maxValue: number | null = null;
  dateField: 'createdAt' | 'expectedCloseDate' | 'nextFollowUp' = 'createdAt';
  datePreset: 'ALL' | 'TODAY' | 'THIS_WEEK' | 'THIS_MONTH' | 'NEXT_MONTH' | 'THIS_QUARTER' | 'THIS_YEAR' | 'CUSTOM' = 'ALL';
  dateStart = '';
  dateEnd = '';
  sortBy: 'newest' | 'oldest' | 'value_desc' | 'value_asc' | 'closing_soon' = 'newest';
  showAdvancedFilters = false;

  ownerSearchQuery = '';
  showOwnerDropdown = false;
  broughtBySearchQuery = '';
  showBroughtByDropdown = false;
  leadContactSearchQuery = '';
  showLeadContactDropdown = false;

  // Fixed-position coords for searchable filter dropdowns (so they are not
  // clipped by the modal's scrollable grid when rendered as a right-side drawer)
  fDropdownPos: { left: number; top: number; maxHeight: number } | null = null;


  // Pipeline order, left to right on the Kanban board. Two deliberate choices
  // here: Proposal Sent comes BEFORE Schedule Meeting, and Win comes BEFORE
  // On Hold — both per the pipeline spec, not the usual funnel intuition.
  LEAD_STATUSES = [
    'New', 'Interested', 'Proposal Sent', 'Schedule Meeting', 'Negotiation',
    'Win', 'On Hold', 'Lost'
  ];

  // Standard Lead Sources
  LEAD_SOURCES = [
    'Website / Inbound',
    'Referral',
    'Social Media',
    'Cold Outreach',
    'Email Campaign',
    'Event / Trade Show',
    'Partner / Reseller',
    'Paid Ads',
    'Direct / Walk-In',
    'Other'
  ];
  customSource = '';

  // Deal Categories with strategy hints
  DEAL_CATEGORIES = [
    { id: 'Inbound', name: 'Inbound', hint: 'The buyer comes directly to you (Organic marketing, SEO, website, content, social media, contact form)' },
    { id: 'Outbound', name: 'Outbound', hint: 'Your team initiates first contact (Cold emailing, direct messaging, cold calling, SDR prospecting)' },
    { id: 'Referral', name: 'Referral', hint: 'Introduced by a third party (Existing clients, business partners, affiliates, network connections)' },
    { id: 'Enterprise', name: 'Enterprise', hint: 'Large corporate or high-value clients with custom pricing and proposals' },
    { id: 'Retainer', name: 'Retainer', hint: 'Ongoing monthly or quarterly recurring service contracts' }
  ];
  
  viewMode: 'kanban' | 'table' = 'kanban';

  kanbanColumns: { id: string, name: string, leads: Lead[] }[] = this.LEAD_STATUSES.map(status => ({
    id: status,
    name: status,
    leads: []
  }));
  highlightedLeadId: number | null = null;

  // Lead Form
  isEditing = false;
  editingLeadId: number | null = null;
  activeTab = 1;
  employees: any[] = [];

  // Country dialing codes for the "Phone Number" field. The default matches the
  // system's home market; users can switch it per lead.
  phoneCountryCodes: { code: string; name: string }[] = [
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

  newLeadData = {
    leadCode: '',
    title: '',
    subjectLine: '',
    dealCategory: 'Inbound',
    companyName: '',
    contactName: '',
    email: '',
    phone: '',
    phoneCode: '+91',
    website: '',
    address: '',
    value: 0,
    currency: 'INR',
    expectedCloseDate: '',
    status: 'New',
    source: '',
    assignedToId: null as number | null,
    addedById: null as number | null,
    broughtByContactId: null as number | null,
    description: '',
    qualificationReason: ''
  };

  // Main board tabs: pipeline leads vs. external lead-contact directory
  activeMainTab: 'leads' | 'contacts' = 'leads';

  // Lead Contacts (external brokers/partners selectable as "Lead Brought By")
  leadContacts: any[] = [];
  contactSearchQuery = '';
  showLeadContactModal = false;
  isSavingLeadContact = false;
  isEditingLeadContact = false;
  editingLeadContactId: number | null = null;
  contactAddedBySearchQuery = '';
  showContactAddedByDropdown = false;

  leadContactForm = {
    salutation: '',
    name: '',
    email: '',
    phone: '',
    leadSource: '',
    companyName: '',
    website: '',
    mobile: '',
    officePhoneNumber: '',
    country: '',
    state: '',
    city: '',
    postalCode: '',
    address: '',
    addedById: null as number | null
  };

  // Follow Up Management
  showFollowUpModal = false;
  leadFollowUps: FollowUp[] = [];
  isLoadingFollowUps = false;
  isSavingFollowUp = false;
  followUpTab: 'schedule' | 'history' = 'schedule';
  followUpStageMenuOpen = false;
  pendingFollowUpFiles: File[] = [];
  isUploadingFollowUpFiles = false;

  // A Win transition is deliberately paused until a purchase order is attached.
  showPurchaseOrderModal = false;
  pendingWinLead: Lead | null = null;
  purchaseOrderFile: File | null = null;
  isUploadingPurchaseOrder = false;

  // Expandable follow-ups inside the leads table
  expandedLeadId: number | null = null;
  leadFollowUpsCache: Record<number, FollowUp[]> = {};
  leadFollowUpsLoading: Record<number, boolean> = {};
  followUpStatusSaving: Record<number, boolean> = {};
  followUpTableStageMenu: number | null = null;
  leadFollowUpsExpandedIds: number[] = [];

  // Follow-up date filter (filters follow-ups shown inside expanded rows)
  followUpDateFilter = 'all'; // all | today | thisWeek | thisMonth | lastMonth | last30 | last90 | thisYear | lastYear | custom
  followUpStartDate = '';
  followUpEndDate = '';

  newFollowUp = {
    title: '',
    contactPerson: '',
    contactPhone: '',
    contactEmail: '',
    type: 'CALL' as 'CALL' | 'MEETING' | 'DEMO' | 'EMAIL' | 'FIELD_VISIT' | 'NOTE' | 'OTHER',
    scheduledAt: '',
    notes: '',
    stage: ''
  };

  // Field Visits

  constructor(private http: HttpClient, private router: Router, public auth: AuthService, private toast: HotToastService) {}

  ngOnInit() {
    if (this.router.url.startsWith('/crm/lead-contacts')) {
      this.activeMainTab = 'contacts';
    }
    this.loadLeads();
    this.loadEmployees();
    this.loadLeadContacts();
  }

  goToLeadsDashboard() {
    this.router.navigate(['/crm/leads/dashboard']);
  }

  openLeadProfile(leadId: number) {
    this.router.navigate(['/crm/leads', leadId]);
  }

  openLeadContactProfile(contactId: number) {
    this.router.navigate(['/crm/lead-contacts', contactId]);
  }

  loadEmployees() {
    this.http.get<any[]>(`${environment.apiUrl}/employees`)
      .subscribe({
        next: (data) => this.employees = data,
        error: (err) => console.error('Failed to load employees', err)
      });
  }

  loadLeads(onLoaded?: () => void) {
    this.isLoading = true;
    this.http.get<Lead[]>(`${environment.apiUrl}/crm/leads`).subscribe(data => {
      this.leads = data;
      this.distributeLeads();
      this.isLoading = false;
      if (onLoaded) onLoaded();
    }, error => {
      this.isLoading = false;
      console.error('Failed to load leads', error);
    });
  }

  private highlightNewLead(leadId: number) {
    this.highlightedLeadId = leadId;
    if (this.viewMode === 'kanban') {
      setTimeout(() => {
        document.getElementById('lead-card-' + leadId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 50);
    }
    setTimeout(() => {
      if (this.highlightedLeadId === leadId) this.highlightedLeadId = null;
    }, 3000);
  }

  getFilteredEmployees(): any[] {
    // Filter to show people in Finance AND Sales departments as per user request
    let reps = this.employees.filter(e => {
      const dept = e.department?.name?.toLowerCase() || '';
      const role = e.user?.role?.toUpperCase() || '';
      return dept.includes('finance') || dept.includes('sales') || role === 'ADMIN' || role === 'SUPERADMIN';
    });
    
    if (this.ownerSearchQuery.trim()) {
      const q = this.ownerSearchQuery.toLowerCase();
      reps = reps.filter(e => 
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

  getFilteredBroughtByEmployees(): any[] {
    if (!this.broughtBySearchQuery.trim()) return this.employees;
    const q = this.broughtBySearchQuery.toLowerCase();
    return this.employees.filter(e =>
      `${e.firstName} ${e.lastName}`.toLowerCase().includes(q) ||
      e.designation?.name?.toLowerCase().includes(q) ||
      e.department?.name?.toLowerCase().includes(q)
    );
  }

  getFilteredBroughtByContacts(): any[] {
    if (!this.broughtBySearchQuery.trim()) return this.leadContacts;
    const q = this.broughtBySearchQuery.toLowerCase();
    return this.leadContacts.filter(c =>
      c.name?.toLowerCase().includes(q) ||
      c.companyName?.toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q)
    );
  }

  // Returns the selected employee or lead contact, tagged with `_kind` so the template can tell them apart.
  getSelectedBroughtBy(): any {
    if (this.newLeadData.addedById) {
      const emp = this.employees.find(e => e.id === this.newLeadData.addedById);
      return emp ? { ...emp, _kind: 'employee' } : null;
    }
    if (this.newLeadData.broughtByContactId) {
      const contact = this.leadContacts.find(c => c.id === this.newLeadData.broughtByContactId);
      return contact ? { ...contact, firstName: contact.name, lastName: '', designation: { name: contact.companyName }, _kind: 'contact' } : null;
    }
    return null;
  }

  selectBroughtBy(emp: any) {
    this.newLeadData.addedById = emp ? emp.id : null;
    this.newLeadData.broughtByContactId = null;
    this.lockedFromContact = false;
    this.selectedContactCode = null;
    this.showBroughtByDropdown = false;
    this.broughtBySearchQuery = '';
  }

  /**
   * Picking the source contact carries their details onto the deal and locks
   * those fields — the deal belongs to that contact, so letting them be edited
   * here would produce a deal that quietly disagrees with the contact record.
   * Clearing the contact unlocks them and wipes what was carried over.
   */
  selectBroughtByContact(contact: any) {
    this.newLeadData.broughtByContactId = contact ? contact.id : null;
    this.newLeadData.addedById = null;
    this.showBroughtByDropdown = false;
    this.broughtBySearchQuery = '';

    if (contact) {
      this.newLeadData.contactName = contact.name || '';
      this.newLeadData.companyName = contact.companyName || '';
      this.newLeadData.email = contact.email || '';
      this.applyPhone(contact.phone || contact.mobile || '');
      this.newLeadData.website = contact.website || this.newLeadData.website;
      this.newLeadData.address = contact.address || this.newLeadData.address;
      if (!this.newLeadData.source) this.newLeadData.source = contact.leadSource || '';
      this.lockedFromContact = true;
      this.selectedContactCode = contact.contactCode || null;
    } else {
      this.newLeadData.contactName = '';
      this.newLeadData.companyName = '';
      this.newLeadData.email = '';
      this.applyPhone('');
      this.lockedFromContact = false;
      this.selectedContactCode = null;
    }
  }

  /**
   * Split an international number into dial code + local part, or keep it as a
   * bare number. Stored numbers like "+91 98765 43210" and "+919876543210" are
   * both understood; bare local numbers keep whatever the user pasted and just
   * ride on the default dial code.
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
    // A bare number that already carries the country code (e.g. an import that
    // stored "919876543210") must not be prefixed a second time.
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

  /** True while the deal form's contact fields are carried from a lead contact. */
  lockedFromContact = false;
  selectedContactCode: string | null = null;

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // LEAD CONTACTS ("Lead Brought By" source records)
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  loadLeadContacts() {
    this.http.get<any[]>(`${environment.apiUrl}/crm/lead-contacts`).subscribe({
      next: (data) => this.leadContacts = data,
      error: (err) => console.error('Failed to load lead contacts', err)
    });
  }

  goToLeadForms() {
    this.router.navigate(['/crm/lead-forms']);
  }

csvImporting = false;

  syncingContacts = false;

  onCsvImportSelected(event: any) {
    const file: File | undefined = event?.target?.files?.[0];
    event?.target instanceof HTMLInputElement && (event.target.value = '');
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      const contacts = this.parseContactCsv(text);
      if (!contacts.length) {
        this.toast.error('No valid rows found in the CSV.');
        return;
      }
      if (!window.confirm(`Import ${contacts.length} lead contact${contacts.length === 1 ? '' : 's'}?`)) return;
      this.csvImporting = true;
      const currentEmpId = this.auth.currentUser()?.employee?.id || this.auth.currentUser()?.employeeId || null;
      this.http.post<any>(`${environment.apiUrl}/crm/lead-contacts/import`, { contacts, addedById: currentEmpId }).subscribe({
        next: (res) => {
          this.csvImporting = false;
          this.loadLeadContacts();
          this.toast.success(`Imported ${res.created ?? contacts.length} contact${(res.created ?? contacts.length) === 1 ? '' : 's'}.`);
        },
        error: (err) => {
          this.csvImporting = false;
          this.toast.error(err?.error?.message || 'Failed to import contacts.');
        }
      });
    };
    reader.readAsText(file, 'utf-8');
  }

  private parseContactCsv(text: string): any[] {
    const rows = this.parseCsvRows(text);
    if (!rows.length) return [];
    const header = rows[0].map((h) => h.trim().toLowerCase().replace(/[^a-z]+/g, ''));
    const fieldIndex = (key: string) => header.indexOf(key);
    const contacts: any[] = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const get = (k: string) => (fieldIndex(k) >= 0 ? (r[fieldIndex(k)] || '').trim() : '');
      const name = get('name');
      if (!name) continue;
      contacts.push({
        salutation: get('salutation'),
        name,
        email: get('email'),
        phone: get('phone'),
        leadSource: get('source'),
        companyName: get('company'),
        website: get('website'),
        mobile: get('mobile'),
        officePhoneNumber: get('officephone'),
        country: get('country'),
        state: get('state'),
        city: get('city'),
        postalCode: get('postalcode'),
        address: get('address'),
      });
    }
    return contacts;
  }

  private parseCsvRows(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cur += '"'; i++; }
          else inQuotes = false;
        } else cur += ch;
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(cur); cur = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cur); cur = '';
        rows.push(row); row = [];
      } else {
        cur += ch;
      }
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim() !== ''));
  }

  exportLeadContactsCsv() {
    const contacts = this.getFilteredLeadContacts();
    if (!contacts.length) { this.toast.info('No lead contacts to export.'); return; }
    const csvRows = [
      ['Salutation', 'Name', 'Email', 'Phone', 'Source', 'Company', 'Website', 'Mobile', 'Office Phone', 'Country', 'State', 'City', 'Postal Code', 'Address'].join(','),
      ...contacts.map((c: any) => [
        this.escapeCsv(c.salutation || ''),
        this.escapeCsv(c.name || ''),
        this.escapeCsv(c.email || ''),
        this.escapeCsv(c.phone || ''),
        this.escapeCsv(c.leadSource || ''),
        this.escapeCsv(c.companyName || ''),
        this.escapeCsv(c.website || ''),
        this.escapeCsv(c.mobile || ''),
        this.escapeCsv(c.officePhoneNumber || ''),
        this.escapeCsv(c.country || ''),
        this.escapeCsv(c.state || ''),
        this.escapeCsv(c.city || ''),
        this.escapeCsv(c.postalCode || ''),
        this.escapeCsv(c.address || '')
      ].join(','))
    ];
    const csv = '\uFEFF' + csvRows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lead_contacts_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  syncLeadContacts() {
    if (this.syncingContacts) return;
    if (!window.confirm('Link existing deals to their matching lead contacts? This is safe and only adds missing links.')) return;
    this.syncingContacts = true;
    this.http.post<any>(`${environment.apiUrl}/crm/leads/sync-contacts`, {}).subscribe({
      next: (res) => {
        this.syncingContacts = false;
        this.loadLeadContacts();
        this.loadLeads();
        this.toast.success(res?.message || 'Lead contacts synced.');
      },
      error: (err) => {
        this.syncingContacts = false;
        this.toast.error(err?.error?.message || 'Failed to sync lead contacts.');
      }
    });
  }

  private escapeCsv(value: string): string {
    const s = String(value ?? '');
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  getFilteredLeadContacts(): any[] {
    if (!this.contactSearchQuery.trim()) return this.leadContacts;
    const q = this.contactSearchQuery.toLowerCase();
    return this.leadContacts.filter(c =>
      c.name?.toLowerCase().includes(q) ||
      c.companyName?.toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q) ||
      c.phone?.toLowerCase().includes(q) ||
      c.mobile?.toLowerCase().includes(q) ||
      c.leadSource?.toLowerCase().includes(q) ||
      (c.addedBy && `${c.addedBy.firstName} ${c.addedBy.lastName}`.toLowerCase().includes(q))
    );
  }

  getFilteredContactAddedByEmployees(): any[] {
    if (!this.contactAddedBySearchQuery.trim()) return this.employees;
    const q = this.contactAddedBySearchQuery.toLowerCase();
    return this.employees.filter(e =>
      `${e.firstName} ${e.lastName}`.toLowerCase().includes(q) ||
      e.designation?.name?.toLowerCase().includes(q) ||
      e.department?.name?.toLowerCase().includes(q)
    );
  }

  getSelectedContactAddedBy(): any {
    if (!this.leadContactForm.addedById) return null;
    return this.employees.find(e => e.id === this.leadContactForm.addedById);
  }

  selectContactAddedBy(emp: any) {
    this.leadContactForm.addedById = emp ? emp.id : null;
    this.showContactAddedByDropdown = false;
    this.contactAddedBySearchQuery = '';
  }

  autoCreateLeadForContact: boolean = false;
  openLeadContactModal() {
    this.isEditingLeadContact = false;
    this.editingLeadContactId = null;
    this.autoCreateLeadForContact = false;
    const currentEmpId = this.auth.currentUser()?.employee?.id || this.auth.currentUser()?.employeeId || null;
    this.leadContactForm = {
      salutation: '', name: '', email: '', phone: '', leadSource: '',
      companyName: '', website: '', mobile: '', officePhoneNumber: '',
      country: '', state: '', city: '', postalCode: '', address: '',
      addedById: currentEmpId
    };
    this.contactAddedBySearchQuery = '';
    this.showContactAddedByDropdown = false;
    this.showLeadContactModal = true;
  }

  openEditLeadContactModal(contact: any, event?: Event) {
    if (event) event.stopPropagation();
    this.isEditingLeadContact = true;
    this.editingLeadContactId = contact.id;
    this.leadContactForm = {
      salutation: contact.salutation || '',
      name: contact.name || '',
      email: contact.email || '',
      phone: contact.phone || '',
      leadSource: contact.leadSource || '',
      companyName: contact.companyName || '',
      website: contact.website || '',
      mobile: contact.mobile || '',
      officePhoneNumber: contact.officePhoneNumber || '',
      country: contact.country || '',
      state: contact.state || '',
      city: contact.city || '',
      postalCode: contact.postalCode || '',
      address: contact.address || '',
      addedById: contact.addedBy?.id || contact.addedById || null
    };
    this.contactAddedBySearchQuery = '';
    this.showContactAddedByDropdown = false;
    this.showLeadContactModal = true;
  }

  // For "leads brought" count on the Lead Contacts tab
  getLeadsCountForContact(contactId: number): number {
    return this.leads.filter(l => (l as any).broughtByContact?.id === contactId).length;
  }

  closeLeadContactModal() {
    if (this.isSavingLeadContact) return;
    this.showLeadContactModal = false;
    this.isEditingLeadContact = false;
    this.editingLeadContactId = null;
    this.contactAddedBySearchQuery = '';
    this.showContactAddedByDropdown = false;
  }

  submitLeadContact() {
    if (!this.leadContactForm.name.trim()) return;

    this.isSavingLeadContact = true;
    if (this.isEditingLeadContact && this.editingLeadContactId) {
      this.http.put<any>(`${environment.apiUrl}/crm/lead-contacts/${this.editingLeadContactId}`, this.leadContactForm).subscribe({
        next: (updated) => {
          this.isSavingLeadContact = false;
          this.leadContacts = this.leadContacts.map(c => c.id === updated.id ? updated : c);
          this.closeLeadContactModal();
        },
        error: (err) => {
          this.isSavingLeadContact = false;
          alert(err?.error?.message || 'Failed to update lead contact.');
        }
      });
    } else {
      this.http.post<any>(`${environment.apiUrl}/crm/lead-contacts`, this.leadContactForm).subscribe({
        next: (created) => {
          this.isSavingLeadContact = false;
          this.leadContacts = [created, ...this.leadContacts];
          this.closeLeadContactModal();
          // If the Add Lead modal is open, immediately use this new contact as "Lead Brought By"
          if (this.showCreateModal) {
            this.selectBroughtByContact(created);
          } else if (this.autoCreateLeadForContact) {
            this.openModal();
            this.selectBroughtByContact(created);
            this.newLeadData.companyName = created.companyName || '';
            this.newLeadData.contactName = created.name || '';
            this.newLeadData.email = created.email || '';
            this.applyPhone(created.mobile || created.phone || '');
            this.newLeadData.website = created.website || '';
            const loc = [created.city, created.state, created.country].filter(Boolean).join(', ');
            this.newLeadData.address = created.address || loc;
          }
        },
        error: (err) => {
          this.isSavingLeadContact = false;
          alert(err?.error?.message || 'Failed to save lead contact.');
        }
      });
    }
  }

  deleteLeadContact(contactId: number, event?: Event) {
    if (event) event.stopPropagation();
    if (confirm('Are you sure you want to delete this lead contact?')) {
      this.http.delete(`${environment.apiUrl}/crm/lead-contacts/${contactId}`).subscribe({
        next: () => {
          this.leadContacts = this.leadContacts.filter(c => c.id !== contactId);
        },
        error: (err) => {
          alert(err?.error?.message || 'Failed to delete lead contact.');
        }
      });
    }
  }

  showBroughtLeadsModal: boolean = false;
  selectedBroughtContact: any = null;
  broughtLeadsList: any[] = [];

  openBroughtLeadsModal(contact: any, event?: Event) {
    if (event) event.stopPropagation();
    this.selectedBroughtContact = contact;
    this.broughtLeadsList = this.leads.filter(l => (l as any).broughtByContact?.id === contact.id);
    this.showBroughtLeadsModal = true;
  }

  closeBroughtLeadsModal() {
    this.showBroughtLeadsModal = false;
    this.selectedBroughtContact = null;
    this.broughtLeadsList = [];
  }

  getBroughtLeadsTotalValue(): number {
    return this.broughtLeadsList.reduce((acc, l) => acc + (Number(l.expectedDealValue) || 0), 0);
  }

  getBroughtLeadsActiveCount(): number {
    return this.broughtLeadsList.filter(l => {
      const s = this.normalizeStatus(l.status);
      return s !== 'Converted' && s !== 'Lost' && s !== 'Junk';
    }).length;
  }

  getBroughtLeadsWonCount(): number {
    return this.broughtLeadsList.filter(l => this.normalizeStatus(l.status) === 'Converted').length;
  }

  openAddLeadForContact(contact: any) {
    this.closeBroughtLeadsModal();
    this.openModal();
    this.selectBroughtByContact(contact);
  }

  normalizeStatus(status: string | undefined | null): string {
    if (!status) return 'New';
    const s = status.trim().toUpperCase();
    if (s === 'NEW') return 'New';
    if (s === 'INTERESTED' || s === 'QUALIFIED' || s === 'ASSIGNED' || s === 'CONTACTED' || s === 'ATTEMPTED TO CONTACT' || s === 'CONNECTED' || s === 'FOLLOW-UP REQUIRED' || s === 'FOLLOW_UP_REQUIRED') return 'Interested';
    if (s === 'PROPOSAL' || s === 'PROPOSAL SENT' || s === 'PROPOSAL_SENT' || s === 'DEMO SCHEDULED' || s === 'DEMO COMPLETED') return 'Proposal Sent';
    if (s === 'NEGOTIATION') return 'Negotiation';
    if (s === 'ON HOLD' || s === 'ON_HOLD') return 'On Hold';
    if (s === 'CONVERTED' || s === 'WON' || s === 'WIN') return 'Win';
    if (s === 'LOST') return 'Lost';
    if (s === 'SCHEDULE MEETING' || s === 'SCHEDULE_MEETING') return 'Schedule Meeting';
    
    // Direct match from active statuses
    const directMatch = this.LEAD_STATUSES.find(st => st.toLowerCase() === status.toLowerCase());
    if (directMatch) return directMatch;

    return 'New';
  }

  private getDateRangeForPreset(): { start: Date | null, end: Date | null } {
    if (this.datePreset === 'ALL') return { start: null, end: null };

    if (this.datePreset === 'CUSTOM') {
      const start = this.dateStart ? new Date(this.dateStart + 'T00:00:00') : null;
      const end = this.dateEnd ? new Date(this.dateEnd + 'T23:59:59.999') : null;
      return { start, end };
    }

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    if (this.datePreset === 'TODAY') {
      return { start: startOfToday, end: endOfToday };
    }
    if (this.datePreset === 'THIS_WEEK') {
      const dayOfWeek = startOfToday.getDay(); // 0 = Sunday
      const monday = new Date(startOfToday);
      monday.setDate(startOfToday.getDate() - ((dayOfWeek + 6) % 7));
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      sunday.setHours(23, 59, 59, 999);
      return { start: monday, end: sunday };
    }
    if (this.datePreset === 'THIS_MONTH') {
      const first = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      const last = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      return { start: first, end: last };
    }
    if (this.datePreset === 'NEXT_MONTH') {
      const first = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
      const last = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59, 999);
      return { start: first, end: last };
    }
    if (this.datePreset === 'THIS_QUARTER') {
      const qStartMonth = Math.floor(now.getMonth() / 3) * 3;
      const first = new Date(now.getFullYear(), qStartMonth, 1, 0, 0, 0, 0);
      const last = new Date(now.getFullYear(), qStartMonth + 3, 0, 23, 59, 59, 999);
      return { start: first, end: last };
    }
    if (this.datePreset === 'THIS_YEAR') {
      const first = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
      const last = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
      return { start: first, end: last };
    }
    return { start: null, end: null };
  }

  // Follow-up status is derived from `scheduledAt` on the lead's follow-ups â€” there's
  // no separate status field (removed from the model; a follow-up is just a logged
  // interaction). "Overdue" = earliest upcoming follow-up already in the past.
  private getLeadFollowUpStatus(lead: Lead): 'OVERDUE' | 'SCHEDULED' | 'NONE' {
    const followUps = lead.followUps || [];
    if (followUps.length === 0) return 'NONE';
    const now = new Date();
    const hasOverdue = followUps.some(f => new Date(f.scheduledAt) < now);
    return hasOverdue ? 'OVERDUE' : 'SCHEDULED';
  }

  // Soonest upcoming follow-up date; falls back to the most recent one if there
  // are no upcoming follow-ups. Returns null when the lead has no follow-ups.
  getNextFollowUpDate(lead: Lead): Date | null {
    const followUps = lead.followUps || [];
    if (followUps.length === 0) return null;
    const now = new Date().getTime();
    let next: Date | null = null;
    let latest: Date | null = null;
    for (const f of followUps) {
      const t = new Date(f.scheduledAt).getTime();
      if (isNaN(t)) continue;
      if (latest === null || t > latest.getTime()) latest = new Date(t);
      if (t >= now && (next === null || t < next.getTime())) next = new Date(t);
    }
    return next || latest;
  }

  // Only show a "Next Follow Up" date in the table once a lead has reached the
  // negotiation stage or later (Negotiation, Converted, On Hold).
  showNextFollowUpInTable(lead: Lead): boolean {
    return lead.status === 'Negotiation' || lead.status === 'Converted' || lead.status === 'On Hold';
  }

  getFilteredLeads(): Lead[] {
    const q = this.searchQuery.trim().toLowerCase();
    const { start, end } = this.getDateRangeForPreset();

    const myEmpId = this.currentEmployeeId();

    const filtered = this.leads.filter(lead => {
      const matchesSearch =
        !q ||
        lead.leadCode?.toLowerCase().includes(q) ||
        lead.title?.toLowerCase().includes(q) ||
        lead.companyName?.toLowerCase().includes(q) ||
        lead.contactName?.toLowerCase().includes(q) ||
        lead.email?.toLowerCase().includes(q) ||
        lead.phone?.toLowerCase().includes(q);

      const normalized = this.normalizeStatus(lead.status);
      const matchesStage =
        this.selectedStages.length === 0 || this.selectedStages.includes(normalized);

      const matchesRep =
        this.selectedRepId === 'ALL' ||
        (this.selectedRepId === 'UNASSIGNED' ? !lead.assignedTo : lead.assignedTo?.id === this.selectedRepId);

      const matchesCategory =
        this.selectedCategory === 'ALL' || lead.dealCategory === this.selectedCategory;

      const matchesSource =
        this.selectedSource === 'ALL' || lead.source === this.selectedSource;

      const matchesContact =
        this.selectedContactId === 'ALL' || (lead as any).broughtByContact?.id === this.selectedContactId;

      const matchesAddedBy =
        this.selectedAddedById === 'ALL' || lead.addedBy?.id === this.selectedAddedById;

      const matchesMyLeads =
        !this.myLeadsOnly || !myEmpId ||
        lead.assignedTo?.id === myEmpId || lead.addedBy?.id === myEmpId;

      const hasQuotation = (lead.quotations?.length || 0) > 0;
      const matchesQuotation =
        this.selectedQuotationStatus === 'ALL' ||
        (this.selectedQuotationStatus === 'QUOTED' ? hasQuotation : !hasQuotation);

      const matchesFollowUpStatus =
        this.selectedFollowUpStatus === 'ALL' || this.getLeadFollowUpStatus(lead) === this.selectedFollowUpStatus;

      // Previously this only trimmed the rows inside an expanded lead, so the
      // panel's Follow-Up Date control appeared to do nothing to the board.
      // A lead matches when it has at least one follow-up in the chosen window.
      const matchesFollowUpDate =
        this.followUpDateFilter === 'all' ||
        (lead.followUps || []).some((fu: any) => this.followUpInRange(fu));

      const value = Number(lead.value) || 0;
      const matchesMin = this.minValue === null || this.minValue === undefined || value >= this.minValue;
      const matchesMax = this.maxValue === null || this.maxValue === undefined || value <= this.maxValue;

      let matchesDate = true;
      if (start || end) {
        let raw: string | Date | null | undefined = null;
        if (this.dateField === 'expectedCloseDate') raw = lead.expectedCloseDate;
        else if (this.dateField === 'nextFollowUp') raw = this.getNextFollowUpDate(lead);
        else raw = lead.createdAt;
        if (!raw) {
          matchesDate = false;
        } else {
          const d = new Date(raw);
          matchesDate = (!start || d >= start) && (!end || d <= end);
        }
      }

      return matchesSearch && matchesStage && matchesRep && matchesCategory &&
        matchesSource && matchesContact && matchesAddedBy && matchesMyLeads && matchesQuotation &&
        matchesFollowUpStatus && matchesFollowUpDate && matchesMin && matchesMax && matchesDate;
    });

    return this.sortLeads(filtered);
  }

  private sortLeads(list: Lead[]): Lead[] {
    const sorted = [...list];
    switch (this.sortBy) {
      case 'oldest':
        sorted.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        break;
      case 'value_desc':
        sorted.sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0));
        break;
      case 'value_asc':
        sorted.sort((a, b) => (Number(a.value) || 0) - (Number(b.value) || 0));
        break;
      case 'closing_soon':
        sorted.sort((a, b) => {
          const aDate = a.expectedCloseDate ? new Date(a.expectedCloseDate).getTime() : Infinity;
          const bDate = b.expectedCloseDate ? new Date(b.expectedCloseDate).getTime() : Infinity;
          return aDate - bDate;
        });
        break;
      case 'newest':
      default:
        sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        break;
    }
    return sorted;
  }

  distributeLeads() {
    const filtered = this.getFilteredLeads();
    this.kanbanColumns = this.LEAD_STATUSES.map(status => ({
      id: status,
      name: status,
      leads: filtered.filter(l => this.normalizeStatus(l.status) === status)
    }));
  }

  onFilterChange() {
    this.distributeLeads();
  }

  // "My Leads" quick filter — shown only to admin/superadmin, who otherwise
  // see every lead on the board. Toggling narrows to leads owned or created
  // by the current user (mirrors the backend's non-admin reach rules).
  get isAdminOrSuperAdmin(): boolean {
    const role = this.auth.currentUser()?.role;
    return role === 'ADMIN' || role === 'SUPERADMIN';
  }

  private currentEmployeeId(): number | null {
    return this.auth.currentUser()?.employee?.id ?? this.auth.currentUser()?.employeeId ?? null;
  }

  toggleMyLeads() {
    this.myLeadsOnly = !this.myLeadsOnly;
    this.onFilterChange();
  }

  getConnectedLists(): string[] {
    return this.LEAD_STATUSES;
  }

  // --- Stage multi-select dropdown ---
  getFilteredStages(): string[] {
    if (!this.stageSearchQuery.trim()) return this.LEAD_STATUSES;
    const q = this.stageSearchQuery.toLowerCase();
    return this.LEAD_STATUSES.filter(s => s.toLowerCase().includes(q));
  }

  toggleStage(status: string) {
    const idx = this.selectedStages.indexOf(status);
    if (idx > -1) this.selectedStages.splice(idx, 1);
    else this.selectedStages.push(status);
    this.onFilterChange();
  }

  isStageSelected(status: string): boolean {
    return this.selectedStages.includes(status);
  }

  clearStages() {
    this.selectedStages = [];
    this.stageSearchQuery = '';
    this.onFilterChange();
  }

  // Computes a fixed position for a searchable dropdown triggered from $event,
  // so it is never clipped by the modal's scroll container.
  openFilterDropdown(ev: Event, activeKey: string, closeKeys: string[]) {
    const toggles: Record<string, string> = {
      stage: 'showStageDropdown',
      rep: 'showRepDropdown',
      category: 'showCategoryDropdown',
      source: 'showSourceDropdown',
      contact: 'showContactDropdown',
      added: 'showAddedByDropdown'
    };
    for (const key of closeKeys) {
      (this as any)[toggles[key]] = false;
    }
    const next = !(this as any)[toggles[activeKey]];
    (this as any)[toggles[activeKey]] = next;
    if (next && ev && ev.currentTarget) {
      const el = (ev.currentTarget as HTMLElement);
      const rect = el.getBoundingClientRect();
      const panelEl = document.querySelector('.advanced-filters-panel') as HTMLElement | null;
      const panelRect = panelEl ? panelEl.getBoundingClientRect() : null;
      const originX = panelRect ? panelRect.left : 0;
      const originY = panelRect ? panelRect.top : 0;
      const panelW = panelEl ? panelEl.offsetWidth : window.innerWidth;
      const viewportH = window.innerHeight;
      const popoverH = Math.min(320, Math.max(200, viewportH - rect.bottom - 24));
      const relLeft = rect.left - originX;
      this.fDropdownPos = {
        left: Math.max(0, Math.min(relLeft, Math.max(0, panelW - 308))),
        top: rect.bottom + 6 - originY,
        maxHeight: popoverH
      };
    } else {
      this.fDropdownPos = null;
    }
  }

  closeFilterDropdowns() {
    this.showStageDropdown = false;
    this.showRepDropdown = false;
    this.showCategoryDropdown = false;
    this.showSourceDropdown = false;
    this.showContactDropdown = false;
    this.showAddedByDropdown = false;
    this.fDropdownPos = null;
  }


  // --- Searchable Filter Dropdowns ---
  getFilteredRepsForFilter(): any[] {
    let reps = this.employees.filter(e => {
      const dept = e.department?.name?.toLowerCase() || '';
      const role = e.user?.role?.toUpperCase() || '';
      return dept.includes('finance') || dept.includes('sales') || role === 'ADMIN' || role === 'SUPERADMIN';
    });
    if (this.repSearchQuery.trim()) {
      const q = this.repSearchQuery.toLowerCase();
      reps = reps.filter(e => 
        `${e.firstName} ${e.lastName}`.toLowerCase().includes(q) ||
        e.designation?.name?.toLowerCase().includes(q) ||
        e.department?.name?.toLowerCase().includes(q)
      );
    }
    return reps;
  }

  selectRepFilter(repId: number | 'ALL' | 'UNASSIGNED') {
    this.selectedRepId = repId;
    this.showRepDropdown = false;
    this.repSearchQuery = '';
    this.onFilterChange();
  }

  getSelectedRepLabel(): string {
    if (this.selectedRepId === 'ALL') return 'All Reps';
    if (this.selectedRepId === 'UNASSIGNED') return 'Unassigned';
    return this.getRepName(this.selectedRepId) || 'Selected Rep';
  }

  getFilteredContactsForFilter(): any[] {
    if (!this.contactFilterSearchQuery.trim()) return this.leadContacts;
    const q = this.contactFilterSearchQuery.toLowerCase();
    return this.leadContacts.filter(c => 
      (c.name && c.name.toLowerCase().includes(q)) ||
      (c.companyName && c.companyName.toLowerCase().includes(q)) ||
      (c.email && c.email.toLowerCase().includes(q)) ||
      (c.mobile && c.mobile.toLowerCase().includes(q))
    );
  }

  selectContactFilter(contactId: number | 'ALL') {
    this.selectedContactId = contactId;
    this.showContactDropdown = false;
    this.contactFilterSearchQuery = '';
    this.onFilterChange();
  }

  getSelectedContactLabel(): string {
    if (this.selectedContactId === 'ALL') return 'All Contacts';
    const c = this.leadContacts.find(item => item.id === this.selectedContactId);
    return c ? (c.name + (c.companyName ? ` (${c.companyName})` : '')) : 'Selected Contact';
  }

  getFilteredAddedByForFilter(): any[] {
    if (!this.addedByFilterSearchQuery.trim()) return this.employees;
    const q = this.addedByFilterSearchQuery.toLowerCase();
    return this.employees.filter(e =>
      `${e.firstName} ${e.lastName}`.toLowerCase().includes(q) ||
      e.designation?.name?.toLowerCase().includes(q) ||
      e.department?.name?.toLowerCase().includes(q)
    );
  }

  selectAddedByFilter(empId: number | 'ALL') {
    this.selectedAddedById = empId;
    this.showAddedByDropdown = false;
    this.addedByFilterSearchQuery = '';
    this.onFilterChange();
  }

  getSelectedAddedByLabel(): string {
    if (this.selectedAddedById === 'ALL') return 'All';
    const emp = this.employees.find(e => e.id === this.selectedAddedById);
    return emp ? `${emp.firstName} ${emp.lastName}` : 'Selected';
  }

  selectQuotationStatusFilter(status: 'ALL' | 'QUOTED' | 'NOT_QUOTED') {
    this.selectedQuotationStatus = status;
    this.onFilterChange();
  }

  selectFollowUpStatusFilter(status: 'ALL' | 'OVERDUE' | 'SCHEDULED' | 'NONE') {
    this.selectedFollowUpStatus = status;
    this.onFilterChange();
  }

  getFilteredCategoriesForFilter(): any[] {
    if (!this.categorySearchQuery.trim()) return this.DEAL_CATEGORIES;
    const q = this.categorySearchQuery.toLowerCase();
    return this.DEAL_CATEGORIES.filter(c => c.name.toLowerCase().includes(q));
  }

  selectCategoryFilter(categoryId: string) {
    this.selectedCategory = categoryId;
    this.showCategoryDropdown = false;
    this.categorySearchQuery = '';
    this.onFilterChange();
  }

  getSelectedCategoryLabel(): string {
    if (this.selectedCategory === 'ALL') return 'All Categories';
    const cat = this.DEAL_CATEGORIES.find(c => c.id === this.selectedCategory);
    return cat?.name || this.selectedCategory;
  }

  getFilteredSourcesForFilter(): string[] {
    if (!this.sourceSearchQuery.trim()) return this.LEAD_SOURCES;
    const q = this.sourceSearchQuery.toLowerCase();
    return this.LEAD_SOURCES.filter(s => s.toLowerCase().includes(q));
  }

  selectSourceFilter(source: string) {
    this.selectedSource = source;
    this.showSourceDropdown = false;
    this.sourceSearchQuery = '';
    this.onFilterChange();
  }

  getSelectedSourceLabel(): string {
    return this.selectedSource === 'ALL' ? 'All Sources' : this.selectedSource;
  }

  closeAllFilterDropdowns() {
    this.showStageDropdown = false;
    this.showRepDropdown = false;
    this.showCategoryDropdown = false;
    this.showSourceDropdown = false;
    this.showContactDropdown = false;
    this.showAddedByDropdown = false;
  }

  // --- Active filter chips ---
  getActiveFilterChips(): { key: string, label: string, clear: () => void }[] {
    const chips: { key: string, label: string, clear: () => void }[] = [];

    if (this.searchQuery.trim()) {
      chips.push({ key: 'search', label: `Search: "${this.searchQuery.trim()}"`, clear: () => { this.searchQuery = ''; this.onFilterChange(); } });
    }
    if (this.myLeadsOnly) {
      chips.push({ key: 'myLeads', label: 'My Leads', clear: () => { this.myLeadsOnly = false; this.onFilterChange(); } });
    }
    if (this.selectedStages.length > 0) {
      chips.push({ key: 'stage', label: `Stage: ${this.selectedStages.join(', ')}`, clear: () => this.clearStages() });
    }
    if (this.selectedRepId !== 'ALL') {
      const label = this.selectedRepId === 'UNASSIGNED' ? 'Unassigned' : this.getRepName(this.selectedRepId);
      chips.push({ key: 'rep', label: `Rep: ${label}`, clear: () => { this.selectedRepId = 'ALL'; this.onFilterChange(); } });
    }
    if (this.selectedCategory !== 'ALL') {
      chips.push({ key: 'category', label: `Category: ${this.selectedCategory}`, clear: () => { this.selectedCategory = 'ALL'; this.onFilterChange(); } });
    }
    if (this.selectedSource !== 'ALL') {
      chips.push({ key: 'source', label: `Source: ${this.selectedSource}`, clear: () => { this.selectedSource = 'ALL'; this.onFilterChange(); } });
    }
    if (this.selectedContactId !== 'ALL') {
      const contact = this.leadContacts.find(c => c.id === this.selectedContactId);
      chips.push({ key: 'contact', label: `Contact: ${contact?.name || 'Unknown'}`, clear: () => { this.selectedContactId = 'ALL'; this.onFilterChange(); } });
    }
    if (this.selectedAddedById !== 'ALL') {
      chips.push({ key: 'addedBy', label: `Added By: ${this.getSelectedAddedByLabel()}`, clear: () => { this.selectedAddedById = 'ALL'; this.onFilterChange(); } });
    }
    if (this.selectedQuotationStatus !== 'ALL') {
      chips.push({ key: 'quotation', label: `Quotation: ${this.selectedQuotationStatus === 'QUOTED' ? 'Quoted' : 'Not Quoted'}`, clear: () => { this.selectedQuotationStatus = 'ALL'; this.onFilterChange(); } });
    }
    if (this.selectedFollowUpStatus !== 'ALL') {
      const label = this.selectedFollowUpStatus === 'OVERDUE' ? 'Overdue' : this.selectedFollowUpStatus === 'SCHEDULED' ? 'Scheduled' : 'No Follow-Up';
      chips.push({ key: 'followUpStatus', label: `Follow-Up: ${label}`, clear: () => { this.selectedFollowUpStatus = 'ALL'; this.onFilterChange(); } });
    }
    if (this.minValue !== null || this.maxValue !== null) {
      const min = this.minValue !== null ? this.minValue.toLocaleString() : '0';
      const max = this.maxValue !== null ? this.maxValue.toLocaleString() : 'âˆž';
      chips.push({ key: 'value', label: `Value: ${min} - ${max}`, clear: () => { this.minValue = null; this.maxValue = null; this.onFilterChange(); } });
    }
    if (this.followUpDateFilter !== 'all') {
      const labels: Record<string, string> = {
        today: 'Today', thisWeek: 'This Week', thisMonth: 'This Month',
        lastMonth: 'Last Month', last30: 'Last 30 Days', last90: 'Last 90 Days',
        thisYear: 'This Year', lastYear: 'Last Year',
      };
      const label = this.followUpDateFilter === 'custom'
        ? `${this.followUpStartDate || '…'} to ${this.followUpEndDate || '…'}`
        : labels[this.followUpDateFilter] || this.followUpDateFilter;
      chips.push({
        key: 'followUpDate',
        label: `Follow-Up Date: ${label}`,
        clear: () => this.clearFollowUpDateFilter(),
      });
    }
    if (this.datePreset !== 'ALL') {
      const fieldLabel = this.dateField === 'expectedCloseDate' ? 'Closing' : this.dateField === 'nextFollowUp' ? 'Next Follow-Up' : 'Created';
      const presetLabel = this.datePreset === 'CUSTOM' ? `${this.dateStart || 'â€¦'} to ${this.dateEnd || 'â€¦'}` : this.datePreset.replace('_', ' ');
      chips.push({ key: 'date', label: `${fieldLabel}: ${presetLabel}`, clear: () => { this.datePreset = 'ALL'; this.dateStart = ''; this.dateEnd = ''; this.onFilterChange(); } });
    }

    return chips;
  }

  getRepName(repId: number | 'ALL' | 'UNASSIGNED'): string {
    if (repId === 'ALL' || repId === 'UNASSIGNED') return '';
    const emp = this.employees.find(e => e.id === repId);
    return emp ? `${emp.firstName} ${emp.lastName}` : 'Unknown';
  }

  hasActiveFilters(): boolean {
    return this.getActiveFilterChips().length > 0;
  }

  clearFilters() {
    this.searchQuery = '';
    this.myLeadsOnly = false;
    this.selectedStages = [];
    this.selectedRepId = 'ALL';
    this.selectedCategory = 'ALL';
    this.selectedSource = 'ALL';
    this.selectedContactId = 'ALL';
    this.selectedAddedById = 'ALL';
    this.selectedQuotationStatus = 'ALL';
    this.selectedFollowUpStatus = 'ALL';
    this.minValue = null;
    this.maxValue = null;
    this.datePreset = 'ALL';
    this.dateField = 'createdAt';
    this.dateStart = '';
    this.dateEnd = '';
    this.followUpDateFilter = 'all';
    this.followUpStartDate = '';
    this.followUpEndDate = '';
    this.sortBy = 'newest';
    this.distributeLeads();
  }

  getTotalPipelineValue(): number {
    return this.leads.reduce((sum, lead) => sum + (Number(lead.value) || 0), 0);
  }

  getFilteredCount(): number {
    return this.getFilteredLeads().length;
  }

  getFilteredValue(): number {
    return this.getFilteredLeads().reduce((sum, lead) => sum + (Number(lead.value) || 0), 0);
  }

  drop(event: CdkDragDrop<Lead[]>) {
    if (event.previousContainer === event.container) {
      moveItemInArray(event.container.data, event.previousIndex, event.currentIndex);
    } else {
      transferArrayItem(
        event.previousContainer.data,
        event.container.data,
        event.previousIndex,
        event.currentIndex,
      );

      const newStatus = event.container.id; 
      const lead = event.container.data[event.currentIndex];
      if (this.isWinStage(newStatus)) {
        // Drag-and-drop mutates the arrays before the handler runs. Put the card
        // back while the required PO is collected.
        transferArrayItem(event.container.data, event.previousContainer.data, event.currentIndex, event.previousIndex);
        this.openPurchaseOrderModal(lead);
        return;
      }
      this.saveLeadStage(lead, newStatus);
    }
  }

  openModal() {
    this.isEditing = false;
    this.editingLeadId = null;
    this.showCreateModal = true;
    this.isSubmitted = false;
    this.isSaving = false;
    this.activeTab = 1;
    this.customSource = '';
    this.newLeadData = {
      leadCode: '', title: '', subjectLine: '', dealCategory: 'Inbound', companyName: '', contactName: '', email: '', phone: '', phoneCode: '+91', website: '', address: '',
      value: 0, currency: 'INR', status: 'New', source: 'Website / Inbound', assignedToId: null, addedById: null, broughtByContactId: null,
      description: '', qualificationReason: '', expectedCloseDate: ''
    };
    // Otherwise the next deal opens with fields still locked from the last one.
    this.lockedFromContact = false;
    this.selectedContactCode = null;
  }

  openEditModal(lead: Lead, event?: Event) {
    if (event) event.stopPropagation();
    this.isEditing = true;
    this.editingLeadId = lead.id;
    this.showCreateModal = true;
    this.isSubmitted = false;
    this.isSaving = false;
    this.activeTab = 1;

    this.customSource = '';
    let leadSource = lead.source || '';
    if (leadSource && !this.LEAD_SOURCES.includes(leadSource)) {
      this.customSource = leadSource;
      leadSource = 'Other';
    }

    this.newLeadData = {
      leadCode: lead.leadCode || '',
      title: lead.title || '',
      subjectLine: lead.subjectLine || '',
      dealCategory: lead.dealCategory || 'Inbound',
      companyName: lead.companyName || '',
      contactName: lead.contactName || '',
      email: lead.email || '',
      phone: lead.phone || '',
      phoneCode: '+91',
      website: lead.website || '',
      address: lead.address || '',
      value: lead.value || 0,
      currency: lead.currency || 'INR',
      status: this.normalizeStatus(lead.status),
      source: leadSource,
      assignedToId: lead.assignedTo?.id || (lead as any).assignedToId || null,
      addedById: lead.addedBy?.id || (lead as any).addedById || null,
      broughtByContactId: (lead as any).broughtByContact?.id || (lead as any).broughtByContactId || null,
      description: lead.description || '',
      qualificationReason: lead.qualificationReason || '',
      expectedCloseDate: lead.expectedCloseDate ? lead.expectedCloseDate.split('T')[0] : ''
    };
    // Re-split the stored international number into dial code + local part.
    this.applyPhone(this.newLeadData.phone || '');
    const linkedContact = this.newLeadData.broughtByContactId
      ? this.leadContacts.find(contact => contact.id === this.newLeadData.broughtByContactId)
      : null;
    this.lockedFromContact = !!this.newLeadData.broughtByContactId;
    this.selectedContactCode = linkedContact?.contactCode || null;
  }

  get isContactEmailNew(): boolean {
    const email = this.newLeadData.email?.trim().toLowerCase();
    if (!email) return false;
    return !this.leadContacts.some(c => c.email?.trim().toLowerCase() === email);
  }

  // null = user hasn't manually toggled the checkbox yet, so it tracks isContactEmailNew
  // automatically (covers browser-autofilled fields, which don't fire ngModelChange).
  get contactCheckboxChecked(): boolean {
    return this.saveContactFromLead === null ? this.isContactEmailNew : this.saveContactFromLead;
  }

  onContactCheckboxChange(checked: boolean) {
    this.saveContactFromLead = checked;
  }

  closeModal() {
    if (this.isSaving) return;
    this.showCreateModal = false;
    this.isSubmitted = false;
    this.isEditing = false;
    this.editingLeadId = null;
    this.customSource = '';
    this.saveContactFromLead = null;
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

  getFilteredLeadContactsForNewLead(): any[] {
    const query = this.leadContactSearchQuery.trim().toLowerCase();
    if (!query) return this.leadContacts;
    return this.leadContacts.filter(contact =>
      contact.name?.toLowerCase().includes(query) ||
      contact.contactCode?.toLowerCase().includes(query) ||
      contact.companyName?.toLowerCase().includes(query) ||
      contact.email?.toLowerCase().includes(query),
    );
  }

  getSelectedLeadContact(): any | null {
    return this.newLeadData.broughtByContactId
      ? this.leadContacts.find(contact => contact.id === this.newLeadData.broughtByContactId) || null
      : null;
  }

  selectLeadContactForNewLead(contact: any | null) {
    this.showLeadContactDropdown = false;
    this.leadContactSearchQuery = '';
    this.selectBroughtByContact(contact);
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

    // Validation: Stage, Source, Deal Value, and Close Date are required on tab 2
    const isTab2Valid = this.newLeadData.status?.trim()
      && this.newLeadData.source?.trim()
      && this.newLeadData.value !== null && this.newLeadData.value !== undefined
      && this.newLeadData.expectedCloseDate;

    if (!isTab2Valid) {
      this.activeTab = 2;
      return;
    }

    this.isSaving = true;

    // Preserve a manually entered ID and omit a blank one so the server
    // generates it automatically.
    const payload: any = {
      ...this.newLeadData,
      leadCode: (this.newLeadData.leadCode || '').trim(),
      phone: this.buildPhone(),
    };
    // phoneCode is a form-only helper — the backend stores the combined phone.
    delete payload.phoneCode;
    if (!payload.leadCode) delete payload.leadCode;
    if (payload.value !== undefined && payload.value !== null) {
      payload.value = Math.max(0, Number(payload.value) || 0);
    }
    if (payload.source === 'Other' && this.customSource.trim()) {
      payload.source = this.customSource.trim();
    }

    if (this.isEditing && this.editingLeadId) {
      this.http.put<Lead>(`${environment.apiUrl}/crm/leads/${this.editingLeadId}`, payload).subscribe({
        next: (updated) => {
          this.isSaving = false;
          this.closeModal();
          this.toast.success('Lead updated successfully');
          this.loadLeads(() => this.highlightNewLead(updated.id));
          if (this.selectedLead && this.selectedLead.id === updated.id) {
            this.selectedLead = updated;
          }
        },
        error: (err) => {
          this.isSaving = false;
          this.toast.error(err?.error?.message || 'Failed to update lead.');
        }
      });
    } else {
      const saveLead = (data: any) => this.http.post<Lead>(`${environment.apiUrl}/crm/leads`, data).subscribe({
        next: (created) => {
          this.isSaving = false;
          this.closeModal();
          this.toast.success('Lead created successfully');
          this.loadLeads(() => this.highlightNewLead(created.id));
        },
        error: (err) => {
          this.isSaving = false;
          this.toast.error(err?.error?.message || 'Failed to save lead.');
        }
      });

      // A new contact must exist before the lead is saved so the lead's
      // broughtByContactId is persisted. This makes the Kanban/table record and
      // the contact profile refer to the same source record immediately.
      if (this.contactCheckboxChecked && !payload.broughtByContactId && this.newLeadData.contactName?.trim()) {
        const contactPayload = {
          name: this.newLeadData.contactName.trim(),
          email: this.newLeadData.email?.trim() || undefined,
          phone: this.buildPhone()?.trim() || undefined,
          companyName: this.newLeadData.companyName?.trim() || undefined,
          website: this.newLeadData.website?.trim() || undefined,
          address: this.newLeadData.address?.trim() || undefined,
          leadSource: payload.source || undefined,
        };
        this.http.post<any>(`${environment.apiUrl}/crm/lead-contacts`, contactPayload).subscribe({
          next: (contact) => {
            payload.broughtByContactId = contact.id;
            this.leadContacts = [contact, ...this.leadContacts];
            saveLead(payload);
          },
          error: (err) => {
            this.isSaving = false;
            this.toast.error(err?.error?.message || 'Failed to save the lead contact.');
          },
        });
      } else {
        saveLead(payload);
      }
    }
  }

  openDetailModal(lead: Lead) {
    this.selectedLead = lead;
    this.showDetailModal = true;
  }

  closeDetailModal() {
    this.showDetailModal = false;
    this.selectedLead = null;
  }

  getStatusLabel(status: string): string {
    return this.normalizeStatus(status);
  }

  // Status dot colours keyed by raw pipeline stage (lowercase, spaces -> '-').
  private readonly statusColorMap: Record<string, string> = {
    'new': '#2563eb',
    'interested': '#7c3aed',
    'schedule-meeting': '#0891b2',
    'proposal-sent': '#6d28d9',
    'negotiation': '#b45309',
    'on-hold': '#64748b',
    'win': '#059669',
    'lost': '#dc2626',
  };

  statusDotColor(status: string): string {
    const key = (status || '').toLowerCase().replace(/\s+/g, '-');
    return this.statusColorMap[key] || '#64748b';
  }

  // The lead id whose status menu is currently open (null = all closed).
  statusMenuOpen: number | null = null;

  toggleStatusMenu(lead: Lead, event: Event) {
    if (event) event.stopPropagation();
    this.statusMenuOpen = this.statusMenuOpen === lead.id ? null : lead.id;
  }

  selectStatus(lead: Lead, newStatus: string, event: Event) {
    if (event) event.stopPropagation();
    this.statusMenuOpen = null;
    this.updateLeadStatus(lead, newStatus, event);
  }

  @HostListener('document:click')
  onDocumentClick() {
    this.statusMenuOpen = null;
    this.actionMenuOpen = null;
  }

  // The lead id whose row action menu is currently open (null = all closed).
  actionMenuOpen: number | null = null;

  toggleActionMenu(lead: Lead, event: Event) {
    if (event) event.stopPropagation();
    this.actionMenuOpen = this.actionMenuOpen === lead.id ? null : lead.id;
  }

  closeActionMenu() {
    this.actionMenuOpen = null;
  }

  updateLeadStatus(lead: Lead, newStatus: string, event?: Event) {
    if (event) event.stopPropagation();
    if (!newStatus || newStatus === lead.status) return;
    if (this.isWinStage(newStatus)) {
      this.openPurchaseOrderModal(lead);
      return;
    }
    this.saveLeadStage(lead, newStatus);
  }

  private saveLeadStage(lead: Lead, newStatus: string) {
    const previous = lead.status;
    lead.status = newStatus;
    this.http.put(`${environment.apiUrl}/crm/leads/${lead.id}/status`, { status: newStatus }).subscribe({
      next: () => {
        if (this.viewMode === 'kanban') this.loadLeads();
      },
      error: () => {
        lead.status = previous;
      }
    });
  }

  private isWinStage(status: string): boolean {
    return ['WIN', 'WON'].includes((status || '').trim().toUpperCase());
  }

  openPurchaseOrderModal(lead: Lead) {
    this.pendingWinLead = lead;
    this.purchaseOrderFile = null;
    this.showPurchaseOrderModal = true;
  }

  closePurchaseOrderModal() {
    if (this.isUploadingPurchaseOrder) return;
    this.showPurchaseOrderModal = false;
    this.pendingWinLead = null;
    this.purchaseOrderFile = null;
  }

  onPurchaseOrderSelected(event: Event) {
    this.purchaseOrderFile = (event.target as HTMLInputElement).files?.[0] || null;
  }

  submitPurchaseOrder() {
    if (!this.pendingWinLead || !this.purchaseOrderFile) {
      this.toast.error('Attach the purchase order to move this lead to Win.');
      return;
    }
    this.isUploadingPurchaseOrder = true;
    const body = new FormData();
    body.append('file', this.purchaseOrderFile);
    body.append('purpose', 'PURCHASE_ORDER');
    this.http.post(`${environment.apiUrl}/crm/leads/${this.pendingWinLead.id}/files`, body).subscribe({
      next: () => {
        const lead = this.pendingWinLead!;
        this.http.put(`${environment.apiUrl}/crm/leads/${lead.id}/status`, { status: 'Win' }).subscribe({
          next: () => {
            this.toast.success('Purchase order attached and lead sent to Finance.');
            this.isUploadingPurchaseOrder = false;
            this.closePurchaseOrderModal();
            this.loadLeads();
          },
          error: (err) => {
            this.isUploadingPurchaseOrder = false;
            this.toast.error(err?.error?.message || 'Could not move the lead to Win.');
          }
        });
      },
      error: (err) => {
        this.isUploadingPurchaseOrder = false;
        this.toast.error(err?.error?.message || 'Failed to upload the purchase order.');
      }
    });
  }

  deleteLead(id: number, event: Event) {
    event.stopPropagation();
    if (confirm('Are you sure you want to delete this lead?')) {
      this.http.delete(`${environment.apiUrl}/crm/leads/${id}`).subscribe(() => {
        this.loadLeads();
      });
    }
  }

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // FOLLOW-UP MANAGEMENT METHODS
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  openFollowUpModal(lead: Lead, event?: Event) {
    if (event) event.stopPropagation();
    this.selectedLead = lead;
    this.showFollowUpModal = true;
    this.followUpTab = 'schedule';
    this.followUpStageMenuOpen = false;

    // Default scheduled time: Tomorrow at 10:00 AM local time
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);
    const tzOffset = tomorrow.getTimezoneOffset() * 60000;
    const localISOTime = (new Date(tomorrow.getTime() - tzOffset)).toISOString().slice(0, 16);

    this.newFollowUp = {
      title: `Follow-up with ${lead.contactName || lead.companyName || 'Client'}`,
      contactPerson: lead.contactName || '',
      contactPhone: lead.phone || '',
      contactEmail: lead.email || '',
      type: 'CALL',
      scheduledAt: localISOTime,
      notes: '',
      stage: this.normalizeStatus(lead.status)
    };
    this.pendingFollowUpFiles = [];

    this.loadLeadFollowUps(lead.id);
  }

  toggleFollowUpStageMenu(event: Event) {
    if (event) event.stopPropagation();
    this.followUpStageMenuOpen = !this.followUpStageMenuOpen;
  }

  selectFollowUpStage(stage: string, event: Event) {
    if (event) event.stopPropagation();
    this.newFollowUp.stage = stage;
    this.followUpStageMenuOpen = false;
  }

  closeFollowUpModal() {
    this.showFollowUpModal = false;
    this.followUpStageMenuOpen = false;
    this.pendingFollowUpFiles = [];
  }

  onFollowUpFilesSelected(event: Event) {
    const files = Array.from((event.target as HTMLInputElement).files || []);
    this.pendingFollowUpFiles = [...this.pendingFollowUpFiles, ...files];
  }

  removePendingFollowUpFile(index: number) {
    this.pendingFollowUpFiles.splice(index, 1);
  }

  private uploadFollowUpFiles(leadId: number, followUpId: number, files: File[]) {
    if (!files.length) return;
    this.isUploadingFollowUpFiles = true;
    let remaining = files.length;
    files.forEach(file => {
      const body = new FormData();
      body.append('file', file);
      this.http.post<any>(`${environment.apiUrl}/crm/leads/${leadId}/follow-ups/${followUpId}/files`, body).subscribe({
        next: () => {
          if (--remaining === 0) {
            this.isUploadingFollowUpFiles = false;
            this.loadLeadFollowUps(leadId);
            this.loadLeadFollowUpsForTable(leadId);
          }
        },
        error: () => {
          if (--remaining === 0) {
            this.isUploadingFollowUpFiles = false;
            this.toast.error('One or more follow-up attachments could not be uploaded.');
            this.loadLeadFollowUps(leadId);
            this.loadLeadFollowUpsForTable(leadId);
          }
        }
      });
    });
  }

  // Most recently scheduled follow-up already on file for this lead â€” shown as
  // read-only context when scheduling the next one, since there's no separate
  // "outcome" step anymore to surface it from.
  getPreviousFollowUpNote(): FollowUp | null {
    if (!this.leadFollowUps.length) return null;
    return [...this.leadFollowUps].sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime())[0];
  }

  loadLeadFollowUps(leadId: number) {
    this.isLoadingFollowUps = true;
    this.http.get<FollowUp[]>(`${environment.apiUrl}/crm/leads/${leadId}/follow-ups`).subscribe({
      next: (data) => {
        this.leadFollowUps = data;
        this.isLoadingFollowUps = false;
      },
      error: (err) => {
        console.error('Failed to load follow-ups', err);
        this.isLoadingFollowUps = false;
      }
    });
  }

  setQuickFollowUpTime(option: 'today_afternoon' | 'tomorrow_morning' | 'in_2_days' | 'next_week') {
    const d = new Date();
    if (option === 'today_afternoon') {
      d.setHours(15, 0, 0, 0);
    } else if (option === 'tomorrow_morning') {
      d.setDate(d.getDate() + 1);
      d.setHours(10, 0, 0, 0);
    } else if (option === 'in_2_days') {
      d.setDate(d.getDate() + 2);
      d.setHours(11, 0, 0, 0);
    } else if (option === 'next_week') {
      d.setDate(d.getDate() + 7);
      d.setHours(10, 0, 0, 0);
    }
    const tzOffset = d.getTimezoneOffset() * 60000;
    this.newFollowUp.scheduledAt = (new Date(d.getTime() - tzOffset)).toISOString().slice(0, 16);
  }

  createFollowUp() {
    if (!this.selectedLead) return;
    if (!this.newFollowUp.title.trim() || !this.newFollowUp.scheduledAt) {
      alert('Please enter a follow-up title and scheduled date & time.');
      return;
    }

    this.isSavingFollowUp = true;
    this.http.post<FollowUp>(`${environment.apiUrl}/crm/leads/${this.selectedLead.id}/follow-ups`, this.newFollowUp).subscribe({
      next: (created) => {
        this.isSavingFollowUp = false;
        this.leadFollowUps = [created, ...this.leadFollowUps];
        const files = [...this.pendingFollowUpFiles];
        this.pendingFollowUpFiles = [];
        this.uploadFollowUpFiles(this.selectedLead!.id, created.id, files);
        this.followUpTab = 'history';
        // Sync the deal's stage if it changed on this follow-up
        if (this.newFollowUp.stage && this.newFollowUp.stage !== this.selectedLead!.status) {
          this.updateLeadStatus(this.selectedLead!, this.newFollowUp.stage);
        }
        // Reset form for next entry
        this.setQuickFollowUpTime('tomorrow_morning');
        this.newFollowUp.notes = '';
      },
      error: (err) => {
        this.isSavingFollowUp = false;
        alert(err?.error?.message || 'Failed to schedule follow-up.');
      }
    });
  }

  updateFollowUpNotes(f: FollowUp, notes: string) {
    if (!this.selectedLead) return;
    this.http.put<FollowUp>(
      `${environment.apiUrl}/crm/leads/${this.selectedLead.id}/follow-ups/${f.id}`,
      { notes }
    ).subscribe({
      next: (updated) => {
        this.leadFollowUps = this.leadFollowUps.map(x => x.id === updated.id ? updated : x);
      },
      error: (err) => {
        alert(err?.error?.message || 'Failed to update notes.');
      }
    });
  }

  deleteFollowUp(followUpId: number, event?: Event) {
    if (event) event.stopPropagation();
    if (!this.selectedLead) return;
    if (confirm('Are you sure you want to delete this follow-up?')) {
      this.http.delete(`${environment.apiUrl}/crm/leads/${this.selectedLead.id}/follow-ups/${followUpId}`).subscribe({
        next: () => {
          this.leadFollowUps = this.leadFollowUps.filter(f => f.id !== followUpId);
        },
        error: (err) => {
          alert(err?.error?.message || 'Failed to delete follow-up.');
        }
      });
    }
  }

  getUpcomingFollowUps(): FollowUp[] {
    const now = new Date();
    return this.leadFollowUps.filter(f => new Date(f.scheduledAt) >= now);
  }

  getPastFollowUps(): FollowUp[] {
    const now = new Date();
    return this.leadFollowUps.filter(f => new Date(f.scheduledAt) < now)
      .sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime());
  }

  isFollowUpOverdue(scheduledAt: string | Date): boolean {
    return new Date(scheduledAt) < new Date();
  }

  getFollowUpTypeBadge(type: string): { label: string, color: string, bg: string } {
    switch (type) {
      case 'CALL': return { label: 'Phone Call', color: '#0284c7', bg: '#e0f2fe' };
      case 'MEETING': return { label: 'Meeting', color: '#7c3aed', bg: '#f5f3ff' };
      case 'DEMO': return { label: 'Product Demo', color: '#ea580c', bg: '#fff7ed' };
      case 'EMAIL': return { label: 'Email', color: '#059669', bg: '#ecfdf5' };
      case 'FIELD_VISIT': return { label: 'Field Visit', color: '#d97706', bg: '#fffbeb' };
      case 'NOTE': return { label: 'Note / Task', color: '#475569', bg: '#f1f5f9' };
      default: return { label: type, color: '#64748b', bg: '#f8fafc' };
    }
  }

  getFollowUpTypeClass(type: string): string {
    switch (type) {
      case 'CALL': return 'type-badge-call';
      case 'EMAIL': return 'type-badge-email';
      case 'MEETING': return 'type-badge-meeting';
      case 'DEMO': return 'type-badge-demo';
      case 'FIELD_VISIT': return 'type-badge-visit';
      default: return 'type-badge-default';
    }
  }

  getFollowUpStatusLabel(status?: string): string {
    if (!status) return 'Pending';
    return status.charAt(0) + status.slice(1).toLowerCase();
  }

  // Map legacy follow-up status values (PENDING/COMPLETED/CANCELLED) onto the
  // current deal-stage set so the table Stage dropdown always shows a valid value.
  getFollowUpStage(status?: string): string {
    const s = (status || '').toUpperCase().replace(/_/g, ' ');
    switch (s) {
      case 'PENDING':
      case 'COMPLETED':
      case '':
      case 'NEW': return 'New';
      case 'CANCELLED':
      case 'LOST': return 'Lost';
      default: return this.normalizeStatus(status);
    }
  }

  getFollowUpStatusClass(status?: string): string {
    const s = (status || '').toUpperCase().replace(/_/g, ' ');
    switch (s) {
      case 'WON':
      case 'WIN': return 'fup-status-completed';
      case 'LOST': return 'fup-status-cancelled';
      case 'COMPLETED': return 'fup-status-completed';
      case 'CANCELLED': return 'fup-status-cancelled';
      case 'PENDING':
      case '':
      case 'NEW': return 'fup-status-pending';
      default: return 'fup-status-pending';
    }
  }

  isFollowUpStatusSaving(fuId: number): boolean {
    return !!this.followUpStatusSaving[fuId];
  }

  updateFollowUpStatus(lead: Lead, fu: FollowUp, status: string) {
    if (!fu || !fu.id || !status) return;
    this.followUpStatusSaving[fu.id] = true;
    this.http.put<FollowUp>(`${environment.apiUrl}/crm/leads/${lead.id}/follow-ups/${fu.id}`, { status }).subscribe({
      next: (updated) => {
        const cache = this.leadFollowUpsCache[lead.id] || [];
        this.leadFollowUpsCache[lead.id] = cache.map(x => x.id === updated.id ? { ...x, status: updated.status } : x);
        this.followUpStatusSaving[fu.id] = false;
        // Sync the deal stage whenever the follow-up stage changes in the table
        if (status !== lead.status) {
          this.updateLeadStatus(lead, status);
        }
      },
      error: (err) => {
        this.followUpStatusSaving[fu.id] = false;
        console.error('Failed to update follow-up status', err);
      },
    });
  }

  toggleFollowUpTableStageMenu(fu: FollowUp, event: Event) {
    if (event) event.stopPropagation();
    this.followUpTableStageMenu = this.followUpTableStageMenu === fu.id ? null : fu.id;
  }

  selectFollowUpTableStage(lead: Lead, fu: FollowUp, stage: string, event: Event) {
    if (event) event.stopPropagation();
    this.followUpTableStageMenu = null;
    this.updateFollowUpStatus(lead, fu, stage);
  }

  isLeadExpanded(lead: Lead): boolean {
    return this.expandedLeadId === lead.id;
  }

  toggleLeadFollowUps(lead: Lead, event: Event) {
    if (event) event.stopPropagation();
    this.followUpTableStageMenu = null;
    if (this.isLeadExpanded(lead)) {
      this.expandedLeadId = null;
      return;
    }
    this.expandedLeadId = lead.id;
    if (!this.leadFollowUpsCache[lead.id] && !this.leadFollowUpsLoading[lead.id]) {
      this.loadLeadFollowUpsForTable(lead.id);
    }
    const i = this.leadFollowUpsExpandedIds.indexOf(lead.id);
    if (i === -1) this.leadFollowUpsExpandedIds.push(lead.id);
  }

  loadLeadFollowUpsForTable(leadId: number) {
    this.leadFollowUpsLoading[leadId] = true;
    this.http.get<FollowUp[]>(`${environment.apiUrl}/crm/leads/${leadId}/follow-ups`).subscribe({
      next: (data) => {
        this.leadFollowUpsCache[leadId] = data || [];
        this.leadFollowUpsLoading[leadId] = false;
      },
      error: () => {
        this.leadFollowUpsCache[leadId] = [];
        this.leadFollowUpsLoading[leadId] = false;
      }
    });
  }

  isLeadFollowUpsLoading(leadId: number): boolean {
    return !!this.leadFollowUpsLoading[leadId];
  }

  leadFollowUpsLoaded(leadId: number): boolean {
    return this.leadFollowUpsCache[leadId] !== undefined;
  }

  private followUpInRange(fu: FollowUp): boolean {
    const d = +new Date(fu.scheduledAt);
    if (!d) return false;
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    switch (this.followUpDateFilter) {
      case 'today': {
        const end = new Date(startOfToday);
        end.setDate(end.getDate() + 1);
        return d >= +startOfToday && d < +end;
      }
      case 'thisWeek': {
        const ws = new Date(startOfToday);
        ws.setDate(ws.getDate() - ((ws.getDay() + 6) % 7));
        const we = new Date(ws);
        we.setDate(we.getDate() + 7);
        return d >= +ws && d < +we;
      }
      case 'lastMonth': {
        const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const e = new Date(now.getFullYear(), now.getMonth(), 1);
        return d >= +s && d < +e;
      }
      case 'thisMonth': {
        const s = new Date(now.getFullYear(), now.getMonth(), 1);
        const e = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        return d >= +s && d < +e;
      }
      case 'last30': {
        const s = new Date(startOfToday);
        s.setDate(s.getDate() - 30);
        return d >= +s && d < +startOfToday;
      }
      case 'last90': {
        const s = new Date(startOfToday);
        s.setDate(s.getDate() - 90);
        return d >= +s && d < +startOfToday;
      }
      case 'thisYear': {
        const s = new Date(now.getFullYear(), 0, 1);
        const e = new Date(now.getFullYear() + 1, 0, 1);
        return d >= +s && d < +e;
      }
      case 'lastYear': {
        const s = new Date(now.getFullYear() - 1, 0, 1);
        const e = new Date(now.getFullYear(), 0, 1);
        return d >= +s && d < +e;
      }
      case 'custom': {
        let ok = true;
        if (this.followUpStartDate) {
          const s = new Date(this.followUpStartDate);
          s.setHours(0, 0, 0, 0);
          ok = ok && d >= +s;
        }
        if (this.followUpEndDate) {
          const e = new Date(this.followUpEndDate);
          e.setHours(23, 59, 59, 999);
          ok = ok && d <= +e;
        }
        return ok;
      }
      default:
        return true;
    }
  }

  getLeadFollowUps(lead: Lead): FollowUp[] {
    const all = this.leadFollowUpsCache[lead.id] || [];
    return all.filter((fu) => this.followUpInRange(fu));
  }

  getLeadFollowUpCount(lead: Lead): number {
    return (this.leadFollowUpsCache[lead.id] || []).length;
  }

  // True when the lead has at least one overdue (past-dated) follow-up.
  hasOverdueFollowUp(lead: Lead): boolean {
    const followUps = this.leadFollowUpsCache[lead.id] || [];
    if (followUps.length === 0) return false;
    const now = new Date().getTime();
    return followUps.some(f => {
      const t = new Date(f.scheduledAt).getTime();
      return !isNaN(t) && t < now;
    });
  }

  setFollowUpDateFilter(filter: string) {
    this.followUpDateFilter = filter;
    if (filter === 'custom' && (!this.followUpStartDate || !this.followUpEndDate)) {
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - 30);
      // Local Y-M-D. toISOString() shifts to UTC and lands on the previous day
      // for anyone east of Greenwich, which is everyone here.
      this.followUpStartDate = this.followUpStartDate || this.toLocalDateInput(start);
      this.followUpEndDate = this.followUpEndDate || this.toLocalDateInput(end);
    }
    // Without this the board keeps showing the previous result set.
    this.onFilterChange();
  }

  private toLocalDateInput(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  clearFollowUpDateFilter() {
    this.followUpDateFilter = 'all';
    this.followUpStartDate = '';
    this.followUpEndDate = '';
    this.onFilterChange();
  }

  isFollowUpToday(dateStr: string): boolean {
    if (!dateStr) return false;
    return new Date(dateStr).toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10);
  }

  isFollowUpTomorrow(dateStr: string): boolean {
    if (!dateStr) return false;
    const d = new Date(dateStr).toISOString().slice(0, 10);
    const t = new Date();
    t.setDate(t.getDate() + 1);
    return d === t.toISOString().slice(0, 10);
  }

  getAssignedName(assignedTo?: FollowUp['assignedTo']): string {
    if (!assignedTo) return '';
    return `${assignedTo.firstName || ''} ${assignedTo.lastName || ''}`.trim();
  }
}
