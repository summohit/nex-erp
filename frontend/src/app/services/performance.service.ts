import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

export interface PerformanceGoal {
  id: number;
  title: string;
  description?: string;
  status: string;
  dueDate?: string;
  createdAt: string;
}

export interface PerformanceReview {
  id: number;
  cycleName: string;
  rating?: number;
  feedback?: string;
  status: string;
  reviewer: any;
  employee: any;
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
  
  deleteGoal(id: number) {
    return this.http.delete(`${this.apiUrl}/goals/${id}`);
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

  setNextAppraisalDate(employeeId: number, date: string) {
    return this.http.put(`${this.apiUrl}/appraisal-date/${employeeId}`, { date });
  }
}
