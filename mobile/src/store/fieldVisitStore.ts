import { create } from 'zustand';
import Geolocation from 'react-native-geolocation-service';
import { fieldVisitService } from '../api/fieldVisitService';
import { totalRouteDistanceKm, haversineKm } from '../utils/haversine';
import { fieldVisitLocation } from '../native/fieldVisitLocation';

/**
 * Combines the in-memory trail with whatever the native tracker captured
 * while the app was backgrounded, de-duplicating by timestamp (both sides
 * can independently record the "now" point right as tracking starts) and
 * keeping chronological order.
 */
function mergeRoutePoints(current: number[][], incoming: number[][]): number[][] {
  if (incoming.length === 0) return current;
  const seen = new Set(current.map((p) => p[2]));
  const merged = [...current];
  for (const p of incoming) {
    if (!seen.has(p[2])) {
      seen.add(p[2]);
      merged.push(p);
    }
  }
  return merged.sort((a, b) => a[2] - b[2]);
}

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
  /** Drains points the native tracker captured in background and merges them in. */
  syncFromNative: () => Promise<void>;
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
      set((state) => ({
        activeVisit: visit,
        // routePoints lives only in JS memory. If we come back to an active
        // visit with an empty trail (e.g. reopening the app hours later, or
        // a fresh install), reseed it from the visit's own recorded start
        // point as a last-resort floor — syncFromNative below is the real
        // fix, this just guarantees distance is never computed from a route
        // that "forgot" where the trip began if even that comes back empty.
        routePoints:
          visit && state.routePoints.length === 0
            ? [[visit.startLat, visit.startLng, new Date(visit.startTime).getTime()]]
            : state.routePoints,
      }));

      if (visit) {
        // Resume native background tracking if it isn't already running for
        // this visit — covers the OS having killed the tracking service (or
        // the whole process) and not restarting it, and a fresh app install
        // resuming a visit that was started from a different install.
        const alreadyTracking = await fieldVisitLocation.isTracking(visit.id);
        if (!alreadyTracking) {
          fieldVisitLocation.startTracking(visit.id).catch(() => {});
        }
        await get().syncFromNative();
      }
    } catch {
      set({ activeVisit: null });
    }
  },

  syncFromNative: async () => {
    try {
      const points = await fieldVisitLocation.getBufferedPoints();
      if (points.length === 0) return;
      const merged = mergeRoutePoints(get().routePoints, points);
      set({ routePoints: merged, liveDistanceKm: totalRouteDistanceKm(merged) });
    } catch {
      // Native module unavailable or buffer read failed — JS-side state is
      // still whatever it already had, nothing to do.
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
      // Seed first route point immediately for instant UI feedback — the
      // native tracker (armed below) takes over as the real source of truth
      // for everything captured from here on, including while backgrounded.
      const firstPoint = [data.startLat, data.startLng, Date.now()];
      set({
        activeVisit: visit,
        routePoints: [firstPoint],
        liveDistanceKm: 0,
        elapsedSeconds: 0,
        isStarting: false,
      });
      fieldVisitLocation.startTracking(visit.id).catch(() => {});
      return visit;
    } catch (e) {
      set({ isStarting: false });
      throw e;
    }
  },

  endVisit: async (visitId, data) => {
    set({ isEnding: true });
    // Pull in anything the native tracker captured while backgrounded before
    // computing the final distance — this is the trail that actually covers
    // the drive/walk between sites, not just what JS happened to see.
    await get().syncFromNative();
    const { routePoints, elapsedSeconds, activeVisit } = get();
    // Fewer than 2 points means the GPS trail was lost (app killed mid-visit,
    // or ended before the first tracking sample landed) — totalRouteDistanceKm
    // would silently report 0 km for a trip that plainly went somewhere.
    // Fall back to the straight-line distance between the visit's own
    // recorded start and end coordinates instead of lying with a flat zero.
    const distanceKm = routePoints.length >= 2
      ? totalRouteDistanceKm(routePoints)
      : activeVisit
        ? haversineKm(activeVisit.startLat, activeVisit.startLng, data.endLat, data.endLng)
        : 0;
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
        // The list already holds this visit from when it was IN_PROGRESS, so drop
        // that copy before prepending the completed one — otherwise the same id
        // renders twice and React warns about duplicate keys.
        myVisits: [visit, ...get().myVisits.filter((v) => v.id !== visit.id)],
      });
      fieldVisitLocation.stopTracking().catch(() => {});
      fieldVisitLocation.clearBufferedPoints().catch(() => {});
      return visit;
    } catch (e) {
      set({ isEnding: false });
      throw e;
    }
  },

  cancelVisit: async (visitId) => {
    await fieldVisitService.cancelVisit(visitId);
    fieldVisitLocation.stopTracking().catch(() => {});
    fieldVisitLocation.clearBufferedPoints().catch(() => {});
    set({
      activeVisit: null,
      routePoints: [],
      liveDistanceKm: 0,
      elapsedSeconds: 0,
      // Reflect the new status in place so history does not keep showing it as
      // IN_PROGRESS until the next refetch.
      myVisits: get().myVisits.map((v) =>
        v.id === visitId ? { ...v, status: 'CANCELLED' } : v,
      ),
    });
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
