import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

export interface PerformanceGoal {
  id: number;
  title: string;
  description?: string;
  status: string;
  dueDate?: string;
  progress: number;
  targetValue?: number;
  currentValue?: number;
  unit?: string;
  okr?: CompanyOKR;
  createdAt: string;
}

export interface AppraisalSignoff {
  id: number;
  signedById: number;
  role: string;
  action: string;
  comments?: string;
  signedAt: string;
}

export interface PerformanceReview {
  id: number;
  cycleId?: number;
  cycleName: string;
  type: string;
  rating?: number;
  feedback?: string;
  selfRating?: number;
  selfFeedback?: string;
  status: string;
  reviewer?: any;
  employee?: any;
  signoffs?: AppraisalSignoff[];
  createdAt: string;
}

export interface OKRKeyResult {
  id: number;
  title: string;
  targetValue: number;
  currentValue: number;
  unit: string;
}

export interface CompanyOKR {
  id: number;
  title: string;
  description?: string;
  period: string;
  status: string;
  progress: number;
  keyResults: OKRKeyResult[];
  linkedGoals?: PerformanceGoal[];
  createdAt: string;
}

export interface AppraisalCycle {
  id: number;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
}

export interface PeerFeedback {
  id: number;
  employeeId: number;
  reviewerId: number;
  employee?: any;
  cycleName: string;
  rating?: number;
  strengths?: string;
  improvements?: string;
  comments?: string;
  status: string;
  createdAt: string;
}

@Injectable({ providedIn: 'root' })
export class PerformanceService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/performance`;

  // Goals
  getMyGoals() {
    return this.http.get<PerformanceGoal[]>(`${this.apiUrl}/goals/me`);
  }

  createGoal(data: any) {
    return this.http.post<PerformanceGoal>(`${this.apiUrl}/goals`, data);
  }

  updateGoalStatus(id: number, status: string) {
    return this.http.put(`${this.apiUrl}/goals/${id}/status`, { status });
  }

  updateGoalProgress(id: number, data: any) {
    return this.http.put(`${this.apiUrl}/goals/${id}/progress`, data);
  }
  
  deleteGoal(id: number) {
    return this.http.delete(`${this.apiUrl}/goals/${id}`);
  }

  // OKRs
  getCompanyOKRs() {
    return this.http.get<CompanyOKR[]>(`${this.apiUrl}/okrs`);
  }

  createOKR(data: any) {
    return this.http.post<CompanyOKR>(`${this.apiUrl}/okrs`, data);
  }

  updateOKR(id: number, data: any) {
    return this.http.put(`${this.apiUrl}/okrs/${id}`, data);
  }

  deleteOKR(id: number) {
    return this.http.delete(`${this.apiUrl}/okrs/${id}`);
  }

  updateKeyResult(id: number, data: any) {
    return this.http.put(`${this.apiUrl}/key-results/${id}`, data);
  }

  // Appraisal Cycles
  getAppraisalCycles() {
    return this.http.get<AppraisalCycle[]>(`${this.apiUrl}/cycles`);
  }

  createAppraisalCycle(data: any) {
    return this.http.post<AppraisalCycle>(`${this.apiUrl}/cycles`, data);
  }

  // Reviews
  getMyReviews() {
    return this.http.get<PerformanceReview[]>(`${this.apiUrl}/reviews/me`);
  }

  getTeamReviews() {
    return this.http.get<PerformanceReview[]>(`${this.apiUrl}/reviews/team`);
  }

  createReview(data: any) {
    return this.http.post<PerformanceReview>(`${this.apiUrl}/reviews`, data);
  }

  updateReview(id: number, data: any) {
    return this.http.put(`${this.apiUrl}/reviews/${id}`, data);
  }

  submitSelfAppraisal(id: number, data: any) {
    return this.http.put(`${this.apiUrl}/reviews/${id}/self-appraisal`, data);
  }

  submitManagerAppraisal(id: number, data: any) {
    return this.http.put(`${this.apiUrl}/reviews/${id}/manager-appraisal`, data);
  }

  signoffReview(id: number, data: any) {
    return this.http.put(`${this.apiUrl}/reviews/${id}/signoff`, data);
  }

  setNextAppraisalDate(employeeId: number, date: string) {
    return this.http.put(`${this.apiUrl}/appraisal-date/${employeeId}`, { date });
  }

  // Peer Feedback
  requestPeerFeedback(data: any) {
    return this.http.post(`${this.apiUrl}/peer-feedback/request`, data);
  }

  getMyPeerRequests() {
    return this.http.get<PeerFeedback[]>(`${this.apiUrl}/peer-feedback/me`);
  }

  getPeerFeedbackForEmployee(employeeId: number, cycleId?: number) {
    const url = cycleId 
        ? `${this.apiUrl}/peer-feedback/employee/${employeeId}?cycleId=${cycleId}`
        : `${this.apiUrl}/peer-feedback/employee/${employeeId}`;
    return this.http.get<PeerFeedback[]>(url);
  }

  submitPeerFeedback(id: number, data: any) {
    return this.http.put(`${this.apiUrl}/peer-feedback/${id}/submit`, data);
  }
}
