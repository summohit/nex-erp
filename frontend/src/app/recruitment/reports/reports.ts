import { Component, OnInit, signal, computed, inject } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  LucideBarChart3, LucideClock, LucideUsers, LucideArrowLeft,
  LucideSearch, LucideFilter, LucideDownload, LucideExternalLink,
  LucideBriefcase, LucideBuilding, LucideMapPin, LucideCheckCircle,
  LucideXCircle, LucideSparkles, LucideAward, LucideTrendingUp,
  LucideChevronRight, LucideX, LucideFileText
} from '@lucide/angular';
import { CandidatesService } from '../../services/candidates.service';
import { HotToastService } from '@ngneat/hot-toast';

export interface JobReportItem {
  jobId: number;
  jobTitle: string;
  department?: string;
  branch?: string;
  type?: string;
  status?: string;
  totalOpenings?: number;
  total: number;
  pipeline: Record<string, number>;
}

export interface RecruiterReportItem {
  recruiterId?: number | null;
  recruiterName: string;
  avatarUrl?: string | null;
  email?: string | null;
  designation?: string | null;
  department?: string | null;
  total: number;
  hired: number;
}

@Component({
  selector: 'app-hiring-reports',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterLink, DatePipe,
    LucideBarChart3, LucideClock, LucideUsers, LucideArrowLeft,
    LucideSearch, LucideFilter, LucideDownload, LucideExternalLink,
    LucideBriefcase, LucideBuilding, LucideMapPin, LucideCheckCircle,
    LucideXCircle, LucideSparkles, LucideAward, LucideTrendingUp,
    LucideChevronRight, LucideX, LucideFileText
  ],
  templateUrl: './reports.html',
  styleUrls: ['./reports.css']
})
export class HiringReportsComponent implements OnInit {
  private candidatesService = inject(CandidatesService);
  private router = inject(Router);
  private toast = inject(HotToastService);

  data = signal<{
    perJob: JobReportItem[];
    perRecruiter: RecruiterReportItem[];
    averageTimeToHireDays: number | null;
    timeToHireNote?: string;
  } | null>(null);

  isLoading = signal(true);
  activeTab = signal<'JOB' | 'RECRUITER'>('JOB');
  Math = Math;

  // Filters
  searchQuery = signal('');
  selectedDepartment = signal('ALL');
  selectedBranch = signal('ALL');
  selectedVolume = signal('ALL');
  selectedStageFilter = signal('ALL');
  sortBy = signal<'TOTAL_DESC' | 'TOTAL_ASC' | 'HIRED_DESC' | 'REJECTED_DESC' | 'TITLE_ASC'>('TOTAL_DESC');

  statusKeys = ['NEW', 'REVIEWING', 'SHORTLISTED', 'INTERVIEWING', 'OFFERED', 'HIRED', 'ONBOARDED', 'REJECTED'];

  // Dynamic filter options extracted from real data
  departments = computed(() => {
    const list = this.data()?.perJob || [];
    const set = new Set<string>();
    list.forEach(j => {
      if (j.department) set.add(j.department);
    });
    return Array.from(set).sort();
  });

  branches = computed(() => {
    const list = this.data()?.perJob || [];
    const set = new Set<string>();
    list.forEach(j => {
      if (j.branch) set.add(j.branch);
    });
    return Array.from(set).sort();
  });

  // Overall KPI Summary
  kpiSummary = computed(() => {
    const d = this.data();
    if (!d) return { totalApps: 0, totalJobs: 0, totalHires: 0, avgDays: null, totalRejected: 0, conversionRate: 0 };

    let totalApps = 0;
    let totalHires = 0;
    let totalRejected = 0;

    (d.perJob || []).forEach(j => {
      totalApps += j.total || 0;
      totalHires += (j.pipeline['HIRED'] || 0) + (j.pipeline['ONBOARDED'] || 0);
      totalRejected += (j.pipeline['REJECTED'] || 0);
    });

    const conversionRate = totalApps > 0 ? Math.round((totalHires / totalApps) * 100) : 0;

    return {
      totalApps,
      totalJobs: d.perJob.length,
      totalHires,
      totalRejected,
      avgDays: d.averageTimeToHireDays,
      conversionRate
    };
  });

