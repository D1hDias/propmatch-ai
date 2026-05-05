import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

const nextConfig: NextConfig = {
  // Enforce server-only boundaries at build time
  // src/server/** files must import 'server-only' at the top
  experimental: {
    // typedRoutes: true, // Enable once route definitions are stable
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
