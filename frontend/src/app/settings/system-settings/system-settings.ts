import { Component, inject, OnInit, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { HotToastService } from '@ngneat/hot-toast';
import { 
  LucideShieldAlert, 
  LucideSave, 
  LucideLoader2, 
  LucideCheck, 
  LucideCheckCircle2,
  LucideUploadCloud, 
  LucideFileText, 
  LucideCopy, 
  LucideDownload, 
  LucideTrash2, 
  LucideRotateCcw, 
  LucideCalendarClock, 
  LucideSparkles, 
  LucideInfo, 
  LucideExternalLink 
} from '@lucide/angular';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import {
  SystemSettingsService,
  SystemSetting,
  PlaceholderGroup
} from '../../services/system-settings.service';
import { AuthService } from '../../services/auth.service';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-system-settings',
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule, 
    LucideShieldAlert, 
    LucideSave, 
    LucideLoader2, 
    LucideCheck, 
    LucideCheckCircle2,
    LucideUploadCloud, 
    LucideFileText, 
    LucideCopy, 
    LucideDownload, 
    LucideTrash2, 
    LucideRotateCcw, 
    LucideCalendarClock, 
    LucideSparkles, 
    LucideInfo, 
    LucideExternalLink
  ],
  templateUrl: './system-settings.html',
  styleUrls: ['./system-settings.css']
})
export class SystemSettingsComponent implements OnInit, OnDestroy {
  private systemSettingsService = inject(SystemSettingsService);
  private http = inject(HttpClient);
  private toast = inject(HotToastService);
  private router = inject(Router);
  private auth = inject(AuthService);

  private sanitizer = inject(DomSanitizer);

  settings = signal<SystemSetting | null>(null);
  isLoading = signal(true);
  isSaving = signal(false);
  isUploading = signal(false);
  isDragging = signal(false);
  copiedTag = signal<string | null>(null);

  // Built-in HTML template + merge-tag reference, fetched from the backend so the
  // UI can never drift out of sync with what the renderer actually supports.
  placeholderGroups = signal<PlaceholderGroup[]>([]);
  defaultTemplateHtml = signal<string>('');

  showTemplateEditor = signal(false);
  showPreview = signal(false);
  isPreviewLoading = signal(false);
  previewUrl = signal<SafeResourceUrl | null>(null);
  private previewObjectUrl: string | null = null;

  /** Editing the built-in template means seeding the textarea with its source. */
  get templateSource(): string {
    return this.settings()?.offerLetterTemplateHtml || this.defaultTemplateHtml();
  }

  set templateSource(value: string) {
    const current = this.settings();
    if (current) this.settings.set({ ...current, offerLetterTemplateHtml: value });
  }

  get isUsingCustomHtml(): boolean {
    return !!this.settings()?.offerLetterTemplateHtml;
  }

  ngOnInit() {
    if (this.auth.currentUser()?.role !== 'SUPERADMIN') {
      this.toast.error('Only a SuperAdmin can access System Settings.');
      this.router.navigate(['/dashboard']);
      return;
    }
    this.load();
  }

  load() {
    this.isLoading.set(true);
    this.systemSettingsService.getSettings().subscribe({
      next: (data) => {
        this.settings.set(data);
        this.isLoading.set(false);
      },
      error: () => {
        this.toast.error('Failed to load system settings');
        this.isLoading.set(false);
      }
    });

    this.systemSettingsService.getOfferLetterTemplate().subscribe({
      next: (info) => {
        this.defaultTemplateHtml.set(info.defaultHtml);
        this.placeholderGroups.set(info.placeholders);
      },
      error: () => this.toast.error('Failed to load offer letter template reference')
    });
  }

  toggleTemplateEditor() {
    this.showTemplateEditor.update(v => !v);
  }

  openPreview() {
    this.isPreviewLoading.set(true);
    this.showPreview.set(true);
    this.systemSettingsService.previewOfferLetter().subscribe({
      next: (res) => {
        this.setPreviewHtml(res.html);
        this.isPreviewLoading.set(false);
      },
      error: (err) => {
        this.isPreviewLoading.set(false);
        this.showPreview.set(false);
        this.toast.error(err?.error?.message || 'Failed to render preview');
      }
    });
  }

