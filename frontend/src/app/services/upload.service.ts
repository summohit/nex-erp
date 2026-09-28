import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { getAccessToken } from '../core/token-storage';

@Injectable({
  providedIn: 'root'
})
export class UploadService {
  private http = inject(HttpClient);
  
  uploadFile(file: File): Observable<any> {
    const formData = new FormData();
    formData.append('file', file);
    
    const token = getAccessToken();
    return this.http.post(`${environment.apiUrl}/upload`, formData, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  /**
   * Proof for a late clock-out (§Att4).
   *
   * Its own endpoint, not the generic one above: that route is unauthenticated
   * and accepts any file type, and this one is evidence in an approval.
   */
  uploadAttendanceProof(file: File): Observable<{ url: string }> {
    const formData = new FormData();
    formData.append('file', file);

    const token = getAccessToken();
    return this.http.post<{ url: string }>(`${environment.apiUrl}/upload/attendance-proof`, formData, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }
}
