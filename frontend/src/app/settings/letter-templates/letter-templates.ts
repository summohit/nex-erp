import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { HotToastService } from '@ngneat/hot-toast';
import { QuillModule } from 'ngx-quill';
import {
  LucidePlus, LucideX, LucideSearch, LucideTrash2, LucideEye, LucideFileText,
  LucideSend, LucideCode, LucideArrowLeft, LucideChevronRight, LucideChevronDown, LucideEdit3,
  LucidePrinter, LucideCheck, LucideCalendar, LucideUser, LucideSparkles,
  LucideMail, LucidePhone, LucideCopy, LucideCheckCircle2, LucideClock, LucideMoreHorizontal
} from '@lucide/angular';
import { MatMenuModule } from '@angular/material/menu';
import { LettersService, LetterTemplate, MergeTag, GeneratedLetter } from '../../services/letters.service';
import { EmployeeService } from '../../services/employee.service';

type Tab = 'templates' | 'issued';

@Component({
  selector: 'app-letter-templates',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterLink, QuillModule, MatMenuModule, LucidePlus, LucideX, LucideSearch,
    LucideTrash2, LucideEye, LucideFileText, LucideSend, LucideCode,
    LucideArrowLeft, LucideChevronRight, LucideChevronDown, LucideEdit3, LucidePrinter,
    LucideCheck, LucideCalendar, LucideUser, LucideSparkles,
    LucideMail, LucidePhone, LucideCopy, LucideCheckCircle2, LucideClock, LucideMoreHorizontal
  ],
  templateUrl: './letter-templates.html',
  styleUrls: ['./letter-templates.css'],
})
export class LetterTemplatesComponent implements OnInit {
  private lettersService = inject(LettersService);
  private employeeService = inject(EmployeeService);
  private toast = inject(HotToastService);
  private sanitizer = inject(DomSanitizer);

  activeTab = signal<Tab>('templates');
  loading = signal(false);

  templates = signal<LetterTemplate[]>([]);
  letters = signal<GeneratedLetter[]>([]);
  mergeTags = signal<MergeTag[]>([]);
  employees = signal<any[]>([]);
  search = signal('');

  // Editor
  editorOpen = signal(false);
  editorMode = signal<'create' | 'edit'>('create');
  editingId = signal<number | null>(null);
  form: any = { title: '', body: '', description: '', isActive: true };

  // Generate
  generateOpen = signal(false);
  genForm: any = { templateId: null, employeeId: null, signatoryEmployeeId: null, title: '' };
  genPreview = signal<string>('');

  // Searchable Target Employee Dropdown State
  targetEmpDropdownOpen = signal(false);
  targetEmpSearch = signal('');

  // Searchable Signatory Dropdown State
  signatoryDropdownOpen = signal(false);
  signatorySearch = signal('');

  filteredTargetEmployees = computed(() => {
    const q = this.targetEmpSearch().toLowerCase().trim();
    const list = this.employees();
    if (!q) return list;
    return list.filter(e => {
      const fn = (e.firstName || '').toLowerCase();
      const ln = (e.lastName || '').toLowerCase();
      const full = `${fn} ${ln}`.trim();
      const code = (e.employeeCode || '').toLowerCase();
      const dept = (e.department?.name || '').toLowerCase();
      const desig = (e.designation?.name || '').toLowerCase();
      return full.includes(q) || fn.includes(q) || ln.includes(q) || code.includes(q) || dept.includes(q) || desig.includes(q);
    });
  });

  filteredSignatories = computed(() => {
    const q = this.signatorySearch().toLowerCase().trim();
    const list = this.employees();
    if (!q) return list;
    return list.filter(e => {
      const fn = (e.firstName || '').toLowerCase();
      const ln = (e.lastName || '').toLowerCase();
      const full = `${fn} ${ln}`.trim();
      const code = (e.employeeCode || '').toLowerCase();
      const dept = (e.department?.name || '').toLowerCase();
      return full.includes(q) || fn.includes(q) || ln.includes(q) || code.includes(q) || dept.includes(q);
    });
  });

  // Read-only view of an issued letter
  viewOpen = signal(false);
  viewLetter = signal<GeneratedLetter | null>(null);

  // Read-only view of a template, tags left visible as written
  templateViewOpen = signal(false);
  templateView = signal<LetterTemplate | null>(null);

  /** The visual editor is the default; HTML source is there when it's needed. */
  editorView = signal<'rich' | 'html'>('rich');

