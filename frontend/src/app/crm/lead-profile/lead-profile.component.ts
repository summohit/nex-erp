import { Component, OnInit, OnDestroy, HostListener, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { DEFAULT_QUOTATION_TERMS } from '../../shared/constants/quotation-terms';
import { isValidEmail } from '../../shared/constants/contact-validation';
import { SystemSettingsService } from '../../services/system-settings.service';
import { environment } from '../../../environments/environment';
import {
  LucideArrowLeft, LucideMail, LucidePhone, LucideBuilding, LucideMapPin,
  LucideGlobe, LucideExternalLink, LucideCalendar, LucideDollarSign,
  LucideUser, LucideUserCheck, LucideBriefcase, LucideLayoutList,
  LucideMessageSquare, LucideFileText, LucideTarget, LucideChevronRight,
  LucideUpload, LucideDownload, LucideTrash2, LucideEdit2, LucideCheckCircle,
  LucideClock, LucideX, LucidePaperclip, LucideHistory, LucidePlus, LucideEye,
  LucideFile, LucideMoreVertical, LucideRefreshCw, LucideVideo,
  LucideChevronDown, LucideCheck, LucideLoader2, LucideCalendarClock,
  LucideList, LucideAlertCircle, LucideCopyPlus, LucideUsers, LucideUserPlus,
  LucideClipboardList, LucideFileUp, LucidePlusCircle, LucideHourglass,
  LucidePlay, LucidePause, LucideTag, LucideCheckCircle2
} from '@lucide/angular';
import { DialogService } from '../../shared/services/dialog.service';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ClientsService } from '../../services/clients';
import { AuthService } from '../../services/auth.service';

/** Which slice of the directory a pre-sales picker is showing. */
type PreSalesScope = 'core' | 'others' | 'all';

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
    LucideUpload, LucideDownload, LucideTrash2, LucideEdit2, LucideCheckCircle,
    LucideClock, LucideX, LucidePaperclip, LucideHistory, LucidePlus, LucideEye,
    LucideFile, LucideMoreVertical, LucideRefreshCw, LucideVideo,
    LucideChevronDown, LucideCheck, LucideLoader2, LucideCalendarClock,
    LucideList, LucideAlertCircle, LucideCopyPlus, LucideUsers, LucideUserPlus,
    LucideClipboardList, LucideFileUp, LucidePlusCircle, LucideHourglass,
    LucidePlay, LucidePause, LucideTag, LucideCheckCircle2
  ],
  templateUrl: './lead-profile.html',
  styleUrls: ['./lead-profile.css']
})
export class LeadProfileComponent implements OnInit, OnDestroy {
  private http = inject(HttpClient);
  private sanitizer = inject(DomSanitizer);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private dialog = inject(DialogService);
  private clientsService = inject(ClientsService);
  private systemSettingsService = inject(SystemSettingsService);
  private auth = inject(AuthService);

  lead: any = null;
  leadId: number | null = null;
  isLoading = true;

  // Tabs
  activeTab: 'files' | 'followups' | 'proposals' | 'notes' | 'history' | 'presales' = 'files';

  // Tab data
  files: any[] = [];
  followUps: any[] = [];
  proposals: any[] = [];
  notes: any[] = [];
  history: any[] = [];

  // Loading states
  loadingFiles = false;
  uploadingFile = false;
  uploadingFileName = '';
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
  isViewingFollowUp = false;
  followUpTab: 'schedule' | 'history' = 'schedule';
  followUpStageMenuOpen = false;
  followUpTableStageMenu: number | null = null;
  followUpActionsMenu: any | null = null;
  followUpActionsMenuPos: { top: number; left: number } = { top: 0, left: 0 };

  @HostListener('document:click')
  onDocumentClick() {
    this.followUpActionsMenu = null;
  }
  isSavingFollowUp = false;
  isUploadingFollowUpFiles = false;
  pendingFollowUpFiles: File[] = [];
  existingFollowUpFiles: any[] = [];
  followUpStatusSaving: Record<number, boolean> = {};
  renamingFollowUpFileIndex: number | null = null;
  renameFollowUpFileName = '';

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

  private static readonly DEEP_LINK_TABS = ['files', 'followups', 'proposals', 'notes', 'history', 'presales'];

