import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  LucideShieldCheck,
  LucideShieldAlert,
  LucideSmartphone,
  LucideKeyRound,
  LucideCopy,
  LucideDownload,
  LucideInfo,
  LucideRefreshCw,
  LucideLock,
  LucideEye,
  LucideEyeOff,
  LucideCheckCircle2,
  LucideQrCode,
  LucideHelpCircle,
  LucideCheck,
  LucideAlertTriangle,
  LucideArrowRight,
  LucideChevronDown,
  LucideChevronUp,
} from '@lucide/angular';
import { HotToastService } from '@ngneat/hot-toast';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-security-settings',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideShieldCheck,
    LucideShieldAlert,
    LucideSmartphone,
    LucideKeyRound,
    LucideCopy,
    LucideDownload,
    LucideInfo,
    LucideRefreshCw,
    LucideLock,
    LucideEye,
    LucideEyeOff,
    LucideCheckCircle2,
    LucideQrCode,
    LucideHelpCircle,
    LucideCheck,
    LucideAlertTriangle,
    LucideArrowRight,
    LucideChevronDown,
    LucideChevronUp,
  ],
  templateUrl: './security.html',
  styleUrls: ['./security.css'],
})
export class SecurityComponent implements OnInit {
  private authService = inject(AuthService);
  private toast = inject(HotToastService);

  isLoading = signal(true);
  isSubmitting = signal(false);

  status = signal<{
    enabled: boolean;
    confirmedAt: string | null;
    backupCodesRemaining: number;
    companyRequires: boolean;
    canDisable: boolean;
  } | null>(null);

  /**
   * 'idle'     — showing current state
   * 'password' — re-authenticating before a change
   * 'enrol'    — QR shown, waiting for the confirming code
   * 'codes'    — the one time backup codes are visible
   */
  step = signal<'idle' | 'password' | 'enrol' | 'codes'>('idle');

  /** What the password prompt is gating. */
  intent = signal<'enable' | 'disable' | 'regenerate'>('enable');

  password = '';
  code = '';

  qrDataUri = signal('');
  secret = signal('');
  backupCodes = signal<string[]>([]);

  lowOnCodes = computed(() => {
    const s = this.status();
    return !!s?.enabled && s.backupCodesRemaining > 0 && s.backupCodesRemaining <= 3;
  });

  ngOnInit() {
    this.load();
  }

  private load() {
    this.isLoading.set(true);
    this.authService.getTwoFactorStatus().subscribe({
      next: (res) => {
        this.status.set(res);
        this.isLoading.set(false);
      },
      error: () => {
        this.isLoading.set(false);
        this.toast.error('Could not load your security settings.');
      },
    });
  }

  passwordVisible = signal(false);
  secretCopied = signal(false);
  codesCopied = signal(false);
  copiedSingleIndex = signal<number | null>(null);
  activeFaq = signal<number | null>(0);

  togglePasswordVisibility() {
    this.passwordVisible.set(!this.passwordVisible());
  }

  copySecret() {
    const rawSecret = this.secret();
    if (!rawSecret) return;
    navigator.clipboard.writeText(rawSecret).then(
      () => {
        this.secretCopied.set(true);
        this.toast.success('Setup key copied to clipboard');
        setTimeout(() => this.secretCopied.set(false), 3000);
      },
      () => this.toast.error('Could not copy setup key'),
    );
  }

  toggleFaq(index: number) {
    this.activeFaq.set(this.activeFaq() === index ? null : index);
  }

  formattedSecret(): string {
    return (this.secret().match(/.{1,4}/g) || []).join(' ');
  }

  // ── Flow control ───────────────────────────────────────────────────────────

  askPassword(intent: 'enable' | 'disable' | 'regenerate') {
    this.intent.set(intent);
    this.password = '';
    this.code = '';
    this.step.set('password');
  }

  cancel() {
    this.password = '';
    this.code = '';
    this.qrDataUri.set('');
    this.secret.set('');
    this.step.set('idle');
  }

  submitPassword() {
    if (!this.password) {
      this.toast.error('Enter your password to continue.');
      return;
    }

    if (this.intent() === 'enable') {
      this.beginEnrolment();
      return;
    }

    // Disable and regenerate both need a current code as well, collected on the
    // same panel, so they submit straight through.
    if (!this.code.trim()) {
      this.toast.error('Enter the current code from your authenticator app.');
      return;
    }

    this.isSubmitting.set(true);
    const request =
      this.intent() === 'disable'
        ? this.authService.disableTwoFactor(this.password, this.code.trim())
        : this.authService.regenerateBackupCodes(this.password, this.code.trim());

    request.subscribe({
      next: (res: any) => {
        this.isSubmitting.set(false);
        this.password = '';
        this.code = '';

        if (res.backupCodes?.length) {
          this.backupCodes.set(res.backupCodes);
          this.step.set('codes');
          this.toast.success('New backup codes generated.');
        } else {
          this.step.set('idle');
          this.toast.success('Two-factor authentication turned off.');
        }
        this.load();
      },
      error: (err) => {
        this.isSubmitting.set(false);
        this.code = '';
        this.toast.error(err?.error?.message || 'That did not work.');
      },
    });
  }

  private beginEnrolment() {
    this.isSubmitting.set(true);
    this.authService.setupTwoFactor(this.password).subscribe({
      next: (res) => {
        this.isSubmitting.set(false);
        this.password = '';
        this.qrDataUri.set(res.qrDataUri);
        this.secret.set(res.secret);
        this.step.set('enrol');
      },
      error: (err) => {
        this.isSubmitting.set(false);
        this.toast.error(err?.error?.message || 'Could not start setup.');
      },
    });
  }

  confirmEnrolment() {
    if (!this.code.trim()) {
      this.toast.error('Enter the 6-digit code from your app.');
      return;
    }

    this.isSubmitting.set(true);
    this.authService.enableTwoFactor(this.code.trim()).subscribe({
      next: (res: any) => {
        this.isSubmitting.set(false);
        this.code = '';
        this.backupCodes.set(res.backupCodes || []);
        this.step.set('codes');
        this.toast.success('Two-factor authentication is on.');
        this.load();
      },
      error: (err) => {
        this.isSubmitting.set(false);
        this.code = '';
        this.toast.error(err?.error?.message || 'That code was not accepted.');
      },
    });
  }

  done() {
    this.backupCodes.set([]);
    this.cancel();
  }

  // ── Backup code helpers ────────────────────────────────────────────────────

  copySingleCode(code: string, index: number) {
    navigator.clipboard.writeText(code).then(
      () => {
        this.copiedSingleIndex.set(index);
        this.toast.success(`Copied code #${(index + 1).toString().padStart(2, '0')}`);
        setTimeout(() => {
          if (this.copiedSingleIndex() === index) {
            this.copiedSingleIndex.set(null);
          }
        }, 2000);
      },
      () => this.toast.error('Could not copy code'),
    );
  }

  copyCodes() {
    navigator.clipboard.writeText(this.backupCodes().join('\n')).then(
      () => {
        this.codesCopied.set(true);
        this.toast.success('All backup codes copied');
        setTimeout(() => this.codesCopied.set(false), 2500);
      },
      () => this.toast.error('Could not copy the codes'),
    );
  }

  downloadCodes() {
    const body = [
      'NEX ERP — two-factor backup codes',
      'Each code works once. Keep them somewhere safe and private.',
      '',
      ...this.backupCodes(),
    ].join('\n');

    const url = URL.createObjectURL(new Blob([body], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'nex-erp-backup-codes.txt';
    link.click();
    URL.revokeObjectURL(url);
  }
}
