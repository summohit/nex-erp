import { NativeModules } from 'react-native';

/**
 * JS-facing shape of the native module implemented on both platforms:
 *   android/.../fieldvisit/FieldVisitLocationModule.kt
 *   ios/NexMobileApp/FieldVisitLocation.swift (+ .m bridge)
 *
 * Both sides keep recording GPS points into native storage while the app is
 * backgrounded or the screen is locked — something a plain JS `setInterval`
 * cannot do, since the OS suspends JS timers the moment the app leaves the
 * foreground. `getBufferedPoints` drains what was captured while away.
 */
interface FieldVisitLocationNativeModule {
  startTracking(visitId: number): Promise<boolean>;
  stopTracking(): Promise<boolean>;
  getBufferedPoints(): Promise<number[][]>;
  clearBufferedPoints(): Promise<boolean>;
  isTracking(visitId: number): Promise<boolean>;
}

const native: FieldVisitLocationNativeModule | undefined = NativeModules.FieldVisitLocation;

const noop: FieldVisitLocationNativeModule = {
  startTracking: async () => false,
  stopTracking: async () => false,
  getBufferedPoints: async () => [],
  clearBufferedPoints: async () => false,
  isTracking: async () => false,
};

/**
 * Falls back to no-ops if the native module isn't linked — e.g. a Metro
 * reload before a native rebuild has picked up the new module. Callers can
 * invoke these unconditionally without guarding every call site.
 */
export const fieldVisitLocation: FieldVisitLocationNativeModule = native ?? noop;

export const isFieldVisitLocationAvailable = native != null;
