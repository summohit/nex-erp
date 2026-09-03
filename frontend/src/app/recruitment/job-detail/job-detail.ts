import { Component, OnInit, signal, computed, inject } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  LucideArrowLeft, LucideSearch, LucideUsers, LucideCalendarClock,
  LucideBriefcase, LucideMapPin, LucideBuilding, LucideEye,
  LucidePlus, LucideX, LucideSparkles, LucideCheckCircle, LucideXCircle,
  LucideFileText, LucideMail, LucidePhone, LucideLink, LucideGlobe,
  LucideClock, LucideTrash2, LucideInbox, LucideStar, LucideAward,
  LucideLayoutGrid, LucideTable, LucideExternalLink, LucideDownload,
  LucideCopy, LucideCheck, LucideShare2, LucideChevronRight, LucideInfo,
  LucideMoreVertical, LucideCalendar, LucideDollarSign, LucideUserCheck, LucideUserX
} from '@lucide/angular';
import { HotToastService } from '@ngneat/hot-toast';
import { JobsService, Job } from '../../services/jobs.service';
import { CandidatesService, JobApplication } from '../../services/candidates.service';

@Component({
  selector: 'app-job-detail',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterLink, DatePipe,
    LucideArrowLeft, LucideSearch, LucideUsers, LucideCalendarClock,
    LucideBriefcase, LucideMapPin, LucideBuilding, LucideEye,
    LucidePlus, LucideX, LucideSparkles, LucideCheckCircle, LucideXCircle,
    LucideFileText, LucideMail, LucidePhone, LucideLink, LucideGlobe,
    LucideClock, LucideTrash2, LucideInbox, LucideStar, LucideAward,
    LucideLayoutGrid, LucideTable, LucideExternalLink, LucideDownload,
    LucideCopy, LucideCheck, LucideShare2, LucideChevronRight, LucideInfo,
    LucideMoreVertical, LucideCalendar, LucideDollarSign, LucideUserCheck, LucideUserX
  ],
  templateUrl: './job-detail.html',
  styleUrls: ['./job-detail.css']
})
export class JobDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private jobsService = inject(JobsService);
  private candidatesService = inject(CandidatesService);
  private toast = inject(HotToastService);

  jobId!: number;
  job = signal<(Job & { totalApplications: number; statusCounts: Record<string, number> }) | null>(null);
  applications = signal<JobApplication[]>([]);
  isLoading = signal(true);

  searchQuery = signal('');
  statusFilter = signal('ALL');
  viewMode = signal<'TABLE' | 'CARDS'>('TABLE');
  
  selectedApp = signal<JobApplication | null>(null);
  showJobModal = signal(false);
  isCopiedJobLink = signal(false);
  copiedEmailId = signal<number | null>(null);
  activeStatusMenuId = signal<number | null>(null);

  statusStages = [
    { key: 'ALL', label: 'All Candidates', icon: 'users', color: 'slate' },
    { key: 'NEW', label: 'New', icon: 'inbox', color: 'blue' },
    { key: 'REVIEWING', label: 'Reviewing', icon: 'eye', color: 'purple' },
    { key: 'SHORTLISTED', label: 'Shortlisted', icon: 'star', color: 'orange' },
    { key: 'INTERVIEWING', label: 'Interviewing', icon: 'users', color: 'amber' },
    { key: 'OFFERED', label: 'Offered', icon: 'award', color: 'teal' },
    { key: 'HIRED', label: 'Hired', icon: 'check-circle', color: 'emerald' },
    { key: 'ONBOARDED', label: 'Onboarded', icon: 'user-check', color: 'green' },
    { key: 'REJECTED', label: 'Rejected', icon: 'x-circle', color: 'rose' }
  ];

  pipelineStats = computed(() => {
    const apps = this.applications();
    const j = this.job();
    
    const counts: Record<string, number> = {
      ALL: apps.length,
      NEW: 0,
      REVIEWING: 0,
      SHORTLISTED: 0,
      INTERVIEWING: 0,
      OFFERED: 0,
      HIRED: 0,
      ONBOARDED: 0,
      REJECTED: 0
    };

    apps.forEach(a => {
      const st = a.status ? a.status.toUpperCase() : 'NEW';
      if (counts[st] !== undefined) {
        counts[st]++;
      }
    });

    const activePipeline = (counts['REVIEWING'] || 0) + (counts['SHORTLISTED'] || 0) + (counts['INTERVIEWING'] || 0) + (counts['OFFERED'] || 0);
    const hiredCount = (counts['HIRED'] || 0) + (counts['ONBOARDED'] || 0);
    const totalOpenings = j?.totalOpenings || 1;
    const progressPercent = Math.min(100, Math.round((hiredCount / totalOpenings) * 100));

    return {
      total: apps.length,
      activePipeline,
      hiredCount,
      totalOpenings,
      progressPercent,
      rejectedCount: counts['REJECTED'] || 0,
      counts
    };
  });

  filteredApplications = computed(() => {
    let list = this.applications();
    const q = this.searchQuery().trim().toLowerCase();
    const status = this.statusFilter();

    if (status && status !== 'ALL') {
      list = list.filter(a => (a.status || '').toUpperCase() === status);
    }
    if (q) {
      list = list.filter(a =>
        a.fullName?.toLowerCase().includes(q) ||
        a.email?.toLowerCase().includes(q) ||
        a.phone?.toLowerCase().includes(q) ||
        a.experienceYears?.toLowerCase().includes(q) ||
        a.noticePeriod?.toLowerCase().includes(q)
      );
    }
    return list;
  });

  ngOnInit() {
    this.route.params.subscribe(params => {
      this.jobId = +params['id'];
      this.load();
    });
  }

  load() {
    this.isLoading.set(true);
    this.jobsService.getJobDetail(this.jobId).subscribe({
      next: (job) => {
        this.job.set(job);
        this.isLoading.set(false);
      },
      error: () => {
        this.isLoading.set(false);
        this.toast.error('Failed to load job details');
      }
    });

    this.candidatesService.getApplications(this.jobId).subscribe({
      next: (apps) => this.applications.set(apps),
      error: () => this.toast.error('Failed to load candidate applications')
    });
  }

  getStageCount(key: string): number {
    return this.pipelineStats().counts[key] || 0;
  }

  selectStageFilter(key: string) {
    this.statusFilter.set(key);
  }

  statusBadgeClass(status: string): string {
    const s = (status || '').toUpperCase();
    switch (s) {
      case 'NEW': return 'badge-stage-new';
      case 'REVIEWING': return 'badge-stage-reviewing';
      case 'SHORTLISTED': return 'badge-stage-shortlisted';
      case 'INTERVIEWING': return 'badge-stage-interviewing';
      case 'OFFERED': return 'badge-stage-offered';
      case 'HIRED': return 'badge-stage-hired';
      case 'ONBOARDED': return 'badge-stage-onboarded';
      case 'REJECTED': return 'badge-stage-rejected';
      default: return 'badge-stage-default';
    }
  }

  updateCandidateStatus(app: JobApplication, newStatus: string, event?: Event) {
    if (event) {
      event.stopPropagation();
    }
    this.activeStatusMenuId.set(null);

    this.candidatesService.updateStatus(app.id, newStatus).subscribe({
      next: () => {
        this.toast.success(`Candidate moved to ${newStatus}`);
        this.applications.update(list =>
          list.map(item => item.id === app.id ? { ...item, status: newStatus } : item)
        );
        if (this.selectedApp()?.id === app.id) {
          this.selectedApp.update(current => current ? { ...current, status: newStatus } : null);
        }
      },
      error: () => this.toast.error('Failed to update candidate status')
    });
  }

  toggleStatusMenu(appId: number, event: Event) {
    event.stopPropagation();
    if (this.activeStatusMenuId() === appId) {
      this.activeStatusMenuId.set(null);
    } else {
      this.activeStatusMenuId.set(appId);
    }
  }

  closeStatusMenu() {
    this.activeStatusMenuId.set(null);
  }

  openCandidateQuickView(app: JobApplication) {
    this.selectedApp.set(app);
  }

  closeCandidateQuickView() {
    this.selectedApp.set(null);
  }

  openFullATS(app?: JobApplication) {
    if (app) {
      this.router.navigate(['/recruitment/candidates'], {
        queryParams: { jobId: this.jobId, applicationId: app.id }
      });
    } else {
      this.router.navigate(['/recruitment/candidates'], {
        queryParams: { jobId: this.jobId }
      });
    }
  }

  openJobDescriptionModal() {
    this.showJobModal.set(true);
  }

  closeJobDescriptionModal() {
    this.showJobModal.set(false);
  }

  /** Same story for the job's own question list — a JSON string on the wire. */
  parseQuestions(raw: string | null | undefined): string[] {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((q: any) => typeof q === 'string' && q.trim()) : [];
    } catch {
      return [raw];
    }
  }

  /** `answers` is stored as a JSON string; render it as Q/A pairs, not raw JSON. */
  parseAnswers(raw: string | null | undefined): { question: string; answer: string }[] {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(qa => qa?.question) : [];
    } catch {
      return [];
    }
  }

  copyJobLink() {
    const url = `${window.location.origin}/careers/${this.jobId}`;
    navigator.clipboard.writeText(url).then(() => {
      this.isCopiedJobLink.set(true);
      this.toast.success('Careers page link copied to clipboard!');
      setTimeout(() => this.isCopiedJobLink.set(false), 2500);
    });
  }

  copyEmail(email: string, id: number, event: Event) {
    event.stopPropagation();
    navigator.clipboard.writeText(email).then(() => {
      this.copiedEmailId.set(id);
      this.toast.success('Email copied to clipboard');
      setTimeout(() => this.copiedEmailId.set(null), 2000);
    });
  }

  getInitials(name: string): string {
    if (!name) return 'CA';
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

  exportCSV() {
    const list = this.filteredApplications();
    if (list.length === 0) {
      this.toast.error('No applicants to export');
      return;
    }

    const headers = ['Candidate ID', 'Name', 'Email', 'Phone', 'Status', 'Experience', 'Notice Period', 'Applied Date'];
    const rows = list.map(app => [
      app.id,
      `"${(app.fullName || '').replace(/"/g, '""')}"`,
      `"${(app.email || '').replace(/"/g, '""')}"`,
      `"${(app.phone || '').replace(/"/g, '""')}"`,
      app.status || 'NEW',
      `"${app.experienceYears || ''}"`,
      `"${app.noticePeriod || ''}"`,
      app.createdAt ? new Date(app.createdAt).toLocaleDateString() : ''
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    const jobTitle = (this.job()?.title || 'job').replace(/[^a-zA-Z0-9]/g, '_');
    link.setAttribute('download', `Applicants_${jobTitle}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    this.toast.success('Applicants CSV downloaded');
  }

  goBack() {
    this.router.navigate(['/recruitment/jobs']);
  }
}
