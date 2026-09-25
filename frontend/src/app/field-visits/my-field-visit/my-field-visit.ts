import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  LucideMapPin, LucideNavigation, LucideClock, LucideCheckCircle,
  LucideAlertTriangle, LucideRefreshCw, LucideCalendarDays,
} from '@lucide/angular';
import {
  FieldVisitAttendanceService, FieldVisitDay,
} from '../../services/field-visit-attendance';

/** Where the browser says we are, and how good it thinks the fix is. */
interface Fix {
  lat: number;
  lng: number;
  accuracyM: number | null;
  at: Date;
}

/**
 * The employee's field visit screen (§5, §6).
 *
 * The distance shown here is a courtesy, not the ruling: the server measures
 * again on every clock, against the radius stored on the request. This screen
 * exists so somebody standing at a site knows whether they are inside it
 * before pressing a button, and knows what to do when they are not.
 */
@Component({
  selector: 'app-my-field-visit',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    LucideMapPin, LucideNavigation, LucideClock, LucideCheckCircle,
    LucideAlertTriangle, LucideRefreshCw, LucideCalendarDays,
  ],
  templateUrl: './my-field-visit.html',
  styleUrls: ['./my-field-visit.css'],
})
export class MyFieldVisitComponent implements OnInit, OnDestroy {
  private api = inject(FieldVisitAttendanceService);

  days = signal<FieldVisitDay[]>([]);
  isLoading = signal(true);
  isWorking = signal(false);
  error = signal<string | null>(null);

  fix = signal<Fix | null>(null);
  locationError = signal<string | null>(null);
  selectedTaskId = signal<number | null>(null);

  private watchId: number | null = null;

  /** One trip a day is the ordinary case; more than one is shown as a list. */
  day = computed(() => this.days()[0] ?? null);

  ngOnInit(): void {
    this.load();
    this.startWatchingLocation();
  }

  ngOnDestroy(): void {
    if (this.watchId != null) navigator.geolocation.clearWatch(this.watchId);
  }

  load(): void {
    this.isLoading.set(true);
    this.api.getToday().subscribe({
      next: (days) => {
        this.days.set(days);
        const current = days[0];
        // Carry forward the task already clocked against, so the screen reads
        // the same after a refresh mid-visit.
        this.selectedTaskId.set(current?.issue?.id ?? current?.tasks?.[0]?.id ?? null);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.error.set(this.messageOf(err));
        this.isLoading.set(false);
      },
    });
  }

  // ─── Where we are ──────────────────────────────────────────────────────────

  private startWatchingLocation(): void {
    if (!navigator.geolocation) {
      this.locationError.set('This browser cannot report your location.');
      return;
    }
    // watchPosition rather than a single read: somebody walks the last hundred
    // metres to a site, and the screen should follow them in rather than make
    // them guess when to press refresh.
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        this.locationError.set(null);
        this.fix.set({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyM: pos.coords.accuracy ?? null,
          at: new Date(),
        });
      },
      (err) => this.locationError.set(
        err.code === err.PERMISSION_DENIED
          ? 'Location is switched off for this site. Turn it on to clock in or out.'
          : 'Could not read your location. Move somewhere with a clearer signal.',
      ),
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 },
    );
  }

  refreshLocation(): void {
    if (this.watchId != null) navigator.geolocation.clearWatch(this.watchId);
    this.startWatchingLocation();
  }

  /** Metres between the current fix and the approved site, or null. */
  distanceM = computed<number | null>(() => {
    const here = this.fix();
    const site = this.day()?.request;
    if (!here || !site) return null;
    return Math.round(haversineM(site.latitude, site.longitude, here.lat, here.lng));
  });

  radiusM = computed(() => this.day()?.request.geofenceRadiusM ?? 500);

  withinSite = computed(() => {
    const d = this.distanceM();
    return d != null && d <= this.radiusM();
  });

  spokenDistance = computed(() => {
    const d = this.distanceM();
    if (d == null) return null;
    return d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${d} m`;
  });

  // ─── Clocking ──────────────────────────────────────────────────────────────

  canClockIn = computed(() => {
    const day = this.day();
    if (!day || day.clockInTime) return false;
    if (day.tasks.length > 0 && this.selectedTaskId() == null) return false;
    return this.withinSite() && !this.isWorking();
  });

  canClockOut = computed(() => {
    const day = this.day();
    if (!day || !day.clockInTime || day.clockOutTime) return false;
    return this.withinSite() && !this.isWorking();
  });

  clockIn(): void {
    const day = this.day();
    const here = this.fix();
    if (!day || !here) return;

    this.isWorking.set(true);
    this.error.set(null);
    this.api.clockIn({
      requestId: day.request.id,
      issueId: this.selectedTaskId() ?? undefined,
      lat: here.lat,
      lng: here.lng,
    }).subscribe({
      next: () => { this.isWorking.set(false); this.load(); },
      error: (err) => { this.error.set(this.messageOf(err)); this.isWorking.set(false); },
    });
  }

  clockOut(): void {
    const day = this.day();
    const here = this.fix();
    if (!day || !here) return;

    this.isWorking.set(true);
    this.error.set(null);
    this.api.clockOut({
      requestId: day.request.id,
      lat: here.lat,
      lng: here.lng,
    }).subscribe({
      next: () => { this.isWorking.set(false); this.load(); },
      error: (err) => { this.error.set(this.messageOf(err)); this.isWorking.set(false); },
    });
  }

  selectTask(id: number): void {
    this.selectedTaskId.set(id);
  }

  /**
   * The server's own words where there are any.
   *
   * Its refusals are the useful ones here — how far outside the radius you
   * are, which trip you are on, why the day cannot be clocked — and replacing
   * them with "Something went wrong" throws away the only actionable part.
   */
  private messageOf(err: any): string {
    const message = err?.error?.message;
    if (Array.isArray(message)) return message.join(', ');
    return message || 'Could not reach the server. Try again in a moment.';
  }
}

/** Metres between two points, on the same earth radius the server uses. */
function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
