import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import {
  LucideArrowLeft, LucideMail, LucidePhone, LucideBuilding, LucideMapPin,
  LucideGlobe, LucideExternalLink, LucideCalendar, LucideDollarSign,
  LucideUser, LucideUserCheck, LucideBriefcase, LucideLayoutList,
  LucideMessageSquare, LucideFileText, LucideTarget, LucideChevronRight,
  LucideUpload, LucideDownload, LucideTrash2, LucideEdit, LucideCheckCircle,
  LucideClock, LucideX, LucidePaperclip, LucideHistory, LucidePlus, LucideEye,
  LucideFile, LucideMoreVertical, LucideRefreshCw, LucideVideo,
  LucideChevronDown, LucideCheck, LucideLoader2, LucideCalendarClock
} from '@lucide/angular';
import { DialogService } from '../../shared/services/dialog.service';
import { ClientsService } from '../../services/clients';

interface PipelineStage {
  key: string;
  label: string;
}

@Component({
  selector: 'app-lead-profile',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterModule,
    LucideArrowLeft, LucideMail, LucidePhone, LucideBuilding, LucideMapPin,
    LucideGlobe, LucideExternalLink, LucideCalendar, LucideDollarSign,
    LucideUser, LucideUserCheck, LucideBriefcase, LucideLayoutList,
    LucideMessageSquare, LucideFileText, LucideTarget, LucideChevronRight,
    LucideUpload, LucideDownload, LucideTrash2, LucideEdit, LucideCheckCircle,
    LucideClock, LucideX, LucidePaperclip, LucideHistory, LucidePlus, LucideEye,
    LucideFile, LucideMoreVertical, LucideRefreshCw, LucideVideo,
    LucideChevronDown, LucideCheck, LucideLoader2, LucideCalendarClock
  ],
  templateUrl: './lead-profile.html',
  styleUrls: ['./lead-profile.css']
})
export class LeadProfileComponent implements OnInit {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private dialog = inject(DialogService);
  private clientsService = inject(ClientsService);

  lead: any = null;
  leadId: number | null = null;
  isLoading = true;

  // Tabs
  activeTab: 'files' | 'followups' | 'proposals' | 'notes' | 'history' = 'files';

  // Tab data
  files: any[] = [];
  followUps: any[] = [];
  proposals: any[] = [];
  notes: any[] = [];
  history: any[] = [];

  // Loading states
  loadingFiles = false;
  loadingFollowUps = false;
  loadingProposals = false;
  loadingNotes = false;
  loadingHistory = false;

  // Pipeline
  // Must stay in step with LEAD_STATUSES on the leads board — this list had
  // drifted (it still said "Converted" for Win, and had no Schedule Meeting),
  // so the progress bar skipped stages the board could actually set.
  pipelineStages: PipelineStage[] = [
    { key: 'New', label: 'New' },
    { key: 'Interested', label: 'Interested' },
    { key: 'Proposal Sent', label: 'Proposal Sent' },
    { key: 'Schedule Meeting', label: 'Schedule Meeting' },
    { key: 'Negotiation', label: 'Negotiation' },
    { key: 'Win', label: 'Win' },
    { key: 'On Hold', label: 'On Hold' },
    { key: 'Lost', label: 'Lost' },
  ];

  // Modals
  showFollowUpModal = false;
  showNoteModal = false;
  showFilePicker = false;
  showActivityDetailsId: number | null = null;

  // Follow-up form
  followUpForm: any = {
    id: null,
    stage: '',
    type: 'CALL',
    scheduledAt: '',
    notes: '',
    contactPerson: '',
    contactPhone: '',
    contactEmail: '',
    title: ''
  };
  followUpDatePart = '';
  followUpTimePart = '';
  private syncFollowUpParts() {
    const at = (this.followUpForm.scheduledAt as string) || '';
    this.followUpDatePart = at.length >= 10 ? at.slice(0, 10) : '';
    this.followUpTimePart = at.length >= 16 ? at.slice(11, 16) : '';
  }
  private syncScheduledAtFromParts() {
    if (this.followUpDatePart && this.followUpTimePart) {
      this.followUpForm.scheduledAt = `${this.followUpDatePart}T${this.followUpTimePart}`;
    } else if (this.followUpDatePart) {
      this.followUpForm.scheduledAt = this.followUpDatePart;
    } else {
      this.followUpForm.scheduledAt = this.followUpTimePart || this.followUpForm.scheduledAt;
    }
  }
  setFollowUpDatePart(value: string) {
    this.followUpDatePart = value || '';
    this.syncScheduledAtFromParts();
  }
  setFollowUpTimePart(value: string) {
    this.followUpTimePart = (value || '').slice(0, 5);
    this.syncScheduledAtFromParts();
  }
  isEditingFollowUp = false;
  followUpTab: 'schedule' | 'history' = 'schedule';
  followUpStageMenuOpen = false;
  followUpTableStageMenu: number | null = null;
  isSavingFollowUp = false;
  isUploadingFollowUpFiles = false;
  pendingFollowUpFiles: File[] = [];
  followUpStatusSaving: Record<number, boolean> = {};

  // Must stay in step with LEAD_STATUSES on the leads board.
  readonly LEAD_STATUSES = ['New', 'Interested', 'Proposal Sent', 'Schedule Meeting', 'Negotiation', 'Win', 'On Hold', 'Lost'];

