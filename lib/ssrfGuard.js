// ============================================================================
// 项目内路径: lib/ssrfGuard.js
// 文件名:     ssrfGuard.js
// 说明:       【新增文件】请在 lib/ 目录下新建此文件。
// ============================================================================

/**
 * lib/ssrfGuard.js — 出站请求 URL / 主机安全门
 * ---------------------------------------------------------------------------
 * 所有"对调用方传入的 URL 发起 socket"的代码必须先过这一层。
 * 背景:favicon 抓取、管理员手动刷新等路径会根据用户/管理员可控数据
 * 向外发请求;如果不校验,就等于把本服务变成可被驱动的出站代理,
 * 能被利用来打探 127.0.0.1:3000、云元数据 169.254.169.254、10/8 等内网。
 *
 * 做什么:
 *   1) 协议白名单:只允许 http/https(挡 file://、gopher://、dict:// 等)。
 *   2) 主机解析:所有 A/AAAA 记录都不得落在:
 *        • 127/8、::1            回环
 *        • 10/8、172.16/12、192.168/16   RFC1918 私网
 *        • 169.254/16、fe80::/10         链路本地(含云元数据)
 *        • fc00::/7                      IPv6 ULA
 *        • 0.0.0.0/8、::                 未指定
 *        • 100.64/10                     CGNAT
 *        • 224/4、240/4                  多播/保留
 *     以及特殊主机名:localhost、*.localhost、metadata、*.internal。
 *
 * 不做:
 *   • 不做业务层 allowlist —— 那是上层策略。本模块只拦"越界到本机/内网"。
 *   • 不做 DNS 重绑定(TOCTOU)的彻底防护 —— 完整防护要在拿到 socket 后再
 *     校验对端地址。这里先把主动攻击面收窄到"一次 DNS 解析即可拦截"的
 *     水平,已覆盖 99% 已知手法;TOCTOU 作为后续工作。
 * ---------------------------------------------------------------------------
 */

import { promises as dns } from 'dns';
import net from 'net';

// IPv4 段(base/prefix),内部表示成 32-bit 无符号整数再按 mask 比较。
const BLOCKED_V4_RANGES = [
  ['10.0.0.0',      8],
  ['172.16.0.0',   12],
  ['192.168.0.0',  16],
  ['127.0.0.0',     8],   // loopback
  ['169.254.0.0',  16],   // link-local + 云元数据 (AWS/GCP/Azure/Aliyun 等)
  ['0.0.0.0',       8],   // unspecified
  ['100.64.0.0',   10],   // CGNAT
  ['224.0.0.0',     4],   // multicast
  ['240.0.0.0',     4],   // reserved
];

function ipv4ToInt(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let acc = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n < 0 || n > 255) return null;
    acc = ((acc << 8) >>> 0) | n;
  }
  return acc >>> 0;
}

function v4InRange(ip, base, prefix) {
  const i = ipv4ToInt(ip);
  const b = ipv4ToInt(base);
  if (i === null || b === null) return false;
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (i & mask) === (b & mask);
}

/** 判断一个字面 IP 是否在"禁止出站"范围内。 */
export function isBlockedIp(ip) {
  if (!ip || typeof ip !== 'string') return true;
  const family = net.isIP(ip);
  if (family === 4) {
    return BLOCKED_V4_RANGES.some(([b, p]) => v4InRange(ip, b, p));
  }
  if (family === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true;      // loopback
    if (lower === '::') return true;                                      // unspecified
    if (/^fe[89ab][0-9a-f]?:/.test(lower)) return true;                   // fe80::/10 link-local
    if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true;                    // fc00::/7 ULA
    if (/^ff[0-9a-f]{2}:/.test(lower)) return true;                       // ff00::/8 multicast
    // v4-mapped ::ffff:a.b.c.d —— 挖出 v4 再校验,防止绕过
    const v4m = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (v4m) return isBlockedIp(v4m[1]);
    return false;
  }
  return true; // 不是合法 IP
}

/** 特殊主机名黑名单(不走 DNS 也要拦)。 */
function isBlockedHostname(host) {
  const h = host.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost')) return 'localhost';
  if (h === 'metadata' || h === 'metadata.google.internal') return 'metadata';
  if (h.endsWith('.internal')) return '.internal';
  return null;
}

/**
 * 对一个 URL 字符串做 SSRF 安全校验。通过后才能 fetch。
 * @returns {Promise<{ ok: true } | { ok: false, reason: string }>}
 */
export async function assertSafeExternalUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') {
    return { ok: false, reason: 'empty url' };
  }
  let u;
  try { u = new URL(urlStr); }
  catch { return { ok: false, reason: 'invalid url' }; }

  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, reason: `protocol ${u.protocol} not allowed` };
  }

  const host = u.hostname;
  if (!host) return { ok: false, reason: 'empty hostname' };

  // 字面 IP:不走 DNS
  if (net.isIP(host)) {
    if (isBlockedIp(host)) {
      return { ok: false, reason: `ip ${host} is in blocked range` };
    }
    return { ok: true };
  }

  const blockedName = isBlockedHostname(host);
  if (blockedName) {
    return { ok: false, reason: `hostname matches blocked pattern (${blockedName})` };
  }

  // 解析所有 A/AAAA 记录,任一落到禁区就拒
  let records;
  try {
    records = await dns.lookup(host, { all: true, verbatim: true });
  } catch (err) {
    return { ok: false, reason: `dns lookup failed: ${err.code || err.message}` };
  }
  if (!records.length) {
    return { ok: false, reason: 'dns returned no records' };
  }
  for (const { address } of records) {
    if (isBlockedIp(address)) {
      return { ok: false, reason: `host ${host} resolves to blocked address ${address}` };
    }
  }
  return { ok: true };
}

/**
 * 安全包装:校验 URL → 发起 fetch,并强制 redirect: 'manual'。
 * 外部 favicon / 图标抓取这类场景根本不需要跟重定向,302/301 既可能被
 * 攻击者用来跳到内网,也是 SSRF 绕过最常见的手法。调用方拿到非 2xx
 * 响应自己决定怎么处理。
 *
 * @param {string} urlStr  目标 URL
 * @param {RequestInit} init  传给 fetch 的参数;redirect 会被强制覆盖为 'manual'
 * @returns {Promise<Response>}  fetch 的原始 Response(未自动跟随重定向)
 * @throws {Error}  URL 未通过 SSRF 校验时抛出,message 带 reason
 */
export async function safeFetch(urlStr, init = {}) {
  const guard = await assertSafeExternalUrl(urlStr);
  if (!guard.ok) {
    const e = new Error(`ssrf guard blocked: ${guard.reason}`);
    e.code = 'SSRF_BLOCKED';
    throw e;
  }
  return fetch(urlStr, {
    ...init,
    redirect: 'manual',
  });
}