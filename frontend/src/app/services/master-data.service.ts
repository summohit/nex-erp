import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AuthService } from './auth.service';
import { environment } from '../../environments/environment';

export interface Department {
  id: number;
  name: string;
  isActive?: boolean;
  defaultRole?: string;
}

export interface Designation {
  id: number;
  name: string;
  departmentId?: number;
  department?: Department;
  isActive?: boolean;
  canEditProfiles?: boolean;
}

export interface Branch {
  id: number;
  name: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  startTime?: string;
  endTime?: string;
  weeklyOffs?: string;
  isActive?: boolean;
}

export interface TaskType {
  id: number;
  name: string;
  isActive: boolean;
  position: number;
}

/**
 * A delivery phase — "Phase 1", "Deployment", "UAT" (§8).
 *
 * Company-wide, like TaskType above, and managed the same way: named,
 * orderable, and soft-disabled rather than deleted once tasks carry it.
 */
export interface ProjectPhase {
  id: number;
  name: string;
  isActive: boolean;
  position: number;
}

/**
 * A task created automatically on every new project and assigned to its
 * project manager (§1). Rows, not constants -- a company edits these.
 */
export interface DefaultProjectTask {
  id: number;
  name: string;
  description?: string | null;
  isActive: boolean;
  position: number;
}

export interface LeaveType {
  id: number;
  name: string;
  description?: string;
  defaultDays: number;
  isPaid: boolean;
  allowHalfDay: boolean;
  encashable: boolean;
  encashmentLimit: number;
}

export interface Holiday {
  id: number;
  name: string;
  date: string;
  companyId: number;
}

export interface BlackoutDate {
  id: number;
  date: string;
  reason: string;
  departmentId: number | null;
  companyId: number;
}

@Injectable({
  providedIn: 'root'
})
export class MasterDataService {
  private http = inject(HttpClient);
  private authService = inject(AuthService);
  private apiUrl = `${environment.apiUrl}/master-data`; // Ensure API URL is configured correctly

  // --- Departments ---
  getDepartments(activeOnly: boolean = false): Observable<Department[]> {
    const url = activeOnly ? `${this.apiUrl}/departments?activeOnly=true` : `${this.apiUrl}/departments`;
    return this.http.get<Department[]>(url);
  }

  createDepartment(data: { name: string }): Observable<Department> {
    return this.http.post<Department>(`${this.apiUrl}/departments`, data);
  }

  updateDepartment(id: number, data: { name?: string, isActive?: boolean, defaultRole?: string }): Observable<Department> {
    return this.http.put<Department>(`${this.apiUrl}/departments/${id}`, data);
  }

