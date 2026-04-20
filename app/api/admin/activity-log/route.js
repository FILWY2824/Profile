import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth.js';
import { activityLog } from '@/lib/fileStore.js';

export async function GET(request) {
  const auth = await requireAdmin();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '1');
  const pageSize = parseInt(searchParams.get('pageSize') || '30');
  const userId = searchParams.get('userId') || null;
  const dateStr = searchParams.get('date') || null;        // 旧兼容
  const from = searchParams.get('from') || null;           // 新
  const to = searchParams.get('to') || null;               // 新
  const action = searchParams.get('action') || null;
  const search = searchParams.get('search') || null;       // 新:搜索
  const includeAvailableDates = searchParams.get('includeDates') === '1';

  const result = activityLog.getAll({
    page, pageSize, userId, dateStr, from, to, action, search, includeAvailableDates,
  });
  return NextResponse.json(result);
}
