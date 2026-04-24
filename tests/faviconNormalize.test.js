/**
 * faviconNormalize.test.js —— normalizeOrigin 边界用例
 *
 * 这个函数决定了"哪些卡片 URL 能够产生一个 favicon_cache 行",错了会:
 *   • 把站内路径当外链,发外网请求 SSRF 尝试
 *   • 把 http:// 内网当成合法 origin 存起来
 *   • 两个不同的 URL(带/不带默认端口)产生两个 origin,导致缓存重复
 *
 * lib/favicon.js 间接 import lib/database.js,加载时会开 SQLite,因此用
 * QISHU_DATA_DIR 隔离到临时目录。
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'qishu-favicon-test-'));
process.env.QISHU_DATA_DIR = TMP_DIR;

const { normalizeOrigin } = await import('../lib/favicon.js');

after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch {}
});

test('normalizeOrigin: 合法 http(s) 取 origin', () => {
  assert.equal(normalizeOrigin('https://example.com/path'), 'https://example.com');
  assert.equal(normalizeOrigin('https://example.com/'), 'https://example.com');
  assert.equal(normalizeOrigin('http://foo.bar/a/b?x=1#h'), 'http://foo.bar');
});

test('normalizeOrigin: 带端口', () => {
  assert.equal(normalizeOrigin('https://a.com:8443/path'), 'https://a.com:8443');
  // 443 是 https 默认端口,URL 规范会自动剥离
  assert.equal(normalizeOrigin('https://a.com:443/path'), 'https://a.com');
  assert.equal(normalizeOrigin('http://a.com:80/path'), 'http://a.com');
});

test('normalizeOrigin: 站内路径一律 null(不进 favicon 缓存)', () => {
  assert.equal(normalizeOrigin('/'), null);
  assert.equal(normalizeOrigin('/admin'), null);
  assert.equal(normalizeOrigin('/foo/bar'), null);
});

test('normalizeOrigin: 非 http(s) scheme 一律 null', () => {
  assert.equal(normalizeOrigin('ftp://example.com'), null);
  assert.equal(normalizeOrigin('javascript:alert(1)'), null);
  assert.equal(normalizeOrigin('data:image/png;base64,xxx'), null);
  assert.equal(normalizeOrigin('file:///etc/passwd'), null);
  assert.equal(normalizeOrigin('mailto:a@b.com'), null);
});

test('normalizeOrigin: 畸形输入 null', () => {
  assert.equal(normalizeOrigin(''), null);
  assert.equal(normalizeOrigin(null), null);
  assert.equal(normalizeOrigin(undefined), null);
  assert.equal(normalizeOrigin(42), null);
  assert.equal(normalizeOrigin('not-a-url'), null);
});

test('normalizeOrigin: 大小写规范化', () => {
  // WHATWG URL parser 会把 host 归一成小写
  assert.equal(normalizeOrigin('HTTPS://EXAMPLE.COM/PATH'), 'https://example.com');
});