  deleteDepartment(id: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/departments/${id}`);
  }

  getDepartmentRoleMismatches(id: number, role: string): Observable<{ employeeId: number, firstName: string, lastName: string, email: string, currentRole: string }[]> {
    return this.http.get<any[]>(`${this.apiUrl}/departments/${id}/role-mismatches`, { params: { role } });
  }

  syncDepartmentRoles(id: number, role: string, employeeIds: number[]): Observable<{ updatedCount: number }> {
    return this.http.post<{ updatedCount: number }>(`${this.apiUrl}/departments/${id}/sync-roles`, { role, employeeIds });
  }

  // --- Designations ---
  getDesignations(activeOnly: boolean = false): Observable<Designation[]> {
    const url = activeOnly ? `${this.apiUrl}/designations?activeOnly=true` : `${this.apiUrl}/designations`;
    return this.http.get<Designation[]>(url);
  }

  createDesignation(data: { name: string, departmentId: number, canEditProfiles?: boolean }): Observable<Designation> {
    return this.http.post<Designation>(`${this.apiUrl}/designations`, data);
  }

  updateDesignation(id: number, data: { name?: string, departmentId?: number, isActive?: boolean, canEditProfiles?: boolean }): Observable<Designation> {
    return this.http.put<Designation>(`${this.apiUrl}/designations/${id}`, data);
  }

  deleteDesignation(id: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/designations/${id}`);
  }

  // --- Branches ---
  getBranches(): Observable<Branch[]> {
    return this.http.get<Branch[]>(`${this.apiUrl}/branches`);
  }

  createBranch(data: Partial<Branch>): Observable<Branch> {
    return this.http.post<Branch>(`${this.apiUrl}/branches`, data);
  }

  updateBranch(id: number, data: Partial<Branch>): Observable<Branch> {
    return this.http.put<Branch>(`${this.apiUrl}/branches/${id}`, data);
  }

  deleteBranch(id: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/branches/${id}`);
  }

  // --- Leave Types ---
  // Task types — the business meaning of a task (Call, Site Visit,
  // Documentation), kept as master data so the vocabulary can change without a
  // deploy. Distinct from Issue.type, which drives board behaviour.
  getTaskTypes(): Observable<TaskType[]> {
    return this.http.get<TaskType[]>(`${this.apiUrl}/task-types`);
  }

  createTaskType(data: Partial<TaskType>): Observable<TaskType> {
    return this.http.post<TaskType>(`${this.apiUrl}/task-types`, data);
  }

  updateTaskType(id: number, data: Partial<TaskType>): Observable<TaskType> {
    return this.http.put<TaskType>(`${this.apiUrl}/task-types/${id}`, data);
  }

  deleteTaskType(id: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/task-types/${id}`);
  }
  // §8: project phases. Same four calls as task types above.
  getProjectPhases(activeOnly = false): Observable<ProjectPhase[]> {
    const suffix = activeOnly ? '?activeOnly=true' : '';
    return this.http.get<ProjectPhase[]>(`${this.apiUrl}/project-phases${suffix}`);
  }

  createProjectPhase(data: Partial<ProjectPhase>): Observable<ProjectPhase> {
    return this.http.post<ProjectPhase>(`${this.apiUrl}/project-phases`, data);
  }

  updateProjectPhase(id: number, data: Partial<ProjectPhase>): Observable<ProjectPhase> {
    return this.http.put<ProjectPhase>(`${this.apiUrl}/project-phases/${id}`, data);
  }

  deleteProjectPhase(id: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/project-phases/${id}`);
  }
  // §1: the tasks every new project starts with.
  getDefaultProjectTasks(activeOnly = false): Observable<DefaultProjectTask[]> {
    const suffix = activeOnly ? '?activeOnly=true' : '';
    return this.http.get<DefaultProjectTask[]>(`${this.apiUrl}/default-project-tasks${suffix}`);
  }

  createDefaultProjectTask(data: Partial<DefaultProjectTask>): Observable<DefaultProjectTask> {
    return this.http.post<DefaultProjectTask>(`${this.apiUrl}/default-project-tasks`, data);
  }

  updateDefaultProjectTask(id: number, data: Partial<DefaultProjectTask>): Observable<DefaultProjectTask> {
    return this.http.put<DefaultProjectTask>(`${this.apiUrl}/default-project-tasks/${id}`, data);
  }

  deleteDefaultProjectTask(id: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/default-project-tasks/${id}`);
  }



  getLeaveTypes(): Observable<LeaveType[]> {
    return this.http.get<LeaveType[]>(`${this.apiUrl}/leave-types`);
  }

  createLeaveType(data: Partial<LeaveType>): Observable<LeaveType> {
    return this.http.post<LeaveType>(`${this.apiUrl}/leave-types`, data);
  }

  updateLeaveType(id: number, data: Partial<LeaveType>): Observable<LeaveType> {
    return this.http.put<LeaveType>(`${this.apiUrl}/leave-types/${id}`, data);
  }

  deleteLeaveType(id: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/leave-types/${id}`);
  }

  // --- Holidays ---
  getHolidays(): Observable<Holiday[]> {
    return this.http.get<Holiday[]>(`${this.apiUrl}/holidays`);
  }

  createHoliday(data: any): Observable<any> {
    return this.http.post(`${this.apiUrl}/holidays`, data);
  }

  seedHolidays(data: { holidays: any[] }): Observable<any> {
    return this.http.post(`${this.apiUrl}/holidays/seed`, data);
  }

  updateHoliday(id: number, data: any): Observable<Holiday> {
    return this.http.put<Holiday>(`${this.apiUrl}/holidays/${id}`, data);
  }

  deleteHoliday(id: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/holidays/${id}`);
  }

  getShiftRotations(): Observable<any[]> { return this.http.get<any[]>(`${this.apiUrl}/shift-rotations`); }
  createShiftRotation(data: any) { return this.http.post(`${this.apiUrl}/shift-rotations`, data); }
  updateShiftRotation(id: number, data: any) { return this.http.put(`${this.apiUrl}/shift-rotations/${id}`, data); }
  deleteShiftRotation(id: number) { return this.http.delete(`${this.apiUrl}/shift-rotations/${id}`); }

  // Blackout Dates
  getBlackoutDates(): Observable<BlackoutDate[]> { return this.http.get<BlackoutDate[]>(`${this.apiUrl}/blackout-dates`); }
  createBlackoutDate(data: any) { return this.http.post(`${this.apiUrl}/blackout-dates`, data); }
  updateBlackoutDate(id: number, data: any) { return this.http.put(`${this.apiUrl}/blackout-dates/${id}`, data); }
  deleteBlackoutDate(id: number) { return this.http.delete(`${this.apiUrl}/blackout-dates/${id}`); }
}
