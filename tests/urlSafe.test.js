/**
 * urlSafe.test.js —— href={...} 与 src={...} 的 URL scheme 守卫
 *
 * 覆盖 OWASP XSS Cheat Sheet 里的 URL 上下文攻击向量 —— 这些用例都是真实场景
 * 曾经绕过过 `/^https?:\/\//` 这类简陋正则。引入新字段前先把它加到这里,能
 * 确保靠前端拿 href 的地方不会被反穿。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSafeHttpUrl, sanitizeHttpUrlOrEmpty, isSafeCardUrl } from '../lib/urlSafe.js';

// ── isSafeHttpUrl ────────────────────────────────────────────────────────

test('isSafeHttpUrl: 合法 http(s) 通过', () => {
  assert.equal(isSafeHttpUrl('http://example.com'), true);
  assert.equal(isSafeHttpUrl('https://example.com'), true);
  assert.equal(isSafeHttpUrl('https://example.com/path?a=1#frag'), true);
  assert.equal(isSafeHttpUrl('https://sub.example.com:8443/deep/path'), true);
  // URL 构造器容忍前后空白,我们 trim 后再判断
  assert.equal(isSafeHttpUrl('  https://example.com  '), true);
});

test('isSafeHttpUrl: javascript: 系列一律拒绝', () => {
  assert.equal(isSafeHttpUrl('javascript:alert(1)'), false);
  assert.equal(isSafeHttpUrl('JAVASCRIPT:alert(1)'), false);
  assert.equal(isSafeHttpUrl('JavaScript:void(0)'), false);
  assert.equal(isSafeHttpUrl('  javascript:alert(1)'), false);
});

test('isSafeHttpUrl: 控制字符混淆 javascript: 被拒', () => {
  // 历史上 Chrome/Safari 曾对 \n、\t 混入 scheme 的 URL 容忍,导致
  // "java\nscript:" 被解析为 javascript:。我们在 new URL() 之前显式拒控制字符。
  assert.equal(isSafeHttpUrl('java\nscript:alert(1)'), false);
  assert.equal(isSafeHttpUrl('java\tscript:alert(1)'), false);
  assert.equal(isSafeHttpUrl('java\rscript:alert(1)'), false);
  // NULL 字节
  assert.equal(isSafeHttpUrl('https://example.com/\u0000'), false);
});

test('isSafeHttpUrl: 其他危险 scheme', () => {
  assert.equal(isSafeHttpUrl('data:text/html,<script>alert(1)</script>'), false);
  assert.equal(isSafeHttpUrl('vbscript:msgbox("x")'), false);
  assert.equal(isSafeHttpUrl('file:///etc/passwd'), false);
  assert.equal(isSafeHttpUrl('blob:https://example.com/xxx'), false);
  assert.equal(isSafeHttpUrl('ftp://example.com/a'), false);
  assert.equal(isSafeHttpUrl('chrome://settings'), false);
  assert.equal(isSafeHttpUrl('mailto:a@b.com'), false);
});

test('isSafeHttpUrl: 畸形输入', () => {
  assert.equal(isSafeHttpUrl(''), false);
  assert.equal(isSafeHttpUrl('   '), false);
  assert.equal(isSafeHttpUrl(null), false);
  assert.equal(isSafeHttpUrl(undefined), false);
  assert.equal(isSafeHttpUrl(42), false);
  assert.equal(isSafeHttpUrl({}), false);
  assert.equal(isSafeHttpUrl('not a url'), false);
  assert.equal(isSafeHttpUrl('example.com'), false); // 无 scheme
  assert.equal(isSafeHttpUrl('//example.com'), false); // protocol-relative
});

// ── sanitizeHttpUrlOrEmpty ──────────────────────────────────────────────

test('sanitizeHttpUrlOrEmpty: 合法 → trim 后返回,否则空串', () => {
  assert.equal(sanitizeHttpUrlOrEmpty('  https://x.com/a '), 'https://x.com/a');
  assert.equal(sanitizeHttpUrlOrEmpty('http://x.com'), 'http://x.com');
  assert.equal(sanitizeHttpUrlOrEmpty('javascript:alert(1)'), '');
  assert.equal(sanitizeHttpUrlOrEmpty(''), '');
  assert.equal(sanitizeHttpUrlOrEmpty(null), '');
  assert.equal(sanitizeHttpUrlOrEmpty(undefined), '');
  assert.equal(sanitizeHttpUrlOrEmpty(12345), '');
});

// ── isSafeCardUrl ───────────────────────────────────────────────────────

test('isSafeCardUrl: 站内路径', () => {
  assert.equal(isSafeCardUrl('/'), true);
  assert.equal(isSafeCardUrl('/admin'), true);
  assert.equal(isSafeCardUrl('/a/b/c'), true);
  assert.equal(isSafeCardUrl('/page?q=1&x=2'), true);
  assert.equal(isSafeCardUrl('/#hash'), true);
});

test('isSafeCardUrl: protocol-relative 和反斜杠被拒', () => {
  // //attacker.com 会被浏览器按当前协议拼,拐到外站 —— 这类 URL 一定不能算"站内"
  assert.equal(isSafeCardUrl('//attacker.com'), false);
  assert.equal(isSafeCardUrl('//attacker.com/path'), false);
  // 反斜杠在某些浏览器里和 / 同义,/\\attacker.com 有越权风险
  assert.equal(isSafeCardUrl('/\\attacker.com'), false);
  assert.equal(isSafeCardUrl('\\\\attacker.com'), false);
});

test('isSafeCardUrl: http(s) 绝对 URL 允许', () => {
  assert.equal(isSafeCardUrl('https://example.com'), true);
  assert.equal(isSafeCardUrl('http://example.com'), true);
});

test('isSafeCardUrl: 其他 scheme 一律拒', () => {
  assert.equal(isSafeCardUrl('javascript:alert(1)'), false);
  assert.equal(isSafeCardUrl('data:text/html,x'), false);
  assert.equal(isSafeCardUrl('vbscript:x'), false);
  assert.equal(isSafeCardUrl('ftp://x.com'), false);
});

test('isSafeCardUrl: 畸形输入', () => {
  assert.equal(isSafeCardUrl(''), false);
  assert.equal(isSafeCardUrl(null), false);
  assert.equal(isSafeCardUrl(undefined), false);
  assert.equal(isSafeCardUrl(42), false);
  assert.equal(isSafeCardUrl('   '), false);
  assert.equal(isSafeCardUrl('/path\u0000'), false); // NULL 字节
});
