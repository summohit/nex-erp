import { CryptoService } from './crypto.service';

/**
 * The key is read from the environment in the constructor, so each test sets
 * ENCRYPTION_KEY and constructs its own instance.
 */
describe('CryptoService', () => {
  const VALID_KEY = 'a'.repeat(64);
  const OTHER_KEY = 'b'.repeat(64);
  const original = process.env.ENCRYPTION_KEY;

  afterEach(() => {
    if (original === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = original;
  });

  const withKey = (key?: string) => {
    if (key === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = key;
    return new CryptoService();
  };

  describe('key validation', () => {
    // Each of these used to "work": an empty value produced a zero-length key
    // and crashed at the first encrypt, and an absent one silently fell back to
    // 64 hex zeros — a publicly known key.
    it.each([
      ['absent', undefined],
      ['empty', ''],
      ['whitespace', '   '],
      ['too short', 'abc'],
      ['63 chars', 'a'.repeat(63)],
      ['65 chars', 'a'.repeat(65)],
      ['non-hex', 'z'.repeat(64)],
    ])('refuses to construct when the key is %s', (_label, key) => {
      expect(() => withKey(key)).toThrow(/64 hex characters/);
    });

    it('accepts uppercase hex', () => {
      expect(() => withKey('A'.repeat(64))).not.toThrow();
    });
  });

  describe('round trip', () => {
    it('decrypts what it encrypted', () => {
      const svc = withKey(VALID_KEY);
      const secret = 'JBSWY3DPEHPK3PXP';
      expect(svc.decrypt(svc.encrypt(secret))).toBe(secret);
    });

    it('produces different ciphertext each time for the same input', () => {
      const svc = withKey(VALID_KEY);
      // A fresh IV per call; identical output would leak that two users share a
      // secret, and would break the GCM security guarantee outright.
      expect(svc.encrypt('same')).not.toBe(svc.encrypt('same'));
    });

    it('tags the ciphertext with a version prefix', () => {
      expect(withKey(VALID_KEY).encrypt('x').startsWith('v1:')).toBe(true);
    });

    it('handles unicode', () => {
      const svc = withKey(VALID_KEY);
      expect(svc.decrypt(svc.encrypt('café ☕ 日本'))).toBe('café ☕ 日本');
    });
  });

  describe('tamper detection', () => {
    it('throws when a ciphertext byte is flipped', () => {
      const svc = withKey(VALID_KEY);
      const encrypted = svc.encrypt('JBSWY3DPEHPK3PXP');

      const body = Buffer.from(encrypted.slice(3), 'base64url');
      body[body.length - 1] ^= 0xff;
      const tampered = `v1:${body.toString('base64url')}`;

      // The GCM auth tag must make this fail loudly rather than return garbage.
      expect(() => svc.decrypt(tampered)).toThrow();
    });

    it('throws when decrypted under a different key', () => {
      const encrypted = withKey(VALID_KEY).encrypt('JBSWY3DPEHPK3PXP');
      expect(() => withKey(OTHER_KEY).decrypt(encrypted)).toThrow();
    });

    it('rejects a missing version prefix', () => {
      expect(() =>
        withKey(VALID_KEY).decrypt('bm90LWEtY2lwaGVydGV4dA'),
      ).toThrow(/version prefix/);
    });

    it('rejects an unknown version prefix', () => {
      expect(() =>
        withKey(VALID_KEY).decrypt('v9:bm90LWEtY2lwaGVydGV4dA'),
      ).toThrow(/Unsupported ciphertext version/);
    });

    it('rejects a truncated payload', () => {
      expect(() => withKey(VALID_KEY).decrypt('v1:AAAA')).toThrow(/too short/);
    });
  });
});
