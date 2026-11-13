import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../services/auth.service';
import { OnboardingService } from '../../../services/onboarding.service';
import { HotToastService } from '@ngneat/hot-toast';
import { Router } from '@angular/router';
import { EmployeeProfileComponent } from '../../../employees/employee-profile/employee-profile';

/**
 * Self-service onboarding (13 Nov 2026). Shown instead of the whole app to a
 * new joiner until HR approves their profile:
 *   1. set their own password (the emailed one is temporary),
 *   2. fill in their profile and submit it for review,
 *   3. wait for HR, who approves it or sends it back with notes per section.
 */
@Component({
  selector: 'app-self-onboarding-gate',
  standalone: true,
  imports: [CommonModule, FormsModule, EmployeeProfileComponent],
  templateUrl: './self-onboarding-gate.html',
  styleUrls: ['./self-onboarding-gate.css'],
})
export class SelfOnboardingGateComponent {
  private auth = inject(AuthService);
  private onboarding = inject(OnboardingService);
  private toast = inject(HotToastService);
  private router = inject(Router);

  user = this.auth.currentUser;
  step = computed<'password' | 'profile' | 'review'>(() => {
    const u = this.user();
    if (u?.mustChangePassword) return 'password';
    return u?.employee?.selfOnboardingStatus === 'SUBMITTED' ? 'review' : 'profile';
  });
  firstName = computed(() => this.user()?.employee?.firstName || 'there');

  // Step 1 — password
  newPassword = '';
  confirmPassword = '';
  showPassword = signal(false);
  savingPassword = signal(false);

  // Step 2 — profile
  notes = signal<{ key: string; label: string; note: string }[]>([]);
  submitting = signal(false);

  constructor() {
    this.loadNotes();
  }

  private loadNotes() {
    this.onboarding.getMySelfOnboarding().subscribe({
      next: (r) => this.notes.set(Object.entries(r.notes || {})
        .filter(([, v]) => !!v)
        .map(([k, v]) => ({ key: k, label: r.sections?.[k] || k, note: v }))),
      error: () => {},
    });
  }

  savePassword() {
    if (this.newPassword.length < 8) { this.toast.error('Use at least 8 characters.'); return; }
    if (this.newPassword !== this.confirmPassword) { this.toast.error('The two passwords don’t match.'); return; }
    this.savingPassword.set(true);
    this.auth.changePassword(this.newPassword).subscribe({
      next: () => {
        this.toast.success('Password set');
        this.newPassword = this.confirmPassword = '';
        this.auth.getMe().subscribe({ complete: () => this.savingPassword.set(false), error: () => this.savingPassword.set(false) });
      },
      error: (e) => { this.toast.error(e?.error?.message || 'Could not set the password'); this.savingPassword.set(false); },
    });
  }

  submitForReview() {
    this.submitting.set(true);
    this.onboarding.submitMySelfOnboarding().subscribe({
      next: () => {
        this.toast.success('Submitted for review');
        this.auth.getMe().subscribe({ complete: () => this.submitting.set(false), error: () => this.submitting.set(false) });
      },
      error: (e) => { this.toast.error(e?.error?.message || 'Could not submit'); this.submitting.set(false); },
    });
  }

  checkAgain() {
    this.auth.getMe().subscribe({
      next: (u: any) => {
        if (u?.employee?.selfOnboardingStatus === 'SUBMITTED') this.toast.success('Still under review — we’ll email you when it’s done.');
        this.loadNotes();
      },
    });
  }

  logout() {
    this.auth.logout();
    this.router.navigate(['/']);
  }
}
