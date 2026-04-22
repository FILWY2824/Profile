// ============================================================================
// 项目内路径: lib/favicon.js
// 文件名:     favicon.js
// 说明:       【覆盖文件】请替换现有的 lib/favicon.js。
// ============================================================================

/**
 * lib/favicon.js — 网站图标抓取与缓存
 * ---------------------------------------------------------------------------
 * 目标:
 *   • 卡片首次被展示时,同步抓取一次 favicon 并落库
 *   • 之后前台永远直接读缓存,不再后台自动刷新(避免定时器 / 请求风暴 /
 *     内存泄漏等问题)
 *   • 管理员可以在 /admin/favicons 手动刷新单条、批量刷新,或清除缓存让
 *     下次访问时重抓
 *
 * 抓取策略(逐项尝试,任意一项成功就停):
 *   1) 访问 ${origin}/favicon.ico
 *   2) 解析 ${origin}/ 的 HTML <link rel="icon"> 并抓这个 href
 *   3) 回落到 Google s2 favicon 服务(几乎总能拿到一个东西,质量次一等)
 *
 * 存储:base64 data URL,直接存在 SQLite 文本列里。单条 16KB 封顶,
 * 真实 favicon 通常 2~8KB,大小可控。
 *
 * 并发:对同一 origin 同时多次调用 fetchAndCache 会去重成一次实际 HTTP,
 * 由 inflight Map 实现。
 * ---------------------------------------------------------------------------
 */
import { database } from './database.js';
import { safeFetch } from './ssrfGuard.js';

// 同一 origin 进行中的抓取,防并发重复
const inflight = new Map();

// 单条 favicon 大小上限 —— 超过就拒收,避免把奇怪的资源塞进 DB
const MAX_SIZE = 64 * 1024;

// 抓取 HTTP 请求的整体超时
const FETCH_TIMEOUT_MS = 8_000;

/**
 * 从 URL 字符串提取规范化 origin。非法或站内链接返回 null。
 */
export function normalizeOrigin(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return null;
  if (urlStr.startsWith('/')) return null;
  try {
    const u = new URL(urlStr);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.origin;
  } catch { return null; }
}

/** 仅读缓存;不触发抓取。返回完整行或 null。 */
export function readCache(origin) {
  if (!origin) return null;
  const row = database.prepare(
    `SELECT * FROM favicon_cache WHERE origin = ? LIMIT 1`
  ).get(origin);
  return row || null;
}

/** 列出所有已知 origin 的缓存状态(用于管理页面)。 */
export function listCache() {
  return database.prepare(
    `SELECT origin, contentType, source, fetchedAt, failedAttempts, lastError,
            length(dataUrl) AS byteSize
     FROM favicon_cache
     ORDER BY fetchedAt DESC`
  ).all();
}

/**
 * 删除单个 origin 的缓存行(M5)。
 *
 * 卡片被删除、或它的 URL 被改到另一个域名时,旧的 favicon_cache 行就变成孤儿。
 * 孤儿本身不影响功能,但会让 DB 体积随着时间缓慢膨胀,也会在 /admin/favicons
 * 页面留下一堆"没人用"的条目,迷惑管理员。
 *
 * 调用点:
 *   • app/api/admin/cards/[id]/route.js 的 DELETE —— 卡被删后
 *   • app/api/admin/cards/[id]/route.js 的 PATCH —— url 改变后(旧 origin 如果
 *     不再被任何卡片引用就清)
 *   • lib/fileStore.js 的 autoPrune 定时器 —— 兜底清理任何漏网之鱼
 */
export function deleteCache(origin) {
  if (!origin) return 0;
  const info = database.prepare(
    `DELETE FROM favicon_cache WHERE origin = ?`
  ).run(origin);
  return info.changes;
}

/**
 * 找出并清理所有孤儿缓存(没有任何 cards 行引用的 origin)。
 * 返回被删除的 origin 列表,便于审计日志回显。
 *
 * 实现方式:一条 NOT EXISTS 子查询,避免把两张表全部拉到 JS 里做集合差集。
 * favicon_cache 与 cards 表都是小表(通常 < 100 行),这条 SQL 成本可忽略。
 */