  // A blob URL keeps the preview in its own document so the letter's inline styles
  // can't leak into (or inherit from) the settings page.
  private setPreviewHtml(html: string) {
    this.revokePreviewUrl();
    const blob = new Blob([html], { type: 'text/html' });
    this.previewObjectUrl = URL.createObjectURL(blob);
    this.previewUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(this.previewObjectUrl));
  }

  private revokePreviewUrl() {
    if (this.previewObjectUrl) {
      URL.revokeObjectURL(this.previewObjectUrl);
      this.previewObjectUrl = null;
    }
  }

  closePreview() {
    this.showPreview.set(false);
    this.previewUrl.set(null);
    this.revokePreviewUrl();
  }

  ngOnDestroy() {
    this.revokePreviewUrl();
  }

  resetHtmlTemplate() {
    const current = this.settings();
    if (!current) return;
    if (confirm('Discard your custom HTML and go back to the built-in template?')) {
      this.settings.set({ ...current, offerLetterTemplateHtml: null });
      this.save();
    }
  }

  toggleShiftRosterVisible() {
    const current = this.settings();
    if (!current) return;
    this.settings.set({ 
      ...current, 
      shiftRosterVisibleToEmployees: !current.shiftRosterVisibleToEmployees 
    });
  }

  save() {
    const current = this.settings();
    if (!current) return;
    this.isSaving.set(true);
    this.systemSettingsService.updateSettings({
      shiftRosterVisibleToEmployees: current.shiftRosterVisibleToEmployees,
      offerLetterTemplateHtml: current.offerLetterTemplateHtml,
      offerLetterTemplateDocxUrl: current.offerLetterTemplateDocxUrl,
      offerLetterConfig: current.offerLetterConfig
    }).subscribe({
      next: (data) => {
        this.settings.set(data);
        this.isSaving.set(false);
        this.toast.success('System settings saved successfully');
      },
      error: (err) => {
        this.isSaving.set(false);
        this.toast.error(err?.error?.message || 'Failed to save system settings');
      }
    });
  }

  copyToClipboard(tag: string) {
    navigator.clipboard.writeText(tag).then(() => {
      this.copiedTag.set(tag);
      this.toast.success(`Copied ${tag} to clipboard`);
      setTimeout(() => {
        if (this.copiedTag() === tag) {
          this.copiedTag.set(null);
        }
      }, 2000);
    });
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(true);
  }

  onDragLeave(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);

    if (event.dataTransfer && event.dataTransfer.files.length > 0) {
      const file = event.dataTransfer.files[0];
      this.handleDocxUpload(file);
    }
  }

  onFileSelected(event: any) {
    const file = event.target.files[0];
    if (file) {
      this.handleDocxUpload(file);
    }
    // Reset file input so selecting the same file again triggers change
    event.target.value = '';
  }

  private handleDocxUpload(file: File) {
    if (!file.name.toLowerCase().endsWith('.docx')) {
      this.toast.error('Invalid file format. Please upload a Microsoft Word document (.docx).');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      this.toast.error('File size exceeds 10MB limit.');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);

    this.isUploading.set(true);
    this.http.post<any>(`${environment.apiUrl}/upload`, formData).subscribe({
      next: (res) => {
        this.isUploading.set(false);
        if (res?.url) {
          const current = this.settings();
          if (current) {
            this.settings.set({ ...current, offerLetterTemplateDocxUrl: res.url });
            this.save();
          }
        }
      },
      error: (err) => {
        this.isUploading.set(false);
        this.toast.error(err?.error?.message || 'Failed to upload template file. Please try again.');
      }
    });
  }

  removeTemplate() {
    const current = this.settings();
    if (!current) return;
    
    if (confirm('Are you sure you want to remove the custom Word template? The system will revert to the standard default offer letter template.')) {
      this.settings.set({ ...current, offerLetterTemplateDocxUrl: null });
      this.save();
    }
  }
}
