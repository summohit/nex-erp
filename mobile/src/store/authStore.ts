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
    // Drop anything the previous session left in memory before the new user's
    // screens mount, so they never render stale data belonging to someone else.
    const { resetUserScopedStores } = await import('./resetStores');
    resetUserScopedStores();
    await AsyncStorage.setItem('userToken', token);
    await AsyncStorage.setItem('userData', JSON.stringify(user));
    set({ user, token, isLoading: false });
  },
  logout: async () => {
    await AsyncStorage.removeItem('userToken');
    await AsyncStorage.removeItem('userData');
    await AsyncStorage.removeItem('companyData');
    set({ user: null, company: null, token: null, isLoading: false });
    // Clear the other stores too — they are in-memory singletons that would
    // otherwise hand the next user to sign in the previous user's data.
    // Imported lazily so this module stays free of store import cycles.
    const { resetUserScopedStores } = await import('./resetStores');
    resetUserScopedStores();
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
