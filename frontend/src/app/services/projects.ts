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

  /**
   * @param name optional name to store it under. The server keeps the real
   *   extension whatever this says, so the rule lives in exactly one place.
   */
  uploadProjectDocument(projectId: number, file: File, name?: string) {
    const formData = new FormData();
    formData.append('file', file);
    if (name?.trim()) formData.append('name', name.trim());
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

  /**
   * Attach one or more files to a task (§2).
   *
   * Several files go up in one request under `files`; the server still accepts
   * a lone `file` for anything not yet updated. A single upload answers with
   * the attachment itself, a batch with an array.
   */
  uploadAttachment(
    projectId: number,
    issueId: number,
    file: File | File[],
    names?: string[],
  ) {
    const formData = new FormData();
    const list = Array.isArray(file) ? file : [file];
    for (const f of list) formData.append('files', f);
    // §2: positional, one per file. Always appended when names are given, so
    // an untouched file keeps its own name by sending an empty string rather
    // than shifting every later name up a slot.
    if (names) for (const n of names) formData.append('names', n ?? '');
    return this.http.post<any>(`${this.apiUrl}/${projectId}/issues/${issueId}/attachments/upload`, formData);
  }

  /** §2: rename a task attachment. The stored file is not touched. */
  renameAttachment(projectId: number, issueId: number, attachmentId: number, name: string) {
    return this.http.patch<any>(
      `${this.apiUrl}/${projectId}/issues/${issueId}/attachments/${attachmentId}`,
      { name },
    );
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

  /**
   * Lead contacts for the project form's Client field (§4).
   *
   * A CRM endpoint reached from here because the project form is its only
   * caller and there is no CRM service to hang it on — the CRM screens talk to
   * HttpClient directly. The dedicated /options route returns identity only
   * and is not scoped to contacts the viewer personally added, which the CRM
   * board's own list is.
   */
  getLeadContactOptions() {
    return this.http.get<LeadContactOption[]>(
      `${environment.apiUrl}/crm/lead-contacts/options`
    );
  }

  // ── Project documents (§6) ────────────────────────────────────────────
  // Project-level files — scope, proposal, agreement — as distinct from the
  // attachments that belong to an individual task.

  // Upload is uploadProjectDocument() further up — it predates this block,
  // having been written for the AI onboarding wizard, and is the same endpoint.
  getProjectDocuments(projectId: number) {
    return this.http.get<ProjectDocument[]>(`${this.apiUrl}/${projectId}/documents`);
  }

  /** The server keeps the original extension whatever `name` contains. */
  renameProjectDocument(projectId: number, documentId: number, name: string) {
    return this.http.patch<ProjectDocument>(`${this.apiUrl}/${projectId}/documents/${documentId}`, { name });
  }

  deleteProjectDocument(projectId: number, documentId: number) {
    return this.http.delete<{ success: boolean }>(`${this.apiUrl}/${projectId}/documents/${documentId}`);
  }

  // ── Milestones (§13) ──────────────────────────────────────────────────
  // The list response carries `canViewFinancials` and `canManage` alongside
  // the rows: the server decides both, and the UI reads its answer rather than
  // re-deriving one from the user's role and getting a different result.

  getMilestones(projectId: number) {
    return this.http.get<MilestoneList>(`${this.apiUrl}/${projectId}/milestones`);
  }

  createMilestone(projectId: number, data: Partial<Milestone>) {
    return this.http.post<Milestone>(`${this.apiUrl}/${projectId}/milestones`, data);
  }

  updateMilestone(projectId: number, milestoneId: number, data: Partial<Milestone>) {
    return this.http.put<Milestone>(`${this.apiUrl}/${projectId}/milestones/${milestoneId}`, data);
  }

  deleteMilestone(projectId: number, milestoneId: number) {
    return this.http.delete<{ success: boolean }>(`${this.apiUrl}/${projectId}/milestones/${milestoneId}`);
  }

  reorderMilestones(projectId: number, orderedIds: number[]) {
    return this.http.put<{ success: boolean }>(`${this.apiUrl}/${projectId}/milestones/reorder`, { orderedIds });
  }
}

export interface ProjectDocument {
  id: number;
  name: string;
  url: string;
  type: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  employee?: { id: number; firstName: string; lastName: string; avatarUrl?: string | null } | null;
}

export interface LeadContactOption {
  id: number;
  name: string;
  companyName?: string | null;
  email?: string | null;
  contactCode?: string | null;
}

export interface Milestone {
  id: number;
  projectId: number;
  name: string;
  description?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  status: 'PENDING' | 'IN_PROGRESS' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED';
  completedAt?: string | null;
  ownerId?: number | null;
  owner?: { id: number; firstName: string; lastName: string; avatarUrl?: string | null } | null;
  position: number;
  taskTotal: number;
  taskDone: number;
  progress: number;
  /** Absent entirely when the viewer may not see the project's money. */
  amount?: number | null;
  percentage?: number | null;
}

export interface MilestoneList {
  milestones: Milestone[];
  /** Null for a viewer who may not see money — not a zeroed object. */
  totals: { milestoneValue: number; budgetAmount: number | null; unallocated: number | null } | null;
  canManage: boolean;
  canViewFinancials: boolean;
  currency: string;
}
