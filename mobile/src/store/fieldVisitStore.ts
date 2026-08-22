import { create } from 'zustand';
import Geolocation from 'react-native-geolocation-service';
import { fieldVisitService } from '../api/fieldVisitService';
import { totalRouteDistanceKm } from '../utils/haversine';

export interface FieldVisit {
  id: number;
  projectId: number;
  employeeId: number;
  startTime: string;
  endTime?: string;
  startLat: number;
  startLng: number;
  startAddress?: string;
  endLat?: number;
  endLng?: number;
  endAddress?: string;
  distanceKm?: number;
  durationMins?: number;
  routePoints?: number[][];
  status: 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  purpose?: string;
  notes?: string;
  project?: { id: number; name: string; key: string; color: string };
  employee?: { id: number; firstName: string; lastName: string; avatarUrl?: string };
  photos?: { id: number; url: string; takenAt: string; caption?: string }[];
}

interface FieldVisitState {
  activeVisit: FieldVisit | null;
  myVisits: FieldVisit[];
  projectVisits: FieldVisit[];
  isLoading: boolean;
  isStarting: boolean;
  isEnding: boolean;
  // Live tracking state
  routePoints: number[][];   // [[lat, lng, unixMs], ...]
  liveDistanceKm: number;
  elapsedSeconds: number;
  // Actions
  fetchActiveVisit: () => Promise<void>;
  fetchMyVisits: () => Promise<void>;
  fetchProjectVisits: (projectId: number) => Promise<void>;
  startVisit: (data: { projectId: number; startLat: number; startLng: number; startAddress?: string; purpose?: string }) => Promise<FieldVisit>;
  endVisit: (visitId: number, data: { endLat: number; endLng: number; endAddress?: string; notes?: string }) => Promise<FieldVisit>;
  cancelVisit: (visitId: number) => Promise<void>;
  addRoutePoint: (lat: number, lng: number) => void;
  tickElapsed: () => void;
  clearTracking: () => void;
}

export const useFieldVisitStore = create<FieldVisitState>((set, get) => ({
  activeVisit: null,
  myVisits: [],
  projectVisits: [],
  isLoading: false,
  isStarting: false,
  isEnding: false,
  routePoints: [],
  liveDistanceKm: 0,
  elapsedSeconds: 0,

  fetchActiveVisit: async () => {
    try {
      const visit = await fieldVisitService.getActiveVisit();
      set({ activeVisit: visit });
    } catch {
      set({ activeVisit: null });
    }
  },

  fetchMyVisits: async () => {
    set({ isLoading: true });
    try {
      const visits = await fieldVisitService.getMyVisits();
      set({ myVisits: visits, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  fetchProjectVisits: async (projectId: number) => {
    set({ isLoading: true });
    try {
      const visits = await fieldVisitService.getProjectVisits(projectId);
      set({ projectVisits: visits, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  startVisit: async (data) => {
    set({ isStarting: true });
    try {
      const visit = await fieldVisitService.startVisit(data);
      // Seed first route point
      const firstPoint = [data.startLat, data.startLng, Date.now()];
      set({
        activeVisit: visit,
        routePoints: [firstPoint],
        liveDistanceKm: 0,
        elapsedSeconds: 0,
        isStarting: false,
      });
      return visit;
    } catch (e) {
      set({ isStarting: false });
      throw e;
    }
  },

  endVisit: async (visitId, data) => {
    set({ isEnding: true });
    const { routePoints, elapsedSeconds } = get();
    const distanceKm = totalRouteDistanceKm(routePoints);
    const durationMins = Math.round(elapsedSeconds / 60);
    try {
      const visit = await fieldVisitService.endVisit(visitId, {
        ...data,
        distanceKm,
        durationMins,
        routePoints,
      });
      set({
        activeVisit: null,
        routePoints: [],
        liveDistanceKm: 0,
        elapsedSeconds: 0,
        isEnding: false,
        myVisits: [visit, ...get().myVisits],
      });
      return visit;
    } catch (e) {
      set({ isEnding: false });
      throw e;
    }
  },

  cancelVisit: async (visitId) => {
    await fieldVisitService.cancelVisit(visitId);
    set({ activeVisit: null, routePoints: [], liveDistanceKm: 0, elapsedSeconds: 0 });
  },

  addRoutePoint: (lat, lng) => {
    const points = [...get().routePoints, [lat, lng, Date.now()]];
    const liveDistanceKm = totalRouteDistanceKm(points);
    set({ routePoints: points, liveDistanceKm });
  },

  tickElapsed: () => {
    set((state) => ({ elapsedSeconds: state.elapsedSeconds + 1 }));
  },

  clearTracking: () => {
    set({ routePoints: [], liveDistanceKm: 0, elapsedSeconds: 0, activeVisit: null });
  },
}));
