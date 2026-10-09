import { Injectable, inject } from '@angular/core';
import { DialogService } from './dialog.service';

export type GeoFailureCode = 'UNSUPPORTED' | 'INSECURE' | 'DENIED' | 'UNAVAILABLE' | 'TIMEOUT';

export type GeoResult =
  | { ok: true; lat: number; lng: number; accuracy: number }
  | { ok: false; code: GeoFailureCode };

/**
 * Getting a position for a clock-in, without the two failure modes that
 * `navigator.geolocation.getCurrentPosition(ok, () => carryOn())` has in Safari.
 *
 * WHAT WENT WRONG BEFORE
 *
 * Every clock button called getCurrentPosition with no options and an error
 * callback that clocked in anyway, with no coordinates. In Safari that meant:
 *
 *  - It could hang. With no `timeout`, a Safari that cannot get a fix — most
 *    often because macOS Location Services is off for Safari while the site's
 *    own permission still says "Allow" — may call neither callback. The button
 *    spun forever.
 *  - It failed silently. Any error, including "denied at the system level",
 *    recorded a clock-in with no location. On an office shift the server reads
 *    a missing location as "outside the office" and asks for a reason, so people
 *    who had allowed location were told they were somewhere they were not.
 *
 * WHAT THIS DOES INSTEAD
 *
 * A bounded attempt, one retry for the transient failures, and — when it still
 * cannot get a position — a plain statement of why and how to fix it, with the
 * choice to try again or continue without. Continuing without is deliberately
 * still possible: the server has always been the one to decide what a missing
 * location means for a given shift.
 */
@Injectable({ providedIn: 'root' })
export class GeolocationService {
  private dialog = inject(DialogService);

