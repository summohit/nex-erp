import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Where Firebase configuration lives when it is not in the environment.
 *
 * Resolved from the compiled file's location so it is the same directory in
 * development (src/) and in production (dist/) — `backend/config/firebase.json`
 * either way. Deployment is then "scp one file and restart", with no .env edit
 * on the server and no rebuild of the Angular bundle.
 */
const CONFIG_FILE = join(__dirname, '..', '..', '..', 'config', 'firebase.json');

/**
 * The public half of the Firebase config — the values a browser needs.
 *
 * Public by design: they identify the project, they do not authorise anything.
 * The service account, which does, never leaves this process.
 */
export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  vapidKey: string;
}

/**
 * Push delivery through Firebase Cloud Messaging.
 *
 * WHY THIS EXISTS AT ALL
 *
 * Notifications were a Prisma row plus a Socket.IO emit, which reaches exactly
 * one kind of recipient: someone with the app open right now. That is fine for
 * "a task was assigned to you" — they will see it when they next look. It is
 * useless for "your shift starts in 10 minutes", which is by definition sent to
 * a person whose app is closed. FCM is the only thing in reach that wakes a
 * backgrounded browser and a killed mobile app, and it covers Web, Android and
 * iOS from one server call.
 *
 * DEGRADING WITHOUT CREDENTIALS
 *
 * Firebase needs a service account this repository does not and must not carry.
 * Rather than crash a backend that has never been given one — which would take
 * down leave, payroll and CRM along with it — the service starts disabled and
 * says so once. Every send then becomes a no-op and the in-app notification,
 * which is created independently, still arrives. Nothing regresses; push simply
 * does not happen until FIREBASE_SERVICE_ACCOUNT is configured.
 */
