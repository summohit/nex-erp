import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import {
  LucideUser,
  LucideGlobe,
  LucideUserCheck,
  LucideTag,
  LucidePhone,
  LucideMail,
  LucideCalendar,
  LucideCalendarClock,
  LucideBriefcase,
  LucideFileText,
  LucideCheckCircle,
  LucideClock,
  LucideBuilding,
  LucideFilter,
  LucideSearch,
  LucideLayoutGrid,
  LucideList,
  LucideArrowLeft,
  LucideExternalLink,
  LucideCheck,
  LucideX,
  LucideAlertCircle,
  LucideVideo,
  LucideMapPin,
  LucideChevronDown,
  LucideRotateCcw,
  LucidePlus,
  LucideEye,
  LucideLoader2,
  LucideMessageSquare,
  LucideHistory,
  LucideMoreHorizontal,
  LucideMoreVertical
} from '@lucide/angular';
import { MatMenuModule } from '@angular/material/menu';
import { AuthService } from '../../services/auth.service';
import { Router, ActivatedRoute } from '@angular/router';

export interface FollowUpItem {
  id: number;
  leadId: number;
  title: string;
  contactPerson?: string;
  contactPhone?: string;
  contactEmail?: string;
  type: string;
  status: 'PENDING' | 'COMPLETED' | 'CANCELLED';
  scheduledAt: string;
  completedAt?: string;
  notes?: string;
  outcome?: string;
  assignedToId?: number;
  assignedTo?: {
    id: number;
    firstName: string;
    lastName: string;
    avatarUrl?: string;
    department?: { name: string };
    designation?: { name: string };
  };
  lead?: {
    id: number;
    title: string;
    companyName: string;
    status: string;
    value?: number;
    subjectLine?: string;
    dealCategory?: string;
    contactName?: string;
    contactPerson?: string;
    phone?: string;
    contactPhone?: string;
    email?: string;
    contactEmail?: string;
    followUps?: any[];
  };
}

@Component({
  selector: 'app-follow-ups',
  standalone: true,
  imports: [
    CommonModule,
    LucideGlobe,
    LucideUserCheck,
    LucideTag,
    FormsModule,
    LucideUser,
    LucidePhone,
    LucideMail,
    LucideCalendar,
    LucideCalendarClock,
    LucideBriefcase,
    LucideFileText,
    LucideCheckCircle,
    LucideClock,
    LucideBuilding,
    LucideFilter,
    LucideSearch,
    LucideLayoutGrid,
    LucideList,
    LucideArrowLeft,
    LucideExternalLink,
    LucideCheck,
    LucideX,
    LucideAlertCircle,
    LucideVideo,
    LucideMapPin,
    LucideChevronDown,
    LucideRotateCcw,
    LucidePlus,
    LucideEye,
    LucideLoader2,
    LucideMessageSquare,
    LucideHistory,
    LucideMoreHorizontal,
    LucideMoreVertical,
    MatMenuModule
  ],
  providers: [DatePipe],
  templateUrl: './follow-ups.html',
  styleUrls: ['./follow-ups.css']
})
export class FollowUpsComponent implements OnInit {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  followUps = signal<FollowUpItem[]>([]);
  employees = signal<any[]>([]);
  isLoading = signal<boolean>(false);
  error = signal<string | null>(null);

  // View mode
  viewMode = signal<'table' | 'cards'>('table');

  // Search & Filter state
  searchQuery = signal<string>('');
  filterDate = signal<string>('upcoming'); // 'today' | 'tomorrow' | 'upcoming' | 'overdue' | 'all' | 'custom'
  filterAssignee = signal<string>('');
  filterStatus = signal<string>('PENDING'); // 'PENDING' | 'COMPLETED' | 'all'
  filterType = signal<string>('all'); // 'all' | 'CALL' | 'MEETING' | 'DEMO' | 'EMAIL' | 'FIELD_VISIT'
  filterStartDate = signal<string>('');
  filterEndDate = signal<string>('');

  today = new Date();

