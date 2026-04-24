import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth.js';
import { db } from '@/lib/db.js';
import { validateContentField } from '@/lib/contentLimits.js';

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

    const nameCheck = validateContentField('name', name);
    if (!nameCheck.valid) {
      return NextResponse.json({ error: nameCheck.message }, { status: 400 });
    }
    const slugCheck = validateContentField('slug', slug);
    if (!slugCheck.valid) {
      return NextResponse.json({ error: slugCheck.message }, { status: 400 });
    }
    const descCheck = validateContentField('description', description ?? '');
    if (!descCheck.valid) {
      return NextResponse.json({ error: descCheck.message }, { status: 400 });
    }

    const existing = db.findOne('sections', { slug: slugCheck.value });
    if (existing) {
      return NextResponse.json({ error: '该 slug 已存在' }, { status: 409 });
    }

    const sections = db.findAll('sections');
    const maxOrder = sections.length > 0 ? Math.max(...sections.map(s => s.order || 0)) : 0;

    const section = db.insert('sections', {
      name: nameCheck.value,
      slug: slugCheck.value,
      description: descCheck.value,
      order: order || maxOrder + 1,
    });

    return NextResponse.json({ success: true, section }, { status: 201 });
  } catch {
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
