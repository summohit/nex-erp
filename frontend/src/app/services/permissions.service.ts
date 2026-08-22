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
}