  // Filtered list with instant search
  filteredFollowUps = computed(() => {
    let list = this.followUps();
    const query = this.searchQuery().trim().toLowerCase();
    const typeFilter = this.filterType();

    if (typeFilter !== 'all') {
      list = list.filter(item => item.type?.toUpperCase() === typeFilter);
    }

    if (query) {
      list = list.filter(item => {
        const company = item.lead?.companyName?.toLowerCase() || '';
        const title = item.title?.toLowerCase() || '';
        const leadTitle = item.lead?.title?.toLowerCase() || item.lead?.subjectLine?.toLowerCase() || '';
        const contact = (item.contactPerson || item.lead?.contactName || item.lead?.contactPerson || '').toLowerCase();
        const phone = (item.contactPhone || item.lead?.phone || item.lead?.contactPhone || '').toLowerCase();
        const email = (item.contactEmail || item.lead?.email || item.lead?.contactEmail || '').toLowerCase();
        const notes = item.notes?.toLowerCase() || '';
        const rep = item.assignedTo ? `${item.assignedTo.firstName} ${item.assignedTo.lastName}`.toLowerCase() : '';

        return company.includes(query) ||
          title.includes(query) ||
          leadTitle.includes(query) ||
          contact.includes(query) ||
          phone.includes(query) ||
          email.includes(query) ||
          notes.includes(query) ||
          rep.includes(query);
      });
    }

    return list;
  });

  // Dynamic KPI statistics from API
  kpiStats = signal<{ today: number; overdue: number; pending: number; completed: number; total: number }>({
    today: 0,
    overdue: 0,
    pending: 0,
    completed: 0,
    total: 0
  });

  stats = computed(() => this.kpiStats());

  ngOnInit() {
    this.fetchEmployees();
    this.fetchStats();
    this.fetchFollowUps();
  }

  
  fetchStats() {
    this.http.get<{ today: number; overdue: number; pending: number; completed: number; total: number }>(
      `${environment.apiUrl}/crm/follow-ups/stats`
    ).subscribe({
      next: (res) => {
        if (res) this.kpiStats.set(res);
      },
      error: (err) => console.error('Failed to load follow-up stats', err)
    });
  }

  quickFilter(type: 'today' | 'overdue' | 'pending' | 'completed') {
    if (type === 'today') {
      this.filterDate.set('today');
      this.filterStatus.set('PENDING');
    } else if (type === 'overdue') {
      this.filterDate.set('overdue');
      this.filterStatus.set('PENDING');
    } else if (type === 'pending') {
      this.filterStatus.set('PENDING');
      this.filterDate.set('all');
    } else if (type === 'completed') {
      this.filterStatus.set('COMPLETED');
      this.filterDate.set('all');
    }
    this.onFilterChange();
  }

  fetchEmployees() {
    this.http.get<any[]>(`${environment.apiUrl}/employees/basic-list`).subscribe({
      next: (res) => {
        // filter finance, sales, and admin users
        this.employees.set(res.filter(e => {
          const dept = e.department?.name?.toLowerCase() || '';
          const role = e.user?.role?.toUpperCase() || '';
          return dept.includes('sales') || dept.includes('finance') || role === 'ADMIN' || role === 'SUPERADMIN';
        }));
      },
      error: (err) => console.error('Failed to load employees', err)
    });
  }

  fetchFollowUps() {
    this.isLoading.set(true);
    const params: string[] = [];

    if (this.filterDate() !== 'all') params.push(`dateFilter=${this.filterDate()}`);
    if (this.filterDate() === 'custom') {
      if (this.filterStartDate()) params.push(`startDate=${this.filterStartDate()}`);
      if (this.filterEndDate()) params.push(`endDate=${this.filterEndDate()}`);
    }
    if (this.filterAssignee()) params.push(`assignedToId=${this.filterAssignee()}`);
    if (this.filterStatus() !== 'all') params.push(`status=${this.filterStatus()}`);

    const queryString = params.length ? `?${params.join('&')}` : '';

    this.http.get<FollowUpItem[]>(`${environment.apiUrl}/crm/follow-ups${queryString}`).subscribe({
      next: (res) => {
        this.followUps.set(res);
        this.isLoading.set(false);
        this.fetchStats();
      },
      error: (err) => {
        this.error.set('Failed to load follow-ups');
        this.isLoading.set(false);
      }
    });
  }

  onFilterChange() {
    this.fetchFollowUps();
  }

