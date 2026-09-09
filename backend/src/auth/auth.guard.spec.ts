import { JwtService } from '@nestjs/jwt';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { challengeSecret } from './two-factor.constants';

/**
 * AuthGuard's only real check is the JWT signature — it does not inspect the
 * token's purpose. That makes the two-factor challenge token dangerous: if it
 * ever verified here, a half-authenticated user would hold a full session for
 * every guarded route in the ERP.
 *
 * A real JwtService is used deliberately, so signatures genuinely have to hold.
 */
describe('AuthGuard', () => {
  const SECRET = 'test-jwt-secret';
  const original = process.env.JWT_SECRET;

  let jwt: JwtService;
  let prisma: any;
  let guard: AuthGuard;

  beforeEach(() => {
    process.env.JWT_SECRET = SECRET;
    jwt = new JwtService({ secret: SECRET });
    prisma = { employee: { findFirst: jest.fn().mockResolvedValue(null) } };
    guard = new AuthGuard(jwt, prisma);
  });

  afterAll(() => {
    if (original === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = original;
  });

  const contextFor = (token?: string) => {
    const request: any = {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
      __request: request,
    } as unknown as ExecutionContext & { __request: any };
  };

  const accessToken = () =>
    jwt.sign({
      sub: 7,
      email: 'a@b.com',
      role: 'EMPLOYEE',
      companyId: 1,
      employeeId: 3,
    });

  describe('the two-factor bypass it must prevent', () => {
    it('rejects a challenge token signed with the 2FA secret', async () => {
      // What TwoFactorService.issueChallenge actually produces.
      const challenge = jwt.sign(
        {
          uid: 7,
          typ: '2fa',
          mode: 'VERIFY',
          pw: 'abcdefghijkl',
          nonce: 'deadbeef',
        },
        { secret: challengeSecret() },
      );

      await expect(guard.canActivate(contextFor(challenge))).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a 2FA-typed token even if it were signed with the ACCESS secret', async () => {
      // Defence in depth: this is the misconfiguration case — someone makes the
      // challenge secret match JWT_SECRET. The signature would pass, so the
      // explicit `typ` check is the only thing standing in the way.
      const forged = jwt.sign({
        sub: 7,
        typ: '2fa',
        mode: 'VERIFY',
        companyId: 1,
      });

      await expect(guard.canActivate(contextFor(forged))).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a token with no sub, so a challenge payload cannot fall through', async () => {
      // Challenge payloads carry `uid`, never `sub`. Were one ever accepted,
      // every downstream `where: { id: undefined }` would behave unpredictably.
      const noSub = jwt.sign({ uid: 7, companyId: 1, role: 'SUPERADMIN' });

      await expect(guard.canActivate(contextFor(noSub))).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('ordinary access tokens still work', () => {
    it('accepts a valid access token and populates req.user', async () => {
      const context = contextFor(accessToken());

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect((context as any).__request.user).toMatchObject({
        sub: 7,
        email: 'a@b.com',
        role: 'EMPLOYEE',
        companyId: 1,
      });
    });

    it('still backfills employeeId for older tokens that lack it', async () => {
      prisma.employee.findFirst.mockResolvedValue({ id: 42 });
      const context = contextFor(
        jwt.sign({ sub: 7, email: 'a@b.com', role: 'HR', companyId: 1 }),
      );

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect((context as any).__request.user.employeeId).toBe(42);
    });
  });

  describe('malformed input', () => {
    it('rejects a missing header', async () => {
      await expect(guard.canActivate(contextFor())).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a token signed with the wrong secret', async () => {
      const foreign = new JwtService({ secret: 'not-the-secret' }).sign({
        sub: 7,
      });
      await expect(guard.canActivate(contextFor(foreign))).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a non-Bearer scheme', async () => {
      const request: any = {
        headers: { authorization: `Basic ${accessToken()}` },
      };
      const context = {
        switchToHttp: () => ({ getRequest: () => request }),
      } as unknown as ExecutionContext;
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
