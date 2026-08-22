import { apiClient } from './apiClient';

export const usersService = {
  getMe: async (): Promise<any> => {
    const response = await apiClient.get('/users/me');
    return response.data;
  },

  getSidebarMenus: async (): Promise<any[]> => {
    const response = await apiClient.get('/menus/sidebar');
    return response.data;
  },
};
