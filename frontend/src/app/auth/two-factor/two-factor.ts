import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  LucideShieldCheck,
  LucideKeyRound,
  LucideArrowRight,
  LucideArrowLeft,
  LucideCopy,
  LucideDownload,
  LucideSmartphone,
  LucideCheck,
  LucideLock,
  LucideQrCode,
  LucideSparkles,
  LucideInfo,
} from '@lucide/angular';
import { HotToastService } from '@ngneat/hot-toast';
import { AuthService } from '../../services/auth.service';

/** Keys the login page hands the challenge over with. */
export const CHALLENGE_TOKEN_KEY = 'twoFactorChallenge';
export const CHALLENGE_MODE_KEY = 'twoFactorMode';

@Component({
  selector: 'app-two-factor',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    LucideShieldCheck,
    LucideKeyRound,
    LucideArrowRight,
    LucideArrowLeft,
    LucideCopy,
    LucideDownload,
    LucideSmartphone,
    LucideCheck,
    LucideLock,
    LucideQrCode,
    LucideSparkles,
    LucideInfo,
  ],
  templateUrl: './two-factor.html',
  styleUrls: ['./two-factor.css'],
})
export class TwoFactorComponent implements OnInit {
  private authService = inject(AuthService);
  private toast = inject(HotToastService);
  private router = inject(Router);

  /**
   * 'verify' — the user already has an authenticator and just needs to prove it.
   * 'enrol'  — the company requires 2FA and this user has not set it up yet.
   * 'codes'  — the one and only time the backup codes are shown.
   */
  step: 'verify' | 'enrol' | 'codes' = 'verify';

  code = '';
  isSubmitting = signal(false);
  isCodeFocused = false;
  isBackupMode = false;

  // Enrolment payload from the server; the QR arrives ready-rendered so the
  // frontend needs no QR library.
  qrDataUri = signal<string>('');
  secret = signal<string>('');
  backupCodes = signal<string[]>([]);
  acknowledged = signal(false);

  secretCopied = signal(false);
  backupCodesCopied = signal(false);
  copiedCodeIndex = signal<number | null>(null);

  /**
   * Held in sessionStorage rather than localStorage on purpose: it dies with the
   * tab, and authGuard only ever looks at localStorage.access_token, so a
   * half-finished challenge can never read as a signed-in session.
   */
  private challengeToken = '';

  ngOnInit() {
    this.challengeToken = sessionStorage.getItem(CHALLENGE_TOKEN_KEY) || '';
    const mode = sessionStorage.getItem(CHALLENGE_MODE_KEY);

    if (!this.challengeToken) {
      // Landed here directly, or the challenge already expired.
      this.router.navigate(['/login']);
      return;
    }

    if (mode === 'ENROL') {
      this.step = 'enrol';
      this.beginEnrolment();
    }
  }

  /** Groups the base32 secret for anyone typing it in by hand. */
  formattedSecret(): string {
    return (this.secret().match(/.{1,4}/g) || []).join(' ');
  }

  getCodeDigit(index: number): string {
    const clean = (this.code || '').replace(/\D/g, '');
    return clean[index] || '';
  }

  isDigitActive(index: number): boolean {
    const clean = (this.code || '').replace(/\D/g, '');
    return this.isCodeFocused && clean.length === index;
  }

  onCodeInput() {
    if (this.step !== 'verify' || !this.isBackupMode) {
      this.code = (this.code || '').replace(/\D/g, '').slice(0, 6);
      if (this.code.length === 6 && !this.isSubmitting()) {
        this.submit();
      }
    }
  }

  toggleBackupMode() {
    this.isBackupMode = !this.isBackupMode;
    this.code = '';
  }

  private beginEnrolment() {
    this.isSubmitting.set(true);
    this.authService.startChallengeEnrolment(this.challengeToken).subscribe({
      next: (res) => {
        this.isSubmitting.set(false);
        this.qrDataUri.set(res.qrDataUri);
        this.secret.set(res.secret);
      },
      error: (err) => {
        this.isSubmitting.set(false);
        this.fail(err, 'Could not start two-factor setup.');
      },
    });
  }

