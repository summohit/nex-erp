import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  TOTP,
  generateURI,
  NobleCryptoPlugin,
  ScureBase32Plugin,
} from 'otplib';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import * as QRCode from 'qrcode';

import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto.service';
import {
  BACKUP_CODE_ALPHABET,
  BACKUP_CODE_COUNT,
  BACKUP_CODE_LENGTH,
  CHALLENGE_TTL,
  ChallengeMode,
  ChallengePayload,
  EPOCH_TOLERANCE_SECONDS,
  LOCKOUT_MS,
  MAX_FAILED_ATTEMPTS,
  ROTATION_TTL_MS,
  TOTP_DIGITS,
  TOTP_ISSUER,
  TOTP_PERIOD_SECONDS,
  challengeSecret,
} from './two-factor.constants';

/** Deliberately identical for a wrong TOTP and a wrong backup code — which of
 *  the two forms was recognised is not something an attacker should learn. */
const INVALID_CODE = 'Invalid or expired verification code.';

@Injectable()
export class TwoFactorService {
  private readonly logger = new Logger(TwoFactorService.name);

  /**
   * An instance rather than a shared singleton, so per-request state can never
   * race with another request's.
   */
  private readonly totp = new TOTP({
    crypto: new NobleCryptoPlugin(),
    base32: new ScureBase32Plugin(),
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD_SECONDS,
    issuer: TOTP_ISSUER,
  });

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private cryptoService: CryptoService,
  ) {}

  // ── Challenge tokens ───────────────────────────────────────────────────────

  /**
   * Mint the half-authenticated token handed back instead of a session when a
   * user still owes a second factor.
   */
  async issueChallenge(
    user: { id: number; password: string },
    mode: ChallengeMode,
  ): Promise<string> {
    const payload: ChallengePayload = {
      uid: user.id,
      typ: '2fa',
      mode,
      // Binding to the password hash means changing the password (or an admin
      // resetting it) invalidates any challenge already in flight.
      pw: user.password.slice(0, 12),
      nonce: crypto.randomBytes(8).toString('hex'),
    };

    return this.jwtService.signAsync(payload, {
      expiresIn: CHALLENGE_TTL,
      secret: challengeSecret(),
    });
  }

  /**
   * The single place a challenge token is trusted. Verifies the signature
   * against the 2FA-specific secret, the claim shape, the requested mode, that
   * the password has not changed underneath it, and that the account is still
   * usable.
   */
  async decodeChallenge(token: unknown, expectedMode?: ChallengeMode) {
    if (typeof token !== 'string' || !token.trim()) {
      throw new UnauthorizedException(
        'Your sign-in session has expired. Please sign in again.',
      );
    }

    let payload: ChallengePayload;
    try {
      payload = await this.jwtService.verifyAsync(token, {
        secret: challengeSecret(),
      });
    } catch {
      throw new UnauthorizedException(
        'Your sign-in session has expired. Please sign in again.',
      );
    }

    if (payload?.typ !== '2fa' || typeof payload.uid !== 'number') {
      throw new UnauthorizedException(
        'Your sign-in session has expired. Please sign in again.',
      );
    }

    if (expectedMode && payload.mode !== expectedMode) {
      throw new UnauthorizedException(
        'Your sign-in session has expired. Please sign in again.',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.uid },
      include: { employee: true, twoFactor: true },
    });

    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException(
        'Your sign-in session has expired. Please sign in again.',
      );
    }

    const expected = Buffer.from(user.password.slice(0, 12));
    const actual = Buffer.from(String(payload.pw ?? ''));
    if (
      expected.length !== actual.length ||
      !crypto.timingSafeEqual(expected, actual)
    ) {
      throw new UnauthorizedException(
        'Your password changed. Please sign in again.',
      );
    }

    return { user, mode: payload.mode };
  }

  // ── Lockout ────────────────────────────────────────────────────────────────

  /**
   * Checked BEFORE any TOTP or bcrypt work, so a locked account cannot be used
   * to burn CPU — verifying a backup code is up to ten bcrypt comparisons.
   */
  private assertNotLocked(record: { lockedUntil: Date | null } | null) {
    if (!record?.lockedUntil) return;

    const remainingMs = record.lockedUntil.getTime() - Date.now();
    if (remainingMs <= 0) return;

    const minutes = Math.max(1, Math.ceil(remainingMs / 60000));
    throw new ForbiddenException(
      `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
    );
  }

  private async registerFailure(userId: number, current: number) {
    const next = current + 1;
    const locked = next >= MAX_FAILED_ATTEMPTS;

    await this.prisma.userTwoFactor.update({
      where: { userId },
      data: locked
        ? { failedAttempts: 0, lockedUntil: new Date(Date.now() + LOCKOUT_MS) }
        : { failedAttempts: next },
    });
  }

  private async registerSuccess(userId: number, timeStep?: number) {
    await this.prisma.userTwoFactor.update({
      where: { userId },
      data: {
        failedAttempts: 0,
        lockedUntil: null,
        lastUsedAt: new Date(),
        ...(timeStep !== undefined && { lastUsedStep: timeStep }),
      },
    });
  }

  // ── Code verification ──────────────────────────────────────────────────────

  /** Strips the spaces and dashes people paste in, and rejects non-strings —
   *  there is no global ValidationPipe, so bodies arrive untyped. */
  private normaliseCode(code: unknown): string {
    if (typeof code !== 'string') throw new BadRequestException(INVALID_CODE);
    return code.replace(/[\s-]/g, '').toUpperCase();
  }

  /**
   * Verify a code against an enrolled user, accepting either a TOTP code or one
   * of their one-time backup codes.
   *
   * Throws on failure; returns how the user got in on success.
   */
  /**
   * Decrypt a stored TOTP secret, turning an unreadable one into a clear
   * instruction rather than a 500.
   *
   * This fires when the secret was written under a different ENCRYPTION_KEY —
   * which happens when two environments share a database but not the key. The
   * user cannot fix that by retrying, so say what actually has to happen.
   */
  private decryptSecret(record: { secretCiphertext: string }): string {
    try {
      return this.cryptoService.decrypt(record.secretCiphertext);
    } catch {
      this.logger.error(
        'Stored two-factor secret could not be decrypted. ENCRYPTION_KEY does not match the key it was encrypted with — every environment sharing this database must use the same key.',
      );
      throw new ForbiddenException(
        'Your two-factor setup could not be read on this server and needs to be set up again. Ask an administrator to reset two-factor authentication on your account.',
      );
    }
  }

  async verifyCodeForUser(userId: number, rawCode: unknown) {
    const record = await this.prisma.userTwoFactor.findUnique({
      where: { userId },
    });
    if (!record?.confirmedAt) {
      throw new UnauthorizedException(INVALID_CODE);
    }

    this.assertNotLocked(record);
    const code = this.normaliseCode(rawCode);

    // A 6-digit numeric string is a TOTP attempt; anything else is treated as a
    // backup code. Both failure paths return the same message.
    if (/^\d{6}$/.test(code)) {
      const secret = this.decryptSecret(record);
      const result = await this.totp.verify(code, {
        secret,
        epochTolerance: EPOCH_TOLERANCE_SECONDS,
        // Native replay protection: a code from a step we have already accepted
        // is rejected even while it is still inside the tolerance window.
        ...(record.lastUsedStep !== null && {
          afterTimeStep: record.lastUsedStep,
        }),
      });

      if (!result.valid) {
        await this.registerFailure(userId, record.failedAttempts);
        throw new UnauthorizedException(INVALID_CODE);
      }

      await this.registerSuccess(userId, result.timeStep);
      return {
        usedBackupCode: false as const,
        backupCodesRemaining: await this.countBackupCodes(userId),
      };
    }

    const consumed = await this.consumeBackupCode(userId, code);
    if (!consumed) {
      await this.registerFailure(userId, record.failedAttempts);
      throw new UnauthorizedException(INVALID_CODE);
    }

    await this.registerSuccess(userId);
    return {
      usedBackupCode: true as const,
      backupCodesRemaining: await this.countBackupCodes(userId),
    };
  }

  private async consumeBackupCode(
    userId: number,
    code: string,
  ): Promise<boolean> {
    const candidates = await this.prisma.twoFactorBackupCode.findMany({
      where: { userId, usedAt: null },
    });

    for (const candidate of candidates) {
      if (await bcrypt.compare(code, candidate.codeHash)) {
        // Mark used conditionally so two simultaneous requests cannot both
        // spend the same code.
        const claimed = await this.prisma.twoFactorBackupCode.updateMany({
          where: { id: candidate.id, usedAt: null },
          data: { usedAt: new Date() },
        });
        return claimed.count === 1;
      }
    }

    return false;
  }

  private countBackupCodes(userId: number) {
    return this.prisma.twoFactorBackupCode.count({
      where: { userId, usedAt: null },
    });
  }

  // ── Enrolment ──────────────────────────────────────────────────────────────

  /**
   * Self-service enrolment: re-authenticate first, so a borrowed unlocked
   * session cannot silently bind a new authenticator. The forced-enrolment path
   * calls startEnrolment directly — there the password was just proven at login.
   */
  async startEnrolmentWithPassword(
    user: { id: number; email: string },
    password: unknown,
  ) {
    await this.assertPassword(user.id, password);
    return this.startEnrolment(user);
  }

  /**
   * Begin (or restart) enrolment: generate a fresh secret, store it encrypted
   * as PENDING, and return everything the user needs to add it to an app.
   *
   * Regenerating rather than erroring matters — someone who abandoned enrolment
   * on a laptop and resumed on their phone would otherwise be stuck with a QR
   * they never scanned.
   */
  async startEnrolment(user: { id: number; email: string }) {
    const existing = await this.prisma.userTwoFactor.findUnique({
      where: { userId: user.id },
    });
    if (existing?.confirmedAt) {
      throw new ForbiddenException(
        'Two-factor authentication is already enabled. Turn it off before enrolling again.',
      );
    }

    const secret = this.totp.generateSecret();
    const secretCiphertext = this.cryptoService.encrypt(secret);

    await this.prisma.$transaction([
      this.prisma.userTwoFactor.upsert({
        where: { userId: user.id },
        create: { userId: user.id, secretCiphertext },
        update: {
          secretCiphertext,
          confirmedAt: null,
          lastUsedStep: null,
          failedAttempts: 0,
          lockedUntil: null,
        },
      }),
      // An abandoned enrolment must not leave usable codes behind.
      this.prisma.twoFactorBackupCode.deleteMany({
        where: { userId: user.id },
      }),
    ]);

    return this.buildEnrolmentPayload(user.email, secret);
  }

  /** Everything a client needs to add a secret to an authenticator app. */
  private async buildEnrolmentPayload(email: string, secret: string) {
    const otpauthUri = generateURI({
      secret,
      label: email,
      issuer: TOTP_ISSUER,
      digits: TOTP_DIGITS,
      period: TOTP_PERIOD_SECONDS,
      strategy: 'totp',
    });

    // Rendered server-side so neither client needs a QR library.
    const qrDataUri = await QRCode.toDataURL(otpauthUri, {
      width: 320,
      margin: 1,
    });

    return { secret, otpauthUri, qrDataUri };
  }

  /**
   * Finish enrolment by proving possession. Sets confirmedAt and issues the
   * backup codes — the only moment they are ever visible.
   */
  async confirmEnrolment(userId: number, rawCode: unknown) {
    const record = await this.prisma.userTwoFactor.findUnique({
      where: { userId },
    });
    if (!record) {
      throw new BadRequestException(
        'Start two-factor setup before confirming a code.',
      );
    }
    if (record.confirmedAt) {
      throw new ForbiddenException(
        'Two-factor authentication is already enabled.',
      );
    }

    this.assertNotLocked(record);
    const code = this.normaliseCode(rawCode);

    if (!/^\d{6}$/.test(code)) {
      await this.registerFailure(userId, record.failedAttempts);
      throw new UnauthorizedException(INVALID_CODE);
    }

    const secret = this.decryptSecret(record);
    const result = await this.totp.verify(code, {
      secret,
      epochTolerance: EPOCH_TOLERANCE_SECONDS,
    });

    if (!result.valid) {
      await this.registerFailure(userId, record.failedAttempts);
      throw new UnauthorizedException(INVALID_CODE);
    }

    const backupCodes = this.generateBackupCodes();
    const hashes = await Promise.all(
      backupCodes.map((c) => bcrypt.hash(this.normaliseCode(c), 10)),
    );

    await this.prisma.$transaction([
      this.prisma.userTwoFactor.update({
        where: { userId },
        data: {
          confirmedAt: new Date(),
          lastUsedStep: result.timeStep,
          lastUsedAt: new Date(),
          failedAttempts: 0,
          lockedUntil: null,
        },
      }),
      this.prisma.twoFactorBackupCode.deleteMany({ where: { userId } }),
      this.prisma.twoFactorBackupCode.createMany({
        data: hashes.map((codeHash) => ({ userId, codeHash })),
      }),
    ]);

    return { backupCodes };
  }

  /**
   * Codes are shown grouped as XXXX-XXXX but stored hashed in their normalised
   * form, because that is what verification compares against — hashing the
   * dashed display form instead makes every code silently unusable.
   */
  private generateBackupCodes(): string[] {
    return Array.from({ length: BACKUP_CODE_COUNT }, () => {
      const chars = Array.from(
        { length: BACKUP_CODE_LENGTH },
        () =>
          BACKUP_CODE_ALPHABET[
            crypto.randomInt(0, BACKUP_CODE_ALPHABET.length)
          ],
      ).join('');
      // Displayed grouped; normaliseCode strips the dash again on the way back.
      return `${chars.slice(0, 4)}-${chars.slice(4)}`;
    });
  }

  // ── Moving to a new device ─────────────────────────────────────────────────

  /**
   * Begin moving the authenticator to a different phone.
   *
   * Before this existed there was no route at all: disable() refuses while the
   * company requires 2FA, startEnrolment() refuses while confirmedAt is set,
   * and adminReset() refuses to act on the caller's own account — so a company
   * with a single SUPERADMIN was stuck with hand-written SQL.
   *
   * This is a rotation, not a bypass. The caller proves the factor they already
   * hold (password + a live code, or a backup code if the old phone is gone),
   * and the replacement secret is parked in pendingSecretCiphertext rather than
   * overwriting the live one — so the OLD device keeps working until the new
   * one proves itself, and abandoning the move changes nothing.
   */
  async startRotation(
    user: { id: number; email: string },
    password: unknown,
    code: unknown,
  ) {
    const record = await this.prisma.userTwoFactor.findUnique({
      where: { userId: user.id },
    });
    if (!record?.confirmedAt) {
      throw new BadRequestException(
        'Two-factor authentication is not enabled on this account.',
      );
    }

    // Before any bcrypt or TOTP work: the backup-code path is up to ten bcrypt
    // compares, which a locked-out attacker must not be able to spend.
    this.assertNotLocked(record);
    await this.assertPassword(user.id, password);
    // Accepts a TOTP code or a backup code, and applies the same lockout.
    const proof = await this.verifyCodeForUser(user.id, code);

    const secret = this.totp.generateSecret();
    await this.prisma.userTwoFactor.update({
      where: { userId: user.id },
      data: {
        pendingSecretCiphertext: this.cryptoService.encrypt(secret),
        pendingStartedAt: new Date(),
      },
    });

    return {
      ...(await this.buildEnrolmentPayload(user.email, secret)),
      usedBackupCode: proof.usedBackupCode,
      backupCodesRemaining: proof.backupCodesRemaining,
      expiresInSeconds: Math.floor(ROTATION_TTL_MS / 1000),
    };
  }

  /**
   * Finish the move: prove the NEW device works, then promote its secret.
   *
   * confirmedAt is deliberately left alone — 2FA has been continuously on, and
   * rewriting the date would claim otherwise. Backup codes are untouched too:
   * they are hashed independently of the secret, so they stay valid.
   */
  async confirmRotation(userId: number, rawCode: unknown) {
    const record = await this.prisma.userTwoFactor.findUnique({
      where: { userId },
    });
    if (!record?.confirmedAt || !record.pendingSecretCiphertext) {
      throw new BadRequestException(
        'Start the device move before confirming a code.',
      );
    }

    if (this.rotationExpired(record)) {
      await this.clearPending(userId);
      throw new BadRequestException(
        'That device move timed out. Start it again.',
      );
    }

    this.assertNotLocked(record);
    const code = this.normaliseCode(rawCode);

    // Only a TOTP code proves the new device. A backup code would prove nothing
    // about the phone being set up.
    if (!/^\d{6}$/.test(code)) {
      await this.registerFailure(userId, record.failedAttempts);
      throw new UnauthorizedException(INVALID_CODE);
    }

    const pending = this.decryptSecret({
      secretCiphertext: record.pendingSecretCiphertext,
    });
    // No afterTimeStep here: the step counter was advanced by the OLD secret
    // moments ago, and applying it to a different secret would reject the new
    // phone's first code for up to a minute for no security benefit.
    const result = await this.totp.verify(code, {
      secret: pending,
      epochTolerance: EPOCH_TOLERANCE_SECONDS,
    });

    if (!result.valid) {
      await this.registerFailure(userId, record.failedAttempts);
      throw new UnauthorizedException(INVALID_CODE);
    }

    await this.prisma.userTwoFactor.update({
      where: { userId },
      data: {
        secretCiphertext: record.pendingSecretCiphertext,
        pendingSecretCiphertext: null,
        pendingStartedAt: null,
        lastUsedStep: result.timeStep,
        lastUsedAt: new Date(),
        failedAttempts: 0,
        lockedUntil: null,
      },
    });

    this.logger.log(`Two-factor device rotated for user ${userId}`);
    return { enabled: true, rotatedAt: new Date() };
  }

  /** Abandon a move; the original device carries on unaffected. */
  async cancelRotation(userId: number) {
    await this.clearPending(userId);
    return { rotationPending: false };
  }

  private rotationExpired(record: { pendingStartedAt: Date | null }): boolean {
    if (!record.pendingStartedAt) return true;
    return Date.now() - record.pendingStartedAt.getTime() > ROTATION_TTL_MS;
  }

  private async clearPending(userId: number) {
    await this.prisma.userTwoFactor.updateMany({
      where: { userId },
      data: { pendingSecretCiphertext: null, pendingStartedAt: null },
    });
  }

  // ── Management ─────────────────────────────────────────────────────────────

  async status(userId: number, companyId: number) {
    const [record, remaining, companyRequires] = await Promise.all([
      this.prisma.userTwoFactor.findUnique({ where: { userId } }),
      this.countBackupCodes(userId),
      this.companyRequires(companyId),
    ]);

    const enabled = !!record?.confirmedAt;
    const rotationPending =
      enabled &&
      !!record?.pendingSecretCiphertext &&
      !this.rotationExpired(record);
    return {
      enabled,
      confirmedAt: record?.confirmedAt ?? null,
      backupCodesRemaining: enabled ? remaining : 0,
      companyRequires,
      // Nobody may leave the company non-compliant by turning their own off.
      canDisable: enabled && !companyRequires,
      // Moving to a new phone stays available even when the company requires
      // 2FA — it rotates the secret rather than removing the factor.
      rotationPending,
      rotationStartedAt: rotationPending ? record?.pendingStartedAt ?? null : null,
    };
  }

  /** Read directly rather than through SystemSettingsService, whose getSettings
   *  lazily CREATES the row — a write nobody wants on the login hot path. */
  async companyRequires(companyId: number): Promise<boolean> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { companyId },
      select: { twoFactorRequired: true },
    });
    return setting?.twoFactorRequired === true;
  }

  async isEnabled(userId: number): Promise<boolean> {
    const record = await this.prisma.userTwoFactor.findUnique({
      where: { userId },
      select: { confirmedAt: true },
    });
    return !!record?.confirmedAt;
  }

  async disable(
    userId: number,
    companyId: number,
    password: unknown,
    code: unknown,
  ) {
    if (await this.companyRequires(companyId)) {
      throw new ForbiddenException(
        'Two-factor authentication is required by your company and cannot be turned off.',
      );
    }

    await this.assertPassword(userId, password);
    await this.verifyCodeForUser(userId, code);

    await this.prisma.$transaction([
      this.prisma.twoFactorBackupCode.deleteMany({ where: { userId } }),
      this.prisma.userTwoFactor.deleteMany({ where: { userId } }),
    ]);

    return { enabled: false };
  }

  async regenerateBackupCodes(
    userId: number,
    password: unknown,
    code: unknown,
  ) {
    await this.assertPassword(userId, password);
    await this.verifyCodeForUser(userId, code);

    const backupCodes = this.generateBackupCodes();
    const hashes = await Promise.all(
      backupCodes.map((c) => bcrypt.hash(this.normaliseCode(c), 10)),
    );

    await this.prisma.$transaction([
      this.prisma.twoFactorBackupCode.deleteMany({ where: { userId } }),
      this.prisma.twoFactorBackupCode.createMany({
        data: hashes.map((codeHash) => ({ userId, codeHash })),
      }),
    ]);

    return { backupCodes };
  }

  /**
   * Re-authentication before a security-sensitive change. A wrong password also
   * counts toward the lockout, so this cannot be used as a password oracle.
   */
  private async assertPassword(userId: number, password: unknown) {
    if (typeof password !== 'string' || !password) {
      throw new ForbiddenException('Your password is incorrect.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { password: true },
    });
    if (!user) throw new NotFoundException('User not found');

    if (!(await bcrypt.compare(password, user.password))) {
      const record = await this.prisma.userTwoFactor.findUnique({
        where: { userId },
      });
      if (record) await this.registerFailure(userId, record.failedAttempts);
      throw new ForbiddenException('Your password is incorrect.');
    }
  }

  // ── Administration ─────────────────────────────────────────────────────────

  /** SUPERADMIN view of who in their own company has 2FA on. */
  async listForCompany(companyId: number) {
    const users = await this.prisma.user.findMany({
      where: { companyId },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        employee: { select: { firstName: true, lastName: true } },
        twoFactor: { select: { confirmedAt: true } },
      },
      orderBy: { email: 'asc' },
    });

    return users.map((u) => ({
      userId: u.id,
      email: u.email,
      role: u.role,
      status: u.status,
      name: u.employee
        ? `${u.employee.firstName} ${u.employee.lastName}`.trim()
        : null,
      enabled: !!u.twoFactor?.confirmedAt,
      confirmedAt: u.twoFactor?.confirmedAt ?? null,
    }));
  }

  /**
   * Clear another user's 2FA so they can sign in with a password again — the
   * recovery path when someone loses both their phone and their backup codes.
   */
  async adminReset(
    actor: { sub: number; companyId: number },
    targetUserId: number,
  ) {
    if (actor.sub === targetUserId) {
      // Otherwise this is a self-service bypass of the user's own second factor.
      throw new ForbiddenException(
        'Use the disable option to turn off your own two-factor authentication.',
      );
    }

    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, email: true, companyId: true },
    });

    // Checked explicitly: without it a SUPERADMIN of one company could clear
    // the second factor of a user in another.
    if (!target || target.companyId !== actor.companyId) {
      throw new NotFoundException('User not found');
    }

    await this.prisma.$transaction([
      this.prisma.twoFactorBackupCode.deleteMany({
        where: { userId: targetUserId },
      }),
      this.prisma.userTwoFactor.deleteMany({ where: { userId: targetUserId } }),
    ]);

    return {
      message: `Two-factor authentication has been reset for ${target.email}. They can sign in with their password until they enrol again.`,
    };
  }
}
