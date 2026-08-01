import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class ProjectsService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/projects`;

  getProjects() {
    return this.http.get<any[]>(this.apiUrl);
  }

  getProject(id: number) {
    return this.http.get<any>(`${this.apiUrl}/${id}`);
  }

  createProject(data: any) {
    return this.http.post<any>(this.apiUrl, data);
  }

  getIssues(projectId: number) {
    return this.http.get<any[]>(`${this.apiUrl}/${projectId}/issues`);
  }

  createIssue(projectId: number, data: any) {
    return this.http.post<any>(`${this.apiUrl}/${projectId}/issues`, data);
  }

  updateIssue(projectId: number, issueId: number, data: any) {
    return this.http.put<any>(`${this.apiUrl}/${projectId}/issues/${issueId}`, data);
  }

  startTime(projectId: number, issueId: number) {
    return this.http.post<any>(`${this.apiUrl}/${projectId}/issues/${issueId}/time-start`, {});
  }

  stopTime(projectId: number, issueId: number) {
    return this.http.post<any>(`${this.apiUrl}/${projectId}/issues/${issueId}/time-stop`, {});
  }

  getBoard(projectId: number) {
    return this.http.get<any>(`${this.apiUrl}/${projectId}/boards`);
  }
}
