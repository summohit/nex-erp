import { apiClient } from './apiClient';

export interface TwoFactorStatus {
  enabled: boolean;
  confirmedAt: string | null;
  backupCodesRemaining: number;
  companyRequires: boolean;
  canDisable: boolean;
}

export interface EnrolmentPayload {
  /** PNG data-URI, rendered server-side so the app needs no QR library. */
  qrDataUri: string;
  /** Base32 secret, for anyone who cannot scan and types it in instead. */
  secret: string;
  /** otpauth:// URI, used for the "open in authenticator" hand-off. */
  otpauthUri: string;
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
};
