import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface AwardType {
  id: number;
  title: string;
  icon: string;
  color: string;
  status: boolean;
}

export interface Appreciation {
  id: number;
  awardTypeId: number;
  awardType: AwardType;
  employeeId: number;
  employee: {
    id: number;
    firstName: string;
    lastName: string;
    avatarUrl?: string;
    designation?: { name: string };
    department?: { name: string };
  };
  givenDate: string;
  summary: string;
  photoUrl?: string;
  createdAt: string;
}

@Injectable({
  providedIn: 'root'
})
export class AppreciationService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/appreciation`;

  getAppreciations(): Observable<Appreciation[]> {
    return this.http.get<Appreciation[]>(this.apiUrl);
  }

  getAwardTypes(): Observable<AwardType[]> {
    return this.http.get<AwardType[]>(`${this.apiUrl}/award-types`);
  }

  createAwardType(data: Partial<AwardType>): Observable<AwardType> {
    return this.http.post<AwardType>(`${this.apiUrl}/award-types`, data);
  }

  updateAwardType(id: number, data: Partial<AwardType>): Observable<AwardType> {
    return this.http.put<AwardType>(`${this.apiUrl}/award-types/${id}`, data);
  }

  deleteAwardType(id: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/award-types/${id}`);
  }

  createAppreciation(data: any): Observable<Appreciation> {
    return this.http.post<Appreciation>(this.apiUrl, data);
  }

  deleteAppreciation(id: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/${id}`);
  }
}
