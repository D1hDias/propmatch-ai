import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Cookie name must match REFRESH_COOKIE in src/server/lib/response.ts
const REFRESH_COOKIE = 'refresh_token';

// Prefixes that require an authenticated session
const PROTECTED_PREFIXES = [
  '/dashboard',
  '/briefings',
  '/clients',
  '/busca',
  '/historico',
  '/mensagens',
  '/settings',
];

// Prefixes that should redirect already-authenticated users to the dashboard
const AUTH_ONLY_PREFIXES = ['/login', '/signup'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has(REFRESH_COOKIE);

  // Redirect unauthenticated users trying to access app routes → login
  if (PROTECTED_PREFIXES.some((p) => pathname.startsWith(p))) {
    if (!hasSession) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      url.searchParams.set('next', pathname);
      return NextResponse.redirect(url);
    }
  }

  // Redirect already-authenticated users away from auth pages → dashboard
  if (AUTH_ONLY_PREFIXES.some((p) => pathname.startsWith(p))) {
    if (hasSession) {
      const url = request.nextUrl.clone();
      url.pathname = '/dashboard';
      url.searchParams.delete('next');
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Skip Next.js internals, static files, and API routes
    // API routes protect themselves via requireAuth() per-handler
    '/((?!_next/static|_next/image|favicon.ico|public/|api/).*)',
  ],
};
