import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
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

  constructor(private http: HttpClient) {}

  getAllPermissions(role?: string): Observable<RolePermission[]> {
    let params: any = {};
    if (role) {
      params.role = role;
    }
    return this.http.get<RolePermission[]>(this.apiUrl, { params });
  }

  setPermission(role: string, module: string, action: string, enabled: boolean): Observable<any> {
    return this.http.post(this.apiUrl, { role, module, action, enabled });
  }
}
