/**
 * Next.js 配置
 * ===========================================================================
 * 两件事:
 *   1) 让 webpack 不要把 native 模块(better-sqlite3 的 .node)打进 bundle
 *   2) 统一下发 HTTP 安全响应头(headers())
 *
 * 关于 headers() ——
 *   这是 Next.js 提供的"出口处"统一添加响应头的方式,对所有由 Next 提供的
 *   路由/资源都生效(包括 /api/* 与静态页面)。如果你在前面挂了 Nginx / CDN,
 *   可以把同样的策略放到反代层,哪层都行,但至少要有一层。
 *
 *   本项目的安全头由下面的 securityHeaders() 生成,每一条都写了理由。修改前
 *   请先理解该头的语义,否则很容易把自家前端打挂 —— 尤其是 CSP。
 * ===========================================================================
 */

/**
 * 构造 CSP。
 *
 * 本项目的加载来源:
 *   • self —— 绝大多数 JS/CSS/图片/字体
 *   • Cloudflare Turnstile 的 JS + iframe:challenges.cloudflare.com(登录/
 *     注册/找回密码页都会加载)
 *   • 'unsafe-inline' for style-src —— Next + 组件里有大量 style={{}} 内联
 *     样式(page.js / TopBar.js / Admin 页面都在用),完全收掉不现实。
 *     风险由 HTML 转义(我们到处用模板字符串嵌进 JSX,React 会自动转义)+
 *     其他头(X-Content-Type-Options、X-Frame-Options)兜底。
 *   • 'unsafe-inline' for script-src —— Next 会注入内联引导脚本,去掉会白屏。
 *     真正的纵深防御要上 nonce,但那要求每次渲染都动态算 nonce 并改全部内联,
 *     本仓库现阶段不值得。后续可以在 middleware 里用 nonce 做收紧。
 *   • 'unsafe-eval' —— 生产不需要,仅在 dev 时 Next 的 React Refresh 要用。
 *     所以 dev 与 prod 的 CSP 不同。
 *   • favicon 是通过 /api/favicons/image 自家端点代理抓取的,已经是 self,
 *     不需要对 img-src 开第三方。
 *
 * 特别说明 —— 报告接收:
 *   没有配 report-uri / report-to,因为我们没有收集端。如果将来接了
 *   Sentry 之类,建议加上 report-to 定位违规源,再逐步收紧这条策略。
 */
function buildCsp(isDev) {
  const directives = {
    'default-src': ["'self'"],
    'base-uri':    ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"], // 与 X-Frame-Options: DENY 对应,优先生效
    'object-src':  ["'none'"],
    // Next 需要内联样式;Turnstile 的 widget 也注入自己的 style。
    'style-src':   ["'self'", "'unsafe-inline'"],
    // Next 的 bootstrap 与 RSC flight data 有内联 script;dev 还要 eval。
    // Turnstile 的 api.js 从 challenges.cloudflare.com 加载。
    'script-src': [
      "'self'",
      "'unsafe-inline'",
      ...(isDev ? ["'unsafe-eval'"] : []),
      'https://challenges.cloudflare.com',
    ],
    // Turnstile 的挑战渲染在一个 challenges.cloudflare.com 的 iframe 里
    'frame-src':   ["'self'", 'https://challenges.cloudflare.com'],
    // 我们代理抓站点 favicon,对 /api/favicons/image 端点下发的是 PNG/SVG;
    // 这些已经是 self。data: 放开是为了小图像占位。
    'img-src':     ["'self'", 'data:', 'blob:'],
    'font-src':    ["'self'", 'data:'],
    // 前端只向自己调 API(包括 /api/auth/turnstile-config);Turnstile 的
    // siteverify 是服务端到 Cloudflare,不算 connect。
    'connect-src': ["'self'"],
    'manifest-src': ["'self'"],
    'worker-src':  ["'self'", 'blob:'],
  };
  // 生产下启用浏览器对混合内容的自动升级(HSTS 的辅助)。dev 走 http,不要加。
  if (!isDev) directives['upgrade-insecure-requests'] = [];

  return Object.entries(directives)
    .map(([k, v]) => v.length ? `${k} ${v.join(' ')}` : k)
    .join('; ');
}

function securityHeaders() {
  const isDev = process.env.NODE_ENV !== 'production';
  const csp = buildCsp(isDev);

  const headers = [
    // 点击劫持保护 —— frame-ancestors 'none' 理论上覆盖,但老浏览器只认这个
    { key: 'X-Frame-Options', value: 'DENY' },

    // 阻止浏览器做 MIME sniff(比如把上传的 html 当图片;或反过来)
    { key: 'X-Content-Type-Options', value: 'nosniff' },

    // 禁止跨站 referrer 泄露;同源跳转保留完整 URL
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },

    // 默认收紧所有可探测的浏览器能力。需要什么再开什么。
    // 这里把 geolocation/camera/microphone/payment 等一律禁掉。
    { key: 'Permissions-Policy',
      value: [
        'accelerometer=()',
        'camera=()',
        'geolocation=()',
        'gyroscope=()',
        'magnetometer=()',
        'microphone=()',
        'payment=()',
        'usb=()',
        'interest-cohort=()', // FLoC opt-out,谷歌已弃用但保留这条无副作用
      ].join(', ') },

    // CSP —— dev 与 prod 不同见 buildCsp 的注释
    { key: 'Content-Security-Policy', value: csp },
  ];

  if (!isDev) {
    // HSTS 必须放在有 HTTPS 的环境,否则会把走 http 的本地/预发坏掉。
    // preload 需要满足 hstspreload.org 的三条要求(max-age>=1y/includeSubDomains/
    // preload),不满足就不要开,这里保守地先不 preload,真要上名单时再切。
    headers.push({
      key: 'Strict-Transport-Security',
      value: 'max-age=31536000; includeSubDomains',
    });
    // 跨源隔离相关:本项目目前不依赖 SharedArrayBuffer,没必要启用 COOP/COEP
    // (开了反而会把某些第三方嵌入打挂)。有需要再加。
  }

  return headers;
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: [
    'bcryptjs',
    'jsonwebtoken',
    'nodemailer',
    'resend',
    'better-sqlite3',
    'ssh2',
  ],
  webpack: (config, { isServer }) => {
    if (isServer) {
      // 防止 webpack 打包 native node 模块(better-sqlite3 的 .node 二进制,
      // ssh2 里的 cpu-features / sodium-native 可选依赖同理)
      config.externals = [
        ...(Array.isArray(config.externals) ? config.externals : [config.externals].filter(Boolean)),
        'bcryptjs',
        'jsonwebtoken',
        'nodemailer',
        'resend',
        'better-sqlite3',
        'ssh2',
      ];
    }
    return config;
  },
  async headers() {
    // 对所有路由下发安全头;要针对某类路径单独放宽(比如某个 iframe 嵌入页),
    // 在这里按 source 再加一条更宽的规则即可,Next 会按先后顺序应用。
    return [
      { source: '/:path*', headers: securityHeaders() },
    ];
  },
};
export default nextConfig;
