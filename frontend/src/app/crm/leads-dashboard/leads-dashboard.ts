import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../services/auth.service';
import { StatCardComponent } from '../../shared/components/stat-card/stat-card.component';
import { ChartCardComponent } from '../../shared/components/chart-card/chart-card.component';
import {
  LucideArrowLeft,
  LucideTrendingUp,
  LucideTrendingDown,
  LucideUsers,
  LucideTarget,
  LucideClock,
  LucideIndianRupee,
  LucideAward,
  LucideAlertTriangle,
  LucideCalendar,
  LucideLoader2,
  LucideSparkles,
  LucideTrophy,
  LucidePieChart,
  LucideGlobe,
  LucideTag,
  LucideFilter,
  LucideCheckCircle2,
  LucideBarChart3,
  LucideHourglass,
  LucideBuilding2
} from '@lucide/angular';

interface RepStat {
  rep: { id: number; firstName: string; lastName: string; avatarUrl?: string };
  leadsOwned: number;
  leadsWon: number;
  winRate: number;
  valueWon: number;
  avgDealSize: number;
  followUpsLogged: number;
}

interface BucketStat {
  label: string;
  count: number;
  won: number;
  lost: number;
  valueWon: number;
  winRate: number;
}

interface AgingLead {
  id: number;
  companyName: string;
  title: string;
  status: string;
  value: number;
  daysOpen: number;
  assignedTo?: { firstName: string; lastName: string } | null;
}

interface DashboardData {
  range: { key: string; start: string; end: string };
  kpis: {
    totalPipelineValue: number;
    openLeadsCount: number;
    leadsCreatedThisPeriod: number;
    leadsCreatedPrevPeriod: number;
    leadsCreatedTrendPct: number | null;
    winRate: number;
    avgDealSize: number;
    avgSalesCycleDays: number;
    totalValueWon: number;
  };
  funnel: Record<string, number>;
  bySource: BucketStat[];
  byCategory: BucketStat[];
  topContacts: {
    name: string;
    email: string | null;
    leadsOwned: number;
    leadsWon: number;
    winRate: number;
    valueWon: number;
    avgDealSize: number;
  }[];
  topCompanies: {
    name: string;
    deals: number;
    leadsWon: number;
    winRate: number;
    valueWon: number;
    avgDealSize: number;
  }[];
  leaderboard: RepStat[];
  agingLeads: AgingLead[];
  trend: { weekStart: string; created: number; won: number }[];
  lostReasons: { reason: string; count: number }[];
}

@Component({
  selector: 'app-leads-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    StatCardComponent,
    ChartCardComponent,
    LucideArrowLeft,
    LucideTrendingUp,
    LucideTrendingDown,
    LucideUsers,
    LucideTarget,
    LucideClock,
    LucideIndianRupee,
    LucideAward,
    LucideAlertTriangle,
    LucideCalendar,
    LucideLoader2,
    LucideSparkles,
    LucideTrophy,
    LucidePieChart,
    LucideGlobe,
    LucideTag,
    LucideFilter,
    LucideCheckCircle2,
    LucideBarChart3,
    LucideHourglass,
    LucideBuilding2
  ],
  templateUrl: './leads-dashboard.html',
  styleUrls: ['./leads-dashboard.css']
})
export class LeadsDashboardComponent implements OnInit {
  private http = inject(HttpClient);
  private router = inject(Router);
  public auth = inject(AuthService);

  isLoading = signal<boolean>(true);
  error = signal<string | null>(null);
  data = signal<DashboardData | null>(null);

  range = signal<'this_month' | 'this_quarter' | 'this_year' | 'custom'>('this_month');
  customStart = '';
  customEnd = '';

  LEAD_STATUSES = [
    'New', 'Interested', 'Proposal Sent', 'Negotiation',
    'On Hold', 'Converted', 'Lost', 'Junk'
  ];

  ngOnInit() {
    if (!this.isAdmin()) {
      this.router.navigate(['/crm/leads']);
      return;
    }
    this.fetchDashboard();
  }

  isAdmin(): boolean {
    const role = this.auth.currentUser()?.role;
    return role === 'ADMIN' || role === 'SUPERADMIN';
  }

  goBack() {
    this.router.navigate(['/crm/leads']);
  }

  setRange(r: 'this_month' | 'this_quarter' | 'this_year' | 'custom') {
    this.range.set(r);
    if (r !== 'custom') this.fetchDashboard();
  }

  applyCustomRange() {
    if (this.customStart && this.customEnd) this.fetchDashboard();
  }

  fetchDashboard() {
    this.isLoading.set(true);
    this.error.set(null);

    const params: string[] = [`range=${this.range()}`];
    if (this.range() === 'custom' && this.customStart && this.customEnd) {
      params.push(`startDate=${this.customStart}`, `endDate=${this.customEnd}`);
    }

    this.http.get<DashboardData>(`${environment.apiUrl}/crm/leads/dashboard?${params.join('&')}`).subscribe({
      next: (res) => {
        this.data.set(res);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.message || 'Failed to load leads dashboard.');
        this.isLoading.set(false);
      }
    });
  }

  // --- Formatting helpers ---
  formatCurrency(v: number): string {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(v || 0);
  }

  formatCompact(v: number): string {
    return new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(v || 0);
  }

  formatPct(v: number): string {
    return `${(v || 0).toFixed(1)}%`;
  }

  formatDays(v: number): string {
    return `${Math.round(v || 0)} day${Math.round(v) === 1 ? '' : 's'}`;
  }

  // --- Contact / avatar helpers ---
  initialsOf(name: string | null | undefined): string {
    if (!name) return '?';
    return name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  }

  // --- Chart series builders ---
  funnelSeries = computed(() => {
    const d = this.data();
    if (!d) return [{ name: 'Leads', data: [] as number[] }];
    return [{ name: 'Leads', data: this.LEAD_STATUSES.map(s => d.funnel[s] || 0) }];
  });

  funnelCategories = computed(() => this.LEAD_STATUSES);

  trendSeries = computed(() => {
    const d = this.data();
    if (!d) return [];
    return [
      { name: 'Created', data: d.trend.map(t => t.created) },
      { name: 'Won', data: d.trend.map(t => t.won) }
    ];
  });

  trendCategories = computed(() => {
    const d = this.data();
    if (!d) return [];
    return d.trend.map(t => {
      const dt = new Date(t.weekStart);
      return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });
  });

  sourceValueSeries = computed(() => {
    const d = this.data();
    if (!d) return [{ name: 'Value Won', data: [] as number[] }];
    const top = d.bySource.slice(0, 6);
    return [{ name: 'Value Won', data: top.map(s => s.valueWon) }];
  });

  sourceValueCategories = computed(() => {
    const d = this.data();
    if (!d) return [];
    return d.bySource.slice(0, 6).map(s => s.label);
  });

  lostReasonsSeries = computed(() => {
    const d = this.data();
    if (!d) return [];
    return d.lostReasons.map(r => r.count);
  });

  lostReasonsLabels = computed(() => {
    const d = this.data();
    if (!d) return [];
    return d.lostReasons.map(r => r.reason);
  });

  trendUpPositive(pct: number | null): boolean {
    return pct !== null && pct >= 0;
  }
}