  resetFilters() {
    this.searchQuery.set('');
    this.filterDate.set('upcoming');
    this.filterAssignee.set('');
    this.filterStatus.set('PENDING');
    this.filterType.set('all');
    this.filterStartDate.set('');
    this.filterEndDate.set('');
    this.fetchFollowUps();
  }

  

  

  
  // Outcome Modal State
  showCompleteModal: boolean = false;
  completingFollowUp: FollowUpItem | null = null;
  outcomeText: string = '';
  isSavingOutcome: boolean = false;

  // Lead Detail Modal State with Follow-Up History
  showDetailModal: boolean = false;
  selectedLead: any | null = null;
  selectedLeadFollowUps: any[] = [];
  isLoadingLeadHistory: boolean = false;

  // Schedule New Follow-Up Modal State
  showScheduleModal: boolean = false;
  scheduleLead: any = null;
  isSavingSchedule: boolean = false;
  scheduleForm = {
    title: '',
    contactPerson: '',
    contactPhone: '',
    contactEmail: '',
    type: 'CALL',
    scheduledAt: '',
    notes: '',
    assignedToId: null as number | null
  };

  getLatestCompletedRemark(fu: FollowUpItem): string | null {
    if (fu.outcome) return fu.outcome;
    const history = (fu.lead as any)?.followUps;
    if (Array.isArray(history)) {
      const pastCompleted = history.find((h: any) => h.id !== fu.id && (h.status === 'COMPLETED' || h.outcome) && (h.outcome || h.notes));
      if (pastCompleted) {
        return pastCompleted.outcome || pastCompleted.notes || null;
      }
    }
    return null;
  }

  startCompleteFollowUp(followUp: FollowUpItem, event?: Event) {
    if (event) event.stopPropagation();
    this.completingFollowUp = followUp;
    this.outcomeText = '';
    this.showCompleteModal = true;
  }

  cancelCompleteFollowUp() {
    this.showCompleteModal = false;
    this.completingFollowUp = null;
    this.outcomeText = '';
  }

  submitFollowUpOutcome(status: 'COMPLETED' | 'CANCELLED') {
    const f = this.completingFollowUp;
    if (!f) return;
    this.isSavingOutcome = true;
    
    const payload = { 
      status, 
      notes: this.outcomeText || f.notes, 
      completedAt: new Date().toISOString() 
    };
    
    this.http.put(`${environment.apiUrl}/crm/leads/${f.leadId}/follow-ups/${f.id}`, payload).subscribe({
      next: () => {
        this.fetchFollowUps();
        this.isSavingOutcome = false;
        this.cancelCompleteFollowUp();
        if (this.showDetailModal && this.selectedLead?.id === f.leadId) {
          this.fetchLeadHistory(f.leadId);
        }
      },
      error: (err) => {
        console.error('Failed to update follow-up', err);
        alert('Failed to update follow-up');
        this.isSavingOutcome = false;
      }
    });
  }

  viewLead(lead: any, event?: Event) {
    if (event) event.stopPropagation();
    this.selectedLead = lead;
    this.showDetailModal = true;
    this.selectedLeadFollowUps = (lead?.followUps) || [];
    if (lead?.id) {
      this.fetchLeadHistory(lead.id);
    }
  }

  fetchLeadHistory(leadId: number) {
    this.isLoadingLeadHistory = true;
    this.http.get<any[]>(`${environment.apiUrl}/crm/leads/${leadId}/follow-ups`).subscribe({
      next: (res) => {
        this.selectedLeadFollowUps = res || [];
        this.isLoadingLeadHistory = false;
      },
      error: () => {
        this.selectedLeadFollowUps = (this.selectedLead?.followUps) || [];
        this.isLoadingLeadHistory = false;
      }
    });
  }

  closeDetailModal() {
    this.showDetailModal = false;
    this.selectedLead = null;
    this.selectedLeadFollowUps = [];
  }

  openAddFollowUpModal(fuOrLead: any, event?: Event) {
    if (event) event.stopPropagation();
    const lead = fuOrLead?.lead ? fuOrLead.lead : fuOrLead;
    this.scheduleLead = lead;
    
    // Default scheduled time: Tomorrow 10:00 AM local time
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);
    const tzOffset = tomorrow.getTimezoneOffset() * 60000;
    const localISOTime = (new Date(tomorrow.getTime() - tzOffset)).toISOString().slice(0, 16);

