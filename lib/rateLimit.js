/**
 * 轻量级内存速率限制 —— 单进程有效(小型部署足够)。
 * 多进程/多实例部署请迁移到 Redis。
 *
 * 用法:
 *   const r = rateLimit('login', ip, { max: 10, windowMs: 60_000 });
 *   if (!r.allowed) return NextResponse.json({ error: '请求过于频繁' }, { status: 429 });
 */

const buckets = new Map(); // key -> number[]  (timestamps, 升序)

/** 读取请求真实 IP */
export function getClientIp(request) {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'unknown';
}

/**
 * @param scope   用于隔离不同限流维度的命名空间,如 'login'、'register'
 * @param id      客户端标识,一般是 IP 或 IP+邮箱
 * @param opts    { max, windowMs }
 * @returns { allowed, remaining, retryAfter }
 */
export function rateLimit(scope, id, opts = {}) {
  const { max = 30, windowMs = 60_000 } = opts;
  const key = `${scope}:${id}`;
  const now = Date.now();
  const since = now - windowMs;

  let arr = buckets.get(key);
  if (!arr) { arr = []; buckets.set(key, arr); }

  // 丢掉窗口外记录
  while (arr.length && arr[0] < since) arr.shift();

  if (arr.length >= max) {
    const retryAfter = Math.ceil((arr[0] + windowMs - now) / 1000);
    return { allowed: false, remaining: 0, retryAfter };
  }
  arr.push(now);
  return { allowed: true, remaining: max - arr.length, retryAfter: 0 };
}

/** 清理长期不用的 key,避免内存泄漏 —— 应周期性调用 */
export function sweepRateLimit() {
  const now = Date.now();
  for (const [key, arr] of buckets) {
    if (!arr.length) { buckets.delete(key); continue; }
    // 超过 1 小时不活动的桶清除
    if (now - arr[arr.length - 1] > 60 * 60 * 1000) buckets.delete(key);
  }
}

// 每 10 分钟自动清理一次
if (typeof setInterval !== 'undefined') {
  setInterval(sweepRateLimit, 10 * 60 * 1000).unref?.();
}
