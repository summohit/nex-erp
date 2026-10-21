import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

/** Field visit early release (21 Oct 2026). */
@Injectable({ providedIn: 'root' })
export class EarlyReleaseService {
  private http = inject(HttpClient);
  private url = `${environment.apiUrl}/field-visit-early-release`;
  create(body: { requestId: number; type: 'DAYS' | 'HOURS'; date: string; reason: string }) { return this.http.post<any>(this.url, body); }
  mine() { return this.http.get<any[]>(`${this.url}/mine`); }
  cancel(id: number) { return this.http.post(`${this.url}/${id}/cancel`, {}); }
  pending() { return this.http.get<any[]>(`${this.url}/pending`); }
  canApprove() { return this.http.get<{ canApprove: boolean }>(`${this.url}/can-approve`); }
  review(id: number, action: 'APPROVE' | 'REJECT', note?: string) { return this.http.post(`${this.url}/${id}/review`, { action, note }); }
}
