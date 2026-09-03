import { Component, signal, inject, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { 
  LucideSearch, LucideMapPin, LucideBriefcase, LucideClock, LucideBuilding, 
  LucideCheckCircle, LucideX, LucideUpload, LucideSparkles, LucideHelpCircle, 
  LucideArrowRight, LucideFilter, LucideLoader, LucideAlertCircle 
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
  minSalary?: number;
  maxSalary?: number;
  workLocationType?: string;
  startDate?: string;
  endDate?: string;
  companyId?: string;
}

@Component({
  selector: 'app-careers',
  standalone: true,
  imports: [
    CommonModule, FormsModule, DatePipe, LucideSearch, LucideMapPin, 
    LucideBriefcase, LucideClock, LucideBuilding, LucideCheckCircle, 
    LucideX, LucideUpload, LucideHelpCircle, LucideArrowRight, LucideFilter, LucideLoader, LucideAlertCircle
  ],
  templateUrl: './careers.html',
  styleUrls: ['./careers.css'],
  providers: [DatePipe]
})
export class CareersComponent implements OnInit {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);

  jobs = signal<PublicJob[]>([]);
  filteredJobs = signal<PublicJob[]>([]);
  departments = signal<string[]>([]);
  
  selectedDepartment = signal<string>('All');
  searchText = '';

  // Drawer / Application State
  selectedJob = signal<PublicJob | null>(null);
  isApplyDrawerOpen = signal(false);
  
  uploadFileName = signal<string>('');
  uploadError = signal<string>('');
  isUploading = signal<boolean>(false);

  photoFileName = signal<string>('');
  photoError = signal<string>('');
  isPhotoUploading = signal<boolean>(false);





  isSubmitting = signal<boolean>(false);
  isSubmittedSuccess = signal<boolean>(false);
  submitError = signal<string | null>(null);
  showValidationErrors = signal<boolean>(false);

  // Candidate Application Form
  candidateForm: any = {
    fullName: '',
    email: '',
    phone: '',
    linkedinUrl: '',
    portfolioUrl: '',
    experienceYears: '3-5 Years',
    noticePeriod: 'Immediate',
    resumeUrl: '',
    skills: [] as string[],
    dateOfBirth: '',
    gender: '',
    currentLocation: '',
    currentCtc: null,
    expectedCtc: null,
    source: '',
    coverLetter: '',
    photoUrl: ''
  };

  newSkillInput = '';
  answersMap: { [key: string]: string } = {};

  previousApplicationFound = signal(false);
  previousApplicationData = signal<any>(null);
  hasLoadedPreviousDetails = signal(false);

  ngOnInit() {
    this.fetchPublicJobs();
  }

  async fetchPublicJobs() {
    try {
      const encryptedCompanyId = this.route.snapshot.paramMap.get('companyId');
      
      const url = encryptedCompanyId 
        ? `${environment.apiUrl}/public/jobs/${encryptedCompanyId}`
        : `${environment.apiUrl}/public/jobs`;
        
      const res: any = await firstValueFrom(
        this.http.get(url)
      );
      this.jobs.set(res || []);
      this.filteredJobs.set(res || []);
      
      const depts = Array.from(new Set((res || []).map((j: any) => j.department)));
      this.departments.set(depts as string[]);
    } catch (err) {
      console.error('Error fetching public jobs:', err);
    }
  }

  checkPreviousApplication() {
    const email = this.candidateForm.email?.trim();
    const job = this.selectedJob();
    if (!email || !job?.companyId || this.hasLoadedPreviousDetails()) return;

    this.http.get<any>(`${environment.apiUrl}/public/applications/lookup`, {
      params: { email, companyId: job.companyId }
    }).subscribe({
      next: (res) => {
        if (res?.found) {
          this.previousApplicationFound.set(true);
          this.previousApplicationData.set(res.data);
        } else {
          this.previousApplicationFound.set(false);
          this.previousApplicationData.set(null);
        }
      },
      error: () => {}
    });
  }

  loadPreviousDetails() {
    const data = this.previousApplicationData();
    if (!data) return;
    this.candidateForm = { ...this.candidateForm, ...data };
    if (data.dateOfBirth) {
      this.candidateForm.dateOfBirth = data.dateOfBirth.split('T')[0];
    }
    this.hasLoadedPreviousDetails.set(true);
    this.previousApplicationFound.set(false);
  }

  dismissPreviousApplicationPrompt() {
    this.previousApplicationFound.set(false);
  }

  addCandidateSkill() {
    const skill = this.newSkillInput.trim();
    if (skill && !this.candidateForm.skills.includes(skill)) {
      this.candidateForm.skills = [...this.candidateForm.skills, skill];
    }
    this.newSkillInput = '';
  }

  removeCandidateSkill(index: number) {
    this.candidateForm.skills = this.candidateForm.skills.filter((_: any, i: number) => i !== index);
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
      resumeUrl: '',
      skills: [] as string[],
      dateOfBirth: '',
      gender: '',
      currentLocation: '',
      currentCtc: null,
      expectedCtc: null,
      source: '',
      coverLetter: '',
      photoUrl: ''
    };
    this.answersMap = {};
    (job.screeningQuestions || []).forEach(q => this.answersMap[q] = '');
    this.isSubmittedSuccess.set(false);
    this.previousApplicationFound.set(false);
    this.previousApplicationData.set(null);
    this.hasLoadedPreviousDetails.set(false);
    this.submitError.set(null);
    this.uploadFileName.set('');
    this.photoFileName.set('');
    this.isApplyDrawerOpen.set(true);
  }

  closeApplyDrawer() {
    this.isApplyDrawerOpen.set(false);
  }

  async onFileSelected(event: any) {
    const file = event.target.files[0];
    if (!file) return;

    this.uploadError.set('');

    const allowedTypes = ['application/pdf'];
    const maxSize = 10 * 1024 * 1024;

    if (!allowedTypes.includes(file.type) && !file.name.toLowerCase().endsWith('.pdf')) {
      this.uploadError.set('Only PDF files are allowed.');
      event.target.value = '';
      return;
    }

    if (file.size > maxSize) {
      this.uploadError.set('File size must be under 10MB.');
      event.target.value = '';
      return;
    }

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
      this.uploadError.set('Failed to upload file. Please try again.');
      this.uploadFileName.set('');
    } finally {
      this.isUploading.set(false);
    }
  }

  async onPhotoSelected(event: any) {
    const file = event.target.files[0];
    if (!file) return;

    this.photoError.set('');
    const maxSize = 5 * 1024 * 1024;

    if (!file.type.startsWith('image/')) {
      this.photoError.set('Only image files are allowed.');
      event.target.value = '';
      return;
    }

    if (file.size > maxSize) {
      this.photoError.set('File size must be under 5MB.');
      event.target.value = '';
      return;
    }

    this.isPhotoUploading.set(true);
    this.photoFileName.set(file.name);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res: any = await firstValueFrom(
        this.http.post(`${environment.apiUrl}/upload/image`, formData)
      );
      this.candidateForm.photoUrl = res.url || res.filename || file.name;
    } catch (err) {
      this.photoError.set('Failed to upload photo. Please try again.');
      this.photoFileName.set('');
    } finally {
      this.isPhotoUploading.set(false);
    }
  }

  isAnswered(question: string): boolean {
    return !!(this.answersMap[question] || '').trim();
  }

  private unansweredQuestions(): string[] {
    return (this.selectedJob()?.screeningQuestions || []).filter(q => !this.isAnswered(q));
  }

  async submitApplication() {
    const missingAnswers = this.unansweredQuestions().length > 0;

    if (!this.candidateForm.fullName || !this.candidateForm.email || !this.candidateForm.phone || !this.candidateForm.resumeUrl || missingAnswers) {
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

    const answersArray = (job.screeningQuestions || []).map(q => ({
      question: q,
      answer: (this.answersMap[q] || '').trim()
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
      this.submitError.set(null);
      this.isSubmittedSuccess.set(true);
    } catch (err: any) {
      console.error('Error submitting application:', err);
      if (err?.status === 409) {
        this.submitError.set('You have already applied for this position with this email.');
      } else {
        this.submitError.set('Something went wrong while submitting your application. Please try again.');
      }
      this.isSubmittedSuccess.set(false);
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
