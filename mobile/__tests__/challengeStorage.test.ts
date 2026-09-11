import AsyncStorage from '@react-native-async-storage/async-storage';

import { challengeStorage, CHALLENGE_TTL_MS } from '../src/api/challengeStorage';

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(),
  getItem: jest.fn(),
  removeItem: jest.fn(),
}));

const store = AsyncStorage as jest.Mocked<typeof AsyncStorage>;
const KEY = 'pendingTwoFactorChallenge';

/**
 * Reading a TOTP code means leaving the app, and Android may tear the activity
 * down while it is gone — which used to drop the user back to an empty login
 * form mid sign-in. These tests cover the boundaries of the entry that fixes
 * that, because a stale or malformed one strands the user on a screen whose
 * token the server will always refuse.
 */
describe('challengeStorage', () => {
  const NOW = 1_800_000_000_000;

  beforeEach(() => {
    jest.clearAllMocks();
    store.setItem.mockResolvedValue(undefined as never);
    store.removeItem.mockResolvedValue(undefined as never);
  });

  const stored = (overrides: Record<string, unknown> = {}) =>
    JSON.stringify({ token: 'tok', mode: 'VERIFY', expiresAt: NOW + CHALLENGE_TTL_MS, ...overrides });

  it('saves under its own key, never the session token key', async () => {
    await challengeStorage.save({ token: 'tok', mode: 'VERIFY' }, NOW);

    expect(store.setItem).toHaveBeenCalledTimes(1);
    const [key, value] = store.setItem.mock.calls[0];
    expect(key).toBe(KEY);
    expect(key).not.toBe('userToken');
    expect(JSON.parse(value)).toEqual({
      token: 'tok', mode: 'VERIFY', expiresAt: NOW + CHALLENGE_TTL_MS,
    });
  });

  it('restores a live challenge', async () => {
    store.getItem.mockResolvedValue(stored());
    await expect(challengeStorage.restore(NOW)).resolves.toEqual({ token: 'tok', mode: 'VERIFY' });
    expect(store.removeItem).not.toHaveBeenCalled();
  });

  it('preserves ENROL mode, and treats anything else as VERIFY', async () => {
    store.getItem.mockResolvedValue(stored({ mode: 'ENROL' }));
    await expect(challengeStorage.restore(NOW)).resolves.toMatchObject({ mode: 'ENROL' });

    store.getItem.mockResolvedValue(stored({ mode: 'NONSENSE' }));
    await expect(challengeStorage.restore(NOW)).resolves.toMatchObject({ mode: 'VERIFY' });
  });

  it('returns nothing when there is no entry', async () => {
    store.getItem.mockResolvedValue(null);
    await expect(challengeStorage.restore(NOW)).resolves.toBeNull();
  });

  it('drops an expired challenge rather than offering a token the server will refuse', async () => {
    store.getItem.mockResolvedValue(stored({ expiresAt: NOW - 1 }));

    await expect(challengeStorage.restore(NOW)).resolves.toBeNull();
    expect(store.removeItem).toHaveBeenCalledWith(KEY);
  });

  it('treats the exact expiry instant as expired', async () => {
    store.getItem.mockResolvedValue(stored({ expiresAt: NOW }));
    await expect(challengeStorage.restore(NOW)).resolves.toBeNull();
  });

  it('drops a half-written entry', async () => {
    store.getItem.mockResolvedValue('{"token":"tok"');
    await expect(challengeStorage.restore(NOW)).resolves.toBeNull();
    expect(store.removeItem).toHaveBeenCalledWith(KEY);
  });

  it('drops an entry with no token or no expiry', async () => {
    store.getItem.mockResolvedValue(JSON.stringify({ mode: 'VERIFY', expiresAt: NOW + 1000 }));
    await expect(challengeStorage.restore(NOW)).resolves.toBeNull();

    store.getItem.mockResolvedValue(JSON.stringify({ token: 'tok', mode: 'VERIFY' }));
    await expect(challengeStorage.restore(NOW)).resolves.toBeNull();
  });

  // Storage failing must degrade to the old in-memory behaviour, not break
  // sign-in — a thrown promise here would land in no catch at the call site.
  it('never rejects when storage itself fails', async () => {
    store.getItem.mockRejectedValue(new Error('storage unavailable'));
    await expect(challengeStorage.restore(NOW)).resolves.toBeNull();

    store.setItem.mockRejectedValue(new Error('storage unavailable'));
    await expect(challengeStorage.save({ token: 'tok', mode: 'VERIFY' }, NOW)).resolves.toBeUndefined();

    store.removeItem.mockRejectedValue(new Error('storage unavailable'));
    await expect(challengeStorage.clear()).resolves.toBeUndefined();
  });
});
