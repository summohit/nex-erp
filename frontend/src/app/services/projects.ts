import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

export interface ProjectSummary {
  metrics: {
    completedLast7Days: number;
    updatedLast7Days: number;
    createdLast7Days: number;
    dueSoonNext7Days: number;
  };
  statusOverview: { status: string; count: number }[];
  teamWorkload: { assigneeId: number; name: string; avatarUrl: string; count: number }[];
  priorityBreakdown: { priority: string; count: number }[];
  recentActivity: any[];
  typeDistribution?: { type: string; count: number }[];
  completionTrends?: { date: string; created: number; completed: number }[];
  timeTracking?: { estimatedHours: number; loggedHours: number };
}

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

  getProjectSummary(id: number) {
    return this.http.get<ProjectSummary>(`${this.apiUrl}/${id}/summary`);
  }

  createProject(data: any) {
    return this.http.post<any>(this.apiUrl, data);
  }

  updateProject(id: number, data: any) {
    return this.http.put<any>(`${this.apiUrl}/${id}`, data);
  }

  createAiProject(data: { name: string, description?: string }) {
    return this.http.post<any>(`${this.apiUrl}/ai-onboarding`, data);
  }

  uploadProjectDocument(projectId: number, file: File) {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<any>(`${this.apiUrl}/${projectId}/documents`, formData);
  }

  analyzeProjectDocuments(projectId: number, payload?: any) {
    return this.http.post<any>(`${this.apiUrl}/${projectId}/analyze`, payload || {});
  }

  getProjectAnalysis(projectId: number) {
    return this.http.get<any>(`${this.apiUrl}/${projectId}/analysis`);
  }

  kickoffProject(projectId: number) {
    return this.http.post<any>(`${this.apiUrl}/${projectId}/kickoff`, {});
  }

  archiveProject(id: number, force: boolean = false) {
    return this.http.patch(`${this.apiUrl}/${id}/archive`, { force });
  }

  getArchivedProjects() {
    return this.http.get<any[]>(`${this.apiUrl}/archived`);
  }

  unarchiveProject(id: number) {
    return this.http.patch(`${this.apiUrl}/${id}/unarchive`, {});
  }

  toggleProjectStar(id: number) {
    return this.http.put<any>(`${this.apiUrl}/${id}/star`, {});
  }

  addProjectMember(id: number, employeeId: number, role: string = 'MEMBER') {
    return this.http.post<any>(`${this.apiUrl}/${id}/members`, { employeeId, role });
  }

  removeProjectMember(id: number, employeeId: number) {
    return this.http.delete<any>(`${this.apiUrl}/${id}/members/${employeeId}`);
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

  reviewIssue(projectId: number, issueId: number, data: { action: 'APPROVE' | 'REJECT', reason?: string }) {
    return this.http.post<any>(`${this.apiUrl}/${projectId}/issues/${issueId}/review`, data);
  }

  getBoard(projectId: number) {
    return this.http.get<any>(`${this.apiUrl}/${projectId}/boards`);
  }

  createBoardColumn(projectId: number, data: { name: string, color?: string }) {
    return this.http.post<any>(`${this.apiUrl}/${projectId}/boards/columns`, data);
  }

  updateBoardColumn(projectId: number, columnId: number, data: { name?: string, color?: string, position?: number }) {
    return this.http.put<any>(`${this.apiUrl}/${projectId}/boards/columns/${columnId}`, data);
  }

  deleteBoardColumn(projectId: number, columnId: number) {
    return this.http.delete(`${this.apiUrl}/${projectId}/boards/columns/${columnId}`);
  }

  getArchivedBoardColumns(projectId: number) {
    return this.http.get<any[]>(`${this.apiUrl}/${projectId}/boards/columns/archived`);
  }

  unarchiveBoardColumn(projectId: number, columnId: number) {
    return this.http.patch(`${this.apiUrl}/${projectId}/boards/columns/${columnId}/unarchive`, {});
  }

  getIssueComments(projectId: number, issueId: number) {
    return this.http.get<any[]>(`${this.apiUrl}/${projectId}/issues/${issueId}/comments`);
  }

  getIssueActivities(projectId: number, issueId: number) {
    return this.http.get<any[]>(`${this.apiUrl}/${projectId}/issues/${issueId}/activities`);
  }

  addIssueComment(projectId: number, issueId: number, body: string) {
    return this.http.post<any>(`${this.apiUrl}/${projectId}/issues/${issueId}/comments`, { body });
  }

  deleteIssueComment(projectId: number, issueId: number, commentId: number) {
    return this.http.delete<any>(`${this.apiUrl}/${projectId}/issues/${issueId}/comments/${commentId}`);
  }

  toggleIssueArchive(projectId: number, issueId: number) {
    return this.http.put<any>(`${this.apiUrl}/${projectId}/issues/${issueId}/archive`, {});
  }

  getChecklists(projectId: number, issueId: number) {
    return this.http.get<any[]>(`${this.apiUrl}/${projectId}/issues/${issueId}/checklists`);
  }

  createChecklist(projectId: number, issueId: number, title: string) {
    return this.http.post<any>(`${this.apiUrl}/${projectId}/issues/${issueId}/checklists`, { title });
  }

  updateChecklist(projectId: number, issueId: number, checklistId: number, title: string) {
    return this.http.put<any>(`${this.apiUrl}/${projectId}/issues/${issueId}/checklists/${checklistId}`, { title });
  }

  deleteChecklist(projectId: number, issueId: number, checklistId: number) {
    return this.http.delete<any>(`${this.apiUrl}/${projectId}/issues/${issueId}/checklists/${checklistId}`);
  }

  addChecklistItem(projectId: number, issueId: number, checklistId: number, title: string) {
    return this.http.post<any>(`${this.apiUrl}/${projectId}/issues/${issueId}/checklists/${checklistId}/items`, { title });
  }

  updateChecklistItem(projectId: number, issueId: number, checklistId: number, itemId: number, data: any) {
    return this.http.put<any>(`${this.apiUrl}/${projectId}/issues/${issueId}/checklists/${checklistId}/items/${itemId}`, data);
  }

  deleteChecklistItem(projectId: number, issueId: number, checklistId: number, itemId: number) {
    return this.http.delete<any>(`${this.apiUrl}/${projectId}/issues/${issueId}/checklists/${checklistId}/items/${itemId}`);
  }

  generateChecklist(projectId: number, issueId: number) {
    return this.http.post<any>(`${this.apiUrl}/${projectId}/issues/${issueId}/checklist/generate`, {});
  }

  getLabels(projectId: number) {
    return this.http.get<any[]>(`${this.apiUrl}/${projectId}/labels`);
  }

  createLabel(projectId: number, name: string, color: string) {
    return this.http.post<any>(`${this.apiUrl}/${projectId}/labels`, { name, color });
  }

  updateLabel(projectId: number, labelId: number, name: string, color: string) {
    return this.http.put<any>(`${this.apiUrl}/${projectId}/labels/${labelId}`, { name, color });
  }

  deleteLabel(projectId: number, labelId: number) {
    return this.http.delete<any>(`${this.apiUrl}/${projectId}/labels/${labelId}`);
  }

  getCompanyMembers(projectId: number) {
    return this.http.get<any[]>(`${this.apiUrl}/${projectId}/issues/company-members`);
  }

  toggleIssueMember(projectId: number, issueId: number, employeeId: number) {
    return this.http.post<any>(`${this.apiUrl}/${projectId}/issues/${issueId}/members/toggle`, { employeeId });
  }

  toggleIssueLabel(projectId: number, issueId: number, labelId: number) {
    return this.http.post<any>(`${this.apiUrl}/${projectId}/issues/${issueId}/labels/${labelId}/toggle`, {});
  }

  uploadAttachment(projectId: number, issueId: number, file: File) {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<any>(`${this.apiUrl}/${projectId}/issues/${issueId}/attachments/upload`, formData);
  }

  addLinkAttachment(projectId: number, issueId: number, linkUrl: string, linkName?: string) {
    return this.http.post<any>(`${this.apiUrl}/${projectId}/issues/${issueId}/attachments/link`, { linkUrl, linkName });
  }

  deleteAttachment(projectId: number, issueId: number, attachmentId: number) {
    return this.http.delete<any>(`${this.apiUrl}/${projectId}/issues/${issueId}/attachments/${attachmentId}`);
  }

  toggleCoverAttachment(projectId: number, issueId: number, attachmentId: number) {
    return this.http.post<any>(`${this.apiUrl}/${projectId}/issues/${issueId}/attachments/${attachmentId}/toggle-cover`, {});
  }

  reorderBoardColumns(projectId: number, columnIds: number[]) {
    return this.http.put<any>(`${this.apiUrl}/${projectId}/boards/columns/reorder`, { columnIds });
  }
}
