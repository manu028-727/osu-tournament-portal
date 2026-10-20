import type { NextConfig } from 'next';
const config: NextConfig = {
  output: 'standalone',
  skipProxyUrlNormalize: true,
  turbopack: { root: process.cwd() },
  serverExternalPackages: ['pg', '@prisma/adapter-pg', 'sharp'],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'assets.ppy.sh' },
      { protocol: 'https', hostname: 'a.ppy.sh' },
    ],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};
export default config;
