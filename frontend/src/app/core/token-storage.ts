/**
 * Where the session's tokens live, and for how long.
 *
 * "Remember me" is the choice between the two web storages the browser already
 * gives us:
 *
 *   localStorage   - survives closing the browser. The remembered session.
 *   sessionStorage - dies with the tab. The shared-computer session.
 *
 * Every read goes through here and checks sessionStorage first, so a
 * not-remembered session on a machine that also has a remembered one stored
 * cannot accidentally pick up the older token.
 *
 * The checkbox used to be decorative: tokens always went to localStorage, so
 * unticking "Remember me" on a shared machine left a working session behind
 * for the next person.
 */

const ACCESS = 'access_token';
const REFRESH = 'refresh_token';
/** Survives the 2FA redirect, where the choice is made before the tokens exist. */
const PREFERENCE = 'auth_remember_me';

/** Storage can throw in private mode or with site data blocked; never let that break sign-in. */
function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function setRememberMe(remember: boolean): void {
  safe(() => sessionStorage.setItem(PREFERENCE, remember ? '1' : '0'), undefined);
}

/** Defaults to true: an unanswered question should not silently sign people out. */
export function getRememberMe(): boolean {
  return safe(() => sessionStorage.getItem(PREFERENCE), null) !== '0';
}

function store(): Storage {
  return getRememberMe() ? localStorage : sessionStorage;
}

export function setTokens(accessToken?: string, refreshToken?: string): void {
  const target = store();
  const other = target === localStorage ? sessionStorage : localStorage;
  safe(() => {
    // Clear the other store first. Leaving a stale pair behind is how someone
    // ends up authenticated as whoever last used the machine.
    other.removeItem(ACCESS);
    other.removeItem(REFRESH);
    if (accessToken) target.setItem(ACCESS, accessToken);
    if (refreshToken) target.setItem(REFRESH, refreshToken);
  }, undefined);
}

export function getAccessToken(): string | null {
  return safe(() => sessionStorage.getItem(ACCESS) ?? localStorage.getItem(ACCESS), null);
}

export function getRefreshToken(): string | null {
  return safe(() => sessionStorage.getItem(REFRESH) ?? localStorage.getItem(REFRESH), null);
}

export function clearTokens(): void {
  safe(() => {
    for (const s of [localStorage, sessionStorage]) {
      s.removeItem(ACCESS);
      s.removeItem(REFRESH);
    }
    sessionStorage.removeItem(PREFERENCE);
  }, undefined);
}
