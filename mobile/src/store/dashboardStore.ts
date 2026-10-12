import { create } from 'zustand';
import { attendanceService, AttendanceRecord } from '../api/attendanceService';
import { leaveService, LeaveBalance } from '../api/leaveService';
import { projectService } from '../api/projectService';
import { employeeService, EmployeeProfile } from '../api/employeeService';
import { notificationService, AppNotification } from '../api/notificationService';
import { useTimesheetStore } from './timesheetStore';

import { Platform, PermissionsAndroid } from 'react-native';
import Geolocation from 'react-native-geolocation-service';

interface DashboardState {
  profile: EmployeeProfile | null;
  todayAttendance: AttendanceRecord | null;
  attendanceHistory: AttendanceRecord[];
  isClockingIn: boolean;
  /** The fix the last clock attempt used, reused when it is retried with a reason. */
  lastFix: Fix | null;
  leaveBalances: LeaveBalance[];
  projects: any[];
  notifications: AppNotification[];
  unreadCount: number;
  isLoading: boolean;
  error: string | null;

  fetchDashboardData: () => Promise<void>;
  /** `outsideReason`: the answer to the server's outside-office refusal. */
  clockIn: (outsideReason?: string, useLastFix?: boolean) => Promise<void>;
  clockOut: (lat?: number, lng?: number, reason?: string, outsideReason?: string, useLastFix?: boolean) => Promise<void>;
  markNotificationRead: (id: number) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
}

export const requestLocationPermission = async (): Promise<boolean> => {
  if (Platform.OS === 'ios') {
    Geolocation.requestAuthorization('whenInUse');
    return true; 
  }

  if (Platform.OS === 'android') {
    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        {
          title: 'Location Permission',
          message: 'Nex requires access to your location for accurate attendance records.',
          buttonNeutral: 'Ask Me Later',
          buttonNegative: 'Cancel',
          buttonPositive: 'OK',
        }
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    } catch (err) {
      console.warn(err);
      return false;
    }
  }
  return false;
};

/** A fix from the phone, with how far off it may be (metres). */
export type Fix = { lat: number; lng: number; accuracy: number };

const readPosition = (highAccuracy: boolean): Promise<Fix> =>
  new Promise((resolve, reject) => {
    Geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy ?? 9999 }),
      reject,
      highAccuracy
        ? { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
        : { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  });

/**
 * GPS first, fresh; a network fix only when GPS cannot answer. A cached or
 * tower-based reading put people sitting in the office "12 km away".
 */
export const getCurrentLocation = async (): Promise<Fix> => {
  try {
    return await readPosition(true);
  } catch {
    return readPosition(false);
  }
};

export const useDashboardStore = create<DashboardState>((set, get) => ({
  profile: null,
  todayAttendance: null,
  attendanceHistory: [],
  isClockingIn: false,
  lastFix: null,
  leaveBalances: [],
  projects: [],
  notifications: [],
  unreadCount: 0,
  isLoading: true,
  error: null,

  fetchDashboardData: async () => {
    set({ isLoading: true, error: null });
    try {
      let lastError = null;

      const [
        profile,
        todayAttendance,
        attendanceHistory,
        leaveBalances,
        projects,
        notifications
      ] = await Promise.all([
        employeeService.getMyProfile().catch(e => { lastError = 'Profile: ' + e.message; return null; }),
        attendanceService.getTodayAttendance().catch(e => { lastError = 'Attendance: ' + e.message; return null; }),
        attendanceService.getMyHistory().catch(e => { lastError = 'History: ' + e.message; return []; }),
        leaveService.getMyBalances().catch(e => { lastError = 'Leaves: ' + e.message; return []; }),
        projectService.getProjects().catch(e => { lastError = 'Projects: ' + e.message; return []; }),
        notificationService.getMyNotifications().catch(e => { lastError = 'Notifications: ' + e.message; return []; }),
      ]);

      set({
        profile,
        todayAttendance,
        attendanceHistory,
        leaveBalances,
        projects,
        notifications,
        unreadCount: notifications.filter(n => !n.isRead).length,
        isLoading: false,
        error: lastError
      });
    } catch (error: any) {
      set({ error: error.message || 'Failed to fetch dashboard data', isLoading: false });
    }
  },

  clockIn: async (outsideReason?: string, useLastFix?: boolean) => {
    set({ isClockingIn: true, error: null });
    try {
      const hasPermission = await requestLocationPermission();
      if (!hasPermission) throw new Error('Location permission is required.');
      const coords = get().lastFix && (useLastFix || outsideReason) ? get().lastFix! : await getCurrentLocation();
      set({ lastFix: coords });
      const record = await attendanceService.clockIn(coords.lat, coords.lng, Math.round(coords.accuracy), outsideReason);
      set({ todayAttendance: record, isClockingIn: false });
      useTimesheetStore.getState().fetchData();
    } catch (error: any) {
      const fromServer = error?.response?.data?.message;
      set({ error: fromServer || error.message || 'Clock in failed', isClockingIn: false });
      throw error;
    }
  },

  /**
   * `reason` is passed straight through. The server asks for it — by refusing
   * with LATE_CLOCK_OUT_REASON_REQUIRED — when the session being closed belongs
   * to a previous day; the screen prompts and calls this again with the answer.
   */
  clockOut: async (lat?: number, lng?: number, reason?: string, outsideReason?: string, useLastFix?: boolean) => {
    set({ isClockingIn: true, error: null });
    try {
      const hasPermission = await requestLocationPermission();
      if (!hasPermission) throw new Error('Location permission is required.');
      const coords = get().lastFix && (useLastFix || outsideReason || reason) ? get().lastFix! : await getCurrentLocation();
      set({ lastFix: coords });
      const record = await attendanceService.clockOut(coords.lat, coords.lng, reason, Math.round(coords.accuracy), outsideReason);
      set({ todayAttendance: record, isClockingIn: false });
      useTimesheetStore.getState().fetchData();
    } catch (error: any) {
      // The server's sentence, not axios's "Request failed with status code
      // 400" — these refusals exist to be read.
      const fromServer = error?.response?.data?.message;
      set({ error: fromServer || error.message || 'Clock out failed', isClockingIn: false });
      throw error;
    }
  },

  markNotificationRead: async (id: number) => {
    await notificationService.markAsRead(id);
    set(state => ({
      notifications: state.notifications.map(n => n.id === id ? { ...n, isRead: true } : n),
      unreadCount: Math.max(0, state.unreadCount - 1),
    }));
  },

  markAllNotificationsRead: async () => {
    await notificationService.markAllAsRead();
    set(state => ({
      notifications: state.notifications.map(n => ({ ...n, isRead: true })),
      unreadCount: 0,
    }));
  },
}));
