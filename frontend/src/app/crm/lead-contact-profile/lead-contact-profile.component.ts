import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, NgForm } from '@angular/forms';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import {
  LucideArrowLeft, LucideMapPin,
  LucideGlobe, LucideExternalLink, LucideCalendar, LucideAward, LucideUser,
  LucideUserCheck, LucideBriefcase, LucideLayoutList, LucideMessageSquare,
  LucideMoreVertical, LucideEdit2, LucideUserPlus, LucideX, LucidePlus, LucideDownload,
  LucideEye, LucideEdit, LucideTrash2, LucideSearch, LucideChevronLeft, LucideChevronRight,
  LucideTrendingUp, LucideCheckCircle, LucideClock
} from '@lucide/angular';
import { DialogService } from '../../shared/services/dialog.service';

const LEAD_SOURCES = [
  'Friend Reference', 'Google Search', 'Social Media', 'Website', 'Cold Call',
  'Email Campaign', 'Event', 'Referral', 'Advertisement', 'Walk-In', 'Other'
];

@Component({
  selector: 'app-lead-contact-profile',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterModule,
    LucideArrowLeft, LucideMapPin,
    LucideGlobe, LucideExternalLink, LucideCalendar, LucideAward, LucideUser,
    LucideUserCheck, LucideBriefcase, LucideLayoutList, LucideMessageSquare,
    LucideMoreVertical, LucideEdit2, LucideUserPlus, LucideX, LucidePlus, LucideDownload,
    LucideEye, LucideEdit, LucideTrash2, LucideSearch, LucideChevronLeft, LucideChevronRight,
    LucideTrendingUp, LucideCheckCircle, LucideClock
  ],
  templateUrl: './lead-contact-profile.html',
  styleUrls: ['./lead-contact-profile.css']
})
export class LeadContactProfileComponent implements OnInit {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private dialog = inject(DialogService);

  contact: any = null;
  isLoading = true;
  activeTab: 'overview' | 'deals' | 'notes' = 'overview';

  moreMenuOpen = false;

  editModalOpen = false;
  isSavingEdit = false;
  editForm: any = {};

  isConverting = false;

  sourceOptions = LEAD_SOURCES;

  employees: any[] = [];
  dealModalOpen = false;
  isSavingDeal = false;
  dealForm: any = {};
  isExporting = false;

  // ── Notes tab ──────────────────────────────────────────────
  notes: any[] = [];
  loadingNotes = false;
  noteSearch = '';
  notePage = 1;
  notePageSize = 8;
  selectedNoteIds: Set<number> = new Set();

  noteModalOpen = false;
  isEditingNote = false;
  isSavingNote = false;
  viewNoteOpen = false;
  viewingNote: any = null;
  noteForm: any = { id: null, title: '', type: 'GENERAL', content: '' };

  readonly NOTE_TYPES = ['GENERAL', 'CALL', 'MEETING', 'EMAIL', 'FOLLOW_UP', 'OTHER'];

  ngOnInit() {
    this.route.paramMap.subscribe(params => {
      const id = params.get('id');
      if (id) this.loadContact(+id);
    });
    this.loadEmployees();
  }

  loadEmployees() {
    this.http.get<any[]>(`${environment.apiUrl}/employees`).subscribe({
      next: (data) => this.employees = Array.isArray(data) ? data : [],
      error: (err) => console.error('Failed to load employees', err)
    });
  }

  loadContact(id: number) {
    this.isLoading = true;
    this.http.get<any>(`${environment.apiUrl}/crm/lead-contacts/${id}`).subscribe({
      next: (data) => {
        this.contact = data;
        this.isLoading = false;
        this.notes = [];
        this.selectedNoteIds.clear();
        this.notePage = 1;
        this.noteSearch = '';
      },
      error: (err) => {
        console.error('Error loading lead contact profile', err);
        this.isLoading = false;
      }
    });
  }

  setTab(tab: 'overview' | 'deals' | 'notes') {
    this.activeTab = tab;
    if (tab === 'notes' && this.contact) this.loadNotes();
  }

  getInitials(name?: string): string {
    if (!name) return 'LC';
    const words = name.trim().split(/\s+/);
    if (words.length === 1) return words[0].substring(0, 2).toUpperCase();
    return (words[0][0] + (words[words.length - 1][0] || '')).toUpperCase();
  }

