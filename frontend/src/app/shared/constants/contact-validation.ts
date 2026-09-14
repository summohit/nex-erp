/**
 * One place for the email and phone rules, so the CRM forms and anything added
 * later agree on what a valid address or number looks like.
 *
 * The backend mirrors these in crm.service.ts. Keep the two in step: a rule the
 * server does not know about is only a suggestion, and a rule only the server
 * knows about shows up as an unexplained red toast.
 */

/**
 * Deliberately not RFC 5322. That grammar admits addresses no mail provider
 * accepts and takes a page of regex; the failure it prevents (a typo) is caught
 * just as well by insisting on `something@something.tld` with no spaces.
 */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;

/** Characters a person may reasonably type or paste into a phone field. */
const PHONE_SHAPE = /^\+?[0-9\s\-().]{6,25}$/;

export function isValidEmail(value: string | null | undefined): boolean {
  return EMAIL_PATTERN.test((value ?? '').trim());
}

/**
 * Permissive about punctuation, strict about content.
 *
 * People paste numbers as "+91 98108-91437" or "(011) 4155 5555", and rejecting
 * those teaches them to fight the form. What actually matters is the digits
 * underneath: 10 is a full national number, and E.164 caps the total at 15.
 */
export function isValidPhone(value: string | null | undefined): boolean {
  const raw = (value ?? '').trim();
  if (!PHONE_SHAPE.test(raw)) return false;
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

/** Optional fields: blank is fine, but anything typed must be well formed. */
export function isValidOptionalPhone(value: string | null | undefined): boolean {
  return !(value ?? '').trim() || isValidPhone(value);
}

export function isValidOptionalEmail(value: string | null | undefined): boolean {
  return !(value ?? '').trim() || isValidEmail(value);
}
