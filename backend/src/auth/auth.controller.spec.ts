import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ThrottlerModule, seconds } from '@nestjs/throttler';

import { JwtService } from '@nestjs/jwt';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Was Nest boilerplate that supplied no AuthService and therefore could not
 * compile. ThrottlerModule has to be imported too, since the login and
 * password-reset routes now carry @UseGuards(ThrottlerGuard).
 */
describe('AuthController', () => {
  let controller: AuthController;
  let authService: { login: jest.Mock; refreshToken: jest.Mock };

  beforeEach(async () => {
    authService = {
      login: jest.fn(() =>
        Promise.resolve({ access_token: 'a', refresh_token: 'r' }),
      ),
      refreshToken: jest.fn(() =>
        Promise.resolve({ access_token: 'a2', refresh_token: 'r2' }),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot({
          throttlers: [{ name: 'default', ttl: seconds(60), limit: 60 }],
        }),
      ],
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        // AuthGuard sits on the reset-password-email route, so its own
        // dependencies have to resolve even though no test exercises it.
        { provide: JwtService, useValue: { verifyAsync: jest.fn() } },
        {
          provide: PrismaService,
          useValue: { employee: { findFirst: jest.fn() } },
        },
        Reflector,
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('passes credentials straight through to the service', async () => {
    await controller.signIn({ email: 'a@b.com', password: 'pw' }, { headers: {} });
    expect(authService.login).toHaveBeenCalledWith('a@b.com', 'pw', undefined);
  });

  it('returns whatever login produces, including a 2FA challenge', async () => {
    // The controller must not reshape the response — the challenge branch
    // deliberately carries no access_token, and that has to reach the client.
    authService.login.mockResolvedValue({
      twoFactorRequired: true,
      mode: 'VERIFY',
      challengeToken: 'tok',
    });

    const result: any = await controller.signIn(
      { email: 'a@b.com', password: 'pw' },
      { headers: {} },
    );

    expect(result).toEqual({
      twoFactorRequired: true,
      mode: 'VERIFY',
      challengeToken: 'tok',
    });
    expect(result.access_token).toBeUndefined();
  });

  it('rejects a refresh with no token', () => {
    expect(() => controller.refresh({ refreshToken: '' })).toThrow();
  });
});
