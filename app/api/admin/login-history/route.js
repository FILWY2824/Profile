import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth.js';
import { loginHistory } from '@/lib/fileStore.js';

export async function GET(request) {
  const auth = await requireAdmin();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '1');
  const pageSize = parseInt(searchParams.get('pageSize') || '20');
  const userId = searchParams.get('userId') || null;
  // 旧参数(兼容 /account 个人记录页可能还在用)
  const dateStr = searchParams.get('date') || null;
  // 新参数:日期区间 + 搜索关键字
  const from = searchParams.get('from') || null;
  const to = searchParams.get('to') || null;
  const search = searchParams.get('search') || null;
  const includeAvailableDates = searchParams.get('includeDates') === '1';

  const result = loginHistory.getAll({
    page, pageSize, userId, dateStr, from, to, search, includeAvailableDates,
  });
  return NextResponse.json(result);
}
