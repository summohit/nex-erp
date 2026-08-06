import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideMail, LucideArrowRight, LucideRefreshCw } from '@lucide/angular';
import { HttpClient } from '@angular/common/http';
import { HotToastService } from '@ngneat/hot-toast';
import { environment } from '../../../environments/environment';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-check-email',
  standalone: true,
  imports: [RouterLink, LucideMail, LucideArrowRight, LucideRefreshCw, CommonModule],
  templateUrl: './check-email.html',
  styleUrls: ['./check-email.css']
})
export class CheckEmailComponent implements OnInit {
  email = signal<string | null>(null);
  isResending = signal(false);
  cooldown = signal(0);
  
  private http = inject(HttpClient);
  private toast = inject(HotToastService);
  private cooldownInterval: any;

  ngOnInit() {
    const savedEmail = sessionStorage.getItem('pendingVerificationEmail');
    if (savedEmail) {
      this.email.set(savedEmail);
    }
  }

  resendEmail() {
    const currentEmail = this.email();
    if (!currentEmail) {
      this.toast.error('Email not found. Please log in again.');
      return;
    }

    if (this.cooldown() > 0) return;

    this.isResending.set(true);
    this.http.post(`${environment.apiUrl}/auth/resend-verification`, { email: currentEmail })
      .subscribe({
        next: (res: any) => {
          this.isResending.set(false);
          this.toast.success('Verification email resent successfully! Check your inbox.');
          this.startCooldown();
        },
        error: (err) => {
          this.isResending.set(false);
          this.toast.error(err.error?.message || 'Failed to resend email.');
        }
      });
  }

  startCooldown() {
    this.cooldown.set(60);
    this.cooldownInterval = setInterval(() => {
      if (this.cooldown() > 0) {
        this.cooldown.update(c => c - 1);
      } else {
        clearInterval(this.cooldownInterval);
      }
    }, 1000);
  }
}