export function pruneOrphans() {
  // 先用 JS 判断,比子查询里调用 normalizeOrigin 要方便 —— cards.url 可能是
  // 站内路径(/xxx)也可能是外链,必须过一遍 normalizeOrigin 才能跟 favicon_cache
  // 的 origin 对齐。
  const cardOrigins = new Set();
  const cards = database.prepare('SELECT url FROM cards').all();
  for (const c of cards) {
    const o = normalizeOrigin(c.url);
    if (o) cardOrigins.add(o);
  }
  const cacheRows = database.prepare('SELECT origin FROM favicon_cache').all();
  const orphans = cacheRows
    .map(r => r.origin)
    .filter(o => !cardOrigins.has(o));
  if (orphans.length === 0) return { deleted: 0, origins: [] };

  const del = database.prepare('DELETE FROM favicon_cache WHERE origin = ?');
  const txn = database.transaction(() => {
    for (const o of orphans) del.run(o);
  });
  txn();
  return { deleted: orphans.length, origins: orphans };
}

/**
 * 判断某 origin 的缓存是否需要抓取。
 *
 * 【注:已移除自动刷新逻辑】
 * 之前这里有"缓存年龄超过 N 天就后台重抓"的策略,会在每次 GET /api/favicons/image
 * 时触发 fire-and-forget fetch,有潜在的请求堆积 / 内存泄漏风险。现在:
 *   • 从未抓过 → true(同步抓一次,首次访问会短暂等待)
 *   • 抓过但为空(上次失败)且失败计数 ≥ 3 → 冷却 24 小时后允许再试一次
 *   • 其他情况 → false(永远读旧缓存,管理员手动刷新才会更新)
 */
export function needsRefresh(origin) {
  const row = readCache(origin);
  if (!row) return true;
  // 之前失败过太多次且目前没有有效缓存 → 冷却一段时间后自动重试一次
  if (!row.dataUrl && row.failedAttempts >= 3) {
    const since = Date.now() - new Date(row.fetchedAt).getTime();
    return since > 24 * 3600_000;
  }
  return false;
}

/**
 * @deprecated 已废弃。保留名称仅为避免导入处报错;调用不会做任何事。
 * 历史上它会在缓存过期时 fire-and-forget 抓一次,这个行为现在完全由管理员
 * 手动触发(/admin/favicons)。
 */
export function maybeRefreshInBackground(_origin) {
  /* no-op */
}

/**
 * 带 SSRF 守卫 + 超时 的抓取。
 *
 * 相比原实现的关键变化:
 *   1) 全部走 safeFetch —— URL 先过 ssrfGuard.assertSafeExternalUrl:
 *      协议必须是 http(s);主机 DNS 解析结果中不得包含 127/8、
 *      169.254/16(云元数据)、10/8、172.16/12、192.168/16、::1、fe80::
 *      等任何可达内网/本机的地址。
 *   2) redirect: 'manual' —— 不自动跟随重定向。外站可以把 Location 指向
 *      http://127.0.0.1:3000 或 169.254.169.254,这是 SSRF 最常见的绕过路径。
 *      favicon 这种资源没有正当跨站跳转需求,3xx 一律当失败处理。
 *      (公网上极少数站点把 favicon.ico 放到 CDN 并用 301 跳转 —— 这种情况
 *       仍可通过 HTML <link rel="icon"> 策略拿到,不影响覆盖率。)
 *   3) 如需跨 host 获取(HTML 里抽到的 href 可能指向别的域),由调用处
 *      再次以完整 URL 走 safeFetch,每一跳都独立过 SSRF 守卫。
 */
