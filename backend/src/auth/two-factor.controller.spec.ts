import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerModule, seconds } from '@nestjs/throttler';

import { TwoFactorController } from './two-factor.controller';
import { TwoFactorService } from './two-factor.service';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The status-code boundary.
 *
 * Both clients treat a 401 as an expired session — the web pops its
 * session-expired modal, mobile refreshes and then logs out. So a wrong code on
 * an AUTHENTICATED route must be a 403, or mistyping six digits signs you out.
 * The sign-in challenge is the opposite case: a wrong code there genuinely is a
 * failed login and must stay 401.
 */
describe('TwoFactorController — wrong codes must not log the user out', () => {
  const REQ = { user: { sub: 7, companyId: 1, email: 'a@b.com', role: 'ADMIN' } };

  let controller: TwoFactorController;
  let twoFactor: Record<string, jest.Mock>;

  const rejectsUnauthorized = () =>
    jest.fn(() => Promise.reject(new UnauthorizedException('Invalid or expired verification code.')));

  beforeEach(async () => {
    twoFactor = {
      startEnrolmentWithPassword: rejectsUnauthorized(),
      confirmEnrolment: rejectsUnauthorized(),
      disable: rejectsUnauthorized(),
      regenerateBackupCodes: rejectsUnauthorized(),
      startRotation: rejectsUnauthorized(),
      confirmRotation: rejectsUnauthorized(),
      cancelRotation: jest.fn(() => Promise.resolve({ rotationPending: false })),
      decodeChallenge: jest.fn(() =>
        Promise.resolve({ user: { id: 7, email: 'a@b.com', role: 'ADMIN', companyId: 1 } }),
      ),
      verifyCodeForUser: rejectsUnauthorized(),
      status: jest.fn(() => Promise.resolve({ enabled: true })),
    };

    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot({ throttlers: [{ name: 'default', ttl: seconds(60), limit: 60 }] }),
      ],
      controllers: [TwoFactorController],
      providers: [
        { provide: TwoFactorService, useValue: twoFactor },
        { provide: AuthService, useValue: { issueTokens: jest.fn() } },
        { provide: JwtService, useValue: { verifyAsync: jest.fn() } },
        { provide: PrismaService, useValue: {} },
        Reflector,
      ],
    }).compile();

    controller = module.get<TwoFactorController>(TwoFactorController);
  });

  const authenticated: [string, () => Promise<unknown>][] = [
    ['setup', () => controller.setup(REQ, { password: 'x' })],
    ['enable', () => controller.enable(REQ, { code: '000000' })],
    ['disable', () => controller.disable(REQ, { password: 'x', code: '000000' })],
    ['backup-codes/regenerate', () => controller.regenerate(REQ, { password: 'x', code: '000000' })],
    ['rotate/start', () => controller.startRotation(REQ, { password: 'x', code: '000000' })],
    ['rotate/confirm', () => controller.confirmRotation(REQ, { code: '000000' })],
  ];

  it.each(authenticated)('%s answers 403, not 401', async (_name, call) => {
    await expect(call()).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('keeps the original message so the user is told what was wrong', async () => {
    await expect(controller.confirmRotation(REQ, { code: '000000' })).rejects.toThrow(
      /Invalid or expired verification code/,
    );
  });

  it('passes non-401 failures through untouched', async () => {
    const boom = new Error('database is on fire');
    twoFactor.confirmRotation.mockRejectedValueOnce(boom);
    await expect(controller.confirmRotation(REQ, { code: '000000' })).rejects.toBe(boom);
  });

  it('leaves the sign-in challenge as a 401 — a wrong code there IS a failed login', async () => {
    await expect(
      controller.verifyChallenge({ challengeToken: 't', code: '000000' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
