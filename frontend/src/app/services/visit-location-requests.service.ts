import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface VisitLocationRequestCapabilities {
  isAdmin: boolean;
  isProjectManager: boolean;
  canAdd: boolean;
  canReview: boolean;
}

export interface VisitLocationRequest {
  id: number;
  name: string;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  position: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectionReason?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  requestedBy: { id: number; firstName: string; lastName: string; avatarUrl?: string | null };
  reviewedBy?: { id: number; firstName: string; lastName: string } | null;
  leadContact?: { id: number; name: string; companyName?: string | null } | null;
  visitLocation?: { id: number; name: string; isActive: boolean } | null;
}

export interface VisitLocationRequestInput {
  name: string;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  leadContactId?: number | null;
  position?: number;
}

@Injectable({ providedIn: 'root' })
export class VisitLocationRequestsService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/visit-location-requests`;

  capabilities(): Observable<VisitLocationRequestCapabilities> {
    return this.http.get<VisitLocationRequestCapabilities>(`${this.apiUrl}/capabilities`);
  }

  list(): Observable<VisitLocationRequest[]> {
    return this.http.get<VisitLocationRequest[]>(this.apiUrl);
  }

  create(data: VisitLocationRequestInput): Observable<VisitLocationRequest> {
    return this.http.post<VisitLocationRequest>(this.apiUrl, data);
  }

  review(
    id: number,
    decision: 'APPROVED' | 'REJECTED',
    reason?: string,
  ): Observable<VisitLocationRequest> {
    return this.http.post<VisitLocationRequest>(`${this.apiUrl}/${id}/review`, {
      decision,
      reason,
    });
  }
}