  get fullName(): string {
    const c = this.contact;
    if (!c) return '—';
    return [c.salutation, c.name].filter(Boolean).join(' ');
  }

  initialsOf(emp: any): string {
    if (!emp) return '?';
    const first = emp.firstName?.[0] || '';
    const last = emp.lastName?.[0] || '';
    return (first + last).toUpperCase() || '?';
  }

  get leadsBrought(): any[] {
    return this.contact?.leadsBrought || [];
  }

  get fullLocation(): string {
    const c = this.contact;
    if (!c) return '';
    const parts = [c.city, c.state, c.country].filter(Boolean);
    return parts.join(', ');
  }

  get addedByName(): string {
    const a = this.contact?.addedBy;
    if (!a) return '';
    return `${a.firstName || ''} ${a.lastName || ''}`.trim();
  }

  get formattedWebsiteUrl() {
    const url = this.contact?.website?.trim() || '';
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    return `https://${url}`;
  }

  get openResolvedLeadsCount(): number {
    return this.leadsBrought.filter((l: any) => l.status !== 'WON' && l.status !== 'LOST').length;
  }

  get wonLeadsCount(): number {
    return this.leadsBrought.filter((l: any) => l.status === 'WON').length;
  }

  get lostLeadsCount(): number {
    return this.leadsBrought.filter((l: any) => l.status === 'LOST').length;
  }

  get lostLeadsValue(): number {
    return this.leadsBrought
      .filter((l: any) => l.status === 'LOST')
      .reduce((sum: number, l: any) => sum + (l.value || 0), 0);
  }

  get wonDealsValue(): number {
    return this.leadsBrought
      .filter((l: any) => l.status === 'WON')
      .reduce((sum: number, l: any) => sum + (l.value || 0), 0);
  }

  get openLeadsCount(): number {
    return this.leadsBrought.filter((l: any) => l.status !== 'WON' && l.status !== 'LOST').length;
  }

  get openDealsValue(): number {
    return this.leadsBrought
      .filter((l: any) => l.status !== 'WON' && l.status !== 'LOST')
      .reduce((sum: number, l: any) => sum + (l.value || 0), 0);
  }

  get conversionRate(): number {
    if (!this.leadsBrought.length) return 0;
    return (this.wonLeadsCount / this.leadsBrought.length) * 100;
  }

  get totalValue(): number {
    return this.leadsBrought.reduce((sum: number, l: any) => sum + (l.value || 0), 0);
  }

