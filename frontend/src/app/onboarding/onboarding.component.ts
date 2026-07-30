import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { UploadService } from '../services/upload.service';
import { MasterDataService, Department, Designation } from '../services/master-data.service';
import { HotToastService } from '@ngneat/hot-toast';
import { LucideUploadCloud } from '@lucide/angular';

@Component({
  selector: 'app-onboarding',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, LucideUploadCloud],
  templateUrl: './onboarding.html',
  styleUrls: ['./onboarding.css']
})
export class OnboardingComponent {
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private uploadService = inject(UploadService);
  private masterData = inject(MasterDataService);
  private router = inject(Router);
  private toast = inject(HotToastService);

  departments = signal<Department[]>([]);
  designations = signal<Designation[]>([]);

  step = signal(1);
  isSubmitting = signal(false);
  isUploading = signal(false);

  get filteredDesignations() {
    const selectedDeptId = this.personalForm.get('departmentId')?.value;
    if (!selectedDeptId) return this.designations();
    return this.designations().filter(d => d.departmentId === Number(selectedDeptId));
  }

  // Step 1 Form (Company)
  companyForm: FormGroup = this.fb.group({
    logoUrl: [''],
    industry: ['', Validators.required],
    size: ['', Validators.required],
    timezone: ['', Validators.required]
  });

  // Step 2 Form (Personal)
  personalForm: FormGroup = this.fb.group({
    avatarUrl: [''],
    designationId: [null, Validators.required],
    departmentId: [null, Validators.required]
  });

  // Step 3 Form (Preferences)
  prefsForm: FormGroup = this.fb.group({
    themePref: ['system'],
    currency: ['USD']
  });

  constructor() {
    this.authService.getMe().subscribe({
      next: (user) => {
        if (user.company?.onboardingCompleted) {
          this.router.navigate(['/dashboard']);
        } else {
          // Fetch Master Data for dropdowns
          this.masterData.getDepartments().subscribe(res => this.departments.set(res));
          this.masterData.getDesignations().subscribe(res => this.designations.set(res));
        }
      },
      error: () => {
        this.authService.logout();
        this.toast.info('Session expired. Please log in again.');
        this.router.navigate(['/']);
      }
    });
  }

  nextStep() {
    if (this.step() === 1 && this.companyForm.invalid) {
      this.toast.error('Please fill in all required company details.');
      return;
    }
    if (this.step() === 2 && this.personalForm.invalid) {
      this.toast.error('Please fill in all required personal details.');
      return;
    }
    if (this.step() < 3) {
      this.step.set(this.step() + 1);
    }
  }

  onFileSelected(event: any, controlName: string, formGroup: FormGroup) {
    const file: File = event.target.files[0];
    if (file) {
      this.isUploading.set(true);
      const toastRef = this.toast.loading('Uploading file...');
      
      this.uploadService.uploadFile(file).subscribe({
        next: (res) => {
          this.isUploading.set(false);
          toastRef.close();
          this.toast.success('File uploaded!');
          
          const fileUrl = res.url || (res.data && res.data.url) || res.fileUrl || res.path || '';
          if (fileUrl) {
             formGroup.patchValue({ [controlName]: fileUrl });
          } else {
             this.toast.warning('Upload succeeded but could not extract URL.');
             console.warn('Upload response:', res);
          }
        },
        error: (err) => {
          this.isUploading.set(false);
          toastRef.close();
          this.toast.error('File upload failed.');
        }
      });
    }
  }

  prevStep() {
    if (this.step() > 1) {
      this.step.set(this.step() - 1);
    }
  }

  finishOnboarding() {
    this.isSubmitting.set(true);
    
    const payload = {
      ...this.companyForm.value,
      ...this.personalForm.value,
      ...this.prefsForm.value
    };

    this.authService.completeOnboarding(payload).subscribe({
      next: () => {
        this.isSubmitting.set(false);
        this.toast.success('Workspace setup complete!');
        this.router.navigate(['/dashboard']);
      },
      error: () => {
        this.isSubmitting.set(false);
        this.toast.error('Failed to save settings. Please try again.');
      }
    });
  }

  logout() {
    this.authService.logout();
    this.toast.info('Logged out successfully');
    this.router.navigate(['/']);
  }
}
