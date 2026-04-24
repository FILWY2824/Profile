/**
 * PM2 ecosystem file.
 *
 * 内存设置(1.2.0):
 * --------------------------------------------------------------------------
 *  --max-old-space-size=160  → V8 Old Generation 堆上限 160MB。
 *                              Next.js 16 standalone 下 idle 堆活用 60-90MB,
 *                              50 并发峰值 ~130MB,160 留 ~30MB 余量,再低会
 *                              频繁 GC / OOM。
 *  max_memory_restart: 220M  → RSS 超过 220MB 就重启。RSS = 堆 + V8 off-heap +
 *                              原生模块(bcryptjs/better-sqlite3)常驻内存 +
 *                              Node 运行时基线。220 是实测对 Next.js 16 比较
 *                              稳妥的值;再小会偶尔误杀。
 *
 *  ⚠️ 现实提醒:**这个栈最低 RSS 就是 120-180MB**,是 Next.js + React 19 +
 *     V8 + better-sqlite3 组合的硬性开销。想进一步降到 <100MB 必须换框架。
 * --------------------------------------------------------------------------
 */
module.exports = {
  apps: [
    {
      name: 'qishu',
      cwd: __dirname,
      script: '.next/standalone/server.js',
      interpreter: 'node',
      node_args: '--max-old-space-size=160',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '220M',
      exp_backoff_restart_delay: 200,
      kill_timeout: 10000,
      listen_timeout: 10000,
      env: {
        NODE_ENV: 'production',
        PORT: '3000',
        HOSTNAME: '127.0.0.1',   // 只监听本机,必须靠前面的 nginx 反代暴露
      },
    },
  ],
};