  // Worksuite's templates were authored in Quill, so its classes round-trip.
  readonly quillModules = {
    toolbar: [
      [{ header: [1, 2, 3, false] }],
      ['bold', 'italic', 'underline', 'strike'],
      [{ color: [] }, { background: [] }],
      [{ list: 'ordered' }, { list: 'bullet' }],
      [{ align: [] }],
      [{ indent: '-1' }, { indent: '+1' }],
      ['blockquote', 'link'],
      ['clean'],
    ],
  };

  tagGroups = computed(() => {
    const groups = new Map<string, MergeTag[]>();
    for (const t of this.mergeTags()) {
      (groups.get(t.group) || groups.set(t.group, []).get(t.group)!).push(t);
    }
    return [...groups.entries()].map(([name, tags]) => ({ name, tags }));
  });

  templateStatusFilter = signal<'all' | 'active' | 'inactive'>('all');

  filteredTemplates = computed(() => {
    const q = this.search().toLowerCase().trim();
    const status = this.templateStatusFilter();
    let list = this.templates();

    if (status === 'active') {
      list = list.filter(t => t.isActive);
    } else if (status === 'inactive') {
      list = list.filter(t => !t.isActive);
    }

    if (!q) return list;
    return list.filter(t =>
      t.title.toLowerCase().includes(q) ||
      (t.description || '').toLowerCase().includes(q)
    );
  });

  issuedStatusFilter = signal<'all' | 'signed' | 'awaiting' | 'regular'>('all');

  issuedStats = computed(() => {
    const list = this.letters();
    const signed = list.filter(l => l.isSigned).length;
    const awaiting = list.filter(l => l.source === 'OFFER' && !l.isSigned).length;
    const regular = list.filter(l => l.source !== 'OFFER').length;
    return { total: list.length, signed, awaiting, regular };
  });

  filteredLetters = computed(() => {
    const q = this.search().toLowerCase().trim();
    const status = this.issuedStatusFilter();
    let list = this.letters();

    if (status === 'signed') {
      list = list.filter(l => l.isSigned);
    } else if (status === 'awaiting') {
      list = list.filter(l => l.source === 'OFFER' && !l.isSigned);
    } else if (status === 'regular') {
      list = list.filter(l => l.source !== 'OFFER');
    }

    if (!q) return list;
    return list.filter(l => {
      const titleMatch = l.title.toLowerCase().includes(q);
      const tmplMatch = (l.template?.title || '').toLowerCase().includes(q);
      const nameMatch = `${l.employee.firstName || ''} ${l.employee.lastName || ''}`.toLowerCase().includes(q);
      const codeMatch = (l.employee.employeeCode || '').toLowerCase().includes(q);
      const emailMatch = (this.getEmail(l) || '').toLowerCase().includes(q);
      const phoneMatch = (this.getPhone(l) || '').toLowerCase().includes(q);
      const roleMatch = (this.getRoleOrDesignation(l) || '').toLowerCase().includes(q);
      const deptMatch = (l.employee.department || '').toLowerCase().includes(q);
      return titleMatch || tmplMatch || nameMatch || codeMatch || emailMatch || phoneMatch || roleMatch || deptMatch;
    });
  });

  clearSearch() {
    this.search.set('');
  }

  getInitials(firstName?: string, lastName?: string): string {
    const f = (firstName || '').trim();
    const l = (lastName || '').trim();
    if (f && l) return `${f[0]}${l[0]}`.toUpperCase();
    if (f) return f.slice(0, 2).toUpperCase();
    return 'EM';
  }

  getAvatarBg(name?: string): string {
    if (!name) return '#6366F1';
    const colors = ['#2A97D8', '#6366F1', '#EC4899', '#8B5CF6', '#10B981', '#F59E0B', '#06B6D4', '#3B82F6'];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  }

  getSelectedEmployee(): any {
    if (!this.genForm.employeeId) return null;
    return this.employees().find(e => e.id === this.genForm.employeeId) || null;
  }

  toggleTargetEmpDropdown() {
    this.targetEmpDropdownOpen.set(!this.targetEmpDropdownOpen());
    if (this.targetEmpDropdownOpen()) {
      this.targetEmpSearch.set('');
      this.signatoryDropdownOpen.set(false);
    }
  }

  selectTargetEmployee(employeeId: number) {
    this.genForm.employeeId = employeeId;
    this.targetEmpDropdownOpen.set(false);
    this.refreshPreview();
  }

