import { create } from 'zustand';
import {
  employeeService,
  EmployeeBasic,
  Department,
  Designation,
  Branch,
} from '../api/employeeService';

interface ProfileState {
  profileData: any | null;
  // Bumped every time profileData is replaced by a fresh fetch (not by local
  // edits). Tabs that keep a local clone of profileData use this to know when
  // they must re-sync from a real reload vs. their own onFormChange echo.
  profileVersion: number;
  isLoading: boolean;
  isSaving: boolean;
  employees: EmployeeBasic[];
  departments: Department[];
  designations: Designation[];
  branches: Branch[];
  activeTab: string;
  fetchProfile: (id: number | string) => Promise<void>;
  saveProfile: (id: number, data: any) => Promise<void>;
  fetchMasterData: () => Promise<void>;
  setActiveTab: (tab: string) => void;
  reset: () => void;
}

const initialState = {
  profileData: null,
  profileVersion: 0,
  isLoading: false,
  isSaving: false,
  employees: [],
  departments: [],
  designations: [],
  branches: [],
  activeTab: 'work',
};

export const useProfileStore = create<ProfileState>((set, get) => ({
  ...initialState,
  
  fetchProfile: async (id: number | string) => {
    set({ isLoading: true });
    try {
      const profileData = await employeeService.getProfile(id);
      set((state) => ({ profileData, profileVersion: state.profileVersion + 1, isLoading: false }));
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  saveProfile: async (id: number, data: any) => {
    set({ isSaving: true });
    try {
      await employeeService.updateProfile(id, data);
      const profileData = await employeeService.getProfile(id);
      set((state) => ({ profileData, profileVersion: state.profileVersion + 1, isSaving: false }));
    } catch (error) {
      set({ isSaving: false });
      throw error;
    }
  },

  fetchMasterData: async () => {
    set({ isLoading: true });
    try {
      const [employees, departments, designations, branches] = await Promise.all([
        employeeService.getBasicList(),
        employeeService.getDepartments(),
        employeeService.getDesignations(),
        employeeService.getBranches(),
      ]);
      set({
        employees,
        departments,
        designations,
        branches,
        isLoading: false,
      });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  setActiveTab: (tab: string) => set({ activeTab: tab }),

  reset: () => set(initialState),
}));
