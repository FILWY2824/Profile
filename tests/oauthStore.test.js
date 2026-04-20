/**
 * oauthStore.test.js —— OAuth 核心路径端到端测试(#10)
 *
 * 覆盖范围:
 *   1. consumeCodeAndIssueTokens
 *        - 正常兑换 → 返回 ok + 插入 token 行
 *        - 同一 code 并发兑换 → 只有一方成功,另一方 CODE_ALREADY_USED
 *        - 错误 code → ok: false / CODE_ALREADY_USED
 *   2. rotateRefreshToken
 *        - 正常 rotate → 旧行 replaced=1, 新行 parentTokenId 指向旧行
 *        - 重放已 rotate 的 refresh_token → REUSE_DETECTED,链下所有未撤销 token
 *          被一次性全部撤销
 *        - 用已撤销的 refresh_token → NOT_FOUND
 *        - refreshTokenExpiresAt 过期 → NOT_FOUND
 *   3. findByRefreshToken 返回 revoked / replaced 字段(供 revoke 端点判断归属)
 *
 * 为什么不测 HTTP 端点:这里 DB 层单元粒度足以覆盖最容易出安全问题的逻辑;
 * HTTP 端的分支(redirect / JSON)大多是转发 DB 层返回值,不值得额外跑
 * Next.js 完整运行时。
 *
 * 隔离手段:通过 QISHU_DATA_DIR 环境变量指向 os.tmpdir 下的一次性目录,测试
 * 结束后清理。每个 test 文件开头都要在 import database 之前设置这个 env。
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 指向临时目录,必须在 import lib/database 之前设置
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'qishu-oauth-test-'));
process.env.QISHU_DATA_DIR = TMP_DIR;

// 动态 import,确保 env 先生效
const { oauthStore } = await import('../lib/fileStore.js');
const { database } = await import('../lib/database.js');

// 小工具:uuid 生成 token 字符串。不直接 import uuid 避免增加依赖表面。
function rand() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

before(() => {
  // 插一个假用户,让 userId 引用有落脚 —— oauth_tokens 虽然没有 FK 约束,但测试
  // 语义上保持一致,省得后续扩展 FK 时要回来改测试。
  database.prepare(
    `INSERT OR IGNORE INTO users (id,email,passwordHash,name,role,status,emailVerified,bio,avatar,createdAt,updatedAt)
     VALUES ('test-user', 'test@qishu.local', 'x', '测试', 'user', 'active', 1, '', '', ?, ?)`
  ).run(new Date().toISOString(), new Date().toISOString());
});

after(() => {
  // 关库并清理 tmp 目录
  try { database.raw.close(); } catch {}
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch {}
});

// ── consumeCodeAndIssueTokens ────────────────────────────────────────

test('consumeCodeAndIssueTokens: 正常兑换成功', () => {
  const code = rand();
  oauthStore.saveCode({
    code,
    clientId: 'test-client',
    userId: 'test-user',
    redirectUri: 'http://localhost:3000/cb',
    scope: 'openid profile',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });

  const result = oauthStore.consumeCodeAndIssueTokens({
    code,
    tokenData: {
      accessToken: 'at-' + rand(),
      refreshToken: 'rt-' + rand(),
      refreshTokenExpiresAt: new Date(Date.now() + 30 * 86400_000).toISOString(),
      clientId: 'test-client',
      userId: 'test-user',
      scope: 'openid profile',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    },
  });

  assert.equal(result.ok, true);
  assert.ok(result.id);

  // code 已经被标 used
  const codeRow = database.prepare('SELECT used FROM oauth_codes WHERE code = ?').get(code);
  assert.equal(codeRow.used, 1);
});

test('consumeCodeAndIssueTokens: 同一 code 第二次兑换失败', () => {
  const code = rand();
  oauthStore.saveCode({
    code,
    clientId: 'test-client', userId: 'test-user',
    redirectUri: 'http://localhost:3000/cb', scope: 'openid',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  const tokenData = (salt) => ({
    accessToken: 'at-' + salt, refreshToken: 'rt-' + salt,
    clientId: 'test-client', userId: 'test-user', scope: 'openid',
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  });

  const r1 = oauthStore.consumeCodeAndIssueTokens({ code, tokenData: tokenData('a') });
  const r2 = oauthStore.consumeCodeAndIssueTokens({ code, tokenData: tokenData('b') });

  assert.equal(r1.ok, true, '第一次应成功');
  assert.equal(r2.ok, false, '第二次应失败');
  assert.equal(r2.reason, 'CODE_ALREADY_USED');

  // 第二次不应该写入 token 行
  const count = database.prepare(
    `SELECT COUNT(*) AS n FROM oauth_tokens WHERE accessToken IN ('at-a', 'at-b')`
  ).get().n;
  assert.equal(count, 1, '只应有一行 token 落库');
});

test('consumeCodeAndIssueTokens: 不存在的 code 直接失败', () => {
  const result = oauthStore.consumeCodeAndIssueTokens({
    code: 'definitely-not-exist',
    tokenData: {
      accessToken: 'at-x', clientId: 'x', userId: 'test-user',
      scope: 'openid', expiresAt: new Date(Date.now() + 1000).toISOString(),
    },
  });
  assert.equal(result.ok, false);
});

// ── rotateRefreshToken ───────────────────────────────────────────────

function mintInitialToken() {
  const code = rand();
  const rt = 'rt-' + rand();
  const at = 'at-' + rand();
  oauthStore.saveCode({
    code, clientId: 'rot-client', userId: 'test-user',
    redirectUri: 'http://localhost:3000/cb', scope: 'openid profile',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  oauthStore.consumeCodeAndIssueTokens({
    code,
    tokenData: {
      accessToken: at, refreshToken: rt,
      refreshTokenExpiresAt: new Date(Date.now() + 30 * 86400_000).toISOString(),
      clientId: 'rot-client', userId: 'test-user', scope: 'openid profile',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    },
  });
  return { rt, at };
}

test('rotateRefreshToken: 正常 rotate → 旧行 replaced,新行 parent 指向旧行', () => {
  const { rt: oldRt } = mintInitialToken();

  const newRt = 'rt-' + rand();
  const newAt = 'at-' + rand();
  const result = oauthStore.rotateRefreshToken({
    oldRefreshToken: oldRt,
    newTokenData: {
      accessToken: newAt, refreshToken: newRt,
      refreshTokenExpiresAt: new Date(Date.now() + 30 * 86400_000).toISOString(),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.scope, 'openid profile', 'scope 应继承自旧 token');

  // 旧行 replaced=1, 新行 parentTokenId 指向旧行 id
  const oldRow = database.prepare('SELECT id, replaced FROM oauth_tokens WHERE refreshToken = ?').get(oldRt);
  const newRow = database.prepare('SELECT id, parentTokenId FROM oauth_tokens WHERE refreshToken = ?').get(newRt);
  assert.equal(oldRow.replaced, 1);
  assert.equal(newRow.parentTokenId, oldRow.id);
});

test('rotateRefreshToken: 重放已 rotate 的 refresh_token → REUSE_DETECTED,整条链撤销', () => {
  const { rt: rt0 } = mintInitialToken();
  // 合法轮换一次:rt0 → rt1
  const rt1 = 'rt-' + rand();
  oauthStore.rotateRefreshToken({
    oldRefreshToken: rt0,
    newTokenData: {
      accessToken: 'at-' + rand(), refreshToken: rt1,
      refreshTokenExpiresAt: new Date(Date.now() + 30 * 86400_000).toISOString(),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    },
  });

  // 再用 rt0(replaced 状态)发起 rotate → 应触发重放检测
  const result = oauthStore.rotateRefreshToken({
    oldRefreshToken: rt0,
    newTokenData: {
      accessToken: 'at-attacker', refreshToken: 'rt-attacker',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'REUSE_DETECTED');

  // 整条链(rot-client + test-user 下所有 token)都被撤销
  const rows = database.prepare(
    `SELECT revoked FROM oauth_tokens WHERE userId = 'test-user' AND clientId = 'rot-client'`
  ).all();
  for (const r of rows) {
    assert.equal(r.revoked, 1, '链上所有 token 都该被撤销');
  }
});

test('rotateRefreshToken: refreshTokenExpiresAt 过期 → NOT_FOUND', () => {
  // 直接插一条过期的 token 行,绕过 consumeCodeAndIssueTokens(它默认 30 天)
  const rt = 'rt-expired-' + rand();
  database.prepare(
    `INSERT INTO oauth_tokens
     (id, accessToken, refreshToken, refreshTokenExpiresAt, parentTokenId,
      clientId, userId, scope, expiresAt, revoked, revokedAt, replaced, createdAt)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, 0, NULL, 0, ?)`
  ).run(
    'row-' + rand(),
    'at-' + rand(), rt,
    new Date(Date.now() - 1000).toISOString(),  // refreshTokenExpiresAt 在过去
    'exp-client', 'test-user', 'openid',
    new Date(Date.now() + 1000).toISOString(),
    new Date().toISOString()
  );

  const result = oauthStore.rotateRefreshToken({
    oldRefreshToken: rt,
    newTokenData: {
      accessToken: 'at-' + rand(), refreshToken: 'rt-' + rand(),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'NOT_FOUND');
});

test('rotateRefreshToken: 已撤销的 token → NOT_FOUND', () => {
  const { rt } = mintInitialToken();
  oauthStore.revokeByRefreshToken(rt);

  const result = oauthStore.rotateRefreshToken({
    oldRefreshToken: rt,
    newTokenData: {
      accessToken: 'at-' + rand(), refreshToken: 'rt-' + rand(),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'NOT_FOUND');
});

test('rotateRefreshToken: scope 不允许通过 refresh 扩权', () => {
  const { rt: oldRt } = mintInitialToken();  // 原 scope = 'openid profile'

  const result = oauthStore.rotateRefreshToken({
    oldRefreshToken: oldRt,
    newTokenData: {
      accessToken: 'at-' + rand(), refreshToken: 'rt-' + rand(),
      scope: 'openid profile email qishu.role',   // 请求更大 scope
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    },
  });
  // 即使调用方传了更大 scope,返回的 scope 也应等于原 token 的
  assert.equal(result.ok, true);
  assert.equal(result.scope, 'openid profile');
});

// ── findByRefreshToken ──────────────────────────────────────────────

test('findByRefreshToken: 返回 replaced / revoked 状态位', () => {
  const { rt } = mintInitialToken();
  let record = oauthStore.findByRefreshToken(rt);
  assert.ok(record);
  assert.equal(record.replaced, false);
  assert.equal(record.revoked, false);

  // rotate 后,旧 refresh 查出来应 replaced=true
  oauthStore.rotateRefreshToken({
    oldRefreshToken: rt,
    newTokenData: {
      accessToken: 'at-' + rand(), refreshToken: 'rt-' + rand(),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    },
  });
  record = oauthStore.findByRefreshToken(rt);
  assert.equal(record.replaced, true);
});

test('findByRefreshToken: 不存在返回 null', () => {
  assert.equal(oauthStore.findByRefreshToken('definitely-does-not-exist'), null);
  assert.equal(oauthStore.findByRefreshToken(''), null);
  assert.equal(oauthStore.findByRefreshToken(null), null);
});
