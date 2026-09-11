import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap } from 'rxjs/operators';
import { Observable } from 'rxjs';
import { signal } from '@angular/core';
import { environment } from '../../environments/environment';
import { PermissionsService } from './permissions.service';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/auth`;
  private permissionsService = inject(PermissionsService);

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
        if (response?.refresh_token) {
          localStorage.setItem('refresh_token', response.refresh_token);
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
        if (response?.refresh_token) {
          localStorage.setItem('refresh_token', response.refresh_token);
        }
      })
    );
  }

  // ── Two-factor authentication ──────────────────────────────────────────────
  // The challenge endpoints reuse the same token-storing `tap` as login: a
  // successful verification returns a real token pair, so the session starts
  // here rather than at the password step.

  private storeTokens = (response: any) => {
    if (response?.access_token) {
      localStorage.setItem('access_token', response.access_token);
    }
    if (response?.refresh_token) {
      localStorage.setItem('refresh_token', response.refresh_token);
    }
  };

  /** Complete sign-in with a TOTP code or a one-time backup code. */
  verifyTwoFactorChallenge(challengeToken: string, code: string): Observable<any> {
    return this.http
      .post(`${this.apiUrl}/2fa/challenge/verify`, { challengeToken, code })
      .pipe(tap(this.storeTokens));
  }

  /** Begin enrolment during a forced (company-required) sign-in. */
  startChallengeEnrolment(challengeToken: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/2fa/challenge/enrol/start`, { challengeToken });
  }

  /** Finish forced enrolment; returns the backup codes alongside the tokens. */
  confirmChallengeEnrolment(challengeToken: string, code: string): Observable<any> {
    return this.http
      .post(`${this.apiUrl}/2fa/challenge/enrol/confirm`, { challengeToken, code })
      .pipe(tap(this.storeTokens));
  }

  getTwoFactorStatus(): Observable<any> {
    return this.http.get(`${this.apiUrl}/2fa/status`);
  }

  setupTwoFactor(password: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/2fa/setup`, { password });
  }

  enableTwoFactor(code: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/2fa/enable`, { code });
  }

  disableTwoFactor(password: string, code: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/2fa/disable`, { password, code });
  }

  regenerateBackupCodes(password: string, code: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/2fa/backup-codes/regenerate`, { password, code });
  }

  /**
   * Moving the authenticator to a new phone. Two steps, and 2FA stays on
   * throughout — the replacement secret only goes live once the new device
   * proves it works, so this remains available even when the company policy
   * forbids turning 2FA off.
   */
  startTwoFactorRotation(password: string, code: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/2fa/rotate/start`, { password, code });
  }

  confirmTwoFactorRotation(code: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/2fa/rotate/confirm`, { code });
  }

  cancelTwoFactorRotation(): Observable<any> {
    return this.http.post(`${this.apiUrl}/2fa/rotate/cancel`, {});
  }

  listTwoFactorUsers(): Observable<any> {
    return this.http.get(`${this.apiUrl}/2fa/admin/users`);
  }

  resetTwoFactorForUser(userId: number): Observable<any> {
    return this.http.post(`${this.apiUrl}/2fa/admin/reset/${userId}`, {});
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

  resendVerification(email: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/resend-verification`, { email });
  }

  forgotPassword(email: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/forgot-password`, { email });
  }

  resetPassword(data: { email: string; otp: string; newPassword: string }): Observable<any> {
    return this.http.post(`${this.apiUrl}/reset-password`, data);
  }

  sendPasswordResetEmail(): Observable<any> {
    return this.http.post(`${this.apiUrl}/reset-password-email`, {});
  }

  logout() {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    this.currentUser.set(null);
    this.permissionsService.clearCache();
  }

  refreshToken(): Observable<any> {
    const refresh_token = localStorage.getItem('refresh_token');
    return this.http.post(`${this.apiUrl}/refresh`, { refreshToken: refresh_token }).pipe(
      tap((response: any) => {
        if (response?.access_token) {
          localStorage.setItem('access_token', response.access_token);
        }
        if (response?.refresh_token) {
          localStorage.setItem('refresh_token', response.refresh_token);
        }
      })
    );
  }
}
