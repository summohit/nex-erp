import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { getAccessToken } from '../core/token-storage';

export interface Employee {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  avatarUrl?: string;
  departmentId?: number;
  designationId?: number;
  role: string;
  isProjectManager?: boolean;
  managerId?: number;
  department?: { id?: number; name: string };
  designation?: { id?: number; name: string };
  shift?: { id: number; name: string; workingDays?: string | null } | null;
  branch?: { id?: number; name?: string; weeklyOffs?: string | null } | null;
  user?: { email: string, role: string, avatarUrl?: string, status?: string };
  createdAt?: string;
  employeeCode?: string;
  employmentCategory?: string;
  pfNumber?: string;
  esiNumber?: string;
  workLocation?: string;
  onboardingStatus?: string;
  joiningDate?: string | null;
  offboardingStatus?: 'NONE' | 'IN_PROGRESS' | 'SEPARATED' | string;
  resignations?: Array<{
    id: number;
    status: string;
    intendedLastWorkingDay?: string | null;
    approvedLastWorkingDay?: string | null;
    createdAt?: string;
  }>;
}

@Injectable({
  providedIn: 'root'
})
export class EmployeeService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/employees`;

  getEmployees(): Observable<Employee[]> {
    const token = getAccessToken();
    return this.http.get<Employee[]>(this.apiUrl, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  /**
   * Set an employee's internal charge-out rate (§23). Null clears it.
   *
   * Its own endpoint rather than a field on updateEmployee: the server refuses
   * the rate to every role but Admin, Superadmin and Finance, and keeping it
   * off the ordinary profile payload means an unauthorised save cannot
   * silently drop it either.
   */
  setCostRate(employeeId: number, hourlyCostRate: number | null) {
    return this.http.put<{ id: number; hourlyCostRate: number | null }>(
      `${this.apiUrl}/${employeeId}/cost-rate`,
      { hourlyCostRate }
    );
  }

  // Minimal name/avatar list — usable by any authenticated employee, unlike
  // getEmployees() which requires employee-directory view permission.
  getEmployeesBasicList(): Observable<Employee[]> {
    const token = getAccessToken();
    return this.http.get<Employee[]>(`${this.apiUrl}/basic-list`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  getCeo(): Observable<Employee | null> {
    const token = getAccessToken();
    return this.http.get<Employee | null>(`${this.apiUrl}/ceo`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  createEmployee(data: any): Observable<Employee> {
    const token = getAccessToken();
    return this.http.post<Employee>(this.apiUrl, data, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  updateEmployee(id: number, data: any): Observable<Employee> {
    const token = getAccessToken();
    return this.http.put<Employee>(`${this.apiUrl}/${id}`, data, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  startTraineeConversion(id: number, data: { jobId: number; offeredSalary: number; joiningDate?: string; remarks?: string }): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${this.apiUrl}/${id}/convert-to-employee`, data);
  }

  deleteEmployee(id: number): Observable<any> {
    const token = getAccessToken();
    return this.http.delete(`${this.apiUrl}/${id}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  // --- Profile Extensions ---

  /** The signed-in employee's own profile (includes branch weekly offs). */
  getMyProfile() {
    return this.http.get<any>(`${this.apiUrl}/me/profile`);
  }

  getProfile(id: number | string): Observable<any> {
    const token = getAccessToken();
    return this.http.get<any>(`${this.apiUrl}/${id}/profile`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  getEmploymentHistory(id: number | string): Observable<any[]> {
    const token = getAccessToken();
    return this.http.get<any[]>(`${this.apiUrl}/${id}/history`, { headers: { Authorization: `Bearer ${token}` } });
  }

  updateProfile(id: number | string, data: any): Observable<any> {
    const token = getAccessToken();
    return this.http.put<any>(`${this.apiUrl}/${id}/profile`, data, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  addContact(id: number | string, data: any): Observable<any> {
    const token = getAccessToken();
    return this.http.post<any>(`${this.apiUrl}/${id}/contacts`, data, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  deleteContact(id: number | string, contactId: number): Observable<any> {
    const token = getAccessToken();
    return this.http.delete<any>(`${this.apiUrl}/${id}/contacts/${contactId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  addDocument(id: number | string, data: any): Observable<any> {
    const token = getAccessToken();
    return this.http.post<any>(`${this.apiUrl}/${id}/documents`, data, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  addDocuments(id: number | string, docs: any[]): Observable<any> {
    const token = getAccessToken();
    return this.http.post<any>(`${this.apiUrl}/${id}/documents/bulk`, { docs }, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  /** Re-file an uploaded document, e.g. one saved as "Other". */
  updateDocumentType(id: number | string, documentId: number, documentType: string): Observable<any> {
    const token = getAccessToken();
    return this.http.put<any>(`${this.apiUrl}/${id}/documents/${documentId}`, { documentType }, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  deleteDocument(id: number | string, documentId: number): Observable<any> {
    const token = getAccessToken();
    return this.http.delete<any>(`${this.apiUrl}/${id}/documents/${documentId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  addSkill(id: number | string, data: { category: string; name: string; level: string }): Observable<any> {
    const token = getAccessToken();
    return this.http.post<any>(`${this.apiUrl}/${id}/skills`, data, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  updateSkill(id: number | string, skillId: number, data: { category: string; name: string; level: string }): Observable<any> {
    const token = getAccessToken();
    return this.http.put<any>(`${this.apiUrl}/${id}/skills/${skillId}`, data, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  deleteSkill(id: number | string, skillId: number): Observable<any> {
    const token = getAccessToken();
    return this.http.delete<any>(`${this.apiUrl}/${id}/skills/${skillId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  addResumeLine(id: number | string, data: any): Observable<any> {
    const token = getAccessToken();
    return this.http.post<any>(`${this.apiUrl}/${id}/resume-lines`, data, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  updateResumeLine(id: number | string, lineId: number, data: any): Observable<any> {
    const token = getAccessToken();
    return this.http.put<any>(`${this.apiUrl}/${id}/resume-lines/${lineId}`, data, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  deleteResumeLine(id: number | string, lineId: number): Observable<any> {
    const token = getAccessToken();
    return this.http.delete<any>(`${this.apiUrl}/${id}/resume-lines/${lineId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  // --- Uploads ---

  /** Profile reminder: what the signed-in person still has to upload or fill in. */
  getMyProfileCompleteness(): Observable<ProfileCompleteness | null> {
    const token = getAccessToken();
    return this.http.get<ProfileCompleteness | null>(`${this.apiUrl}/me/profile-completeness`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  /** "This is my first job": no UAN, experience letter or salary slip asked for. */
  setMyFirstJob(firstJob: boolean): Observable<ProfileCompleteness | null> {
    const token = getAccessToken();
    return this.http.put<ProfileCompleteness | null>(`${this.apiUrl}/me/first-job`, { firstJob }, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  /** HR: the document lock. */
  getProfileLock(): Observable<ProfileLock> {
    const token = getAccessToken();
    return this.http.get<ProfileLock>(`${this.apiUrl}/profile-completeness/lock`, { headers: { Authorization: `Bearer ${token}` } });
  }

  setProfileLock(body: { enabled: boolean; from: string | null }): Observable<ProfileLock> {
    const token = getAccessToken();
    return this.http.put<ProfileLock>(`${this.apiUrl}/profile-completeness/lock`, body, { headers: { Authorization: `Bearer ${token}` } });
  }

  /** HR: who never sees the document reminder or lock. */
  getProfileExempt(): Observable<ExemptEmployee[]> {
    const token = getAccessToken();
    return this.http.get<ExemptEmployee[]>(`${this.apiUrl}/profile-completeness/exempt`, { headers: { Authorization: `Bearer ${token}` } });
  }

  setProfileExempt(employeeId: number, exempt: boolean): Observable<ExemptEmployee[]> {
    const token = getAccessToken();
    return this.http.put<ExemptEmployee[]>(`${this.apiUrl}/profile-completeness/exempt/${employeeId}`, { exempt }, { headers: { Authorization: `Bearer ${token}` } });
  }

  /** HR: everyone's profile completion. */
  getProfileCompletenessReport(): Observable<ProfileCompletenessReport> {
    const token = getAccessToken();
    return this.http.get<ProfileCompletenessReport>(`${this.apiUrl}/profile-completeness`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  /** The document types every upload dropdown offers, in order. */
  getDocumentTypes(): Observable<{ required: string[]; previousEmployment: string[]; optional: string[]; all: string[] }> {
    const token = getAccessToken();
    return this.http.get<any>(`${this.apiUrl}/document-types`, { headers: { Authorization: `Bearer ${token}` } });
  }

  uploadDocument(file: File): Observable<{ url: string }> {
    const token = getAccessToken();
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<{ url: string }>(`${environment.apiUrl}/upload`, formData, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  uploadResumePdf(file: File): Observable<{ url: string }> {
    const token = getAccessToken();
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<{ url: string }>(`${environment.apiUrl}/upload/resume`, formData, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }
}

export interface ProfileMissingItem { key: string; label: string; kind: 'document' | 'details'; hint?: string }
export interface ProfileCompleteness {
  employeeId: number;
  exempt: boolean;
  complete: boolean;
  missing: ProfileMissingItem[];
  canBeFirstJob: boolean;
  firstJob: boolean;
  uploadedAsOther: number;
  otherDocuments: { id: number; fileName: string; fileUrl: string }[];
  /** HR's lock is on for this person: no close, no "Remind me later". */
  locked?: boolean;
}
/** HR's document lock: on/off, the IST date it starts, and whether it is in force now. */
export interface ExemptEmployee {
  id: number; firstName: string; lastName: string | null; employeeCode: string | null; avatarUrl: string | null;
  email: string | null; designation: string | null; fixed: boolean;
}
export interface ProfileLock { enabled: boolean; from: string | null; active: boolean }
export interface ProfileCompletenessReport {
  total: number;
  complete: number;
  incomplete: number;
  rows: {
    employee: { id: number; firstName: string; lastName?: string | null; employeeCode?: string | null; email?: string; department: string | null; designation: string | null; avatarUrl?: string | null };
    manager: string | null;
    complete: boolean;
    firstJob: boolean;
    missing: string[];
    uploadedAsOther: number;
  }[];
}