  clearTargetEmployee(event: MouseEvent) {
    event.stopPropagation();
    this.genForm.employeeId = null;
    this.targetEmpDropdownOpen.set(false);
    this.refreshPreview();
  }

  toggleSignatoryDropdown() {
    this.signatoryDropdownOpen.set(!this.signatoryDropdownOpen());
    if (this.signatoryDropdownOpen()) {
      this.signatorySearch.set('');
      this.targetEmpDropdownOpen.set(false);
    }
  }

  selectSignatory(employeeId: number | null) {
    this.genForm.signatoryEmployeeId = employeeId;
    this.signatoryDropdownOpen.set(false);
    this.refreshPreview();
  }

  clearSignatory(event: MouseEvent) {
    event.stopPropagation();
    this.genForm.signatoryEmployeeId = null;
    this.signatoryDropdownOpen.set(false);
    this.refreshPreview();
  }

  getSelectedSignatory(): any {
    if (!this.genForm.signatoryEmployeeId) return null;
    return this.employees().find(e => e.id === this.genForm.signatoryEmployeeId) || null;
  }

  ngOnInit() {
    this.loadTemplates();
    this.lettersService.getLetters().subscribe({
      next: l => this.letters.set(l),
      error: () => {}
    });
    this.lettersService.getMergeTags().subscribe({ next: t => this.mergeTags.set(t) });
    this.employeeService.getEmployees().subscribe({
      next: (e: any) => this.employees.set(e || []),
      error: () => this.employees.set([]),
    });
  }

  setTab(tab: Tab) {
    this.activeTab.set(tab);
    if (tab === 'issued' && !this.letters().length) this.loadLetters();
  }

  loadTemplates() {
    this.loading.set(true);
    this.lettersService.getTemplates().subscribe({
      next: t => { this.templates.set(t); this.loading.set(false); },
      error: () => { this.toast.error('Failed to load templates'); this.loading.set(false); },
    });
  }

  loadLetters() {
    this.loading.set(true);
    this.lettersService.getLetters().subscribe({
      next: l => { this.letters.set(l); this.loading.set(false); },
      error: () => { this.toast.error('Failed to load letters'); this.loading.set(false); },
    });
  }

  /** The tag palette differs per scope: candidate templates get offer fields. */
  loadTagsForScope(scope: string) {
    this.lettersService.getMergeTags(scope).subscribe({
      next: t => this.mergeTags.set(t),
    });
  }

  onScopeChange(scope: string) {
    this.form.scope = scope;
    if (scope !== 'CANDIDATE') this.form.useForOfferLetter = false;
    this.loadTagsForScope(scope);
  }

  /** Only employee-scope templates can be issued to an employee by hand. */
  employeeTemplates = computed(() =>
    this.templates().filter(t => (t.scope || 'EMPLOYEE') !== 'CANDIDATE'));

  employeeName(e: any): string {
    return `${e.firstName || ''} ${e.lastName || ''}`.trim();
  }

  // ── template editor ─────────────────────────────────────────────────────
  openCreate() {
    this.editorMode.set('create');
    this.editingId.set(null);
    this.form = { title: '', body: '', description: '', isActive: true, autoOnOnboarding: false, scope: 'EMPLOYEE', useForOfferLetter: false };
    this.loadTagsForScope('EMPLOYEE');
    this.editorView.set('rich');
    this.editorOpen.set(true);
  }

  openEdit(t: LetterTemplate) {
    this.editorMode.set('edit');
    this.editingId.set(t.id);
    // The list response omits the body, so fetch the full record.
    this.lettersService.getTemplate(t.id).subscribe({
      next: full => {
        this.form = {
          title: full.title, body: full.body,
          description: full.description || '', isActive: full.isActive,
          autoOnOnboarding: !!full.autoOnOnboarding,
          scope: full.scope || 'EMPLOYEE',
          useForOfferLetter: !!full.useForOfferLetter,
        };
        this.loadTagsForScope(full.scope || 'EMPLOYEE');
        this.editorView.set('rich');
        this.editorOpen.set(true);
      },
      error: () => this.toast.error('Failed to load template'),
    });
  }

  closeEditor() {
    this.editorOpen.set(false);
    this.editingId.set(null);
  }

  private quillRef: any = null;

  onEditorCreated(q: any) {
    this.quillRef = q;
  }

