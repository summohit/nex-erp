import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

export type TravelZone = 'DELHI_NCR' | 'OUTSTATION';
export type TravelKind = 'PER_KM' | 'ACTUAL_FARE';
/** PER_KM: own bike or car. ACTUAL_FARE: metro, bus, auto/cab — they enter what they paid. */
export interface TravelRate { vehicle: string; kind?: TravelKind; ratePerKm: number; receiptRequired?: boolean }
export interface TravelConfig {
  ncrRadiusKm: number; maxFarePerDay?: number;
  /** Used only when a person's grade (or interns) has no per-km rate. */
  defaultRatePerKm?: number;
  /** Signed-in employee's resolved salary grade label (e.g. "G3", "Intern", "Standard"). */
  myGrade?: string;
  /** Signed-in employee's effective per-km rate from their salary grade. */
  myRatePerKm?: number;
  rates: TravelRate[]; isDefault?: boolean;
}

/** Field visit travel allowance: rates, the NCR suggestion and journey taps. */
export interface LiveJourney {
  attendanceId: number;
  stage: 'TRAVELLING' | 'ON_SITE' | 'RETURNING' | 'DONE';
  employee: { id: number; firstName: string; lastName?: string | null; avatarUrl?: string | null; employeeCode?: string | null; designation?: { name: string } | null; department?: { name: string } | null };
  request: { id: number; requestNumber: string; location: string; latitude: number; longitude: number; geofenceRadiusM: number };
  startedAt: string | null;
  endedAt: string | null;
  clockInTime: string | null;
  clockOutTime: string | null;
  trackedKm: number | null;
  start: { lat: number; lng: number } | null;
  end: { lat: number; lng: number } | null;
  position: { lat: number; lng: number } | null;
  lastSeenAt: string | null;
  lastSeenMinutes: number | null;
  toSiteKm: number | null;
  clockInDistanceKm?: number | null;
  durationMinutes?: number | null;
  /** Longest stretch with no recorded points (over 15 min): the route is incomplete there. */
  gap?: { from: string; to: string; minutes: number } | null;
  route: number[][];
}

@Injectable({ providedIn: 'root' })
export class TravelAllowanceService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/travel-allowance`;

  getSettings() {
    return this.http.get<TravelConfig>(`${this.apiUrl}/settings`);
  }

  /** Super admin only. */
  saveSettings(config: TravelConfig) {
    return this.http.put<TravelConfig>(`${this.apiUrl}/settings`, config);
  }

  suggestZone(lat: number, lng: number) {
    return this.http.get<{ zone: TravelZone | null; distanceKm: number | null; ncrRadiusKm: number }>(
      `${this.apiUrl}/zone?lat=${lat}&lng=${lng}`,
    );
  }

  /** The recorded route behind a travel claim. */
  /** Finance / super admin: today's Delhi NCR journeys with live positions. */
  live(date?: string) {
    return this.http.get<LiveJourney[]>(`${this.apiUrl}/live${date ? `?date=${date}` : ''}`);
  }

  claimRoute(claimId: number) {
    return this.http.get<ClaimRoute>(`${this.apiUrl}/claims/${claimId}/route`);
  }

  startJourney(body: { requestId: number; lat: number; lng: number; vehicle?: string }) {
    return this.http.post(`${this.apiUrl}/journey/start`, body);
  }

  endJourney(body: { requestId: number; lat: number; lng: number; fare?: number; receiptUrl?: string }) {
    return this.http.post(`${this.apiUrl}/journey/end`, body);
  }
}

export interface ClaimRoute {
  site: { name: string; lat: number; lng: number };
  days: {
    date: string; vehicle: string | null; trackedKm: number | null;
    start: { lat: number; lng: number } | null; end: { lat: number; lng: number } | null;
    route: number[][];
  }[];
}
