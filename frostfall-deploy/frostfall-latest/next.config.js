/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [{
      protocol: 'https',
      hostname: '**.supabase.co',
      pathname: '/storage/v1/object/public/**',
    }],
  },
  async headers() {
    const securityHeaders = [
      // Do not expose authenticated UI via wildcard CORS or permissive framing.
      // API calls are same-origin; Supabase requests originate from the browser directly.
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
      { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
      { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'" },
      { key: 'X-Robots-Tag', value: process.env.FROSTFALL_DEPLOYMENT_ROLE === 'staging' ? 'noindex, nofollow, noarchive' : 'all' },
    ];
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
};

module.exports = nextConfig;
