import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
  ViewChild,
  ViewEncapsulation,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  LucideAlertCircle,
  LucideBuilding2,
  LucideCrosshair,
  LucideExternalLink,
  LucideInfo,
  LucideLoader2,
  LucideMapPin,
  LucideNavigation,
  LucideSearch,
  LucideX,
} from '@lucide/angular';
import { HotToastService } from '@ngneat/hot-toast';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Observable } from 'rxjs';
import { MasterDataService, VisitLocation } from '../../../services/master-data.service';
import { ProjectsService, LeadContactOption } from '../../../services/projects';
import {
  VisitLocationRequestInput,
  VisitLocationRequestsService,
} from '../../../services/visit-location-requests.service';
import {
  SearchableSelectComponent,
  SearchableSelectOption,
} from '../searchable-select/searchable-select.component';

export type VisitLocationSubmissionMode = 'direct' | 'request';

@Component({
  selector: 'app-visit-location-form-modal',
  standalone: true,
  encapsulation: ViewEncapsulation.None,
  imports: [
    CommonModule,
    FormsModule,
    SearchableSelectComponent,
    LucideAlertCircle,
    LucideBuilding2,
    LucideCrosshair,
    LucideExternalLink,
    LucideInfo,
    LucideLoader2,
    LucideMapPin,
    LucideNavigation,
    LucideSearch,
    LucideX,
  ],
  templateUrl: './visit-location-form-modal.html',
  styleUrls: ['./visit-location-form-modal.css'],
})
export class VisitLocationFormModalComponent implements OnInit, AfterViewInit, OnDestroy {
  @Input() submissionMode: VisitLocationSubmissionMode = 'direct';
  @Input() location: VisitLocation | null = null;
  @Output() saved = new EventEmitter<void>();
  @Output() closed = new EventEmitter<void>();

  @ViewChild('mapContainer') mapContainer?: ElementRef<HTMLDivElement>;

  private masterData = inject(MasterDataService);
  private projects = inject(ProjectsService);
  private requests = inject(VisitLocationRequestsService);
  private toast = inject(HotToastService);
  private sanitizer = inject(DomSanitizer);

  isSaving = signal(false);
  isLocating = signal(false);
  isSearchingMap = signal(false);
  mapSearchText = signal('');
  leadContacts = signal<LeadContactOption[]>([]);
  isLoadingLeadContacts = signal(true);

  form: VisitLocationRequestInput = {
    name: '',
    address: '',
    latitude: null,
    longitude: null,
    leadContactId: null,
    position: 0,
  };

  private map: any = null;
  private marker: any = null;

  leadContactOptions = computed<SearchableSelectOption[]>(() =>
    this.leadContacts().map((contact) => {
      const company = (contact.companyName || '').trim();
      const name = (contact.name || '').trim();
      const details = [contact.email, contact.contactCode ? `#${contact.contactCode}` : ''].filter(
        Boolean,
      );
      return {
        id: contact.id,
        name: company && name ? `${company} — ${name}` : company || name,
        subtitle: details.join(' • ') || undefined,
      };
    }),
  );

  get title(): string {
    if (this.submissionMode === 'request') return 'Request a visit location';
    return this.location ? 'Update Visit Location' : 'Add Visit Location';
  }

  get subtitle(): string {
    return this.submissionMode === 'request'
      ? 'Submit a client site for administrator approval.'
      : 'Create a standardized client site for future field visits.';
  }

  get submitLabel(): string {
    if (this.isSaving()) return 'Saving…';
    if (this.submissionMode === 'request') return 'Submit for approval';
    return this.location ? 'Update location' : 'Add location';
  }

  ngOnInit(): void {
    if (this.location) {
      this.form = {
        name: this.location.name,
        address: this.location.address ?? '',
        latitude: this.location.latitude ?? null,
        longitude: this.location.longitude ?? null,
        leadContactId: this.location.leadContactId ?? null,
        position: this.location.position ?? 0,
      };
    }

    this.isLoadingLeadContacts.set(true);
    this.projects.getLeadContactOptions().subscribe({
      next: (rows) => {
        this.leadContacts.set(rows || []);
        this.isLoadingLeadContacts.set(false);
      },
      error: () => {
        this.leadContacts.set([]);
        this.isLoadingLeadContacts.set(false);
      },
    });
  }

  ngAfterViewInit(): void {
    void this.initMap();
  }

  ngOnDestroy(): void {
    this.destroyMap();
  }

  close(): void {
    if (!this.isSaving()) this.closed.emit();
  }

  isPinned(): boolean {
    return this.numeric(this.form.latitude) !== null && this.numeric(this.form.longitude) !== null;
  }

