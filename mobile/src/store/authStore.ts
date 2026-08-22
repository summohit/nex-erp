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

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (user: User, token: string) => Promise<void>;
  logout: () => Promise<void>;
  restoreToken: () => Promise<void>;
  refreshUserProfile: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
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
    set({ user: null, token: null, isLoading: false });
  },
  restoreToken: async () => {
    try {
      const token = await AsyncStorage.getItem('userToken');
      const userData = await AsyncStorage.getItem('userData');
      if (token && userData) {
        set({ token, user: JSON.parse(userData), isLoading: false });
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
    } catch (e) {
      // Non-fatal: permission checks fall back to safe defaults if isManager is undefined
    }
  },
}));
