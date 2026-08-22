import { apiClient } from './apiClient';

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

export const projectService = {
  getProjects: async (): Promise<any[]> => {
    const response = await apiClient.get('/projects');
    return response.data;
  },

  updateProject: async (id: number, data: any): Promise<any> => {
    const response = await apiClient.put(`/projects/${id}`, data);
    return response.data;
  },

  getProject: async (id: number): Promise<any> => {
    const response = await apiClient.get(`/projects/${id}`);
    return response.data;
  },

  getProjectSummary: async (id: number): Promise<ProjectSummary> => {
    const response = await apiClient.get(`/projects/${id}/summary`);
    return response.data;
  },

  getBoard: async (projectId: number): Promise<any> => {
    const response = await apiClient.get(`/projects/${projectId}/boards`);
    return response.data;
  },

  getIssues: async (projectId: number): Promise<any[]> => {
    const response = await apiClient.get(`/projects/${projectId}/issues`);
    return response.data;
  },

  createIssue: async (projectId: number, data: any): Promise<any> => {
    const response = await apiClient.post(`/projects/${projectId}/issues`, data);
    return response.data;
  },

  updateIssue: async (projectId: number, issueId: number, data: any): Promise<any> => {
    const response = await apiClient.put(`/projects/${projectId}/issues/${issueId}`, data);
    return response.data;
  },

  getArchivedProjects: async (): Promise<any[]> => {
    const response = await apiClient.get('/projects/archived');
    return response.data;
  },

  toggleProjectStar: async (projectId: number): Promise<void> => {
    await apiClient.put(`/projects/${projectId}/star`);
  },

  archiveProject: async (projectId: number, force: boolean = false): Promise<void> => {
    await apiClient.patch(`/projects/${projectId}/archive`, { force });
  },

  unarchiveProject: async (projectId: number): Promise<void> => {
    await apiClient.patch(`/projects/${projectId}/unarchive`);
  },

  getIssueComments: async (projectId: number, issueId: number): Promise<any[]> => {
    const response = await apiClient.get(`/projects/${projectId}/issues/${issueId}/comments`);
    return response.data;
  },

  getIssueActivities: async (projectId: number, issueId: number): Promise<any[]> => {
    const response = await apiClient.get(`/projects/${projectId}/issues/${issueId}/activities`);
    return response.data;
  },

  addIssueComment: async (projectId: number, issueId: number, content: string): Promise<any> => {
    const response = await apiClient.post(`/projects/${projectId}/issues/${issueId}/comments`, { content });
    return response.data;
  },

  startIssueTimer: async (projectId: number, issueId: number): Promise<void> => {
    await apiClient.post(`/projects/${projectId}/issues/${issueId}/time-start`);
  },

  stopIssueTimer: async (projectId: number, issueId: number): Promise<void> => {
    await apiClient.post(`/projects/${projectId}/issues/${issueId}/time-stop`);
  },

  logIssueTime: async (projectId: number, issueId: number, durationMin: number): Promise<void> => {
    await apiClient.post(`/projects/${projectId}/issues/${issueId}/time-log`, { durationMin });
  },

  // --- Checklists ---
  getChecklists: async (projectId: number, issueId: number): Promise<any[]> => {
    const response = await apiClient.get(`/projects/${projectId}/issues/${issueId}/checklists`);
    return response.data;
  },

  createChecklist: async (projectId: number, issueId: number, title: string): Promise<any> => {
    const response = await apiClient.post(`/projects/${projectId}/issues/${issueId}/checklists`, { title });
    return response.data;
  },

  deleteChecklist: async (projectId: number, issueId: number, checklistId: number): Promise<void> => {
    await apiClient.delete(`/projects/${projectId}/issues/${issueId}/checklists/${checklistId}`);
  },

  addChecklistItem: async (projectId: number, issueId: number, checklistId: number, title: string): Promise<any> => {
    const response = await apiClient.post(`/projects/${projectId}/issues/${issueId}/checklists/${checklistId}/items`, { title });
    return response.data;
  },

  updateChecklistItem: async (projectId: number, issueId: number, checklistId: number, itemId: number, data: { title?: string, isCompleted?: boolean }): Promise<any> => {
    const response = await apiClient.put(`/projects/${projectId}/issues/${issueId}/checklists/${checklistId}/items/${itemId}`, data);
    return response.data;
  },

  deleteChecklistItem: async (projectId: number, issueId: number, checklistId: number, itemId: number): Promise<void> => {
    await apiClient.delete(`/projects/${projectId}/issues/${issueId}/checklists/${checklistId}/items/${itemId}`);
  },

  // --- Members ---
  getCompanyMembers: async (): Promise<any[]> => {
    // There is no specific project ID here, it's global company members accessible under issues route
    const response = await apiClient.get(`/projects/0/issues/company-members`);
    return response.data;
  },

  toggleIssueMember: async (projectId: number, issueId: number, employeeId: number): Promise<void> => {
    await apiClient.post(`/projects/${projectId}/issues/${issueId}/members/toggle`, { employeeId });
  },

  // --- Labels ---
  getProjectLabels: async (projectId: number): Promise<any[]> => {
    const response = await apiClient.get(`/projects/${projectId}/labels`);
    return response.data;
  },

  createLabel: async (projectId: number, name: string, color: string): Promise<any> => {
    const response = await apiClient.post(`/projects/${projectId}/labels`, { name, color });
    return response.data;
  },

  updateLabel: async (projectId: number, labelId: number, name: string, color: string): Promise<any> => {
    const response = await apiClient.put(`/projects/${projectId}/labels/${labelId}`, { name, color });
    return response.data;
  },

  deleteLabel: async (projectId: number, labelId: number): Promise<void> => {
    await apiClient.delete(`/projects/${projectId}/labels/${labelId}`);
  },

  toggleIssueLabel: async (projectId: number, issueId: number, labelId: number): Promise<void> => {
    await apiClient.post(`/projects/${projectId}/issues/${issueId}/labels/${labelId}/toggle`);
  },

  // --- Archive ---
  toggleIssueArchive: async (projectId: number, issueId: number): Promise<void> => {
    await apiClient.put(`/projects/${projectId}/issues/${issueId}/archive`);
  },

  // --- Attachments ---
  uploadAttachment: async (projectId: number, issueId: number, formData: FormData): Promise<any> => {
    const response = await apiClient.post(`/projects/${projectId}/issues/${issueId}/attachments/upload`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  uploadProjectDocument: async (projectId: number, formData: FormData): Promise<any> => {
    const response = await apiClient.post(`/projects/${projectId}/documents`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  deleteAttachment: async (projectId: number, issueId: number, attachmentId: number): Promise<void> => {
    await apiClient.delete(`/projects/${projectId}/issues/${issueId}/attachments/${attachmentId}`);
  },

  toggleCover: async (projectId: number, issueId: number, attachmentId: number): Promise<any> => {
    const response = await apiClient.post(`/projects/${projectId}/issues/${issueId}/attachments/${attachmentId}/toggle-cover`);
    return response.data;
  },

  // --- Review (Approve / Reject) ---
  reviewIssue: async (projectId: number, issueId: number, action: 'APPROVE' | 'REJECT', reason?: string): Promise<any> => {
    const response = await apiClient.post(`/projects/${projectId}/issues/${issueId}/review`, { action, reason });
    return response.data;
  },

  // --- Project Members ---
  addProjectMember: async (projectId: number, employeeId: number, role: string = 'MEMBER'): Promise<any> => {
    const response = await apiClient.post(`/projects/${projectId}/members`, { employeeId, role });
    return response.data;
  },

  removeProjectMember: async (projectId: number, employeeId: number): Promise<void> => {
    await apiClient.delete(`/projects/${projectId}/members/${employeeId}`);
  },
};

