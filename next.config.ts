import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

const nextConfig: NextConfig = {
  experimental: {
    // typedRoutes: true, // Enable once route definitions are stable
  },
  webpack(config, { isServer }) {
    if (isServer) {
      // Playwright is a devDependency used only in tests and the scraper VPS.
      // Excluding it prevents Next.js from trying to bundle it (and its
      // optional chromium-bidi dep) into the server bundle.
      config.externals = [
        ...(Array.isArray(config.externals) ? config.externals : [config.externals ?? []].flat()),
        'playwright',
        'playwright-core',
        '@playwright/test',
      ];
    }
    return config;
  },
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
