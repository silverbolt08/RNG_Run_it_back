import type { NextConfig } from 'next';

const ONE_YEAR_SECONDS = 31_536_000;

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // These load native binaries or workers at runtime, so they can't be bundled.
  serverExternalPackages: ['sharp', 'tesseract.js', '@libsql/client', 'libsql'],
  headers: async () => [
    {
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Strict-Transport-Security', value: `max-age=${ONE_YEAR_SECONDS}; includeSubDomains` },
        // Leaves script and style sources open for now. Next.js needs nonces for a strict policy,
        // which is the frontend's to add once its pages exist.
        { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
      ],
    },
    {
      // Comes last, so it overrides the rule above for API responses, which are never rendered.
      source: '/api/:path*',
      headers: [{ key: 'Content-Security-Policy', value: "default-src 'none'; frame-ancestors 'none'" }],
    },
  ],
};

export default nextConfig;
