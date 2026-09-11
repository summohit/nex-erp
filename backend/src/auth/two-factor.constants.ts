/**
 * Every tunable for TOTP two-factor auth, in one place so none of them ends up
 * buried in a call site where nobody finds it during a security review.
 */

/**
 * How far a code may be out of step with our clock, in SECONDS.
 *
 * otplib v13 expresses tolerance in seconds rather than v12's step window, so
 * 30 accepts roughly the adjacent periods either side (~90s total validity for
 * a given code). Phones drift, and users type slowly; tightening this to 0
 * generates support tickets, and widening it materially weakens the factor.
 */
export const EPOCH_TOLERANCE_SECONDS = 30;

/** RFC 6238 defaults, and what every authenticator app assumes. */
export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SECONDS = 30;

/**
 * Shown as the account issuer in the authenticator app's list. Kept stable
 * rather than per-company: renaming an issuer orphans everyone's existing
 * entry, and the individual account is identified by the label (their email).
 */
export const TOTP_ISSUER = process.env.TOTP_ISSUER || 'NEX ERP';

export const BACKUP_CODE_COUNT = 10;

/** 8 characters from a 30-symbol alphabet ≈ 39 bits of entropy per code. */
export const BACKUP_CODE_LENGTH = 8;

/**
 * Crockford-flavoured: no I, L, O, U, 0 or 1, so a code read off a printout
 * cannot be mistyped through ambiguity.
 */
export const BACKUP_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Consecutive failures before this user's 2FA locks. The per-user counter — not
 * the per-IP throttle — is the real brute-force control: a whole office shares
 * one address, and an attacker can rotate through proxies.
 */
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;

/**
 * Lifetime of the half-authenticated challenge token: long enough to install an
 * authenticator app during a forced enrolment, short enough that a stolen one is
 * near-useless.
 */
export const CHALLENGE_TTL = '10m';

/**
 * A THIRD derived secret, alongside the existing access (JWT_SECRET) and refresh
 * (JWT_SECRET + '_refresh') secrets.
 *
 * This is load-bearing. AuthGuard verifies bearer tokens with JWT_SECRET and
 * checks nothing else about them, so a challenge token signed with that secret
 * would be a full access token for every guarded route in the ERP — a complete
 * authentication bypass. Signing challenges with a different key means AuthGuard
 * rejects them on signature alone.
 */
export const challengeSecret = () =>
  (process.env.JWT_SECRET || 'super-secret') + '_2fa';

/** What the half-authenticated user still has to do. */
export type ChallengeMode = 'VERIFY' | 'ENROL';

export interface ChallengePayload {
  /** Deliberately `uid`, not `sub`: see AuthGuard's defence-in-depth check. */
  uid: number;
  typ: '2fa';
  mode: ChallengeMode;
  /** Binds the challenge to the password it was issued under. */
  pw: string;
  nonce: string;
}

/**
 * Header the mobile app sets to identify itself.
 *
 * SECURITY: this is a CLIENT-SUPPLIED value and therefore forgeable by anyone —
 * `curl -H "X-Client-Platform: mobile"` is enough. It must never be used for an
 * authorisation decision that matters. It exists only to drive the temporary
 * bypass below, and is not evidence of anything.
 */
export const CLIENT_PLATFORM_HEADER = 'x-client-platform';
export const MOBILE_PLATFORM = 'mobile';

/**
 * TEMPORARY: lets the mobile app sign in with a password alone, skipping the
 * second factor, while older builds without the challenge screen are still in
 * users' hands.
 *
 * This deliberately makes two-factor authentication ADVISORY rather than
 * enforced: an attacker holding a stolen password only has to add the header
 * above to bypass it entirely. It is off unless explicitly switched on, so it
 * cannot leak into an environment by accident, and it can be closed instantly
 * by unsetting the variable and restarting — no deploy required.
 *
 * Remove this, and the header handling around it, once the 2FA-capable app
 * build has replaced the old one.
 */
export const mobileTwoFactorBypassEnabled = () =>
  process.env.ALLOW_MOBILE_2FA_BYPASS === 'true';

/**
 * How long a half-finished device move stays open.
 *
 * Long enough to install an authenticator app and scan, short enough that an
 * abandoned attempt does not leave a second working secret parked on the
 * account indefinitely.
 */
export const ROTATION_TTL_MS = 15 * 60 * 1000;