  // Pre-sales pipeline stages, mirroring the leads board.
  readonly PRE_SALES_STATUSES = [
    'New Lead', 'Requirement Gathering', 'Solutioning / Demo',
    'Proposal / Technical Validation', 'POC', 'Converted / Won', 'Lost'
  ];

  // Stage list shown in the follow-up modal / table; resolved per deal flow.
  get activeStatuses(): string[] {
    return this.isPreSalesLead ? this.PRE_SALES_STATUSES : this.LEAD_STATUSES;
  }

  get isPreSalesLead(): boolean {
    return this.lead?.flow === 'PRE_SALES';
  }

  // Note form
  noteForm: any = { id: null, content: '' };
  isEditingNote = false;

  // File
  selectedFile: File | null = null;

  ngOnInit() {
    this.route.paramMap.subscribe(params => {
      const id = params.get('id');
      if (id) {
        this.leadId = +id;
        this.loadLead(+id);
      }
    });
  }

  // ═══════════════════════════════════════════
  // LEAD LOADING
  // ═══════════════════════════════════════════

  loadLead(id: number) {
    this.isLoading = true;
    this.http.get<any>(`${environment.apiUrl}/crm/leads/${id}`).subscribe({
      next: (data) => {
        this.lead = data;
        this.proposals = data.quotations || [];
        this.isLoading = false;
        this.loadAllTabData();
      },
      error: (err) => {
        console.error('Error loading lead profile', err);
        this.isLoading = false;
      }
    });
  }

  loadAllTabData() {
    if (this.leadId == null) return;
    this.loadFiles();
    this.loadFollowUps();
    this.loadNotes();
    this.loadHistory();
  }

  // ═══════════════════════════════════════════
  // TABS
  // ═══════════════════════════════════════════

  setTab(tab: 'files' | 'followups' | 'proposals' | 'notes' | 'history') {
    this.activeTab = tab;
  }

  onTabClick(tab: 'files' | 'followups' | 'proposals' | 'notes' | 'history') {
    this.setTab(tab);
  }

  // ═══════════════════════════════════════════
  // FILES
  // ═══════════════════════════════════════════

  loadFiles() {
    if (this.leadId == null) return;
    this.loadingFiles = true;
    this.http.get<any[]>(`${environment.apiUrl}/crm/leads/${this.leadId}/files`).subscribe({
      next: (data) => { this.files = data || []; this.loadingFiles = false; },
      error: (err) => { console.error(err); this.loadingFiles = false; }
    });
  }

  triggerFileUpload() {
    this.showFilePicker = true;
    const input = document.querySelector<HTMLInputElement>('#dealFileInput');
    if (input) input.click();
  }

  onFileSelected(event: Event) {
    const target = event.target as HTMLInputElement;
    if (target.files && target.files.length > 0) {
      this.uploadFile(target.files[0]);
    }
    this.showFilePicker = false;
    target.value = '';
  }

  uploadFile(file: File) {
    if (this.leadId == null) return;
    const formData = new FormData();
    formData.append('file', file);
    this.http.post<any>(`${environment.apiUrl}/crm/leads/${this.leadId}/files`, formData).subscribe({
      next: (data) => {
        this.files.unshift(data);
        this.dialog.success('File uploaded successfully.');
        this.loadHistory();
      },
      error: (err) => {
        console.error(err);
        this.dialog.error('Failed to upload file. Please try again.');
      }
    });
  }

  async deleteFile(file: any) {
    if (this.leadId == null) return;
    const confirmed = await this.dialog.confirm(`Delete file "${file.fileName}"?`, 'Delete file');
    if (!confirmed) return;
    this.http.delete(`${environment.apiUrl}/crm/leads/${this.leadId}/files/${file.id}`).subscribe({
      next: () => {
        this.files = this.files.filter(f => f.id !== file.id);
        this.dialog.success('File deleted.');
        this.loadHistory();
      },
      error: (err) => {
        console.error(err);
        this.dialog.error('Failed to delete file.');
      }
    });
  }

  downloadFile(file: any) {
    if (file.fileUrl) {
      window.open(file.fileUrl, '_blank');
    }
  }

