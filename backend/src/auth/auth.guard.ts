import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Account status by user id, cached briefly so a deleted or deactivated account
 * stops working within half a minute without a database read on every request.
 */
const ACCOUNT_CACHE_MS = 30_000;
const accountCache = new Map<number, { status: string | null; at: number }>();

/** Forget a cached status at once (call after deactivating or deleting a user). */
export function forgetAccountStatus(userId: number) {
  accountCache.delete(userId);
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private jwtService: JwtService, private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);
    if (!token) {
      throw new UnauthorizedException();
    }
    let payload: any;
    try {
      payload = await this.jwtService.verifyAsync(token, {
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
      
    } catch {
      throw new UnauthorizedException();
    }

    // A valid token is not enough: the account must still exist and be active.
    // The `code` lets the app sign the person out with an explanation instead of
    // silently renewing the session (16 Nov 2026).
    const status = await this.accountStatus(Number(payload.sub));
    if (status === null) {
      throw new UnauthorizedException({ code: 'ACCOUNT_DELETED', message: 'This account no longer exists.' });
    }
    if (status === 'SUSPENDED' || status === 'INACTIVE' || status === 'BLOCKED') {
      throw new UnauthorizedException({ code: 'ACCOUNT_INACTIVE', message: 'This account has been deactivated.' });
    }

    request['user'] = payload;
    return true;
  }

  private async accountStatus(userId: number): Promise<string | null> {
    const hit = accountCache.get(userId);
    if (hit && Date.now() - hit.at < ACCOUNT_CACHE_MS) return hit.status;
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
    const status = user ? user.status : null;
    accountCache.set(userId, { status, at: Date.now() });
    return status;
  }

  private extractTokenFromHeader(request: any): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
