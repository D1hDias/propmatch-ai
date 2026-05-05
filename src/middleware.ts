import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Auth verification, rate limiting, and RLS context injection
// will be implemented in AUTH-2 and AUTH-3.
export function middleware(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    '/((?!_next/static|_next/image|favicon.ico|public/).*)',
  ],
};
