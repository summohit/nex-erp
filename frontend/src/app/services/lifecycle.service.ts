import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

/** Probation, notice period and PIPs (19 Oct 2026). */
export interface LcPerson {
  id: number; name: string; employeeCode: string | null; avatarUrl: string | null;
  designation: string | null; department: string | null; joiningDate: string | null; employmentCategory: string;
}
export interface LcProbation {
  employeeId: number; name: string; employeeCode: string | null; avatarUrl: string | null; designation: string | null;
  department: string | null; employmentCategory: string; joiningDate: string | null; endDate: string; daysLeft: number | null;
}
export interface LcNotice {
  resignationId: number; employeeId: number; name: string; employeeCode: string | null; avatarUrl: string | null;
  designation: string | null; status: string; appliedOn: string; lastWorkingDay: string | null; daysLeft: number | null;
}
export interface LcPip {
  id: number; employeeId: number; name: string; employeeCode: string | null; avatarUrl: string | null; designation: string | null;
  raisedBy: string | null; reason: string; goals: string; startDate: string; endDate: string; status: string;
  daysLeft: number | null; acknowledgedAt: string | null; outcomeNote: string | null; closedAt: string | null; checkInCount: number;
}
export interface LcPipDetail extends LcPip {
  canManage: boolean; isMine: boolean;
  checkIns: { id: number; note: string; createdAt: string; author: string | null; authorAvatar: string | null }[];
}
export interface LcOverview {
  canManageProbation: boolean; isManager: boolean;
  people: LcPerson[]; probation: LcProbation[]; notice: LcNotice[]; pips: LcPip[];
}

@Injectable({ providedIn: 'root' })
export class LifecycleService {
  private http = inject(HttpClient);
  private url = `${environment.apiUrl}/lifecycle`;

  overview(): Observable<LcOverview> { return this.http.get<LcOverview>(`${this.url}/overview`); }
  setProbation(employeeId: number, body: { months?: number; endDate?: string }) { return this.http.put(`${this.url}/probation/${employeeId}`, body); }
  confirmProbation(employeeId: number, makePermanent = false) { return this.http.post(`${this.url}/probation/${employeeId}/confirm`, { makePermanent }); }
  makePermanent(employeeId: number) { return this.http.post(`${this.url}/employees/${employeeId}/make-permanent`, {}); }
  clearProbation(employeeId: number) { return this.http.delete(`${this.url}/probation/${employeeId}`); }
  myPips(): Observable<LcPip[]> { return this.http.get<LcPip[]>(`${this.url}/pips/mine`); }
  pipHistory(): Observable<LcPip[]> { return this.http.get<LcPip[]>(`${this.url}/pips/history`); }
  createPip(body: { employeeId: number; reason: string; goals: string; startDate: string; endDate: string }): Observable<LcPipDetail> {
    return this.http.post<LcPipDetail>(`${this.url}/pips`, body);
  }
  getPip(id: number): Observable<LcPipDetail> { return this.http.get<LcPipDetail>(`${this.url}/pips/${id}`); }
  addCheckIn(id: number, note: string): Observable<LcPipDetail> { return this.http.post<LcPipDetail>(`${this.url}/pips/${id}/check-ins`, { note }); }
  updatePip(id: number, body: { action: string; endDate?: string; note?: string }): Observable<LcPipDetail> {
    return this.http.put<LcPipDetail>(`${this.url}/pips/${id}`, body);
  }
  acknowledge(id: number): Observable<LcPipDetail> { return this.http.post<LcPipDetail>(`${this.url}/pips/${id}/acknowledge`, {}); }
}
