import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TOTP, NobleCryptoPlugin, ScureBase32Plugin } from 'otplib';
import * as bcrypt from 'bcrypt';

import { TwoFactorService } from './two-factor.service';
import { ROTATION_TTL_MS, TOTP_DIGITS, TOTP_PERIOD_SECONDS } from './two-factor.constants';

/**
 * Moving an authenticator to a new phone.
 *
 * Before this flow existed the combination of rules was a dead end: disable()
 * refuses while the company requires 2FA, startEnrolment() refuses while
 * confirmedAt is set, and adminReset() refuses to act on the caller's own
 * account — so a company with one SUPERADMIN had no route at all.
 *
 * The property these tests exist to protect is that a rotation is never a way
 * OUT of 2FA: the old secret keeps working until the new one is proved, and an
 * abandoned or failed move leaves the account exactly as it was.
 *
 * Real otplib and real bcrypt, matching two-factor.service.spec.ts — stubbing
 * the crypto would test nothing.
 */
describe('TwoFactorService — device rotation', () => {
  const totp = new TOTP({
    crypto: new NobleCryptoPlugin(),
    base32: new ScureBase32Plugin(),
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD_SECONDS,
  });

  const USER = { id: 7, email: 'a@b.com' };
  const PASSWORD = 'correct-horse';

  let oldSecret: string;
  let passwordHash: string;
  let prisma: any;
  let service: TwoFactorService;
  let row: any;
  let backupCodes: any[];

  const cryptoService: any = {
    encrypt: (t: string) => `v1:${t}`,
    decrypt: (t: string) => t.replace(/^v1:/, ''),
  };

  const build = (overrides: Partial<any> = {}) => {
    row = {
      userId: USER.id,
      secretCiphertext: `v1:${oldSecret}`,
      pendingSecretCiphertext: null,
      pendingStartedAt: null,
      confirmedAt: new Date('2026-09-09T00:00:00Z'),
      lastUsedStep: null,
      failedAttempts: 0,
      lockedUntil: null,
      ...overrides,
    };

    prisma = {
      userTwoFactor: {
        findUnique: jest.fn(async () => row),
        update: jest.fn(async ({ data }: any) => Object.assign(row, data)),
        updateMany: jest.fn(async ({ data }: any) => {
          Object.assign(row, data);
          return { count: 1 };
        }),
        upsert: jest.fn(async () => row),
        deleteMany: jest.fn(async () => ({ count: 1 })),
      },
      twoFactorBackupCode: {
        findMany: jest.fn(async () => backupCodes.filter((c) => c.usedAt === null)),
        updateMany: jest.fn(async ({ where }: any) => {
          const r = backupCodes.find((c) => c.id === where.id && c.usedAt === null);
          if (!r) return { count: 0 };
          r.usedAt = new Date();
          return { count: 1 };
        }),
        deleteMany: jest.fn(async () => { backupCodes = []; return { count: 0 }; }),
        createMany: jest.fn(async () => ({ count: 10 })),
        count: jest.fn(async () => backupCodes.filter((c) => c.usedAt === null).length),
      },
      user: {
        findUnique: jest.fn(async () => ({
          id: USER.id, email: USER.email, companyId: 1,
          password: passwordHash, status: 'ACTIVE',
        })),
      },
      systemSetting: {
        // The whole point: this stays true throughout. A rotation must work
        // even under a policy that forbids turning 2FA off.
        findUnique: jest.fn(async () => ({ twoFactorRequired: true })),
      },
      $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
    };

    service = new TwoFactorService(prisma, new JwtService({ secret: 'test' }), cryptoService);
  };

  beforeAll(async () => { passwordHash = await bcrypt.hash(PASSWORD, 10); });

  beforeEach(() => {
    oldSecret = totp.generateSecret();
    backupCodes = [];
    build();
  });

  const codeFor = (secret: string) => totp.generate({ secret });
  const oldCode = () => codeFor(oldSecret);
  /** The secret handed to the new phone, as stored by startRotation. */
  const pendingSecret = () => row.pendingSecretCiphertext.replace(/^v1:/, '');

  describe('starting a move', () => {
    it('issues a new secret and a scannable QR', async () => {
      const res = await service.startRotation(USER, PASSWORD, await oldCode());

      expect(res.secret).toBeTruthy();
      expect(res.secret).not.toBe(oldSecret);
      expect(res.qrDataUri).toMatch(/^data:image\/png;base64,/);
      expect(res.otpauthUri).toContain('otpauth://totp/');
      expect(row.pendingSecretCiphertext).toBe(`v1:${res.secret}`);
    });

    it('leaves the old secret live while the move is open', async () => {
      await service.startRotation(USER, PASSWORD, await oldCode());

      expect(row.secretCiphertext).toBe(`v1:${oldSecret}`);
      expect(row.confirmedAt).toBeTruthy();
      // And the old phone still signs in. Starting the move consumed a code, so
      // clear the replay marker first — re-presenting that same code inside the
      // same 30s window is correctly refused, and replay protection is already
      // covered in two-factor.service.spec.ts.
      row.lastUsedStep = null;
      await expect(
        service.verifyCodeForUser(USER.id, await oldCode()),
      ).resolves.toMatchObject({ usedBackupCode: false });
    });

    it('refuses a wrong password', async () => {
      await expect(
        service.startRotation(USER, 'wrong', await oldCode()),
      ).rejects.toThrow(ForbiddenException);
      expect(row.pendingSecretCiphertext).toBeNull();
    });

    it('refuses a wrong code', async () => {
      await expect(
        service.startRotation(USER, PASSWORD, '000000'),
      ).rejects.toThrow(UnauthorizedException);
      expect(row.pendingSecretCiphertext).toBeNull();
    });

    // The phone is already lost — this is the case the flow mainly exists for.
    it('accepts a backup code instead of a live code', async () => {
      backupCodes = [{ id: 1, usedAt: null, codeHash: await bcrypt.hash('ABCD2345', 10) }];

      const res = await service.startRotation(USER, PASSWORD, 'abcd-2345');
      expect(res.usedBackupCode).toBe(true);
      expect(row.pendingSecretCiphertext).toBeTruthy();
    });

    it('refuses when 2FA is not enabled at all', async () => {
      build({ confirmedAt: null });
      await expect(
        service.startRotation(USER, PASSWORD, await oldCode()),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses while the account is locked out', async () => {
      build({ lockedUntil: new Date(Date.now() + 60_000) });
      await expect(
        service.startRotation(USER, PASSWORD, await oldCode()),
      ).rejects.toThrow();
      // Rejected before spending any bcrypt on the password.
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('confirming the move', () => {
    const start = async () => service.startRotation(USER, PASSWORD, await oldCode());

    it('promotes the new secret once the new phone proves itself', async () => {
      await start();
      const next = pendingSecret();

      const res = await service.confirmRotation(USER.id, await codeFor(next));

      expect(res.enabled).toBe(true);
      expect(row.secretCiphertext).toBe(`v1:${next}`);
      expect(row.pendingSecretCiphertext).toBeNull();
      expect(row.pendingStartedAt).toBeNull();
    });

    it('retires the old device afterwards', async () => {
      await start();
      await service.confirmRotation(USER.id, await codeFor(pendingSecret()));

      await expect(
        service.verifyCodeForUser(USER.id, await oldCode()),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('keeps the original activation date', async () => {
      const before = row.confirmedAt;
      await start();
      await service.confirmRotation(USER.id, await codeFor(pendingSecret()));
      // 2FA was never off, so "active since" must not jump to today.
      expect(row.confirmedAt).toEqual(before);
    });

    it('rejects the old phone’s code as proof of the new one', async () => {
      await start();
      await expect(
        service.confirmRotation(USER.id, await oldCode()),
      ).rejects.toThrow(UnauthorizedException);
      // Still pending, old secret still live — nothing was given away.
      expect(row.secretCiphertext).toBe(`v1:${oldSecret}`);
      expect(row.pendingSecretCiphertext).toBeTruthy();
    });

    it('rejects a backup code — it proves nothing about the new phone', async () => {
      backupCodes = [{ id: 1, usedAt: null, codeHash: await bcrypt.hash('ABCD2345', 10) }];
      await start();
      await expect(
        service.confirmRotation(USER.id, 'ABCD-2345'),
      ).rejects.toThrow(UnauthorizedException);
      expect(row.secretCiphertext).toBe(`v1:${oldSecret}`);
    });

    it('refuses when no move was started', async () => {
      await expect(
        service.confirmRotation(USER.id, '123456'),
      ).rejects.toThrow(BadRequestException);
    });

    it('expires a move left open too long, without disturbing the old secret', async () => {
      await start();
      row.pendingStartedAt = new Date(Date.now() - ROTATION_TTL_MS - 1000);
      const next = pendingSecret();

      await expect(
        service.confirmRotation(USER.id, await codeFor(next)),
      ).rejects.toThrow(/timed out/i);
      expect(row.pendingSecretCiphertext).toBeNull();
      expect(row.secretCiphertext).toBe(`v1:${oldSecret}`);
    });
  });

  describe('abandoning the move', () => {
    it('clears the pending secret and leaves the old device working', async () => {
      await service.startRotation(USER, PASSWORD, await oldCode());
      await service.cancelRotation(USER.id);

      expect(row.pendingSecretCiphertext).toBeNull();
      expect(row.secretCiphertext).toBe(`v1:${oldSecret}`);
      row.lastUsedStep = null; // see the note in "starting a move"
      await expect(
        service.verifyCodeForUser(USER.id, await oldCode()),
      ).resolves.toMatchObject({ usedBackupCode: false });
    });
  });

  describe('status', () => {
    it('reports a move in progress so the page can resume it', async () => {
      await service.startRotation(USER, PASSWORD, await oldCode());
      const s = await service.status(USER.id, 1);

      expect(s.rotationPending).toBe(true);
      expect(s.enabled).toBe(true);
      // The policy forbids disabling — and that is exactly why this flow exists.
      expect(s.canDisable).toBe(false);
    });

    it('does not report an expired move as pending', async () => {
      await service.startRotation(USER, PASSWORD, await oldCode());
      row.pendingStartedAt = new Date(Date.now() - ROTATION_TTL_MS - 1000);

      const s = await service.status(USER.id, 1);
      expect(s.rotationPending).toBe(false);
    });
  });
});
