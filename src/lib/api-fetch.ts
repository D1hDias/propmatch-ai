/**
 * Thin fetch wrapper that automatically refreshes the JWT access token when
 * it is expired (or about to expire) before making API calls.
 *
 * Usage: drop-in replacement for fetch() in client components.
 *   const res = await apiFetch('/api/v1/briefings');
 *
 * Token lifecycle:
 *   1. Reads access_token from localStorage.
 *   2. If the token is expired (or expires within 30s), calls POST
 *      /api/v1/auth/refresh — the server reads the HttpOnly refresh-token
 *      cookie automatically and returns a new access_token.
 *   3. Makes the original request with the (possibly refreshed) token.
 *   4. On a 401 response, tries a single refresh-and-retry before giving up
 *      and redirecting to /login.
 */

const SKEW_SECONDS = 30; // refresh if token expires within 30s

function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

function setStoredToken(token: string): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem('access_token', token);
  }
}

function getTokenExpiry(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]!)) as { exp?: number };
    return payload.exp ?? null;
  } catch {
    return null;
  }
}

function isTokenStale(token: string | null): boolean {
  if (!token) return true;
  const exp = getTokenExpiry(token);
  if (exp === null) return true;
  return exp - SKEW_SECONDS < Date.now() / 1000;
}

let refreshPromise: Promise<string | null> | null = null;

async function doRefresh(): Promise<string | null> {
  try {
    const res = await fetch('/api/v1/auth/refresh', { method: 'POST' });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: string };
    const token = data.access_token ?? null;
    if (token) setStoredToken(token);
    return token;
  } catch {
    return null;
  }
}

async function ensureFreshToken(): Promise<string | null> {
  let token = getStoredToken();

  if (isTokenStale(token)) {
    // Deduplicate concurrent refresh calls
    if (!refreshPromise) {
      refreshPromise = doRefresh().finally(() => { refreshPromise = null; });
    }
    token = await refreshPromise;
  }

  return token;
}

async function redirectToLogin(): Promise<void> {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('access_token');
  try {
    await fetch('/api/v1/auth/logout', { method: 'POST' });
  } catch {
    // proceed to redirect even if logout call fails
  }
  window.location.href = '/login';
}

/** Returns a fresh (non-expired) access token, or null if refresh failed. */
export async function getFreshToken(): Promise<string | null> {
  return ensureFreshToken();
}

/** Clears the stored access token (use before redirecting to login). */
export function clearAccessToken(): void {
  if (typeof window !== 'undefined') localStorage.removeItem('access_token');
}

export async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = await ensureFreshToken();

  const existingHeaders = (options.headers ?? {}) as Record<string, string>;
  const authHeader: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  const res = await fetch(url, {
    ...options,
    headers: { ...existingHeaders, ...authHeader },
  });

  // Single retry on 401 (token may have been revoked server-side)
  if (res.status === 401) {
    const newToken = await doRefresh();
    if (!newToken) {
      await redirectToLogin();
      return res;
    }
    const retryRes = await fetch(url, {
      ...options,
      headers: { ...existingHeaders, Authorization: `Bearer ${newToken}` },
    });
    if (retryRes.status === 401) {
      await redirectToLogin();
    }
    return retryRes;
  }

  return res;
}
