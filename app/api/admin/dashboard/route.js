import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth.js';
import { db } from '@/lib/db.js';
import { loginHistory } from '@/lib/fileStore.js';

export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const users = db.findAll('users');
  const sections = db.findAll('sections');
  const cards = db.findAll('cards');
  const recentLogins = loginHistory.getAll({ page: 1, pageSize: 10 });

  return NextResponse.json({
    stats: {
      totalUsers: users.length,
      activeUsers: users.filter(u => u.status === 'active').length,
      bannedUsers: users.filter(u => u.status === 'banned' || u.status === 'suspended').length,
      adminUsers: users.filter(u => u.role === 'admin').length,
      memberUsers: users.filter(u => u.role === 'member').length,
      totalSections: sections.length,
      totalCards: cards.length,
      ungroupedCards: cards.filter(c => !c.sectionId).length,
    },
    recentLogins: recentLogins.items,
  });
}
