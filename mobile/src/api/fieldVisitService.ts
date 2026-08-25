import { apiClient } from './apiClient';

export const fieldVisitService = {
  startVisit: async (data: {
    projectId: number;
    startLat: number;
    startLng: number;
    startAddress?: string;
    purpose?: string;
  }) => {
    const response = await apiClient.post('/field-visits/start', data);
    return response.data;
  },

  endVisit: async (visitId: number, data: {
    endLat: number;
    endLng: number;
    endAddress?: string;
    distanceKm: number;
    durationMins: number;
    routePoints?: number[][];
    notes?: string;
  }) => {
    const response = await apiClient.post('/field-visits/' + visitId + '/end', data);
    return response.data;
  },

  cancelVisit: async (visitId: number) => {
    const response = await apiClient.post('/field-visits/' + visitId + '/cancel');
    return response.data;
  },

  addPhoto: async (visitId: number, data: {
    url: string;
    takenAt: string;
    caption?: string;
  }) => {
    const response = await apiClient.post('/field-visits/' + visitId + '/photos', data);
    return response.data;
  },

  uploadVisitPhoto: async (formData: FormData) => {
    const response = await apiClient.post('/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  getActiveVisit: async () => {
    try {
      const response = await apiClient.get('/field-visits/active');
      // Handle nested response or direct data
      return response.data?.visit || response.data || null;
    } catch (e: any) {
      if (e?.response?.status === 404) return null; // No active visit
      throw e;
    }
  },

  getMyVisits: async () => {
    try {
      const response = await apiClient.get('/field-visits/me');
      // Handle both array response and nested structure
      const data = response.data?.visits || response.data || [];
      return Array.isArray(data) ? data : [data].filter(Boolean);
    } catch (e) {
      return [];
    }
  },

  getProjectVisits: async (projectId: number) => {
    try {
      const response = await apiClient.get('/field-visits/project/' + projectId);
      const data = response.data?.visits || response.data || [];
      return Array.isArray(data) ? data : [data].filter(Boolean);
    } catch (e) {
      return [];
    }
  },

  getVisitById: async (visitId: number) => {
    const response = await apiClient.get('/field-visits/' + visitId);
    return response.data;
  },
};
