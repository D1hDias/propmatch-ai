import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

const nextConfig: NextConfig = {
  experimental: {
    // typedRoutes: true, // Enable once route definitions are stable
  },
  // Playwright is a devDependency used only in tests and the scraper VPS.
  // serverExternalPackages works for both webpack and Turbopack — prevents
  // Next.js from bundling playwright-core (which includes .ttf assets that
  // Turbopack can't handle).
  serverExternalPackages: ['playwright', 'playwright-core', '@playwright/test'],
};

export default withSentryConfig(nextConfig, {
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  widenClientFileUpload: true,
  tunnelRoute: '/monitoring-tunnel',
  sourcemaps: { disable: false },
  disableLogger: true,
  automaticVercelMonitors: false,
});
