import { Component, inject, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CompanyService, CompanyProfile } from '../../services/company';
import { HotToastService } from '@ngneat/hot-toast';
import {
  LucideBuilding2,
  LucideUpload,
  LucideSave,
  LucideLoader2,
  LucideFileText,
  LucideLandmark,
  LucideImage,
  LucideGlobe,
  LucidePhone,
  LucideMail,
  LucideMapPin,
  LucideShieldCheck,
  LucideCreditCard,
  LucideCheck,
  LucideCopy,
  LucideTrash2,
  LucideExternalLink,
  LucideInfo,
  LucideSparkles
} from '@lucide/angular';

export type CompanyTab = 'general' | 'statutory' | 'banking' | 'branding';

@Component({
  selector: 'app-company-profile',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideBuilding2,
    LucideUpload,
    LucideSave,
    LucideLoader2,
    LucideFileText,
    LucideLandmark,
    LucideImage,
    LucideGlobe,
    LucidePhone,
    LucideMail,
    LucideMapPin,
    LucideShieldCheck,
    LucideCreditCard,
    LucideCheck,
    LucideCopy,
    LucideTrash2,
    LucideExternalLink,
    LucideInfo,
    LucideSparkles
  ],
  templateUrl: './company-profile.html',
  styleUrls: ['./company-profile.css']
})
export class CompanyProfileComponent implements OnInit {
  private companyService = inject(CompanyService);
  private toast = inject(HotToastService);

  profile = signal<CompanyProfile>({ id: 0, name: '' });
  isLoading = signal(true);
  isSaving = signal(false);
  isUploading = signal(false);
  activeTab = signal<CompanyTab>('general');
  copiedField = signal<string | null>(null);

  quotePreview = computed(() => {
    const prefix = (this.profile().quotationPrefix || 'QT').trim();
    return `${prefix}-2026-0042`;
  });

  maskedAccount = computed(() => {
    const num = this.profile().bankAccountNumber;
    if (!num) return '•••• •••• ••••';
    return num.replace(/(\d{4})(?=\d)/g, '$1 ');
  });

  ngOnInit() {
    this.loadProfile();
  }

  loadProfile() {
    this.companyService.getProfile().subscribe({
      next: (data) => {
        this.profile.set(data);
        this.isLoading.set(false);
      },
      error: () => {
        this.toast.error('Failed to load company profile');
        this.isLoading.set(false);
      }
    });
  }

  save() {
    const currentProfile = this.profile();
    if (!currentProfile.name?.trim()) {
      this.toast.error('Company Name is required');
      return;
    }

    this.isSaving.set(true);
    this.companyService.updateProfile(currentProfile).subscribe({
      next: (updatedData) => {
        this.profile.set(updatedData);
        this.toast.success('Company profile updated successfully!');
        this.isSaving.set(false);
      },
      error: () => {
        this.toast.error('Failed to update company profile');
        this.isSaving.set(false);
      }
    });
  }

  onFileSelected(event: any) {
    const file: File = event.target.files[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        this.toast.error('File must be less than 2MB');
        return;
      }
      
      this.isUploading.set(true);
      this.companyService.uploadLogo(file).subscribe({
        next: (res) => {
          this.profile.update(p => ({ ...p, logoUrl: res.url }));
          this.toast.success('Logo uploaded successfully');
          this.isUploading.set(false);
        },
        error: () => {
          this.toast.error('Failed to upload logo');
          this.isUploading.set(false);
        }
      });
    }
  }

  triggerFileInput() {
    document.getElementById('logoUpload')?.click();
  }

  getWebsiteUrl(domain?: string): string {
    if (!domain) return '';
    return domain.startsWith('http://') || domain.startsWith('https://') ? domain : `https://${domain}`;
  }

  setTab(tab: CompanyTab) {
    this.activeTab.set(tab);
  }

  copyToClipboard(text?: string, fieldName = 'Value') {
    if (!text) return;
    navigator.clipboard.writeText(text);
    this.copiedField.set(fieldName);
    this.toast.success(`${fieldName} copied to clipboard`);
    setTimeout(() => {
      if (this.copiedField() === fieldName) {
        this.copiedField.set(null);
      }
    }, 2000);
  }

  removeLogo() {
    this.profile.update(p => ({ ...p, logoUrl: undefined }));
    this.toast.success('Logo removed. Click "Save Changes" to apply.');
  }

  copyAllBankDetails() {
    const p = this.profile();
    const details = [
      `Beneficiary: ${p.bankAccountName || 'N/A'}`,
      `Bank: ${p.bankName || 'N/A'}`,
      `Account No: ${p.bankAccountNumber || 'N/A'}`,
      `IFSC: ${p.bankIfsc || 'N/A'}`,
      p.bankBranch ? `Branch: ${p.bankBranch}` : ''
    ].filter(Boolean).join('\n');
    this.copyToClipboard(details, 'Complete Bank Details');
  }
}
