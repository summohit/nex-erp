import { inject, Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  LucideEye,
  LucideFileText,
  LucidePlus,
  LucideTrash2,
  LucideUploadCloud,
  LucideFolderOpen,
  LucideX,
  LucideImage,
  LucideUpload
} from '@lucide/angular';
import { DocumentRule, DocumentWaiver, EmployeeService } from '../../../services/employee.service';
import { AuthService } from '../../../services/auth.service';
import { HotToastService } from '@ngneat/hot-toast';

@Component({
  selector: 'app-documents-tab',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideEye,
    LucideFileText,
    LucidePlus,
    LucideTrash2,
    LucideUploadCloud,
    LucideFolderOpen,
    LucideX,
    LucideImage,
    LucideUpload
  ],
  templateUrl: './documents-tab.html',
  styleUrls: ['./documents-tab.css']
})
export class DocumentsTabComponent implements OnInit {
  @Input() employeeData: any;
  /** Self-service onboarding: show which documents are required (16 Nov 2026). */
  @Input() onboarding = false;
  /** HR's document rules (Settings → Document requirements, 16 Nov 2026). */
  rules: DocumentRule[] = [];

  /** The rules that apply to this person: interns and first jobs skip "not interns" ones. */
  get requiredRules(): DocumentRule[] {
    const e = this.employeeData || {};
    const intern = /intern/i.test(e.employmentType || '') || /intern/i.test(e.designation?.name || '');
    return this.rules.filter(r => r.active && (r.required === 'ALL' || (r.required === 'EXPERIENCED' && !intern && !e.firstJob)));
  }
  get requiredDocs(): string[] {
    return this.requiredRules.map(r => r.type);
  }
  private rule(type: string): DocumentRule | undefined {
    return this.rules.find(r => r.type === type);
  }
  /** Files needed for this type to count (Aadhaar front + back = 2). */
  need(type: string): number {
    return this.rule(type)?.count || 1;
  }
  hint(type: string): string {
    return this.rule(type)?.hint || '';
  }
  haveCount(type: string): number {
    return (this.employeeData?.documents || []).filter((d: any) => d.documentType === type).length;
  }
  hasDoc(type: string): boolean {
    return this.haveCount(type) >= this.need(type) || this.waiverFor(type)?.status === 'APPROVED';
  }

  // ── Waivers (16 Nov 2026): HR asks, the Super Admin approves or waives directly ──
  private auth = inject(AuthService);
  waivers: DocumentWaiver[] = [];
  get role(): string { return String(this.auth.currentUser()?.role || ''); }
  get canWaive(): boolean { return ['SUPERADMIN', 'HR', 'ADMIN'].includes(this.role); }
  /** The latest waiver for this type, if any. */
  waiverFor(type: string): DocumentWaiver | undefined {
    return this.waivers.find(w => w.documentType === type);
  }
  waiverText(w: DocumentWaiver): string {
    const who = (p?: { firstName: string; lastName: string } | null) => p ? `${p.firstName} ${p.lastName}`.trim() : 'Super Admin';
    const when = (d?: string | null) => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
    if (w.status === 'APPROVED') return `Waived by ${who(w.decidedBy)} · ${when(w.decidedAt)}`;
    if (w.status === 'PENDING') return 'Waiver waiting for Super Admin';
    return `Waiver rejected${w.decisionNote ? ': ' + w.decisionNote : ''}`;
  }
  loadWaivers() {
    const id = this.employeeData?.id;
    if (!id) return;
    this.employeeService.getDocumentWaivers(id).subscribe({ next: (w) => this.waivers = w || [], error: () => {} });
  }
  waive(type: string, event: Event) {
    event.stopPropagation();
    const direct = this.role === 'SUPERADMIN';
    const reason = window.prompt(`${direct ? 'Waive' : 'Ask the Super Admin to waive'} "${type}" for this employee.\n\nWhy can't they provide it?`);
    if (reason == null) return;
    if (reason.trim().length < 5) { this.toast.error('Give a short reason (at least 5 characters).'); return; }
    this.employeeService.requestDocumentWaiver(this.employeeData.id, type, reason.trim()).subscribe({
      next: () => {
        this.toast.success(direct ? `${type} waived` : 'Waiver sent to the Super Admin');
        this.loadWaivers();
        this.refreshProfile.emit();
      },
      error: (e) => this.toast.error(e?.error?.message || 'Could not request the waiver'),
    });
  }
  get requiredDocsLeft(): number {
    return this.requiredDocs.filter(t => !this.hasDoc(t)).length;
  }
  /** Opens the upload pop-up with this document type already picked. */
  uploadRequired(type: string) {
    if (this.hasDoc(type)) return;
    this.openModal();
    if (this.showModal) this.selectedDocumentType = type;
  }
  @Output() refreshProfile = new EventEmitter<void>();

