import { Component, ElementRef, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../services/auth.service';
import { OnboardingService } from '../../../services/onboarding.service';
import { HotToastService } from '@ngneat/hot-toast';
import { Router } from '@angular/router';
import { EmployeeProfileComponent } from '../../../employees/employee-profile/employee-profile';
import { of, switchMap } from 'rxjs';
import {
  LucideAlertCircle,
  LucideArrowRight,
  LucideBuilding2,
  LucideCheck,
  LucideCheckCircle2,
  LucideClock,
  LucideEye,
  LucideEyeOff,
  LucideKeyRound,
  LucideLock,
  LucideLogOut,
  LucideRefreshCw,
  LucideSend,
  LucideShieldCheck,
  LucideSparkles,
  LucideUser,
  LucideUserCheck,
} from '@lucide/angular';

/**
 * Self-service onboarding (13 Nov 2026). Shown instead of the whole app to a
 * new joiner until HR approves their profile:
 *   1. set their own password (the emailed one is temporary),
 *   2. fill in their profile and submit it for review,
 *   3. wait for HR, who approves it or sends it back with notes per section.
 */
/** One line of the onboarding checklist, as the server sends it. */
interface RequiredItem {
  key: string;
  label: string;
  tab: 'personal' | 'contacts' | 'documents';
  done?: boolean;
  field?: string;
  missingFields?: { key: string; label: string }[];
}

@Component({
  selector: 'app-self-onboarding-gate',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    EmployeeProfileComponent,
    LucideAlertCircle,
    LucideArrowRight,
    LucideBuilding2,
    LucideCheck,
    LucideCheckCircle2,
    LucideClock,
    LucideEye,
    LucideEyeOff,
    LucideKeyRound,
    LucideLock,
    LucideLogOut,
    LucideRefreshCw,
    LucideSend,
    LucideShieldCheck,
    LucideSparkles,
    LucideUser,
    LucideUserCheck,
  ],
  templateUrl: './self-onboarding-gate.html',
  styleUrls: ['./self-onboarding-gate.css'],
})
export class SelfOnboardingGateComponent {
  private auth = inject(AuthService);
  private onboarding = inject(OnboardingService);
  private toast = inject(HotToastService);
  private router = inject(Router);

  @ViewChild('newPasswordInput') private newPasswordInput?: ElementRef<HTMLInputElement>;
  @ViewChild('confirmPasswordInput') private confirmPasswordInput?: ElementRef<HTMLInputElement>;
  @ViewChild(EmployeeProfileComponent) private profile?: EmployeeProfileComponent;

  user = this.auth.currentUser;
  step = computed<'password' | 'profile' | 'review'>(() => {
    const u = this.user();
    if (u?.mustChangePassword) return 'password';
    return u?.employee?.selfOnboardingStatus === 'SUBMITTED' ? 'review' : 'profile';
  });
  firstName = computed(() => this.user()?.employee?.firstName || 'there');
  userInitials = computed(() => {
    const e = this.user()?.employee;
    const f = e?.firstName?.[0] || this.user()?.email?.[0] || 'U';
    const l = e?.lastName?.[0] || '';
    return (f + l).toUpperCase();
  });
  roleSummary = computed(() => {
    const e = this.user()?.employee;
    return [e?.designation?.name, e?.department?.name].filter(Boolean).join(' · ');
  });

  // Step 1 — password
  newPassword = '';
  confirmPassword = '';
  showPassword = signal(false);
  savingPassword = signal(false);
  npEdited = signal(false);
  npBlurred = signal(false);
  confirmBlurred = signal(false);
  submitAttempted = signal(false);

  // Step 2 & 3 — profile & review
  notes = signal<{ key: string; label: string; note: string }[]>([]);
  submittedAt = signal<string | null>(null);
  submitting = signal(false);
  checkingStatus = signal(false);
  saving = signal(false);

  /** Required items from the server, with done flags (16 Nov 2026). */
  required = signal<RequiredItem[]>([]);
  requiredDone = computed(() => this.required().filter(r => r.done).length);
  requiredLeft = computed(() => this.required().length - this.requiredDone());
  /** Submit shows only once every required item is saved on the server. */
  readyToSubmit = computed(() => this.required().length > 0 && this.requiredLeft() === 0);

  constructor() {
    this.loadNotes();
  }

  private loadNotes() {
    this.onboarding.getMySelfOnboarding().subscribe({
      next: (r) => {
        this.submittedAt.set(r.submittedAt || null);
        this.required.set((r as any).required || []);
        this.notes.set(Object.entries(r.notes || {})
          .filter(([, v]) => !!v)
          .map(([k, v]) => ({ key: k, label: r.sections?.[k] || k, note: v })));
      },
      error: () => {},
    });
  }

  hasMinLength(): boolean {
    return this.newPassword.length >= 8;
  }

  hasUpperAndLower(): boolean {
    return /[a-z]/.test(this.newPassword) && /[A-Z]/.test(this.newPassword);
  }

