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
  LucideSearch,
  LucideUsers,
  LucideShieldOff,
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
    LucideSearch,
    LucideUsers,
    LucideShieldOff,
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
    rotationPending?: boolean;
    rotationStartedAt?: string | null;
  } | null>(null);

  /**
   * 'idle'     — showing current state
   * 'password' — re-authenticating before a change
   * 'enrol'    — QR shown, waiting for the confirming code
   * 'codes'    — the one time backup codes are visible
   * 'rotate'   — QR for the NEW device, waiting for its first code
   */
  step = signal<'idle' | 'password' | 'enrol' | 'codes' | 'rotate'>('idle');

  /** What the password prompt is gating. */
  intent = signal<'enable' | 'disable' | 'regenerate' | 'rotate'>('enable');

  password = '';
  code = '';

  qrDataUri = signal('');
  secret = signal('');
  backupCodes = signal<string[]>([]);

  lowOnCodes = computed(() => {
    const s = this.status();
    return !!s?.enabled && s.backupCodesRemaining > 0 && s.backupCodesRemaining <= 3;
  });

  // ── Administration: resetting other people's two-factor ─────────────────
  //
  // The recovery path when someone loses their phone and their backup codes,
  // and the only way back in when a stored secret can no longer be decrypted
  // -- which is what an ENCRYPTION_KEY rotation does to everyone enrolled
  // before it. The server restricts all of this to a SUPERADMIN in the caller's
  // own company; this section simply does not render for anybody else.

  adminUsers = signal<any[]>([]);
  adminLoading = signal(false);
  adminSearch = signal('');
  /** userIds ticked for reset. */
  adminSelected = signal<Set<number>>(new Set());
  adminResetting = signal(false);
  /** Shown instead of the button once a reset is staged, to force a pause. */
  adminConfirming = signal(false);

  get isSuperAdmin(): boolean {
    return this.authService.currentUser()?.role === 'SUPERADMIN';
  }

  /** The signed-in user, who must not reset their own second factor here. */
  private get myUserId(): number | null {
    return this.authService.currentUser()?.id ?? null;
  }

  /** Template-side form of the above -- the service itself stays private. */
  isMe(userId: number): boolean {
    return this.myUserId === userId;
  }

  adminFiltered = computed(() => {
    const q = this.adminSearch().toLowerCase().trim();
    const rows = this.adminUsers();
    if (!q) return rows;
    return rows.filter((u) =>
      (u.email || '').toLowerCase().includes(q) ||
      (u.name || '').toLowerCase().includes(q) ||
      (u.role || '').toLowerCase().includes(q),
    );
  });

  /**
   * Anyone with a stored second factor — finished or not.
   *
   * This used to be `u.enabled`, meaning confirmed enrolments only, on the
   * reasoning that "the rest have nothing to clear". That is true of someone
   * who never started, and false of someone who started and stopped: their row
   * is what holds the account in setup, and clearing it is the only way out.
   * Somebody who lost their phone halfway through enrolling was invisible to
   * the one tool built for exactly that situation.
   */
  hasStoredFactor = (u: any) => !!u?.enabled || !!u?.setupStarted;

  adminSelectable = computed(() =>
    this.adminFiltered().filter((u) => this.hasStoredFactor(u) && u.userId !== this.myUserId),
  );

  /** Enrolled / half-enrolled / nothing — three states, not two. */
  tfaStateLabel(u: any): string {
    if (u?.enabled) return u?.movingDevice ? 'Moving device' : 'Enrolled';
    if (u?.setupStarted) return 'Setup unfinished';
    return 'Not enrolled';
  }

  adminSelectedCount = computed(() => this.adminSelected().size);

  allVisibleSelected = computed(() => {
    const selectable = this.adminSelectable();
    if (!selectable.length) return false;
    const sel = this.adminSelected();
    return selectable.every((u) => sel.has(u.userId));
  });

  loadAdminUsers() {
    if (!this.isSuperAdmin) return;
    this.adminLoading.set(true);
    this.authService.listTwoFactorUsers().subscribe({
      next: (rows: any) => {
        this.adminUsers.set(rows || []);
        this.adminLoading.set(false);
      },
      error: (err: any) => {
        this.adminLoading.set(false);
        this.toast.error(err?.error?.message || 'Could not load the user list');
      },
    });
  }

  isAdminSelected(userId: number) { return this.adminSelected().has(userId); }

  toggleAdminSelect(user: any) {
    if (!this.hasStoredFactor(user) || user.userId === this.myUserId) return;
    const next = new Set(this.adminSelected());
    next.has(user.userId) ? next.delete(user.userId) : next.add(user.userId);
    this.adminSelected.set(next);
    this.adminConfirming.set(false);
  }

  toggleSelectAllVisible() {
    const selectable = this.adminSelectable();
    const next = new Set(this.adminSelected());
    if (this.allVisibleSelected()) {
      selectable.forEach((u) => next.delete(u.userId));
    } else {
      selectable.forEach((u) => next.add(u.userId));
    }
    this.adminSelected.set(next);
    this.adminConfirming.set(false);
  }

  clearAdminSelection() {
    this.adminSelected.set(new Set());
    this.adminConfirming.set(false);
  }

  /** The names behind the count, so the confirmation says who. */
  selectedNames = computed(() => {
    const sel = this.adminSelected();
    return this.adminUsers()
      .filter((u) => sel.has(u.userId))
      .map((u) => u.name || u.email);
  });

  /**
   * Reset every selected user, one request each.
   *
   * Deliberately not a new bulk endpoint: the single reset is already written,
   * already scoped to the caller's company and already refuses self-reset, and
   * a second server path doing the same thing is a second place for those
   * checks to drift. Failures are collected rather than aborting the run --
   * stopping halfway would leave the admin unsure who had been reset.
   */
  confirmBulkReset() {
    const ids = [...this.adminSelected()];
    if (!ids.length) return;

    this.adminResetting.set(true);
    let remaining = ids.length;
    const failed: string[] = [];

    const finish = () => {
      if (--remaining > 0) return;
      this.adminResetting.set(false);
      this.adminConfirming.set(false);
      this.clearAdminSelection();
      this.loadAdminUsers();

      if (failed.length) {
        this.toast.error(`${failed.length} of ${ids.length} could not be reset: ${failed[0]}`);
      } else {
        this.toast.success(
          ids.length === 1
            ? 'Two-factor authentication reset. They can sign in with their password.'
            : `Two-factor authentication reset for ${ids.length} users.`,
        );
      }
    };

    for (const id of ids) {
      this.authService.resetTwoFactorForUser(id).subscribe({
        next: () => finish(),
        error: (err: any) => {
          failed.push(err?.error?.message || `user ${id}`);
          finish();
        },
      });
    }
  }

  ngOnInit() {
    this.load();
    this.loadAdminUsers();
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

  askPassword(intent: 'enable' | 'disable' | 'regenerate' | 'rotate') {
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

    if (this.intent() === 'rotate') {
      this.beginRotation();
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

  /**
   * Hand the new phone a fresh secret. The old one stays live until the new
   * device is confirmed, so nothing is lost if this is abandoned here.
   */
  private beginRotation() {
    this.isSubmitting.set(true);
    this.authService.startTwoFactorRotation(this.password, this.code.trim()).subscribe({
      next: (res) => {
        this.isSubmitting.set(false);
        this.password = '';
        this.code = '';
        this.qrDataUri.set(res.qrDataUri);
        this.secret.set(res.secret);
        this.step.set('rotate');
        if (res.usedBackupCode) {
          this.toast.info(
            `Backup code used — ${res.backupCodesRemaining} left. Generate new ones once you are set up.`,
          );
        }
      },
      error: (err) => {
        this.isSubmitting.set(false);
        this.code = '';
        this.toast.error(err?.error?.message || 'Could not start the device move.');
      },
    });
  }

  confirmRotation() {
    if (!this.code.trim()) {
      this.toast.error('Enter the 6-digit code from your new device.');
      return;
    }

    this.isSubmitting.set(true);
    this.authService.confirmTwoFactorRotation(this.code.trim()).subscribe({
      next: () => {
        this.isSubmitting.set(false);
        this.code = '';
        this.qrDataUri.set('');
        this.secret.set('');
        this.step.set('idle');
        this.toast.success('Your new device is now the one that signs you in.');
        this.load();
      },
      error: (err) => {
        this.isSubmitting.set(false);
        this.code = '';
        this.toast.error(err?.error?.message || 'That code was not accepted.');
      },
    });
  }

  /**
   * Abandon a move. Told to the server as well as forgotten locally, so the
   * unused secret does not sit on the account until its 15-minute expiry.
   */
  abandonRotation() {
    this.authService.cancelTwoFactorRotation().subscribe({
      next: () => { this.toast.info('Device move cancelled — your current app still works.'); this.load(); },
      error: () => this.toast.error('Could not cancel the device move.'),
    });
    this.cancel();
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

  getInitials(name: string): string {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  getAvatarBg(name: string): string {
    const colors = [
      '#4F46E5', '#2563EB', '#0D9488', '#059669',
      '#6b3fd6', '#7e7f80', '#7C3AED', '#6b3fd6'
    ];
    let hash = 0;
    for (let i = 0; i < (name || '').length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const idx = Math.abs(hash) % colors.length;
    return colors[idx];
  }
}
