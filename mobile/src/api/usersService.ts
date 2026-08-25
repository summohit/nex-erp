import { apiClient } from './apiClient';

export const usersService = {
  getMe: async (): Promise<any> => {
    const response = await apiClient.get('/users/me');
    return response.data;
  },

  getSidebarMenus: async (): Promise<any[]> => {
    // Backend registers this under a v1 prefix (@Controller('v1/menus')) — the
    // matching web call is environment.apiUrl + '/v1/menus'. This was missing
    // the segment entirely, so every call 404'd, was silently swallowed by
    // menuStore's catch block, and permanently forced the hardcoded
    // StaticMenuFallback for every mobile user — real menu personalization
    // (including Recruitment's real sub-items) never actually loaded.
    const response = await apiClient.get('/v1/menus/sidebar');
    return response.data;
  },
};
