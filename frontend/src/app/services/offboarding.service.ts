import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

export interface Resignation {
  id: number;
  employeeId: number;
  reason: string;
  intendedLastWorkingDay: string;
  approvedLastWorkingDay?: string;
  status: string;
  remarks?: string;
  createdAt: string;
  employee?: { id: number, salutation: string, user: { email: string } };
  approver?: { id: number, email: string };
}

export interface OffboardingTask {
  id: number;
  department: string;
  taskName: string;
  description: string;
  status: string;
  remarks?: string;
  createdAt: string;
  employee?: { id: number, userId: number };
  clearedBy?: { id: number, email: string };
}

export interface ExitInterview {
  id: number;
  feedback: string;
  rating: number;
  completedAt: string;
  employee?: { id: number };
  interviewer?: { id: number, email: string };
}

@Injectable({ providedIn: 'root' })
export class OffboardingService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/offboarding`;

  getResignations() {
    return this.http.get<Resignation[]>(`${this.apiUrl}/resignations`);
  }

  submitResignation(reason: string, intendedLastWorkingDay: string) {
    return this.http.post<Resignation>(`${this.apiUrl}/resign`, { reason, intendedLastWorkingDay });
  }

  updateResignationStatus(id: number, status: string, approvedLastWorkingDay?: string, remarks?: string) {
    return this.http.put<Resignation>(`${this.apiUrl}/resignations/${id}/status`, { status, approvedLastWorkingDay, remarks });
  }

  getTasks() {
    return this.http.get<OffboardingTask[]>(`${this.apiUrl}/tasks`);
  }

  clearTask(id: number, remarks?: string) {
    return this.http.put<OffboardingTask>(`${this.apiUrl}/tasks/${id}/complete`, { remarks });
  }

  getExitInterviews() {
    return this.http.get<ExitInterview[]>(`${this.apiUrl}/exit-interviews`);
  }

  submitExitInterview(employeeId: number, feedback: string, rating: number) {
    return this.http.post<ExitInterview>(`${this.apiUrl}/exit-interview`, { employeeId, feedback, rating });
  }
}
