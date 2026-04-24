/**
 * Next.js 配置
 * ==========================================================================
 * 重点调整:
 *   1) output: 'standalone' —— 产出更轻的运行时,便于 PM2 直接跑最小 server.js
 *   2) 保留 custom webpack,因此 build 脚本需要显式使用 --webpack
 *   3) 统一下发 HTTP 安全响应头
 *
 * 1.2.2 调整:
 *   - 从 serverExternalPackages / webpack.externals 里移除 nodemailer ——
 *     项目实际用的是 Resend (见 lib/email.js),nodemailer 从未被任何代码
 *     import。同步删除 package.json 的依赖,消除 4 个 CVE。
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
  // 产物层面的减法:
  //   - productionBrowserSourceMaps: false  → 不把 .map 文件打进 standalone,
  //     node 运行时不会 load source maps,避免白白占内存 & 磁盘。
  //   - compress: true                      → gzip 响应,减 CPU/带宽峰值
  productionBrowserSourceMaps: false,
  compress: true,
  serverExternalPackages: [
    'bcryptjs',
    'jsonwebtoken',
    'resend',
    'better-sqlite3',
  ],
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [
        ...(Array.isArray(config.externals) ? config.externals : [config.externals].filter(Boolean)),
        'bcryptjs',
        'jsonwebtoken',
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
