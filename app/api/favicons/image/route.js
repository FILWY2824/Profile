import { NextResponse } from 'next/server';
import { normalizeOrigin, readCache, decodeDataUrl, fetchAndCache, needsRefresh } from '@/lib/favicon.js';
import { db } from '@/lib/db.js';
import { getSession } from '@/lib/auth.js';

/**
 * GET /api/favicons/image?origin=https://example.com
 * 返回缓存中的 favicon 二进制。
 *
 * 【双重保护】
 * 1. DoS / SSRF 面 —— 只有当前 origin 被至少一张卡片引用,才允许走外网抓取。
 *    否则匿名请求就能把我们变成攻击者的出站代理(3 策略 × 8s = 单请求最多
 *    24s 的外发 fetch)。
 * 2. 权限泄露面(H2 修复) —— 即使 origin 被引用,也不能让当前会话无权访问
 *    的卡片的 favicon 被拉回来。否则攻击者通过 URL 枚举能驱动服务器去拉内网
 *    或管理员专用地址的图标,形成受限 SSRF 面。这里做的判定是:
 *      • 至少有一张引用该 origin 的卡片,对当前会话可访问 → 放行
 *      • 所有引用该 origin 的卡片都锁定 → 404
 *    "可访问"与首页 /api/homepage 的 annotate 保持同一套规则(public / user
 *    / member / admin)。
 *
 * 已缓存 + 对当前请求者有访问权限 → 直接返回(不再自动刷新,管理员手动触发)
 * 无缓存                         → 同步抓一次再返回(权限通过后才抓)
 * 曾经失败且冷却期已过             → 同步重试一次(权限通过后才抓)
 */
function cardAccessibleToSession(card, session) {
  const perm = card.permission || 'public';
  if (perm === 'public') return true;
  if (!session) return false;
  const role = session.user?.role || 'user';
  if (perm === 'user') return true; // 任意已登录用户
  if (perm === 'member') return role === 'member' || role === 'admin';
  if (perm === 'admin') return role === 'admin';
  return false;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const rawOrigin = searchParams.get('origin');
  const origin = normalizeOrigin(rawOrigin);
  if (!origin) {
    return NextResponse.json({ error: 'invalid origin' }, { status: 400 });
  }

  // 先找出所有引用该 origin 的卡片。这步不论缓存是否存在都要做 ——
  // 权限校验(H2)必须对"无缓存去抓"和"命中缓存直接回"同时生效,
  // 否则攻击者仍然能通过"先让管理员访问过、缓存已建立"的 origin
  // 拿到受限卡片的 favicon。
  const cards = db.findAll('cards');
  const refs = cards.filter(c => normalizeOrigin(c.url) === origin);

  if (refs.length === 0) {
    // DoS 防护:没人引用 → 直接 404,不走任何外网抓取
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const session = await getSession();
  const accessible = refs.some(c => cardAccessibleToSession(c, session));
  if (!accessible) {
    // 有人引用但当前会话都够不着 → 等同于不存在,不做外网抓取,
    // 也不返回任何能证明"这个 origin 在系统里"的信息。
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  let row = readCache(origin);

  // 没缓存 or 之前失败过且冷却结束 → 同步抓一次
  if (needsRefresh(origin)) {
    try {
      await fetchAndCache(origin);
      row = readCache(origin);
    } catch {
      // ignore; we'll fall through to 404 below
    }
  }

  const decoded = row ? decodeDataUrl(row.dataUrl) : null;
  if (!decoded) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  return new NextResponse(decoded.buffer, {
    status: 200,
    headers: {
      'Content-Type': decoded.contentType,
      // 浏览器端短期缓存 + 允许重验证;后端只在管理员触发时更新。
      // 注意这里必须是 private —— 不同会话看到的可用 origin 集合不同,
      // 共享缓存(CDN/代理)会导致跨会话 favicon 串流。
      'Cache-Control': 'private, max-age=3600, must-revalidate',
      'X-Favicon-Source': row.source || 'unknown',
      'X-Favicon-Fetched-At': row.fetchedAt || '',
    },
  });
}
