import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  LucideRefreshCw, LucideMapPin, LucideNavigation, LucideClock, LucideRoute, LucideWifiOff, LucideUsers,
  LucideSearch, LucideChevronLeft, LucideChevronRight, LucideX, LucideLocateFixed, LucideFlag, LucideLogIn, LucideLogOut, LucideTimer,
} from '@lucide/angular';
import { TravelAllowanceService, LiveJourney } from '../../services/travel-allowance';

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** How often the page asks for fresh positions (phones send every ~90 s). */
const REFRESH_MS = 30_000;
/** A travelling phone silent for longer than this is shown as quiet, not live. */
const QUIET_AFTER_MIN = 5;

const STAGE: Record<LiveJourney['stage'], { label: string; color: string; bg: string }> = {
  TRAVELLING: { label: 'Travelling', color: '#1373E5', bg: '#EFF6FF' },
  ON_SITE: { label: 'On site', color: '#047857', bg: '#ECFDF5' },
  RETURNING: { label: 'Returning', color: '#B45309', bg: '#FFFBEB' },
  DONE: { label: 'Journey ended', color: '#64748B', bg: '#F1F5F9' },
};

/**
 * Finance and the super admin watch today's Delhi NCR field visit journeys
 * (16 Oct 2026): everyone's latest position on one map, the path each phone
 * recorded, and the site they are heading to. Only journeys exist here —
 * the phone records nothing outside Start journey → End journey.
 */
@Component({
  selector: 'app-live-field-visits',
  standalone: true,
  imports: [
    CommonModule, LucideRefreshCw, LucideMapPin, LucideNavigation, LucideClock, LucideRoute, LucideWifiOff, LucideUsers,
    LucideSearch, LucideChevronLeft, LucideChevronRight, LucideX, LucideLocateFixed, LucideFlag, LucideLogIn, LucideLogOut, LucideTimer,
  ],
  templateUrl: './live-field-visits.html',
  styleUrl: './live-field-visits.css',
})
export class LiveFieldVisitsComponent implements AfterViewInit, OnDestroy {
  private travel = inject(TravelAllowanceService);
  @ViewChild('mapEl') mapEl!: ElementRef<HTMLDivElement>;

  journeys = signal<LiveJourney[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);
  selectedId = signal<number | null>(null);
  updatedAt = signal<Date | null>(null);
  readonly stage = STAGE;
  readonly stages: (LiveJourney['stage'] | 'ALL')[] = ['ALL', 'TRAVELLING', 'ON_SITE', 'RETURNING', 'DONE'];

  /** Filters: the day, a name or site, and the stage. */
  date = signal<string>(ymd(new Date()));
  query = signal('');
  stageFilter = signal<LiveJourney['stage'] | 'ALL'>('ALL');
  isToday = computed(() => this.date() === ymd(new Date()));
  readonly today = ymd(new Date());

  shown = computed(() => {
    const q = this.query().trim().toLowerCase();
    const st = this.stageFilter();
    return this.journeys().filter((j) =>
      (st === 'ALL' || j.stage === st)
      && (!q || `${this.name(j)} ${j.employee.employeeCode ?? ''} ${j.request.location} ${j.request.requestNumber}`.toLowerCase().includes(q)));
  });
  selected = computed(() => this.journeys().find((j) => j.attendanceId === this.selectedId()) ?? null);
  counts = computed(() => {
    const all = this.journeys();
    const by = (s: LiveJourney['stage']) => all.filter((j) => j.stage === s).length;
    return {
      ALL: all.length, TRAVELLING: by('TRAVELLING'), ON_SITE: by('ON_SITE'), RETURNING: by('RETURNING'), DONE: by('DONE'),
      km: Math.round(all.reduce((t, j) => t + (j.trackedKm ?? 0), 0) * 10) / 10,
      quiet: all.filter((j) => this.quiet(j)).length,
    };
  });

  private L: any;
  private map: any;
  private layer: any;
  private timer: any;
  private fitted = false;

