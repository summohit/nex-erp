import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const PLATFORMS = ['WEB', 'ANDROID', 'IOS'];

/**
 * The register/unregister side of push.
 *
 * Clients call `register` on every launch, not only the first: FCM rotates
 * registration tokens on its own schedule and a client that registers once
 * quietly stops receiving anything weeks later. Re-registering is therefore the
 * normal case, and `lastSeenAt` is what separates a live device from a row left
 * behind by a laptop that was wiped.
 */
@Injectable()
export class DeviceTokensService {
  constructor(private prisma: PrismaService) {}

  /**
   * Claim a token for this user.
   *
   * Upserting on the token rather than on (user, token) is deliberate. Two
   * people sign into the same shared tablet; FCM gives the second one the same
   * registration token, because the token belongs to the app install and not to
   * the account. Inserting a second row would leave the first person's shift
   * reminders being delivered to whoever is holding the tablet now. Moving the
   * row is the only correct outcome.
   */
  async register(
    userId: number,
    companyId: number,
    body: { token?: string; platform?: string; deviceName?: string },
  ) {
    const token = (body?.token ?? '').trim();
    if (!token) throw new BadRequestException('A device token is required.');

    const platform = (body?.platform ?? '').trim().toUpperCase();
    if (!PLATFORMS.includes(platform)) {
      throw new BadRequestException(`Platform must be one of ${PLATFORMS.join(', ')}.`);
    }

    const deviceName = (body?.deviceName ?? '').trim().slice(0, 120) || null;

    const row = await this.prisma.deviceToken.upsert({
      where: { token },
      update: { userId, companyId, platform, deviceName, lastSeenAt: new Date() },
      create: { token, userId, companyId, platform, deviceName },
      select: { id: true, platform: true, deviceName: true, lastSeenAt: true },
    });
    return { registered: true, device: row };
  }

  /**
   * Called on sign-out. Scoped to the user so a token cannot be unregistered on
   * someone else's behalf by anyone who happens to have seen the string.
   */
  async unregister(userId: number, token: string) {
    const { count } = await this.prisma.deviceToken.deleteMany({
      where: { token: (token ?? '').trim(), userId },
    });
    return { unregistered: count > 0 };
  }

  /** This user's registered devices, for a "where am I signed in" list. */
  async list(userId: number) {
    return this.prisma.deviceToken.findMany({
      where: { userId },
      select: { id: true, platform: true, deviceName: true, lastSeenAt: true, createdAt: true },
      orderBy: { lastSeenAt: 'desc' },
    });
  }
}
