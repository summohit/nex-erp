import { Component, signal, computed, OnInit, inject } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { HotToastService } from '@ngneat/hot-toast';
import { 
  LucideCalendar, LucideClock, LucideVideo, LucideFileText, 
  LucideStar, LucideMessageSquare, LucideSearch, LucideBriefcase,
  LucideCheckCircle2, LucideAlertCircle, LucideExternalLink,
  LucideRotateCcw, LucideX, LucideUsers, LucideCheck, LucideMail, LucidePhone,
  LucideArrowLeft, LucideChevronRight
} from '@lucide/angular';

export type InterviewTab = 'all' | 'upcoming' | 'needs-review' | 'completed';

@Component({
  selector: 'app-interviews',
  standalone: true,
  imports: [
    CommonModule, FormsModule, DatePipe, RouterLink,
    LucideCalendar, LucideClock, LucideVideo, 
    LucideFileText, LucideStar, LucideMessageSquare,
    LucideSearch, LucideBriefcase, LucideCheckCircle2,
    LucideAlertCircle, LucideExternalLink, LucideRotateCcw,
    LucideX, LucideUsers, LucideCheck, LucideMail, LucidePhone,
    LucideArrowLeft, LucideChevronRight
  ],
  templateUrl: './interviews.html',
  styleUrls: ['./interviews.css'],
  providers: [DatePipe]
})
export class InterviewsComponent implements OnInit {
  private http = inject(HttpClient);
  private toast = inject(HotToastService);

  interviews = signal<any[]>([]);
  isLoading = signal(true);
  
  // Search and tabs
  searchText = signal('');
  activeTab = signal<InterviewTab>('all');

  // Quick feedback tags
  readonly feedbackTags = [
    'Strong Technical Knowledge',
    'Clear Communication',
    'Relevant Domain Experience',
    'Good Problem Solver',
    'Culture & Values Alignment',
    'Lacks Core Experience',
    'Strong Hire'
  ];

  // Stats
  stats = computed(() => {
    const list = this.interviews();
    const total = list.length;
    const now = new Date();
    const completed = list.filter(i => !!i.rating || i.status === 'COMPLETED').length;
    const needsReview = list.filter(i => !i.rating && i.status !== 'COMPLETED').length;
    const upcoming = list.filter(i => !i.rating && i.status !== 'COMPLETED' && new Date(i.scheduledAt) >= now).length;
    return { total, upcoming, needsReview, completed };
  });

  // Filtered interviews
  filteredInterviews = computed(() => {
    const list = this.interviews();
    const tab = this.activeTab();
    const q = this.searchText().toLowerCase().trim();
    const now = new Date();

    return list.filter(i => {
      // Tab filter
      const isCompleted = !!i.rating || i.status === 'COMPLETED';
      const isScheduledUpcoming = !isCompleted && new Date(i.scheduledAt) >= now;
      const isNeedsReview = !isCompleted;

      if (tab === 'completed' && !isCompleted) return false;
      if (tab === 'upcoming' && !isScheduledUpcoming) return false;
      if (tab === 'needs-review' && !isNeedsReview) return false;

      // Text search
      if (!q) return true;
      const candName = (i.application?.fullName || '').toLowerCase();
      const jobTitle = (i.application?.job?.title || '').toLowerCase();
      const roundTitle = (i.title || '').toLowerCase();
      const email = (i.application?.email || '').toLowerCase();
      return candName.includes(q) || jobTitle.includes(q) || roundTitle.includes(q) || email.includes(q);
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
      }
    });
  }

  setTab(tab: InterviewTab) {
    this.activeTab.set(tab);
  }

  clearSearch() {
    this.searchText.set('');
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
      case 1: return '1 / 5 • Poor Fit / Do Not Advance';
      case 2: return '2 / 5 • Below Expectations';
      case 3: return '3 / 5 • Meets Expectations';
      case 4: return '4 / 5 • Strong Candidate / Advance';
      case 5: return '5 / 5 • Exceptional / Strong Hire';
      default: return 'Click a star to assign rating (1 to 5)';
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
    const colors = ['#2A97D8', '#6366F1', '#EC4899', '#8B5CF6', '#10B981', '#F59E0B', '#06B6D4', '#3B82F6'];
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
      feedback: this.feedbackNotes()
    };

    this.http.put(`${environment.apiUrl}/recruitment/applications/interviews/${interview.id}`, payload).subscribe({
      next: () => {
        this.toast.success('Interview feedback saved successfully!');
        this.fetchMyInterviews();
        this.closeFeedbackModal();
        this.isSubmittingFeedback.set(false);
      },
      error: () => {
        this.toast.error('Failed to submit feedback');
        this.isSubmittingFeedback.set(false);
      }
    });
  }
}
