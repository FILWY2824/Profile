import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth.js';
import { loginHistory } from '@/lib/fileStore.js';

/**
 * GET /api/account/login-history?page=N
 * 当前用户的登录记录,按时间倒序,每页 10 条。
 */
export async function GET(request) {
  const auth = await requireAuth();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const pageSize = 10;

  const result = loginHistory.getAll({
    page, pageSize, userId: auth.session.user.id,
  });
  return NextResponse.json(result);
}