async function doFetchWithTimeout(url, opts = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await safeFetch(url, {
      ...opts,
      signal: controller.signal,
      cache: 'no-store',
      headers: {
        'User-Agent': 'QishuProfile/1.0 (+favicon-fetcher)',
        'Accept': 'image/*, text/html;q=0.5, */*;q=0.1',
        ...(opts.headers || {}),
      },
    });
    // 对 3xx(跟随被禁用):读掉 body 防 socket 泄漏,然后照常返回。
    // 调用方用 res.ok 过滤,不会误用到重定向 body。
    if (res.status >= 300 && res.status < 400) {
      try { await res.arrayBuffer(); } catch {}
    }
    return res;
  } finally {
    clearTimeout(t);
  }
}

/** 把 Response 的二进制体转成 data URL。超过 MAX_SIZE 返回 null。 */
async function responseToDataUrl(res) {
  const contentType = res.headers.get('content-type') || 'image/x-icon';
  if (!/^image\//i.test(contentType)) return null;
  const ab = await res.arrayBuffer();
  if (ab.byteLength === 0 || ab.byteLength > MAX_SIZE) return null;
  const b64 = Buffer.from(ab).toString('base64');
  // 只保留 content-type 的主体,去除 charset 等参数
  const cleanType = contentType.split(';')[0].trim();
  return { dataUrl: `data:${cleanType};base64,${b64}`, contentType: cleanType, size: ab.byteLength };
}

async function tryDirectIco(origin) {
  try {
    const res = await doFetchWithTimeout(`${origin}/favicon.ico`);
    if (!res.ok) return null;
    return await responseToDataUrl(res);
  } catch { return null; }
}

/** 从首页 HTML 里解析 <link rel="icon"> 的 href */
function pickIconHref(html) {
  if (!html) return null;
  // 匹配 <link rel="...icon..." href="...">,大小写与属性顺序不敏感
  const re = /<link\s+[^>]*rel=["']([^"']*)["'][^>]*href=["']([^"']+)["']/gi;
  const re2 = /<link\s+[^>]*href=["']([^"']+)["'][^>]*rel=["']([^"']*)["']/gi;
  const candidates = [];
  let m;
  while ((m = re.exec(html))) {
    if (/icon/i.test(m[1])) candidates.push({ rel: m[1], href: m[2] });
  }
  while ((m = re2.exec(html))) {
    if (/icon/i.test(m[2])) candidates.push({ rel: m[2], href: m[1] });
  }
  if (!candidates.length) return null;
  // 偏好 apple-touch-icon(通常更大更清晰)> shortcut icon > icon
  candidates.sort((a, b) => score(b.rel) - score(a.rel));
  return candidates[0].href;
}
function score(rel) {
  const r = rel.toLowerCase();
  if (r.includes('apple')) return 3;
  if (r.includes('shortcut')) return 2;
  return 1;
}

async function tryParseHtml(origin) {
  try {
    const res = await doFetchWithTimeout(origin, { headers: { 'Accept': 'text/html' } });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!/html/i.test(ct)) return null;
    // 只读前 64KB,够解析 <head> 了
    const reader = res.body?.getReader?.();
    if (!reader) {
      const html = await res.text();
      const href = pickIconHref(html.slice(0, 64 * 1024));
      if (!href) return null;
      // 关键:href 可能是绝对 URL 指向任意 host(含内网 / 本机 / 云元数据)。
      // doFetchWithTimeout 会再次走 SSRF 守卫,非法目标会抛 SSRF_BLOCKED
      // 被外层 catch 吃掉,该策略返回 null,不会影响其他策略。
      const abs = new URL(href, origin).toString();
      const iconRes = await doFetchWithTimeout(abs);
      if (!iconRes.ok) return null;
      return await responseToDataUrl(iconRes);
    }
    // 流式读头部
    const decoder = new TextDecoder();
    let buf = '';
    while (buf.length < 64 * 1024) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
    }
    try { reader.cancel(); } catch {}
    const href = pickIconHref(buf);
    if (!href) return null;
    // 同上:第二跳也要过 SSRF 守卫。
    const abs = new URL(href, origin).toString();
    const iconRes = await doFetchWithTimeout(abs);
    if (!iconRes.ok) return null;
    return await responseToDataUrl(iconRes);
  } catch { return null; }
}

