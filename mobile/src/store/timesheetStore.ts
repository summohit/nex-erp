import { create } from 'zustand';
import { attendanceService, AttendanceRecord } from '../api/attendanceService';
import { leaveService, LeaveRequest } from '../api/leaveService';

interface TimesheetState {
  attendanceHistory: AttendanceRecord[];
  regularizations: any[];
  holidays: any[];
  leaveRequests: LeaveRequest[];
  currentMonth: Date;
  isLoading: boolean;
  error: string | null;
  fetchData: () => Promise<void>;
  changeMonth: (date: Date) => void;
  requestRegularization: (data: { date: string; proposedClockIn?: string; proposedClockOut?: string; reason: string }) => Promise<boolean>;
}

export const useTimesheetStore = create<TimesheetState>((set, get) => ({
  attendanceHistory: [],
  regularizations: [],
  holidays: [],
  leaveRequests: [],
  currentMonth: new Date(),
  isLoading: false,
  error: null,

  fetchData: async () => {
    set({ isLoading: true, error: null });
    try {
      const [history, regs, hols, leaves] = await Promise.allSettled([
        attendanceService.getMyHistory(),
        attendanceService.getMyRegularizations(),
        attendanceService.getHolidays(),
        leaveService.getMyRequests(),
      ]);

      const attendanceHistory = history.status === 'fulfilled' ? history.value : [];
      const regularizations = regs.status === 'fulfilled' ? regs.value : [];
      const holidays = hols.status === 'fulfilled' ? hols.value : [];
      const leaveRequests = leaves.status === 'fulfilled' ? leaves.value : [];

      set({ attendanceHistory, regularizations, holidays, leaveRequests, isLoading: false });
    } catch (error: any) {
      set({ error: error.message || 'Failed to fetch timesheet data', isLoading: false });
    }
  },

  changeMonth: (date: Date) => {
    set({ currentMonth: date });
  },

  requestRegularization: async (data) => {
    set({ isLoading: true, error: null });
    try {
      await attendanceService.requestRegularization(data);
      // Refresh data
      const regs = await attendanceService.getMyRegularizations();
      set({ regularizations: regs, isLoading: false });
      return true;
    } catch (error: any) {
      set({ error: error.message || 'Failed to submit regularization', isLoading: false });
      return false;
    }
  }
}));
