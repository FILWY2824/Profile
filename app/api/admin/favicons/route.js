import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth.js';
import { listCache, refreshAll, fetchAndCache, normalizeOrigin } from '@/lib/favicon.js';
import { db } from '@/lib/db.js';
import { activityLog } from '@/lib/fileStore.js';
import { getClientIp } from '@/lib/rateLimit.js';

/**
 * GET /api/admin/favicons
 * 返回所有缓存状态 + 目前站内卡片用到的所有 origin(即便还没抓过,也列出来以便主动抓)。
 */
export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const cached = listCache();
  const cachedMap = new Map(cached.map(c => [c.origin, c]));

  // 收集当前所有卡片的 origin,方便管理员看到"还没抓过"的条目
  const cards = db.findAll('cards');
  const originsFromCards = new Set();
  for (const c of cards) {
    const o = normalizeOrigin(c.url);
    if (o) originsFromCards.add(o);
  }

  // 合并列表
  const all = [];
  for (const [origin, row] of cachedMap) {
    all.push({
      origin,
      hasIcon: !!row.dataUrl,
      byteSize: row.byteSize || 0,
      contentType: row.contentType,
      source: row.source,
      fetchedAt: row.fetchedAt,
      failedAttempts: row.failedAttempts,
      lastError: row.lastError,
      inUse: originsFromCards.has(origin),
    });
  }
  // 还未缓存但卡片已引用的 origin
  for (const origin of originsFromCards) {
    if (!cachedMap.has(origin)) {
      all.push({
        origin, hasIcon: false, byteSize: 0, contentType: '',
        source: '', fetchedAt: null, failedAttempts: 0, lastError: '',
        inUse: true, uncached: true,
      });
    }
  }

  return NextResponse.json({ items: all });
}

/**
 * POST /api/admin/favicons
 * body = { action: 'refresh-all' }
 *      | { action: 'refresh', origin: 'https://...' }
 *      | { action: 'clear', origin: '...' }  // 删除缓存行,下次会重抓
 */
export async function POST(request) {
  const auth = await requireAdmin();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json();
    const action = body?.action;
    const ip = getClientIp(request);

    if (action === 'refresh-all') {
      const results = await refreshAll();
      activityLog.record({
        userId: auth.session.user.id,
        username: auth.session.user.name,
        email: auth.session.user.email,
        action: 'admin.favicon_refresh_all',
        detail: `刷新全部站点图标(${results.length} 条)`,
        ip,
      });
      return NextResponse.json({ success: true, results });
    }

    // 批量刷新选中 —— body.origins: string[]
    if (action === 'refresh-batch') {
      const raw = Array.isArray(body?.origins) ? body.origins : [];
      const origins = [...new Set(raw.map(o => normalizeOrigin(o)).filter(Boolean))];
      if (origins.length === 0) {
        return NextResponse.json({ error: '未提供有效的 origin' }, { status: 400 });
      }
      const results = [];
      // 串行:复用 refreshAll 的节流语义,避免对外站的瞬时并发风暴
      for (const origin of origins) {
        const out = await fetchAndCache(origin).catch(err => ({
          origin, ok: false, error: err.message,
        }));
        results.push({ origin, ok: out.ok, source: out.source, error: out.error });
      }
      const okCount = results.filter(r => r.ok).length;
      activityLog.record({
        userId: auth.session.user.id,
        username: auth.session.user.name,
        email: auth.session.user.email,
        action: 'admin.favicon_refresh_batch',
        detail: `批量刷新 ${origins.length} 个站点图标(${okCount} 成功)`,
        ip,
      });
      return NextResponse.json({ success: true, results });
    }

    if (action === 'refresh') {
      const origin = normalizeOrigin(body?.origin);
      if (!origin) return NextResponse.json({ error: '无效的 origin' }, { status: 400 });
      const out = await fetchAndCache(origin);
      activityLog.record({
        userId: auth.session.user.id,
        username: auth.session.user.name,
        email: auth.session.user.email,
        action: 'admin.favicon_refresh',
        detail: `刷新图标:${origin} — ${out.ok ? 'OK' : '失败'}`,
        ip,
      });
      return NextResponse.json({ success: true, result: out });
    }

    if (action === 'clear') {
      const origin = normalizeOrigin(body?.origin);
      if (!origin) return NextResponse.json({ error: '无效的 origin' }, { status: 400 });
      const { database } = await import('@/lib/database.js');
      database.prepare('DELETE FROM favicon_cache WHERE origin = ?').run(origin);
      activityLog.record({
        userId: auth.session.user.id,
        username: auth.session.user.name,
        email: auth.session.user.email,
        action: 'admin.favicon_clear',
        detail: `清除图标缓存:${origin}`,
        ip,
      });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: '未知 action' }, { status: 400 });
  } catch (err) {
    console.error('Favicon admin error:', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