  hasNumberOrSymbol(): boolean {
    return /[\d\W_]/.test(this.newPassword);
  }

  isNewPasswordInvalid(): boolean {
    return (this.submitAttempted() || (this.npEdited() && this.npBlurred())) && !this.hasMinLength();
  }

  passwordsMatch(): boolean {
    return this.confirmPassword.length >= 8 && this.newPassword === this.confirmPassword;
  }

  passwordsMismatch(): boolean {
    return (this.submitAttempted() || (this.confirmBlurred() && this.confirmPassword.length > 0))
      && this.newPassword !== this.confirmPassword;
  }

  passwordStrength(): { score: number; label: string; level: string } {
    const p = this.newPassword;
    if (!p) return { score: 0, label: '', level: 'none' };
    if (p.length < 8) return { score: 1, label: 'Too short', level: 'weak' };

    let checks = 0;
    if (p.length >= 12) checks++;
    if (this.hasUpperAndLower()) checks++;
    if (this.hasNumberOrSymbol()) checks++;

    if (checks <= 1) return { score: 1, label: 'Fair', level: 'fair' };
    if (checks === 2) return { score: 2, label: 'Good', level: 'good' };
    return { score: 3, label: 'Strong', level: 'strong' };
  }

  savePassword() {
    this.submitAttempted.set(true);
    this.npBlurred.set(true);
    this.confirmBlurred.set(true);

    if (this.newPassword.length < 8) {
      this.toast.error('Use at least 8 characters.');
      this.newPasswordInput?.nativeElement?.focus();
      return;
    }
    if (this.newPassword !== this.confirmPassword) {
      this.toast.error('The two passwords don’t match.');
      this.confirmPasswordInput?.nativeElement?.focus();
      return;
    }
    this.savingPassword.set(true);
    this.auth.changePassword(this.newPassword).subscribe({
      next: () => {
        this.toast.success('Password set');
        this.newPassword = this.confirmPassword = '';
        this.npEdited.set(false);
        this.npBlurred.set(false);
        this.confirmBlurred.set(false);
        this.submitAttempted.set(false);
        this.auth.getMe().subscribe({ complete: () => this.savingPassword.set(false), error: () => this.savingPassword.set(false) });
      },
      error: (e) => { this.toast.error(e?.error?.message || 'Could not set the password'); this.savingPassword.set(false); },
    });
  }

  /** Re-reads the checklist (after any save in the profile). */
  refreshRequired() {
    this.onboarding.getMySelfOnboarding().subscribe({
      next: (r: any) => this.required.set(r.required || []),
      error: () => {},
    });
  }

  /** Opens the tab with that field and scrolls to it. */
  goToRequired(r: RequiredItem) {
    // Every empty personal field gets marked red; the cursor goes to this group's first one.
    const missingPersonal = this.required()
      .filter(x => !x.done && x.tab === 'personal')
      .flatMap(x => (x.missingFields || []).map(f => f.key));
    this.profile?.goToField(r.tab, r.field || r.key, missingPersonal);
  }

  private showMissing(missing: RequiredItem[]) {
    this.toast.error(`Still needed: ${missing.map(m => m.label).join(', ')}`, { duration: 5000 });
    this.goToRequired({ ...missing[0], done: false });
  }

  /** Saves whatever form is open; the profile shows field errors itself. */
  saveDraft() {
    if (!this.profile) return;
    this.saving.set(true);
    this.profile.saveOpenForm$().subscribe(ok => {
      this.saving.set(false);
      if (ok) this.refreshRequired();
    });
  }

  /** Saves the open form first, then submits; anything missing opens its field. */
  submitForReview() {
    this.submitting.set(true);
    (this.profile ? this.profile.saveOpenForm$() : of(true)).pipe(
      switchMap(saved => saved ? this.onboarding.submitMySelfOnboarding() : of(null)),
    ).subscribe({
      next: (res) => {
        if (!res) { this.submitting.set(false); return; }
        this.toast.success('Submitted for review');
        this.submittedAt.set(new Date().toISOString());
        this.auth.getMe().subscribe({ complete: () => this.submitting.set(false), error: () => this.submitting.set(false) });
      },
      error: (e) => {
        this.submitting.set(false);
        const missing = e?.error?.missing;
        if (Array.isArray(missing) && missing.length) {
          this.refreshRequired();
          this.showMissing(missing);
        } else {
          this.toast.error(e?.error?.message || 'Could not submit');
        }
      },
    });
  }

  checkAgain() {
    if (this.checkingStatus()) return;
    this.checkingStatus.set(true);
    this.auth.getMe().subscribe({
      next: (u: any) => {
        if (u?.employee?.selfOnboardingStatus === 'SUBMITTED') {
          this.toast.success('Still under review — we’ll email you when it’s done.');
        }
        this.loadNotes();
        this.checkingStatus.set(false);
      },
      error: () => {
        this.toast.error('Could not check review status right now.');
        this.checkingStatus.set(false);
      },
    });
  }

  logout() {
    this.auth.logout();
    this.router.navigate(['/']);
  }
}
