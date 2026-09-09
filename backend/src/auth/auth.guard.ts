import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private jwtService: JwtService, private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);
    if (!token) {
      throw new UnauthorizedException();
    }
    try {
      const payload = await this.jwtService.verifyAsync(token, {
        secret: process.env.JWT_SECRET || 'super-secret'
      });

      // Defence in depth for the half-authenticated two-factor challenge token.
      // That token is signed with a different secret, so it should never verify
      // here at all — but this guard's only other check is the signature, so a
      // misconfiguration that made the secrets match would silently turn every
      // challenge into a full session. Every real access token carries `sub`
      // and no `typ`, so this rejects nothing that used to work.
      if (!payload?.sub || payload.typ === '2fa') {
        throw new UnauthorizedException();
      }

      // Fallback for older tokens without employeeId
      if (!payload.employeeId && payload.sub) {
        const employee = await this.prisma.employee.findFirst({ where: { userId: payload.sub } });
        if (employee) {
          payload.employeeId = employee.id;
        }
      }
      
      request['user'] = payload;
    } catch {
      throw new UnauthorizedException();
    }
    return true;
  }

  private extractTokenFromHeader(request: any): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
