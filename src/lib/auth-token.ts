/**
 * Client-side JWT utilities — decodes the payload without signature verification.
 * Verification happens server-side in requireAuth(). Use these only for UI decisions
 * (e.g. showing/hiding admin routes). Never trust client-decoded data for access control.
 */

interface TokenPayload {
  sub: string;
  email: string;
  role: string;
  plan: string;
  exp: number;
}

export function getTokenPayload(): TokenPayload | null {
  if (typeof window === 'undefined') return null;
  const token = localStorage.getItem('access_token');
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const base64 = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(base64)) as TokenPayload;
  } catch {
    return null;
  }
}

export function getUserRole(): string | null {
  return getTokenPayload()?.role ?? null;
}

export function isAdmin(): boolean {
  return getUserRole() === 'admin';
}
