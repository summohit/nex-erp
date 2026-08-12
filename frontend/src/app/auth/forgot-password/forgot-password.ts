import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { LucideMail, LucideArrowRight, LucideRefreshCw, LucideKeyRound, LucideShieldCheck } from '@lucide/angular';
import { HotToastService } from '@ngneat/hot-toast';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideMail,
    LucideArrowRight,
    LucideRefreshCw,
    LucideKeyRound,
    LucideShieldCheck
  ],
  templateUrl: './forgot-password.html',
  styleUrls: ['./forgot-password.css']
})
export class ForgotPasswordComponent {
  private authService = inject(AuthService);
  private toast = inject(HotToastService);
  private router = inject(Router);

  step: 'email' | 'otp' = 'email';
  email = '';
  otp = '';
  newPassword = '';
  confirmPassword = '';

  isSubmitting = signal(false);
  showPassword = signal(false);

  emailValid(): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email.trim());
  }

  sendCode() {
    if (!this.emailValid()) {
      this.toast.error('Please enter a valid email address.');
      return;
    }

    this.isSubmitting.set(true);
    this.authService.forgotPassword(this.email.trim()).subscribe({
      next: (res) => {
        this.isSubmitting.set(false);
        this.toast.success(res?.message || 'Password reset code sent. Check your inbox.');
        this.otp = '';
        this.newPassword = '';
        this.confirmPassword = '';
        this.step = 'otp';
      },
      error: (err) => {
        this.isSubmitting.set(false);
        this.toast.error(err.error?.message || 'Failed to send password reset code.');
      }
    });
  }

  resendCode() {
    if (this.isSubmitting()) return;
    this.sendCode();
  }

  resetPassword() {
    if (!this.otp.trim()) {
      this.toast.error('Please enter the verification code.');
      return;
    }
    if (this.newPassword.length < 8) {
      this.toast.error('New password must be at least 8 characters.');
      return;
    }
    if (this.newPassword !== this.confirmPassword) {
      this.toast.error('Passwords do not match.');
      return;
    }

    this.isSubmitting.set(true);
    this.authService.resetPassword({
      email: this.email.trim(),
      otp: this.otp.trim(),
      newPassword: this.newPassword
    }).subscribe({
      next: (res) => {
        this.isSubmitting.set(false);
        this.toast.success(res?.message || 'Password reset successfully!');
        this.router.navigate(['/']);
      },
      error: (err) => {
        this.isSubmitting.set(false);
        this.toast.error(err.error?.message || 'Failed to reset password. Please try again.');
      }
    });
  }

  togglePassword() {
    this.showPassword.update(v => !v);
  }

  goToLogin() {
    this.router.navigate(['/']);
  }
}