  insertTag(tag: string) {
    if (this.editorView() === 'rich' && this.quillRef) {
      const range = this.quillRef.getSelection(true);
      const at = range ? range.index : this.quillRef.getLength();
      this.quillRef.insertText(at, tag, 'user');
      this.quillRef.setSelection(at + tag.length, 0);
      return;
    }
    const el = document.getElementById('letter-body') as HTMLTextAreaElement | null;
    if (!el) { this.form.body = (this.form.body || '') + tag; return; }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    this.form.body = el.value.slice(0, start) + tag + el.value.slice(end);
    setTimeout(() => { el.focus(); el.setSelectionRange(start + tag.length, start + tag.length); });
  }

  openTemplateView(t: LetterTemplate) {
    this.lettersService.getTemplate(t.id).subscribe({
      next: full => { this.templateView.set(full); this.templateViewOpen.set(true); },
      error: () => this.toast.error('Failed to load template'),
    });
  }

  closeTemplateView() {
    this.templateViewOpen.set(false);
    this.templateView.set(null);
  }

  editFromView() {
    const t = this.templateView();
    this.closeTemplateView();
    if (t) this.openEdit(t);
  }

  generateFromView() {
    const t = this.templateView();
    this.closeTemplateView();
    if (t) this.openGenerate(t);
  }

