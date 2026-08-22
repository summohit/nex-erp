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
    const response = await apiClient.get('/field-visits/active');
    return response.data;
  },

  getMyVisits: async () => {
    const response = await apiClient.get('/field-visits/me');
    return response.data;
  },

  getProjectVisits: async (projectId: number) => {
    const response = await apiClient.get('/field-visits/project/' + projectId);
    return response.data;
  },

  getVisitById: async (visitId: number) => {
    const response = await apiClient.get('/field-visits/' + visitId);
    return response.data;
  },
};
