import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

export type TravelZone = 'DELHI_NCR' | 'OUTSTATION';
export type TravelKind = 'PER_KM' | 'ACTUAL_FARE';
/** PER_KM: own bike or car. ACTUAL_FARE: metro, bus, auto/cab — they enter what they paid. */
export interface TravelRate { vehicle: string; kind?: TravelKind; ratePerKm: number; receiptRequired?: boolean }
export interface TravelConfig { ncrRadiusKm: number; maxFarePerDay?: number; rates: TravelRate[]; isDefault?: boolean }

/** Field visit travel allowance: rates, the NCR suggestion and journey taps. */
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
