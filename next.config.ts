import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

const nextConfig: NextConfig = {
  allowedDevOrigins: ['*.trycloudflare.com'],
  turbopack: {
    rules: {
      '*.ttf': { loaders: ['null-loader'], as: '*.js' },
    },
  },
};

// Sentry's withSentryConfig conflicts with Turbopack in dev (require-in-the-middle issue).
// Skip the wrapper in development — Sentry still captures errors via sentry.server.config.ts.
export default process.env.NODE_ENV === 'production'
  ? withSentryConfig(nextConfig, {
      silent: true,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      widenClientFileUpload: true,
      tunnelRoute: '/monitoring-tunnel',
      sourcemaps: { disable: false },
      disableLogger: true,
      automaticVercelMonitors: false,
    })
  : nextConfig;
