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
  /**
   * Long-lived token used to mint a new access token when the current one
   * expires. Access tokens last an hour; without this the session died on the
   * hour and the user had to retype their password.
   */
  refreshToken: string | null;
  isLoading: boolean;
  login: (user: User, token: string, refreshToken?: string | null) => Promise<void>;
  /** Swap in a freshly minted token pair. Called by the API client's 401 retry. */
  setTokens: (token: string, refreshToken?: string | null) => Promise<void>;
  logout: () => Promise<void>;
  restoreToken: () => Promise<void>;
  refreshUserProfile: () => Promise<void>;
}

const TOKEN_KEY = 'userToken';
const REFRESH_TOKEN_KEY = 'userRefreshToken';

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  company: null,
  token: null,
  refreshToken: null,
  isLoading: true,
  login: async (user, token, refreshToken) => {
    // Drop anything the previous session left in memory before the new user's
    // screens mount, so they never render stale data belonging to someone else.
    const { resetUserScopedStores } = await import('./resetStores');
    resetUserScopedStores();
    await AsyncStorage.setItem(TOKEN_KEY, token);
    await AsyncStorage.setItem('userData', JSON.stringify(user));
    if (refreshToken) {
      await AsyncStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
    } else {
      // Signing in without one must not leave the previous session's refresh
      // token behind for the interceptor to find.
      await AsyncStorage.removeItem(REFRESH_TOKEN_KEY);
    }
    set({ user, token, refreshToken: refreshToken ?? null, isLoading: false });
  },
  setTokens: async (token, refreshToken) => {
    await AsyncStorage.setItem(TOKEN_KEY, token);
    // The server rotates the refresh token on every refresh, so the new one has
    // to replace the old — reusing a spent token would fail the next refresh.
    if (refreshToken) {
      await AsyncStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
      set({ token, refreshToken });
    } else {
      set({ token });
    }
  },
  logout: async () => {
    await AsyncStorage.removeItem(TOKEN_KEY);
    await AsyncStorage.removeItem(REFRESH_TOKEN_KEY);
    await AsyncStorage.removeItem('userData');
    await AsyncStorage.removeItem('companyData');
    set({ user: null, company: null, token: null, refreshToken: null, isLoading: false });
    // Clear the other stores too — they are in-memory singletons that would
    // otherwise hand the next user to sign in the previous user's data.
    // Imported lazily so this module stays free of store import cycles.
    const { resetUserScopedStores } = await import('./resetStores');
    resetUserScopedStores();
  },
  restoreToken: async () => {
    try {
      const token = await AsyncStorage.getItem(TOKEN_KEY);
      const refreshToken = await AsyncStorage.getItem(REFRESH_TOKEN_KEY);
      const userData = await AsyncStorage.getItem('userData');
      const companyData = await AsyncStorage.getItem('companyData');
      if (token && userData) {
        // An access token that expired while the app was closed is fine — the
        // first request 401s and the interceptor refreshes it in place.
        set({
          token,
          refreshToken,
          user: JSON.parse(userData),
          company: companyData ? JSON.parse(companyData) : null,
          isLoading: false,
        });
      } else {
        set({ isLoading: false });
      }
    } catch {
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
    } catch {
      // Non-fatal
    }
  },
}));
