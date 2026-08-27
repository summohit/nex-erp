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
  LucideFileText,
  LucideClock,
  LucideBuilding,
  LucideSearch,
  LucideLayoutGrid,
  LucideList,
  LucideArrowLeft,
  LucideX,
  LucideAlertCircle,
  LucideVideo,
  LucideMapPin,
  LucideRotateCcw,
  LucidePlus,
  LucideEye,
  LucideLoader2,
  LucideMessageSquare,
  LucideHistory,
  LucideMoreHorizontal
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
  scheduledAt: string;
  notes?: string;
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
    LucideFileText,
    LucideClock,
    LucideBuilding,
    LucideSearch,
    LucideLayoutGrid,
    LucideList,
    LucideArrowLeft,
    LucideX,
    LucideAlertCircle,
    LucideVideo,
    LucideMapPin,
    LucideRotateCcw,
    LucidePlus,
    LucideEye,
    LucideLoader2,
    LucideMessageSquare,
    LucideHistory,
    LucideMoreHorizontal,
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
  isLoading = signal<boolean>(false);
  error = signal<string | null>(null);

  // View mode
  viewMode = signal<'table' | 'cards'>('table');

  // Search & Filter state
  searchQuery = signal<string>('');
  filterDate = signal<string>('upcoming'); // 'today' | 'tomorrow' | 'upcoming' | 'past' | 'all' | 'custom'
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
  kpiStats = signal<{ today: number; upcoming: number; past: number; total: number; overdue: number }>({
    today: 0,
    upcoming: 0,
    past: 0,
    total: 0,
    overdue: 0
  });

  stats = computed(() => this.kpiStats());

  ngOnInit() {
    this.fetchStats();
    this.fetchFollowUps();
  }


  fetchStats() {
    this.http.get<{ today: number; upcoming: number; past: number; total: number; overdue?: number }>(
      `${environment.apiUrl}/crm/follow-ups/stats`
    ).subscribe({
      next: (res) => {
        if (res) this.kpiStats.set({
          today: res.today ?? 0,
          upcoming: res.upcoming ?? 0,
          past: res.past ?? 0,
          total: res.total ?? 0,
          overdue: res.overdue ?? 0
        });
      },
      error: (err) => console.error('Failed to load follow-up stats', err)
    });
  }

  quickFilter(type: 'today' | 'upcoming' | 'past' | 'overdue' | 'all') {
    this.filterDate.set(type);
    this.onFilterChange();
  }

  fetchFollowUps() {
    this.isLoading.set(true);
    const params: string[] = [];

    if (this.filterDate() !== 'all') params.push(`dateFilter=${this.filterDate()}`);
    if (this.filterDate() === 'custom') {
      if (this.filterStartDate()) params.push(`startDate=${this.filterStartDate()}`);
      if (this.filterEndDate()) params.push(`endDate=${this.filterEndDate()}`);
    }

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
    this.filterType.set('all');
    this.filterStartDate.set('');
    this.filterEndDate.set('');
    this.fetchFollowUps();
  }

  

  

  // Lead Detail Modal State with Follow-Up History
  showDetailModal: boolean = false;
  selectedLead: any | null = null;
  selectedLeadFollowUps: any[] = [];
  isLoadingLeadHistory: boolean = false;

  // Previous follow-up note for context when scheduling
  previousFollowUpNote: FollowUpItem | null = null;

  // Schedule / Edit Follow-Up Modal State
  showScheduleModal: boolean = false;
  scheduleLead: any = null;
  editingFollowUp: FollowUpItem | null = null;
  isSavingSchedule: boolean = false;
  scheduleForm: {
    title: string;
    contactPerson: string;
    contactPhone: string;
    contactEmail: string;
    type: string;
    scheduledAt: string;
    notes: string;
    assignedToId: number | null;
  } = {
    title: '',
    contactPerson: '',
    contactPhone: '',
    contactEmail: '',
    type: 'CALL',
    scheduledAt: '',
    notes: '',
    assignedToId: null
  };

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

    this.scheduleForm = {
      title: `Follow-up with ${contactName || lead.companyName || 'Client'}`,
      contactPerson: contactName,
      contactPhone: phone,
      contactEmail: email,
      type: 'CALL',
      scheduledAt: localISOTime,
      notes: '',
      assignedToId: null
    };

    this.previousFollowUpNote = null;
    if (lead?.id) {
      this.http.get<FollowUpItem[]>(`${environment.apiUrl}/crm/leads/${lead.id}/follow-ups`).subscribe({
        next: (res) => {
          if (res?.length) {
            this.previousFollowUpNote = [...res].sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime())[0];
          }
        }
      });
    }

    this.showScheduleModal = true;
  }

  closeScheduleModal() {
    this.showScheduleModal = false;
    this.scheduleLead = null;
    this.editingFollowUp = null;
  }

  openEditFollowUpModal(fu: FollowUpItem, event?: Event) {
    if (event) event.stopPropagation();
    this.editingFollowUp = fu;
    this.scheduleLead = fu.lead;

    const d = new Date(fu.scheduledAt);
    const tzOffset = d.getTimezoneOffset() * 60000;
    const localISOTime = (new Date(d.getTime() - tzOffset)).toISOString().slice(0, 16);

    this.scheduleForm = {
      title: fu.title,
      contactPerson: fu.contactPerson || '',
      contactPhone: fu.contactPhone || '',
      contactEmail: fu.contactEmail || '',
      type: fu.type || 'CALL',
      scheduledAt: localISOTime,
      notes: fu.notes || '',
      assignedToId: fu.assignedToId || null
    };

    this.showScheduleModal = true;
  }

  submitScheduleFollowUp() {
    if (!this.scheduleLead?.id) return;
    this.isSavingSchedule = true;

    const payload = {
      ...this.scheduleForm,
      scheduledAt: new Date(this.scheduleForm.scheduledAt).toISOString()
    };

    const leadId = this.scheduleLead.id;
    const request$ = this.editingFollowUp
      ? this.http.put(`${environment.apiUrl}/crm/leads/${leadId}/follow-ups/${this.editingFollowUp.id}`, payload)
      : this.http.post(`${environment.apiUrl}/crm/leads/${leadId}/follow-ups`, payload);

    request$.subscribe({
      next: () => {
        this.isSavingSchedule = false;
        this.closeScheduleModal();
        this.fetchFollowUps();
        if (this.showDetailModal && this.selectedLead?.id === leadId) {
          this.fetchLeadHistory(leadId);
        }
      },
      error: (err) => {
        this.isSavingSchedule = false;
        alert(err?.error?.message || 'Failed to save follow-up');
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
    if (!item.scheduledAt) return false;
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

  // Most recent prior note for the same lead — shown inline in the list as context.
  getLatestRemark(fu: FollowUpItem): string | null {
    const history = (fu.lead as any)?.followUps;
    if (!Array.isArray(history)) return null;
    const prior = history
      .filter((h: any) => h.id !== fu.id && h.notes)
      .sort((a: any, b: any) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime());
    return prior.length ? prior[0].notes : null;
  }
}

