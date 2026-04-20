import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth.js';
import { db } from '@/lib/db.js';
import { activityLog } from '@/lib/fileStore.js';
import { normalizeOrigin, deleteCache as deleteFaviconCache } from '@/lib/favicon.js';

const VALID_PERMISSIONS = ['public', 'user', 'member', 'admin'];

function validateUrl(url) {
  if (!url) return { valid: false, message: 'URL 不能为空' };
  if (url.startsWith('/')) return { valid: true };
  if (/^https?:\/\/.+/.test(url)) return { valid: true };
  return { valid: false, message: 'URL 必须是站内路由(/开头)或 http/https 外链' };
}

/**
 * 当一张卡片的 url 发生变化(PATCH)或被删除(DELETE)时,检查它的旧 origin
 * 是不是还被其他卡片引用;不是的话就清掉对应的 favicon_cache 行。
 *
 * 为什么在业务路由里做:审查报告里点名 M5 —— favicon_cache 不会自动清理孤儿。
 * 可以在 fileStore 的 autoPrune 定时器里兜底,但那个是 24 小时跑一次,在"管
 * 理员刚改完 URL 立刻回 /admin/favicons 看"的场景下会看到旧条目。这里在业务
 * 操作点顺手清一下,体感好很多;定时器作为兜底(见 lib/fileStore.js)。
 */
function maybeCleanupOrphanFavicon(oldUrl, excludeCardId = null) {
  const oldOrigin = normalizeOrigin(oldUrl);
  if (!oldOrigin) return;
  // 是否还有别的卡片(排除当前卡片本身)引用同一 origin?
  const stillUsed = db
    .findAll('cards')
    .some(c => c.id !== excludeCardId && normalizeOrigin(c.url) === oldOrigin);
  if (!stillUsed) {
    deleteFaviconCache(oldOrigin);
  }
}

export async function GET(request, { params }) {
  const auth = await requireAdmin();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const card = db.findById('cards', id);
  if (!card) return NextResponse.json({ error: '卡片不存在' }, { status: 404 });
  const section = card.sectionId ? db.findById('sections', card.sectionId) : null;
  return NextResponse.json({ card: { ...card, sectionName: section?.name || '未分组' } });
}

export async function PATCH(request, { params }) {
  const auth = await requireAdmin();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const existing = db.findById('cards', id);
  if (!existing) return NextResponse.json({ error: '卡片不存在' }, { status: 404 });
  try {
    const { title, description, url, sectionId, order, permission } = await request.json();
    const updates = {};
    if (title) updates.title = title.trim();
    if (description !== undefined) updates.description = description.trim();
    if (order !== undefined) updates.order = order;
    if (permission !== undefined) {
      if (!VALID_PERMISSIONS.includes(permission)) {
        return NextResponse.json({ error: '无效的访问权限' }, { status: 400 });
      }
      updates.permission = permission;
    }
    if (url !== undefined) {
      const check = validateUrl(url);
      if (!check.valid) return NextResponse.json({ error: check.message }, { status: 400 });
      updates.url = url;
    }
    if (sectionId !== undefined) {
      if (sectionId && !db.findById('sections', sectionId))
        return NextResponse.json({ error: '指定的板块不存在' }, { status: 400 });
      updates.sectionId = sectionId || null;
    }
    const updated = db.updateById('cards', id, updates);

    // M5:如果 URL 被改到别的域名(或站内路径),旧的 origin 如果不再被
    // 任何卡片引用,就清掉对应的 favicon_cache 行,避免孤儿长期残留。
    if (url !== undefined && normalizeOrigin(existing.url) !== normalizeOrigin(url)) {
      maybeCleanupOrphanFavicon(existing.url, id);
    }

    activityLog.record({
      userId: auth.session.user.id, email: auth.session.user.email,
      action: 'admin.card_update', target: 'card',
      detail: `编辑了卡片「${existing.title}」`,
    });
    return NextResponse.json({ success: true, card: updated });
  } catch {
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  const auth = await requireAdmin();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const card = db.findById('cards', id);
  if (!card) return NextResponse.json({ error: '卡片不存在' }, { status: 404 });
  db.deleteById('cards', id);
  // M5:删除卡片后,它的 origin 如果不再被任何卡片引用,就清掉 favicon_cache。
  maybeCleanupOrphanFavicon(card.url, id);
  activityLog.record({
    userId: auth.session.user.id, email: auth.session.user.email,
    action: 'admin.card_delete', target: 'card',
    detail: `删除了卡片「${card.title}」`,
  });
  return NextResponse.json({ success: true });
}
