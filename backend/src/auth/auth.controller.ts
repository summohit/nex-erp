import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';

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
}
