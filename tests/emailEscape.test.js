/**
 * emailEscape.test.js —— 邮件 HTML 转义回归(H6)
 *
 * lib/email.js 依赖 lib/settings.js,后者间接依赖 lib/database.js —— 模块
 * 加载时会尝试打开 SQLite。为了让测试独立运行,我们先把 QISHU_DATA_DIR 指
 * 到临时目录,再动态 import(与 oauthStore.test.js 同样的模式)。
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 必须在 import lib/email 之前设置
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'qishu-email-test-'));
process.env.QISHU_DATA_DIR = TMP_DIR;

const { escapeHtml } = await import('../lib/email.js');

after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch {}
});

test('escapeHtml: 五字符转义', () => {
  assert.equal(escapeHtml('<script>'), '&lt;script&gt;');
  assert.equal(escapeHtml('"hello"'), '&quot;hello&quot;');
  assert.equal(escapeHtml("it's"), 'it&#39;s');
  assert.equal(escapeHtml('a&b'), 'a&amp;b');
});

test('escapeHtml: & 先行替换,不会双重 encode', () => {
  // 如果把 & 替换顺序放错了,`&lt;` 会变成 `&amp;lt;`
  assert.equal(escapeHtml('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
});

test('escapeHtml: 空值安全', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(''), '');
});

test('escapeHtml: 非字符串值走 String()', () => {
  assert.equal(escapeHtml(42), '42');
  assert.equal(escapeHtml(true), 'true');
});

test('escapeHtml: 常见 XSS payload 被完全中和', () => {
  const payloads = [
    '<img src=x onerror=alert(1)>',
    '" onmouseover="alert(1)',
    `'><script>alert(1)</script>`,
    '<svg/onload=alert(1)>',
  ];
  for (const p of payloads) {
    const escaped = escapeHtml(p);
    // 不得保留任何尖括号或裸引号
    assert.ok(!/[<>]/.test(escaped), `payload still contains <> after escape: ${escaped}`);
    assert.ok(!/["']/.test(escaped), `payload still contains quotes after escape: ${escaped}`);
  }
});
