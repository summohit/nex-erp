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
};
