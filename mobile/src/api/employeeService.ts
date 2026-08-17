import { apiClient } from './apiClient';

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
  }
};
