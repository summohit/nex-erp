import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CompanyService, CompanyProfile } from '../../services/company';
import { HotToastService } from '@ngneat/hot-toast';
import { LucideBuilding2, LucideUpload, LucideSave, LucideLoader2 } from '@lucide/angular';

@Component({
  selector: 'app-company-profile',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideBuilding2, LucideUpload, LucideSave, LucideLoader2],
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
}
