import { Component, signal, computed, OnInit, inject } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { HotToastService } from '@ngneat/hot-toast';
import {
  LucideCalendar,
  LucideClock,
  LucideVideo,
  LucideFileText,
  LucideStar,
  LucideMessageSquare,
  LucideSearch,
  LucideBriefcase,
  LucideCheckCircle2,
  LucideAlertCircle,
  LucideExternalLink,
  LucideRotateCcw,
  LucideX,
  LucideArrowLeft,
  LucideChevronRight,
} from '@lucide/angular';

export type InterviewTab = 'all' | 'upcoming' | 'needs-review' | 'completed';

@Component({
  selector: 'app-interviews',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DatePipe,
    RouterLink,
    LucideCalendar,
    LucideClock,
    LucideVideo,
    LucideFileText,
    LucideStar,
    LucideMessageSquare,
    LucideSearch,
    LucideBriefcase,
    LucideCheckCircle2,
    LucideAlertCircle,
    LucideExternalLink,
    LucideRotateCcw,
    LucideX,
    LucideArrowLeft,
    LucideChevronRight,
  ],
  templateUrl: './interviews.html',
  styleUrls: ['./interviews.css'],
  providers: [DatePipe],
})
export class InterviewsComponent implements OnInit {
  private http = inject(HttpClient);
  private toast = inject(HotToastService);

  interviews = signal<any[]>([]);
  isLoading = signal(true);

  // Search, tabs, and filters
  searchText = signal('');
  activeTab = signal<InterviewTab>('all');
  dateFilter = signal<string>('all');
  customStartDate = signal<string>('');
  customEndDate = signal<string>('');
  interviewerFilter = signal<string>('');
  jobFilter = signal<string>('');
  roundFilter = signal<string>('');
  sortOrder = signal<'NEWEST' | 'OLDEST'>('NEWEST');

  // Quick feedback tags
  readonly feedbackTags = [
    'Strong Technical Knowledge',
    'Clear Communication',
    'Relevant Domain Experience',
    'Good Problem Solver',
    'Culture & Values Alignment',
    'Lacks Core Experience',
    'Strong Hire',
  ];

  // Stats
  stats = computed(() => {
    const list = this.interviews();
    const total = list.length;
    const now = new Date();
    const completed = list.filter((i) => !!i.rating || i.status === 'COMPLETED').length;
    const needsReview = list.filter((i) => !i.rating && i.status !== 'COMPLETED').length;
    const upcoming = list.filter(
      (i) => !i.rating && i.status !== 'COMPLETED' && new Date(i.scheduledAt) >= now
    ).length;
    return { total, upcoming, needsReview, completed };
  });

