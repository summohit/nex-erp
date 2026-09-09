import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

/**
 * Marks the ciphertext format so the key can be rotated later — AES-GCM output
 * carries no key identifier of its own, so without a prefix there is no way to
 * tell which key a stored value was encrypted under.
 */
const VERSION = 'v1';

/**
 * Authenticated symmetric encryption for columns that must not be readable
 * from a database dump — currently the TOTP secrets behind two-factor auth.
 *
 * The key comes from ENCRYPTION_KEY as 64 hex characters (32 bytes).
 */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor() {
    // `||` rather than `??` on purpose: the deployed .env used to carry an
    // empty ENCRYPTION_KEY, which `??` passes straight through and which then
    // yields a zero-length key and an "Invalid key length" crash at the first
    // encrypt. An absent variable used to fall back to 64 zeros — worse still,
    // because it silently encrypts under a publicly known key. Neither is
    // recoverable once real secrets are stored, so refuse to start instead.
    const hex = (process.env.ENCRYPTION_KEY || '').trim();

    if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
      throw new Error(
        'ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). ' +
          'Generate one with `openssl rand -hex 32` and set it in .env. ' +
          'Refusing to start: encrypted data would be unrecoverable or insecure.',
      );
    }

    this.key = Buffer.from(hex, 'hex');
  }

  /** Returns `v1:<base64url(iv | authTag | ciphertext)>`. */
  encrypt(text: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(text, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return `${VERSION}:${Buffer.concat([iv, tag, encrypted]).toString('base64url')}`;
  }

  /**
   * Throws if the value was tampered with, truncated, or encrypted under a
   * different key — the GCM auth tag makes that detectable rather than
   * returning plausible-looking garbage.
   */
  decrypt(token: string): string {
    const separator = token.indexOf(':');
    if (separator === -1) {
      throw new Error('Ciphertext is missing its version prefix.');
    }

    const version = token.slice(0, separator);
    if (version !== VERSION) {
      throw new Error(`Unsupported ciphertext version "${version}".`);
    }

    const data = Buffer.from(token.slice(separator + 1), 'base64url');
    if (data.length <= 28) {
      throw new Error('Ciphertext is too short to be valid.');
    }

    const iv = data.subarray(0, 12);
    const tag = data.subarray(12, 28);
    const encrypted = data.subarray(28);

    const decipher = crypto.createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString('utf8');
  }
}