  submit() {
    const code = this.code.trim();
    if (!code) {
      this.toast.error(
        this.isBackupMode
          ? 'Enter your emergency backup code.'
          : 'Enter the 6-digit code from your authenticator app.'
      );
      return;
    }

    if (!this.isBackupMode && code.length < 6) {
      this.toast.error('Please enter all 6 digits of your authentication code.');
      return;
    }

    this.isSubmitting.set(true);

    const request =
      this.step === 'enrol'
        ? this.authService.confirmChallengeEnrolment(this.challengeToken, code)
        : this.authService.verifyTwoFactorChallenge(this.challengeToken, code);

    request.subscribe({
      next: (res) => {
        this.isSubmitting.set(false);
        this.clearChallenge();

        if (res.backupCodes?.length) {
          // Enrolment: the codes are visible exactly once, so the user has to
          // acknowledge them before we move on.
          this.backupCodes.set(res.backupCodes);
          this.step = 'codes';
          return;
        }

        if (res.usedBackupCode) {
          this.toast.success(
            `Signed in with a backup code. ${res.backupCodesRemaining} remaining.`
          );
        }
        this.finish();
      },
      error: (err) => {
        this.isSubmitting.set(false);
        this.code = '';
        this.fail(err, 'That code was not accepted.');
      },
    });
  }

  copySecret() {
    if (!this.secret()) return;
    navigator.clipboard.writeText(this.secret()).then(
      () => {
        this.toast.success('Setup key copied to clipboard');
        this.secretCopied.set(true);
        setTimeout(() => this.secretCopied.set(false), 2200);
      },
      () => this.toast.error('Could not copy the setup key'),
    );
  }

  copyBackupCodes() {
    navigator.clipboard.writeText(this.backupCodes().join('\n')).then(
      () => {
        this.toast.success('All backup codes copied');
        this.backupCodesCopied.set(true);
        setTimeout(() => this.backupCodesCopied.set(false), 2200);
      },
      () => this.toast.error('Could not copy the codes'),
    );
  }

  copySingleBackupCode(codeStr: string, index: number) {
    navigator.clipboard.writeText(codeStr).then(() => {
      this.toast.success(`Copied backup code #${index + 1}`);
      this.copiedCodeIndex.set(index);
      setTimeout(() => {
        if (this.copiedCodeIndex() === index) {
          this.copiedCodeIndex.set(null);
        }
      }, 2000);
    });
  }

  downloadBackupCodes() {
    const body = [
      '========================================',
      'NEX ERP — Two-Factor Emergency Backup Codes',
      '========================================',
      'IMPORTANT: Keep these codes in a safe, offline location.',
      'Each code can only be used once.',
      '',
      ...this.backupCodes().map((c, i) => `Code ${String(i + 1).padStart(2, '0')}: ${c}`),
      '',
      `Generated on: ${new Date().toLocaleString()}`,
    ].join('\n');

    const url = URL.createObjectURL(new Blob([body], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'nex-erp-backup-codes.txt';
    link.click();
    URL.revokeObjectURL(url);
  }

  finish() {
    this.toast.success('Signed in.');
    this.router.navigate(['/dashboard']);
  }

  cancel() {
    this.clearChallenge();
    this.router.navigate(['/login']);
  }

  private clearChallenge() {
    sessionStorage.removeItem(CHALLENGE_TOKEN_KEY);
    sessionStorage.removeItem(CHALLENGE_MODE_KEY);
  }

  /**
   * A 401 here means the challenge itself expired, not just a bad code — the
   * user has to start from the password again.
   */
  private fail(err: any, fallback: string) {
    const message = err?.error?.message || fallback;
    this.toast.error(message);

    if (err?.status === 401 && /session has expired|password changed/i.test(message)) {
      this.clearChallenge();
      this.router.navigate(['/login']);
    }
  }
}
