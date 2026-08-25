import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';

import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { CdkDragDrop, DragDropModule, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import { FieldVisitsService, FieldVisit } from '../../services/field-visits';
import { AuthService } from '../../services/auth.service';
import {
  LucidePlus,
  LucideGripVertical,
  LucideBuilding,
  LucidePhone,
  LucideMail,
  LucideDollarSign,
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
  LucideClock, LucideCalendarClock, LucideMessageSquare, LucideVideo, LucideCheck,
  LucideUsers, LucideAward, LucideExternalLink,
  LucideTrendingUp, LucideLayers, LucideBuilding2, LucideGhost
} from '@lucide/angular';

export interface FollowUp {
  id: number;
  leadId: number;
  title: string;
  contactPerson?: string;
  contactPhone?: string;
  contactEmail?: string;
  type: 'CALL' | 'MEETING' | 'DEMO' | 'EMAIL' | 'FIELD_VISIT' | 'NOTE' | 'OTHER';
  status: 'PENDING' | 'COMPLETED' | 'CANCELLED';
  scheduledAt: string;
  completedAt?: string;
  notes?: string;
  outcome?: string;
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
}

@Component({
  selector: 'app-leads',
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule, 
    DragDropModule, 
    LucidePlus, 
    LucideGripVertical, 
    LucideBuilding, 
    LucidePhone, 
    LucideMail, 
    LucideDollarSign, 
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
    LucideClock, LucideCalendarClock, LucideMessageSquare, LucideVideo, LucideCheck,
    LucideUsers, LucideAward, LucideExternalLink,
    LucideTrendingUp, LucideLayers, LucideBuilding2, LucideGhost
  ],
  templateUrl: './leads.html',
  styleUrls: ['./leads.css']
})
export class LeadsComponent implements OnInit {
  leads: Lead[] = [];
  isLoading = true;
  isSaving = false;
  isSubmitted = false;
  showCreateModal = false;
  showDetailModal = false;
  selectedLead: Lead | null = null;
  
  // Filter states
  searchQuery = '';
  selectedStage = 'ALL';
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
    notes: '',
    assignedToId: null as number | null
  };

  followUpOwnerSearchQuery = '';
  showFollowUpOwnerDropdown = false;

  // Outcome Logging
  completingFollowUp: FollowUp | null = null;
  outcomeText = '';
  isSavingOutcome = false;

  // Field Visits
  selectedFieldVisit: FieldVisit | null = null;


  // Field Visits widget — company-wide "who's travelling" panel
  activeFieldVisits: FieldVisit[] = [];
  recentFieldVisits: FieldVisit[] = [];
  fieldVisitsLoading = true;
  fieldVisitsExpanded = false;

  constructor(private http: HttpClient, private fieldVisitsService: FieldVisitsService, private router: Router, public auth: AuthService) {}

  ngOnInit() {
    this.loadLeads();
    this.loadFieldVisitsWidget();
    this.loadEmployees();
    this.loadLeadContacts();
  }

  goToFollowUps() {
    this.router.navigate(['/sales/follow-ups']);
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

  loadLeads() {
    this.isLoading = true;
    this.http.get<Lead[]>(`${environment.apiUrl}/crm/leads`).subscribe(data => {
      this.leads = data;
      this.distributeLeads();
      this.isLoading = false;
    }, error => {
      this.isLoading = false;
      console.error('Failed to load leads', error);
    });
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

  getFilteredLeads(): Lead[] {
    return this.leads.filter(lead => {
      const matchesSearch = 
        !this.searchQuery.trim() ||
        lead.title?.toLowerCase().includes(this.searchQuery.toLowerCase()) ||
        lead.companyName?.toLowerCase().includes(this.searchQuery.toLowerCase()) ||
        lead.contactName?.toLowerCase().includes(this.searchQuery.toLowerCase()) ||
        lead.email?.toLowerCase().includes(this.searchQuery.toLowerCase());

      const normalized = this.normalizeStatus(lead.status);
      const matchesStage = 
        this.selectedStage === 'ALL' || normalized === this.selectedStage;

      return matchesSearch && matchesStage;
    });
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

  clearFilters() {
    this.searchQuery = '';
    this.selectedStage = 'ALL';
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

  closeModal() {
    if (this.isSaving) return;
    this.showCreateModal = false;
    this.isSubmitted = false;
    this.isEditing = false;
    this.editingLeadId = null;
    this.customSource = '';
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
          this.loadLeads();
          if (this.selectedLead && this.selectedLead.id === updated.id) {
            this.selectedLead = updated;
          }
        },
        error: (err) => {
          this.isSaving = false;
          alert(err?.error?.message || 'Failed to update lead.');
        }
      });
    } else {
      this.http.post<Lead>(`${environment.apiUrl}/crm/leads`, payload).subscribe({
        next: () => {
          this.isSaving = false;
          this.closeModal();
          this.loadLeads();
        },
        error: (err) => {
          this.isSaving = false;
          alert(err?.error?.message || 'Failed to save lead.');
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
    this.completingFollowUp = null;
    this.outcomeText = '';

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
      assignedToId: lead.assignedTo?.id || (lead as any).assignedToId || null
    };

    this.loadLeadFollowUps(lead.id);
  }

  closeFollowUpModal() {
    this.showFollowUpModal = false;
    this.completingFollowUp = null;
    this.outcomeText = '';
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

  getFilteredFollowUpEmployees(): any[] {
    if (!this.followUpOwnerSearchQuery.trim()) return this.employees;
    const q = this.followUpOwnerSearchQuery.toLowerCase();
    return this.employees.filter(e => 
      `${e.firstName} ${e.lastName}`.toLowerCase().includes(q) ||
      e.designation?.name?.toLowerCase().includes(q)
    );
  }

  getSelectedFollowUpOwner(): any {
    if (!this.newFollowUp.assignedToId) return null;
    return this.employees.find(e => e.id === this.newFollowUp.assignedToId);
  }

  selectFollowUpOwner(emp: any) {
    this.newFollowUp.assignedToId = emp ? emp.id : null;
    this.showFollowUpOwnerDropdown = false;
    this.followUpOwnerSearchQuery = '';
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

  startCompleteFollowUp(f: FollowUp) {
    this.completingFollowUp = f;
    this.outcomeText = '';
  }

  cancelCompleteFollowUp() {
    this.completingFollowUp = null;
    this.outcomeText = '';
  }

  submitFollowUpOutcome(status: 'COMPLETED' | 'CANCELLED') {
    if (!this.selectedLead || !this.completingFollowUp) return;
    this.isSavingOutcome = true;
    this.http.put<FollowUp>(
      `${environment.apiUrl}/crm/leads/${this.selectedLead.id}/follow-ups/${this.completingFollowUp.id}`,
      { status, outcome: this.outcomeText }
    ).subscribe({
      next: () => {
        this.isSavingOutcome = false;
        this.completingFollowUp = null;
        this.outcomeText = '';
        this.loadLeadFollowUps(this.selectedLead!.id);
      },
      error: (err) => {
        this.isSavingOutcome = false;
        alert(err?.error?.message || 'Failed to update follow-up status.');
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

  getPendingFollowUps(): FollowUp[] {
    return this.leadFollowUps.filter(f => f.status === 'PENDING');
  }

  getCompletedFollowUps(): FollowUp[] {
    return this.leadFollowUps.filter(f => f.status === 'COMPLETED' || f.status === 'CANCELLED');
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
