import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth.js';
import { db } from '@/lib/db.js';
import { activityLog } from '@/lib/fileStore.js';

const VALID_PERMISSIONS = ['public', 'user', 'member', 'admin'];

function validateUrl(url) {
  if (!url) return { valid: false, message: 'URL 不能为空' };
  if (url.startsWith('/')) return { valid: true };
  if (/^https?:\/\/.+/.test(url)) return { valid: true };
  return { valid: false, message: 'URL 必须是站内路由(/开头)或 http/https 外链' };
}

export async function GET(request) {
  const auth = await requireAdmin();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '1');
  const pageSize = parseInt(searchParams.get('pageSize') || '20');
  const search = searchParams.get('search') || '';
  const sectionId = searchParams.get('sectionId') || '';

  const result = db.search('cards', card => {
    if (search && !card.title.toLowerCase().includes(search.toLowerCase())) return false;
    if (sectionId === 'ungrouped') return !card.sectionId;
    if (sectionId) return card.sectionId === sectionId;
    return true;
  });

  const sections = db.findAll('sections');
  const sectionMap = Object.fromEntries(sections.map(s => [s.id, s.name]));
  const sorted = result.sort((a, b) =>
    (a.sectionId || '').localeCompare(b.sectionId || '') || (a.order || 0) - (b.order || 0)
  );
  const total = sorted.length;
  const items = sorted.slice((page - 1) * pageSize, page * pageSize).map(c => ({
    ...c,
    sectionName: c.sectionId ? (sectionMap[c.sectionId] || '未知板块') : '未分组',
  }));
  return NextResponse.json({ items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
}

export async function POST(request) {
  const auth = await requireAdmin();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { title, description, url, sectionId, order, permission } = await request.json();
    if (!title) return NextResponse.json({ error: '标题不能为空' }, { status: 400 });
    const urlCheck = validateUrl(url);
    if (!urlCheck.valid) return NextResponse.json({ error: urlCheck.message }, { status: 400 });
    if (sectionId && !db.findById('sections', sectionId))
      return NextResponse.json({ error: '指定的板块不存在' }, { status: 400 });

    const finalPerm = VALID_PERMISSIONS.includes(permission) ? permission : 'public';

    const cards = sectionId ? db.findAll('cards', { sectionId }) : [];
    const maxOrder = cards.length > 0 ? Math.max(...cards.map(c => c.order || 0)) : 0;

    const card = db.insert('cards', {
      title: title.trim(),
      description: description?.trim() || '',
      url,
      sectionId: sectionId || null,
      order: order || maxOrder + 1,
      permission: finalPerm,
    });
    activityLog.record({
      userId: auth.session.user.id, email: auth.session.user.email,
      action: 'admin.card_create', target: 'card', detail: `创建了卡片「${card.title}」`,
    });
    return NextResponse.json({ success: true, card }, { status: 201 });
  } catch {
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
