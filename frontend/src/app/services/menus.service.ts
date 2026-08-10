import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class MenusService {
  private http = inject(HttpClient);
  private apiUrl = environment.apiUrl + '/v1/menus';

  getSidebarMenus(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/sidebar`);
  }
}