  /**
   * One position, or the reason there is not one.
   *
   * The first getCurrentPosition call is made synchronously, before any await.
   * Some browsers only show the permission prompt for a call made inside the
   * click that started it, and an `await` first would take it outside.
   */
  getPosition(): Promise<GeoResult> {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      return Promise.resolve({ ok: false, code: 'UNSUPPORTED' });
    }
    // Browsers refuse geolocation outside HTTPS (localhost aside) with an
    // error that reads like a permissions problem. Say what it is.
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      return Promise.resolve({ ok: false, code: 'INSECURE' });
    }

    // GPS first. The old order asked for a quick low-accuracy fix, which a phone
    // answers from mobile towers — often kilometres out — so people sitting in
    // the office were told they were 12 km away. A fresh precise fix is asked
    // for first; the quick one is only the fallback when GPS cannot answer.
    return this.attempt({ enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 })
      .then((first) => {
        if (first.ok || first.code === 'DENIED') return first;
        return this.attempt({ enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 });
      });
  }

  /**
   * A single call with a watchdog.
   *
   * `timeout` alone is not enough: it is specified to start only once
   * permission is granted, and Safari has been seen not to honour it at all
   * when the system service is unresponsive. The watchdog guarantees this
   * promise settles, so the button can never spin forever.
   */
  private attempt(options: PositionOptions): Promise<GeoResult> {
    return new Promise<GeoResult>((resolve) => {
      let settled = false;
      const finish = (result: GeoResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        resolve(result);
      };
      const watchdog = setTimeout(
        () => finish({ ok: false, code: 'TIMEOUT' }),
        (options.timeout ?? 10_000) + 5_000,
      );

      navigator.geolocation.getCurrentPosition(
        (p) => finish({ ok: true, lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
        (e) => finish({
          ok: false,
          code: e.code === 1 ? 'DENIED' : e.code === 3 ? 'TIMEOUT' : 'UNAVAILABLE',
        }),
        options,
      );
    });
  }

  /**
   * The position to clock with — asking the person what to do if there is none.
   *
   * Always resolves. `{}` means "continue without a location", which the caller
   * passes straight to the server exactly as the old silent fallback did.
   */
  async locateForClock(): Promise<{ lat?: number; lng?: number; accuracy?: number }> {
    for (;;) {
      const result = await this.getPosition();
      if (result.ok) {
        this.lastFix = { lat: result.lat, lng: result.lng, accuracy: result.accuracy };
        // A rough fix is the 12 km problem: say how to get a precise one,
        // rather than letting it be judged as if it were exact.
        if (result.accuracy > GeolocationService.IMPRECISE_M) {
          const retry = await this.dialog.confirm(
            this.impreciseHelp(result.accuracy),
            'Your location is not precise',
            'Try again',
            'Continue anyway',
          );
          if (retry) continue;
        }
        return { lat: result.lat, lng: result.lng, accuracy: result.accuracy };
      }

      const { title, message } = this.describeFailure(result.code);
      const tryAgain = await this.dialog.confirm(
        `${message} If you continue without a location, none is recorded on your attendance.`,
        title,
        'Try again',
        'Continue without location',
      );
      if (!tryAgain) return {};
    }
  }

  /** Above this, a fix is a guess from towers or Wi-Fi rather than GPS. */
  static readonly IMPRECISE_M = 150;

  /** The last position handed to a clock, so its accuracy can travel with it. */
  private lastFix: { lat: number; lng: number; accuracy: number } | null = null;

  /** The accuracy of the fix these coordinates came from, if they did. */
  accuracyFor(lat?: number, lng?: number): number | undefined {
    const f = this.lastFix;
    return f && lat === f.lat && lng === f.lng ? Math.round(f.accuracy) : undefined;
  }

  /** How to switch on precise location, for the device in hand. */
  impreciseHelp(accuracyM: number): string {
    const env = this.environment();
    const off = accuracyM >= 1000 ? `${(accuracyM / 1000).toFixed(1)} km` : `${Math.round(accuracyM)} m`;
    const steps = env.isIOS
      ? 'On iPhone: Settings → Privacy & Security → Location Services → turn it ON → Safari Websites → choose “While Using the App” and turn ON “Precise Location”. Also open Settings → Safari → Location → Allow.'
      : env.isAndroid
        ? 'On Android: pull down the quick settings and turn Location ON. Then Settings → Location → Location services → Google Location Accuracy → turn it ON. In Chrome, tap the icon left of the address bar → Permissions → Location → Allow, and keep “Use precise location” ON.'
        : 'Turn on location for this device and allow this site to use it (the icon left of the address bar). A laptop with Wi-Fi switched on locates itself far more precisely.';
    return `Your phone could only guess your position to within about ${off}, so you may be shown as outside the office even when you are inside. `
      + `${steps} Step near a window if you are deep inside the building, then tap Try again.`;
  }

  /** What went wrong, and the exact setting to change, for this browser. */
  describeFailure(code: GeoFailureCode): { title: string; message: string } {
    const env = this.environment();

    switch (code) {
      case 'DENIED':
        return {
          title: 'Location is blocked',
          message: env.isIOS
            ? 'Open Settings → Privacy & Security → Location Services → Safari Websites and choose “While Using the App”. Then reload this page.'
            : env.isSafari
              ? 'In Safari, open Settings → Websites → Location and set this site to Allow. If it already says Allow, macOS itself is blocking Safari: open System Settings → Privacy & Security → Location Services, turn it on, and enable Safari Websites. Then reload this page.'
              : 'Allow location for this site from the icon at the left of the address bar, then reload this page.',
        };

      case 'UNAVAILABLE':
      case 'TIMEOUT':
        return {
          title: 'Could not find your location',
          message: env.isIOS || env.isSafari
            ? 'Your device did not return a position in time. Check that Location Services is on (System Settings → Privacy & Security → Location Services, with Safari Websites enabled) and that Wi-Fi is on — a Mac with no GPS locates itself from nearby Wi-Fi.'
            : 'Your device did not return a position in time. Check that location is turned on for this device and that you have a signal or Wi-Fi.',
        };

      case 'INSECURE':
        return {
          title: 'Location needs a secure connection',
          message: 'Browsers only share location on https pages. Open this site using its https address.',
        };

      default:
        return {
          title: 'Location is not supported',
          message: 'This browser cannot share its location. Try a current version of Safari, Chrome or Edge.',
        };
    }
  }

  private environment() {
    const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
    // iPadOS reports itself as a Mac; touch points are what give it away.
    const isIOS =
      /iPhone|iPad|iPod/.test(ua) ||
      (/Macintosh/.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1);
    const isSafari = /Safari\//.test(ua) && !/Chrome\/|Chromium\/|CriOS\/|FxiOS\/|Edg\/|Android/.test(ua);
    return { isIOS, isAndroid: /Android/.test(ua), isSafari: isSafari || isIOS };
  }
}
