import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { Observable } from 'rxjs';

export interface Job {
  id: number;
  title: string;
  departmentId?: number | string;
  department?: any;
  designationId?: number | string;
  designation?: any;
  branchId?: number | string;
  branch?: any;
  experienceYears?: string;
  type: string;
  status: string; // Open, Draft, Closed
  descriptionHtml?: string;
  screeningQuestions?: string;
  minSalary?: number;
  maxSalary?: number;
  companyId: number;
  postedDate?: Date;
  createdAt?: Date;
  updatedAt?: Date;
  _count?: { applications: number };
  // frontend mapping fields
  location?: string;
  address?: string;
  applicants?: number;
}

@Injectable({
  providedIn: 'root'
})
export class JobsService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/recruitment/jobs`;

  getJobs(): Observable<Job[]> {
    return this.http.get<Job[]>(this.apiUrl);
  }

  getJob(id: number): Observable<Job> {
    return this.http.get<Job>(`${this.apiUrl}/${id}`);
  }

  createJob(jobData: any): Observable<Job> {
    return this.http.post<Job>(this.apiUrl, jobData);
  }

  updateJob(id: number, jobData: any): Observable<Job> {
    return this.http.put<Job>(`${this.apiUrl}/${id}`, jobData);
  }

  deleteJob(id: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/${id}`);
  }
}
