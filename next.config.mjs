/**
 * Next.js 配置
 * ==========================================================================
 * 重点调整:
 *   1) output: 'standalone' —— 产出更轻的运行时,便于 PM2 直接跑最小 server.js
 *   2) 保留 custom webpack,因此 build 脚本需要显式使用 --webpack
 *   3) 统一下发 HTTP 安全响应头
 * ==========================================================================
 */

function buildCsp(isDev) {
  const directives = {
    'default-src': ["'self'"],
    'base-uri':    ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
    'object-src':  ["'none'"],
    'style-src':   ["'self'", "'unsafe-inline'"],
    'script-src': [
      "'self'",
      "'unsafe-inline'",
      ...(isDev ? ["'unsafe-eval'"] : []),
      'https://challenges.cloudflare.com',
    ],
    'frame-src':   ["'self'", 'https://challenges.cloudflare.com'],
    'img-src':     ["'self'", 'data:', 'blob:'],
    'font-src':    ["'self'", 'data:'],
    'connect-src': ["'self'"],
    'manifest-src': ["'self'"],
    'worker-src':  ["'self'", 'blob:'],
  };
  if (!isDev) directives['upgrade-insecure-requests'] = [];

  return Object.entries(directives)
    .map(([k, v]) => v.length ? `${k} ${v.join(' ')}` : k)
    .join('; ');
}

function securityHeaders() {
  const isDev = process.env.NODE_ENV !== 'production';
  const csp = buildCsp(isDev);

  const headers = [
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    {
      key: 'Permissions-Policy',
      value: [
        'accelerometer=()',
        'camera=()',
        'geolocation=()',
        'gyroscope=()',
        'magnetometer=()',
        'microphone=()',
        'payment=()',
        'usb=()',
        'interest-cohort=()',
      ].join(', '),
    },
    { key: 'Content-Security-Policy', value: csp },
  ];

  if (!isDev) {
    headers.push({
      key: 'Strict-Transport-Security',
      value: 'max-age=31536000; includeSubDomains',
    });
  }

  return headers;
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  serverExternalPackages: [
    'bcryptjs',
    'jsonwebtoken',
    'nodemailer',
    'resend',
    'better-sqlite3',
  ],
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [
        ...(Array.isArray(config.externals) ? config.externals : [config.externals].filter(Boolean)),
        'bcryptjs',
        'jsonwebtoken',
        'nodemailer',
        'resend',
        'better-sqlite3',
      ];
    }
    return config;
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders() }];
  },
};

export default nextConfig;
