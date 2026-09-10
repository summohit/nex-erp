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
  fetchData: (month?: Date) => Promise<void>;
  changeMonth: (date: Date) => Promise<void>;
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

  /**
   * Fetches one month, not the whole history. The grid only ever renders a
   * single month, and pulling everything meant shipping hundreds of rows on
   * every open — the main contributor to the API's data-transfer bill.
   */
  fetchData: async (month?: Date) => {
    const target = month ?? get().currentMonth ?? new Date();
    const from = new Date(target.getFullYear(), target.getMonth(), 1);
    const to = new Date(target.getFullYear(), target.getMonth() + 1, 0);
    const iso = (d: Date) => d.toISOString().slice(0, 10);

    set({ isLoading: true, error: null });
    try {
      const [history, regs, hols, leaves] = await Promise.allSettled([
        attendanceService.getMyHistory(iso(from), iso(to)),
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

  changeMonth: async (date: Date) => {
    // The server now returns only the requested month, so moving months has to
    // refetch rather than filter data that was never downloaded.
    set({ currentMonth: date });
    await get().fetchData(date);
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