@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private messaging: any = null;
  private enabled = false;
  private webConfig: FirebaseWebConfig | null = null;

  constructor(private prisma: PrismaService) {}

  onModuleInit() {
    this.init();
  }

  /**
   * Find the credentials, in the three shapes people actually have.
   *
   * In precedence order:
   *   1. FIREBASE_SERVICE_ACCOUNT — the JSON inline, which is what container
   *      platforms offer and what CI secrets look like.
   *   2. FIREBASE_SERVICE_ACCOUNT_PATH — a path, for a mounted secret.
   *   3. backend/config/firebase.json — the zero-environment option. Deploying
   *      to a VPS is then one scp and a restart: no .env to edit, nothing to
   *      forget when the next server is provisioned.
   *
   * The file carries the web block as well, so one file configures the browser
   * too and the Angular bundle never has to be rebuilt to change a Firebase
   * project. See getWebConfig.
   */
  private loadConfig(): { serviceAccount: any; web: FirebaseWebConfig | null } | null {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
    if (raw) return { serviceAccount: JSON.parse(raw), web: null };

    const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim();
    if (path) {
      return { serviceAccount: JSON.parse(readFileSync(path, 'utf8')), web: null };
    }

    if (existsSync(CONFIG_FILE)) {
      const parsed = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
      // Accept either shape: { serviceAccount, web } or a bare service account
      // file with the web block alongside it. An explicitly null serviceAccount
      // is the half-configured state — the web block filled in while the
      // private key has not been dropped in yet — and must not be mistaken for
      // the bare-file shape, which would hand admin.credential.cert() the whole
      // wrapper object and fail with something unrecognisable.
      const hasWrapper = 'serviceAccount' in parsed || 'web' in parsed;
      const serviceAccount = hasWrapper ? parsed.serviceAccount ?? null : parsed;
      return { serviceAccount, web: parsed.web ?? null };
    }

    return null;
  }

  private init() {
    let loaded: { serviceAccount: any; web: FirebaseWebConfig | null } | null = null;
    try {
      loaded = this.loadConfig();
    } catch (err: any) {
      this.logger.error(`Push disabled: Firebase configuration could not be read — ${err.message}`);
      return;
    }

    if (!loaded) {
      this.logger.warn(
        `Push disabled: no Firebase credentials. Drop the config at ${CONFIG_FILE}, `
        + 'or set FIREBASE_SERVICE_ACCOUNT / FIREBASE_SERVICE_ACCOUNT_PATH. '
        + 'In-app notifications are unaffected; reminders will not reach a closed app.',
      );
      return;
    }

    // Kept even when the credentials are absent, so the browser half can be
    // verified on its own — the endpoint answers and a device can register
    // while the server is still unable to send.
    this.webConfig = loaded.web;

    if (!loaded.serviceAccount) {
      this.logger.warn(
        `Push disabled: ${CONFIG_FILE} has no "serviceAccount". The web config was read, `
        + 'so the browser can register a device, but nothing can be sent to it yet. '
        + 'Add the key from Firebase console → Project settings → Service accounts.',
      );
      return;
    }

    try {
      // Required lazily so a backend without the credentials never loads the
      // SDK at all, and so this file can be unit-tested without it.
      const admin = require('firebase-admin');
      const credential = admin.credential.cert(loaded.serviceAccount);

      // getApps() guards the watch-mode restart: initializeApp throws on a
      // duplicate app name and would otherwise crash every reload.
      const app = admin.apps?.length ? admin.apps[0] : admin.initializeApp({ credential });
      this.messaging = admin.messaging(app);
      this.enabled = true;
      this.logger.log('Push enabled (Firebase Cloud Messaging).');
    } catch (err: any) {
      this.logger.error(`Push disabled: could not initialise Firebase — ${err.message}`);
    }
  }

  isEnabled() {
    return this.enabled;
  }

  /**
   * The browser's half of the config, served to the app at runtime.
   *
   * Returned from the server rather than compiled into environment.prod.ts so
   * that changing Firebase project — or setting one up for the first time — is
   * a file on the server and a restart, not an Angular rebuild and redeploy.
   *
   * ⚠️ Returns the web block ONLY, field by field. Never spread the parsed
   * file: the service account's private key is in the same object, and one
   * `...parsed` here would publish it to every signed-in user.
   */
  getWebConfig(): { enabled: boolean; config: FirebaseWebConfig | null } {
    const c = this.webConfig;
    if (!c?.projectId || !c?.messagingSenderId || !c?.vapidKey) {
      return { enabled: false, config: null };
    }
    return {
      enabled: true,
      config: {
        apiKey: c.apiKey,
        authDomain: c.authDomain,
        projectId: c.projectId,
        storageBucket: c.storageBucket,
        messagingSenderId: c.messagingSenderId,
        appId: c.appId,
        vapidKey: c.vapidKey,
      },
    };
  }

  /**
   * Push one notification to every device a user has registered.
   *
   * Never throws. A failed push must not roll back the database row or break
   * the caller — a missed shift reminder is bad, a clock-in that 500s because
   * Firebase was briefly unreachable is worse.
   */
  async sendToUser(
    userId: number,
    payload: { title: string; message: string; type?: string; linkUrl?: string; data?: Record<string, string> },
  ): Promise<number> {
    if (!this.enabled) return 0;

    const devices = await this.prisma.deviceToken.findMany({
      where: { userId },
      select: { id: true, token: true, platform: true },
    });
    if (!devices.length) return 0;

    // Data-only values must be strings — FCM rejects a payload with any other
    // type, and silently on some transports.
    const data: Record<string, string> = {
      type: payload.type ?? 'INFO',
      ...(payload.linkUrl ? { linkUrl: payload.linkUrl } : {}),
      ...Object.fromEntries(
        Object.entries(payload.data ?? {}).map(([k, v]) => [k, String(v)]),
      ),
    };

    const message = {
      notification: { title: payload.title, body: payload.message },
      data,
      // Per-platform blocks so a shift reminder actually makes a sound on a
      // locked phone rather than arriving silently in a tray.
      android: {
        priority: 'high' as const,
        notification: { channelId: 'shift-reminders', defaultSound: true },
      },
      apns: {
        payload: { aps: { sound: 'default', contentAvailable: true } },
      },
      webpush: {
        fcmOptions: payload.linkUrl ? { link: payload.linkUrl } : undefined,
        notification: { requireInteraction: false },
      },
    };

    try {
      const res = await this.messaging.sendEachForMulticast({
        tokens: devices.map((d) => d.token),
        ...message,
      });
      await this.pruneDeadTokens(devices, res);
      return res.successCount ?? 0;
    } catch (err: any) {
      this.logger.error(`Push to user ${userId} failed: ${err.message}`);
      return 0;
    }
  }

  /**
   * Delete tokens Firebase says are dead.
   *
   * A registration token is revoked when the app is uninstalled, the browser's
   * site data is cleared, or the token is simply rotated. Left in the table
   * they are retried forever, and a user who has changed laptops twice quietly
   * turns one notification into three failing sends every time.
   *
   * Only the two "this token is gone" codes are pruned. A transient
   * `unavailable` or `internal` must not delete a live device.
   */
  private async pruneDeadTokens(
    devices: { id: number; token: string }[],
    res: { responses?: { success: boolean; error?: { code?: string } }[] },
  ) {
    const dead: number[] = [];
    (res.responses ?? []).forEach((r, i) => {
      if (r.success) return;
      const code = r.error?.code ?? '';
      if (
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token'
      ) {
        dead.push(devices[i].id);
      }
    });
    if (!dead.length) return;

    await this.prisma.deviceToken.deleteMany({ where: { id: { in: dead } } });
    this.logger.log(`Pruned ${dead.length} dead device token(s).`);
  }
}
