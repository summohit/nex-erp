import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap } from 'rxjs/operators';
import { Observable } from 'rxjs';
import { signal } from '@angular/core';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/auth`;

  currentUser = signal<any>(null);

  getToken(): string | null {
    return localStorage.getItem('access_token');
  }

  signup(data: any): Observable<any> {
    return this.http.post(`${this.apiUrl}/signup`, data).pipe(
      tap((response: any) => {
        if (response?.access_token) {
          localStorage.setItem('access_token', response.access_token);
        }
      })
    );
  }

  login(data: any): Observable<any> {
    return this.http.post(`${this.apiUrl}/login`, data).pipe(
      tap((response: any) => {
        if (response?.access_token) {
          localStorage.setItem('access_token', response.access_token);
        }
      })
    );
  }

  getMe(): Observable<any> {
    return this.http.get(`${environment.apiUrl}/users/me`, {
      headers: { Authorization: `Bearer ${this.getToken()}` }
    }).pipe(
      tap((user: any) => {
        this.currentUser.set(user);
      })
    );
  }

  completeOnboarding(data: any): Observable<any> {
    return this.http.post(`${environment.apiUrl}/users/onboarding`, data, {
      headers: { Authorization: `Bearer ${this.getToken()}` }
    });
  }

  logout() {
    localStorage.removeItem('access_token');
  }
}