  formatFileSize(bytes?: number): string {
    if (bytes == null) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  fileIcon(file: any): string {
    const t = (file.fileType || '').toLowerCase();
    if (t.includes('image')) return 'image';
    if (t.includes('pdf')) return 'pdf';
    if (t.includes('word') || t.includes('document')) return 'word';
    if (t.includes('excel') || t.includes('sheet')) return 'excel';
    return 'file';
  }

  // ═══════════════════════════════════════════
  // FOLLOW-UPS
  // ═══════════════════════════════════════════

  loadFollowUps() {
    if (this.leadId == null) return;
    this.loadingFollowUps = true;
    this.http.get<any[]>(`${environment.apiUrl}/crm/leads/${this.leadId}/follow-ups`).subscribe({
      next: (data) => {
        this.followUps = (data || []).slice().sort((a, b) => this.sortFollowUpsDesc(a, b));
        this.loadingFollowUps = false;
      },
      error: (err) => { console.error(err); this.loadingFollowUps = false; }
    });
  }

  // Newest follow-up first, oldest last.
  private sortFollowUpsDesc(a: any, b: any): number {
    return new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime();
  }

  openNewFollowUp() {
    this.isEditingFollowUp = false;
    this.followUpTab = 'schedule';
    this.followUpStageMenuOpen = false;
    this.followUpForm = {
      id: null,
      title: this.lead ? `Follow-up with ${this.lead.contactName || this.lead.companyName || 'Client'}` : '',
      type: 'CALL',
      scheduledAt: '',
      notes: '',
      contactPerson: this.lead?.contactName || '',
      contactPhone: this.lead?.phone || '',
      contactEmail: this.lead?.email || '',
      stage: this.normalizeStatus(this.lead?.status)
    };
    this.setQuickFollowUpTime('tomorrow_morning');
    this.pendingFollowUpFiles = [];
    this.showFollowUpModal = true;
  }

  openEditFollowUp(fu: any) {
    this.isEditingFollowUp = true;
    this.followUpTab = 'schedule';
    this.followUpStageMenuOpen = false;
    this.followUpForm = {
      id: fu.id,
      title: fu.title || 'Follow-up',
      type: fu.type,
      scheduledAt: this.toLocalDateTime(new Date(fu.scheduledAt)),
      notes: fu.notes || '',
      contactPerson: fu.contactPerson || '',
      contactPhone: fu.contactPhone || '',
      contactEmail: fu.contactEmail || '',
      stage: this.normalizeStatus(this.lead?.status)
    };
    this.syncFollowUpParts();
    this.pendingFollowUpFiles = [];
    this.showFollowUpModal = true;
  }

  closeFollowUpModal() {
    this.showFollowUpModal = false;
    this.followUpStageMenuOpen = false;
    this.followUpTableStageMenu = null;
    this.pendingFollowUpFiles = [];
  }

  saveFollowUp() {
    if (this.leadId == null) return;
    const scheduled = (this.followUpForm.scheduledAt as string) || '';
    const hasFullSchedule = scheduled.includes('T') && scheduled.length >= 16;
    if (!hasFullSchedule || !(this.followUpForm.title || '').trim()) {
      this.dialog.error('Please fill in the follow-up title and scheduled date & time.');
      return;
    }

    // Logging a follow-up is usually the moment the deal actually moves, so the
    // form can change the stage too. Fired alongside the save rather than as
    // part of it — a stage that fails to stick must not lose the follow-up.
    const newStage = this.followUpForm.stage;
    if (newStage && newStage !== this.lead?.status) {
      this.saveLeadStage(newStage);
    }

    const payload = {
      title: this.followUpForm.title.trim(),
      type: this.followUpForm.type,
      contactPerson: this.followUpForm.contactPerson,
      contactPhone: this.followUpForm.contactPhone,
      contactEmail: this.followUpForm.contactEmail,
      scheduledAt: new Date(this.followUpForm.scheduledAt).toISOString(),
      notes: this.followUpForm.notes
    };

    if (this.isEditingFollowUp) {
      this.http.put<any>(`${environment.apiUrl}/crm/leads/${this.leadId}/follow-ups/${this.followUpForm.id}`, payload).subscribe({
        next: (data) => {
          this.followUps = this.followUps.map(f => f.id === data.id ? data : f).sort((a, b) => this.sortFollowUpsDesc(a, b));
          this.showFollowUpModal = false;
          this.dialog.success('Follow-up updated.');
          this.loadHistory();
        },
        error: (err) => {
          console.error(err);
          this.dialog.error('Failed to update follow-up.');
        }
      });
    } else {
      this.isSavingFollowUp = true;
      this.http.post<any>(`${environment.apiUrl}/crm/leads/${this.leadId}/follow-ups`, payload).subscribe({
        next: (data) => {
          this.isSavingFollowUp = false;
          this.followUps = [data, ...this.followUps].sort((a, b) => this.sortFollowUpsDesc(a, b));
          const files = [...this.pendingFollowUpFiles];
          this.pendingFollowUpFiles = [];
          this.uploadFollowUpFiles(data.id, files);
          this.followUpTab = 'history';
          this.followUpForm.notes = '';
          this.setQuickFollowUpTime('tomorrow_morning');
          this.dialog.success('Follow-up created.');
          this.loadHistory();
        },
        error: (err) => {
          this.isSavingFollowUp = false;
          console.error(err);
          this.dialog.error(err?.error?.message || 'Failed to create follow-up.');
        }
      });
    }
  }

  saveLeadStage(newStatus: string) {
    if (this.leadId == null || !newStatus || newStatus === this.lead?.status) return;
    if (['WIN', 'WON'].includes(newStatus.toUpperCase())) {
      this.dialog.error('Upload the purchase order before moving this deal to Win and sending it to Finance.');
      return;
    }
    this.http.put<any>(`${environment.apiUrl}/crm/leads/${this.leadId}/status`, { status: newStatus }).subscribe({
      next: (updated) => {
        if (this.lead) this.lead.status = updated?.status ?? newStatus;
        this.loadHistory();
      },
      error: () => this.dialog.error('Follow-up saved, but the stage could not be updated.'),
    });
  }

  // Stage column in the follow-up table — keeps the follow-up and the lead in sync.
  toggleFollowUpTableStageMenu(fu: any, event: Event) {
    if (event) event.stopPropagation();
    this.followUpTableStageMenu = this.followUpTableStageMenu === fu.id ? null : fu.id;
  }

  selectFollowUpTableStage(fu: any, stage: string, event: Event) {
    if (event) event.stopPropagation();
    this.followUpTableStageMenu = null;
    if (stage === this.getFollowUpStage(fu.status)) return;
    this.followUpStatusSaving[fu.id] = true;
    this.http.put<any>(`${environment.apiUrl}/crm/leads/${this.leadId}/follow-ups/${fu.id}`, { status: stage }).subscribe({
      next: (updated) => {
        this.followUpStatusSaving[fu.id] = false;
        this.followUps = this.followUps.map(x => x.id === updated.id ? updated : x);
        this.saveLeadStage(stage);
      },
      error: (err) => {
        this.followUpStatusSaving[fu.id] = false;
        console.error('Failed to update follow-up stage', err);
        this.dialog.error('Failed to update the stage.');
      }
    });
  }

  toggleFollowUpStageMenu(event: Event) {
    if (event) event.stopPropagation();
    this.followUpStageMenuOpen = !this.followUpStageMenuOpen;
  }

  selectFollowUpStage(stage: string, event: Event) {
    if (event) event.stopPropagation();
    this.followUpForm.stage = stage;
    this.followUpStageMenuOpen = false;
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
    this.followUpForm.scheduledAt = (new Date(d.getTime() - tzOffset)).toISOString().slice(0, 16);
    this.syncFollowUpParts();
  }

  onFollowUpFilesSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []);
    this.pendingFollowUpFiles = [...this.pendingFollowUpFiles, ...files];
  }

  removePendingFollowUpFile(index: number) {
    this.pendingFollowUpFiles.splice(index, 1);
  }

  uploadFollowUpFiles(followUpId: number, files: File[]) {
    if (this.leadId == null || !files.length) return;
    this.isUploadingFollowUpFiles = true;
    let remaining = files.length;
    files.forEach(file => {
      const body = new FormData();
      body.append('file', file);
      this.http.post<any>(`${environment.apiUrl}/crm/leads/${this.leadId}/follow-ups/${followUpId}/files`, body).subscribe({
        next: () => {
          if (--remaining === 0) {
            this.isUploadingFollowUpFiles = false;
            this.loadFollowUps();
          }
        },
        error: () => {
          if (--remaining === 0) {
            this.isUploadingFollowUpFiles = false;
            this.dialog.error('One or more follow-up attachments could not be uploaded.');
            this.loadFollowUps();
          }
        }
      });
    });
  }

  // Most recently scheduled follow-up still on file — shown as read-only context
  // when scheduling the next one.
  getPreviousFollowUpNote(): any | null {
    if (!this.followUps.length) return null;
    return [...this.followUps].sort((a, b) => this.sortFollowUpsDesc(a, b))[0];
  }

  getUpcomingFollowUps(): any[] {
    const now = new Date().getTime();
    return this.followUps.filter(f => new Date(f.scheduledAt).getTime() >= now);
  }

  getPastFollowUps(): any[] {
    const now = new Date().getTime();
    return this.followUps.filter(f => new Date(f.scheduledAt).getTime() < now)
      .sort((a, b) => this.sortFollowUpsDesc(a, b));
  }

  async markFollowUpComplete(fu: any) {
    if (this.leadId == null) return;
    const confirmed = await this.dialog.confirm('Mark this follow-up as completed?', 'Mark complete');
    if (!confirmed) return;
    this.http.put<any>(`${environment.apiUrl}/crm/leads/${this.leadId}/follow-ups/${fu.id}`, { status: 'COMPLETED' }).subscribe({
      next: (data) => {
        this.followUps = this.followUps.map(f => f.id === data.id ? data : f).sort((a, b) => this.sortFollowUpsDesc(a, b));
        this.dialog.success('Follow-up marked as completed.');
        this.loadHistory();
      },
      error: (err) => {
        console.error(err);
        this.dialog.error('Failed to update follow-up.');
      }
    });
  }

  async deleteFollowUp(fu: any) {
    if (this.leadId == null) return;
    const confirmed = await this.dialog.confirm('Delete this follow-up?', 'Delete follow-up');
    if (!confirmed) return;
    this.http.delete(`${environment.apiUrl}/crm/leads/${this.leadId}/follow-ups/${fu.id}`).subscribe({
      next: () => {
        this.followUps = this.followUps.filter(f => f.id !== fu.id);
        this.dialog.success('Follow-up deleted.');
        this.loadHistory();
      },
      error: (err) => {
        console.error(err);
        this.dialog.error('Failed to delete follow-up.');
      }
    });
  }

  followUpStatusClass(status: string): string {
    const s = (status || 'PENDING').toUpperCase();
    if (s === 'COMPLETED') return 'fu-status-completed';
    if (s === 'CANCELLED') return 'fu-status-cancelled';
    return 'fu-status-pending';
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

  normalizeStatus(status: string | undefined | null): string {
    const raw = String(status || '').trim();

    // Pre-sales pipeline: resolve its own stage names (plus legacy spellings)
    // and never let the sales mappings recast them.
    if (this.isPreSalesLead) {
      if (!raw) return 'New Lead';
      const s = raw.toUpperCase();
      const direct = this.PRE_SALES_STATUSES.find(
        st => st.toUpperCase() === s || st.toUpperCase() === s.replace(/_+/g, ' ').replace(/\s+/g, ' ')
      );
      if (direct) return direct;
      if (s === 'NEW') return 'New Lead';
      if (s === 'CONVERTED' || s === 'WON' || s === 'WIN') return 'Converted / Won';
      if (s === 'LOST') return 'Lost';
      return 'New Lead';
    }

    if (!raw) return 'New';
    const s = raw.toUpperCase();
    if (s === 'NEW') return 'New';
    if (s === 'INTERESTED' || s === 'QUALIFIED' || s === 'ASSIGNED' || s === 'CONTACTED' || s === 'ATTEMPTED TO CONTACT' || s === 'CONNECTED' || s === 'FOLLOW-UP REQUIRED' || s === 'FOLLOW_UP_REQUIRED') return 'Interested';
    if (s === 'PROPOSAL' || s === 'PROPOSAL SENT' || s === 'PROPOSAL_SENT' || s === 'DEMO SCHEDULED' || s === 'DEMO COMPLETED') return 'Proposal Sent';
    if (s === 'NEGOTIATION') return 'Negotiation';
    if (s === 'ON HOLD' || s === 'ON_HOLD') return 'On Hold';
    if (s === 'CONVERTED' || s === 'WON' || s === 'WIN') return 'Win';
    if (s === 'LOST') return 'Lost';
    if (s === 'SCHEDULE MEETING' || s === 'SCHEDULE_MEETING') return 'Schedule Meeting';
    const directMatch = this.LEAD_STATUSES.find(st => st.toLowerCase() === raw.toLowerCase());
    if (directMatch) return directMatch;
    return 'New';
  }

  getStatusLabel(status: string): string {
    return this.normalizeStatus(status);
  }

  // Map follow-up status values (PENDING/COMPLETED/CANCELLED) onto the current
  // deal-stage set so the Stage dropdown always shows a valid progression.
  getFollowUpStage(status?: string): string {
    const s = (status || '').toUpperCase().replace(/_/g, ' ');
    switch (s) {
      case 'PENDING':
      case 'COMPLETED':
      case '':
      case 'NEW': return this.isPreSalesLead ? 'New Lead' : 'New';
      case 'CANCELLED':
      case 'LOST': return 'Lost';
      default: return this.normalizeStatus(status);
    }
  }

  private readonly statusColorMap: Record<string, string> = {
    'new': '#2563eb',
    'interested': '#7c3aed',
    'schedule-meeting': '#0891b2',
    'proposal-sent': '#6d28d9',
    'negotiation': '#b45309',
    'on-hold': '#64748b',
    'win': '#059669',
    'lost': '#dc2626',
    'new-lead': '#2563eb',
    'requirement-gathering': '#0891b2',
    'solutioning-demo': '#7c3aed',
    'proposal-technical-validation': '#d97706',
    'poc': '#ea580c',
    'converted-won': '#059669',
  };

  statusDotColor(status: string): string {
    const key = (status || '').toLowerCase().replace(/\s+/g, '-');
    return this.statusColorMap[key] || '#64748b';
  }

  isFollowUpOverdue(scheduledAt: string | Date): boolean {
    return new Date(scheduledAt).getTime() < Date.now();
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

  // ═══════════════════════════════════════════
  // NOTES
  // ═══════════════════════════════════════════

  loadNotes() {
    if (this.leadId == null) return;
    this.loadingNotes = true;
    this.http.get<any[]>(`${environment.apiUrl}/crm/leads/${this.leadId}/notes`).subscribe({
      next: (data) => { this.notes = data || []; this.loadingNotes = false; },
      error: (err) => { console.error(err); this.loadingNotes = false; }
    });
  }

  openNewNote() {
    this.isEditingNote = false;
    this.noteForm = { id: null, content: '' };
    this.showNoteModal = true;
  }

  openEditNote(note: any) {
    this.isEditingNote = true;
    this.noteForm = { id: note.id, content: note.content };
    this.showNoteModal = true;
  }

  closeNoteModal() {
    this.showNoteModal = false;
  }

  saveNote() {
    if (this.leadId == null) return;
    if (!this.noteForm.content || !this.noteForm.content.trim()) {
      this.dialog.error('Note content is required.');
      return;
    }
    const payload = { content: this.noteForm.content };

    if (this.isEditingNote) {
      this.http.put<any>(`${environment.apiUrl}/crm/leads/${this.leadId}/notes/${this.noteForm.id}`, payload).subscribe({
        next: (data) => {
          this.notes = this.notes.map(n => n.id === data.id ? data : n);
          this.showNoteModal = false;
          this.dialog.success('Note updated.');
          this.loadHistory();
        },
        error: (err) => {
          console.error(err);
          this.dialog.error('Failed to update note.');
        }
      });
    } else {
      this.http.post<any>(`${environment.apiUrl}/crm/leads/${this.leadId}/notes`, payload).subscribe({
        next: (data) => {
          this.notes.unshift(data);
          this.showNoteModal = false;
          this.dialog.success('Note added.');
          this.loadHistory();
        },
        error: (err) => {
          console.error(err);
          this.dialog.error('Failed to add note.');
        }
      });
    }
  }

  async deleteNote(note: any) {
    if (this.leadId == null) return;
    const confirmed = await this.dialog.confirm('Delete this note?', 'Delete note');
    if (!confirmed) return;
    this.http.delete(`${environment.apiUrl}/crm/leads/${this.leadId}/notes/${note.id}`).subscribe({
      next: () => {
        this.notes = this.notes.filter(n => n.id !== note.id);
        this.dialog.success('Note deleted.');
        this.loadHistory();
      },
      error: (err) => {
        console.error(err);
        this.dialog.error('Failed to delete note.');
      }
    });
  }

  // ═══════════════════════════════════════════
  // HISTORY
  // ═══════════════════════════════════════════

  loadHistory() {
    if (this.leadId == null) return;
    this.loadingHistory = true;
    this.http.get<any[]>(`${environment.apiUrl}/crm/leads/${this.leadId}/history`).subscribe({
      next: (data) => { this.history = data || []; this.loadingHistory = false; },
      error: (err) => { console.error(err); this.loadingHistory = false; }
    });
  }

  activityIcon(action: string): string {
    const a = (action || '').toUpperCase();
    if (a.includes('STAGE') || a.includes('STATUS')) return 'stage';
    if (a.includes('FOLLOW_UP')) return 'followup';
    if (a.includes('PROPOSAL') || a.includes('QUOTATION')) return 'proposal';
    if (a.includes('NOTE')) return 'note';
    if (a.includes('FILE')) return 'file';
    if (a.includes('CREATED')) return 'created';
    if (a.includes('DELETED')) return 'deleted';
    if (a.includes('ACTOR') || a.includes('WATCHER')) return 'watcher';
    return 'default';
  }

  activityColor(action: string): string {
    const a = (action || '').toUpperCase();
    if (a.includes('CREATED')) return 'act-blue';
    if (a.includes('STAGE') || a.includes('STATUS')) return 'act-amber';
    if (a.includes('FOLLOW_UP')) return 'act-purple';
    if (a.includes('PROPOSAL')) return 'act-indigo';
    if (a.includes('NOTE')) return 'act-emerald';
    if (a.includes('FILE')) return 'act-orange';
    if (a.includes('DELETED')) return 'act-red';
    if (a.includes('ACTOR') || a.includes('WATCHER')) return 'act-cyan';
    return 'act-gray';
  }

  toggleActivityDetails(id: number) {
    this.showActivityDetailsId = this.showActivityDetailsId === id ? null : id;
  }

  // ═══════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════

  toLocalDateTime(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  getInitials(name?: string): string {
    if (!name) return 'LD';
    const words = name.trim().split(/\s+/);
    if (words.length === 1) return words[0].substring(0, 2).toUpperCase();
    return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  }

  get assignedName(): string {
    const a = this.lead?.assignedTo;
    if (!a) return 'Unassigned';
    return `${a.firstName || ''} ${a.lastName || ''}`.trim();
  }

  get addedByName(): string {
    const a = this.lead?.addedBy;
    if (!a) return '';
    return `${a.firstName || ''} ${a.lastName || ''}`.trim();
  }

  get broughtByName(): string {
    const b = this.lead?.broughtByContact;
    if (!b) return '';
    return b.name;
  }

  get clientName(): string {
    const c = this.lead?.client;
    if (!c) return '';
    return c.name;
  }

  get quotations(): any[] {
    return this.lead?.quotations || [];
  }

  get totalDeals(): number {
    return this.proposals.length;
  }

  get wonDeals(): number {
    return this.proposals.filter(p => (p.status || '').toUpperCase() === 'ACCEPTED').length;
  }

  get lostDeals(): number {
    return this.proposals.filter(p => (p.status || '').toUpperCase() === 'REJECTED').length;
  }

  get openDeals(): number {
    return this.proposals.filter(p => {
      const s = (p.status || '').toUpperCase();
      return s === 'DRAFT' || s === 'PENDING_APPROVAL' || s === 'SENT';
    }).length;
  }

  get wonDealValue(): number {
    return this.proposals
      .filter(p => (p.status || '').toUpperCase() === 'ACCEPTED')
      .reduce((sum, p) => sum + (p.total || 0), 0);
  }

  get lostDealValue(): number {
    return this.proposals
      .filter(p => (p.status || '').toUpperCase() === 'REJECTED')
      .reduce((sum, p) => sum + (p.total || 0), 0);
  }

  get followUpItems(): any[] {
    return this.lead?.followUps || [];
  }

  // Earliest still-pending scheduled follow-up, falling back to the most recent
  // overdue one so the header box always has something meaningful to show.
  get nextFollowUpInfo(): { date: string; isOverdue: boolean } | null {
    const sorted = (this.followUps || [])
      .filter((f: any) => (f.status || 'PENDING').toUpperCase() !== 'COMPLETED')
      .map((f: any) => ({ t: new Date(f.scheduledAt).getTime(), f }))
      .filter(x => !isNaN(x.t))
      .sort((a, b) => a.t - b.t);
    if (!sorted.length) return null;
    const upcoming = sorted.find(x => x.t >= Date.now());
    const chosen = upcoming || sorted[sorted.length - 1];
    return { date: chosen.f.scheduledAt, isOverdue: !upcoming };
  }

  get fullAddress(): string {
    const l = this.lead;
    if (!l) return '';
    return [l.address, l.companyName].filter(Boolean).join(', ');
  }

  get formattedWebsiteUrl() {
    const url = this.lead?.website?.trim() || '';
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    return `https://${url}`;
  }

  statusClass(status: string): string {
    const base = (status || '').toUpperCase();
    if (base === 'NEW' || base === 'New' || base === 'Interested') return 'lead-status-new';
    if (base === 'QUALIFIED') return 'lead-status-qualified';
    if (base === 'PROPOSAL' || base === 'Proposal Sent') return 'lead-status-proposal';
    if (base === 'WON' || base === 'Converted') return 'lead-status-won';
    if (base === 'LOST' || base === 'Lost') return 'lead-status-lost';
    return 'lead-status-default';
  }

  followUpTypeClass(type: string): string {
    return 'fu-type-' + (type || 'other').toLowerCase().replace(/[^a-z_]/g, '');
  }

  isUpcoming(fu: any): boolean {
    return new Date(fu.scheduledAt).getTime() > Date.now();
  }

  dealStatusPill(status: string): string {
    const s = (status || '').toUpperCase();
    if (s === 'ACCEPTED') return 'deal-won';
    if (s === 'REJECTED') return 'deal-rejected';
    if (s === 'SENT' || s === 'PENDING_APPROVAL') return 'deal-open';
    return 'deal-draft';
  }

  dealStatusLabel(status: string): string {
    const s = (status || '').toUpperCase();
    if (s === 'ACCEPTED') return 'Won';
    if (s === 'REJECTED') return 'Rejected';
    if (s === 'SENT') return 'Sent';
    if (s === 'PENDING_APPROVAL') return 'Pending';
    return 'Open';
  }

  employeeName(emp: any): string {
    if (!emp) return 'Unassigned';
    return `${emp.firstName || ''} ${emp.lastName || ''}`.trim();
  }

  // Pipeline helpers
  currentStageIndex(): number {
    const status = this.lead?.status;
    if (!status) return -1;
    const normalized = status.trim();
    return this.pipelineStages.findIndex(s => s.key.toLowerCase() === normalized.toLowerCase());
  }

  isStageActive(stage: PipelineStage): boolean {
    const status = (this.lead?.status || '').trim();
    return stage.key.toLowerCase() === status.toLowerCase();
  }

  isStageCompleted(stage: PipelineStage): boolean {
    const idx = this.currentStageIndex();
    if (idx === -1) return false;
    const stageIdx = this.pipelineStages.findIndex(s => s.key === stage.key);
    return stageIdx < idx;
  }

  openEmail() {
    const email = this.lead?.email;
    if (!email) return;
    const subject = encodeURIComponent(`Regarding ${this.lead.title || 'your enquiry'}`);
    const body = encodeURIComponent(`Hi ${this.lead.contactName || ''},\n\n`);
    window.location.href = `mailto:${email}?subject=${subject}&body=${body}`;
  }

  openLeadContact(contactId: number) {
    this.router.navigate(['/crm/lead-contacts', contactId]);
  }

  goToQuotations() {
    this.router.navigate(['/sales/quotations']);
  }

  // ═══════════════════════════════════════════
  // PROPOSALS (quotations created for this lead)
  // ═══════════════════════════════════════════

  clients: any[] = [];
  showProposalModal = false;
  isSavingProposal = false;
  isProposalSubmitted = false;
  uploadingProposalCount = 0;
  readonly proposalUnitOptions = ['number', 'piece', 'hour', 'day', 'kg', 'litre', 'meter', 'roll', 'box', 'bundle'];
  readonly proposalTaxOptions = [0, 5, 12, 18, 28];
  readonly proposalMaxAttachments = 8;
  readonly proposalMaxAttachmentBytes = 20 * 1024 * 1024;

  proposalForm: any = this.freshProposalForm();

  private static readonly PROPOSAL_DEFAULT_TERMS =
    '1. Validity: This proposal is valid for the period stated above.\n' +
    '2. Payment Terms: 50% advance against Purchase Order and balance before dispatch / on delivery.\n' +
    '3. Taxes: Prices are exclusive of GST unless stated otherwise. GST will be charged at the applicable rate.\n' +
    '4. Delivery: Delivery/implementation timelines will be communicated upon order confirmation.\n' +
    '5. Warranty: Standard manufacturer warranty applies from the date of delivery.\n' +
    '6. Force Majeure: Neither party shall be liable for delays caused by events beyond reasonable control.\n' +
    '7. Acceptance: This proposal is subject to our standard terms of sale and acceptance of a Purchase Order.\n' +
    '8. Governing Law: This proposal shall be governed by the laws of India and subject to jurisdiction of the courts.';

  private freshProposalForm() {
    return {
      clientId: (this.lead?.client?.id ?? null) as number | null,
      leadId: this.leadId,
      date: new Date().toISOString().split('T')[0],
      validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      currency: this.lead?.currency || 'INR',
      taxRate: 18,
      notes: '',
      terms: LeadProfileComponent.PROPOSAL_DEFAULT_TERMS,
      items: [{ description: '', quantity: 1, unit: 'number', unitPrice: 0 }],
      attachments: []
    };
  }

  openNewProposal() {
    this.isProposalSubmitted = false;
    this.uploadingProposalCount = 0;
    this.proposalForm = this.freshProposalForm();
    this.showProposalModal = true;
    this.loadProposalClients();
  }

  closeProposalModal() {
    this.showProposalModal = false;
    this.isProposalSubmitted = false;
  }

  private loadProposalClients() {
    this.clientsService.getClients('ACTIVE').subscribe((data: any[]) => {
      this.clients = (data || []).filter(c => c.id !== (this.lead?.client?.id ?? null));
    });
  }

  addProposalItem() {
    this.proposalForm.items.push({ description: '', quantity: 1, unit: 'number', unitPrice: 0 });
  }

  removeProposalItem(index: number) {
    if (this.proposalForm.items.length > 1) {
      this.proposalForm.items.splice(index, 1);
    }
  }

  get proposalSubtotal(): number {
    return this.proposalForm.items.reduce((s: number, i: any) => s + (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0), 0);
  }

  get proposalTax(): number {
    const rate = Number(this.proposalForm.taxRate) || 0;
    return this.proposalSubtotal * (rate / 100);
  }

  get proposalTotal(): number {
    return this.proposalSubtotal + this.proposalTax;
  }

  proposalCurrencySymbol(): string {
    const map: Record<string, string> = { INR: '\u20B9', USD: '$', EUR: '\u20AC', GBP: '\u00A3' };
    return map[this.proposalForm.currency] || '\u20B9';
  }

  private proposalFileExtension(name: string): string {
    const i = (name || '').lastIndexOf('.');
    return i === -1 ? '' : name.slice(i).toLowerCase();
  }

  isProposalImage(fileName: string): boolean {
    return ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.heic']
      .includes(this.proposalFileExtension(fileName));
  }

  proposalFileType(fileName: string): string {
    return this.proposalFileExtension(fileName).replace('.', '').toUpperCase() || 'FILE';
  }

  proposalFileClass(fileName: string): string {
    const ext = this.proposalFileExtension(fileName);
    if (['.pdf'].includes(ext)) return 'file-pdf';
    if (['.doc', '.docx', '.odt', '.rtf'].includes(ext)) return 'file-doc';
    if (['.xls', '.xlsx', '.ods', '.csv'].includes(ext)) return 'file-sheet';
    if (['.ppt', '.pptx', '.odp'].includes(ext)) return 'file-slide';
    if (['.zip', '.rar', '.7z'].includes(ext)) return 'file-archive';
    return 'file-generic';
  }

  onProposalAttachments(event: Event) {
    const files: File[] = Array.from((event.target as HTMLInputElement).files || []);
    if (!files.length) return;
    this.uploadProposalAttachments(files);
    if (event.target) (event.target as HTMLInputElement).value = '';
  }

  removeProposalAttachment(index: number) {
    if (this.uploadingProposalCount > 0) return;
    this.proposalForm.attachments.splice(index, 1);
  }

  private uploadProposalAttachments(files: File[]) {
    const remaining = this.proposalMaxAttachments - this.proposalForm.attachments.length - this.uploadingProposalCount;
    if (remaining <= 0) {
      this.dialog.error(`You can attach at most ${this.proposalMaxAttachments} files.`);
      return;
    }
    const accepted = files.slice(0, remaining);
    if (files.length > remaining) {
      this.dialog.error(`Only ${remaining} more file${remaining === 1 ? '' : 's'} can be attached.`);
    }

    for (const file of accepted) {
      if (file.size > this.proposalMaxAttachmentBytes) {
        this.dialog.error(`"${file.name}" is larger than 20MB.`);
        continue;
      }
      this.uploadingProposalCount++;
      const form = new FormData();
      form.append('file', file);
      this.http.post<{ url: string }>(`${environment.apiUrl}/upload`, form).subscribe({
        next: (res) => {
          this.proposalForm.attachments = [
            ...this.proposalForm.attachments,
            { fileName: file.name, fileUrl: res.url, fileSize: file.size }
          ];
          this.uploadingProposalCount--;
        },
        error: () => {
          this.dialog.error(`Failed to upload "${file.name}".`);
          this.uploadingProposalCount--;
        }
      });
    }
  }

  saveProposal() {
    this.isProposalSubmitted = true;
    if (!this.proposalForm.clientId || !this.proposalForm.items.length) return;
    if (this.uploadingProposalCount > 0) {
      this.dialog.error('Please wait for all attachments to finish uploading.');
      return;
    }

    this.isSavingProposal = true;
    this.http.post(`${environment.apiUrl}/sales/quotations`, this.proposalForm).subscribe({
      next: () => {
        this.isSavingProposal = false;
        this.closeProposalModal();
        this.dialog.success('Proposal created successfully.');
        this.loadLead(this.leadId!);
      },
      error: (err) => {
        this.isSavingProposal = false;
        this.dialog.error(err?.error?.message || 'Failed to create proposal.');
      }
    });
  }

  goBack() {
    this.router.navigate(['/crm/leads']);
  }
}
