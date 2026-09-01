import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';

import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { CdkDragDrop, DragDropModule, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import { FieldVisitsService, FieldVisit } from '../../services/field-visits';
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
  LucideMapPin,
  LucideChevronDown,
  LucideChevronUp, LucideLayoutGrid, LucideList,
  LucideGlobe, LucideTag, LucideUserCheck,
  LucideClock, LucideCalendarClock, LucideVideo, LucideCheck, LucideHistory,
  LucideUsers, LucideAward, LucideExternalLink,
  LucideTrendingUp, LucideLayers, LucideBuilding2, LucideGhost,
  LucideRotateCcw, LucideSlidersHorizontal, LucideIndianRupee, LucideArrowUpDown, LucideSparkles,
  LucideUpload, LucideDownload
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
  assignedToId?: number;
  assignedTo?: { id: number, firstName: string, lastName: string, avatarUrl?: string, designation?: { name: string } };
  createdAt: string;
}

interface Lead {
  id: number;
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
    LucideMapPin,
    LucideChevronDown,
    LucideChevronUp, LucideLayoutGrid, LucideList,
    LucideGlobe, LucideTag, LucideUserCheck,
    LucideClock, LucideCalendarClock, LucideVideo, LucideCheck, LucideHistory,
    LucideUsers, LucideAward, LucideExternalLink,
    LucideTrendingUp, LucideLayers, LucideBuilding2, LucideGhost,
    LucideRotateCcw, LucideSlidersHorizontal, LucideIndianRupee, LucideArrowUpDown, LucideSparkles,
    LucideUpload, LucideDownload
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

  minValue: number | null = null;
  maxValue: number | null = null;
  dateField: 'createdAt' | 'expectedCloseDate' = 'createdAt';
  datePreset: 'ALL' | 'TODAY' | 'THIS_WEEK' | 'THIS_MONTH' | 'NEXT_MONTH' | 'THIS_QUARTER' | 'CUSTOM' = 'ALL';
  dateStart = '';
  dateEnd = '';
  sortBy: 'newest' | 'oldest' | 'value_desc' | 'value_asc' | 'closing_soon' = 'newest';
  showAdvancedFilters = false;

  ownerSearchQuery = '';
  showOwnerDropdown = false;
  broughtBySearchQuery = '';
  showBroughtByDropdown = false;


