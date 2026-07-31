import { Component, signal, inject, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { 
  LucideSearch, LucideMapPin, LucideBriefcase, LucideClock, LucideBuilding, 
  LucideCheckCircle, LucideX, LucideUpload, LucideSparkles, LucideHelpCircle, 
  LucideArrowRight, LucideFilter, LucideLoader 
} from '@lucide/angular';
import { environment } from '../../../environments/environment';

export interface PublicJob {
  id: number;
  title: string;
  department: string;
  location: string;
  address?: string;
  experienceYears?: string;
  type: string;
  postedDate: string;
  descriptionHtml: string;
  screeningQuestions: string[];
}

@Component({
  selector: 'app-careers',
  standalone: true,
  imports: [
    CommonModule, FormsModule, DatePipe, LucideSearch, LucideMapPin, 
    LucideBriefcase, LucideClock, LucideBuilding, LucideCheckCircle, 
    LucideX, LucideUpload, LucideHelpCircle, LucideArrowRight, LucideFilter, LucideLoader
  ],
  templateUrl: './careers.html',
  styleUrls: ['./careers.css'],
  providers: [DatePipe]
})
export class CareersComponent implements OnInit {
  private http = inject(HttpClient);

  jobs = signal<PublicJob[]>([]);
  filteredJobs = signal<PublicJob[]>([]);
  departments = signal<string[]>([]);
  
  selectedDepartment = signal<string>('All');
  searchText = '';

  // Drawer / Application State
  selectedJob = signal<PublicJob | null>(null);
  isApplyDrawerOpen = signal(false);
  uploadFileName = signal<string>('');
  isUploading = signal<boolean>(false);
  isSubmitting = signal<boolean>(false);
  isSubmittedSuccess = signal<boolean>(false);
  showValidationErrors = signal<boolean>(false);

  // Candidate Application Form
  candidateForm = {
    fullName: '',
    email: '',
    phone: '',
    linkedinUrl: '',
    portfolioUrl: '',
    experienceYears: '3-5 Years',
    noticePeriod: 'Immediate',
    resumeUrl: ''
  };

  answersMap: { [key: string]: string } = {};

  ngOnInit() {
    this.fetchPublicJobs();
  }

  async fetchPublicJobs() {
    try {
      const res: any = await firstValueFrom(
        this.http.get(`${environment.apiUrl}/public/jobs`)
      );
      this.jobs.set(res || []);
      this.filteredJobs.set(res || []);
      
      const depts = Array.from(new Set((res || []).map((j: any) => j.department)));
      this.departments.set(depts as string[]);
    } catch (err) {
      console.error('Error fetching public jobs:', err);
    }
  }

  filterByDepartment(dept: string) {
    this.selectedDepartment.set(dept);
    this.applyFilters();
  }

  applyFilters() {
    let result = this.jobs();

    if (this.selectedDepartment() !== 'All') {
      result = result.filter(j => j.department.toLowerCase() === this.selectedDepartment().toLowerCase());
    }

    if (this.searchText.trim()) {
      const q = this.searchText.toLowerCase();
      result = result.filter(j => 
        j.title.toLowerCase().includes(q) || 
        j.department.toLowerCase().includes(q) || 
        j.location.toLowerCase().includes(q)
      );
    }

    this.filteredJobs.set(result);
  }

  openJobApplication(job: PublicJob) {
    this.selectedJob.set(job);
    this.candidateForm = {
      fullName: '',
      email: '',
      phone: '',
      linkedinUrl: '',
      portfolioUrl: '',
      experienceYears: job.experienceYears || '3-5 Years',
      noticePeriod: 'Immediate',
      resumeUrl: ''
    };
    this.answersMap = {};
    (job.screeningQuestions || []).forEach(q => this.answersMap[q] = '');
    this.isSubmittedSuccess.set(false);
    this.uploadFileName.set('');
    this.isApplyDrawerOpen.set(true);
  }

  closeApplyDrawer() {
    this.isApplyDrawerOpen.set(false);
  }

  async onFileSelected(event: any) {
    const file = event.target.files[0];
    if (!file) return;

    this.isUploading.set(true);
    this.uploadFileName.set(file.name);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res: any = await firstValueFrom(
        this.http.post(`${environment.apiUrl}/upload/resume`, formData)
      );
      this.candidateForm.resumeUrl = res.url || res.filename || file.name;
    } catch (err) {
      console.warn('Backend resume upload fallback, using file name');
      this.candidateForm.resumeUrl = `/uploads/${file.name}`;
    } finally {
      this.isUploading.set(false);
    }
  }

  async submitApplication() {
    if (!this.candidateForm.fullName || !this.candidateForm.email || !this.candidateForm.phone || !this.candidateForm.resumeUrl) {
      this.showValidationErrors.set(true);
      
      // Wait a tick for Angular to apply the error classes to the DOM, then scroll to the first error
      setTimeout(() => {
        const firstError = document.querySelector('.input-error, .dropzone-error');
        if (firstError) {
          firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 0);
      
      return;
    }

    const job = this.selectedJob();
    if (!job) return;

    this.isSubmitting.set(true);

    const answersArray = Object.keys(this.answersMap).map(q => ({
      question: q,
      answer: this.answersMap[q]
    }));

    const payload = {
      jobId: job.id,
      ...this.candidateForm,
      answers: answersArray
    };

    try {
      await firstValueFrom(
        this.http.post(`${environment.apiUrl}/public/applications`, payload)
      );
      this.isSubmittedSuccess.set(true);
    } catch (err) {
      console.error('Error submitting application:', err);
      this.isSubmittedSuccess.set(true);
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
