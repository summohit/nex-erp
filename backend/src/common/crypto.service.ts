import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
// Encryption key must be 32 bytes (256 bits). Provide via env var ENCRYPTION_KEY as hex string.
const KEY = Buffer.from(process.env.ENCRYPTION_KEY ?? '0000000000000000000000000000000000000000000000000000000000000000', 'hex');

export class CryptoService {
  encrypt(text: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString('base64url');
  }

  decrypt(token: string): string {
    const data = Buffer.from(token, 'base64url');
    const iv = data.subarray(0, 12);
    const tag = data.subarray(12, 28);
    const encrypted = data.subarray(28);
    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    return decrypted;
  }
}
