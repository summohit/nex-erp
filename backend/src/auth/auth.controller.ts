import { Controller, Post, Body, HttpCode, HttpStatus, UseGuards, Req } from '@nestjs/common';
import { Throttle, ThrottlerGuard, seconds } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @HttpCode(HttpStatus.CREATED)
  @Post('signup')
  signUp(@Body() signUpDto: Record<string, any>) {
    // Auto-generate domain slug from company name
    const domain = signUpDto.companyName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '');

    return this.authService.signupCompany(
      signUpDto.companyName,
      domain,
      signUpDto.email,
      signUpDto.password,
      signUpDto.firstName,
      signUpDto.lastName,
      signUpDto.phone
    );
  }

  @HttpCode(HttpStatus.OK)
  // Credential stuffing runs at whatever rate the endpoint allows, and until now
  // that was unlimited. Applied per-route rather than globally because the app
  // has no global guards and a blanket limit would break the dashboard's
  // parallel loads.
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: seconds(60), limit: 10 } })
  @Post('login')
  signIn(@Body() signInDto: Record<string, any>) {
    return this.authService.login(signInDto.email, signInDto.password);
  }
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  refresh(@Body() body: { refreshToken: string }) {
    if (!body.refreshToken) {
      throw new Error('Refresh token is required');
    }
    return this.authService.refreshToken(body.refreshToken);
  }

  @HttpCode(HttpStatus.OK)
  @Post('verify')
  verifyEmail(@Body() body: { token: string }) {
    if (!body.token) {
      throw new Error('Verification token is required');
    }
    return this.authService.verifyEmail(body.token);
  }

  @HttpCode(HttpStatus.OK)
  @Post('resend-verification')
  resendVerification(@Body() body: { email: string }) {
    if (!body.email) {
      throw new Error('Email is required');
    }
    return this.authService.resendVerificationEmail(body.email);
  }

  // The reset OTP is six digits and `resetPassword` imposes no attempt limit of
  // its own, so without this the code is guessable by brute force.
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: seconds(900), limit: 5 } })
  @HttpCode(HttpStatus.OK)
  @Post('forgot-password')
  forgotPassword(@Body() body: { email: string }) {
    if (!body.email) {
      throw new Error('Email is required');
    }
    return this.authService.forgotPassword(body.email);
  }

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: seconds(900), limit: 10 } })
  @HttpCode(HttpStatus.OK)
  @Post('reset-password')
  resetPassword(@Body() body: { email: string; otp: string; newPassword: string }) {
    if (!body.email) {
      throw new Error('Email is required');
    }
    return this.authService.resetPassword(body.email, body.otp, body.newPassword);
  }

  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  @Post('reset-password-email')
  resetPasswordEmail(@Req() req: any) {
    return this.authService.sendResetCodeToUser(req.user.sub);
  }
}