  async ngAfterViewInit() {
    try {
      this.L = await this.loadLeaflet();
      this.map = this.L.map(this.mapEl.nativeElement, { zoomControl: true }).setView([28.6139, 77.209], 11);
      this.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '&copy; OpenStreetMap',
      }).addTo(this.map);
      this.layer = this.L.layerGroup().addTo(this.map);
    } catch {
      this.error.set('The map could not load. Check your internet connection.');
    }
    this.refresh();
    this.timer = setInterval(() => { if (this.isToday()) this.refresh(); }, REFRESH_MS);
  }

  ngOnDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.map?.remove();
  }

  refresh() {
    this.travel.live(this.isToday() ? undefined : this.date()).subscribe({
      next: (rows) => {
        this.journeys.set(rows);
        this.loading.set(false);
        this.error.set(null);
        if (this.selectedId() != null && !rows.some((r) => r.attendanceId === this.selectedId())) this.selectedId.set(null);
        this.updatedAt.set(new Date());
        this.draw();
      },
      error: (e) => {
        this.loading.set(false);
        this.error.set(e?.error?.message || 'Could not load journeys.');
      },
    });
  }

  select(j: LiveJourney) {
    this.selectedId.set(this.selectedId() === j.attendanceId ? null : j.attendanceId);
    this.draw();
    const sel = this.selectedId() != null ? j : null;
    if (sel && this.map) {
      const pts = [...sel.route, [sel.request.latitude, sel.request.longitude]];
      if (sel.position) pts.push([sel.position.lat, sel.position.lng]);
      this.map.fitBounds(this.L.latLngBounds(pts), { padding: [50, 50], maxZoom: 16 });
    }
  }

  /** Change the day: today is live, any other day is a look back. */
  setDate(value: string) {
    if (!value || value > ymd(new Date())) return;
    this.date.set(value);
    this.selectedId.set(null);
    this.loading.set(true);
    this.fitted = false;
    this.refresh();
  }

  shiftDay(days: number) {
    const d = new Date(`${this.date()}T00:00:00`);
    d.setDate(d.getDate() + days);
    this.setDate(ymd(d));
  }

  setQuery(v: string) { this.query.set(v); this.draw(); }
  setStage(s: LiveJourney['stage'] | 'ALL') { this.stageFilter.set(s); this.draw(); }

  closeDetail() {
    this.selectedId.set(null);
    this.fitted = false;
    this.draw();
  }

  duration(min?: number | null) {
    if (min == null) return '—';
    return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
  }

  name(j: LiveJourney) {
    return `${j.employee.firstName} ${j.employee.lastName || ''}`.trim();
  }

  initials(j: LiveJourney) {
    return ((j.employee.firstName?.[0] || '') + (j.employee.lastName?.[0] || '')).toUpperCase();
  }

  quiet(j: LiveJourney) {
    return this.isToday() && j.stage !== 'DONE' && (j.lastSeenMinutes ?? 0) > QUIET_AFTER_MIN;
  }

  seen(j: LiveJourney) {
    const m = j.lastSeenMinutes;
    if (m == null) return 'no position yet';
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min ago`;
    return `${Math.floor(m / 60)} h ${m % 60} min ago`;
  }

  private draw() {
    if (!this.map || !this.layer) return;
    const L = this.L;
    this.layer.clearLayers();
    const all: number[][] = [];
    const sel = this.selectedId();
    for (const j of this.shown()) {
      const st = STAGE[j.stage];
      const focus = sel == null || sel === j.attendanceId;
      const opacity = focus ? 0.9 : 0.25;
      if (j.route.length > 1) {
        L.polyline(j.route, { color: st.color, weight: focus ? 5 : 3, opacity }).addTo(this.layer);
      }
      if (j.request.latitude != null) {
        L.circle([j.request.latitude, j.request.longitude], {
          radius: j.request.geofenceRadiusM || 200, color: '#0F172A', weight: 1, fillColor: st.color, fillOpacity: focus ? 0.08 : 0.03,
        }).addTo(this.layer);
        L.marker([j.request.latitude, j.request.longitude], {
          icon: L.divIcon({ className: '', html: `<div class="lfv-site" style="opacity:${focus ? 1 : 0.4}"></div>`, iconSize: [22, 22], iconAnchor: [6, 22] }),
        }).addTo(this.layer).bindTooltip(j.request.location);
        all.push([j.request.latitude, j.request.longitude]);
      }
      if (j.start && focus && sel === j.attendanceId) {
        L.circleMarker([j.start.lat, j.start.lng], { radius: 7, color: '#fff', weight: 3, fillColor: '#10B981', fillOpacity: 1 })
          .addTo(this.layer).bindTooltip('Journey started');
      }
      if (j.end && focus && sel === j.attendanceId) {
        L.circleMarker([j.end.lat, j.end.lng], { radius: 7, color: '#fff', weight: 3, fillColor: '#EF4444', fillOpacity: 1 })
          .addTo(this.layer).bindTooltip('Journey ended');
      }
      if (j.position) {
        const quiet = this.quiet(j);
        const face = j.employee.avatarUrl
          ? `<img src="${j.employee.avatarUrl}" alt="">`
          : `<span>${this.initials(j)}</span>`;
        L.marker([j.position.lat, j.position.lng], {
          icon: L.divIcon({
            className: '',
            html: `<div class="lfv-me ${quiet ? 'quiet' : ''}" style="border-color:${st.color};opacity:${focus ? 1 : 0.5}">${face}</div>`,
            iconSize: [36, 36], iconAnchor: [18, 18],
          }),
          zIndexOffset: focus ? 1000 : 0,
        }).addTo(this.layer)
          .bindTooltip(`${this.name(j)} · ${st.label} · ${this.seen(j)}`)
          .on('click', () => this.select(j));
        all.push([j.position.lat, j.position.lng]);
      }
    }
    if (all.length && !this.fitted) {
      this.map.fitBounds(L.latLngBounds(all), { padding: [50, 50], maxZoom: 14 });
      this.fitted = true;
    }
  }

  private loadLeaflet(): Promise<any> {
    const w = window as any;
    if (w.L) return Promise.resolve(w.L);
    return new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
      document.head.appendChild(css);
      const js = document.createElement('script');
      js.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
      js.onload = () => resolve(w.L);
      js.onerror = () => reject(new Error('Map could not load'));
      document.body.appendChild(js);
    });
  }
}
