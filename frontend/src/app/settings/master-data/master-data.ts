import { Component, inject, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { MasterDataService, Department, Designation, Branch, LeaveType, Holiday, TaskType, ProjectPhase, DefaultProjectTask, VisitLocation } from '../../services/master-data.service';
import { ShiftsService } from '../../services/shifts.service';
import { HotToastService } from '@ngneat/hot-toast';
import { 
  LucidePlus, LucideX, LucideCalendar, LucideList, LucideChevronLeft, LucideChevronRight, 
  LucideClock, LucideSearch, LucideSliders, LucideUsers, LucideCheck, 
  LucideTag, LucideRotateCcw, LucideTimer, LucideMoon,
  LucideMapPin, LucideBuilding2, LucideCrosshair, LucideExternalLink, LucideAlertCircle, LucideNavigation,
  LucideInfo, LucideLoader2
} from '@lucide/angular';
import { AgGridAngular } from 'ag-grid-angular';
import { ColDef, AllCommunityModule, ModuleRegistry, GridOptions, GridApi } from 'ag-grid-community';
import { ActionCellRendererComponent } from '../../shared/components/action-cell-renderer.component';
import { StatusToggleRendererComponent } from '../../shared/components/status-toggle-renderer.component';
import { ProjectsService, LeadContactOption } from '../../services/projects';
import { SearchableSelectComponent, SearchableSelectOption } from '../../shared/components/searchable-select/searchable-select.component';
import { VisitLocationFormModalComponent } from '../../shared/components/visit-location-form-modal/visit-location-form-modal';

ModuleRegistry.registerModules([AllCommunityModule]);

declare const L: any;

type Tab = 'departments' | 'designations' | 'branches' | 'leave-types' | 'task-types' | 'project-phases' | 'default-project-tasks' | 'visit-locations' | 'holidays' | 'blackout-dates' | 'shifts';

/**
 * The tabs a `?tab=` in the URL is allowed to name.
 *
 * The parameter exists so a deep link can land on one tab rather than on
 * whichever happens to be first — the field visit form's "Manage Sites" sends
 * people straight to `visit-locations`. Anything unrecognised is ignored rather
 * than set, so a stale or hand-typed link cannot leave the page showing a tab
 * that does not exist.
 */
const TABS: readonly Tab[] = [
  'departments', 'designations', 'branches', 'leave-types', 'task-types',
  'project-phases', 'default-project-tasks', 'visit-locations', 'holidays',
  'blackout-dates', 'shifts',
];

export interface BlackoutDate {
  id: number;
  reason: string;
  date: string;
  departmentId?: number | null;
}

@Component({
  selector: 'app-master-data',
  standalone: true,
  imports: [
    CommonModule, FormsModule, LucidePlus, LucideX, LucideCalendar, LucideList, 
    LucideChevronLeft, LucideChevronRight, LucideClock, LucideSearch, LucideSliders, 
    LucideUsers, LucideCheck, LucideTag, LucideRotateCcw, 
    LucideTimer, LucideMoon, AgGridAngular,
    LucideMapPin, LucideBuilding2, LucideCrosshair, LucideExternalLink, LucideAlertCircle, LucideNavigation,
    LucideInfo, LucideLoader2,
    SearchableSelectComponent, VisitLocationFormModalComponent
  ],
  templateUrl: './master-data.html',
  styleUrls: ['./master-data.css']
})
export class MasterDataComponent implements OnInit {
  private masterDataService = inject(MasterDataService);
  private projectsService = inject(ProjectsService);
  private shiftsService = inject(ShiftsService);
  private toast = inject(HotToastService);
  private sanitizer = inject(DomSanitizer);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  activeTab = signal<Tab>('departments');
  
  departments = signal<Department[]>([]);
  designations = signal<Designation[]>([]);
  branches = signal<Branch[]>([]);
  leaveTypes = signal<LeaveType[]>([]);
  taskTypes = signal<TaskType[]>([]);
  /** §8: the company's delivery phases. */
  projectPhases = signal<ProjectPhase[]>([]);
  /** §PB10: the sites a field visit can be raised against. */
  visitLocations = signal<VisitLocation[]>([]);
  /**
   * Who a site can be tied to. Optional — plenty belong to nobody.
   *
   * Lead contacts rather than clients: a project already opens against one, and
   * the Client table here also holds rows created by CRM lead conversion, some
   * of them a person's name, which made a client picker read as a list of
   * prospects. Sorted by company then name by the endpoint.
   */
  leadContactOptions = signal<LeadContactOption[]>([]);
  
  leadContactSelectOptions = computed<SearchableSelectOption[]>(() => {
    return this.leadContactOptions().map(c => {
      const details: string[] = [];
      if (c.companyName) details.push(`Contact: ${c.name}`);
      if (c.email) details.push(c.email);
      if (c.contactCode) details.push(`#${c.contactCode}`);
      const comp = (c.companyName || '').trim();
      const contact = (c.name || '').trim();
      const displayName = comp && contact ? `${comp} — ${contact}` : comp || contact;
      return {
        id: c.id,
        name: displayName,
        subtitle: details.length > 0 ? details.join(' • ') : undefined
      };
    });
  });

  departmentSelectOptions = computed<SearchableSelectOption[]>(() => {
    return this.departments().map(d => ({
      id: d.id,
      name: d.name
    }));
  });

  visitLocationSearchText = signal('');

  filteredVisitLocations = computed(() => {
    const q = this.visitLocationSearchText().toLowerCase().trim();
    const list = this.visitLocations();
    if (!q) return list;
    return list.filter(item => {
      const name = (item.name || '').toLowerCase();
      const addr = (item.address || '').toLowerCase();
      const contact = (item.leadContact?.name || '').toLowerCase();
      const company = (item.leadContact?.companyName || '').toLowerCase();
      return name.includes(q) || addr.includes(q) || contact.includes(q) || company.includes(q);
    });
  });

  visitLocationStats = computed(() => {
    const list = this.visitLocations();
    const total = list.length;
    const pinned = list.filter(l => l.latitude != null && l.longitude != null).length;
    const unpinned = total - pinned;
    const active = list.filter(l => l.isActive).length;
    return { total, pinned, unpinned, active };
  });

  isLocating = signal(false);
  mapSearchText = signal('');
  isSearchingMap = signal(false);
  leafletMap: any = null;
  mapMarker: any = null;

  onVisitLocationSearchChange(val: string) {
    this.visitLocationSearchText.set(val);
  }

  clearVisitLocationSearch() {
    this.visitLocationSearchText.set('');
  }

  refreshVisitLocations() {
    this.masterDataService.getVisitLocations().subscribe({
      next: (data) => {
        this.visitLocations.set(data);
        this.toast.success('Visit locations refreshed');
      },
      error: () => this.toast.error('Failed to refresh visit locations')
    });
  }

  isPinned(): boolean {
    const lat = this.formData.latitude;
    const lng = this.formData.longitude;
    return lat != null && lat !== '' && !isNaN(Number(lat)) &&
           lng != null && lng !== '' && !isNaN(Number(lng));
  }

  isPartiallyPinned(): boolean {
    const hasLat = this.formData.latitude != null && this.formData.latitude !== '' && !isNaN(Number(this.formData.latitude));
    const hasLng = this.formData.longitude != null && this.formData.longitude !== '' && !isNaN(Number(this.formData.longitude));
    return hasLat !== hasLng;
  }

  getMapPreviewUrl(lat?: any, lng?: any): SafeResourceUrl {
    if (lat == null || lng == null || lat === '' || lng === '' || isNaN(Number(lat)) || isNaN(Number(lng))) {
      return this.sanitizer.bypassSecurityTrustResourceUrl('');
    }
    return this.sanitizer.bypassSecurityTrustResourceUrl(
      `https://maps.google.com/maps?q=${lat},${lng}&t=&z=15&ie=UTF8&iwloc=&output=embed`
    );
  }

  ensureLeafletLoaded(): Promise<any> {
    return new Promise((resolve) => {
      if ((window as any).L) {
        resolve((window as any).L);
        return;
      }
      const existingScript = document.getElementById('leaflet-script');
      if (existingScript) {
        existingScript.addEventListener('load', () => resolve((window as any).L));
        return;
      }
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);

      const script = document.createElement('script');
      script.id = 'leaflet-script';
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload = () => resolve((window as any).L);
      document.head.appendChild(script);
    });
  }

  async initFreeMap(): Promise<void> {
    const leaflet = await this.ensureLeafletLoaded();
    if (!leaflet) return;

    // Allow modal DOM animation to complete
    setTimeout(() => {
      const container = document.getElementById('free-map-picker');
      if (!container) return;

      if (this.leafletMap) {
        this.leafletMap.remove();
        this.leafletMap = null;
        this.mapMarker = null;
      }

      const hasCoords = this.isPinned();
      const initialLat = hasCoords ? Number(this.formData.latitude) : 28.6139;
      const initialLng = hasCoords ? Number(this.formData.longitude) : 77.2090;
      const initialZoom = hasCoords ? 15 : 12;

      this.leafletMap = leaflet.map(container, {
        center: [initialLat, initialLng],
        zoom: initialZoom,
        zoomControl: true,
        attributionControl: false
      });

      leaflet.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap'
      }).addTo(this.leafletMap);

      if (hasCoords) {
        this.setMapMarker([initialLat, initialLng]);
      }

      this.leafletMap.on('click', (e: any) => {
        const lat = Number(e.latlng.lat.toFixed(6));
        const lng = Number(e.latlng.lng.toFixed(6));
        this.formData.latitude = lat;
        this.formData.longitude = lng;
        this.setMapMarker([lat, lng]);
        this.reverseGeocodeAndFillAddress(lat, lng);
      });

      setTimeout(() => {
        this.leafletMap?.invalidateSize();
      }, 200);
    }, 120);
  }

  setMapMarker(coords: [number, number], pan: boolean = false, zoom?: number): void {
    if (!this.leafletMap) return;
    const leaflet = (window as any).L;
    if (!leaflet) return;

    const pinIcon = leaflet.divIcon({
      className: 'custom-leaflet-pin',
      html: `
        <div class="leaflet-svg-pin">
          <svg width="28" height="36" viewBox="0 0 24 30" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 9 12 18 12 18s12-9 12-18c0-6.63-5.37-12-12-12z" fill="#0284c7"/>
            <circle cx="12" cy="11" r="4.5" fill="#FFFFFF"/>
          </svg>
        </div>
      `,
      iconSize: [28, 36],
      iconAnchor: [14, 36],
      popupAnchor: [0, -36]
    });

    if (this.mapMarker) {
      this.mapMarker.setLatLng(coords);
    } else {
      this.mapMarker = leaflet.marker(coords, {
        draggable: true,
        icon: pinIcon
      }).addTo(this.leafletMap);

      this.mapMarker.on('dragend', () => {
        const pos = this.mapMarker.getLatLng();
        const lat = Number(pos.lat.toFixed(6));
        const lng = Number(pos.lng.toFixed(6));
        this.formData.latitude = lat;
        this.formData.longitude = lng;
        this.reverseGeocodeAndFillAddress(lat, lng);
      });
    }

    if (zoom) {
      this.leafletMap.setView(coords, zoom);
    } else if (pan) {
      this.leafletMap.panTo(coords);
    }
  }

  onCoordInputChanged(): void {
    const lat = Number(this.formData.latitude);
    const lng = Number(this.formData.longitude);
    if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      if (this.leafletMap) {
        this.setMapMarker([lat, lng], true);
      }
    }
  }

  searchMapLocation(): void {
    const q = this.mapSearchText().trim();
    if (!q) return;
    this.isSearchingMap.set(true);
    fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`, {
      headers: { 'Accept-Language': 'en' }
    })
      .then(res => res.json())
      .then(data => {
        this.isSearchingMap.set(false);
        if (data && data.length > 0) {
          const lat = Number(parseFloat(data[0].lat).toFixed(6));
          const lng = Number(parseFloat(data[0].lon).toFixed(6));
          this.formData.latitude = lat;
          this.formData.longitude = lng;
          if (!this.formData.address || !this.formData.address.trim()) {
            this.formData.address = data[0].display_name || '';
          }
          if (this.leafletMap) {
            this.leafletMap.flyTo([lat, lng], 16);
            this.setMapMarker([lat, lng]);
          }
          this.toast.success(`Location set: ${data[0].display_name.split(',')[0]}`);
        } else {
          this.toast.error('Location not found. Try searching another landmark or city.');
        }
      })
      .catch(() => {
        this.isSearchingMap.set(false);
        this.toast.error('Could not search location.');
      });
  }

  async reverseGeocodeAndFillAddress(lat: number, lng: number): Promise<void> {
    try {
      const addr = await this.reverseGeocode(lat, lng);
      if (addr && (!this.formData.address || !this.formData.address.trim())) {
        this.formData.address = addr;
        this.toast.info('Address auto-filled from selected pin location');
      }
    } catch {
      // non-fatal
    }
  }

  useMyLocation(): void {
    if (!navigator.geolocation) {
      this.toast.error('Geolocation is not supported by your browser.');
      return;
    }
    this.isLocating.set(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lng = Number(pos.coords.longitude.toFixed(6));
        this.formData.latitude = lat;
        this.formData.longitude = lng;
        this.toast.success(`GPS coordinates captured: ${lat}, ${lng}`);
        
        if (this.leafletMap) {
          this.leafletMap.flyTo([lat, lng], 16);
          this.setMapMarker([lat, lng]);
        }

        // Reverse geocode if address is currently blank
        if (!this.formData.address || !this.formData.address.trim()) {
          try {
            const addr = await this.reverseGeocode(lat, lng);
            if (addr) {
              this.formData.address = addr;
              this.toast.info('Address auto-filled from GPS location');
            }
          } catch {
            // non-fatal
          }
        }
        this.isLocating.set(false);
      },
      (err) => {
        console.warn('Geolocation error:', err);
        let msg = 'Could not access your location.';
        if (err.code === 1) msg = 'Location access permission was denied.';
        else if (err.code === 2) msg = 'GPS location unavailable.';
        else if (err.code === 3) msg = 'Location request timed out.';
        this.toast.error(msg);
        this.isLocating.set(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }

  async reverseGeocode(lat: number, lng: number): Promise<string> {
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18`, {
        headers: { 'Accept-Language': 'en' }
      });
      if (res.ok) {
        const data = await res.json();
        return data.display_name || '';
      }
    } catch {
      // Fallback
    }
    return '';
  }

  clearCoordinates(): void {
    this.formData.latitude = null;
    this.formData.longitude = null;
    if (this.mapMarker && this.leafletMap) {
      this.leafletMap.removeLayer(this.mapMarker);
      this.mapMarker = null;
    }
  }
  /** §1: the tasks every new project starts with. */
  defaultProjectTasks = signal<DefaultProjectTask[]>([]);
  holidays = signal<Holiday[]>([]);
  blackoutDates = signal<BlackoutDate[]>([]);
  shifts = signal<any[]>([]);
  shiftSearchText = signal('');

  // Assigned Employees Modal state
  isShiftEmployeesModalOpen = signal(false);
  selectedShiftForEmployees = signal<any | null>(null);
  shiftEmployeesList = signal<any[]>([]);
  shiftEmployeesLoading = signal(false);
  shiftEmployeesSearchText = signal('');

  filteredShiftEmployees = computed(() => {
    const text = this.shiftEmployeesSearchText().trim().toLowerCase();
    const list = this.shiftEmployeesList();
    if (!text) return list;
    return list.filter(emp => {
      const fullName = `${emp.firstName || ''} ${emp.lastName || ''}`.toLowerCase();
      const code = (emp.employeeCode || '').toLowerCase();
      const email = (emp.user?.email || '').toLowerCase();
      const dept = (emp.department?.name || '').toLowerCase();
      const desig = (emp.designation?.name || '').toLowerCase();
      return fullName.includes(text) || code.includes(text) || email.includes(text) || dept.includes(text) || desig.includes(text);
    });
  });

  filteredShifts = computed(() => {
    const q = this.shiftSearchText().toLowerCase().trim();
    const list = this.shifts();
    if (!q) return list;
    return list.filter(s => {
      const matchName = (s.name || '').toLowerCase().includes(q);
      const matchCode = (s.shortCode || '').toLowerCase().includes(q);
      const matchTiming = `${s.startTime || ''} ${s.endTime || ''}`.toLowerCase().includes(q);
      const matchType = (s.shiftType || '').toLowerCase().includes(q);
      return matchName || matchCode || matchTiming || matchType;
    });
  });

  shiftStats = computed(() => {
    const list = this.shifts();
    const total = list.length;
    const strict = list.filter(s => s.shiftType !== 'FLEXIBLE').length;
    const flexible = list.filter(s => s.shiftType === 'FLEXIBLE').length;
    const totalEmployees = list.reduce((acc, s) => acc + (s._count?.employees || 0), 0);
    return { total, strict, flexible, totalEmployees };
  });

  onShiftSearchChange(val: string) {
    this.shiftSearchText.set(val);
  }

  clearShiftSearch() {
    this.shiftSearchText.set('');
  }

  refreshShifts() {
    this.shiftsService.getShifts().subscribe({
      next: (data) => {
        this.shifts.set(data);
        this.toast.success('Shifts refreshed');
      },
      error: () => this.toast.error('Failed to refresh shifts')
    });
  }

  holidayView = signal<'table' | 'calendar'>('table');
  calendarDate = signal(new Date());

  calendarDays = computed(() => {
    const date = this.calendarDate();
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    
    const days: any[] = [];
    // Pad previous month
    for (let i = 0; i < firstDay.getDay(); i++) {
      days.push({ empty: true });
    }
    // Current month days
    const allHolidays = this.holidays();
    for (let i = 1; i <= lastDay.getDate(); i++) {
      const isHoliday = allHolidays.find(h => {
        const hd = new Date(h.date);
        return hd.getFullYear() === year && hd.getMonth() === month && hd.getDate() === i;
      });
      days.push({
        dayNumber: i,
        holiday: isHoliday
      });
    }
    return days;
  });

  prevMonth() {
    const d = new Date(this.calendarDate());
    d.setMonth(d.getMonth() - 1);
    this.calendarDate.set(d);
  }

  nextMonth() {
    const d = new Date(this.calendarDate());
    d.setMonth(d.getMonth() + 1);
    this.calendarDate.set(d);
  }

  currentMonthName = computed(() => {
    return this.calendarDate().toLocaleString('default', { month: 'long', year: 'numeric' });
  });

  seedDefaultHolidays() {
    const year = new Date().getFullYear();
    const defaults = [
      { name: 'Republic Day', date: `${year}-01-26` },
      { name: 'Maha Shivratri', date: `${year}-02-14` },
      { name: 'Holi', date: `${year}-03-03` },
      { name: 'Good Friday', date: `${year}-04-03` },
      { name: 'Eid-ul-Fitr', date: `${year}-04-18` },
      { name: 'Buddha Purnima', date: `${year}-05-01` },
      { name: 'Independence Day', date: `${year}-08-15` },
      { name: 'Raksha Bandhan', date: `${year}-08-28` },
      { name: 'Gandhi Jayanti', date: `${year}-10-02` },
      { name: 'Dussehra', date: `${year}-10-20` },
      { name: 'Diwali', date: `${year}-11-08` },
      { name: 'Christmas Day', date: `${year}-12-25` }
    ];
    if (!confirm('This will insert standard Indian holidays for the current year. Continue?')) return;
    this.isSaving.set(true);
    this.masterDataService.seedHolidays({ holidays: defaults }).subscribe({
      next: (res) => {
        this.toast.success(`Seeded ${res.count} default holidays!`);
        this.loadData();
        this.isSaving.set(false);
      },
      error: () => {
        this.toast.error('Failed to seed holidays');
        this.isSaving.set(false);
      }
    });
  }

  defaultColDef: ColDef = {
    flex: 1,
    minWidth: 150,
    filter: true,
    sortable: true
  };

  gridOptions = {
    rowSelection: {
      mode: 'multiRow' as const,
      checkboxes: true,
      headerCheckbox: true,
      enableClickSelection: false
    }
  };

  // --- Shifts Grid Configuration ---
  shiftGridApi?: GridApi;

  shiftDefaultColDef: ColDef = {
    flex: 1,
    minWidth: 120,
    sortable: true,
    filter: true,
    resizable: true
  };

  shiftGridOptions: GridOptions = {
    rowHeight: 70,
    headerHeight: 46,
    enableCellTextSelection: true,
    animateRows: true
  };

  visitLocationGridOptions: GridOptions = {
    rowHeight: 56,
    headerHeight: 46,
    enableCellTextSelection: true,
    animateRows: true
  };

  onShiftGridReady(params: any) {
    this.shiftGridApi = params.api;
  }

  shiftColDefs: ColDef[] = [
    {
      field: 'name',
      headerName: 'Shift Name',
      flex: 1.8,
      minWidth: 220,
      cellRenderer: (p: any) => {
        const data = p.data || {};
        const color = data.colorCode || '#2A97D8';
        const name = data.name || 'Unnamed Shift';
        const shortCode = data.shortCode || (name.length >= 2 ? name.substring(0, 2).toUpperCase() : 'SH');
        const desc = data.description || (data.shiftType === 'FLEXIBLE' ? 'Output based schedule' : 'Fixed work timing');

        return `
          <div class="shift-name-cell">
            <div class="shift-color-dot-wrapper">
              <span class="shift-color-dot" style="background-color: ${color}; box-shadow: 0 0 0 3px ${color}25;"></span>
            </div>
            <div class="shift-name-meta">
              <div class="shift-name-top">
                <span class="shift-name-title" title="${name}">${name}</span>
                <span class="shift-code-tag" style="background: ${color}12; color: ${color}; border-color: ${color}30;">${shortCode}</span>
              </div>
              <span class="shift-name-desc" title="${desc}">${desc}</span>
            </div>
          </div>
        `;
      }
    },
    {
      field: 'shiftType',
      headerName: 'Type',
      flex: 0.9,
      minWidth: 110,
      cellRenderer: (p: any) => {
        const isFlexible = p.value === 'FLEXIBLE';
        if (isFlexible) {
          return `
            <div class="shift-type-cell">
              <span class="shift-type-pill flexible">
                <span class="type-indicator-dot"></span>
                <span>Flexible</span>
              </span>
            </div>
          `;
        }
        return `
          <div class="shift-type-cell">
            <span class="shift-type-pill strict">
              <span class="type-indicator-dot"></span>
              <span>Strict</span>
            </span>
          </div>
        `;
      }
    },
    {
      headerName: 'Timings & Hours',
      flex: 1.7,
      minWidth: 195,
      cellRenderer: (p: any) => {
        const d = p.data || {};
        if (d.shiftType === 'FLEXIBLE') {
          return `
            <div class="shift-timing-cell">
              <div class="timing-top-row">
                <span class="timing-time-main"><b>${d.totalHours || 8}</b> hrs / day</span>
              </div>
              <span class="timing-sub-text">Flexible check-in</span>
            </div>
          `;
        }

        const start = d.startTime || '—';
        const end = d.endTime || '—';
        const duration = this.calculateShiftDuration(start, end);
        const isOvernight = this.isOvernightShift(start, end);
        const start12 = this.formatTime12h(start);
        const end12 = this.formatTime12h(end);

        return `
          <div class="shift-timing-cell">
            <div class="timing-top-row">
              <span class="timing-time-main">${start12} – ${end12}</span>
              ${isOvernight ? `<span class="overnight-tag" title="Overnight Shift (ends next day)">🌙 Night</span>` : ''}
            </div>
            <div class="timing-sub-row">
              <span class="timing-duration-badge">${duration}</span>
            </div>
          </div>
        `;
      }
    },
    {
      field: 'workingDays',
      headerName: 'Schedule',
      flex: 1.3,
      minWidth: 145,
      cellRenderer: (p: any) => {
        const schedule = this.formatScheduleDetails(p.value);
        return `
          <div class="shift-schedule-cell">
            <div class="schedule-top-row">
              <span class="schedule-main-badge ${schedule.badgeClass}">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                  <line x1="16" y1="2" x2="16" y2="6"></line>
                  <line x1="8" y1="2" x2="8" y2="6"></line>
                  <line x1="3" y1="10" x2="21" y2="10"></line>
                </svg>
                <span>${schedule.title}</span>
              </span>
            </div>
            <span class="schedule-sub-text">${schedule.subtitle}</span>
          </div>
        `;
      }
    },
    {
      headerName: 'Punch Policy',
      flex: 1.6,
      minWidth: 175,
      cellRenderer: (p: any) => {
        const d = p.data || {};
        if (d.shiftType === 'FLEXIBLE') {
          const maxPunches = d.maxCheckIns ?? 2;
          return `
            <div class="shift-policy-cell">
              <span class="policy-primary">Min <b>${d.halfDayHours ?? 4}h</b> half-day</span>
              <span class="policy-secondary">Max ${maxPunches} punch${maxPunches === 1 ? '' : 'es'} / day</span>
            </div>
          `;
        }
        const grace = d.bufferTimeMinutes ? `Grace: ${d.bufferTimeMinutes}m` : 'No grace';
        const early = d.earlyClockInMinutes ? `Early: ${d.earlyClockInMinutes}m` : 'Early: Std';
        const halfDayFormatted = d.halfDayTime ? this.formatTime12h(d.halfDayTime) : '—';
        return `
          <div class="shift-policy-cell">
            <div class="policy-rule-tags">
              <span class="policy-rule-pill">${grace}</span>
              <span class="policy-rule-pill">${early}</span>
            </div>
            <span class="policy-secondary">Half-day: ${halfDayFormatted}</span>
          </div>
        `;
      }
    },
    {
      field: '_count.employees',
      headerName: 'Assigned',
      flex: 1,
      minWidth: 115,
      cellRenderer: (p: any) => {
        const count = p.data?._count?.employees ?? 0;
        if (count > 0) {
          return `
            <div class="shift-assigned-cell">
              <button type="button" class="assigned-pill-btn active" title="Click to view ${count} assigned employee${count === 1 ? '' : 's'}">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                  <circle cx="9" cy="7" r="4"></circle>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                </svg>
                <span>${count} emp</span>
              </button>
            </div>
          `;
        }
        return `
          <div class="shift-assigned-cell">
            <span class="assigned-pill-btn empty" title="Click to view shift details">0 emp</span>
          </div>
        `;
      },
      onCellClicked: (p: any) => {
        if (p.data) {
          this.openShiftEmployeesModal(p.data);
        }
      }
    },
    {
      headerName: 'Actions',
      width: 80,
      flex: 0,
      sortable: false,
      filter: false,
      cellRenderer: ActionCellRendererComponent,
      cellRendererParams: {
        onEdit: (data: any) => this.openModal('edit', data),
        onDelete: (data: any) => this.deleteItem(data.id)
      }
    }
  ];

  deptColDefs: ColDef[] = [
    { 
      field: 'name', 
      headerName: 'Name', 
      minWidth: 200
    },
    {
      field: 'isActive',
      headerName: 'Status',
      width: 150,
      cellRenderer: StatusToggleRendererComponent,
      cellRendererParams: {
        onToggle: this.onDepartmentToggle.bind(this)
      }
    },
    { 
      headerName: 'Actions',
      width: 120,
      flex: 0,
      sortable: false,
      filter: false,
      cellRenderer: ActionCellRendererComponent,
      cellRendererParams: {
        onEdit: (data: any) => this.openModal('edit', data),
        onDelete: (data: any) => this.deleteItem(data.id)
      }
    }
  ];

  desigColDefs: ColDef[] = [
    { 
      field: 'name', 
      headerName: 'Name',
      minWidth: 200
    },
    { 
      field: 'department.name', 
      headerName: 'Department',
      valueFormatter: (params) => params.value || 'Unassigned'
    },
    {
      field: 'isActive',
      headerName: 'Status',
      width: 150,
      cellRenderer: StatusToggleRendererComponent,
      cellRendererParams: {
        onToggle: this.onDesignationToggle.bind(this)
      }
    },
    { 
      headerName: 'Actions',
      width: 120,
      flex: 0,
      sortable: false,
      filter: false,
      cellRenderer: ActionCellRendererComponent,
      cellRendererParams: {
        onEdit: (data: any) => this.openModal('edit', data),
        onDelete: (data: any) => this.deleteItem(data.id)
      }
    }
  ];

  branchColDefs: ColDef[] = [
    { field: 'name', headerName: 'Name' },
    { field: 'address', headerName: 'Address' },
    { field: 'startTime', headerName: 'Start Time' },
    { field: 'endTime', headerName: 'End Time' },
    { 
      field: 'weeklyOffs', 
      headerName: 'Weekly Offs', 
      valueFormatter: (params) => {
        if (!params.value) return 'None';
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        return params.value.split(',').map((v: string) => {
          const parts = v.trim().split(':');
          const dayName = days[parseInt(parts[0], 10)];
          const cond = parts[1];
          if (cond === 'even') return `${dayName} (Even)`;
          if (cond === 'odd') return `${dayName} (Odd)`;
          return dayName;
        }).join(', ');
      }
    },
    {
      field: 'isActive',
      headerName: 'Status',
      width: 150,
      cellRenderer: StatusToggleRendererComponent,
      cellRendererParams: {
        onToggle: this.onBranchToggle.bind(this)
      }
    },
    { 
      headerName: 'Actions', width: 120, flex: 0, sortable: false, filter: false,
      cellRenderer: ActionCellRendererComponent,
      cellRendererParams: {
        onEdit: (data: any) => this.openModal('edit', data),
        onDelete: (data: any) => this.deleteItem(data.id)
      }
    }
  ];

  leaveTypeColDefs: ColDef[] = [
    { field: 'name', headerName: 'Name' },
    { field: 'defaultDays', headerName: 'Default Days' },
    { 
      field: 'isPaid', 
      headerName: 'Paid', 
      cellRenderer: StatusToggleRendererComponent,
      cellRendererParams: {
        activeLabel: 'Yes', inactiveLabel: 'No',
        onToggle: (data: any, isActive: boolean) => this.onLeaveTypeToggle(data, 'isPaid', isActive)
      }
    },
    { 
      field: 'encashable', 
      headerName: 'Encash at Year End', 
      cellRenderer: StatusToggleRendererComponent,
      cellRendererParams: {
        activeLabel: 'Yes', inactiveLabel: 'No',
        onToggle: (data: any, isActive: boolean) => this.onLeaveTypeToggle(data, 'encashable', isActive)
      }
    },
    { 
      field: 'allowHalfDay', 
      headerName: 'Allow Half Day', 
      cellRenderer: StatusToggleRendererComponent,
      cellRendererParams: {
        activeLabel: 'Yes', inactiveLabel: 'No',
        onToggle: (data: any, isActive: boolean) => this.onLeaveTypeToggle(data, 'allowHalfDay', isActive)
      }
    },
    { field: 'accrualFrequency', headerName: 'Accrual Frequency' },
    { field: 'accrualAmount', headerName: 'Accrual Amount' },
    { 
      headerName: 'Actions', width: 120, flex: 0, sortable: false, filter: false,
      cellRenderer: ActionCellRendererComponent,
      cellRendererParams: {
        onEdit: (data: any) => this.openModal('edit', data),
        onDelete: (data: any) => this.deleteItem(data.id)
      }
    }
  ];

  taskTypeColDefs: ColDef[] = [
    { field: 'name', headerName: 'Name', minWidth: 220 },
    {
      field: 'isActive',
      headerName: 'Active',
      width: 150,
      cellRenderer: StatusToggleRendererComponent,
      cellRendererParams: {
        activeLabel: 'Yes', inactiveLabel: 'No',
        onToggle: (data: any, isActive: boolean) => {
          this.masterDataService.updateTaskType(data.id, { isActive }).subscribe({
            next: () => this.loadData(),
            error: () => this.toast.error('Could not update the task type'),
          });
        },
      },
    },
    { field: 'position', headerName: 'Order', width: 110 },
    {
      headerName: 'Actions',
      width: 120,
      flex: 0,
      sortable: false,
      filter: false,
      cellRenderer: ActionCellRendererComponent,
      cellRendererParams: {
        onEdit: (data: any) => this.openModal('edit', data),
        onDelete: (data: any) => this.deleteItem(data.id),
      },
    },
  ];
  // §8: identical to task types above -- same list, same controls.
  projectPhaseColDefs: ColDef[] = [
    { field: 'name', headerName: 'Name', minWidth: 220 },
    {
      field: 'isActive',
      headerName: 'Active',
      width: 150,
      cellRenderer: StatusToggleRendererComponent,
      cellRendererParams: {
        activeLabel: 'Yes', inactiveLabel: 'No',
        onToggle: (data: any, isActive: boolean) => {
          this.masterDataService.updateProjectPhase(data.id, { isActive }).subscribe({
            next: () => this.loadData(),
            error: () => this.toast.error('Could not update the phase'),
          });
        },
      },
    },
    { field: 'position', headerName: 'Order', width: 110 },
    {
      headerName: 'Actions',
      width: 120,
      flex: 0,
      sortable: false,
      filter: false,
      cellRenderer: ActionCellRendererComponent,
      cellRendererParams: {
        onEdit: (data: any) => this.openModal('edit', data),
        onDelete: (data: any) => this.deleteItem(data.id),
      },
    },
  ];
  /**
   * §PB10: sites for the field visit picker.
   *
   * Coordinates are shown rather than tucked away in the edit form: a site
   * without them still fills the address but leaves the pin to be placed by
   * hand, and the person maintaining this list is the one who can tell at a
   * glance which rows are missing them.
   */
  visitLocationColDefs: ColDef[] = [
    { 
      field: 'name', 
      headerName: 'Site / Location', 
      minWidth: 200,
      flex: 1.5,
      tooltipField: 'name',
      cellRenderer: (p: any) => {
        const name = p.value || 'Unnamed Site';
        return `
          <div class="site-name-cell">
            <div class="site-icon-dot">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"></path>
                <circle cx="12" cy="10" r="3"></circle>
              </svg>
            </div>
            <div class="site-name-content">
              <span class="site-name-title" title="${name}">${name}</span>
            </div>
          </div>
        `;
      }
    },
    { 
      field: 'address', 
      headerName: 'Address', 
      minWidth: 260,
      flex: 2,
      tooltipField: 'address',
      cellRenderer: (p: any) => {
        const val = p.value;
        if (!val) return `<span class="empty-site-text">—</span>`;
        return `
          <div class="site-address-cell" title="${val}">
            <span class="site-address-text">${val}</span>
          </div>
        `;
      }
    },
    {
      headerName: 'Client / Contact',
      minWidth: 180,
      flex: 1.2,
      cellRenderer: (p: any) => {
        const c = p.data?.leadContact;
        if (!c) return `<span class="empty-site-text">Not linked</span>`;
        const comp = c.companyName ? `<span class="contact-company">${c.companyName}</span>` : '';
        const person = `<span class="contact-person">${c.name}</span>`;
        const full = `${c.companyName || ''} ${c.name || ''}`.trim();
        return `
          <div class="site-contact-cell" title="${full}">
            ${comp}
            ${comp && person ? '<span class="contact-sep">•</span>' : ''}
            ${person}
          </div>
        `;
      }
    },
    {
      headerName: 'GPS Pin',
      width: 148,
      minWidth: 140,
      flex: 0,
      cellRenderer: (p: any) => {
        const lat = p.data?.latitude;
        const lng = p.data?.longitude;
        const isPinned = lat != null && lng != null;
        if (isPinned) {
          return `
            <div class="site-pinned-cell">
              <a href="https://www.google.com/maps?q=${lat},${lng}" target="_blank" rel="noopener noreferrer" class="pinned-badge active" title="Open in Google Maps (${lat}, ${lng})" onclick="event.stopPropagation()">
                <span class="pinned-dot"></span>
                <span>GPS Pinned</span>
                <svg class="pin-link-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                  <polyline points="15 3 21 3 21 9"></polyline>
                  <line x1="10" y1="14" x2="21" y2="3"></line>
                </svg>
              </a>
            </div>
          `;
        }
        return `
          <div class="site-pinned-cell">
            <span class="pinned-badge unpinned" title="Missing GPS coordinates">
              <span class="unpinned-dot"></span>
              <span>No Pin</span>
            </span>
          </div>
        `;
      }
    },
    {
      field: 'isActive',
      headerName: 'Status',
      width: 115,
      minWidth: 110,
      flex: 0,
      cellRenderer: StatusToggleRendererComponent,
      cellRendererParams: {
        activeLabel: 'Yes', inactiveLabel: 'No',
        onToggle: (data: any, isActive: boolean) => {
          this.masterDataService.updateVisitLocation(data.id, { isActive }).subscribe({
            next: () => this.loadData(),
            error: () => this.toast.error('Could not update the site'),
          });
        },
      },
    },
    { 
      field: 'position', 
      headerName: 'Order', 
      width: 85,
      flex: 0,
      cellRenderer: (p: any) => `<span class="order-badge">${p.value ?? 0}</span>`
    },
    {
      headerName: 'Actions',
      width: 105,
      flex: 0,
      pinned: 'right',
      sortable: false,
      filter: false,
      cellRenderer: ActionCellRendererComponent,
      cellRendererParams: {
        onEdit: (data: any) => this.openModal('edit', data),
        onDelete: (data: any) => this.deleteItem(data.id),
      },
    },
  ];

  // §1: as phases above, plus the description that becomes the task's own.
  defaultProjectTaskColDefs: ColDef[] = [
    { field: 'name', headerName: 'Task', minWidth: 240 },
    { field: 'description', headerName: 'Description', minWidth: 320, tooltipField: 'description' },
    {
      field: 'isActive',
      headerName: 'Active',
      width: 150,
      cellRenderer: StatusToggleRendererComponent,
      cellRendererParams: {
        activeLabel: 'Yes', inactiveLabel: 'No',
        onToggle: (data: any, isActive: boolean) => {
          this.masterDataService.updateDefaultProjectTask(data.id, { isActive }).subscribe({
            next: () => this.loadData(),
            error: () => this.toast.error('Could not update the default task'),
          });
        },
      },
    },
    { field: 'position', headerName: 'Order', width: 110 },
    {
      headerName: 'Actions',
      width: 120,
      flex: 0,
      sortable: false,
      filter: false,
      cellRenderer: ActionCellRendererComponent,
      cellRendererParams: {
        onEdit: (data: any) => this.openModal('edit', data),
        onDelete: (data: any) => this.deleteItem(data.id),
      },
    },
  ];

  holidayColDefs: ColDef[] = [
    { field: 'name', headerName: 'Holiday Name' },
    { field: 'date', headerName: 'Date', valueFormatter: (p) => new Date(p.value).toLocaleDateString() },
    { 
      headerName: 'Actions', width: 120, flex: 0, sortable: false, filter: false,
      cellRenderer: ActionCellRendererComponent,
      cellRendererParams: {
        onEdit: (data: any) => this.openModal('edit', data),
        onDelete: (data: any) => this.deleteItem(data.id)
      }
    }
  ];

  blackoutColDefs: ColDef[] = [
    { field: 'reason', headerName: 'Reason' },
    { field: 'date', headerName: 'Date', valueFormatter: (p) => new Date(p.value).toLocaleDateString() },
    { field: 'departmentId', headerName: 'Department', valueFormatter: (p) => p.value ? (this.departments().find(d => d.id === p.value)?.name ?? 'Unknown') : 'All Departments' },
    { 
      headerName: 'Actions', width: 120, flex: 0, sortable: false, filter: false,
      cellRenderer: ActionCellRendererComponent,
      cellRendererParams: {
        onEdit: (data: any) => this.openModal('edit', data),
        onDelete: (data: any) => this.deleteItem(data.id)
      }
    }
  ];

  // Modal State
  isModalOpen = signal(false);
  modalMode = signal<'create' | 'edit'>('create');
  isSaving = signal(false);
  
  weeklyOffConditions: { [key: string]: 'all' | 'even' | 'odd' } = {};
  
  // Form Data
  formData: any = {
    id: 0,
    name: '',
    departmentId: 0,
    canEditProfiles: false,
    address: '', startTime: '09:00', endTime: '18:00', weeklyOffs: '0',
    geofenceRadius: 500, allowedIps: '',
    isActive: true,
    defaultDays: 0, isPaid: true, encashable: false, encashmentLimit: 0,
    accrualFrequency: 'NONE', accrualAmount: 0,
    allowHalfDay: true,
    date: ''
  };

  // Shift config. Workway distinguishes STRICT shifts (judged against a clock
  // window) from FLEXIBLE ones (judged only on hours worked).
  readonly WEEK_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  readonly SHIFT_COLORS = [
    '#2A97D8', // Primary Sky Blue
    '#4F46E5', // Indigo
    '#10B981', // Emerald Green
    '#6b3fd6', // Amber
    '#1373e5', // Rose Red
    '#8B5CF6', // Violet
    '#6b3fd6', // Pink
    '#06B6D4', // Cyan
    '#64748B'  // Slate
  ];

  shiftDefaults() {
    return {
      shortCode: '',
      colorCode: '#2A97D8',
      shiftType: 'STRICT',
      halfDayTime: '13:30',
      halfDayHours: 4,
      totalHours: 9,
      earlyClockInMinutes: 30,
      autoClockOutHours: 0,
      bufferTimeMinutes: 15,
      maxCheckIns: 2,
      workingDays: [...this.WEEK_DAYS],
    };
  }

  isShiftDayOn(day: string): boolean {
    return (this.formData.workingDays || []).includes(day);
  }

  toggleShiftDay(day: string) {
    const days: string[] = this.formData.workingDays || [];
    this.formData.workingDays = days.includes(day)
      ? days.filter(d => d !== day)
      : [...days, day];
  }

  selectShiftColor(hex: string) {
    this.formData.colorCode = hex;
  }

  setShiftDaysPreset(preset: 'all' | 'mon-fri' | 'mon-sat') {
    if (preset === 'all') {
      this.formData.workingDays = [...this.WEEK_DAYS];
    } else if (preset === 'mon-fri') {
      this.formData.workingDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    } else if (preset === 'mon-sat') {
      this.formData.workingDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    }
  }

  calculateShiftDuration(start?: string, end?: string): string {
    if (!start || !end || !start.includes(':') || !end.includes(':')) return '—';
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) return '—';
    let totalMins = (eh * 60 + em) - (sh * 60 + sm);
    if (totalMins <= 0) {
      totalMins += 24 * 60; // Overnight
    }
    const hrs = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    return mins > 0 ? `${hrs}h ${mins}m` : `${hrs} hrs`;
  }

  isOvernightShift(start?: string, end?: string): boolean {
    if (!start || !end || !start.includes(':') || !end.includes(':')) return false;
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    return (eh * 60 + em) <= (sh * 60 + sm);
  }

  formatTime12h(timeStr?: string): string {
    if (!timeStr || !timeStr.includes(':')) return timeStr || '—';
    const parts = timeStr.split(':');
    let hours = parseInt(parts[0], 10);
    const minutes = parts[1] || '00';
    if (isNaN(hours)) return timeStr;
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    const formattedHour = hours < 10 ? `0${hours}` : `${hours}`;
    return `${formattedHour}:${minutes} ${ampm}`;
  }

  formatScheduleDetails(raw: any): { title: string; subtitle: string; badgeClass: string } {
    const days: string[] = Array.isArray(raw)
      ? raw
      : (typeof raw === 'string' && raw.length ? raw.split(',').map((s: string) => s.trim()) : ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']);

    if (days.length === 7) {
      return { title: 'All 7 Days', subtitle: 'Mon – Sun (Daily)', badgeClass: 'badge-all' };
    }
    const isMonFri = days.length === 5 && days.includes('Monday') && days.includes('Friday') && !days.includes('Saturday') && !days.includes('Sunday');
    if (isMonFri) {
      return { title: 'Mon – Fri', subtitle: '5 days / week (Weekdays)', badgeClass: 'badge-mon-fri' };
    }
    const isMonSat = days.length === 6 && !days.includes('Sunday');
    if (isMonSat) {
      return { title: 'Mon – Sat', subtitle: '6 days / week', badgeClass: 'badge-mon-sat' };
    }
    const dayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const sorted = [...days].sort((a, b) => dayOrder.indexOf(a) - dayOrder.indexOf(b));
    const shortNames = sorted.map((d: string) => d.slice(0, 3)).join(', ');
    return { title: shortNames || 'Custom', subtitle: `${days.length} days / week`, badgeClass: 'badge-custom' };
  }

  openShiftEmployeesModal(shift: any) {
    this.selectedShiftForEmployees.set(shift);
    this.isShiftEmployeesModalOpen.set(true);
    this.shiftEmployeesSearchText.set('');
    this.shiftEmployeesLoading.set(true);
    this.shiftEmployeesList.set([]);

    this.shiftsService.getShiftEmployees(shift.id).subscribe({
      next: (res) => {
        this.shiftEmployeesList.set(res.employees || []);
        this.shiftEmployeesLoading.set(false);
      },
      error: (err) => {
        console.error('Error fetching shift employees:', err);
        this.toast.error('Failed to load assigned employees');
        this.shiftEmployeesLoading.set(false);
      }
    });
  }

  closeShiftEmployeesModal() {
    this.isShiftEmployeesModalOpen.set(false);
    this.selectedShiftForEmployees.set(null);
    this.shiftEmployeesList.set([]);
    this.shiftEmployeesSearchText.set('');
  }

  getAvatarBg(name?: string): string {
    if (!name) return '#64748B';
    const colors = ['#2A97D8', '#6366F1', '#6b3fd6', '#8B5CF6', '#10B981', '#6b3fd6', '#06B6D4', '#3B82F6'];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  }

  getModalShiftDurationText(): string {
    if (this.formData.shiftType === 'FLEXIBLE') {
      return `${this.formData.totalHours || 8} hrs required`;
    }
    return this.calculateShiftDuration(this.formData.startTime, this.formData.endTime);
  }

  isModalOvernight(): boolean {
    if (this.formData.shiftType === 'FLEXIBLE') return false;
    return this.isOvernightShift(this.formData.startTime, this.formData.endTime);
  }

  weekDays = [
    { label: 'Sunday', value: '0' },
    { label: 'Monday', value: '1' },
    { label: 'Tuesday', value: '2' },
    { label: 'Wednesday', value: '3' },
    { label: 'Thursday', value: '4' },
    { label: 'Friday', value: '5' },
    { label: 'Saturday', value: '6' }
  ];

  isWeeklyOff(val: string): boolean {
    return !!this.weeklyOffConditions[val];
  }

  toggleWeeklyOff(val: string) {
    if (this.weeklyOffConditions[val]) {
      delete this.weeklyOffConditions[val];
    } else {
      this.weeklyOffConditions[val] = 'all';
    }
    this.syncWeeklyOffs();
  }

  updateWeeklyOffCondition(val: string, condition: 'all' | 'even' | 'odd') {
    if (this.weeklyOffConditions[val]) {
      this.weeklyOffConditions[val] = condition;
      this.syncWeeklyOffs();
    }
  }

  syncWeeklyOffs() {
    this.formData.weeklyOffs = Object.keys(this.weeklyOffConditions)
      .map(k => `${k}:${this.weeklyOffConditions[k]}`)
      .join(',');
  }


  ngOnInit() {
    this.route.queryParams.subscribe(params => {
      if (params['tab']) {
        const tab = params['tab'] as Tab;
        this.activeTab.set(tab);
        if (tab === 'visit-locations' && params['open'] === 'add') {
          setTimeout(() => this.openModal('create'));
        }
      }
    });
    this.loadData();

    // A `?tab=` beats the default. Read once, synchronously, because the template
    // keys off activeTab() and painting Departments for a frame before swapping
    // to the tab somebody asked for is exactly the flash this is here to avoid.
    const requested = this.route.snapshot.queryParamMap.get('tab') as Tab | null;
    if (requested && TABS.includes(requested)) {
      this.activeTab.set(requested);
    }
  }

  loadData() {
    this.masterDataService.getDepartments().subscribe({ next: (data) => this.departments.set(data) });
    this.masterDataService.getDesignations().subscribe({ next: (data) => this.designations.set(data) });
    this.masterDataService.getBranches().subscribe({ next: (data) => this.branches.set(data) });
    this.masterDataService.getLeaveTypes().subscribe({ next: (data) => this.leaveTypes.set(data) });
    this.masterDataService.getTaskTypes().subscribe({ next: (data) => this.taskTypes.set(data) });
    this.masterDataService.getProjectPhases().subscribe({ next: (data) => this.projectPhases.set(data) });
    this.masterDataService.getVisitLocations().subscribe({ next: (data) => this.visitLocations.set(data) });
    // Non-fatal: the link is optional, so a failure here must not stop somebody
    // adding a site.
    this.projectsService.getLeadContactOptions().subscribe({
      next: (rows) => this.leadContactOptions.set(rows || []),
      error: () => this.leadContactOptions.set([]),
    });
    this.masterDataService.getDefaultProjectTasks().subscribe({ next: (data) => this.defaultProjectTasks.set(data) });
    this.masterDataService.getHolidays().subscribe({ next: (data) => this.holidays.set(data) });
    this.masterDataService.getBlackoutDates().subscribe({ next: (data) => this.blackoutDates.set(data) });
    this.shiftsService.getShifts().subscribe({ next: (data) => this.shifts.set(data) });
  }

  switchTab(tab: Tab) {
    this.activeTab.set(tab);
    // Keep the address bar in step, so a reload — or a copied link — comes back
    // to the tab being looked at rather than to Departments.
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab },
      queryParamsHandling: '',
      replaceUrl: true,
    });
  }

  openModal(mode: 'create' | 'edit', item?: any) {
    this.modalMode.set(mode);
    if (mode === 'edit' && item) {
      this.formData = { 
        ...item,
        leadContactId: item.leadContactId ?? (item.leadContact?.id ?? null),
        latitude: item.latitude != null ? item.latitude : null,
        longitude: item.longitude != null ? item.longitude : null,
        position: item.position ?? 0
      };
      if (this.activeTab() === 'shifts') {
        this.formData = {
          ...this.shiftDefaults(), ...item,
          // Stored comma-separated; the checkboxes want an array.
          workingDays: item.workingDays ? String(item.workingDays).split(',') : [...this.WEEK_DAYS],
        };
      }
      if (this.activeTab() === 'holidays') {
        this.formData.date = item.date ? new Date(item.date).toISOString().split('T')[0] : '';
      }
      if (this.activeTab() === 'branches') {
        this.weeklyOffConditions = {};
        if (this.formData.weeklyOffs) {
          this.formData.weeklyOffs.split(',').forEach((rule: string) => {
            const parts = rule.trim().split(':');
            this.weeklyOffConditions[parts[0]] = (parts[1] as any) || 'all';
          });
        }
      }
    } else {
      this.formData = {
        id: 0, name: '', departmentId: 0, canEditProfiles: false,
        address: '', startTime: '09:00', endTime: '18:00', weeklyOffs: '0',
        geofenceRadius: 500, allowedIps: '',
        isActive: true,
        defaultDays: 0, isPaid: true, encashable: false, encashmentLimit: 0,
        accrualFrequency: 'NONE', accrualAmount: 0,
        allowHalfDay: true,
        // Task types order the dropdown; departments opt into raising tasks.
        position: 0, canCreateTasks: false,
        date: '',
        leadContactId: null,
        latitude: null,
        longitude: null,
        ...this.shiftDefaults()
      };
      if (this.activeTab() === 'branches') {
        this.weeklyOffConditions = { '0': 'all' }; // Default Sunday off
      }
    }
    this.isModalOpen.set(true);
  }

  /** "28.5355, 77.3910" (as Google Maps copies it) → the branch's lat/lng. */
  parseBranchCoords(text: string): void {
    const m = String(text ?? '').match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
    if (!m) {
      if (String(text ?? '').trim()) this.toast.error('Could not read that — paste it as "latitude, longitude".');
      return;
    }
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      this.toast.error('Those numbers are not a valid latitude/longitude.');
      return;
    }
    this.formData.latitude = lat;
    this.formData.longitude = lng;
  }

  pasteBranchCoords(event: ClipboardEvent): void {
    const text = event.clipboardData?.getData('text') ?? '';
    setTimeout(() => this.parseBranchCoords(text));
  }

  /** Set the pin from where this device is — handy when filling it in at the office. */
  useMyLocationForBranch(): void {
    if (!navigator.geolocation) {
      this.toast.error('This browser cannot report its location.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.formData.latitude = Number(pos.coords.latitude.toFixed(6));
        this.formData.longitude = Number(pos.coords.longitude.toFixed(6));
        this.toast.success('Location filled in — only do this while at the office.');
      },
      () => this.toast.error('Location access was denied.'),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  closeModal() {
    this.isModalOpen.set(false);
    if (this.leafletMap) {
      this.leafletMap.remove();
      this.leafletMap = null;
      this.mapMarker = null;
    }
  }

  save() {
    if (!this.formData.name || !this.formData.name.trim()) {
      this.toast.error('Name is required');
      return;
    }

    this.isSaving.set(true);
    const tab = this.activeTab();
    const mode = this.modalMode();
    const id = this.formData.id;

    const onSuccess = (msg: string) => {
      this.toast.success(msg);
      this.loadData();
      this.closeModal();
      this.isSaving.set(false);
    };
    const onError = (err: any) => {
      const msg = err.error?.message || err.message || 'An error occurred';
      this.toast.error(msg);
      this.isSaving.set(false);
    };

    if (tab === 'departments') {
      if (mode === 'create') this.masterDataService.createDepartment(this.formData).subscribe({ next: () => onSuccess('Department created'), error: onError });
      else this.masterDataService.updateDepartment(id, this.formData).subscribe({ next: () => onSuccess('Department updated'), error: onError });
    } else if (tab === 'designations') {
      if (mode === 'create') this.masterDataService.createDesignation(this.formData).subscribe({ next: () => onSuccess('Designation created'), error: onError });
      else this.masterDataService.updateDesignation(id, this.formData).subscribe({ next: () => onSuccess('Designation updated'), error: onError });
    } else if (tab === 'branches') {
      if (mode === 'create') this.masterDataService.createBranch(this.formData).subscribe({ next: () => onSuccess('Branch created'), error: onError });
      else this.masterDataService.updateBranch(id, this.formData).subscribe({ next: () => onSuccess('Branch updated'), error: onError });
    } else if (tab === 'leave-types') {
      // parse numeric
      this.formData.defaultDays = Number(this.formData.defaultDays);
      this.formData.encashmentLimit = Number(this.formData.encashmentLimit);
      if (mode === 'create') this.masterDataService.createLeaveType(this.formData).subscribe({ next: () => onSuccess('Leave Type created'), error: onError });
      else this.masterDataService.updateLeaveType(id, this.formData).subscribe({ next: () => onSuccess('Leave Type updated'), error: onError });
    } else if (tab === 'task-types') {
      if (!this.formData.name || !this.formData.name.trim()) {
        this.toast.error('A task type needs a name');
        this.isSaving.set(false);
        return;
      }
      this.formData.position = Number(this.formData.position) || 0;
      if (mode === 'create') this.masterDataService.createTaskType(this.formData).subscribe({ next: () => onSuccess('Task Type created'), error: onError });
      else this.masterDataService.updateTaskType(id, this.formData).subscribe({ next: () => onSuccess('Task Type updated'), error: onError });
    } else if (tab === 'visit-locations') {
      if (!this.formData.name || !this.formData.name.trim()) {
        this.toast.error('A site needs a name');
        this.isSaving.set(false);
        return;
      }
      const hasLat = this.formData.latitude !== null && this.formData.latitude !== '' && this.formData.latitude !== undefined && !isNaN(Number(this.formData.latitude));
      const hasLng = this.formData.longitude !== null && this.formData.longitude !== '' && this.formData.longitude !== undefined && !isNaN(Number(this.formData.longitude));
      const pinned = hasLat && hasLng;
      const onlyOne = hasLat !== hasLng;
      if (onlyOne) {
        this.toast.error('A pin needs both a latitude and a longitude');
        this.isSaving.set(false);
        return;
      }
      if (!pinned && mode === 'create'
          && !confirm('Save this site without a pin?\n\n'
            + 'Picking it will fill the address but leave the map pin to be placed by '
            + 'hand on every trip, and the coordinates are what decide whether somebody '
            + 'clocking in there counts as on site.')) {
        this.isSaving.set(false);
        return;
      }
      const payload: any = {
        name: this.formData.name.trim(),
        address: this.formData.address?.trim() || null,
        leadContactId: this.formData.leadContactId ? Number(this.formData.leadContactId) : null,
        latitude: pinned ? Number(this.formData.latitude) : null,
        longitude: pinned ? Number(this.formData.longitude) : null,
        position: Number(this.formData.position) || 0
      };
      if (mode === 'edit' && this.formData.isActive !== undefined) {
        payload.isActive = this.formData.isActive;
      }

      if (mode === 'create') this.masterDataService.createVisitLocation(payload).subscribe({ next: () => onSuccess('Site created'), error: onError });
      else this.masterDataService.updateVisitLocation(id, payload).subscribe({ next: () => onSuccess('Site updated'), error: onError });
    } else if (tab === 'project-phases') {
      if (!this.formData.name || !this.formData.name.trim()) {
        this.toast.error('A phase needs a name');
        this.isSaving.set(false);
        return;
      }
      this.formData.position = Number(this.formData.position) || 0;
      if (mode === 'create') this.masterDataService.createProjectPhase(this.formData).subscribe({ next: () => onSuccess('Phase created'), error: onError });
      else this.masterDataService.updateProjectPhase(id, this.formData).subscribe({ next: () => onSuccess('Phase updated'), error: onError });
    } else if (tab === 'default-project-tasks') {
      if (!this.formData.name || !this.formData.name.trim()) {
        this.toast.error('A default task needs a name');
        this.isSaving.set(false);
        return;
      }
      this.formData.position = Number(this.formData.position) || 0;
      if (mode === 'create') this.masterDataService.createDefaultProjectTask(this.formData).subscribe({ next: () => onSuccess('Default task created'), error: onError });
      else this.masterDataService.updateDefaultProjectTask(id, this.formData).subscribe({ next: () => onSuccess('Default task updated'), error: onError });
    } else if (tab === 'holidays') {
      if (!this.formData.name || this.formData.name.trim().length === 0) {
        this.toast.error('Holiday name is required');
        this.isSaving.set(false);
        return;
      }
      if (this.formData.name.length > 100) {
        this.toast.error('Holiday name must be 100 characters or less');
        this.isSaving.set(false);
        return;
      }
      if (!this.formData.date) {
        this.toast.error('Holiday date is required');
        this.isSaving.set(false);
        return;
      }
      if (mode === 'create') this.masterDataService.createHoliday(this.formData).subscribe({ next: () => onSuccess('Holiday created'), error: onError });
      else this.masterDataService.updateHoliday(id, this.formData).subscribe({ next: () => onSuccess('Holiday updated'), error: onError });
    } else if (tab === 'blackout-dates') {
      if (mode === 'create') this.masterDataService.createBlackoutDate(this.formData).subscribe({ next: () => onSuccess('Blackout date created'), error: onError });
      else this.masterDataService.updateBlackoutDate(id, this.formData).subscribe({ next: () => onSuccess('Blackout date updated'), error: onError });
    } else if (tab === 'shifts') {
      if (this.formData.shiftType === 'FLEXIBLE') {
        if (!this.formData.totalHours || Number(this.formData.totalHours) <= 0) {
          this.toast.error('Total hours are required for flexible shift');
          this.isSaving.set(false);
          return;
        }
      } else {
        if (!this.formData.startTime || !this.formData.endTime) {
          this.toast.error('Start time and end time are required for strict shift');
          this.isSaving.set(false);
          return;
        }
      }

      const payload = {
        ...this.formData,
        name: this.formData.name.trim(),
        shortCode: this.formData.shortCode ? this.formData.shortCode.trim().toUpperCase() : '',
        bufferTimeMinutes: this.formData.bufferTimeMinutes !== '' && this.formData.bufferTimeMinutes != null ? Number(this.formData.bufferTimeMinutes) : 0,
        earlyClockInMinutes: this.formData.earlyClockInMinutes !== '' && this.formData.earlyClockInMinutes != null ? Number(this.formData.earlyClockInMinutes) : 0,
        autoClockOutHours: this.formData.autoClockOutHours !== '' && this.formData.autoClockOutHours != null ? Number(this.formData.autoClockOutHours) : 0,
        maxCheckIns: this.formData.maxCheckIns !== '' && this.formData.maxCheckIns != null ? Number(this.formData.maxCheckIns) : 2,
        halfDayHours: this.formData.halfDayHours !== '' && this.formData.halfDayHours != null ? Number(this.formData.halfDayHours) : 4,
        totalHours: this.formData.totalHours !== '' && this.formData.totalHours != null ? Number(this.formData.totalHours) : 9,
        workingDays: Array.isArray(this.formData.workingDays) ? this.formData.workingDays.join(',') : (this.formData.workingDays || '')
      };

      if (mode === 'create') this.shiftsService.createShift(payload).subscribe({ next: () => onSuccess('Shift created'), error: onError });
      else this.shiftsService.updateShift(id, payload).subscribe({ next: () => onSuccess('Shift updated'), error: onError });
    }
  }

  deleteItem(id: number) {
    if (!confirm('Are you sure you want to delete this item?')) return;

    const tab = this.activeTab();
    let deleteSub: any;

    if (tab === 'departments') deleteSub = this.masterDataService.deleteDepartment(id);
    else if (tab === 'designations') deleteSub = this.masterDataService.deleteDesignation(id);
    else if (tab === 'branches') deleteSub = this.masterDataService.deleteBranch(id);
    else if (tab === 'leave-types') deleteSub = this.masterDataService.deleteLeaveType(id);
    else if (tab === 'task-types') deleteSub = this.masterDataService.deleteTaskType(id);
    else if (tab === 'project-phases') deleteSub = this.masterDataService.deleteProjectPhase(id);
    else if (tab === 'visit-locations') deleteSub = this.masterDataService.deleteVisitLocation(id);
    else if (tab === 'default-project-tasks') deleteSub = this.masterDataService.deleteDefaultProjectTask(id);
    else if (tab === 'holidays') deleteSub = this.masterDataService.deleteHoliday(id);
    else if (tab === 'blackout-dates') deleteSub = this.masterDataService.deleteBlackoutDate(id);
    else if (tab === 'shifts') deleteSub = this.shiftsService.deleteShift(id);

    deleteSub.subscribe({
      next: () => {
        this.toast.success('Item deleted');
        this.loadData();
      },
      error: () => this.toast.error('Failed to delete item.')
    });
  }

  onDepartmentToggle(data: any, isActive: boolean) {
    this.masterDataService.updateDepartment(data.id, { isActive }).subscribe({
      next: () => {
        this.toast.success(`Department is now ${isActive ? 'Active' : 'Inactive'}`);
        // Reload to sync cascaded changes to Designations tab
        this.loadData();
      },
      error: (err) => {
        console.error(err);
        this.toast.error('Failed to update status');
        this.loadData();
      }
    });
  }

  onDesignationToggle(data: any, isActive: boolean) {
    this.masterDataService.updateDesignation(data.id, { isActive }).subscribe({
      next: () => {
        this.toast.success(`Designation is now ${isActive ? 'Active' : 'Inactive'}`);
      },
      error: (err) => {
        console.error(err);
        this.toast.error('Failed to update status');
        this.loadData();
      }
    });
  }

  onBranchToggle(data: any, isActive: boolean) {
    this.masterDataService.updateBranch(data.id, { isActive }).subscribe({
      next: () => {
        this.toast.success(`Branch is now ${isActive ? 'Active' : 'Inactive'}`);
      },
      error: (err) => {
        console.error(err);
        this.toast.error('Failed to update status');
        this.loadData();
      }
    });
  }

  onLeaveTypeToggle(data: any, field: string, isActive: boolean) {
    this.masterDataService.updateLeaveType(data.id, { [field]: isActive }).subscribe({
      next: () => {
        this.toast.success(`Leave Type updated`);
      },
      error: (err) => {
        console.error(err);
        this.toast.error('Failed to update leave type');
        this.loadData();
      }
    });
  }
}
