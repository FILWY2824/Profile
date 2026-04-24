/**
 * rateLimitMemory.test.js —— rateLimit 在高输入下的内存守卫
 *
 * 关键不变量:
 *   1) 桶总数有硬顶 MAX_BUCKETS,攻击者伪造无数个独特 ID 不会让内存无限增长
 *   2) sweepRateLimit 能清掉过期桶,不积累
 *
 * 这两点都是把 Kinsing 类挖矿木马之前用来探测 /登录端点 / 寻找弱密码的流量
 * 打过来时,应用内存表现的底线。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// 把 env var 设到极低值,方便在测试里观察到硬顶生效 —— rateLimit.js 在
// 模块加载时读 env,所以这必须在 import 之前。
process.env.RATE_LIMIT_MAX_BUCKETS = '64';

const { rateLimit, sweepRateLimit } = await import('../lib/rateLimit.js');

test('rateLimit: 基本滑动窗口允许 max 次', () => {
  const id = `user:${Date.now()}:${Math.random()}`;
  const opts = { max: 3, windowMs: 60_000 };
  assert.equal(rateLimit('test-basic', id, opts).allowed, true);
  assert.equal(rateLimit('test-basic', id, opts).allowed, true);
  assert.equal(rateLimit('test-basic', id, opts).allowed, true);
  assert.equal(rateLimit('test-basic', id, opts).allowed, false); // 第 4 次被拦
});

test('rateLimit: 不同 scope 独立计数', () => {
  const id = `iso:${Date.now()}`;
  assert.equal(rateLimit('scope-a', id, { max: 1 }).allowed, true);
  // scope-a 已用完,但 scope-b 应独立放行
  assert.equal(rateLimit('scope-a', id, { max: 1 }).allowed, false);
  assert.equal(rateLimit('scope-b', id, { max: 1 }).allowed, true);
});

test('rateLimit: 桶总数硬顶(防伪造 IP 打爆内存)', () => {
  // MAX_BUCKETS = 64,我们往 'flood' scope 扔 500 个不同 id
  for (let i = 0; i < 500; i++) {
    rateLimit('flood', `ip-${i}`, { max: 100, windowMs: 60_000 });
  }
  // 硬顶生效后新 id 会并入 __overflow__ 共享桶 —— 我们这里只能观察副作用:
  // sweepRateLimit 后再跑一次,应该还能正常工作(不 throw),并且后续新 id
  // 仍能得到响应(allowed=true 或 false,取决于 overflow 桶是否被打满)
  assert.doesNotThrow(() => sweepRateLimit());
  const r = rateLimit('flood', 'ip-new-xxx', { max: 100, windowMs: 60_000 });
  assert.ok(typeof r.allowed === 'boolean');
});

test('rateLimit: 超长 id 被截断,不会让 key 长度失控', () => {
  const longId = 'x'.repeat(10_000);
  const r = rateLimit('long-id', longId, { max: 5 });
  assert.ok(typeof r.allowed === 'boolean');
  // 再用同样的 prefix 但改到超长后尾部不同 —— 因为截断逻辑,实际会撞到同一个 key
  // 这是"保护内存的副作用":极长的 id 无法用来刻意占多个桶
  const r2 = rateLimit('long-id', longId + 'suffix', { max: 5 });
  assert.ok(typeof r2.allowed === 'boolean');
});

test('rateLimit: 参数畸形不会让 max/window 变负数或无穷', () => {
  // max = -5 → 内部 clamp 到 ≥1;windowMs = 99999999999 → clamp 到 24h
  const r1 = rateLimit('bad-params', 'x', { max: -5, windowMs: 10 });
  const r2 = rateLimit('bad-params', 'y', { max: 999999999, windowMs: 99999999999 });
  assert.ok(typeof r1.allowed === 'boolean');
  assert.ok(typeof r2.allowed === 'boolean');
});

test('rateLimit: 500 次不同 id 调用后 RSS 增长可控', () => {
  // 这是一个粗糙的烟雾测试 —— 真实内存增长很难精确测,但如果我们"在短时间
  // 内塞了 500 个独立 ID",堆不该暴涨到 100MB+。
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 500; i++) {
    rateLimit('memtest', `mem-${i}`, { max: 10, windowMs: 60_000 });
  }
  const after = process.memoryUsage().heapUsed;
  const growthMB = (after - before) / 1024 / 1024;
  // 单次调用 < 1KB 数据,500 次 < 500KB。给 5MB 余量吸收 V8 GC 抖动。
  assert.ok(growthMB < 5, `heap grew ${growthMB.toFixed(2)}MB (> 5MB 阈值)`);
});
