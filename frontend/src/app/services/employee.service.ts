import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

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
  department?: { name: string };
  designation?: { name: string };
  user?: { email: string, role: string, avatarUrl?: string };
  createdAt?: string;
}

@Injectable({
  providedIn: 'root'
})
export class EmployeeService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/employees`;

  getEmployees(): Observable<Employee[]> {
    const token = localStorage.getItem('access_token');
    return this.http.get<Employee[]>(this.apiUrl, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  createEmployee(data: any): Observable<Employee> {
    const token = localStorage.getItem('access_token');
    return this.http.post<Employee>(this.apiUrl, data, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  updateEmployee(id: number, data: any): Observable<Employee> {
    const token = localStorage.getItem('access_token');
    return this.http.put<Employee>(`${this.apiUrl}/${id}`, data, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  deleteEmployee(id: number): Observable<any> {
    const token = localStorage.getItem('access_token');
    return this.http.delete(`${this.apiUrl}/${id}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  // --- Profile Extensions ---

  getProfile(id: number | string): Observable<any> {
    const token = localStorage.getItem('access_token');
    return this.http.get<any>(`${this.apiUrl}/${id}/profile`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  updateProfile(id: number | string, data: any): Observable<any> {
    const token = localStorage.getItem('access_token');
    return this.http.put<any>(`${this.apiUrl}/${id}/profile`, data, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  addContact(id: number | string, data: any): Observable<any> {
    const token = localStorage.getItem('access_token');
    return this.http.post<any>(`${this.apiUrl}/${id}/contacts`, data, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  deleteContact(id: number | string, contactId: number): Observable<any> {
    const token = localStorage.getItem('access_token');
    return this.http.delete<any>(`${this.apiUrl}/${id}/contacts/${contactId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  addDocument(id: number | string, data: any): Observable<any> {
    const token = localStorage.getItem('access_token');
    return this.http.post<any>(`${this.apiUrl}/${id}/documents`, data, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  deleteDocument(id: number | string, documentId: number): Observable<any> {
    const token = localStorage.getItem('access_token');
    return this.http.delete<any>(`${this.apiUrl}/${id}/documents/${documentId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }
}