  get allFollowUps(): any[] {
    const result: any[] = [];
    this.leadsBrought.forEach((lead: any) => {
      (lead.followUps || []).forEach((fu: any) => {
        result.push({ ...fu, leadTitle: lead.title, leadId: lead.id });
      });
    });
    return result.sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime());
  }

  isUpcoming(fu: any): boolean {
    return new Date(fu.scheduledAt).getTime() > Date.now();
  }

  statusClass(status: string): string {
    const base = (status || '').toUpperCase();
    if (base === 'NEW') return 'lead-status-new';
    if (base === 'QUALIFIED') return 'lead-status-qualified';
    if (base === 'PROPOSAL') return 'lead-status-proposal';
    if (base === 'WON') return 'lead-status-won';
    if (base === 'LOST') return 'lead-status-lost';
    return 'lead-status-default';
  }

  followUpTypeClass(type: string): string {
    return 'fu-type-' + (type || 'other').toLowerCase().replace(/[^a-z_]/g, '');
  }

  stageLabel(status: string): string {
    return (status || '—').toUpperCase();
  }

  dealStatusClass(status: string): string {
    const s = (status || '').toUpperCase();
    if (s === 'WON') return 'deal-won';
    if (s === 'LOST') return 'deal-rejected';
    if (s === 'PROPOSAL') return 'deal-open';
    return 'deal-draft';
  }

  dealStatusLabel(status: string): string {
    const s = (status || '').toUpperCase();
    if (s === 'WON') return 'Won';
    if (s === 'LOST') return 'Lost';
    if (s === 'PROPOSAL') return 'Open';
    if (s === 'QUALIFIED') return 'Open';
    return 'Open';
  }

  stageClass(status: string): string {
    const s = (status || '').toUpperCase();
    if (s === 'NEW') return 'stg-new';
    if (s === 'QUALIFIED') return 'stg-qualified';
    if (s === 'PROPOSAL') return 'stg-proposal';
    if (s === 'WON') return 'stg-won';
    if (s === 'LOST') return 'stg-lost';
    return 'stg-default';
  }

  changeLeadStage(lead: any, event: Event): void {
    const newStatus = (event.target as HTMLSelectElement).value;
    if (!lead || newStatus === lead.status) return;
    const prevStatus = lead.status;
    this.http.put(`${environment.apiUrl}/crm/leads/${lead.id}/status`, { status: newStatus }).subscribe({
      next: () => {
        lead.status = newStatus;
        this.dialog.success(`Deal moved to ${newStatus}.`);
      },
      error: (err) => {
        console.error(err);
        lead.status = prevStatus;
        this.dialog.error('Failed to update deal stage.');
      }
    });
  }

  nextFollowUp(lead: any): string {
    const fups = lead?.followUps || [];
    if (!fups.length) return '—';
    const upcoming = fups
      .map((f: any) => new Date(f.scheduledAt).getTime())
      .filter((t: number) => !isNaN(t) && t >= Date.now())
      .sort((a: number, b: number) => a - b);
    const ts = upcoming[0] ?? -1;
    if (ts === -1) return '—';
    const d = new Date(ts);
    return `${d.toLocaleDateString()}${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }

  // ═══════════════════════════════════════════
  // NOTES TAB
  // ═══════════════════════════════════════════

  loadNotes() {
    if (!this.contact) return;
    this.loadingNotes = true;
    this.http.get<any[]>(`${environment.apiUrl}/crm/lead-contacts/${this.contact.id}/notes`).subscribe({
      next: (data) => {
        this.notes = data || [];
        this.notePage = 1;
        this.selectedNoteIds.clear();
        this.loadingNotes = false;
      },
      error: (err) => {
        console.error('Failed to load notes', err);
        this.loadingNotes = false;
        this.dialog.error('Failed to load notes.');
      }
    });
  }

  get filteredNotes(): any[] {
    const q = (this.noteSearch || '').trim().toLowerCase();
    if (!q) return this.notes;
    return this.notes.filter((n: any) =>
      (n.title || '').toLowerCase().includes(q) ||
      (n.content || '').toLowerCase().includes(q) ||
      (n.type || '').toLowerCase().includes(q)
    );
  }

  get noteTotalPages(): number {
    return Math.max(1, Math.ceil(this.filteredNotes.length / this.notePageSize));
  }

  get pagedNotes(): any[] {
    const start = (this.notePage - 1) * this.notePageSize;
    return this.filteredNotes.slice(start, start + this.notePageSize);
  }

  setNotePage(page: number) {
    if (page < 1 || page > this.noteTotalPages) return;
    this.notePage = page;
  }

  onNoteSearch() {
    this.notePage = 1;
  }

  get allNotesSelected(): boolean {
    return this.filteredNotes.length > 0 && this.filteredNotes.every((n: any) => this.selectedNoteIds.has(n.id));
  }

  toggleAllNotes() {
    if (this.allNotesSelected) {
      this.filteredNotes.forEach((n: any) => this.selectedNoteIds.delete(n.id));
    } else {
      this.filteredNotes.forEach((n: any) => this.selectedNoteIds.add(n.id));
    }
  }

  toggleNote(note: any) {
    if (this.selectedNoteIds.has(note.id)) this.selectedNoteIds.delete(note.id);
    else this.selectedNoteIds.add(note.id);
  }

  openAddNote() {
    this.isEditingNote = false;
    this.noteForm = { id: null, title: '', type: 'GENERAL', content: '' };
    this.noteModalOpen = true;
  }

  openEditNote(note: any) {
    this.isEditingNote = true;
    this.noteForm = { id: note.id, title: note.title, type: note.type || 'GENERAL', content: note.content || '' };
    this.noteModalOpen = true;
  }

  openViewNote(note: any) {
    this.viewingNote = note;
    this.viewNoteOpen = true;
  }

  closeViewNote() {
    this.viewNoteOpen = false;
    this.viewingNote = null;
  }

  closeNoteModal() {
    if (this.isSavingNote) return;
    this.noteModalOpen = false;
  }

  saveNote() {
    if (!this.noteForm.title || !this.noteForm.title.trim()) {
      this.dialog.error('Note title is required.');
      return;
    }
    this.isSavingNote = true;
    const payload: any = {
      title: this.noteForm.title.trim(),
      type: this.noteForm.type || 'GENERAL',
      content: this.noteForm.content || ''
    };
    const base = `${environment.apiUrl}/crm/lead-contacts/${this.contact.id}/notes`;
    const req = this.isEditingNote
      ? this.http.put<any>(`${base}/${this.noteForm.id}`, payload)
      : this.http.post<any>(base, payload);

    req.subscribe({
      next: (data) => {
        this.isSavingNote = false;
        this.noteModalOpen = false;
        if (this.isEditingNote) {
          this.notes = this.notes.map((n: any) => n.id === data.id ? data : n);
          this.dialog.success('Note updated.');
        } else {
          this.notes.unshift(data);
          this.notePage = 1;
          this.dialog.success('Note added.');
        }
      },
      error: (err) => {
        this.isSavingNote = false;
        this.dialog.error(err?.error?.message || 'Failed to save note.');
      }
    });
  }

  async deleteNote(note: any) {
    const confirmed = await this.dialog.confirm('Delete this note?', 'Delete note', 'Delete', 'Cancel');
    if (!confirmed) return;
    this.http.delete(`${environment.apiUrl}/crm/lead-contacts/${this.contact.id}/notes/${note.id}`).subscribe({
      next: () => {
        this.notes = this.notes.filter((n: any) => n.id !== note.id);
        this.selectedNoteIds.delete(note.id);
        this.dialog.success('Note deleted.');
      },
      error: (err) => {
        console.error(err);
        this.dialog.error('Failed to delete note.');
      }
    });
  }

  noteTypeLabel(type: string): string {
    const t = (type || 'GENERAL').toUpperCase();
    const map: any = { GENERAL: 'General', CALL: 'Call', MEETING: 'Meeting', EMAIL: 'Email', FOLLOW_UP: 'Follow Up', OTHER: 'Other' };
    return map[t] || t;
  }

  noteTypeClass(type: string): string {
    return 'note-type-' + (type || 'general').toLowerCase();
  }

  exportNotesCsv() {
    const selected = [...this.selectedNoteIds];
    const forExport = selected.length
      ? this.filteredNotes.filter((n: any) => selected.includes(n.id))
      : this.filteredNotes;
    if (!forExport.length) {
      this.dialog.error('No notes to export.');
      return;
    }
    const csvRows = [
      ['Title', 'Type', 'Detail', 'Created By', 'Created'].join(','),
      ...forExport.map((n: any) => [
        this.escapeCsv(n.title || ''),
        this.escapeCsv(this.noteTypeLabel(n.type)),
        this.escapeCsv(n.content || ''),
        this.escapeCsv(this.employeeName(n.createdBy)),
        new Date(n.createdAt).toLocaleString()
      ].join(','))
    ];
    const csv = '\uFEFF' + csvRows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const name = (this.contact?.name || 'contact').trim().replace(/\s+/g, '_');
    a.href = url;
    a.download = `notes_${name}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  openAddDeal() {
    const c = this.contact;
    this.dealForm = {
      title: '',
      subjectLine: '',
      dealCategory: '',
      companyName: c?.companyName || '',
      contactName: c?.name || '',
      email: c?.email || '',
      phone: c?.phone || c?.mobile || '',
      website: c?.website || '',
      address: c?.address || '',
      value: null,
      currency: 'INR',
      expectedCloseDate: '',
      status: 'NEW',
      source: c?.leadSource || '',
      assignedToId: null,
      broughtByContactId: c?.id ?? null,
      description: ''
    };
    this.dealModalOpen = true;
  }

  closeAddDeal() {
    if (this.isSavingDeal) return;
    this.dealModalOpen = false;
  }

  saveDeal(form: NgForm) {
    if (!this.dealForm.title || !this.dealForm.title.trim()) return;
    this.isSavingDeal = true;
    const payload: any = { ...this.dealForm };
    if (!payload.broughtByContactId) delete payload.broughtByContactId;
    if (!payload.assignedToId) payload.assignedToId = null;
    if (payload.value === '' || payload.value == null) payload.value = null;
    this.http.post<any>(`${environment.apiUrl}/crm/leads`, payload).subscribe({
      next: () => {
        this.isSavingDeal = false;
        this.dealModalOpen = false;
        this.loadContact(this.contact.id);
      },
      error: (err) => {
        this.isSavingDeal = false;
        alert(err?.error?.message || 'Failed to add deal.');
      }
    });
  }

  exportLeadsCsv() {
    const leads = this.leadsBrought;
    const currency = leads[0]?.currency || 'INR';
    const csvRows = [
      ['Deal Name', 'Lead Name', 'Contact Details', 'Value', 'Close Date', 'Next Follow Up', 'Deal Agent', 'Deal Watcher', 'Stage', 'Deal Status'].join(','),
      ...leads.map((l: any) => [
        this.escapeCsv(l.title || ''),
        this.escapeCsv(l.contactName || ''),
        this.escapeCsv([l.email, l.phone].filter(Boolean).join(' | ')),
        l.value != null ? l.value : '',
        l.expectedCloseDate ? new Date(l.expectedCloseDate).toLocaleDateString() : '',
        this.nextFollowUp(l),
        this.escapeCsv(this.employeeName(l.assignedTo)),
        this.escapeCsv(this.employeeName(l.addedBy)),
        this.stageLabel(l.status),
        this.dealStatusLabel(l.status)
      ].join(','))
    ];
    const csv = '\uFEFF' + csvRows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const name = (this.contact?.name || 'contact').trim().replace(/\s+/g, '_');
    a.href = url;
    a.download = `leads_brought_${name}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  private escapeCsv(value: string): string {
    const v = String(value ?? '');
    if (v.includes(',') || v.includes('"') || v.includes('\n')) {
      return '"' + v.replace(/"/g, '""') + '"';
    }
    return v;
  }

  employeeName(emp: any): string {
    if (!emp) return 'Unassigned';
    return `${emp.firstName || ''} ${emp.lastName || ''}`.trim();
  }

  openLead(leadId: number) {
    this.router.navigate(['/crm/leads', leadId]);
  }

  goBack() {
    this.router.navigate(['/crm/leads']);
  }

  toggleMoreMenu() {
    this.moreMenuOpen = !this.moreMenuOpen;
  }

  closeMoreMenu() {
    this.moreMenuOpen = false;
  }

  openEditModal() {
    const c = this.contact;
    if (!c) return;
    this.editForm = {
      salutation: c.salutation || '',
      name: c.name || '',
      email: c.email || '',
      phone: c.phone || '',
      leadSource: c.leadSource || '',
      companyName: c.companyName || '',
      website: c.website || '',
      mobile: c.mobile || '',
      officePhoneNumber: c.officePhoneNumber || '',
      country: c.country || '',
      state: c.state || '',
      city: c.city || '',
      postalCode: c.postalCode || '',
      address: c.address || ''
    };
    this.editModalOpen = true;
    this.moreMenuOpen = false;
  }

  closeEditModal() {
    if (this.isSavingEdit) return;
    this.editModalOpen = false;
  }

  saveEdit(form: NgForm) {
    if (!this.contact) return;
    if (!this.editForm.name || !this.editForm.name.trim()) return;
    this.isSavingEdit = true;
    this.http.put<any>(`${environment.apiUrl}/crm/lead-contacts/${this.contact.id}`, this.editForm).subscribe({
      next: () => {
        this.isSavingEdit = false;
        this.editModalOpen = false;
        this.loadContact(this.contact.id);
      },
      error: (err) => {
        this.isSavingEdit = false;
        alert(err?.error?.message || 'Failed to update lead contact.');
      }
    });
  }

  convertToClient() {
    if (!this.contact || this.isConverting) return;
    const name = (this.contact.companyName || this.contact.name || '').trim();
    if (!name) {
      alert('This contact has no company or name to convert into a client.');
      return;
    }
    if (!confirm(`Convert "${name}" to a client?`)) return;
    this.isConverting = true;
    this.http.post<any>(`${environment.apiUrl}/crm/lead-contacts/${this.contact.id}/convert-to-client`, {}).subscribe({
      next: (client) => {
        this.isConverting = false;
        this.moreMenuOpen = false;
        alert(`"${client.name}" converted to a client successfully.`);
      },
      error: (err) => {
        this.isConverting = false;
        alert(err?.error?.message || 'Failed to convert to client.');
      }
    });
  }
}