  // Filtered and Sorted Jobs
  filteredJobs = computed(() => {
    const d = this.data();
    if (!d) return [];
    let list = [...(d.perJob || [])];

    const q = this.searchQuery().trim().toLowerCase();
    const dept = this.selectedDepartment();
    const branch = this.selectedBranch();
    const vol = this.selectedVolume();
    const stage = this.selectedStageFilter();

    // 1. Search Query
    if (q) {
      list = list.filter(j => 
        j.jobTitle?.toLowerCase().includes(q) ||
        j.department?.toLowerCase().includes(q) ||
        j.branch?.toLowerCase().includes(q)
      );
    }

    // 2. Department Filter
    if (dept !== 'ALL') {
      list = list.filter(j => j.department === dept);
    }

    // 3. Branch / Location Filter
    if (branch !== 'ALL') {
      list = list.filter(j => j.branch === branch);
    }

    // 4. Volume Range Filter
    if (vol === 'HIGH') {
      list = list.filter(j => j.total >= 20);
    } else if (vol === 'MEDIUM') {
      list = list.filter(j => j.total >= 5 && j.total < 20);
    } else if (vol === 'LOW') {
      list = list.filter(j => j.total > 0 && j.total < 5);
    }

    // 5. Stage Outcome Filter
    if (stage === 'HAS_HIRES') {
      list = list.filter(j => (j.pipeline['HIRED'] || 0) + (j.pipeline['ONBOARDED'] || 0) > 0);
    } else if (stage === 'HAS_OFFERS') {
      list = list.filter(j => (j.pipeline['OFFERED'] || 0) > 0);
    } else if (stage === 'HAS_REJECTIONS') {
      list = list.filter(j => (j.pipeline['REJECTED'] || 0) > 0);
    } else if (stage === 'ALL_NEW') {
      list = list.filter(j => (j.pipeline['NEW'] || 0) === j.total);
    }

    // 6. Sorting
    const sort = this.sortBy();
    list.sort((a, b) => {
      switch (sort) {
        case 'TOTAL_DESC': return b.total - a.total;
        case 'TOTAL_ASC': return a.total - b.total;
        case 'HIRED_DESC': 
          const hiredA = (a.pipeline['HIRED'] || 0) + (a.pipeline['ONBOARDED'] || 0);
          const hiredB = (b.pipeline['HIRED'] || 0) + (b.pipeline['ONBOARDED'] || 0);
          return hiredB - hiredA;
        case 'REJECTED_DESC': return (b.pipeline['REJECTED'] || 0) - (a.pipeline['REJECTED'] || 0);
        case 'TITLE_ASC': return a.jobTitle.localeCompare(b.jobTitle);
        default: return 0;
      }
    });

    return list;
  });

  // Filtered Recruiters
  filteredRecruiters = computed(() => {
    const d = this.data();
    if (!d) return [];
    let list = [...(d.perRecruiter || [])];
    const q = this.searchQuery().trim().toLowerCase();

    if (q) {
      list = list.filter(r => r.recruiterName?.toLowerCase().includes(q));
    }

    list.sort((a, b) => b.total - a.total);
    return list;
  });

  ngOnInit() {
    this.candidatesService.getHiringReports().subscribe({
      next: (res) => {
        this.data.set(res);
        this.isLoading.set(false);
      },
      error: () => {
        this.isLoading.set(false);
        this.toast.error('Failed to load hiring reports');
      }
    });
  }

  pipelineCount(pipeline: Record<string, number>, key: string): number {
    return pipeline?.[key] || 0;
  }

  getStagePercent(pipeline: Record<string, number>, key: string, total: number): number {
    if (!total || total === 0) return 0;
    const count = pipeline?.[key] || 0;
    return Math.round((count / total) * 100);
  }

  resetFilters() {
    this.searchQuery.set('');
    this.selectedDepartment.set('ALL');
    this.selectedBranch.set('ALL');
    this.selectedVolume.set('ALL');
    this.selectedStageFilter.set('ALL');
    this.sortBy.set('TOTAL_DESC');
  }

  navigateToJob(jobId: number, event?: Event) {
    if (event) event.stopPropagation();
    this.router.navigate(['/recruitment/jobs', jobId]);
  }

  navigateToATS(jobId: number, event?: Event) {
    if (event) event.stopPropagation();
    this.router.navigate(['/recruitment/candidates'], { queryParams: { jobId } });
  }

  exportReportCSV() {
    const jobs = this.filteredJobs();
    if (jobs.length === 0) {
      this.toast.error('No jobs to export');
      return;
    }

    const headers = ['Job ID', 'Job Title', 'Department', 'Location', 'Total Applications', ...this.statusKeys];
    const rows = jobs.map(j => [
      j.jobId,
      `"${(j.jobTitle || '').replace(/"/g, '""')}"`,
      `"${(j.department || '').replace(/"/g, '""')}"`,
      `"${(j.branch || '').replace(/"/g, '""')}"`,
      j.total,
      ...this.statusKeys.map(k => this.pipelineCount(j.pipeline, k))
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Hiring_Report_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    this.toast.success('Hiring report CSV downloaded');
  }

  getInitials(name: string): string {
    if (!name) return 'UN';
    const parts = name.trim().split(' ').filter(p => p.length > 0);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }

  getAvatarColor(name: string): string {
    const colors = [
      '#4f46e5', '#2563eb', '#0891b2', '#059669', '#d97706',
      '#dc2626', '#7c3aed', '#db2777', '#0284c7', '#16a34a'
    ];
    let hash = 0;
    for (let i = 0; i < (name || '').length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % colors.length;
    return colors[index];
  }
}