  showModal = false;
  uploading = false;
  fileName = '';
  selectedFile: File | null = null;
  selectedFileUrl: string | null = null;

  /** The same list the profile reminder checks (server: profile-documents.ts). */
  documentTypes = [
    'Resume / CV',
    'Aadhaar Card',
    'PAN Card',
    'Passport Size Photo',
    '10th Marksheet',
    '12th Marksheet',
    'Graduation Degree',
    'Bank Proof / Cancelled Cheque',
    'Reference Person',
    'UAN',
    'Relieving / Experience Letter',
    'Payslips',
    'Passport',
    'Post-Graduation Degree',
    'Driving License / Voter ID',
    'Educational Certificate',
    'Form 16 / Tax Proof',
    'Other',
  ];

  selectedDocumentType = 'PAN Card';

  constructor(private employeeService: EmployeeService, private toast: HotToastService) {}

  ngOnInit() {
    this.loadWaivers();
    this.employeeService.getDocumentTypes().subscribe({
      next: (r) => {
        this.rules = r.rules || [];
        if (r.all?.length) this.documentTypes = r.all;
      },
      error: () => {},
    });
  }

  isImageDoc(doc: any): boolean {
    const type = (doc.documentType || '').toLowerCase();
    const name = (doc.fileName || '').toLowerCase();
    const url = (doc.fileUrl || '').toLowerCase();
    return type.includes('id card') || type.includes('aadhaar') || type.includes('pan') || type.includes('photo') || type.includes('license') ||
      name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg') || url.startsWith('data:image');
  }

  getDocBadgeLabel(type?: string): string {
    // The card's heading already says what it is (the typed name).
    if (!type || type === 'Other') return 'Other document';
    return type;
  }

  get availableDocumentTypes(): string[] {
    // A type stays offered until it has as many files as HR asks for.
    return this.documentTypes.filter(type => type === 'Other' || !this.hasDoc(type));
  }

  openModal() {
    const available = this.availableDocumentTypes;
    if (available.length === 0) {
      this.toast.info('You have already uploaded all available document types.');
      return;
    }
    this.showModal = true;
    this.fileName = '';
    this.nameFromFile = false;
    this.selectedDocumentType = available[0];
    this.selectedFile = null;
    this.selectedFileUrl = null;
  }

  closeModal() {
    this.showModal = false;
  }

  handleFileInput(event: any) {
    const file = event.target.files[0];
    if (!file) return;

    this.selectedFile = file;
    this.selectedFileUrl = null;

    if (!this.fileName && !this.isOtherType) {
      // Everything before the extension: the box asks for a name, not a
      // filename, and the user is about to read it back on a document card.
      // Not for "Other" — that name has to be typed (16 Nov 2026).
      this.fileName = file.name.replace(/\.[^.]+$/, '');
      this.nameFromFile = true;
    }

    // A thumbnail only for what can actually be shown. Reading a 40MB PDF into
    // a base64 data URL to render a generic file icon next to it costs the
    // browser real memory and shows the user nothing.
    if (file.type?.startsWith('image/') || file.type?.startsWith('video/')) {
      const reader = new FileReader();
      reader.onload = () => { this.selectedFileUrl = reader.result as string; };
      reader.readAsDataURL(file);
    }
  }

  /** Whether the chosen file can be shown rather than merely named. */
  get selectedIsPreviewable(): boolean {
    return !!this.selectedFileUrl;
  }

