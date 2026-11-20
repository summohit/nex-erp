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
  // Offboarding part 1 (20 Nov 2026)
  exitType?: string;
  stage?: string;
  initiatedById?: number | null;
  documentUrl?: string | null;
  noticeDays?: number | null;
  earliestLastWorkingDay?: string | null;
  shortNoticeDays?: number | null;
  shortNoticeAction?: string | null;
  reporteesToId?: number | null;
  separatedAt?: string | null;
  approvals?: { stage: string; decision: string; byName?: string; by?: string; at: string; note?: string | null }[] | null;
  employee?: {
    id: number;
    salutation: string;
    firstName?: string | null;
    lastName?: string | null;
    employeeCode?: string | null;
    avatarUrl?: string | null;
    user: { email: string };
  };
  approver?: { id: number, email: string };
}

export interface OffboardingTask {
  id: number;
  department: string;
  taskName: string;
  description: string;
  status: string;
  remarks?: string;
  recoveryAmount?: number | null;
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

  // ── Offboarding part 1 (20 Nov 2026) ──
  getNotice(employeeId: number) {
    return this.http.get<{ type: string; days: number; earliest: string }>(`${this.apiUrl}/notice/${employeeId}`);
  }
  getNoticePolicy() { return this.http.get<Record<string, number>>(`${this.apiUrl}/notice-policy`); }
  saveNoticePolicy(p: Record<string, number>) { return this.http.put<Record<string, number>>(`${this.apiUrl}/notice-policy`, p); }
  initiateExit(body: { employeeId: number; exitType: string; reason: string; lastWorkingDay: string; documentUrl?: string; shortNoticeAction?: string }) {
    return this.http.post<Resignation>(`${this.apiUrl}/initiate`, body);
  }
  decideExit(id: number, body: { decision: 'APPROVE' | 'REJECT'; note?: string; lastWorkingDay?: string; shortNoticeAction?: string }) {
    return this.http.put<Resignation>(`${this.apiUrl}/resignations/${id}/decision`, body);
  }

  // Offboarding part 2 (20 Nov 2026): handover form
  getHandover(id: number) { return this.http.get<any>(`${this.apiUrl}/resignations/${id}/handover`); }
  saveHandover(id: number, form: any, submit = false) { return this.http.put<any>(`${this.apiUrl}/resignations/${id}/handover`, { form, submit }); }
  receiveHandover(id: number, note?: string) { return this.http.post<any>(`${this.apiUrl}/resignations/${id}/handover/receive`, { note }); }

  getTasks() {
    return this.http.get<OffboardingTask[]>(`${this.apiUrl}/tasks`);
  }

  clearTask(id: number, remarks?: string, recoveryAmount?: number | null) {
    return this.http.put<OffboardingTask>(`${this.apiUrl}/tasks/${id}/complete`, { remarks, recoveryAmount });
  }
  // Offboarding part 3 (20 Nov 2026)
  setReporteesTo(id: number, managerId: number | null, dates: { lastWorkingDay?: string; fnfDueDate?: string } = {}) { return this.http.put<any>(`${this.apiUrl}/resignations/${id}/reportees`, { managerId, ...dates }); }
  withdrawResignation(id: number, note?: string) { return this.http.post<any>(`${this.apiUrl}/resignations/${id}/withdraw`, { note }); }
  verifyClearance(id: number, body: { section: string; verified: boolean; note?: string; recoveryAmount?: number }) { return this.http.post<any>(`${this.apiUrl}/resignations/${id}/clearance`, body); }
  getExitLetter(id: number) { return this.http.get<any>(`${this.apiUrl}/resignations/${id}/exit-letter`); }
  sendExitLetter(id: number, body: { body: string; to: string }) { return this.http.post<any>(`${this.apiUrl}/resignations/${id}/exit-letter/send`, body); }
  // Part 4: Full & Final (20 Nov 2026)
  listFnf() { return this.http.get<any[]>(`${this.apiUrl}/fnf`); }
  getFnf(resignationId: number) { return this.http.get<any>(`${this.apiUrl}/resignations/${resignationId}/fnf`); }
  prepareFnf(resignationId: number) { return this.http.post<any>(`${this.apiUrl}/resignations/${resignationId}/fnf/prepare`, {}); }
  saveFnf(id: number, body: { lines?: any[]; notes?: string }) { return this.http.put<any>(`${this.apiUrl}/fnf/${id}`, body); }
  fnfAction(id: number, action: 'submit' | 'approve' | 'reject' | 'paid', body: any = {}) { return this.http.post<any>(`${this.apiUrl}/fnf/${id}/${action}`, body); }
  separateNow(id: number) { return this.http.post<any>(`${this.apiUrl}/resignations/${id}/separate`, {}); }

  getExitInterviews() {
    return this.http.get<ExitInterview[]>(`${this.apiUrl}/exit-interviews`);
  }

  submitExitInterview(employeeId: number, feedback: string, rating: number) {
    return this.http.post<ExitInterview>(`${this.apiUrl}/exit-interview`, { employeeId, feedback, rating });
  }
}
