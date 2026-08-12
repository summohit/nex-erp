import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class ClientsService {
  private http = inject(HttpClient);
  private apiUrl = environment.apiUrl + '/v1/clients';

  getClients(status?: string): Observable<any[]> {
    const params = status ? `?status=${encodeURIComponent(status)}` : '';
    return this.http.get<any[]>(this.apiUrl + params);
  }

  getClient(id: number): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/${id}`);
  }

  createClient(data: any): Observable<any> {
    return this.http.post<any>(this.apiUrl, data);
  }

  updateClient(id: number, data: any): Observable<any> {
    return this.http.patch<any>(`${this.apiUrl}/${id}`, data);
  }

  archiveClient(id: number): Observable<any> {
    return this.http.patch<any>(`${this.apiUrl}/${id}/archive`, {});
  }

  restoreClient(id: number): Observable<any> {
    return this.http.patch<any>(`${this.apiUrl}/${id}/restore`, {});
  }

  deleteClient(id: number): Observable<any> {
    return this.http.delete<any>(`${this.apiUrl}/${id}`);
  }

  addContact(clientId: number, data: any): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/${clientId}/contacts`, data);
  }

  updateContact(clientId: number, contactId: number, data: any): Observable<any> {
    return this.http.patch<any>(`${this.apiUrl}/${clientId}/contacts/${contactId}`, data);
  }

  deleteContact(clientId: number, contactId: number): Observable<any> {
    return this.http.delete<any>(`${this.apiUrl}/${clientId}/contacts/${contactId}`);
  }
}
