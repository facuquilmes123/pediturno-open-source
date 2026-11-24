
const withBundleAnalyzer = process.env.ANALYZE === 'true'
  ? require('@next/bundle-analyzer')({ enabled: true })
  : (config) => config;

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: { cpus: 1 },
  output: 'standalone',
  outputFileTracingRoot: __dirname,
  poweredByHeader: false,
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Pediturno-Release', value: '20261107-servicios-correo-opcional' },
        { key: 'Strict-Transport-Security', value: 'max-age=604800' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=()' },
        { key: 'Content-Security-Policy', value: "upgrade-insecure-requests; frame-ancestors 'self'; base-uri 'self'; object-src 'none'" },
      ],
    }, ...['/auth/action', '/__/auth/action'].map(source => ({
      source,
      headers: [
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Content-Security-Policy', value: "upgrade-insecure-requests; frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
      ],
    })), {
      source: '/dashboard/:path*',
      headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' }],
    }, {
      source: '/dashboard',
      headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' }],
    }];
  },
  async rewrites() {
    return [
      { source: '/__/auth/action', destination: '/auth/action' },
      {
        source: '/__/auth/:path*',
        destination: `https://pediturno-app.firebaseapp.com/__/auth/:path*`,
      },
    ];
  },
  async redirects() {
    return [
      ...[
        ['www.pediturno.com', 'https://pediturno.com'],
        ['www.canchas.pediturno.com', 'https://canchas.pediturno.com'],
        ['www.espacios.pediturno.com', 'https://espacios.pediturno.com'],
      ].map(([host, origin]) => ({ source: '/:path*', has: [{ type: 'host', value: host }], destination: `${origin}/:path*`, permanent: true })),
      ...['canchas.pediturno.com', 'espacios.pediturno.com'].flatMap(host => ['privacy-policy', 'terminos', 'faq'].map(path => ({ source: `/${path}`, has: [{ type: 'host', value: host }], destination: `https://pediturno.com/${path}`, permanent: true }))),
    ];
  },
  /* config options here */
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'firebasestorage.googleapis.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: '*.tile.openstreetmap.org',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'flagcdn.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'upload.wikimedia.org',
        port: '',
        pathname: '/**',
      }
    ],
  },
  webpack(config) {
    config.experiments = { ...config.experiments, asyncWebAssembly: true };
    return config;
  },
};

module.exports = withBundleAnalyzer(nextConfig);