  isPartiallyPinned(): boolean {
    return (
      (this.numeric(this.form.latitude) !== null) !== (this.numeric(this.form.longitude) !== null)
    );
  }

  onCoordinatesChanged(): void {
    const latitude = this.numeric(this.form.latitude);
    const longitude = this.numeric(this.form.longitude);
    if (latitude == null || longitude == null) return;
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return;
    this.setMarker(latitude, longitude, true);
  }

  clearCoordinates(): void {
    this.form.latitude = null;
    this.form.longitude = null;
    if (this.map && this.marker) this.map.removeLayer(this.marker);
    this.marker = null;
  }

  useMyLocation(): void {
    if (!navigator.geolocation) {
      this.toast.error('Geolocation is not supported by this browser');
      return;
    }
    this.isLocating.set(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latitude = Number(position.coords.latitude.toFixed(6));
        const longitude = Number(position.coords.longitude.toFixed(6));
        this.form.latitude = latitude;
        this.form.longitude = longitude;
        this.setMarker(latitude, longitude, true);
        this.isLocating.set(false);
      },
      () => {
        this.isLocating.set(false);
        this.toast.error('Could not read your current location');
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  searchMapLocation(): void {
    const query = this.mapSearchText().trim();
    if (!query) return;
    this.isSearchingMap.set(true);
    fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`,
      {
        headers: { 'Accept-Language': 'en' },
      },
    )
      .then((response) => response.json())
      .then((rows) => {
        if (!rows?.length) {
          this.toast.error('No matching location found');
          return;
        }
        const latitude = Number(Number(rows[0].lat).toFixed(6));
        const longitude = Number(Number(rows[0].lon).toFixed(6));
        this.form.latitude = latitude;
        this.form.longitude = longitude;
        if (!this.form.address) this.form.address = rows[0].display_name || '';
        this.setMarker(latitude, longitude, true);
      })
      .catch(() => this.toast.error('Could not search the map'))
      .finally(() => this.isSearchingMap.set(false));
  }

  save(): void {
    const name = this.form.name.trim();
    if (!name) {
      this.toast.error('A site needs a name');
      return;
    }

    const latitude = this.numeric(this.form.latitude);
    const longitude = this.numeric(this.form.longitude);
    if ((latitude == null) !== (longitude == null)) {
      this.toast.error('A pin needs both a latitude and a longitude');
      return;
    }
    if (latitude != null && (latitude < -90 || latitude > 90)) {
      this.toast.error('Latitude must be between -90 and 90');
      return;
    }
    if (longitude != null && (longitude < -180 || longitude > 180)) {
      this.toast.error('Longitude must be between -180 and 180');
      return;
    }
    if (latitude == null && !window.confirm('Submit this site without a GPS pin?')) return;

    const payload: VisitLocationRequestInput = {
      name,
      address: this.form.address?.trim() || null,
      latitude,
      longitude,
      leadContactId: this.form.leadContactId == null ? null : Number(this.form.leadContactId),
      position: Number(this.form.position) || 0,
    };

    this.isSaving.set(true);
    const action: Observable<unknown> =
      this.submissionMode === 'request'
        ? this.requests.create(payload)
        : this.location
          ? this.masterData.updateVisitLocation(this.location.id, payload)
          : this.masterData.createVisitLocation(payload);

    action.subscribe({
      next: () => {
        this.isSaving.set(false);
        this.toast.success(
          this.submissionMode === 'request'
            ? 'Location submitted for administrator approval'
            : this.location
              ? 'Visit location updated'
              : 'Visit location added',
        );
        this.saved.emit();
      },
      error: (error) => {
        this.isSaving.set(false);
        this.toast.error(error?.error?.message || 'Could not save the visit location');
      },
    });
  }

  private numeric(value: unknown): number | null {
    if (value == null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  /**
   * True when Leaflet could not be fetched or initialized.
   */
  mapUnavailable = signal(false);

  getFallbackMapUrl(): SafeResourceUrl {
    const lat = this.numeric(this.form.latitude) ?? 28.6139;
    const lng = this.numeric(this.form.longitude) ?? 77.2090;
    // Embeddable OpenStreetMap view centered on coordinates
    const url = `https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.01}%2C${lat - 0.01}%2C${lng + 0.01}%2C${lat + 0.01}&layer=mapnik&marker=${lat}%2C${lng}`;
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  }

  private async initMap(): Promise<void> {
    const leaflet = await this.ensureLeaflet();
    if (!leaflet) {
      this.mapUnavailable.set(true);
      return;
    }

    // Wait a brief tick for modal animation to settle so element has non-zero width & height
    setTimeout(() => {
      const element = this.mapContainer?.nativeElement;
      if (!element || this.map) return;

      try {
        const latitude = this.numeric(this.form.latitude) ?? 28.6139;
        const longitude = this.numeric(this.form.longitude) ?? 77.209;
        const initialZoom = this.isPinned() ? 15 : 12;

        this.map = leaflet.map(element, {
          center: [latitude, longitude],
          zoom: initialZoom,
          zoomControl: true,
          attributionControl: false,
        });

        leaflet
          .tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '© OpenStreetMap contributors',
          })
          .addTo(this.map);

        this.map.on('click', (event: any) => {
          const lat = Number(event.latlng.lat.toFixed(6));
          const lng = Number(event.latlng.lng.toFixed(6));
          this.form.latitude = lat;
          this.form.longitude = lng;
          this.setMarker(lat, lng, false);
          this.reverseGeocode(lat, lng);
        });

        if (this.isPinned()) {
          this.setMarker(latitude, longitude, false);
        }

        // Multiple invalidates to handle quick modal slide-in transitions
        setTimeout(() => this.map?.invalidateSize(), 80);
        setTimeout(() => this.map?.invalidateSize(), 250);
        setTimeout(() => this.map?.invalidateSize(), 600);
      } catch (err) {
        console.warn('Leaflet map initialization fallback:', err);
        this.mapUnavailable.set(true);
      }
    }, 100);
  }

  private setMarker(latitude: number, longitude: number, pan: boolean): void {
    const leaflet = (window as any).L;
    if (!this.map || !leaflet) return;

    const pinIcon = leaflet.divIcon({
      className: 'vlm-custom-pin',
      html: `
        <div style="filter: drop-shadow(0 3px 6px rgba(0,0,0,0.3)); transform: translate(-14px, -34px); cursor: grab;">
          <svg width="28" height="36" viewBox="0 0 24 30" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 9 12 18 12 18s12-9 12-18c0-6.63-5.37-12-12-12z" fill="#2563eb"/>
            <circle cx="12" cy="11" r="4.5" fill="#FFFFFF"/>
          </svg>
        </div>
      `,
      iconSize: [28, 36],
      iconAnchor: [14, 36],
    });

    if (!this.marker) {
      this.marker = leaflet.marker([latitude, longitude], {
        draggable: true,
        icon: pinIcon,
      }).addTo(this.map);

      this.marker.on('dragend', (event: any) => {
        const point = event.target.getLatLng();
        const lat = Number(point.lat.toFixed(6));
        const lng = Number(point.lng.toFixed(6));
        this.form.latitude = lat;
        this.form.longitude = lng;
        this.reverseGeocode(lat, lng);
      });
    } else {
      this.marker.setLatLng([latitude, longitude]);
    }

    if (pan) this.map.setView([latitude, longitude], 15);
  }

  private reverseGeocode(lat: number, lng: number): void {
    if (this.form.address && this.form.address.trim()) return; // Don't overwrite if user already typed
    fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`, {
      headers: { 'Accept-Language': 'en' },
    })
      .then((res) => res.json())
      .then((data) => {
        if (data?.display_name && (!this.form.address || !this.form.address.trim())) {
          this.form.address = data.display_name;
        }
      })
      .catch(() => {});
  }

  private ensureLeaflet(): Promise<any> {
    if ((window as any).L) return Promise.resolve((window as any).L);

    if (!document.getElementById('leaflet-css')) {
      const style = document.createElement('link');
      style.id = 'leaflet-css';
      style.rel = 'stylesheet';
      style.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(style);
    }

    return new Promise((resolve) => {
      const existing = (document.getElementById('leaflet-script') ||
        document.getElementById('leaflet-js')) as HTMLScriptElement | null;
      if (existing) {
        if ((window as any).L) {
          resolve((window as any).L);
        } else {
          existing.addEventListener('load', () => resolve((window as any).L), { once: true });
        }
        return;
      }

      const script = document.createElement('script');
      script.id = 'leaflet-js';
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload = () => resolve((window as any).L);
      script.onerror = () => {
        // Backup CDN if unpkg is blocked
        const backupScript = document.createElement('script');
        backupScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js';
        backupScript.onload = () => resolve((window as any).L);
        backupScript.onerror = () => resolve(null);
        document.head.appendChild(backupScript);
      };
      document.head.appendChild(script);
    });
  }

  private destroyMap(): void {
    if (this.map) {
      try {
        this.map.remove();
      } catch {}
    }
    this.map = null;
    this.marker = null;
  }
}
