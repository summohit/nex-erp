import { Component, signal, OnInit, inject } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { HotToastService } from '@ngneat/hot-toast';
import { 
  LucideCalendar, LucideClock, LucideVideo, LucideFileText, 
  LucideStar, LucideMessageSquare 
} from '@lucide/angular';

@Component({
  selector: 'app-interviews',
  standalone: true,
  imports: [
    CommonModule, FormsModule, 
    LucideCalendar, LucideClock, LucideVideo, 
    LucideFileText, LucideStar, LucideMessageSquare
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
        this.interviews.set(res);
        this.isLoading.set(false);
      },
      error: () => {
        this.toast.error('Failed to load interviews');
        this.isLoading.set(false);
      }
    });
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

  submitFeedback() {
    const interview = this.selectedInterview();
    if (!interview) return;
    
    if (this.feedbackRating() === 0) {
      this.toast.error('Please provide a rating from 1 to 5 stars');
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
        this.toast.success('Feedback submitted successfully!');
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