  /**
   * Drop the chosen file without closing the dialog.
   *
   * The input's value is cleared too, or picking the same file again fires no
   * change event and the box stays stubbornly empty.
   */
  clearSelectedFile(event?: Event, input?: HTMLInputElement) {
    event?.stopPropagation();
    event?.preventDefault();
    this.selectedFile = null;
    this.selectedFileUrl = null;
    if (input) input.value = '';
  }

  /** "2.4 MB" — the size as somebody would say it. */
  selectedFileSize(): string {
    const bytes = this.selectedFile?.size ?? 0;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  /**
   * "Other" documents carry a name the person types — "Medical Fitness
   * Certificate", "Gap Certificate" — so HR can tell what they are without
   * opening them (16 Nov 2026). Stored in fileName; the type stays "Other".
   */
  get isOtherType(): boolean {
    return this.selectedDocumentType === 'Other';
  }

  /** True while the name box holds the auto-filled file name, not a typed one. */
  nameFromFile = false;

  onTypeChange(type: string) {
    this.selectedDocumentType = type;
    // A file name like "IMG_2034" is no name for an "Other" document.
    if (type === 'Other' && this.nameFromFile) { this.fileName = ''; this.nameFromFile = false; }
  }

  submitDocument() {
    const name = (this.fileName || '').trim();
    if (this.isOtherType && name.length < 3) {
      this.toast.error('Enter the document’s name, e.g. Medical Fitness Certificate');
      return;
    }
    if (!name || !this.selectedFile) {
      this.toast.error('File name and file are required');
      return;
    }
    this.fileName = name;
    
    this.uploading = true;
    this.toast.loading('Uploading document...', { id: 'doc-upload' });

    this.employeeService.uploadDocument(this.selectedFile).subscribe({
      next: (uploadRes) => {
        const payload = {
          fileName: this.fileName,
          fileUrl: uploadRes.url,
          documentType: this.selectedDocumentType
        };

        this.employeeService.addDocument(this.employeeData.id, payload).subscribe({
          next: () => {
            this.toast.success('Document uploaded successfully', { id: 'doc-upload' });
            this.closeModal();
            this.refreshProfile.emit();
            this.uploading = false;
          },
          error: (err: any) => {
            this.toast.error('Failed to save document record', { id: 'doc-upload' });
            console.error(err);
            this.uploading = false;
          }
        });
      },
      error: (err: any) => {
        this.toast.error('Failed to upload file to ImageKit', { id: 'doc-upload' });
        console.error(err);
        this.uploading = false;
      }
    });
  }

  /** File a document saved as "Other" under its proper type. */
  retype(doc: any, documentType: string) {
    if (!documentType || documentType === doc.documentType) return;
    this.employeeService.updateDocumentType(this.employeeData.id, doc.id, documentType).subscribe({
      next: () => {
        this.toast.success(`Saved as ${documentType}`);
        this.refreshProfile.emit();
      },
      error: (err: any) => this.toast.error(err?.error?.message || 'Could not change the type'),
    });
  }

  deleteDocument(documentId: number) {
    if (!confirm('Are you sure you want to delete this document?')) return;
    
    this.employeeService.deleteDocument(this.employeeData.id, documentId).subscribe({
      next: () => {
        this.toast.success('Document deleted');
        this.refreshProfile.emit();
      },
      error: (err: any) => {
        this.toast.error('Failed to delete document');
        console.error(err);
      }
    });
  }

  viewDocument(fileUrl: string) {
    if (fileUrl.startsWith('data:')) {
      // Workaround for Chrome blocking data URL navigation in top frame
      const win = window.open();
      if (win) {
        win.document.write(`<iframe src="${fileUrl}" frameborder="0" style="border:0; top:0; left:0; bottom:0; right:0; width:100%; height:100%; position:absolute;" allowfullscreen></iframe>`);
        win.document.close();
      }
    } else {
      window.open(fileUrl, '_blank');
    }
  }

  timeAgo(dateString: string) {
    const date = new Date(dateString);
    const now = new Date();
    const diff = Math.floor((now.getTime() - date.getTime()) / 1000); // in seconds

    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)} days ago`;
    return `${Math.floor(diff / 604800)} weeks ago`;
  }
}
