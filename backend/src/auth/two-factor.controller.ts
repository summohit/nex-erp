import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard, seconds } from '@nestjs/throttler';

import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { TwoFactorService } from './two-factor.service';

/**
 * Two-factor endpoints, in two groups.
 *
 * `challenge/*` is UNAUTHENTICATED — it is reached with a challenge token
 * during sign-in, and a wrong code there is a failed login, so it answers 401.
 *
 * Everything else requires a real session, and answers 403 for a wrong code or
 * password. That distinction is deliberate: both clients treat a 401 as an
 * expired session and log the user out, so a mistyped code on the Security page
 * must not be a 401.
 */
@Controller('auth/2fa')
export class TwoFactorController {
  constructor(
    private readonly twoFactor: TwoFactorService,
    private readonly authService: AuthService,
  ) {}

  // ── Sign-in challenge (unauthenticated) ────────────────────────────────────

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: seconds(60), limit: 10 } })
  @HttpCode(HttpStatus.OK)
  @Post('challenge/verify')
  async verifyChallenge(
    @Body() body: { challengeToken?: string; code?: string },
  ) {
    const { user } = await this.twoFactor.decodeChallenge(
      body?.challengeToken,
      'VERIFY',
    );
    const result = await this.twoFactor.verifyCodeForUser(user.id, body?.code);
    const tokens = await this.authService.issueTokens(user);
    return { ...tokens, ...result };
  }

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: seconds(300), limit: 10 } })
  @HttpCode(HttpStatus.OK)
  @Post('challenge/enrol/start')
  async startForcedEnrolment(@Body() body: { challengeToken?: string }) {
    const { user } = await this.twoFactor.decodeChallenge(
      body?.challengeToken,
      'ENROL',
    );
    return this.twoFactor.startEnrolment(user);
  }

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: seconds(60), limit: 10 } })
  @HttpCode(HttpStatus.OK)
  @Post('challenge/enrol/confirm')
  async confirmForcedEnrolment(
    @Body() body: { challengeToken?: string; code?: string },
  ) {
    const { user } = await this.twoFactor.decodeChallenge(
      body?.challengeToken,
      'ENROL',
    );
    const { backupCodes } = await this.twoFactor.confirmEnrolment(
      user.id,
      body?.code,
    );
    const tokens = await this.authService.issueTokens(user);
    return { ...tokens, backupCodes };
  }

  // ── Self-service management (authenticated) ────────────────────────────────

  @UseGuards(AuthGuard)
  @Get('status')
  status(@Req() req: any) {
    return this.twoFactor.status(req.user.sub, req.user.companyId);
  }

  @UseGuards(AuthGuard, ThrottlerGuard)
  @Throttle({ default: { ttl: seconds(300), limit: 5 } })
  @HttpCode(HttpStatus.OK)
  @Post('setup')
  setup(@Req() req: any, @Body() body: { password?: string }) {
    return this.twoFactor.startEnrolmentWithPassword(
      { id: req.user.sub, email: req.user.email },
      body?.password,
    );
  }

  @UseGuards(AuthGuard, ThrottlerGuard)
  @Throttle({ default: { ttl: seconds(60), limit: 10 } })
  @HttpCode(HttpStatus.OK)
  @Post('enable')
  async enable(@Req() req: any, @Body() body: { code?: string }) {
    const { backupCodes } = await this.twoFactor.confirmEnrolment(
      req.user.sub,
      body?.code,
    );
    return { enabled: true, backupCodes };
  }

  @UseGuards(AuthGuard, ThrottlerGuard)
  @Throttle({ default: { ttl: seconds(300), limit: 5 } })
  @HttpCode(HttpStatus.OK)
  @Post('disable')
  disable(@Req() req: any, @Body() body: { password?: string; code?: string }) {
    return this.twoFactor.disable(
      req.user.sub,
      req.user.companyId,
      body?.password,
      body?.code,
    );
  }

  @UseGuards(AuthGuard, ThrottlerGuard)
  @Throttle({ default: { ttl: seconds(300), limit: 5 } })
  @HttpCode(HttpStatus.OK)
  @Post('backup-codes/regenerate')
  regenerate(
    @Req() req: any,
    @Body() body: { password?: string; code?: string },
  ) {
    return this.twoFactor.regenerateBackupCodes(
      req.user.sub,
      body?.password,
      body?.code,
    );
  }

  // ── Administration (SUPERADMIN, own company only) ──────────────────────────

  @UseGuards(AuthGuard)
  @Get('admin/users')
  listUsers(@Req() req: any) {
    this.assertSuperAdmin(req);
    return this.twoFactor.listForCompany(req.user.companyId);
  }

  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('admin/reset/:userId')
  resetForUser(@Req() req: any, @Param('userId', ParseIntPipe) userId: number) {
    this.assertSuperAdmin(req);
    return this.twoFactor.adminReset(req.user, userId);
  }

  /** Matches the inline role check SystemSettingsController already uses. */
  private assertSuperAdmin(req: any) {
    if (req.user?.role !== 'SUPERADMIN') {
      throw new ForbiddenException(
        'Only a SuperAdmin can manage two-factor authentication for others.',
      );
    }
  }
}