async function tryGoogleS2(origin) {
  try {
    const url = `https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(origin)}`;
    const res = await doFetchWithTimeout(url);
    if (!res.ok) return null;
    return await responseToDataUrl(res);
  } catch { return null; }
}

/**
 * 真正的抓取+存储。同 origin 并发调用会去重。
 * 抓到 → 更新 dataUrl + 清零 failedAttempts;
 * 全部策略都失败 → failedAttempts +1,保留旧值(如果有)。
 */
export async function fetchAndCache(origin) {
  if (!origin) throw new Error('origin required');
  if (inflight.has(origin)) return inflight.get(origin);

  const promise = (async () => {
    const strategies = [
      ['direct-ico', () => tryDirectIco(origin)],
      ['html-parse', () => tryParseHtml(origin)],
      ['google-s2',  () => tryGoogleS2(origin)],
    ];
    let got = null;
    let source = '';
    let lastError = '';
    for (const [name, fn] of strategies) {
      try {
        const out = await fn();
        if (out) { got = out; source = name; break; }
      } catch (e) {
        lastError = `${name}: ${e.message}`;
      }
    }
    const now = new Date().toISOString();
    if (got) {
      database.prepare(
        `INSERT INTO favicon_cache (origin, dataUrl, contentType, source, fetchedAt, failedAttempts, lastError)
         VALUES (?, ?, ?, ?, ?, 0, '')
         ON CONFLICT(origin) DO UPDATE SET
           dataUrl = excluded.dataUrl,
           contentType = excluded.contentType,
           source = excluded.source,
           fetchedAt = excluded.fetchedAt,
           failedAttempts = 0,
           lastError = ''`
      ).run(origin, got.dataUrl, got.contentType, source, now);
      return { origin, ...got, source, ok: true };
    } else {
      // 失败也要写一行(只用于计数冷却);保留旧 dataUrl
      const existing = readCache(origin);
      if (existing) {
        database.prepare(
          `UPDATE favicon_cache SET failedAttempts = failedAttempts + 1, lastError = ?, fetchedAt = ?
           WHERE origin = ?`
        ).run(lastError || 'all strategies failed', now, origin);
      } else {
        database.prepare(
          `INSERT INTO favicon_cache (origin, dataUrl, contentType, source, fetchedAt, failedAttempts, lastError)
           VALUES (?, '', '', '', ?, 1, ?)`
        ).run(origin, now, lastError || 'all strategies failed');
      }
      return { origin, ok: false, error: lastError || 'all strategies failed' };
    }
  })();

  inflight.set(origin, promise);
  try { return await promise; }
  finally { inflight.delete(origin); }
}

/** 把一个 data URL 解回二进制 + MIME 类型,供路由直接写 response 用。 */
export function decodeDataUrl(dataUrl) {
  if (!dataUrl || !dataUrl.startsWith('data:')) return null;
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  const [, type, b64] = m;
  try {
    return { buffer: Buffer.from(b64, 'base64'), contentType: type };
  } catch { return null; }
}

/** 管理员"立即刷新全部" */
export async function refreshAll() {
  const rows = database.prepare('SELECT origin FROM favicon_cache').all();
  const results = [];
  // 串行执行,避免一次对 20 个外站发请求;串行时每个策略也有 8s 超时兜底
  for (const r of rows) {
    const out = await fetchAndCache(r.origin).catch(err => ({ origin: r.origin, ok: false, error: err.message }));
    results.push({ origin: r.origin, ok: out.ok, source: out.source });
  }
  return results;
}

/**
 * @deprecated 已废弃 —— 现在只在前台首次访问时按需抓取单条。保留签名以避免
 * 未清理的 import 报错。如需批量预热请走 /admin/favicons 的"立即刷新全部"。
 */
export function ensureOriginsForCards(_cards) {
  /* no-op */
}