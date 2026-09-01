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
  LucideFile, LucideMoreVertical, LucideRefreshCw
} from '@lucide/angular';
import { DialogService } from '../../shared/services/dialog.service';

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
    LucideFile, LucideMoreVertical, LucideRefreshCw
  ],
  templateUrl: './lead-profile.html',
  styleUrls: ['./lead-profile.css']
})
export class LeadProfileComponent implements OnInit {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private dialog = inject(DialogService);

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
  pipelineStages: PipelineStage[] = [
    { key: 'New', label: 'New' },
    { key: 'Interested', label: 'Interested' },
    { key: 'Proposal Sent', label: 'Proposal Sent' },
    { key: 'Negotiation', label: 'Negotiation' },
    { key: 'On Hold', label: 'On Hold' },
    { key: 'Converted', label: 'Converted' },
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
    title: '',
    type: 'CALL',
    scheduledAt: '',
    notes: '',
    status: 'PENDING'
  };
  isEditingFollowUp = false;

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
      next: (data) => { this.followUps = data || []; this.loadingFollowUps = false; },
      error: (err) => { console.error(err); this.loadingFollowUps = false; }
    });
  }

  openNewFollowUp() {
    this.isEditingFollowUp = false;
    this.followUpForm = {
      id: null,
      title: '',
      type: 'CALL',
      scheduledAt: this.toLocalDateTime(new Date()),
      notes: '',
      status: 'PENDING'
    };
    this.showFollowUpModal = true;
  }

  openEditFollowUp(fu: any) {
    this.isEditingFollowUp = true;
    this.followUpForm = {
      id: fu.id,
      title: fu.title,
      type: fu.type,
      scheduledAt: this.toLocalDateTime(new Date(fu.scheduledAt)),
      notes: fu.notes || '',
      status: fu.status || 'PENDING'
    };
    this.showFollowUpModal = true;
  }

  closeFollowUpModal() {
    this.showFollowUpModal = false;
  }

  saveFollowUp() {
    if (this.leadId == null) return;
    if (!this.followUpForm.title || !this.followUpForm.scheduledAt) {
      this.dialog.error('Please fill in title and date.');
      return;
    }
    const payload = {
      title: this.followUpForm.title,
      type: this.followUpForm.type,
      scheduledAt: new Date(this.followUpForm.scheduledAt).toISOString(),
      notes: this.followUpForm.notes,
      status: this.followUpForm.status
    };

    if (this.isEditingFollowUp) {
      this.http.put<any>(`${environment.apiUrl}/crm/leads/${this.leadId}/follow-ups/${this.followUpForm.id}`, payload).subscribe({
        next: (data) => {
          this.followUps = this.followUps.map(f => f.id === data.id ? data : f);
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
      this.http.post<any>(`${environment.apiUrl}/crm/leads/${this.leadId}/follow-ups`, payload).subscribe({
        next: (data) => {
          this.followUps.push(data);
          this.showFollowUpModal = false;
          this.dialog.success('Follow-up created.');
          this.loadHistory();
        },
        error: (err) => {
          console.error(err);
          this.dialog.error('Failed to create follow-up.');
        }
      });
    }
  }

  async markFollowUpComplete(fu: any) {
    if (this.leadId == null) return;
    const confirmed = await this.dialog.confirm('Mark this follow-up as completed?', 'Mark complete');
    if (!confirmed) return;
    this.http.put<any>(`${environment.apiUrl}/crm/leads/${this.leadId}/follow-ups/${fu.id}`, { status: 'COMPLETED' }).subscribe({
      next: (data) => {
        this.followUps = this.followUps.map(f => f.id === data.id ? data : f);
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

  get followUpItems(): any[] {
    return this.lead?.followUps || [];
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

  goBack() {
    this.router.navigate(['/crm/leads']);
  }
}
