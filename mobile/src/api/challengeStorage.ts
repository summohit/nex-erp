import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Where a half-finished second factor waits while the user is in their
 * authenticator app.
 *
 * This has to survive backgrounding. Reading a TOTP code means leaving the app,
 * and Android is free to tear the activity down while it is gone — which
 * dropped the user back to an empty login form mid sign-in.
 *
 * Persisting is safe. The challenge token is signed with a separate secret
 * (JWT_SECRET + '_2fa') and carries `typ: '2fa'`, both of which AuthGuard
 * rejects, so on disk it is worth exactly what it is worth in memory: proof
 * that a password was checked, and still useless without the code. It lives at
 * its own key — never the session's — so nothing that reads the session can
 * pick it up by accident.
 */
const KEY = 'pendingTwoFactorChallenge';

/** Mirrors the server's CHALLENGE_TTL. The server remains the authority; this
 *  only avoids offering a challenge that is certain to be refused. */
export const CHALLENGE_TTL_MS = 10 * 60 * 1000;

export type ChallengeMode = 'VERIFY' | 'ENROL';

export interface PendingChallenge {
  token: string;
  mode: ChallengeMode;
}

export const challengeStorage = {
  async save(challenge: PendingChallenge, now: number = Date.now()): Promise<void> {
    try {
      await AsyncStorage.setItem(
        KEY,
        JSON.stringify({ ...challenge, expiresAt: now + CHALLENGE_TTL_MS }),
      );
    } catch {
      // Storage being unavailable degrades to the old in-memory behaviour,
      // which is worse but not broken. Never block a sign-in over it.
    }
  },

  /**
   * The stored challenge, or null when there is nothing usable.
   *
   * Anything expired, malformed or unreadable is deleted rather than returned —
   * a half-written entry must not strand the user on a screen whose token the
   * server will always refuse.
   */
  async restore(now: number = Date.now()): Promise<PendingChallenge | null> {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (!raw) return null;

      const saved = JSON.parse(raw);
      if (typeof saved?.token !== 'string' || !saved.token || typeof saved.expiresAt !== 'number') {
        await challengeStorage.clear();
        return null;
      }
      if (saved.expiresAt <= now) {
        await challengeStorage.clear();
        return null;
      }
      return { token: saved.token, mode: saved.mode === 'ENROL' ? 'ENROL' : 'VERIFY' };
    } catch {
      await challengeStorage.clear();
      return null;
    }
  },

  async clear(): Promise<void> {
    try {
      await AsyncStorage.removeItem(KEY);
    } catch {
      // Nothing actionable; the entry expires on its own.
    }
  },
};
