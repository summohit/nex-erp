import { randomInt } from 'crypto';

/**
 * A one-off temporary password for a new joiner's first sign-in: 10 characters,
 * no look-alikes (0/O, 1/l/I), at least one digit. They must replace it on first
 * login (User.mustChangePassword).
 */
export function temporaryPassword(): string {
  const letters = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const all = letters + digits;
  let out = '';
  for (let i = 0; i < 8; i++) out += all[randomInt(all.length)];
  return out + digits[randomInt(digits.length)] + letters[randomInt(letters.length)];
}