    const contactName = fuOrLead.contactPerson || lead.contactName || lead.contactPerson || '';
    const phone = fuOrLead.contactPhone || lead.phone || lead.contactPhone || '';
    const email = fuOrLead.contactEmail || lead.email || lead.contactEmail || '';
    const currentEmpId = this.auth.currentUser()?.employee?.id || this.auth.currentUser()?.employeeId || null;

    this.scheduleForm = {
      title: `Follow-up with ${contactName || lead.companyName || 'Client'}`,
      contactPerson: contactName,
      contactPhone: phone,
      contactEmail: email,
      type: 'CALL',
      scheduledAt: localISOTime,
      notes: '',
      assignedToId: lead.assignedTo?.id || lead.assignedToId || currentEmpId
    };

    this.showScheduleModal = true;
  }

  closeScheduleModal() {
    this.showScheduleModal = false;
    this.scheduleLead = null;
  }

  submitScheduleFollowUp() {
    if (!this.scheduleLead?.id) return;
    this.isSavingSchedule = true;

    const payload = {
      ...this.scheduleForm,
      scheduledAt: new Date(this.scheduleForm.scheduledAt).toISOString()
    };

    this.http.post(`${environment.apiUrl}/crm/leads/${this.scheduleLead.id}/follow-ups`, payload).subscribe({
      next: () => {
        this.isSavingSchedule = false;
        this.closeScheduleModal();
        this.fetchFollowUps();
        if (this.showDetailModal && this.selectedLead?.id === this.scheduleLead.id) {
          this.fetchLeadHistory(this.scheduleLead.id);
        }
      },
      error: (err) => {
        this.isSavingSchedule = false;
        alert(err?.error?.message || 'Failed to schedule follow-up');
      }
    });
  }

  setQuickScheduleTime(option: 'today_afternoon' | 'tomorrow_morning' | 'in_2_days' | 'next_week') {
    const d = new Date();
    if (option === 'today_afternoon') {
      d.setHours(15, 0, 0, 0);
    } else if (option === 'tomorrow_morning') {
      d.setDate(d.getDate() + 1);
      d.setHours(10, 0, 0, 0);
    } else if (option === 'in_2_days') {
      d.setDate(d.getDate() + 2);
      d.setHours(10, 0, 0, 0);
    } else if (option === 'next_week') {
      d.setDate(d.getDate() + 7);
      d.setHours(10, 0, 0, 0);
    }
    const tzOffset = d.getTimezoneOffset() * 60000;
    this.scheduleForm.scheduledAt = (new Date(d.getTime() - tzOffset)).toISOString().slice(0, 16);
  }

  getStatusLabel(status: string): string {
    if (!status) return 'Unknown';
    return status.replace(/_/g, ' ').replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
  }

  goBackToLeads() {
    this.router.navigate(['/crm/leads']);
  }

  // Date styling & helpers
  isToday(dateStr: string): boolean {
    if (!dateStr) return false;
    const d = new Date(dateStr).toISOString().slice(0, 10);
    const now = new Date().toISOString().slice(0, 10);
    return d === now;
  }

  isTomorrow(dateStr: string): boolean {
    if (!dateStr) return false;
    const d = new Date(dateStr).toISOString().slice(0, 10);
    const tmrw = new Date();
    tmrw.setDate(tmrw.getDate() + 1);
    return d === tmrw.toISOString().slice(0, 10);
  }

  isOverdue(item: FollowUpItem): boolean {
    if (item.status === 'COMPLETED' || !item.scheduledAt) return false;
    const itemDate = new Date(item.scheduledAt);
    const now = new Date();
    return itemDate.getTime() < now.getTime() && !this.isToday(item.scheduledAt);
  }

  getTypeLabel(type: string): string {
    switch (type?.toUpperCase()) {
      case 'CALL': return 'Phone Call';
      case 'EMAIL': return 'Email Follow-up';
      case 'MEETING': return 'In-Person Meeting';
      case 'DEMO': return 'Product Demo';
      case 'FIELD_VISIT': return 'Client Field Visit';
      default: return type || 'Follow-Up';
    }
  }

  getTypeBadgeClass(type: string): string {
    switch (type?.toUpperCase()) {
      case 'CALL': return 'type-badge-call';
      case 'EMAIL': return 'type-badge-email';
      case 'MEETING': return 'type-badge-meeting';
      case 'DEMO': return 'type-badge-demo';
      case 'FIELD_VISIT': return 'type-badge-visit';
      default: return 'type-badge-default';
    }
  }
}

