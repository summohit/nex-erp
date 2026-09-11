import { apiClient } from './apiClient';

export interface TwoFactorStatus {
  enabled: boolean;
  confirmedAt: string | null;
  backupCodesRemaining: number;
  companyRequires: boolean;
  canDisable: boolean;
  /** A device move was started and never finished; the old app still works. */
  rotationPending?: boolean;
  rotationStartedAt?: string | null;
}

export interface EnrolmentPayload {
  /** PNG data-URI, rendered server-side so the app needs no QR library. */
  qrDataUri: string;
  /** Base32 secret, for anyone who cannot scan and types it in instead. */
  secret: string;
  /** otpauth:// URI, used for the "open in authenticator" hand-off. */
  otpauthUri: string;
}

export interface RotationStart extends EnrolmentPayload {
  /** True when a backup code was spent to start the move instead of a live code. */
  usedBackupCode: boolean;
  backupCodesRemaining: number;
  expiresInSeconds: number;
}

export const twoFactorService = {
  // ── Sign-in challenge (unauthenticated; carries a challenge token) ─────────

  verifyChallenge: async (challengeToken: string, code: string) => {
    const res = await apiClient.post('/auth/2fa/challenge/verify', { challengeToken, code });
    return res.data;
  },

  startChallengeEnrolment: async (challengeToken: string): Promise<EnrolmentPayload> => {
    const res = await apiClient.post('/auth/2fa/challenge/enrol/start', { challengeToken });
    return res.data;
  },

  confirmChallengeEnrolment: async (challengeToken: string, code: string) => {
    const res = await apiClient.post('/auth/2fa/challenge/enrol/confirm', { challengeToken, code });
    return res.data;
  },

  // ── Self-service management (needs a real session) ─────────────────────────

  getStatus: async (): Promise<TwoFactorStatus> => {
    const res = await apiClient.get('/auth/2fa/status');
    return res.data;
  },

  setup: async (password: string): Promise<EnrolmentPayload> => {
    const res = await apiClient.post('/auth/2fa/setup', { password });
    return res.data;
  },

  enable: async (code: string): Promise<{ enabled: boolean; backupCodes: string[] }> => {
    const res = await apiClient.post('/auth/2fa/enable', { code });
    return res.data;
  },

  disable: async (password: string, code: string) => {
    const res = await apiClient.post('/auth/2fa/disable', { password, code });
    return res.data;
  },

  regenerateBackupCodes: async (password: string, code: string): Promise<{ backupCodes: string[] }> => {
    const res = await apiClient.post('/auth/2fa/backup-codes/regenerate', { password, code });
    return res.data;
  },

  // ── Moving the authenticator to a new device ───────────────────────────────
  // Two steps, and 2FA stays on throughout: the replacement secret only goes
  // live once the new device proves it works. That is why this is available
  // even when the company policy forbids turning 2FA off.

  /** `code` is a live code from the CURRENT device, or a backup code if it is gone. */
  startRotation: async (password: string, code: string): Promise<RotationStart> => {
    const res = await apiClient.post('/auth/2fa/rotate/start', { password, code });
    return res.data;
  },

  /** Only a real TOTP code finishes this — a backup code proves nothing about the new phone. */
  confirmRotation: async (code: string): Promise<{ enabled: boolean; rotatedAt: string }> => {
    const res = await apiClient.post('/auth/2fa/rotate/confirm', { code });
    return res.data;
  },

  cancelRotation: async (): Promise<{ rotationPending: boolean }> => {
    const res = await apiClient.post('/auth/2fa/rotate/cancel', {});
    return res.data;
  },
};
