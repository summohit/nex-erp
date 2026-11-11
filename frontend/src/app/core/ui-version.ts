/**
 * Which UI a person sees while the redesign ("v2") is being built.
 *
 * v1 is the live UI and stays the default for everyone. v2 is switched on per
 * browser with `?ui=v2` in any URL (and back with `?ui=v1`); the choice is
 * remembered. When v2 is finished, change DEFAULT_UI to 'v2', and once it has
 * run without trouble delete the v1 components and this switch.
 *
 * A plain function rather than a service: the router reads it while routes
 * are being resolved, before any component exists.
 */
export type UiVersion = 'v1' | 'v2';

const DEFAULT_UI: UiVersion = 'v1';
const STORAGE_KEY = 'ui_version';

function read(): UiVersion {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('ui');
    if (fromUrl === 'v1' || fromUrl === 'v2') {
      localStorage.setItem(STORAGE_KEY, fromUrl);
      return fromUrl;
    }
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'v1' || saved === 'v2') return saved;
  } catch {
    // Storage blocked (private mode): fall back to the default.
  }
  return DEFAULT_UI;
}

/** Decided once per page load; switching reloads the page. */
const current: UiVersion = typeof window === 'undefined' ? DEFAULT_UI : read();

if (typeof document !== 'undefined') {
  document.body.classList.toggle('ui-v2', current === 'v2');
}

export const uiVersion = (): UiVersion => current;
export const isUiV2 = (): boolean => current === 'v2';

/** Switch UI and reload, so every screen loads in the chosen version. */
export function setUiVersion(version: UiVersion): void {
  try { localStorage.setItem(STORAGE_KEY, version); } catch { /* ignore */ }
  window.location.reload();
}
