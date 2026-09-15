import axios, { AxiosRequestConfig } from 'axios';
import { useAuthStore } from '../store/authStore';

// In a real app, this should come from a .env file
// Using the deployed backend URL or local IP depending on environment
export const API_URL = 'https://nex.ces-pl.com/api';

/**
 * How long an ordinary request may wait before it is treated as lost.
 *
 * Axios defaults to 0, which means wait forever. On a phone that is not a
 * theoretical setting: switching WiFi to cellular, walking into a dead zone or
 * resuming from background all leave sockets that will never answer, and a
 * request that never settles leaves whatever screen awaited it spinning for the
 * rest of the session. A request that fails is recoverable — the user sees an
 * error and can retry. One that hangs is not.
 */
export const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Uploads get their own budget. A visit photo over slow cellular routinely
 * takes longer than a JSON call ever should, and timing those out at 30s would
 * trade a hang for a fix that breaks photo upload.
 */
export const UPLOAD_TIMEOUT_MS = 120_000;

export const apiClient = axios.create({
  baseURL: API_URL,
  timeout: REQUEST_TIMEOUT_MS,
  headers: {
    'Content-Type': 'application/json',
    // Identifies this client to the server's temporary two-factor bypass.
    // It is not a credential and proves nothing — anyone can send the same
    // header — so the server must never treat it as evidence of anything.
    // Remove once that bypass is retired.
    'X-Client-Platform': 'mobile',
  },
});

/**
 * A bare client for the refresh call itself. Using `apiClient` would send the
 * dead access token and re-enter the interceptor below on failure, so the
 * refresh has to travel on a client that has no interceptors at all.
 */
const refreshClient = axios.create({
  baseURL: API_URL,
  // Shorter than the rest: every request that 401s waits on this one call, so a
  // hung refresh stalls the whole app rather than a single screen.
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

/**
 * A 401 from these means the credentials themselves were wrong, or the refresh
 * token is spent — not that a live session aged out. Refreshing would be
 * meaningless, and on `/auth/refresh` it would recurse.
 */
const AUTH_ROUTES = [
  '/auth/login',
  '/auth/refresh',
  '/auth/signup',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/auth/resend-verification',
  '/auth/verify',
  // A wrong two-factor code answers 401 by design; refreshing and retrying it
  // would be meaningless and would log the user out mid sign-in.
  '/auth/2fa/challenge',
];

const isAuthRoute = (url?: string) => !!url && AUTH_ROUTES.some((r) => url.includes(r));

// Add a request interceptor to inject the token
apiClient.interceptors.request.use(
  (config) => {
    const token = useAuthStore.getState().token;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

/**
 * In-flight refresh, shared by every request that 401s while it runs.
 *
 * Without this, a screen that fires several requests at once (the dashboard
 * does) would start one refresh per request. The server rotates the refresh
 * token on each call, so the first would succeed and the rest would present an
 * already-spent token, fail, and log the user out — the exact thing this is
 * meant to prevent.
 */
let refreshInFlight: Promise<string | null> | null = null;

async function performRefresh(): Promise<string | null> {
  const stored = useAuthStore.getState().refreshToken;
  if (!stored) return null;

  try {
    const { data } = await refreshClient.post('/auth/refresh', { refreshToken: stored });
    const accessToken: string | undefined = data?.access_token;
    if (!accessToken) return null;

    await useAuthStore.getState().setTokens(accessToken, data?.refresh_token ?? null);
    return accessToken;
  } catch {
    // Expired or rejected refresh token — the caller signs the user out.
    return null;
  }
}

function refreshSession(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = performRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

// Response interceptor: renew an expired session in place rather than throwing
// the user back to the login screen every time the hour-long access token runs
// out — which, on a field visit, could happen mid-visit.
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    // Log the error response for debugging
    if (error.response) {
      console.warn(`API Error [${error.response.status}] on ${error.config?.url}:`, error.response.data);
    } else {
      console.warn(`API Network Error on ${error.config?.url}:`, error.message);
    }

    const original = error.config as (AxiosRequestConfig & { _retry?: boolean }) | undefined;

    if (error.response?.status === 401 && original && !original._retry && !isAuthRoute(original.url)) {
      // Retry each request at most once, so a token the server keeps rejecting
      // cannot put us in a refresh loop.
      original._retry = true;

      const newToken = await refreshSession();
      if (newToken) {
        original.headers = { ...(original.headers || {}), Authorization: `Bearer ${newToken}` };
        return apiClient(original);
      }

      // No refresh token, or the server refused it: the session is genuinely
      // over, so fall back to the old behaviour.
      await useAuthStore.getState().logout();
    }

    return Promise.reject(error);
  }
);
