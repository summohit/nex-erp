import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TOTP, NobleCryptoPlugin, ScureBase32Plugin } from 'otplib';
import * as bcrypt from 'bcrypt';

import { TwoFactorService } from './two-factor.service';
import {
  MAX_FAILED_ATTEMPTS,
  TOTP_DIGITS,
  TOTP_PERIOD_SECONDS,
} from './two-factor.constants';

/**
 * Real otplib and real bcrypt throughout — the point of these tests is that the
 * actual cryptographic behaviour is right, so stubbing it would test nothing.
 * Only Prisma and CryptoService are faked.
 */
describe('TwoFactorService', () => {
  const totp = new TOTP({
    crypto: new NobleCryptoPlugin(),
    base32: new ScureBase32Plugin(),
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD_SECONDS,
  });

  const USER_ID = 7;
  const COMPANY_ID = 1;
  let secret: string;

  /** Passthrough "encryption" so real secrets flow through the service. */
  const cryptoService: any = {
    encrypt: (t: string) => `v1:${t}`,
    decrypt: (t: string) => t.replace(/^v1:/, ''),
  };

  let prisma: any;
  let service: TwoFactorService;
  let twoFactorRow: any;
  let backupCodes: any[];

  const build = (overrides: Partial<any> = {}) => {
    twoFactorRow = {
      userId: USER_ID,
      secretCiphertext: `v1:${secret}`,
      confirmedAt: new Date(),
      lastUsedStep: null,
      failedAttempts: 0,
      lockedUntil: null,
      ...overrides,
    };

    prisma = {
      userTwoFactor: {
        findUnique: jest.fn(async () => twoFactorRow),
        update: jest.fn(async ({ data }: any) =>
          Object.assign(twoFactorRow, data),
        ),
        upsert: jest.fn(async () => twoFactorRow),
        deleteMany: jest.fn(async () => ({ count: 1 })),
      },
      twoFactorBackupCode: {
        findMany: jest.fn(async () =>
          backupCodes.filter((c) => c.usedAt === null),
        ),
        updateMany: jest.fn(async ({ where }: any) => {
          const row = backupCodes.find(
            (c) => c.id === where.id && c.usedAt === null,
          );
          if (!row) return { count: 0 };
          row.usedAt = new Date();
          return { count: 1 };
        }),
        deleteMany: jest.fn(async () => {
          backupCodes = [];
          return { count: 0 };
        }),
        createMany: jest.fn(async () => ({ count: 10 })),
        count: jest.fn(
          async () => backupCodes.filter((c) => c.usedAt === null).length,
        ),
      },
      user: {
        findUnique: jest.fn(async () => ({
          id: USER_ID,
          email: 'a@b.com',
          companyId: COMPANY_ID,
          password: '$2b$10$abcdefghijklmnopqrstuv',
          status: 'ACTIVE',
        })),
        findMany: jest.fn(async () => []),
      },
      systemSetting: {
        findUnique: jest.fn(async () => ({ twoFactorRequired: false })),
      },
      $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
    };

    service = new TwoFactorService(
      prisma,
      new JwtService({ secret: 'test' }),
      cryptoService,
    );
    return service;
  };

  beforeEach(async () => {
    secret = totp.generateSecret();
    backupCodes = [];
    build();
  });

  const currentCode = () => totp.generate({ secret });

  describe('TOTP verification', () => {
    it('accepts a freshly generated code', async () => {
      const result = await service.verifyCodeForUser(
        USER_ID,
        await currentCode(),
      );
      expect(result.usedBackupCode).toBe(false);
    });

    it('rejects a wrong code', async () => {
      await expect(
        service.verifyCodeForUser(USER_ID, '000000'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a code from three time steps ago', async () => {
      // Tolerance is ~one step either side; 90s in the past must be long gone.
      const stale = await totp.generate({
        secret,
        epoch: Math.floor(Date.now() / 1000) - 3 * TOTP_PERIOD_SECONDS,
      });
      await expect(service.verifyCodeForUser(USER_ID, stale)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('strips spaces and dashes before verifying', async () => {
      const code = await currentCode();
      const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
      await expect(
        service.verifyCodeForUser(USER_ID, spaced),
      ).resolves.toMatchObject({ usedBackupCode: false });
    });

    it('rejects a non-string code instead of handing it to otplib', async () => {
      await expect(
        service.verifyCodeForUser(USER_ID, { evil: true } as any),
      ).rejects.toThrow();
      await expect(
        service.verifyCodeForUser(USER_ID, null as any),
      ).rejects.toThrow();
    });
  });

  describe('replay protection', () => {
    it('rejects the same code the second time', async () => {
      const code = await currentCode();

      await expect(
        service.verifyCodeForUser(USER_ID, code),
      ).resolves.toBeDefined();
      expect(twoFactorRow.lastUsedStep).toEqual(expect.any(Number));

      // Still inside the tolerance window, but the step is already spent — this
      // is what stops a shoulder-surfed code being reused for ~90 seconds.
      await expect(service.verifyCodeForUser(USER_ID, code)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('lockout', () => {
    it('locks the account after the configured number of failures', async () => {
      for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
        await expect(
          service.verifyCodeForUser(USER_ID, '000000'),
        ).rejects.toThrow();
      }

      expect(twoFactorRow.lockedUntil).toBeInstanceOf(Date);
      expect(twoFactorRow.lockedUntil.getTime()).toBeGreaterThan(Date.now());
    });

    it('rejects a CORRECT code while locked, before doing any TOTP work', async () => {
      build({ lockedUntil: new Date(Date.now() + 10 * 60 * 1000) });
      const decrypt = jest.spyOn(cryptoService, 'decrypt');

      await expect(
        service.verifyCodeForUser(USER_ID, await currentCode()),
      ).rejects.toThrow(/Too many failed attempts/);

      // Never decrypted, never compared — a locked account cannot be used to
      // burn CPU, which matters because backup codes cost up to 10 bcrypts.
      expect(decrypt).not.toHaveBeenCalled();
      decrypt.mockRestore();
    });

    it('lets the user back in once the lock has expired', async () => {
      build({ lockedUntil: new Date(Date.now() - 1000) });
      await expect(
        service.verifyCodeForUser(USER_ID, await currentCode()),
      ).resolves.toBeDefined();
    });

    it('clears the failure count on success', async () => {
      build({ failedAttempts: 3 });
      await service.verifyCodeForUser(USER_ID, await currentCode());
      expect(twoFactorRow.failedAttempts).toBe(0);
    });
  });

  describe('backup codes — round trip through the real generator', () => {
    /**
     * The earlier tests seed a hash by hand, which verifies the consumer in
     * isolation and cannot catch the producer storing a different form. It
     * missed exactly that: codes were hashed WITH their display dash and
     * compared WITHOUT it, so no backup code ever worked.
     */
    it('a code issued at enrolment actually signs the user in', async () => {
      build({ confirmedAt: null });
      const { backupCodes: issued } = await service.confirmEnrolment(USER_ID, await currentCode());

      // Capture what confirmEnrolment really stored.
      const stored = prisma.twoFactorBackupCode.createMany.mock.calls[0][0].data;
      backupCodes = stored.map((row: any, i: number) => ({ id: i + 1, userId: USER_ID, ...row, usedAt: null }));

      build({ confirmedAt: new Date(), lastUsedStep: null });
      backupCodes = stored.map((row: any, i: number) => ({ id: i + 1, userId: USER_ID, ...row, usedAt: null }));

      await expect(service.verifyCodeForUser(USER_ID, issued[0]))
        .resolves.toMatchObject({ usedBackupCode: true });
    });

    it('accepts an issued code typed without its dash', async () => {
      build({ confirmedAt: null });
      const { backupCodes: issued } = await service.confirmEnrolment(USER_ID, await currentCode());
      const stored = prisma.twoFactorBackupCode.createMany.mock.calls[0][0].data;

      build({ confirmedAt: new Date(), lastUsedStep: null });
      backupCodes = stored.map((row: any, i: number) => ({ id: i + 1, userId: USER_ID, ...row, usedAt: null }));

      await expect(service.verifyCodeForUser(USER_ID, issued[0].replace('-', '')))
        .resolves.toMatchObject({ usedBackupCode: true });
    });
  });

  describe('backup codes', () => {
    const seed = async (plain: string) => {
      backupCodes = [
        {
          id: 1,
          userId: USER_ID,
          codeHash: await bcrypt.hash(plain, 10),
          usedAt: null,
        },
      ];
    };

    it('accepts a backup code and marks it used', async () => {
      await seed('ABCD2345');
      const result = await service.verifyCodeForUser(USER_ID, 'ABCD-2345');

      expect(result.usedBackupCode).toBe(true);
      expect(backupCodes[0].usedAt).toBeInstanceOf(Date);
    });

    it('rejects the same backup code the second time', async () => {
      await seed('ABCD2345');
      await service.verifyCodeForUser(USER_ID, 'ABCD-2345');
      await expect(
        service.verifyCodeForUser(USER_ID, 'ABCD-2345'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('is case-insensitive', async () => {
      await seed('ABCD2345');
      await expect(
        service.verifyCodeForUser(USER_ID, 'abcd-2345'),
      ).resolves.toMatchObject({ usedBackupCode: true });
    });

    it('gives the same error as a wrong TOTP code', async () => {
      await seed('ABCD2345');
      const backupErr = await service
        .verifyCodeForUser(USER_ID, 'ZZZZ-9999')
        .catch((e) => e.message);
      const totpErr = await service
        .verifyCodeForUser(USER_ID, '000000')
        .catch((e) => e.message);

      // Which factor was recognised is not something an attacker should learn.
      expect(backupErr).toBe(totpErr);
    });
  });

  describe('enrolment', () => {
    it('does not treat a pending enrolment as enabled', async () => {
      build({ confirmedAt: null });

      expect(await service.isEnabled(USER_ID)).toBe(false);
      // A row exists, but an unconfirmed secret must not let anyone in.
      await expect(
        service.verifyCodeForUser(USER_ID, await currentCode()),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('returns a QR data-URI, an otpauth URI and the raw secret', async () => {
      build({ confirmedAt: null });
      const result = await service.startEnrolment({
        id: USER_ID,
        email: 'a@b.com',
      });

      expect(result.qrDataUri.startsWith('data:image/png;base64,')).toBe(true);
      expect(result.otpauthUri.startsWith('otpauth://totp/')).toBe(true);
      expect(result.secret).toEqual(expect.any(String));
    });

    it('refuses to restart enrolment while 2FA is already on', async () => {
      await expect(
        service.startEnrolment({ id: USER_ID, email: 'a@b.com' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('regenerates rather than erroring when a pending enrolment is resumed', async () => {
      build({ confirmedAt: null });
      const first = await service.startEnrolment({
        id: USER_ID,
        email: 'a@b.com',
      });
      const second = await service.startEnrolment({
        id: USER_ID,
        email: 'a@b.com',
      });

      // Someone who abandoned on a laptop and resumed on a phone must not be
      // stuck with a QR they never scanned.
      expect(second.secret).not.toBe(first.secret);
    });

    it('issues ten backup codes on confirmation', async () => {
      build({ confirmedAt: null });
      const { backupCodes: issued } = await service.confirmEnrolment(
        USER_ID,
        await currentCode(),
      );

      expect(issued).toHaveLength(10);
      expect(
        issued.every((c) => /^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/.test(c)),
      ).toBe(true);
      expect(new Set(issued).size).toBe(10);
      expect(twoFactorRow.confirmedAt).toBeInstanceOf(Date);
    });

    it('rejects a wrong code at confirmation and leaves 2FA off', async () => {
      build({ confirmedAt: null });
      await expect(service.confirmEnrolment(USER_ID, '000000')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(twoFactorRow.confirmedAt).toBeNull();
    });
  });

  describe('disable', () => {
    it('refuses when the company requires 2FA', async () => {
      prisma.systemSetting.findUnique.mockResolvedValue({
        twoFactorRequired: true,
      });

      await expect(
        service.disable(USER_ID, COMPANY_ID, 'pw', '000000'),
      ).rejects.toThrow(/required by your company/);
    });

    it('reports canDisable false under company enforcement', async () => {
      prisma.systemSetting.findUnique.mockResolvedValue({
        twoFactorRequired: true,
      });
      const status = await service.status(USER_ID, COMPANY_ID);

      expect(status).toMatchObject({
        enabled: true,
        companyRequires: true,
        canDisable: false,
      });
    });
  });

  describe('admin reset', () => {
    it('refuses to reset a user in another company', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 99,
        email: 'x@y.com',
        companyId: 999,
      });

      // The tenancy check — without it a SuperAdmin could strip the second
      // factor from a user in an unrelated company.
      await expect(
        service.adminReset({ sub: 1, companyId: COMPANY_ID }, 99),
      ).rejects.toThrow(/not found/i);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuses to reset yourself', async () => {
      await expect(
        service.adminReset({ sub: USER_ID, companyId: COMPANY_ID }, USER_ID),
      ).rejects.toThrow(/disable option/);
    });

    it('clears the enrolment for a user in the same company', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 99,
        email: 'x@y.com',
        companyId: COMPANY_ID,
      });
      const result = await service.adminReset(
        { sub: 1, companyId: COMPANY_ID },
        99,
      );

      expect(result.message).toContain('x@y.com');
      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });

  describe('a secret encrypted under a different key', () => {
    /**
     * Two environments sharing one database but not the ENCRYPTION_KEY makes
     * every stored secret unreadable in the other. That surfaced as a bare
     * "Internal server error" with nothing telling the user what to do.
     */
    it('reports what has to happen instead of throwing a 500', async () => {
      const boom = jest.spyOn(cryptoService, 'decrypt').mockImplementation(() => {
        throw new Error('Unsupported state or unable to authenticate data');
      });

      await expect(service.verifyCodeForUser(USER_ID, await currentCode()))
        .rejects.toThrow(/needs to be set up again/i);

      boom.mockRestore();
    });

    it('surfaces the same guidance during enrolment confirmation', async () => {
      build({ confirmedAt: null });
      const boom = jest.spyOn(cryptoService, 'decrypt').mockImplementation(() => {
        throw new Error('Unsupported state or unable to authenticate data');
      });

      await expect(service.confirmEnrolment(USER_ID, '123456'))
        .rejects.toThrow(/needs to be set up again/i);

      boom.mockRestore();
    });
  });

  describe('challenge tokens', () => {
    it('round-trips a challenge and binds it to the password', async () => {
      const user = { id: USER_ID, password: '$2b$10$abcdefghijklmnopqrstuv' };
      const token = await service.issueChallenge(user, 'VERIFY');

      await expect(
        service.decodeChallenge(token, 'VERIFY'),
      ).resolves.toMatchObject({ mode: 'VERIFY' });
    });

    it('rejects a challenge issued for a different mode', async () => {
      const token = await service.issueChallenge(
        { id: USER_ID, password: '$2b$10$abcdefghijklmnopqrstuv' },
        'ENROL',
      );
      await expect(service.decodeChallenge(token, 'VERIFY')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a challenge after the password changed', async () => {
      const token = await service.issueChallenge(
        { id: USER_ID, password: '$2b$10$abcdefghijklmnopqrstuv' },
        'VERIFY',
      );
      prisma.user.findUnique.mockResolvedValue({
        id: USER_ID,
        email: 'a@b.com',
        companyId: COMPANY_ID,
        status: 'ACTIVE',
        password: '$2b$10$COMPLETELYDIFFERENTvv',
      });

      await expect(service.decodeChallenge(token, 'VERIFY')).rejects.toThrow(
        /password changed/i,
      );
    });

    it('rejects a challenge for a deactivated account', async () => {
      const token = await service.issueChallenge(
        { id: USER_ID, password: '$2b$10$abcdefghijklmnopqrstuv' },
        'VERIFY',
      );
      prisma.user.findUnique.mockResolvedValue({
        id: USER_ID,
        email: 'a@b.com',
        companyId: COMPANY_ID,
        status: 'SUSPENDED',
        password: '$2b$10$abcdefghijklmnopqrstuv',
      });

      await expect(service.decodeChallenge(token, 'VERIFY')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects garbage', async () => {
      await expect(service.decodeChallenge('not-a-jwt')).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.decodeChallenge(undefined)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
