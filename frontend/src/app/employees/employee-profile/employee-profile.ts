import { Component, inject, Input, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { EmployeeService } from '../../services/employee.service';
import { JobsService, Job } from '../../services/jobs.service';
import { AuthService } from '../../services/auth.service';
import { HotToastService } from '@ngneat/hot-toast';
import { ProfileTabComponent } from './profile-tab/profile-tab';
import { EmergencyContactsTabComponent } from './emergency-contacts-tab/emergency-contacts-tab';
import { DocumentsTabComponent } from './documents-tab/documents-tab';

@Component({
  selector: 'app-employee-profile',
  standalone: true,
  imports: [CommonModule, FormsModule, ProfileTabComponent, EmergencyContactsTabComponent, DocumentsTabComponent],
  templateUrl: './employee-profile.html',
  styleUrls: ['./employee-profile.css']
})
export class EmployeeProfileComponent implements OnInit {
  /** Set when shown in the profile popup instead of on its own page. */
  @Input() employeeId: number | string | null = null;
  @Input() embedded = false;
  private route = inject(ActivatedRoute);
  private employeeService = inject(EmployeeService);
  private jobsService = inject(JobsService);
  private authService = inject(AuthService);
  private router = inject(Router);
  private toast = inject(HotToastService);

  activeTab = signal<'work' | 'resume' | 'personal' | 'contacts' | 'documents' | 'history'>('work');
  employeeData = signal<any>(null);
  isLoading = signal(true);
  isOwner = signal(false);
  /** Server-resolved: the owner, HR, admins and designation-level profile editors. */
  canManageDocuments = signal(false);
  conversionOpen = signal(false);
  isStartingConversion = signal(false);
  jobs = signal<Job[]>([]);
  conversionForm = { jobId: null as number | null, offeredSalary: null as number | null, joiningDate: '', remarks: '' };
  employmentHistory = signal<any[]>([]);
  historyLoading = signal(false);

  canConvertTrainee(): boolean {
    const role = this.authService.currentUser()?.role;
    return ['HR', 'ADMIN', 'SUPERADMIN'].includes(role || '') && this.isTraineeProfile();
  }

  /**
   * Older trainee records were sometimes created with the default employment
   * category (PERMANENT) while their assigned designation is "Trainee".
   * Treat either authoritative marker as a trainee so those existing records
   * can enter the conversion flow without altering their history first.
   */
  private isTraineeProfile(): boolean {
    const employee = this.employeeData();
    if (employee?.hasCompletedTraineeConversion) return false;
    const designation = String(employee?.designation?.name || employee?.designationName || '').trim();
    return String(employee?.employmentCategory || '').toUpperCase() === 'TRAINEE'
      || /^trainee$/i.test(designation);
  }

  openConversion() {
    this.conversionForm = { jobId: null, offeredSalary: null, joiningDate: '', remarks: '' };
    this.jobsService.getJobs().subscribe({
      next: jobs => {
        this.jobs.set(jobs.filter(job => String(job.status).toUpperCase() !== 'CLOSED'));
        this.conversionOpen.set(true);
      },
      error: () => this.toast.error('Could not load open job positions'),
    });
  }

  startConversion() {
    const employee = this.employeeData();
    if (!employee || !this.conversionForm.jobId || !this.conversionForm.offeredSalary || this.conversionForm.offeredSalary <= 0) {
      this.toast.error('Select a position and enter a valid offered CTC');
      return;
    }
    this.isStartingConversion.set(true);
    this.employeeService.startTraineeConversion(employee.id, {
      jobId: this.conversionForm.jobId,
      offeredSalary: this.conversionForm.offeredSalary,
      joiningDate: this.conversionForm.joiningDate || undefined,
      remarks: this.conversionForm.remarks,
    }).subscribe({
      next: application => {
        this.toast.success('Trainee moved to Offered. You can now edit and send the offer letter.');
        this.conversionOpen.set(false);
        this.router.navigate(['/recruitment/candidates'], { queryParams: { applicationId: application.id } });
      },
      error: error => {
        this.toast.error(error?.error?.message || 'Could not start trainee conversion');
        this.isStartingConversion.set(false);
      },
      complete: () => this.isStartingConversion.set(false),
    });
  }

  ngOnInit() {
    if (this.employeeId != null) {
      this.loadProfile(String(this.employeeId));
      return;
    }
    this.route.paramMap.subscribe(params => {
      let id = params.get('id');
      if (id) {
         this.loadProfile(id);
      }
    });
  }

  loadProfile(id: string) {
    this.isLoading.set(true);
    this.employeeService.getProfile(id).subscribe({
      next: (data) => {
        this.employeeData.set(data);
        this.isOwner.set(data.isOwner);
        // Fall back to isOwner: an endpoint that forgets the flag must never
        // hide someone's own documents from them.
        this.canManageDocuments.set(!!data.canManageDocuments || !!data.isOwner);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.toast.error('Failed to load profile');
        this.isLoading.set(false);
      }
    });
  }

  setTab(tab: 'work' | 'resume' | 'personal' | 'contacts' | 'documents' | 'history') {
    this.activeTab.set(tab);
    if (tab === 'history' && this.employeeData()?.id) this.loadEmploymentHistory();
  }

  private loadEmploymentHistory() {
    this.historyLoading.set(true);
    this.employeeService.getEmploymentHistory(this.employeeData().id).subscribe({
      next: history => { this.employmentHistory.set(history); this.historyLoading.set(false); },
      error: () => { this.toast.error('Could not load employment history'); this.historyLoading.set(false); },
    });
  }
}
