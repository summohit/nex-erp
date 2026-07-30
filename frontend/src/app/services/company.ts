import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AuthService } from './auth.service';
import { environment } from '../../environments/environment';

export interface CompanyProfile {
  id: number;
  name: string;
  domain?: string;
  industry?: string;
  size?: string;
  timezone?: string;
  logoUrl?: string;
}

@Injectable({
  providedIn: 'root'
})
export class CompanyService {
  private http = inject(HttpClient);
  private authService = inject(AuthService);
  private apiUrl = `${environment.apiUrl}/company`;
  private uploadUrl = `${environment.apiUrl}/upload`;

  private getAuthHeaders() {
    const token = this.authService.getToken();
    return new HttpHeaders().set('Authorization', `Bearer ${token}`);
  }

  getProfile(): Observable<CompanyProfile> {
    return this.http.get<CompanyProfile>(`${this.apiUrl}/profile`, { headers: this.getAuthHeaders() });
  }

  updateProfile(data: Partial<CompanyProfile>): Observable<CompanyProfile> {
    return this.http.put<CompanyProfile>(`${this.apiUrl}/profile`, data, { headers: this.getAuthHeaders() });
  }

  uploadLogo(file: File): Observable<{ url: string }> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<{ url: string }>(this.uploadUrl, formData, { headers: this.getAuthHeaders() });
  }
}
