import { create } from 'zustand';
import { attendanceService, AttendanceRecord } from '../api/attendanceService';
import { leaveService, LeaveBalance } from '../api/leaveService';
import { projectService, Project } from '../api/projectService';
import { employeeService, EmployeeProfile } from '../api/employeeService';
import { notificationService, AppNotification } from '../api/notificationService';

import { Platform, PermissionsAndroid } from 'react-native';
import Geolocation from 'react-native-geolocation-service';

interface DashboardState {
  profile: EmployeeProfile | null;
  todayAttendance: AttendanceRecord | null;
  attendanceHistory: AttendanceRecord[];
  isClockingIn: boolean;
  leaveBalances: LeaveBalance[];
  projects: Project[];
  notifications: AppNotification[];
  unreadCount: number;
  isLoading: boolean;
  error: string | null;

  fetchDashboardData: () => Promise<void>;
  clockIn: (lat?: number, lng?: number) => Promise<void>;
  clockOut: (lat?: number, lng?: number) => Promise<void>;
}

const requestLocationPermission = async (): Promise<boolean> => {
  if (Platform.OS === 'ios') {
    Geolocation.requestAuthorization();
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

const getCurrentLocation = (): Promise<{ lat: number; lng: number }> => {
  return new Promise((resolve, reject) => {
    Geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      (error) => {
        reject(error);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
    );
  });
};

export const useDashboardStore = create<DashboardState>((set, get) => ({
  profile: null,
  todayAttendance: null,
  attendanceHistory: [],
  isClockingIn: false,
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

  clockIn: async () => {
    set({ isClockingIn: true });
    try {
      const hasPermission = await requestLocationPermission();
      if (!hasPermission) throw new Error('Location permission is required.');
      const coords = await getCurrentLocation();
      const record = await attendanceService.clockIn(coords.lat, coords.lng);
      set({ todayAttendance: record, isClockingIn: false });
    } catch (error: any) {
      set({ error: error.message || 'Clock in failed', isClockingIn: false });
    }
  },

  clockOut: async () => {
    set({ isClockingIn: true });
    try {
      const hasPermission = await requestLocationPermission();
      if (!hasPermission) throw new Error('Location permission is required.');
      const coords = await getCurrentLocation();
      const record = await attendanceService.clockOut(coords.lat, coords.lng);
      set({ todayAttendance: record, isClockingIn: false });
    } catch (error: any) {
      set({ error: error.message || 'Clock out failed', isClockingIn: false });
    }
  },
}));
