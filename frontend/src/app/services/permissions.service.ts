import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, catchError, tap } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface RolePermission {
  id?: number;
  role: string;
  module: string;
  action: string;
  companyId: number;
  enabled?: boolean; // Used for UI state
}

@Injectable({
  providedIn: 'root'
})
export class PermissionsService {
  private apiUrl = `${environment.apiUrl}/permissions`;
  private http = inject(HttpClient);

  private permissionsCache = new Map<string, RolePermission[]>();

  getAllPermissions(role?: string): Observable<RolePermission[]> {
    const cacheKey = role || 'all';
    
    // Return cached permissions if available
    if (this.permissionsCache.has(cacheKey)) {
      return of(this.permissionsCache.get(cacheKey)!);
    }

    let params: any = {};
    if (role) {
      params.role = role;
    }

    return this.http.get<RolePermission[]>(this.apiUrl, { params }).pipe(
      tap(perms => {
        this.permissionsCache.set(cacheKey, perms);
      }),
      catchError(() => of([]))
    );
  }

  setPermission(role: string, module: string, action: string, enabled: boolean): Observable<any> {
    // Invalidate cache for this role after update
    this.permissionsCache.delete(role);
    return this.http.post(this.apiUrl, { role, module, action, enabled });
  }

  clearCache() {
    this.permissionsCache.clear();
  }

  /** Website Chat tabs the signed-in user may open (decided server-side: role + per-user override). */
  getWebsiteChatTabs(): Observable<string[]> {
    return this.http.get<{ tabs: string[] }>(`${this.apiUrl}/website-chat/me`).pipe(
      map(r => r.tabs || []),
      catchError(() => of([]))
    );
  }

  getWebsiteChatUsers(): Observable<WebsiteChatUserAccess[]> {
    return this.http.get<WebsiteChatUserAccess[]>(`${this.apiUrl}/website-chat/users`);
  }

  /** granted: true = show, false = hide, null = follow the role. */
  setWebsiteChatUser(userId: number, granted: boolean | null): Observable<any> {
    return this.http.put(`${this.apiUrl}/website-chat/users/${userId}`, { granted });
  }
}

export interface WebsiteChatUserAccess {
  userId: number;
  name: string;
  email: string;
  role: string;
  fromRole: boolean;
  override: boolean | null;
  hasAccess: boolean;
}
