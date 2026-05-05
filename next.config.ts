import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Enforce server-only boundaries at build time
  // src/server/** files must import 'server-only' at the top
  experimental: {
    // typedRoutes: true, // Enable once route definitions are stable
  },
};

export default nextConfig;
