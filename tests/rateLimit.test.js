/**
 * rateLimit.test.js —— 常量内存限流回归测试
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rateLimit, getClientIp } from '../lib/rateLimit.js';

test('rateLimit: 窗口内允许 max 次,之后拒绝', () => {
  const scope = `test-rl-basic-${Date.now()}`;
  const id = '1.2.3.4';
  const opts = { max: 3, windowMs: 60_000 };

  const r1 = rateLimit(scope, id, opts);
  const r2 = rateLimit(scope, id, opts);
  const r3 = rateLimit(scope, id, opts);
  const r4 = rateLimit(scope, id, opts);

  assert.equal(r1.allowed, true);
  assert.equal(r2.allowed, true);
  assert.equal(r3.allowed, true);
  assert.equal(r4.allowed, false, '第 4 次应当超限');
  assert.equal(r3.remaining, 0);
  assert.ok(r4.retryAfter >= 1, 'retryAfter 至少 1s');
});

test('rateLimit: 不同 id 互相隔离', () => {
  const scope = `test-rl-isolation-${Date.now()}`;
  const opts = { max: 1, windowMs: 60_000 };

  const a1 = rateLimit(scope, 'ip-a', opts);
  const b1 = rateLimit(scope, 'ip-b', opts);
  const a2 = rateLimit(scope, 'ip-a', opts);
  const b2 = rateLimit(scope, 'ip-b', opts);

  assert.equal(a1.allowed, true);
  assert.equal(b1.allowed, true, '不同 id 不应受 a 的消耗影响');
  assert.equal(a2.allowed, false);
  assert.equal(b2.allowed, false);
});

test('rateLimit: 不同 scope 互相隔离', () => {
  const scopeA = `test-rl-scope-a-${Date.now()}`;
  const scopeB = `test-rl-scope-b-${Date.now()}`;
  const id = 'same-ip';
  const opts = { max: 1, windowMs: 60_000 };

  const a1 = rateLimit(scopeA, id, opts);
  const b1 = rateLimit(scopeB, id, opts);

  assert.equal(a1.allowed, true);
  assert.equal(b1.allowed, true, '不同 scope 应当各自计数');
});

test('getClientIp: 优先 x-real-ip,其次 x-forwarded-for 中首个合法 IP', () => {
  const requestA = {
    headers: new Headers({
      'x-real-ip': '203.0.113.10',
      'x-forwarded-for': '198.51.100.3, 198.51.100.4',
    }),
  };
  assert.equal(getClientIp(requestA), '203.0.113.10');

  const requestB = {
    headers: new Headers({
      'x-forwarded-for': 'garbage, 198.51.100.4, 198.51.100.5',
    }),
  };
  assert.equal(getClientIp(requestB), '198.51.100.4');
});
