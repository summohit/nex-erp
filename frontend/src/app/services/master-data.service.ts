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

export interface LeaveType {
  id: number;
  name: string;
  description?: string;
  defaultDays: number;
  isPaid: boolean;
  carryForward: boolean;
  carryForwardLimit: number;
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
