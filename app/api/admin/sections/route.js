import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth.js';
import { db } from '@/lib/db.js';

export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const sections = db.findAll('sections').sort((a, b) => (a.order || 0) - (b.order || 0));
  const cards = db.findAll('cards');

  const result = sections.map(s => ({
    ...s,
    cardCount: cards.filter(c => c.sectionId === s.id).length,
  }));

  return NextResponse.json({ sections: result });
}

export async function POST(request) {
  const auth = await requireAdmin();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const { name, slug, description, order } = await request.json();

    if (!name || !slug) {
      return NextResponse.json({ error: '名称和 slug 均为必填' }, { status: 400 });
    }

    if (!/^[a-z0-9-]+$/.test(slug)) {
      return NextResponse.json({ error: 'slug 只能包含小写字母、数字和连字符' }, { status: 400 });
    }

    const existing = db.findOne('sections', { slug });
    if (existing) {
      return NextResponse.json({ error: '该 slug 已存在' }, { status: 409 });
    }

    const sections = db.findAll('sections');
    const maxOrder = sections.length > 0 ? Math.max(...sections.map(s => s.order || 0)) : 0;

    const section = db.insert('sections', {
      name: name.trim(),
      slug,
      description: description?.trim() || '',
      order: order || maxOrder + 1,
    });

    return NextResponse.json({ success: true, section }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