  availableJobs = computed(() => {
    const set = new Set<string>();
    for (const i of this.interviews()) {
      const title = (i.application?.job?.title || '').trim();
      if (title) set.add(title);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  });

  availableRounds = computed(() => {
    const set = new Set<string>();
    for (const i of this.interviews()) {
      const round = (i.title || '').trim();
      if (round) set.add(round);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  });

  availableInterviewers = computed(() => {
    const people = new Map<string, string>();
    for (const interview of this.interviews()) {
      const person = interview.interviewer;
      if (!person?.id) continue;
      people.set(String(person.id), `${person.firstName || ''} ${person.lastName || ''}`.trim() || 'Unnamed interviewer');
    }
    return [...people.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  });

  hasActiveFilters = computed(() => {
    return !!(
      this.searchText().trim() ||
      this.activeTab() !== 'all' ||
      this.dateFilter() !== 'all' ||
      this.customStartDate() ||
      this.customEndDate() ||
      this.interviewerFilter() ||
      this.jobFilter() ||
      this.roundFilter()
    );
  });

  // Filtered & sorted interviews (Newest First by default)
  filteredInterviews = computed(() => {
    const list = this.interviews();
    const tab = this.activeTab();
    const q = this.searchText().toLowerCase().trim();
    const dateF = this.dateFilter();
    const interviewerF = this.interviewerFilter();
    const jobF = this.jobFilter();
    const roundF = this.roundFilter();
    const order = this.sortOrder();
    const startStr = this.customStartDate();
    const endStr = this.customEndDate();
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    return list
      .filter((i) => {
        // Tab filter
        const isCompleted = !!i.rating || i.status === 'COMPLETED';
        const isScheduledUpcoming = !isCompleted && new Date(i.scheduledAt) >= now;
        const isNeedsReview = !isCompleted;

        if (tab === 'completed' && !isCompleted) return false;
        if (tab === 'upcoming' && !isScheduledUpcoming) return false;
        if (tab === 'needs-review' && !isNeedsReview) return false;

        if (interviewerF && String(i.interviewer?.id || '') !== interviewerF) return false;

        // Job Role Filter
        if (jobF && (i.application?.job?.title || '').trim() !== jobF) return false;

        // Interview Round Filter
        if (roundF && (i.title || '').trim() !== roundF) return false;

        // Custom start/end date filter (applies whenever customStartDate or customEndDate is set)
        if (startStr || endStr) {
          const d = new Date(i.scheduledAt);
          if (startStr) {
            const start = new Date(startStr + 'T00:00:00');
            if (d < start) return false;
          }
          if (endStr) {
            const endDay = new Date(endStr + 'T23:59:59.999');
            if (d > endDay) return false;
          }
        } else if (dateF !== 'all' && dateF !== 'custom') {
          const d = new Date(i.scheduledAt);
          if (dateF === 'today') {
            if (d < today || d >= new Date(today.getTime() + 86400000)) return false;
          } else if (dateF === 'this_week') {
            const day = now.getDay();
            const diff = now.getDate() - day + (day === 0 ? -6 : 1);
            const monday = new Date(now.getTime());
            monday.setDate(diff);
            monday.setHours(0, 0, 0, 0);
            const nextMonday = new Date(monday.getTime() + 7 * 86400000);
            if (d < monday || d >= nextMonday) return false;
          } else if (dateF === 'this_month') {
            if (d.getMonth() !== now.getMonth() || d.getFullYear() !== now.getFullYear()) return false;
          } else if (dateF === 'last_month') {
            let prevMonth = now.getMonth() - 1;
            let year = now.getFullYear();
            if (prevMonth < 0) {
              prevMonth = 11;
              year--;
            }
            if (d.getMonth() !== prevMonth || d.getFullYear() !== year) return false;
          } else if (dateF === 'last_30') {
            const thirtyDaysAgo = new Date(today.getTime() - 30 * 86400000);
            if (d < thirtyDaysAgo) return false;
          } else if (dateF === 'last_90') {
            const ninetyDaysAgo = new Date(today.getTime() - 90 * 86400000);
            if (d < ninetyDaysAgo) return false;
          } else if (dateF === 'this_year') {
            if (d.getFullYear() !== now.getFullYear()) return false;
          } else if (dateF === 'last_year') {
            if (d.getFullYear() !== now.getFullYear() - 1) return false;
          }
        }

        // Text search
        if (!q) return true;
        const candName = (i.application?.fullName || '').toLowerCase();
        const jobTitle = (i.application?.job?.title || '').toLowerCase();
        const roundTitle = (i.title || '').toLowerCase();
        const email = (i.application?.email || '').toLowerCase();
        return (
          candName.includes(q) ||
          jobTitle.includes(q) ||
          roundTitle.includes(q) ||
          email.includes(q)
        );
      })
      .sort((a, b) => {
        const ta = new Date(a.scheduledAt || a.createdAt || 0).getTime();
        const tb = new Date(b.scheduledAt || b.createdAt || 0).getTime();
        return order === 'NEWEST' ? tb - ta : ta - tb;
      });
  });

  // Feedback modal
  selectedInterview = signal<any>(null);
  feedbackNotes = signal('');
  feedbackRating = signal(0);
  isFeedbackModalOpen = signal(false);
  isSubmittingFeedback = signal(false);

  ngOnInit() {
    this.fetchMyInterviews();
  }

  fetchMyInterviews() {
    this.isLoading.set(true);
    this.http.get<any[]>(`${environment.apiUrl}/recruitment/applications/my-interviews`).subscribe({
      next: (res) => {
        this.interviews.set(res || []);
        this.isLoading.set(false);
      },
      error: () => {
        this.toast.error('Failed to load interviews');
        this.isLoading.set(false);
      },
    });
  }

  setTab(tab: InterviewTab) {
    this.activeTab.set(tab);
  }

  onDateFilterChange(val: string) {
    this.dateFilter.set(val || 'all');
    if (val !== 'custom') {
      this.customStartDate.set('');
      this.customEndDate.set('');
    }
  }

  onStartDateChange(val: string) {
    this.customStartDate.set(val || '');
    this.dateFilter.set(val || this.customEndDate() ? 'custom' : 'all');
  }

  onEndDateChange(val: string) {
    this.customEndDate.set(val || '');
    this.dateFilter.set(this.customStartDate() || val ? 'custom' : 'all');
  }

  clearCustomDates() {
    this.customStartDate.set('');
    this.customEndDate.set('');
    if (this.dateFilter() === 'custom') {
      this.dateFilter.set('all');
    }
  }

  toggleSort() {
    this.sortOrder.update((curr) => (curr === 'NEWEST' ? 'OLDEST' : 'NEWEST'));
  }

  clearSearch() {
    this.searchText.set('');
  }

  resetAllFilters() {
    this.searchText.set('');
    this.activeTab.set('all');
    this.dateFilter.set('all');
    this.customStartDate.set('');
    this.customEndDate.set('');
    this.interviewerFilter.set('');
    this.jobFilter.set('');
    this.roundFilter.set('');
    this.sortOrder.set('NEWEST');
  }

  openFeedbackModal(interview: any) {
    this.selectedInterview.set(interview);
    this.feedbackNotes.set(interview.feedback || '');
    this.feedbackRating.set(interview.rating || 0);
    this.isFeedbackModalOpen.set(true);
  }

  closeFeedbackModal() {
    this.isFeedbackModalOpen.set(false);
    this.selectedInterview.set(null);
  }

  setRating(rating: number) {
    this.feedbackRating.set(rating);
  }

  getRatingLabel(stars: number): string {
    switch (stars) {
      case 1:
        return '1 / 5 • Poor Fit / Do Not Advance';
      case 2:
        return '2 / 5 • Below Expectations';
      case 3:
        return '3 / 5 • Meets Expectations';
      case 4:
        return '4 / 5 • Strong Candidate / Advance';
      case 5:
        return '5 / 5 • Exceptional / Strong Hire';
      default:
        return 'Click a star to assign rating (1 to 5)';
    }
  }

  addTagToNotes(tag: string) {
    const current = this.feedbackNotes().trim();
    if (!current) {
      this.feedbackNotes.set(`• ${tag}`);
    } else if (!current.includes(tag)) {
      this.feedbackNotes.set(`${current}\n• ${tag}`);
    }
  }

  getInitials(name?: string): string {
    if (!name) return 'CA';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }

  getAvatarBg(name?: string): string {
    if (!name) return '#64748B';
    const colors = ['#2A97D8', '#6366F1', '#6b3fd6', '#8B5CF6', '#10B981', '#06B6D4', '#3B82F6'];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  }

  isUpcoming(dateStr: string): boolean {
    return new Date(dateStr) >= new Date();
  }

  submitFeedback() {
    const interview = this.selectedInterview();
    if (!interview) return;

    if (this.feedbackRating() === 0) {
      this.toast.error('Please select a star rating between 1 and 5');
      return;
    }

    this.isSubmittingFeedback.set(true);
    const payload = {
      status: 'COMPLETED',
      rating: this.feedbackRating(),
      feedback: this.feedbackNotes(),
    };

    this.http
      .put(`${environment.apiUrl}/recruitment/applications/interviews/${interview.id}`, payload)
      .subscribe({
        next: () => {
          this.toast.success('Interview feedback saved successfully!');
          this.fetchMyInterviews();
          this.closeFeedbackModal();
          this.isSubmittingFeedback.set(false);
        },
        error: () => {
          this.toast.error('Failed to submit feedback');
          this.isSubmittingFeedback.set(false);
        },
      });
  }
}
