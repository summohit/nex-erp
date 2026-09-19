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
}
