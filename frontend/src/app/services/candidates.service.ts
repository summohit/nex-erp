import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface JobApplication {
  id: number;
  jobId: number;
  companyId: number;
  fullName: string;
  email: string;
  phone: string;
  resumeUrl?: string;
  linkedinUrl?: string;
  portfolioUrl?: string;
  experienceYears?: string;
  noticePeriod?: string;
  status: string; // NEW, REVIEWING, SHORTLISTED, INTERVIEWING, OFFERED, HIRED, REJECTED
  rejectionReason?: string;
  answers?: string;
  offeredSalary?: number;
  approvalStatus?: string;
  aiScore?: number;
  aiSummary?: string;
  isAiScored?: boolean;
  dateOfBirth?: string;
  gender?: string;
  currentLocation?: string;
  currentCtc?: number;
  expectedCtc?: number;
  source?: string;
  coverLetter?: string;
  photoUrl?: string;
  // Captured when an offer is made; both print on the generated offer letter.
  address?: string;
  joiningDate?: string;
  createdAt: string;
  updatedAt: string;
  job?: {
    title: string;
    descriptionHtml?: string;
    department?: { name: string };
    designation?: { name: string };
    branch?: { name: string; address?: string };
    minSalary?: number;
    maxSalary?: number;
  };
}

@Injectable({
  providedIn: 'root'
})
export class CandidatesService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/recruitment/applications`;

  getApplications(jobId?: number): Observable<JobApplication[]> {
    const url = jobId ? `${this.apiUrl}?jobId=${jobId}` : this.apiUrl;
    return this.http.get<JobApplication[]>(url);
  }

  getApplication(id: number): Observable<JobApplication> {
    return this.http.get<JobApplication>(`${this.apiUrl}/${id}`);
  }

  updateStatus(
    id: number,
    status: string,
    offeredSalary?: number,
    rejectionReason?: string,
    joiningDate?: string,
    address?: string,
  ): Observable<JobApplication> {
    return this.http.put<JobApplication>(`${this.apiUrl}/${id}/status`, {
      status, offeredSalary, rejectionReason, joiningDate, address,
    });
  }

  approveSalary(id: number): Observable<any> {
    return this.http.post(`${this.apiUrl}/${id}/approve-salary`, {});
  }

  rejectSalary(id: number): Observable<any> {
    return this.http.post(`${this.apiUrl}/${id}/reject-salary`, {});
  }

  onboardCandidate(id: number): Observable<any> {
    return this.http.post(`${this.apiUrl}/${id}/onboard`, {});
  }

  deleteApplication(id: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/${id}`);
  }

  // --- Interviews ---
  
  getInterviews(applicationId: number): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/${applicationId}/interviews`);
  }

  getAnnexure(applicationId: number): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/${applicationId}/annexure`);
  }

  getOfferLetter(applicationId: number): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/${applicationId}/offer-letter`);
  }

  generateOfferLetter(applicationId: number): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/${applicationId}/offer-letter`, {});
  }

  scheduleInterview(applicationId: number, data: any): Observable<any> {
    return this.http.post(`${this.apiUrl}/${applicationId}/interviews`, data);
  }

  updateInterview(interviewId: number, data: any): Observable<any> {
    return this.http.put(`${this.apiUrl}/interviews/${interviewId}`, data);
  }

  deleteInterview(interviewId: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/interviews/${interviewId}`);
  }

  // --- Analytics ---

  getAnalytics(): Observable<any> {
    return this.http.get(`${this.apiUrl}/analytics/dashboard`);
  }

  getHiringReports(): Observable<any> {
    return this.http.get(`${this.apiUrl}/analytics/hiring-reports`);
  }
}