  ngOnInit() {
    // The tab is chosen before anything is fetched. It used to be applied in
    // applyDeepLink(), which runs inside the lead request's callback — so
    // arriving from "Manage" showed the default tab until that resolved, and
    // any later reset of activeTab won the race.
    const tab = this.route.snapshot.queryParamMap.get('tab');
    if (tab && LeadProfileComponent.DEEP_LINK_TABS.includes(tab)) {
      this.activeTab = tab as any;
    }

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
        this.applyDeepLink();
        this.loadPresalesEmployees();
        this.loadPresalesInfo();
      },
      error: (err) => {
        console.error('Error loading lead profile', err);
        this.isLoading = false;
      }
    });
  }

  /**
   * Honour ?tab= and ?edit= from the deal grid's proposal menu, which hands off
   * here rather than keeping its own copy of the proposal form.
   *
   * Run after the quotations have loaded, since ?edit= names one of them. An id
   * that no longer exists just lands on the tab — the quote was probably deleted
   * between the two screens, and an error would say nothing useful.
   */
  private applyDeepLink() {
    const params = this.route.snapshot.queryParamMap;
    const tab = params.get('tab');
    // The tab itself is applied in ngOnInit, before the fetch; this only has to
    // deal with ?edit=, which needs the quotations in hand.
    const editId = Number(params.get('edit'));
    if (editId) {
      const quote = this.proposals.find(p => p.id === editId);
      if (quote) this.editProposal(quote);
    }
    if (tab || editId) {
      // Clear them so a refresh, or a back-navigation, does not reopen the form.
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {},
        replaceUrl: true,
      });
    }
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

  setTab(tab: 'files' | 'followups' | 'proposals' | 'notes' | 'history' | 'presales') {
    this.activeTab = tab;
  }

  onTabClick(tab: 'files' | 'followups' | 'proposals' | 'notes' | 'history' | 'presales') {
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
    this.uploadingFile = true;
    this.uploadingFileName = file.name;
    const formData = new FormData();
    formData.append('file', file);
    this.http.post<any>(`${environment.apiUrl}/crm/leads/${this.leadId}/files`, formData).subscribe({
      next: (data) => {
        this.files.unshift(data);
        this.uploadingFile = false;
        this.uploadingFileName = '';
        this.dialog.success('File uploaded successfully.');
        this.loadHistory();
      },
      error: (err) => {
        console.error(err);
        this.uploadingFile = false;
        this.uploadingFileName = '';
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
    this.isViewingFollowUp = false;
    this.followUpTab = 'schedule';
    this.followUpStageMenuOpen = false;
    this.followUpActionsMenu = null;
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
    this.existingFollowUpFiles = [];
    this.showFollowUpModal = true;
  }

  openEditFollowUp(fu: any) {
    this.isEditingFollowUp = true;
    this.isViewingFollowUp = false;
    this.followUpTab = 'schedule';
    this.followUpStageMenuOpen = false;
    this.followUpActionsMenu = null;
    this.existingFollowUpFiles = fu.files ? [...fu.files] : [];
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

  viewFollowUp(fu: any) {
    this.isEditingFollowUp = false;
    this.isViewingFollowUp = true;
    this.followUpTab = 'schedule';
    this.followUpStageMenuOpen = false;
    this.followUpActionsMenu = null;
    this.existingFollowUpFiles = fu.files ? [...fu.files] : [];
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

  toggleFollowUpActionsMenu(fu: any, event: Event) {
    if (event) event.stopPropagation();
    if (this.followUpActionsMenu?.id === fu.id) {
      this.followUpActionsMenu = null;
      return;
    }
    this.followUpTableStageMenu = null;
    const btn = (event.target as HTMLElement).closest('.fu-actions-trigger') as HTMLElement | null;
    if (btn) {
      const rect = btn.getBoundingClientRect();
      const menuWidth = 140;
      const menuHeight = 116;
      let left = rect.right - menuWidth;
      left = Math.min(Math.max(left, 8), window.innerWidth - menuWidth - 8);
      const spaceBelow = window.innerHeight - rect.bottom - 6;
      const top = spaceBelow >= menuHeight ? rect.bottom + 6 : Math.max(8, rect.top - menuHeight - 6);
      this.followUpActionsMenuPos = { top, left };
    }
    this.followUpActionsMenu = fu;
  }

  closeFollowUpActionsMenu() {
    this.followUpActionsMenu = null;
  }

  closeFollowUpModal() {
    this.showFollowUpModal = false;
    this.followUpStageMenuOpen = false;
    this.followUpTableStageMenu = null;
    this.followUpActionsMenu = null;
    this.isViewingFollowUp = false;
    this.pendingFollowUpFiles = [];
    this.renamingFollowUpFileIndex = null;
    this.renameFollowUpFileName = '';
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
      this.isSavingFollowUp = true;
      this.http.put<any>(`${environment.apiUrl}/crm/leads/${this.leadId}/follow-ups/${this.followUpForm.id}`, payload).subscribe({
        next: (data) => {
          this.isSavingFollowUp = false;
          this.followUps = this.followUps.map(f => f.id === data.id ? data : f).sort((a, b) => this.sortFollowUpsDesc(a, b));
          const files = [...this.pendingFollowUpFiles];
          this.pendingFollowUpFiles = [];
          if (files.length) {
            this.uploadFollowUpFiles(data.id, files);
          }
          this.showFollowUpModal = false;
          this.dialog.success(files.length ? 'Follow-up updated; uploading attachments.' : 'Follow-up updated.');
          this.loadHistory();
        },
        error: (err) => {
          this.isSavingFollowUp = false;
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
    this.followUpActionsMenu = null;
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
    if (this.renamingFollowUpFileIndex === index) this.cancelRenameFollowUpFile();
    else if (this.renamingFollowUpFileIndex != null && index < this.renamingFollowUpFileIndex) this.renamingFollowUpFileIndex--;
  }

  startRenameFollowUpFile(index: number) {
    this.renamingFollowUpFileIndex = index;
    this.renameFollowUpFileName = this.pendingFollowUpFiles[index]?.name || '';
  }

  saveRenameFollowUpFile() {
    const i = this.renamingFollowUpFileIndex;
    const newName = (this.renameFollowUpFileName || '').trim();
    this.cancelRenameFollowUpFile();
    if (i == null || i < 0 || i >= this.pendingFollowUpFiles.length) return;
    const original = this.pendingFollowUpFiles[i];
    if (!newName || newName === original.name) return;
    this.pendingFollowUpFiles[i] = new File([original], newName, { type: original.type, lastModified: original.lastModified });
  }

  cancelRenameFollowUpFile() {
    this.renamingFollowUpFileIndex = null;
    this.renameFollowUpFileName = '';
  }

  async deleteExistingFollowUpFile(file: any) {
    if (this.leadId == null) return;
    const confirmed = await this.dialog.confirm(`Delete attachment "${file.fileName}"?`, 'Delete attachment');
    if (!confirmed) return;
    this.http.delete(`${environment.apiUrl}/crm/leads/${this.leadId}/files/${file.id}`).subscribe({
      next: () => {
        this.existingFollowUpFiles = this.existingFollowUpFiles.filter(f => f.id !== file.id);
        this.dialog.success('Attachment deleted.');
        this.loadFollowUps();
        this.loadHistory();
      },
      error: (err) => {
        console.error(err);
        this.dialog.error('Failed to delete attachment.');
      }
    });
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

  /** The external contact this deal came from, when one is linked. */
  get leadContactId(): number | null {
    return this.lead?.broughtByContact?.id ?? null;
  }

  /** Open that contact's profile. Only reachable when leadContactId is set —
   *  a deal can carry a contact name with no contact record behind it. */
  openLeadContactProfile() {
    const id = this.leadContactId;
    if (id != null) this.router.navigate(['/crm/lead-contacts', id]);
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

  private freshProposalForm() {
    return {
      clientId: (this.lead?.client?.id ?? null) as number | null,
      leadId: this.leadId,
      date: new Date().toISOString().split('T')[0],
      validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      currency: this.lead?.currency || 'INR',
      taxRate: 18,
      notes: '',
      terms: this.companyQuotationTerms ?? DEFAULT_QUOTATION_TERMS,
      // Seeded from the lead, then editable — the quote records who it was
      // addressed to at the time, so later edits to the lead cannot rewrite it.
      billingCompanyName: this.lead?.companyName || '',
      billingAddress: this.lead?.address || '',
      billingContactName: this.lead?.contactName || '',
      billingMobile: this.lead?.phone || '',
      billingEmail: this.lead?.email || '',
      billingGstin: '',
      billingPan: '',
      billingPlaceOfSupply: '',
      items: [this.freshProposalItem()],
      attachments: []
    };
  }

  /** Company-configured quotation terms; null means use the built-in defaults. */
  private companyQuotationTerms: string | null = null;

  /** Set while editing an existing quote; null for a new one. */
  editingProposalId: number | null = null;
  /** Only for the modal heading, so an edit is not labelled "New Proposal". */
  editingProposalNumber: string | null = null;

  openNewProposal() {
    this.isProposalSubmitted = false;
    this.uploadingProposalCount = 0;
    this.editingProposalId = null;
    this.editingProposalNumber = null;
    this.proposalForm = this.freshProposalForm();
    this.showProposalModal = true;
    this.loadProposalClients();
    this.applyCompanyQuotationTerms();
  }

  /**
   * Pull the company's standard terms into the open form.
   *
   * Fetched when the modal opens rather than on page load, so the request only
   * happens for someone actually raising a proposal. The form is seeded with the
   * built-in defaults first, so a slow or failed settings call leaves usable
   * terms rather than an empty box.
   */
  private applyCompanyQuotationTerms() {
    this.systemSettingsService.getSettings().subscribe({
      next: (settings) => {
        this.companyQuotationTerms = settings?.quotationTerms ?? null;
        if (!this.showProposalModal) return;
        // Don't stamp over anything already typed in the few hundred ms this took.
        if (this.proposalForm.terms === DEFAULT_QUOTATION_TERMS) {
          this.proposalForm.terms = this.companyQuotationTerms ?? DEFAULT_QUOTATION_TERMS;
        }
      },
      error: () => { /* the built-in defaults are already in the form */ },
    });
  }

  /**
   * Open the printable quotation for a saved quote.
   *
   * Fetched as a blob rather than pointing a tab at the URL: the endpoint is
   * behind AuthGuard, and a plain window.open sends no Authorization header, so
   * it would land on a 401 instead of the document.
   */
  openQuotationPdf(quotationId: number) {
    this.busyProposalId = quotationId;
    this.http
      .get(`${environment.apiUrl}/sales/quotations/${quotationId}/pdf`, { responseType: 'blob' })
      .subscribe({
        next: (blob) => {
          this.busyProposalId = null;
          const url = URL.createObjectURL(blob);
          const opened = window.open(url, '_blank');
          if (!opened) {
            // Popup blocked. DialogService has no info(), and the quote DID
            // save — so title it accordingly rather than "Something went wrong".
            this.dialog.error(
              'Allow pop-ups to see the quotation, or open it from the Proposals list.',
              'Proposal saved',
            );
          }
          // Freed on the next tick; the new tab has already taken a reference.
          setTimeout(() => URL.revokeObjectURL(url), 60_000);
        },
        error: () => {
          this.busyProposalId = null;
          this.dialog.error('The proposal was saved, but the PDF could not be generated.');
        },
      });
  }

  // ── proposal row actions ───────────────────────────────────────────────────

  /** The proposal whose action menu is open, and where to float it. */
  proposalActionsMenu: any = null;
  proposalActionsMenuPos = { top: 0, left: 0 };
  sendingProposalId: number | null = null;

  toggleProposalActionsMenu(q: any, event: Event) {
    if (event) event.stopPropagation();
    if (this.proposalActionsMenu?.id === q.id) {
      this.proposalActionsMenu = null;
      return;
    }
    const btn = (event.target as HTMLElement).closest('.prop-actions-trigger') as HTMLElement | null;
    if (btn) {
      // Positioned from the trigger's rect and rendered outside the table, so a
      // later row's cell can never clip it — same approach as the follow-up menu.
      const rect = btn.getBoundingClientRect();
      const menuWidth = 190;
      // Five items plus padding. Rows near the bottom of the window are the
      // normal case in this table, and opening downwards there pushed the last
      // item off-screen — so flip above the trigger when it will not fit.
      const menuHeight = 218;
      const gap = 6;
      const margin = 8;
      const fitsBelow = rect.bottom + gap + menuHeight <= window.innerHeight - margin;

      this.proposalActionsMenuPos = {
        top: fitsBelow
          ? rect.bottom + gap
          : Math.max(margin, rect.top - gap - menuHeight),
        left: Math.max(margin, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - margin)),
      };
    }
    this.proposalActionsMenu = q;
  }

  closeProposalActionsMenu() {
    this.proposalActionsMenu = null;
  }

  // ── versioning ────────────────────────────────────────────────────────────
  //
  // A quotation freezes the moment it goes to the client, because they are then
  // holding that document. Corrections become the next version of the deal's
  // proposal, keeping the same quote number with an -R suffix.

  /** Mirrors QUOTE_EDITABLE on the server. */
  canEditProposal(q: any): boolean {
    return ['DRAFT', 'PENDING_APPROVAL', 'REJECTED'].includes((q?.status || '').toUpperCase());
  }

  /** Mirrors QUOTE_REVISABLE on the server. */
  canReviseProposal(q: any): boolean {
    return ['SENT', 'REJECTED'].includes((q?.status || '').toUpperCase());
  }

  isProposalLocked(q: any): boolean {
    return !this.canEditProposal(q);
  }

  async reviseProposal(q: any) {
    const next = (Number(q?.version) || 1) + 1;
    const ok = await this.dialog.confirm(
      `Create v${next} of ${q.quoteNumber}? It copies everything from this version, ` +
      `and this one becomes read-only history.`,
      `New version of this proposal`,
      `Create v${next}`,
      'Cancel',
    );
    if (!ok) return;

    this.http.post<any>(`${environment.apiUrl}/sales/quotations/${q.id}/revise`, {}).subscribe({
      next: (revision) => {
        this.dialog.success(`${revision.quoteNumber} created as v${revision.version}. Edit and send it when ready.`);
        this.loadLead(this.leadId!);
        // Straight into the form: raising a version is only ever the first half
        // of "change something and send it again".
        this.editProposal(revision);
      },
      error: (err) => this.dialog.error(err?.error?.message || 'The new version could not be created.'),
    });
  }

  /**
   * The proposal whose PDF is being rendered right now.
   *
   * The server builds the document on demand — puppeteer, plus fetching and
   * merging any attachments — so this takes seconds. Without it the row gave no
   * sign anything was happening and people clicked again.
   */
  busyProposalId: number | null = null;

  /** Same document as the download, just rendered in a tab instead of saved. */
  viewProposal(q: any) {
    this.openQuotationPdf(q.id);
  }

  downloadProposal(q: any) {
    this.busyProposalId = q.id;
    this.http
      .get(`${environment.apiUrl}/sales/quotations/${q.id}/pdf`, { responseType: 'blob' })
      .subscribe({
        next: (blob) => {
          this.busyProposalId = null;
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${q.quoteNumber || 'quotation'}.pdf`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 60_000);
        },
        error: () => {
          this.busyProposalId = null;
          this.dialog.error('Could not generate the quotation PDF.');
        },
      });
  }

  /**
   * Reopen the proposal modal populated from an existing quote.
   *
   * Saving PATCHes rather than POSTs — editingProposalId is what tells
   * saveProposal which it is.
   */
  editProposal(q: any) {
    this.isProposalSubmitted = false;
    this.uploadingProposalCount = 0;
    this.editingProposalId = q.id;
    this.editingProposalNumber = q.quoteNumber || null;
    this.proposalForm = {
      ...this.freshProposalForm(),
      clientId: q.clientId ?? null,
      date: (q.date || '').toString().split('T')[0],
      validUntil: (q.validUntil || '').toString().split('T')[0],
      currency: q.currency || 'INR',
      taxRate: Number(q.taxRate ?? 18),
      notes: q.notes || '',
      terms: q.terms || '',
      billingCompanyName: q.billingCompanyName || '',
      billingAddress: q.billingAddress || '',
      billingContactName: q.billingContactName || '',
      billingMobile: q.billingMobile || '',
      billingEmail: q.billingEmail || '',
      billingGstin: q.billingGstin || '',
      billingPan: q.billingPan || '',
      billingPlaceOfSupply: q.billingPlaceOfSupply || '',
      items: (q.items || []).length
        ? q.items.map((i: any) => ({
            name: i.name || '',
            description: i.description || '',
            quantity: i.quantity ?? 1,
            unit: i.unit || 'number',
            unitPrice: i.unitPrice ?? 0,
          }))
        : [this.freshProposalItem()],
      attachments: q.attachments || [],
    };
    this.showProposalModal = true;
    this.loadProposalClients();
  }

  // ── send a proposal by email ──────────────────────────────────────────────
  //
  // The document itself is the confirmation. A dialog that only names a file
  // asks someone to vouch for a PDF they have not seen, and this leaves the
  // building and cannot be recalled — so the quotation is rendered in front of
  // them, and Send sits under it.

  sendPreviewQuote: any = null;
  sendPreviewUrl: SafeResourceUrl | null = null;
  sendPreviewTo = '';
  isLoadingSendPreview = false;
  /** Held so it can be revoked — an object URL leaks its blob until it is. */
  private sendPreviewObjectUrl: string | null = null;

  sendProposalByEmail(q: any) {
    const to = (q.billingEmail || this.lead?.email || '').trim();
    if (!to) {
      this.dialog.error(
        'There is no email address on this proposal or its deal. Add one, then send.',
        'Nothing to send to',
      );
      return;
    }

    this.sendPreviewQuote = q;
    this.sendPreviewTo = to;
    this.sendPreviewUrl = null;
    this.isLoadingSendPreview = true;

    // Fetched as a blob rather than pointed at by URL: the endpoint is behind
    // the auth guard, so an <iframe src> straight at it comes back 401.
    this.http
      .get(`${environment.apiUrl}/sales/quotations/${q.id}/pdf`, { responseType: 'blob' })
      .subscribe({
        next: (blob) => {
          this.revokeSendPreviewUrl();
          this.sendPreviewObjectUrl = URL.createObjectURL(blob);
          this.sendPreviewUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.sendPreviewObjectUrl);
          this.isLoadingSendPreview = false;
        },
        error: () => {
          this.isLoadingSendPreview = false;
          this.closeSendPreview();
          this.dialog.error('The quotation PDF could not be generated, so there is nothing to send yet.');
        },
      });
  }

  closeSendPreview() {
    if (this.sendingProposalId != null) return;
    this.revokeSendPreviewUrl();
    this.sendPreviewQuote = null;
    this.sendPreviewUrl = null;
    this.sendPreviewTo = '';
    this.isLoadingSendPreview = false;
  }

  private revokeSendPreviewUrl() {
    if (this.sendPreviewObjectUrl) {
      URL.revokeObjectURL(this.sendPreviewObjectUrl);
      this.sendPreviewObjectUrl = null;
    }
  }

  ngOnDestroy() {
    this.revokeSendPreviewUrl();
  }

  get sendPreviewToInvalid(): boolean {
    return !isValidEmail(this.sendPreviewTo);
  }

  /** The irreversible step, and the only place that posts to /email. */
  confirmSendProposal() {
    const q = this.sendPreviewQuote;
    if (!q || this.sendPreviewToInvalid) return;

    const to = this.sendPreviewTo.trim();
    this.sendingProposalId = q.id;
    this.http
      .post<any>(`${environment.apiUrl}/sales/quotations/${q.id}/email`, { to })
      .subscribe({
        next: (res) => {
          this.sendingProposalId = null;
          this.closeSendPreview();
          this.dialog.success(`Quotation ${q.quoteNumber} sent to ${res?.to || to}.`);
          this.loadLead(this.leadId!);
        },
        error: (err) => {
          this.sendingProposalId = null;
          this.dialog.error(err?.error?.message || 'The quotation could not be sent.');
        },
      });
  }

  /**
   * Delete a proposal.
   *
   * The server refuses once a quote has been accepted or converted to an
   * order — that paper trail is not ours to erase — so the error it returns is
   * shown verbatim rather than being second-guessed here.
   */
  async deleteProposal(q: any) {
    const confirmed = await this.dialog.confirm(
      `Delete quotation ${q.quoteNumber}? This cannot be undone.`,
      'Delete proposal',
      'Delete',
      'Cancel',
    );
    if (!confirmed) return;

    this.http.delete(`${environment.apiUrl}/sales/quotations/${q.id}`).subscribe({
      next: () => {
        this.proposals = this.proposals.filter(p => p.id !== q.id);
        if (this.lead?.quotations) {
          this.lead.quotations = this.lead.quotations.filter((p: any) => p.id !== q.id);
        }
        this.dialog.success('Proposal deleted.');
      },
      error: (err) => this.dialog.error(
        err?.error?.message || 'The proposal could not be deleted.',
      ),
    });
  }

  closeProposalModal() {
    this.showProposalModal = false;
    this.isProposalSubmitted = false;
    this.editingProposalId = null;
    this.editingProposalNumber = null;
  }

  /** Still resolves a client silently when one matches — the link is what
   *  allows a later conversion to a sales order — but it is never asked for. */
  private loadProposalClients() {
    this.clientsService.getClients('ACTIVE').subscribe((data: any[]) => {
      this.clients = (data || []).filter(c => c.id !== (this.lead?.client?.id ?? null));
      this.autoSelectProposalClient(data || []);
    });
  }

  /**
   * Pre-pick the client so the commonest case needs no dropdown at all.
   *
   * A lead linked to a client already resolves in freshProposalForm(); this
   * covers the rest by matching the lead's company name, which is what the
   * Lead Contact Detail panel shows. Matching is case- and whitespace-
   * insensitive, and an ambiguous match is left unselected rather than
   * guessed — putting a quotation against the wrong client is worse than
   * asking.
   */
  private autoSelectProposalClient(allClients: any[]) {
    if (this.proposalForm.clientId) return;

    const target = (this.lead?.companyName || '').trim().toLowerCase();
    if (!target) return;

    const matches = allClients.filter(
      (c) => (c?.name || '').trim().toLowerCase() === target,
    );
    if (matches.length === 1) {
      this.proposalForm.clientId = matches[0].id;
      // Prefer the client's own address once one is resolved; fall back to the
      // lead's, which is all we had before.
      this.proposalForm.billingCompanyName ||= matches[0].name || '';
      this.proposalForm.billingAddress ||= matches[0].address || '';
    }
  }

  /** Shown read-only on the quote — the contact is the lead's, not the quote's. */
  get proposalLeadContact(): string {
    return this.lead?.contactName || this.lead?.title || '—';
  }

  /** 0% GST means there is no tax line worth showing. */
  get proposalHasTax(): boolean {
    return (Number(this.proposalForm.taxRate) || 0) > 0;
  }

  private freshProposalItem() {
    return { name: '', description: '', quantity: 1, unit: 'number', unitPrice: 0 };
  }

  addProposalItem() {
    this.proposalForm.items.push(this.freshProposalItem());
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

  /** A line is only saleable once it has a real amount — quantity × price.
   *  Used for the inline highlight and by saveProposal to block the send. */
  proposalItemUnpriced(item: any): boolean {
    const quantity = Number(item?.quantity);
    const unitPrice = Number(item?.unitPrice);
    return !(quantity > 0) || !(unitPrice > 0);
  }

  get proposalHasUnpricedItem(): boolean {
    return (this.proposalForm.items || []).some((i: any) => this.proposalItemUnpriced(i));
  }

  saveProposal() {
    this.isProposalSubmitted = true;
    // Quotations belong to the deal; leadId is what the server requires.
    if (!this.proposalForm.items.length) return;

    // A quotation at ₹0.00 goes to a client and becomes a sales order. Stop it
    // here so the offending line is highlighted, rather than letting the server
    // reject the whole form with one message.
    if (this.proposalHasUnpricedItem) {
      this.dialog.error(
        'Every line item needs a quantity and a unit price. The highlighted rows still total zero.',
        'Amount is required',
      );
      return;
    }
    if (this.uploadingProposalCount > 0) {
      this.dialog.error('Please wait for all attachments to finish uploading.');
      return;
    }

    this.isSavingProposal = true;
    const editingId = this.editingProposalId;
    const request = editingId
      ? this.http.patch<any>(`${environment.apiUrl}/sales/quotations/${editingId}`, this.proposalForm)
      : this.http.post<any>(`${environment.apiUrl}/sales/quotations`, this.proposalForm);

    request.subscribe({
      next: (saved) => {
        this.isSavingProposal = false;
        this.closeProposalModal();
        this.dialog.success(editingId ? 'Proposal updated successfully.' : 'Proposal created successfully.');
        this.loadLead(this.leadId!);
        // Only pop the PDF on creation. Reopening a tab on every small edit is
        // noise, and the row's View action is right there.
        if (!editingId && saved?.id) this.openQuotationPdf(saved.id);
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
  // ═══════════════════════════════════════════
  // PRE-SALES
  //
  // An admin puts people on the deal; whoever added them (or an admin) raises
  // tasks; the assignee drives each task through NEW → WORKING → ON HOLD →
  // COMPLETED. Everything the buttons allow is decided by the server and
  // handed back in `permissions` — this component only reflects it, so a user
  // who tampers with the flags still gets a 403.
  // ═══════════════════════════════════════════

  presalesInfo: any = null;
  loadingPresales = false;
  presalesMembers: any[] = [];
  presalesRequests: any[] = [];
  presalesTasks: any[] = [];
  presalesEmployees: any[] = [];

  get isAdminOrSuperAdmin(): boolean {
    const role = this.auth.currentUser()?.role;
    return role === 'ADMIN' || role === 'SUPERADMIN';
  }

  /** Straight from the server; never inferred from the role in the browser. */
  get presalesPermissions(): any {
    return this.presalesInfo?.permissions || {};
  }

  get presalesFinancialsHidden(): boolean {
    return !!this.presalesPermissions.financialsHidden;
  }

  loadPresalesEmployees() {
    this.http.get<any[]>(`${environment.apiUrl}/employees`).subscribe({
      next: (data) => (this.presalesEmployees = data || []),
      error: () => (this.presalesEmployees = []),
    });
  }

  loadPresalesInfo() {
    if (this.leadId == null) return;
    this.loadingPresales = true;
    this.http.get<any>(`${environment.apiUrl}/crm/leads/${this.leadId}/pre-sales`).subscribe({
      next: (data) => {
        this.presalesInfo = data;
        this.presalesMembers = data?.members || [];
        this.presalesRequests = data?.requests || [];
        this.presalesTasks = data?.tasks || [];
        this.loadingPresales = false;
      },
      error: () => (this.loadingPresales = false),
    });
  }

  presalesName(row: any): string {
    const e = row?.employee || row?.assignedTo || row?.assignedBy || row?.requestedBy || row;
    return `${e?.firstName || ''} ${e?.lastName || ''}`.trim() || '—';
  }

  presalesInitials(row: any): string {
    const e = row?.employee || row?.assignedTo || row;
    return `${e?.firstName?.[0] || ''}${e?.lastName?.[0] || ''}`.toUpperCase() || 'PS';
  }

  /** "150" → "2h 30m". Stored as minutes; only ever formatted for display. */
  formatDuration(minutes: any): string {
    const n = Number(minutes);
    if (!Number.isFinite(n) || n <= 0) return '—';
    const h = Math.floor(n / 60);
    const m = n % 60;
    return [h ? `${h}h` : '', m ? `${m}m` : ''].filter(Boolean).join(' ') || '—';
  }

  taskStatusClass(status: string): string {
    return 'ps-status-' + String(status || 'NEW').toLowerCase().replace('_', '-');
  }

  taskStatusLabel(status: string): string {
    return String(status || 'NEW').replace('_', ' ');
  }

  get activeMembers(): any[] {
    return (this.presalesMembers || []).filter((m) => m.status === 'ACTIVE');
  }

  get pendingRequests(): any[] {
    return (this.presalesRequests || []).filter((r) => r.status === 'PENDING');
  }

  // ── add members (admin) ────────────────────────────────────────────────────

  showAddPresalesModal = false;
  addPresalesSearch = '';
  addPresalesSelected: number[] = [];
  addPresalesRemark = '';
  savingAddPresales = false;

  openAddPresalesModal() {
    this.addPresalesScope = 'core';
    this.addPresalesSearch = '';
    this.addPresalesSelected = [];
    this.addPresalesRemark = '';
    this.showAddPresalesModal = true;
    if (!this.presalesEmployees.length) this.loadPresalesEmployees();
  }

  closeAddPresalesModal() {
    if (this.savingAddPresales) return;
    this.showAddPresalesModal = false;
  }

  /**
   * Roles the picker offers first. A presentation default, not a rule: the API
   * accepts any employee of the company, and the Others tab exists precisely
   * because the right specialist is often outside these roles.
   */
  private static readonly PRE_SALES_ELIGIBLE_ROLES = ['SUPERADMIN', 'ADMIN', 'SALES'];

  private matchesScope(employee: any, scope: PreSalesScope): boolean {
    if (scope === 'all') return true;
    const core = LeadProfileComponent.PRE_SALES_ELIGIBLE_ROLES.includes(employee.user?.role);
    return scope === 'core' ? core : !core;
  }

  /** Tab counts, so a manager can see there are others before switching. */
  presalesScopeCount(scope: PreSalesScope): number {
    return this.presalesCandidates('', scope).length;
  }

  /**
   * Which tab each picker is on. Separate per modal: the add and request flows
   * are used by different people for different reasons.
   */
  addPresalesScope: PreSalesScope = 'core';
  requestPresalesScope: PreSalesScope = 'core';

  /**
   * Who can be added: on staff, not already on this team, matching the search.
   *
   * Suspended accounts are excluded — that is what deactivating an employee
   * sets, and assigning pre-sales work to someone who cannot sign in is a
   * dead end. PENDING_VERIFICATION is deliberately kept: those are real staff
   * who simply have not clicked the email link yet.
   *
   * Ordered oldest first by joining date, so the long-established people a manager
   * is looking for are at the top rather than buried under recent joiners.
   */
  presalesCandidates(search: string, scope: PreSalesScope = 'all'): any[] {
    const onTeam = new Set(this.activeMembers.map((m) => m.employeeId));
    const term = (search || '').toLowerCase().trim();

    return (this.presalesEmployees || [])
      .filter((e) => !onTeam.has(e.id))
      .filter((e) => e.user?.status !== 'SUSPENDED')
      .filter((e) => this.matchesScope(e, scope))
      .filter((e) => !term ||
        `${e.firstName || ''} ${e.lastName || ''}`.toLowerCase().includes(term) ||
        (e.designation?.name || '').toLowerCase().includes(term) ||
        (e.department?.name || '').toLowerCase().includes(term))
      .sort((a, b) => {
        // Anyone without a joining date sorts last rather than to 1970.
        const at = a.joiningDate ? new Date(a.joiningDate).getTime() : Number.MAX_SAFE_INTEGER;
        const bt = b.joiningDate ? new Date(b.joiningDate).getTime() : Number.MAX_SAFE_INTEGER;
        return at !== bt ? at - bt : (a.id || 0) - (b.id || 0);
      });
  }

  togglePresalesCandidate(employeeId: number) {
    const i = this.addPresalesSelected.indexOf(employeeId);
    if (i >= 0) this.addPresalesSelected.splice(i, 1);
    else this.addPresalesSelected.push(employeeId);
  }

  isPresalesCandidateSelected(employeeId: number): boolean {
    return this.addPresalesSelected.includes(employeeId);
  }

  saveAddPresales() {
    if (this.leadId == null || !this.addPresalesSelected.length) {
      this.dialog.error('Select at least one employee.');
      return;
    }
    this.savingAddPresales = true;
    this.http.post<any>(`${environment.apiUrl}/crm/leads/${this.leadId}/pre-sales/members`, {
      employeeIds: this.addPresalesSelected,
      remark: this.addPresalesRemark,
    }).subscribe({
      next: (info) => {
        this.savingAddPresales = false;
        this.showAddPresalesModal = false;
        this.applyPresalesInfo(info);
        this.dialog.success('Pre-sales team updated.');
      },
      error: (err) => {
        this.savingAddPresales = false;
        this.dialog.error(err?.error?.message || 'Could not add the pre-sales members.');
      },
    });
  }

  private applyPresalesInfo(info: any) {
    if (!info?.members) return this.loadPresalesInfo();
    this.presalesInfo = info;
    this.presalesMembers = info.members || [];
    this.presalesRequests = info.requests || [];
    this.presalesTasks = info.tasks || [];
  }

  async removePresalesMember(member: any) {
    if (this.leadId == null) return;
    const ok = await this.dialog.confirm(
      `Remove ${this.presalesName(member)} from this deal's pre-sales team?`,
      'Remove pre-sales member', 'Remove', 'Cancel',
    );
    if (!ok) return;

    this.http.delete<any>(`${environment.apiUrl}/crm/leads/${this.leadId}/pre-sales/members/${member.id}`)
      .subscribe({
        next: (info) => { this.applyPresalesInfo(info); this.dialog.success('Member removed.'); },
        error: (err) => this.dialog.error(err?.error?.message || 'Could not remove the member.'),
      });
  }

  // ── request a member (non-admin) ───────────────────────────────────────────

  showRequestPresalesModal = false;
  requestPresalesSearch = '';
  requestPresalesForm: { employeeId: number | null; reason: string } = { employeeId: null, reason: '' };
  savingRequestPresales = false;

  openRequestPresalesModal() {
    this.requestPresalesScope = 'core';
    this.requestPresalesSearch = '';
    this.requestPresalesForm = { employeeId: null, reason: '' };
    this.showRequestPresalesModal = true;
    if (!this.presalesEmployees.length) this.loadPresalesEmployees();
  }

  closeRequestPresalesModal() {
    if (this.savingRequestPresales) return;
    this.showRequestPresalesModal = false;
  }

  saveRequestPresales() {
    if (this.leadId == null) return;
    if (!this.requestPresalesForm.employeeId) { this.dialog.error('Select an employee.'); return; }
    if (!this.requestPresalesForm.reason.trim()) {
      this.dialog.error('Give a reason — an administrator has to approve this without knowing the deal.');
      return;
    }
    this.savingRequestPresales = true;
    this.http.post<any>(`${environment.apiUrl}/crm/leads/${this.leadId}/pre-sales/requests`, this.requestPresalesForm)
      .subscribe({
        next: () => {
          this.savingRequestPresales = false;
          this.showRequestPresalesModal = false;
          this.loadPresalesInfo();
          this.dialog.success('Request sent to the administrator for approval.');
        },
        error: (err) => {
          this.savingRequestPresales = false;
          this.dialog.error(err?.error?.message || 'Could not send the request.');
        },
      });
  }

  // ── tasks ──────────────────────────────────────────────────────────────────

  readonly preSalesTaskTypes: string[] = [
    'Client Meeting',
    'Product Demo',
    'Technical Requirement Gathering',
    'Solution Architecture & Design',
    'Proof of Concept (POC)',
    'RFP / Tender Response',
    'BOM (Bill of Materials) Preparation',
    'Security & Compliance Review',
    'Infrastructure Assessment',
    'Client Follow-up'
  ];

  taskTypeSelection: string = '';
  customTaskType: string = '';
  taskErrors: { title?: string; assignedToId?: string } = {};
  taskSubmitted = false;

  showTaskModal = false;
  editingTaskId: number | null = null;
  taskForm: any = this.freshTaskForm();
  savingTask = false;
  uploadingTaskFiles = 0;

  private freshTaskForm() {
    return {
      title: '', taskType: '', assignedToId: null as number | null,
      scheduledDate: '', scheduledTime: '',
      durationHours: 0, durationMinutes: 0,
      description: '', attachments: [] as any[],
    };
  }

  openTaskModal(task?: any) {
    this.editingTaskId = task?.id ?? null;
    this.taskErrors = {};
    this.taskSubmitted = false;
    if (task) {
      const type = task.taskType || '';
      const isPredefined = this.preSalesTaskTypes.includes(type);
      this.taskTypeSelection = isPredefined ? type : (type ? 'Custom' : '');
      this.customTaskType = isPredefined ? '' : type;
      this.taskForm = {
        title: task.title || '',
        taskType: type,
        assignedToId: task.assignedToId ?? null,
        scheduledDate: task.scheduledAt ? new Date(task.scheduledAt).toISOString().slice(0, 10) : '',
        scheduledTime: task.scheduledAt ? new Date(task.scheduledAt).toTimeString().slice(0, 5) : '',
        durationHours: Math.floor((task.estimatedMinutes || 0) / 60),
        durationMinutes: (task.estimatedMinutes || 0) % 60,
        description: task.description || '',
        attachments: [],
      };
    } else {
      this.taskTypeSelection = '';
      this.customTaskType = '';
      this.taskForm = this.freshTaskForm();
    }
    this.showTaskModal = true;
  }

  onTaskTypeSelect() {
    if (this.taskTypeSelection === 'Custom') {
      this.taskForm.taskType = this.customTaskType;
    } else {
      this.taskForm.taskType = this.taskTypeSelection;
    }
  }

  onCustomTaskTypeInput() {
    this.taskForm.taskType = this.customTaskType;
  }

  closeTaskModal() {
    if (this.savingTask) return;
    this.showTaskModal = false;
    this.editingTaskId = null;
    this.taskErrors = {};
    this.taskSubmitted = false;
  }

  onTaskFilesSelected(event: any) {
    const files: File[] = Array.from(event.target?.files || []);
    event.target.value = '';
    for (const file of files) {
      this.uploadingTaskFiles++;
      const form = new FormData();
      form.append('file', file);
      // The CRM's existing upload endpoint — no second storage system.
      this.http.post<{ url: string }>(`${environment.apiUrl}/upload`, form).subscribe({
        next: (res) => {
          this.taskForm.attachments = [
            ...this.taskForm.attachments,
            { fileName: file.name, fileUrl: res.url, fileSize: file.size },
          ];
          this.uploadingTaskFiles--;
        },
        error: () => {
          this.uploadingTaskFiles--;
          this.dialog.error(`Failed to upload "${file.name}".`);
        },
      });
    }
  }

  removeTaskAttachment(index: number) {
    this.taskForm.attachments.splice(index, 1);
  }

  saveTask() {
    if (this.leadId == null) return;
    this.taskSubmitted = true;
    this.taskErrors = {};

    let hasError = false;
    if (!this.taskForm.title || !this.taskForm.title.trim()) {
      this.taskErrors.title = 'Task title is required.';
      hasError = true;
    }
    if (!this.taskForm.assignedToId) {
      this.taskErrors.assignedToId = 'Please select a pre-sales specialist.';
      hasError = true;
    }

    if (hasError) {
      return;
    }

    if (this.uploadingTaskFiles > 0) {
      this.dialog.error('Wait for the attachments to finish uploading.');
      return;
    }

    if (this.taskTypeSelection === 'Custom') {
      this.taskForm.taskType = (this.customTaskType || '').trim();
    } else {
      this.taskForm.taskType = this.taskTypeSelection;
    }

    this.savingTask = true;
    const base = `${environment.apiUrl}/crm/leads/${this.leadId}/pre-sales/tasks`;
    const request = this.editingTaskId
      ? this.http.put<any>(`${base}/${this.editingTaskId}`, this.taskForm)
      : this.http.post<any>(base, this.taskForm);

    request.subscribe({
      next: () => {
        this.savingTask = false;
        this.showTaskModal = false;
        this.editingTaskId = null;
        this.taskSubmitted = false;
        this.taskErrors = {};
        this.loadPresalesInfo();
        this.dialog.success('Task saved.');
      },
      error: (err) => {
        this.savingTask = false;
        this.dialog.error(err?.error?.message || 'Could not save the task.');
      },
    });
  }

  /** Deleting removes the task and its history; completing keeps the record. */
  async deleteTask(task: any) {
    if (this.leadId == null) return;
    const ok = await this.dialog.confirm(
      `Delete "${task.title}"? Its status history and attachments go with it.`,
      'Delete task', 'Delete', 'Cancel',
    );
    if (!ok) return;

    this.http.delete<any>(`${environment.apiUrl}/crm/leads/${this.leadId}/pre-sales/tasks/${task.id}`)
      .subscribe({
        next: () => { this.loadPresalesInfo(); this.dialog.success('Task deleted.'); },
        error: (err) => this.dialog.error(err?.error?.message || 'Could not delete the task.'),
      });
  }

  // ── task status ────────────────────────────────────────────────────────────

  showStatusModal = false;
  statusTask: any = null;
  statusForm: any = { status: 'WORKING', remark: '', attachments: [] as any[] };
  savingStatus = false;
  uploadingStatusFiles = 0;

  /** Which moves this task can make next. COMPLETED is terminal. */
  nextStatuses(task: any): string[] {
    switch (String(task?.status || 'NEW')) {
      case 'NEW': return ['WORKING'];
      case 'WORKING': return ['ON_HOLD', 'COMPLETED'];
      case 'ON_HOLD': return ['WORKING', 'COMPLETED'];
      default: return [];
    }
  }

  openStatusModal(task: any, status: string) {
    this.statusTask = task;
    this.statusForm = { status, remark: '', attachments: [] };
    this.showStatusModal = true;
  }

  closeStatusModal() {
    if (this.savingStatus) return;
    this.showStatusModal = false;
    this.statusTask = null;
  }

  onStatusFilesSelected(event: any) {
    const files: File[] = Array.from(event.target?.files || []);
    event.target.value = '';
    for (const file of files) {
      this.uploadingStatusFiles++;
      const form = new FormData();
      form.append('file', file);
      this.http.post<{ url: string }>(`${environment.apiUrl}/upload`, form).subscribe({
        next: (res) => {
          this.statusForm.attachments = [
            ...this.statusForm.attachments,
            { fileName: file.name, fileUrl: res.url, fileSize: file.size },
          ];
          this.uploadingStatusFiles--;
        },
        error: () => {
          this.uploadingStatusFiles--;
          this.dialog.error(`Failed to upload "${file.name}".`);
        },
      });
    }
  }

  /** Required for ON_HOLD and COMPLETED — the server insists too. */
  get statusRemarkRequired(): boolean {
    return this.statusForm.status === 'ON_HOLD' || this.statusForm.status === 'COMPLETED';
  }

  saveStatus() {
    if (this.leadId == null || !this.statusTask) return;
    if (this.statusRemarkRequired && !this.statusForm.remark.trim()) {
      this.dialog.error(this.statusForm.status === 'ON_HOLD'
        ? 'Say why the task is on hold.'
        : 'Add a completion remark before marking the task complete.');
      return;
    }
    if (this.uploadingStatusFiles > 0) { this.dialog.error('Wait for the attachments to finish uploading.'); return; }

    this.savingStatus = true;
    this.http.post<any>(
      `${environment.apiUrl}/crm/leads/${this.leadId}/pre-sales/tasks/${this.statusTask.id}/status`,
      this.statusForm,
    ).subscribe({
      next: () => {
        this.savingStatus = false;
        this.showStatusModal = false;
        this.statusTask = null;
        this.loadPresalesInfo();
        this.dialog.success('Task updated.');
      },
      error: (err) => {
        this.savingStatus = false;
        this.dialog.error(err?.error?.message || 'Could not update the task.');
      },
    });
  }

  // ── history ────────────────────────────────────────────────────────────────

  showHistoryModal = false;
  historyTask: any = null;
  taskHistory: any[] = [];
  loadingTaskHistory = false;

  openTaskHistory(task: any) {
    if (this.leadId == null) return;
    this.historyTask = task;
    this.taskHistory = [];
    this.loadingTaskHistory = true;
    this.showHistoryModal = true;
    this.http.get<any[]>(`${environment.apiUrl}/crm/leads/${this.leadId}/pre-sales/tasks/${task.id}/history`)
      .subscribe({
        next: (rows) => { this.taskHistory = rows || []; this.loadingTaskHistory = false; },
        error: () => { this.loadingTaskHistory = false; this.dialog.error('Could not load the task history.'); },
      });
  }

  closeHistoryModal() {
    this.showHistoryModal = false;
    this.historyTask = null;
  }
}
