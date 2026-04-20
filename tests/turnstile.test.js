/**
 * turnstile.test.js
 *
 * 这个测试主要是防回归:Turnstile 在未启用时必须放行(ok: true),否则所有
 * 没装 Turnstile 的开发/自测环境都登录不了。
 *
 * 我们不给 settings 表植任何东西 —— 默认 TURNSTILE_ENABLED 为 '1' 但缺 key,
 * isTurnstileEnabled() 会因为 siteKey/secretKey 都是空串而返回 false,
 * verifyTurnstile 直接 ok:true 放行。
 *
 * 注意:lib/settings.js 会懒加载 SQLite。为了在测试环境不建真实 DB 文件,
 * 我们 mock 它 —— Node 自带的 module loader 不方便 mock,所以这里直接
 * 用"环境变量无效 + settings 未写入"的实际路径,让兜底逻辑走到 default 值。
 * data 目录会被 better-sqlite3 首次打开时创建;测试完手动清理一下即可。
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const TEST_DB_DIR = path.join(process.cwd(), 'data');
let createdDbDir = false;

before(() => {
  if (!fs.existsSync(TEST_DB_DIR)) {
    fs.mkdirSync(TEST_DB_DIR, { recursive: true });
    createdDbDir = true;
  }
});

after(() => {
  // 仅清理测试自己创建的,不碰既有的开发库
  if (createdDbDir) {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch {}
  }
});

test('turnstile: 未配置 site/secret 时 isTurnstileEnabled() 返回 false', async () => {
  const { isTurnstileEnabled } = await import('../lib/turnstile.js');
  // 哪怕 TURNSTILE_ENABLED 默认 '1',只要 siteKey 或 secretKey 没填,
  // 这个函数就必须判定为"未启用" —— 否则会硬性拒绝所有登录请求。
  assert.equal(isTurnstileEnabled(), false);
});

test('turnstile: verifyTurnstile 在未启用时直接放行', async () => {
  const { verifyTurnstile } = await import('../lib/turnstile.js');
  const result = await verifyTurnstile('', '127.0.0.1');
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
});