  /**
   * Letter bodies carry inline styles and alignment classes that Angular's HTML
   * sanitizer strips, which would flatten every preview. The content is authored
   * by admins behind the same permission that gates this whole page, so it is
   * rendered as trusted — treat that as the boundary if the permission widens.
   */
  trustHtml(html: string | undefined | null): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(html || '');
  }

  /** Wrap merge tags so they stand out in the read-only template preview. */
  highlightTags(body: string | undefined | null): SafeHtml {
    return this.trustHtml((body || '').replace(/##[A-Z_]+##/g,
      m => `<span class="tag-mark">${m}</span>`));
  }

  saveTemplate() {
    if (!this.form.title?.trim()) { this.toast.error('Title is required'); return; }
    const id = this.editingId();
    const req = id
      ? this.lettersService.updateTemplate(id, this.form)
      : this.lettersService.createTemplate(this.form);
    req.subscribe({
      next: () => {
        this.toast.success(id ? 'Template updated' : 'Template created');
        this.closeEditor();
        this.loadTemplates();
      },
      error: (e) => this.toast.error(e.error?.message || 'Failed to save template'),
    });
  }

  deleteTemplate(t: LetterTemplate) {
    const used = t._count?.letters || 0;
    const warn = used
      ? `\n\n${used} issued letter(s) used this template. They keep their saved copy and are not deleted.`
      : '';
    if (!confirm(`Delete "${t.title}"?${warn}`)) return;
    this.lettersService.deleteTemplate(t.id).subscribe({
      next: () => { this.toast.success('Template deleted'); this.loadTemplates(); },
      error: (e) => this.toast.error(e.error?.message || 'Failed to delete'),
    });
  }

  // ── generate ────────────────────────────────────────────────────────────
  openGenerate(t?: LetterTemplate) {
    this.genForm = {
      templateId: t?.id ?? this.employeeTemplates()[0]?.id ?? null,
      employeeId: null, signatoryEmployeeId: null, title: '',
    };
    this.targetEmpDropdownOpen.set(false);
    this.targetEmpSearch.set('');
    this.signatoryDropdownOpen.set(false);
    this.signatorySearch.set('');
    this.genPreview.set('');
    this.generateOpen.set(true);
  }

  closeGenerate() {
    this.generateOpen.set(false);
    this.targetEmpDropdownOpen.set(false);
    this.signatoryDropdownOpen.set(false);
    this.genPreview.set('');
  }

  refreshPreview() {
    const { templateId, employeeId, signatoryEmployeeId } = this.genForm;
    if (!templateId || !employeeId) { this.genPreview.set(''); return; }
    this.lettersService.preview({
      templateId: +templateId, employeeId: +employeeId,
      signatoryEmployeeId: signatoryEmployeeId ? +signatoryEmployeeId : undefined,
    }).subscribe({
      next: r => this.genPreview.set(r.body),
      error: (e) => this.toast.error(e.error?.message || 'Preview failed'),
    });
  }

  submitGenerate() {
    const { templateId, employeeId, signatoryEmployeeId, title } = this.genForm;
    if (!templateId || !employeeId) { this.toast.error('Pick a template and an employee'); return; }
    this.lettersService.generate({
      templateId: +templateId, employeeId: +employeeId,
      signatoryEmployeeId: signatoryEmployeeId ? +signatoryEmployeeId : undefined,
      title: title?.trim() || undefined,
    }).subscribe({
      next: () => {
        this.toast.success('Letter generated');
        this.closeGenerate();
        this.setTab('issued');
        this.loadLetters();
      },
      error: (e) => this.toast.error(e.error?.message || 'Failed to generate letter'),
    });
  }

  // ── issued letters ──────────────────────────────────────────────────────
  openLetter(l: GeneratedLetter) {
    this.lettersService.getLetter(l.id, l.source).subscribe({
      next: full => { this.viewLetter.set(full); this.viewOpen.set(true); },
      error: () => this.toast.error('Failed to load letter'),
    });
  }

  closeLetter() { this.viewOpen.set(false); this.viewLetter.set(null); }

  printLetter() {
    const l = this.viewLetter();
    if (!l) return;
    // An offer letter exists only as a PDF, so open that rather than an empty page.
    if (l.source === 'OFFER') {
      if (l.pdfUrl) window.open(l.pdfUrl, '_blank');
      else this.toast.error('No PDF is attached to this offer letter');
      return;
    }
    const w = window.open('', '_blank');
    if (!w) { this.toast.error('Allow pop-ups to print'); return; }
    w.document.write(`<!doctype html><title>${l.title}</title>` +
      `<style>body{font-family:Georgia,serif;line-height:1.6;padding:20mm;max-width:210mm;margin:auto}</style>` +
      (l.body || ''));
    w.document.close();
    w.focus();
    w.print();
  }

  deleteLetter(l: GeneratedLetter) {
    if (l.source === 'OFFER') {
      this.toast.error('Offer letters are managed from the candidate record.');
      return;
    }
    if (!confirm(`Delete the "${l.title}" issued to ${l.employee.firstName} ${l.employee.lastName}?`)) return;
    this.lettersService.deleteLetter(l.id, l.source).subscribe({
      next: () => { this.toast.success('Letter deleted'); this.loadLetters(); },
      error: () => this.toast.error('Failed to delete letter'),
    });
  }

  getEmail(letter: GeneratedLetter | null | undefined): string | null {
    if (!letter) return null;
    return letter.employee?.email || letter.candidateEmail || null;
  }

  getPhone(letter: GeneratedLetter | null | undefined): string | null {
    if (!letter) return null;
    return letter.employee?.phone || letter.candidatePhone || null;
  }

  getRoleOrDesignation(letter: GeneratedLetter | null | undefined): string | null {
    if (!letter) return null;
    return letter.employee?.designation || letter.jobTitle || letter.employee?.department || null;
  }

  copiedText = signal<string | null>(null);

  copyText(text: string | null | undefined, label: string, event?: MouseEvent) {
    if (event) event.stopPropagation();
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      this.toast.success(`${label} copied to clipboard`);
      this.copiedText.set(text);
      setTimeout(() => {
        if (this.copiedText() === text) this.copiedText.set(null);
      }, 2000);
    }).catch(() => {
      this.toast.error(`Failed to copy ${label.toLowerCase()}`);
    });
  }

  printDirectLetter(l: GeneratedLetter, event?: MouseEvent) {
    if (event) event.stopPropagation();
    if (l.source === 'OFFER') {
      if (l.pdfUrl) {
        window.open(l.pdfUrl, '_blank');
      } else {
        this.lettersService.getLetter(l.id, l.source).subscribe({
          next: full => {
            if (full.pdfUrl) window.open(full.pdfUrl, '_blank');
            else this.toast.error('No PDF attached to this offer letter');
          },
          error: () => this.toast.error('Failed to load letter PDF')
        });
      }
      return;
    }
    this.lettersService.getLetter(l.id, l.source).subscribe({
      next: full => {
        const w = window.open('', '_blank');
        if (!w) { this.toast.error('Allow pop-ups to print'); return; }
        w.document.write(`<!doctype html><title>${full.title}</title>` +
          `<style>body{font-family:Georgia,serif;line-height:1.6;padding:20mm;max-width:210mm;margin:auto}</style>` +
          (full.body || ''));
        w.document.close();
        w.focus();
        w.print();
      },
      error: () => this.toast.error('Failed to print letter')
    });
  }

  countTags(body: string): number {
    return (body?.match(/##[A-Z_]+##/g) || []).length;
  }
}
