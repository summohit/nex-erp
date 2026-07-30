import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { Shift } from './attendance';

@Injectable({
  providedIn: 'root'
})
export class ShiftsService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/shifts`;

  getShifts(): Observable<Shift[]> {
    return this.http.get<Shift[]>(this.apiUrl);
  }

  createShift(data: Partial<Shift>): Observable<Shift> {
    return this.http.post<Shift>(this.apiUrl, data);
  }

  updateShift(id: number, data: Partial<Shift>): Observable<Shift> {
    return this.http.put<Shift>(`${this.apiUrl}/${id}`, data);
  }

  deleteShift(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }
}
