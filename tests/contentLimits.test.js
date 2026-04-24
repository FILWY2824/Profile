/**
 * contentLimits.test.js —— 管理员内容字段长度上限回归
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateContentField, CONTENT_LIMITS } from '../lib/contentLimits.js';

test('title: 必填,1–64', () => {
  assert.equal(validateContentField('title', '').valid, false);
  assert.equal(validateContentField('title', '   ').valid, false);
  assert.equal(validateContentField('title', '卡').valid, true);
  assert.equal(validateContentField('title', 'a'.repeat(64)).valid, true);
  assert.equal(validateContentField('title', 'a'.repeat(65)).valid, false);
  // trim
  assert.equal(validateContentField('title', '  卡  ').value, '卡');
});

test('name: 同 title 规则', () => {
  assert.equal(validateContentField('name', '').valid, false);
  assert.equal(validateContentField('name', 'X').valid, true);
  assert.equal(validateContentField('name', 'a'.repeat(64)).valid, true);
  assert.equal(validateContentField('name', 'a'.repeat(65)).valid, false);
});

test('slug: 必填,正则 ^[a-z0-9-]+$', () => {
  assert.equal(validateContentField('slug', 'foo-bar').valid, true);
  assert.equal(validateContentField('slug', 'abc123').valid, true);
  assert.equal(validateContentField('slug', '').valid, false);
  assert.equal(validateContentField('slug', 'Foo').valid, false);       // 大写
  assert.equal(validateContentField('slug', 'foo_bar').valid, false);    // 下划线
  assert.equal(validateContentField('slug', 'foo bar').valid, false);    // 空格
  assert.equal(validateContentField('slug', 'a'.repeat(41)).valid, false);
});

test('description: 可空,0–500', () => {
  assert.equal(validateContentField('description', '').valid, true);
  assert.equal(validateContentField('description', '').value, '');
  assert.equal(validateContentField('description', '正文').valid, true);
  assert.equal(validateContentField('description', 'a'.repeat(500)).valid, true);
  assert.equal(validateContentField('description', 'a'.repeat(501)).valid, false);
  // null → 空
  assert.equal(validateContentField('description', null).valid, true);
  assert.equal(validateContentField('description', null).value, '');
});

test('bio: 可空,0–200', () => {
  assert.equal(validateContentField('bio', '').valid, true);
  assert.equal(validateContentField('bio', 'hi').valid, true);
  assert.equal(validateContentField('bio', 'a'.repeat(200)).valid, true);
  assert.equal(validateContentField('bio', 'a'.repeat(201)).valid, false);
});

test('url: 必填,1–2000(仅长度,scheme 由 urlSafe 另外校验)', () => {
  assert.equal(validateContentField('url', '').valid, false);
  assert.equal(validateContentField('url', '/').valid, true);
  assert.equal(validateContentField('url', 'https://example.com').valid, true);
  assert.equal(validateContentField('url', 'https://a.com/' + 'x'.repeat(1984)).valid, true);
  assert.equal(validateContentField('url', 'https://a.com/' + 'x'.repeat(2000)).valid, false);
});

test('未知字段类型:返回错误而不是 throw', () => {
  const r = validateContentField('whatever', 'x');
  assert.equal(r.valid, false);
  assert.match(r.message, /未知字段类型/);
});

test('非字符串输入:明确拒绝', () => {
  assert.equal(validateContentField('title', 42).valid, false);
  assert.equal(validateContentField('title', {}).valid, false);
  assert.equal(validateContentField('title', []).valid, false);
});

test('CONTENT_LIMITS 常量暴露,值与实现一致', () => {
  assert.equal(CONTENT_LIMITS.title.max, 64);
  assert.equal(CONTENT_LIMITS.bio.max, 200);
  assert.equal(CONTENT_LIMITS.description.max, 500);
  assert.equal(CONTENT_LIMITS.url.max, 2000);
  // Object.freeze 防意外写入(严格模式下 throw,非严格静默忽略 —— 我们
  // 这里只确认结构存在,不测 throw)
  assert.ok(Object.isFrozen(CONTENT_LIMITS));
});
