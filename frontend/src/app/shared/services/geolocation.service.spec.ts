import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { GeolocationService } from './geolocation.service';
import { DialogService } from './dialog.service';

/**
 * Getting a position for a clock-in.
 *
 * Two of these are regressions for what Safari users reported: a clock button
 * that spun forever, and a clock-in recorded with no location at all.
 */
describe('GeolocationService', () => {
  let service: GeolocationService;
  let confirm: ReturnType<typeof vi.fn>;
  let getCurrentPosition: ReturnType<typeof vi.fn>;

  const fix = { coords: { latitude: 28.6, longitude: 77.2, accuracy: 20 } };
  const failure = (code: number) => ({ code, message: '' });

  /** Script what each successive getCurrentPosition call does. */
  const script = (...steps: Array<'ok' | 'denied' | 'unavailable' | 'timeout' | 'hang'>) => {
    let i = 0;
    getCurrentPosition.mockImplementation((success: any, error: any) => {
      const step = steps[Math.min(i++, steps.length - 1)];
      if (step === 'ok') success(fix);
      else if (step === 'denied') error(failure(1));
      else if (step === 'unavailable') error(failure(2));
      else if (step === 'timeout') error(failure(3));
      // 'hang': neither callback ever fires — what Safari does with no fix.
    });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    confirm = vi.fn();
    getCurrentPosition = vi.fn();
    Object.defineProperty(globalThis.navigator, 'geolocation', {
      value: { getCurrentPosition },
      configurable: true,
    });
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });

    TestBed.configureTestingModule({
      providers: [{ provide: DialogService, useValue: { confirm } }],
    });
    service = TestBed.inject(GeolocationService);
  });

  afterEach(() => vi.useRealTimers());

  it('returns the position on the first try', async () => {
    script('ok');
    expect(await service.getPosition()).toEqual({ ok: true, lat: 28.6, lng: 77.2, accuracy: 20 });
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
  });

  // A quick low-accuracy fix comes from mobile towers on a phone — kilometres
  // out — so GPS is asked for first.
  it('asks for a fresh, precise fix first', async () => {
    script('ok');
    await service.getPosition();
    expect(getCurrentPosition.mock.calls[0][2]).toMatchObject({
      enableHighAccuracy: true, timeout: 15_000, maximumAge: 0,
    });
  });

  // When GPS cannot answer, a rough fix is still better than none.
  it.each(['unavailable', 'timeout'] as const)('retries once after %s', async (first) => {
    script(first, 'ok');
    const result = await service.getPosition();
    expect(result.ok).toBe(true);
    expect(getCurrentPosition).toHaveBeenCalledTimes(2);
    expect(getCurrentPosition.mock.calls[1][2]).toMatchObject({ enableHighAccuracy: false, maximumAge: 60_000 });
  });

  // Asking again cannot fix a permission, only annoy.
  it('does not retry a denial', async () => {
    script('denied');
    expect(await service.getPosition()).toEqual({ ok: false, code: 'DENIED' });
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
  });

  /**
   * The reported hang. Safari may call neither callback, and `timeout` is not
   * reliably honoured there; the watchdog is what makes this promise settle.
   */
  it('settles even when the browser never answers', async () => {
    script('hang');
    const pending = service.getPosition();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await pending).toEqual({ ok: false, code: 'TIMEOUT' });
  });

  it('ignores a late answer after the watchdog has fired', async () => {
    let late: any;
    getCurrentPosition.mockImplementation((success: any) => { late = success; });
    const pending = service.getPosition();
    await vi.advanceTimersByTimeAsync(60_000);
    const result = await pending;
    late(fix);
    expect(result).toEqual({ ok: false, code: 'TIMEOUT' });
  });

  it('reports an unsupported browser without calling anything', async () => {
    Object.defineProperty(globalThis.navigator, 'geolocation', { value: undefined, configurable: true });
    expect(await service.getPosition()).toEqual({ ok: false, code: 'UNSUPPORTED' });
  });

  it('names an insecure page rather than blaming permissions', async () => {
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
    expect(await service.getPosition()).toEqual({ ok: false, code: 'INSECURE' });
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  describe('locateForClock', () => {
    it('hands back the coordinates without asking anything when it works', async () => {
      script('ok');
      expect(await service.locateForClock()).toEqual({ lat: 28.6, lng: 77.2, accuracy: 20 });
      expect(confirm).not.toHaveBeenCalled();
    });

    // The old behaviour was to clock in anyway and say nothing. Now the person
    // is told why, and what to change, before anything is recorded.
    it('explains a failure instead of silently clocking in', async () => {
      script('denied');
      confirm.mockResolvedValue(false);
      await service.locateForClock();
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(confirm.mock.calls[0][1]).toBe('Location is blocked');
    });

    it('still lets them continue without a location', async () => {
      script('denied');
      confirm.mockResolvedValue(false);
      expect(await service.locateForClock()).toEqual({});
    });

    it('tries again when asked, and uses the position it then gets', async () => {
      script('denied', 'ok');
      confirm.mockResolvedValueOnce(true);
      expect(await service.locateForClock()).toEqual({ lat: 28.6, lng: 77.2, accuracy: 20 });
      expect(confirm).toHaveBeenCalledTimes(1);
    });
  });

  describe('describeFailure', () => {
    const withUserAgent = (ua: string, touchPoints = 0) => {
      Object.defineProperty(globalThis.navigator, 'userAgent', { value: ua, configurable: true });
      Object.defineProperty(globalThis.navigator, 'maxTouchPoints', { value: touchPoints, configurable: true });
    };
    const MAC_SAFARI =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
    const MAC_CHROME =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
    const IPHONE =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

    // "Allowed in the site settings but still failing" is the case people were
    // stuck on, and the cause is macOS rather than the site.
    it('points Mac Safari at the macOS Location Services switch', () => {
      withUserAgent(MAC_SAFARI);
      expect(service.describeFailure('DENIED').message).toMatch(/System Settings.*Location Services.*Safari Websites/);
    });

    it('gives iPhone its own instructions', () => {
      withUserAgent(IPHONE);
      expect(service.describeFailure('DENIED').message).toMatch(/While Using the App/);
    });

    // Chrome's UA contains "Safari/" too — it must not get Safari's advice.
    it('does not mistake Chrome for Safari', () => {
      withUserAgent(MAC_CHROME);
      expect(service.describeFailure('DENIED').message).not.toMatch(/Safari/);
    });

    it('recognises an iPad that reports itself as a Mac', () => {
      withUserAgent(MAC_SAFARI, 5);
      expect(service.describeFailure('DENIED').message).toMatch(/While Using the App/);
    });
  });
  // People in the office were shown "12 km away": a rough tower-based fix taken
  // as exact. Now they are told how to turn on precise location first.
  describe('a rough fix', () => {
    const rough = { coords: { latitude: 28.6, longitude: 77.2, accuracy: 4000 } };

    it('explains how to turn on precise location before clocking', async () => {
      getCurrentPosition.mockImplementation((ok: any) => ok(rough));
      confirm.mockResolvedValue(false);
      expect(await service.locateForClock()).toEqual({ lat: 28.6, lng: 77.2, accuracy: 4000 });
      expect(confirm.mock.calls[0][1]).toBe('Your location is not precise');
      expect(confirm.mock.calls[0][0]).toMatch(/4\.0 km/);
    });

    it('tries again when asked', async () => {
      getCurrentPosition
        .mockImplementationOnce((ok: any) => ok(rough))
        .mockImplementation((ok: any) => ok(fix));
      confirm.mockResolvedValueOnce(true);
      expect(await service.locateForClock()).toEqual({ lat: 28.6, lng: 77.2, accuracy: 20 });
    });

    it('lets the accuracy travel with the coordinates', async () => {
      script('ok');
      await service.locateForClock();
      expect(service.accuracyFor(28.6, 77.2)).toBe(20);
      expect(service.accuracyFor(1, 2)).toBeUndefined();
    });
  });
});
