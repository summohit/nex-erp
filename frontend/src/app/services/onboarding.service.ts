import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface OnboardingTemplate {
  id: number;
  title: string;
  description?: string;
  createdAt?: string;
}

export interface EmployeeOnboardingTask {
  id: number;
  title: string;
  description?: string;
  isCompleted: boolean;
  completedAt?: string;
}

export interface OnboardingBoardData {
  pending: any[];
  inProgress: any[];
  completed: any[];
}

@Injectable({
  providedIn: 'root'
})
export class OnboardingService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/onboarding`;

  getTemplates(): Observable<OnboardingTemplate[]> {
    return this.http.get<OnboardingTemplate[]>(`${this.apiUrl}/templates`);
  }

  addTemplate(data: { title: string, description?: string }): Observable<OnboardingTemplate> {
    return this.http.post<OnboardingTemplate>(`${this.apiUrl}/templates`, data);
  }

  deleteTemplate(id: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/templates/${id}`);
  }

  getOnboardingBoard(): Observable<OnboardingBoardData> {
    return this.http.get<OnboardingBoardData>(`${this.apiUrl}/board`);
  }

  getMyTasks(): Observable<{ status: string, tasks: EmployeeOnboardingTask[] }> {
    return this.http.get<{ status: string, tasks: EmployeeOnboardingTask[] }>(`${this.apiUrl}/my-tasks`);
  }

  completeTask(taskId: number): Observable<{ success: boolean, newStatus: string }> {
    return this.http.put<{ success: boolean, newStatus: string }>(`${this.apiUrl}/my-tasks/${taskId}/complete`, {});
  }

  toggleAdminTask(taskId: number, isCompleted: boolean): Observable<{ success: boolean, newStatus: string, employeeId: number }> {
    return this.http.put<{ success: boolean, newStatus: string, employeeId: number }>(`${this.apiUrl}/tasks/${taskId}/toggle`, { isCompleted });
  }

  updateEmployeeStatus(employeeId: number, status: string): Observable<{ success: boolean, status: string }> {
    return this.http.put<{ success: boolean, status: string }>(`${this.apiUrl}/employee/${employeeId}/status`, { status });
  }
}
