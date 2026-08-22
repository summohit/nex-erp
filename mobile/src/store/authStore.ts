import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { usersService } from '../api/usersService';

interface User {
  id: number;
  email: string;
  role: string;
  companyId: number;
  employeeId?: number;
  isManager?: boolean;
}

export interface CompanyInfo {
  id: number;
  name: string;
  logoUrl?: string | null;
}

interface AuthState {
  user: User | null;
  company: CompanyInfo | null;
  token: string | null;
  isLoading: boolean;
  login: (user: User, token: string) => Promise<void>;
  logout: () => Promise<void>;
  restoreToken: () => Promise<void>;
  refreshUserProfile: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  company: null,
  token: null,
  isLoading: true,
  login: async (user, token) => {
    await AsyncStorage.setItem('userToken', token);
    await AsyncStorage.setItem('userData', JSON.stringify(user));
    set({ user, token, isLoading: false });
  },
  logout: async () => {
    await AsyncStorage.removeItem('userToken');
    await AsyncStorage.removeItem('userData');
    await AsyncStorage.removeItem('companyData');
    set({ user: null, company: null, token: null, isLoading: false });
  },
  restoreToken: async () => {
    try {
      const token = await AsyncStorage.getItem('userToken');
      const userData = await AsyncStorage.getItem('userData');
      const companyData = await AsyncStorage.getItem('companyData');
      if (token && userData) {
        set({
          token,
          user: JSON.parse(userData),
          company: companyData ? JSON.parse(companyData) : null,
          isLoading: false,
        });
      } else {
        set({ isLoading: false });
      }
    } catch (e) {
      set({ isLoading: false });
    }
  },
  refreshUserProfile: async () => {
    try {
      const data = await usersService.getMe();
      const current = get().user;
      if (!current) return;
      const updated: User = { ...current, isManager: !!data?.isManager };
      set({ user: updated });
      await AsyncStorage.setItem('userData', JSON.stringify(updated));

      // Persist company info so it survives app restarts
      if (data?.company) {
        const company: CompanyInfo = {
          id: data.company.id,
          name: data.company.name,
          logoUrl: data.company.logoUrl ?? null,
        };
        set({ company });
        await AsyncStorage.setItem('companyData', JSON.stringify(company));
      }
    } catch (e) {
      // Non-fatal
    }
  },
}));
