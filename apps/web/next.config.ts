import { resolve } from 'node:path';
import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';

// Single .env.local at the repository root (shared with the worker scripts).
const repoRoot = resolve(import.meta.dirname, '../..');
// forceReload: Next has already loaded (and cached) apps/web/.env*; this adds the root file
loadEnvConfig(repoRoot, process.env.NODE_ENV !== 'production', { info: () => {}, error: console.error }, true);

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), microphone=(self)' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // workspace packages are TypeScript sources
  transpilePackages: ['@instantreels/core', '@instantreels/video'],
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }, { key: 'Content-Type', value: 'application/javascript; charset=utf-8' }] },
    ];
  },
};

export default nextConfig;
