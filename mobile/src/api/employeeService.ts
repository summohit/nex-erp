import { apiClient } from './apiClient';

export interface EmployeeBasic {
  id: number;
  firstName: string;
  lastName: string;
  avatarUrl?: string;
  designation?: { id: number; name: string };
  managerId?: number;
}

export interface Department { id: number; name: string; }
export interface Designation { id: number; name: string; }
export interface Branch { id: number; name: string; address?: string; }
export interface EmergencyContact { id: number; name: string; email?: string; mobile: string; relationship: string; }
export interface EmployeeDocument { id: number; fileName: string; fileUrl: string; documentType: string; createdAt: string; }
export interface ResumeLine { id: number; type: 'Experience' | 'Education' | 'Certification'; title: string; organization: string; startDate?: string; endDate?: string; description?: string; attachmentUrl?: string; }
export interface SkillItem { id: number; category: string; name: string; level: string; }

export interface EmployeeProfile {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  designation?: {
    name: string;
  };
  department?: {
    name: string;
  };
  avatarUrl?: string;
}

export const employeeService = {
  getMyProfile: async (): Promise<EmployeeProfile> => {
    const response = await apiClient.get('/employees/me/profile');
    return response.data;
  },
  getProfile: async (id: number | string) => {
    const response = await apiClient.get(`/employees/${id}/profile`);
    return response.data;
  },
  updateProfile: async (id: number, data: any) => {
    const response = await apiClient.put(`/employees/${id}/profile`, data);
    return response.data;
  },
  getBasicList: async (): Promise<EmployeeBasic[]> => {
    const response = await apiClient.get('/employees/basic-list');
    return response.data;
  },
  addContact: async (empId: number, data: any) => {
    const response = await apiClient.post(`/employees/${empId}/contacts`, data);
    return response.data;
  },
  deleteContact: async (empId: number, contactId: number) => {
    const response = await apiClient.delete(`/employees/${empId}/contacts/${contactId}`);
    return response.data;
  },
  addDocument: async (empId: number, data: any) => {
    const response = await apiClient.post(`/employees/${empId}/documents`, data);
    return response.data;
  },
  deleteDocument: async (empId: number, docId: number) => {
    const response = await apiClient.delete(`/employees/${empId}/documents/${docId}`);
    return response.data;
  },
  addSkill: async (empId: number, data: { category: string; name: string; level: string }): Promise<SkillItem> => {
    const response = await apiClient.post(`/employees/${empId}/skills`, data);
    return response.data;
  },
  updateSkill: async (empId: number, skillId: number, data: { category: string; name: string; level: string }): Promise<SkillItem> => {
    const response = await apiClient.put(`/employees/${empId}/skills/${skillId}`, data);
    return response.data;
  },
  deleteSkill: async (empId: number, skillId: number) => {
    const response = await apiClient.delete(`/employees/${empId}/skills/${skillId}`);
    return response.data;
  },
  addResumeLine: async (empId: number, data: Omit<ResumeLine, 'id'>): Promise<ResumeLine> => {
    const response = await apiClient.post(`/employees/${empId}/resume-lines`, data);
    return response.data;
  },
  updateResumeLine: async (empId: number, lineId: number, data: Omit<ResumeLine, 'id'>): Promise<ResumeLine> => {
    const response = await apiClient.put(`/employees/${empId}/resume-lines/${lineId}`, data);
    return response.data;
  },
  deleteResumeLine: async (empId: number, lineId: number) => {
    const response = await apiClient.delete(`/employees/${empId}/resume-lines/${lineId}`);
    return response.data;
  },
  uploadFile: async (formData: FormData) => {
    const response = await apiClient.post('/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },
  uploadResume: async (formData: FormData) => {
    const response = await apiClient.post('/upload/resume', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },
  getDepartments: async (): Promise<Department[]> => {
    const response = await apiClient.get('/master-data/departments');
    return response.data;
  },
  getDesignations: async (): Promise<Designation[]> => {
    const response = await apiClient.get('/master-data/designations');
    return response.data;
  },
  getBranches: async (): Promise<Branch[]> => {
    const response = await apiClient.get('/master-data/branches');
    return response.data;
  },
};
