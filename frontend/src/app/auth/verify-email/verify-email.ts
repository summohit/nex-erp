import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { LucideCheckCircle2, LucideXCircle, LucideLoader2 } from '@lucide/angular';

@Component({
  selector: 'app-verify-email',
  standalone: true,
  imports: [CommonModule, RouterLink, LucideCheckCircle2, LucideXCircle, LucideLoader2],
  templateUrl: './verify-email.html',
  styleUrls: ['./verify-email.css']
})
export class VerifyEmailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private http = inject(HttpClient);

  status = signal<'verifying' | 'success' | 'error'>('verifying');
  errorMessage = signal<string>('');

  ngOnInit() {
    this.route.queryParams.subscribe(params => {
      const token = params['token'];
      if (!token) {
        this.status.set('error');
        this.errorMessage.set('Invalid or missing verification token.');
        return;
      }
      this.verifyToken(token);
    });
  }

  verifyToken(token: string) {
    this.http.post(`${environment.apiUrl}/auth/verify`, { token }).subscribe({
      next: () => {
        this.status.set('success');
      },
      error: (err) => {
        this.status.set('error');
        this.errorMessage.set(err.error?.message || 'Verification failed. The token may be expired or invalid.');
      }
    });
  }
}
