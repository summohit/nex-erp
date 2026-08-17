import { create } from 'zustand';
import { leaveService, LeaveBalance, LeaveRequest, CreateLeaveRequestDto } from '../api/leaveService';
import { useDashboardStore } from './dashboardStore';

interface LeaveState {
  balances: LeaveBalance[];
  requests: LeaveRequest[];
  isLoading: boolean;
  isSubmitting: boolean;
  error: string | null;

  fetchLeaveData: () => Promise<void>;
  submitLeaveRequest: (data: CreateLeaveRequestDto) => Promise<boolean>;
  cancelLeaveRequest: (requestId: number) => Promise<boolean>;
}

export const useLeaveStore = create<LeaveState>((set, get) => ({
  balances: [],
  requests: [],
  isLoading: true,
  isSubmitting: false,
  error: null,

  fetchLeaveData: async () => {
    set({ isLoading: true, error: null });
    try {
      const [balances, requests] = await Promise.all([
        leaveService.getMyBalances(),
        leaveService.getMyRequests(),
      ]);
      set({ balances, requests, isLoading: false });
      
      // Keep dashboard in sync if it also displays leave balances
      useDashboardStore.setState({ leaveBalances: balances });
    } catch (error: any) {
      set({ error: error.message || 'Failed to fetch leave data', isLoading: false });
    }
  },

  submitLeaveRequest: async (data: CreateLeaveRequestDto) => {
    set({ isSubmitting: true, error: null });
    try {
      await leaveService.requestLeave(data);
      // Re-fetch data after successful submission
      await get().fetchLeaveData();
      set({ isSubmitting: false });
      return true;
    } catch (error: any) {
      set({ error: error.message || 'Failed to submit leave request', isSubmitting: false });
      return false;
    }
  },

  cancelLeaveRequest: async (requestId: number) => {
    set({ isLoading: true, error: null });
    try {
      await leaveService.cancelRequest(requestId);
      await get().fetchLeaveData();
      return true;
    } catch (error: any) {
      set({ error: error.message || 'Failed to cancel leave request', isLoading: false });
      return false;
    }
  }
}));
