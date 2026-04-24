/**
 * ssrfGuard.test.js —— SSRF 守卫的 IP 判断回归
 *
 * 不测试 DNS 解析(依赖网络),只测试 isBlockedIp 对字面 IP 的判定。
 * URL 级别的 assertSafeExternalUrl 的 DNS 部分放到集成测试里更合适。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBlockedIp } from '../lib/ssrfGuard.js';

// ── 回环 ──────────────────────────────────────────────────────────────────

test('ssrf: 127/8 全拒', () => {
  assert.equal(isBlockedIp('127.0.0.1'), true);
  assert.equal(isBlockedIp('127.0.0.53'), true);    // systemd-resolved
  assert.equal(isBlockedIp('127.255.255.255'), true);
  // 边界外不该误伤
  assert.equal(isBlockedIp('128.0.0.1'), false);
});

test('ssrf: IPv6 回环', () => {
  assert.equal(isBlockedIp('::1'), true);
  assert.equal(isBlockedIp('0:0:0:0:0:0:0:1'), true);
});

// ── RFC1918 私网 ────────────────────────────────────────────────────────

test('ssrf: 10/8', () => {
  assert.equal(isBlockedIp('10.0.0.1'), true);
  assert.equal(isBlockedIp('10.255.255.254'), true);
  assert.equal(isBlockedIp('11.0.0.1'), false);
});

test('ssrf: 172.16/12', () => {
  assert.equal(isBlockedIp('172.16.0.1'), true);
  assert.equal(isBlockedIp('172.20.5.5'), true);
  assert.equal(isBlockedIp('172.31.255.254'), true);
  // 172.32 开始就不是私网了
  assert.equal(isBlockedIp('172.15.0.1'), false);
  assert.equal(isBlockedIp('172.32.0.1'), false);
});

test('ssrf: 192.168/16', () => {
  assert.equal(isBlockedIp('192.168.0.1'), true);
  assert.equal(isBlockedIp('192.168.255.254'), true);
  assert.equal(isBlockedIp('192.167.255.255'), false);
  assert.equal(isBlockedIp('192.169.0.1'), false);
});

// ── 云元数据(最关键的 SSRF 目标) ──────────────────────────────────────

test('ssrf: 169.254/16 链路本地 + 云元数据', () => {
  assert.equal(isBlockedIp('169.254.169.254'), true);   // AWS / Azure / GCP / Aliyun
  assert.equal(isBlockedIp('169.254.0.1'), true);
});

// ── 其他保留 / 异常 ────────────────────────────────────────────────────

test('ssrf: unspecified 与 CGNAT', () => {
  assert.equal(isBlockedIp('0.0.0.0'), true);
  assert.equal(isBlockedIp('100.64.0.1'), true);       // CGNAT
  assert.equal(isBlockedIp('100.127.255.254'), true);
  // 100.128+ 就不是 CGNAT 了
  assert.equal(isBlockedIp('100.128.0.1'), false);
});

test('ssrf: 多播 / 保留', () => {
  assert.equal(isBlockedIp('224.0.0.1'), true);
  assert.equal(isBlockedIp('239.255.255.254'), true);
  assert.equal(isBlockedIp('240.0.0.1'), true);
});

test('ssrf: IPv6 链路本地 fe80::/10', () => {
  assert.equal(isBlockedIp('fe80::1'), true);
  assert.equal(isBlockedIp('FE80::1'), true);
  assert.equal(isBlockedIp('fe80::abcd:1234'), true);
  // fec0 曾是 site-local(已废弃)不在我们的正则里,但 fc00::/7 ULA 覆盖了类似范围
});

test('ssrf: IPv6 ULA fc00::/7', () => {
  assert.equal(isBlockedIp('fc00::1'), true);
  assert.equal(isBlockedIp('fd12:3456:789a::1'), true);
  assert.equal(isBlockedIp('FD00::1'), true);
});

test('ssrf: IPv6 multicast ff00::/8', () => {
  assert.equal(isBlockedIp('ff02::1'), true);
  assert.equal(isBlockedIp('ff::1'), false);    // 只有一个 'f' 不匹配 /^ff[0-9a-f]{2}/
});

test('ssrf: IPv4-mapped IPv6 不给绕过', () => {
  // ::ffff:127.0.0.1 是 IPv4-mapped 形式,某些栈会把它当成合法 IPv6 连接到 127.0.0.1
  assert.equal(isBlockedIp('::ffff:127.0.0.1'), true);
  assert.equal(isBlockedIp('::ffff:10.0.0.1'), true);
  assert.equal(isBlockedIp('::ffff:169.254.169.254'), true);
  assert.equal(isBlockedIp('::FFFF:127.0.0.1'), true);
});

test('ssrf: 公网合法 IP 不误伤', () => {
  assert.equal(isBlockedIp('8.8.8.8'), false);
  assert.equal(isBlockedIp('1.1.1.1'), false);
  assert.equal(isBlockedIp('104.16.0.1'), false);   // Cloudflare
  assert.equal(isBlockedIp('2606:4700::1'), false); // Cloudflare IPv6
});

test('ssrf: 畸形输入', () => {
  assert.equal(isBlockedIp(''), true);
  assert.equal(isBlockedIp(null), true);
  assert.equal(isBlockedIp(undefined), true);
  assert.equal(isBlockedIp('not-an-ip'), true);
  assert.equal(isBlockedIp('999.999.999.999'), true);
  assert.equal(isBlockedIp('256.1.1.1'), true);
  assert.equal(isBlockedIp('127.0.0.1.5'), true);       // 五段
  assert.equal(isBlockedIp('127.0.0'), true);           // 三段
});
