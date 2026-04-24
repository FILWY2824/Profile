import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth.js';
import { db } from '@/lib/db.js';
import { validateContentField } from '@/lib/contentLimits.js';

export async function PATCH(request, { params }) {
  const auth = await requireAdmin();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const section = db.findById('sections', id);
  if (!section) return NextResponse.json({ error: '板块不存在' }, { status: 404 });

  try {
    const { name, slug, description, order } = await request.json();
    const updates = {};

    if (name !== undefined) {
      const nameCheck = validateContentField('name', name);
      if (!nameCheck.valid) return NextResponse.json({ error: nameCheck.message }, { status: 400 });
      updates.name = nameCheck.value;
    }
    if (description !== undefined) {
      const descCheck = validateContentField('description', description);
      if (!descCheck.valid) return NextResponse.json({ error: descCheck.message }, { status: 400 });
      updates.description = descCheck.value;
    }
    if (order !== undefined) updates.order = order;

    if (slug && slug !== section.slug) {
      const slugCheck = validateContentField('slug', slug);
      if (!slugCheck.valid) {
        return NextResponse.json({ error: slugCheck.message }, { status: 400 });
      }
      const conflict = db.findOne('sections', { slug: slugCheck.value });
      if (conflict && conflict.id !== id) {
        return NextResponse.json({ error: '该 slug 已存在' }, { status: 409 });
      }
      updates.slug = slugCheck.value;
    }

    const updated = db.updateById('sections', id, updates);
    return NextResponse.json({ success: true, section: updated });
  } catch {
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  const auth = await requireAdmin();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  if (!db.findById('sections', id)) {
    return NextResponse.json({ error: '板块不存在' }, { status: 404 });
  }

  // Move cards to ungrouped (remove sectionId)
  const cards = db.findAll('cards', { sectionId: id });
  for (const card of cards) {
    db.updateById('cards', card.id, { sectionId: null });
  }

  db.deleteById('sections', id);
  return NextResponse.json({ success: true, movedCards: cards.length });
}