  // All 17 Statuses
  LEAD_STATUSES = [
    'New', 'Interested', 'Proposal Sent', 'Negotiation', 
    'On Hold', 'Converted', 'Lost', 'Junk'
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

  kanbanColumns: { id: string, name: string, leads: Lead[] }[] = [];
  highlightedLeadId: number | null = null;

  // Lead Form
  isEditing = false;
  editingLeadId: number | null = null;
  activeTab = 1;
  employees: any[] = [];
  
  newLeadData = {
    title: '',
    subjectLine: '',
    dealCategory: 'Inbound',
    companyName: '',
    contactName: '',
    email: '',
    phone: '',
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
  
  newFollowUp = {
    title: '',
    contactPerson: '',
    contactPhone: '',
    contactEmail: '',
    type: 'CALL' as 'CALL' | 'MEETING' | 'DEMO' | 'EMAIL' | 'FIELD_VISIT' | 'NOTE' | 'OTHER',
    scheduledAt: '',
    notes: ''
  };

  // Field Visits
  selectedFieldVisit: FieldVisit | null = null;


  // Field Visits widget — company-wide "who's travelling" panel
  activeFieldVisits: FieldVisit[] = [];
  recentFieldVisits: FieldVisit[] = [];
  fieldVisitsLoading = true;
  fieldVisitsExpanded = false;

  constructor(private http: HttpClient, private fieldVisitsService: FieldVisitsService, private router: Router, public auth: AuthService, private toast: HotToastService) {}

  ngOnInit() {
    this.loadLeads();
    this.loadFieldVisitsWidget();
    this.loadEmployees();
    this.loadLeadContacts();
  }

  goToFollowUps() {
    this.router.navigate(['/sales/follow-ups']);
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

  loadFieldVisitsWidget() {
    this.fieldVisitsLoading = true;
    this.fieldVisitsService.getCompanyActiveVisits().subscribe({
      next: (visits) => this.activeFieldVisits = visits,
      error: (err) => console.error('Failed to load active field visits', err),
    });
    this.fieldVisitsService.getCompanyRecentVisits(6).subscribe({
      next: (visits) => {
        this.recentFieldVisits = visits;
        this.fieldVisitsLoading = false;
      },
      error: (err) => {
        console.error('Failed to load recent field visits', err);
        this.fieldVisitsLoading = false;
      },
    });
  }

  openFieldVisit(visit: FieldVisit) {
    this.selectedFieldVisit = visit;
  }

  closeFieldVisit() {
    this.selectedFieldVisit = null;
  }

  fieldVisitStatusColor(status: string) {
    if (status === 'COMPLETED') return { bg: '#dcfce7', text: '#166534' };
    if (status === 'CANCELLED') return { bg: '#fee2e2', text: '#991b1b' };
    return { bg: '#fef9c3', text: '#854d0e' };
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
    this.showBroughtByDropdown = false;
    this.broughtBySearchQuery = '';
  }

  selectBroughtByContact(contact: any) {
    this.newLeadData.broughtByContactId = contact ? contact.id : null;
    this.newLeadData.addedById = null;
    this.showBroughtByDropdown = false;
    this.broughtBySearchQuery = '';
  }

  // ═══════════════════════════════════════════
  // LEAD CONTACTS ("Lead Brought By" source records)
  // ═══════════════════════════════════════════

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
            this.newLeadData.phone = created.mobile || created.phone || '';
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
    if (s === 'CONVERTED' || s === 'WON') return 'Converted';
    if (s === 'LOST') return 'Lost';
    if (s === 'JUNK') return 'Junk';
    
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
    return { start: null, end: null };
  }

  // Follow-up status is derived from `scheduledAt` on the lead's follow-ups — there's
  // no separate status field (removed from the model; a follow-up is just a logged
  // interaction). "Overdue" = earliest upcoming follow-up already in the past.
  private getLeadFollowUpStatus(lead: Lead): 'OVERDUE' | 'SCHEDULED' | 'NONE' {
    const followUps = lead.followUps || [];
    if (followUps.length === 0) return 'NONE';
    const now = new Date();
    const hasOverdue = followUps.some(f => new Date(f.scheduledAt) < now);
    return hasOverdue ? 'OVERDUE' : 'SCHEDULED';
  }

  getFilteredLeads(): Lead[] {
    const q = this.searchQuery.trim().toLowerCase();
    const { start, end } = this.getDateRangeForPreset();

    const filtered = this.leads.filter(lead => {
      const matchesSearch =
        !q ||
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

      const hasQuotation = (lead.quotations?.length || 0) > 0;
      const matchesQuotation =
        this.selectedQuotationStatus === 'ALL' ||
        (this.selectedQuotationStatus === 'QUOTED' ? hasQuotation : !hasQuotation);

      const matchesFollowUpStatus =
        this.selectedFollowUpStatus === 'ALL' || this.getLeadFollowUpStatus(lead) === this.selectedFollowUpStatus;

      const value = Number(lead.value) || 0;
      const matchesMin = this.minValue === null || this.minValue === undefined || value >= this.minValue;
      const matchesMax = this.maxValue === null || this.maxValue === undefined || value <= this.maxValue;

      let matchesDate = true;
      if (start || end) {
        const raw = this.dateField === 'expectedCloseDate' ? lead.expectedCloseDate : lead.createdAt;
        if (!raw) {
          matchesDate = false;
        } else {
          const d = new Date(raw);
          matchesDate = (!start || d >= start) && (!end || d <= end);
        }
      }

      return matchesSearch && matchesStage && matchesRep && matchesCategory &&
        matchesSource && matchesContact && matchesAddedBy && matchesQuotation &&
        matchesFollowUpStatus && matchesMin && matchesMax && matchesDate;
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
      const max = this.maxValue !== null ? this.maxValue.toLocaleString() : '∞';
      chips.push({ key: 'value', label: `Value: ${min} - ${max}`, clear: () => { this.minValue = null; this.maxValue = null; this.onFilterChange(); } });
    }
    if (this.datePreset !== 'ALL') {
      const fieldLabel = this.dateField === 'expectedCloseDate' ? 'Closing' : 'Created';
      const presetLabel = this.datePreset === 'CUSTOM' ? `${this.dateStart || '…'} to ${this.dateEnd || '…'}` : this.datePreset.replace('_', ' ');
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
    this.sortBy = 'newest';
    this.distributeLeads();
  }

  getTotalPipelineValue(): number {
    return this.leads.reduce((sum, lead) => sum + (Number(lead.value) || 0), 0);
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

      // Status update logic based on container ID
      const newStatus = event.container.id; 
      const lead = event.container.data[event.currentIndex];
      
      lead.status = newStatus;
      this.http.put(`${environment.apiUrl}/crm/leads/${lead.id}/status`, { status: newStatus }).subscribe(() => {
        // Reload to update pipeline metrics
        this.loadLeads();
      });
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
      title: '', subjectLine: '', dealCategory: 'Inbound', companyName: '', contactName: '', email: '', phone: '', website: '', address: '',
      value: 0, currency: 'INR', status: 'New', source: 'Website / Inbound', assignedToId: null, addedById: null, broughtByContactId: null,
      description: '', qualificationReason: '', expectedCloseDate: ''
    };
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
      title: lead.title || '',
      subjectLine: lead.subjectLine || '',
      dealCategory: lead.dealCategory || 'Inbound',
      companyName: lead.companyName || '',
      contactName: lead.contactName || '',
      email: lead.email || '',
      phone: lead.phone || '',
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

  createLead() {
    this.isSubmitted = true;

    // Validation: Title, Company Name, Email, and Phone are required
    const isTab1Valid = this.newLeadData.title.trim() && this.newLeadData.companyName.trim() && this.newLeadData.email.trim() && this.newLeadData.phone.trim();
    
    if (!isTab1Valid) {
      this.activeTab = 1;
      return;
    }

    this.isSaving = true;

    const payload = { ...this.newLeadData };
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
      this.http.post<Lead>(`${environment.apiUrl}/crm/leads`, payload).subscribe({
        next: (created) => {
          this.isSaving = false;
          if (this.contactCheckboxChecked && this.newLeadData.contactName?.trim()) {
            const contactPayload = {
              name: this.newLeadData.contactName.trim(),
              email: this.newLeadData.email?.trim() || undefined,
              phone: this.newLeadData.phone?.trim() || undefined,
              companyName: this.newLeadData.companyName?.trim() || undefined,
            };
            this.http.post(`${environment.apiUrl}/crm/lead-contacts`, contactPayload).subscribe({
              next: () => this.loadLeadContacts(),
              error: () => {},
            });
          }
          this.closeModal();
          this.toast.success('Lead created successfully');
          this.loadLeads(() => this.highlightNewLead(created.id));
        },
        error: (err) => {
          this.isSaving = false;
          this.toast.error(err?.error?.message || 'Failed to save lead.');
        }
      });
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

  deleteLead(id: number, event: Event) {
    event.stopPropagation();
    if (confirm('Are you sure you want to delete this lead?')) {
      this.http.delete(`${environment.apiUrl}/crm/leads/${id}`).subscribe(() => {
        this.loadLeads();
      });
    }
  }

  // ═══════════════════════════════════════════
  // FOLLOW-UP MANAGEMENT METHODS
  // ═══════════════════════════════════════════

  openFollowUpModal(lead: Lead, event?: Event) {
    if (event) event.stopPropagation();
    this.selectedLead = lead;
    this.showFollowUpModal = true;
    this.followUpTab = 'schedule';

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
      notes: ''
    };

    this.loadLeadFollowUps(lead.id);
  }

  closeFollowUpModal() {
    this.showFollowUpModal = false;
  }

  // Most recently scheduled follow-up already on file for this lead — shown as
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
        this.followUpTab = 'history';
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

  isFollowUpOverdue(scheduledAt: string): boolean {
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

  getDealCategoryBadge(category?: string): { label: string, color: string, bg: string, border: string } {
    switch (category) {
      case 'Inbound': return { label: 'Inbound', color: '#0284c7', bg: '#f0f9ff', border: '#bae6fd' };
      case 'Outbound': return { label: 'Outbound', color: '#7c3aed', bg: '#faf5ff', border: '#e9d5ff' };
      case 'Referral': return { label: 'Referral', color: '#059669', bg: '#f0fdf4', border: '#bbf7d0' };
      case 'Enterprise': return { label: 'Enterprise', color: '#d97706', bg: '#fffbeb', border: '#fde68a' };
      case 'Retainer': return { label: 'Retainer', color: '#4338ca', bg: '#eef2ff', border: '#c7d2fe' };
      default: return { label: category || 'Inbound', color: '#64748b', bg: '#f8fafc', border: '#e2e8f0' };
    }
  }
}
