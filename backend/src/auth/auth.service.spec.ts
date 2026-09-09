import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

import { AuthService } from './auth.service';
import { TwoFactorService } from './two-factor.service';

/**
 * Focused on login()'s three outcomes and on refreshToken()'s compliance
 * re-check. Was previously Nest boilerplate that provided no mocks for the four
 * injected dependencies and so could not compile.
 */
describe('AuthService — login and refresh', () => {
  const PASSWORD = 'correct-horse';
  let passwordHash: string;

  let prisma: any;
  let twoFactor: any;
  let service: AuthService;

  // refreshToken() derives its secret from the environment rather than from the
  // injected JwtService, so the tests have to pin JWT_SECRET to sign a token
  // the service will actually accept.
  const JWT_SECRET = 'test-secret';
  const originalSecret = process.env.JWT_SECRET;

  const user = (overrides: Partial<any> = {}) => ({
    id: 7,
    email: 'a@b.com',
    password: passwordHash,
    role: 'EMPLOYEE',
    companyId: 1,
    status: 'ACTIVE',
    employee: { id: 3 },
    twoFactor: null,
    ...overrides,
  });

  beforeAll(async () => {
    passwordHash = await bcrypt.hash(PASSWORD, 10);
    process.env.JWT_SECRET = JWT_SECRET;
  });

  afterAll(() => {
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  });

  beforeEach(() => {
    prisma = {
      user: {
        findFirst: jest.fn(async () => user()),
        findUnique: jest.fn(async () => user()),
      },
    };
    twoFactor = {
      companyRequires: jest.fn(async () => false),
      issueChallenge: jest.fn(async () => 'challenge-token'),
    };

    service = new AuthService(
      prisma,
      new JwtService({ secret: JWT_SECRET }),
      {} as any, // MailService — unused on these paths
      {} as any, // CompanySeederService — unused on these paths
      twoFactor as TwoFactorService,
    );
  });

  describe('when two-factor is not involved', () => {
    it('returns a token pair', async () => {
      const result: any = await service.login('a@b.com', PASSWORD);

      expect(result.access_token).toEqual(expect.any(String));
      expect(result.refresh_token).toEqual(expect.any(String));
      expect(result.twoFactorRequired).toBeUndefined();
      expect(twoFactor.issueChallenge).not.toHaveBeenCalled();
    });

    it('still rejects a wrong password', async () => {
      await expect(service.login('a@b.com', 'wrong')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('still blocks an unverified account before reaching the 2FA gate', async () => {
      prisma.user.findFirst.mockResolvedValue(
        user({ status: 'PENDING_VERIFICATION' }),
      );

      await expect(service.login('a@b.com', PASSWORD)).rejects.toThrow(
        /verify your email/i,
      );
      expect(twoFactor.companyRequires).not.toHaveBeenCalled();
    });
  });

  describe('when the user has two-factor enabled', () => {
    beforeEach(() => {
      prisma.user.findFirst.mockResolvedValue(
        user({ twoFactor: { confirmedAt: new Date() } }),
      );
    });

    it('returns a VERIFY challenge and NO tokens', async () => {
      const result: any = await service.login('a@b.com', PASSWORD);

      expect(result).toMatchObject({
        twoFactorRequired: true,
        mode: 'VERIFY',
        challengeToken: 'challenge-token',
      });
      // The clients only persist a session when access_token is present, so
      // omitting it is what keeps the user signed out mid-challenge.
      expect(result.access_token).toBeUndefined();
      expect(result.refresh_token).toBeUndefined();
    });

    it('treats a pending enrolment as NOT enabled', async () => {
      // A row exists from the moment enrolment starts; only confirmedAt counts.
      prisma.user.findFirst.mockResolvedValue(
        user({ twoFactor: { confirmedAt: null } }),
      );

      const result: any = await service.login('a@b.com', PASSWORD);
      expect(result.access_token).toEqual(expect.any(String));
    });
  });

  describe('when the company requires two-factor', () => {
    it('returns an ENROL challenge for a user who has not enrolled', async () => {
      twoFactor.companyRequires.mockResolvedValue(true);

      const result: any = await service.login('a@b.com', PASSWORD);

      expect(result).toMatchObject({ twoFactorRequired: true, mode: 'ENROL' });
      expect(result.access_token).toBeUndefined();
    });

    it('still asks an enrolled user to VERIFY, not to enrol again', async () => {
      twoFactor.companyRequires.mockResolvedValue(true);
      prisma.user.findFirst.mockResolvedValue(
        user({ twoFactor: { confirmedAt: new Date() } }),
      );

      const result: any = await service.login('a@b.com', PASSWORD);
      expect(result.mode).toBe('VERIFY');
    });
  });

  describe('refreshToken', () => {
    const refreshFor = (payload: any) =>
      new JwtService({ secret: `${JWT_SECRET}_refresh` }).sign(payload);

    it('re-reads the user rather than trusting the payload', async () => {
      const token = refreshFor({
        sub: 7,
        email: 'a@b.com',
        role: 'EMPLOYEE',
        companyId: 1,
      });

      const result: any = await service.refreshToken(token);

      expect(prisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 7 } }),
      );
      expect(result.access_token).toEqual(expect.any(String));
    });

    it('ends the session of a user who has since been suspended', async () => {
      prisma.user.findUnique.mockResolvedValue(user({ status: 'SUSPENDED' }));
      const token = refreshFor({ sub: 7, companyId: 1 });

      // Previously a suspended account kept a live session until the refresh
      // token expired, up to seven days later.
      await expect(service.refreshToken(token)).rejects.toThrow(
        /no longer valid/i,
      );
    });

    it('ends the session when the company now requires 2FA and the user has none', async () => {
      twoFactor.companyRequires.mockResolvedValue(true);
      const token = refreshFor({ sub: 7, companyId: 1 });

      await expect(service.refreshToken(token)).rejects.toThrow(
        /Two-factor authentication setup is required/,
      );
    });

    it('lets an enrolled user refresh under company enforcement', async () => {
      twoFactor.companyRequires.mockResolvedValue(true);
      prisma.user.findUnique.mockResolvedValue(
        user({ twoFactor: { confirmedAt: new Date() } }),
      );
      const token = refreshFor({ sub: 7, companyId: 1 });

      await expect(service.refreshToken(token)).resolves.toMatchObject({
        access_token: expect.any(String),
      });
    });

    it('rejects a token signed with the access secret', async () => {
      const wrong = new JwtService({ secret: JWT_SECRET }).sign({ sub: 7 });
      await expect(service.refreshToken(wrong)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
