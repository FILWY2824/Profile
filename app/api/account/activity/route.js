import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth.js';
import { activityLog } from '@/lib/fileStore.js';
import { getSettingInt } from '@/lib/settings.js';

/**
 * GET /api/account/activity?page=N
 * 当前用户自己的行为日志。
 *
 * 安全与配额:
 *   - 普通/会员用户:只返回最近 N 条(N = USER_ACTIVITY_LOG_CAP 设置,默认 30),
 *     管理员可在 /admin/settings 修改
 *   - 管理员:可以看到自己所有的行为日志,每页 10(若要看别人的请走 admin 接口)
 *   - 设置为 -1 → 不限制(所有用户都能看到所有自己的记录)
 */
export async function GET(request) {
  const auth = await requireAuth();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const pageSize = 10;

  const isAdmin = auth.session.user.role === 'admin';
  const configured = getSettingInt('USER_ACTIVITY_LOG_CAP', 30);
  // -1 / 0 / 管理员 → 不设上限
  const userCap = (isAdmin || configured <= 0) ? null : configured;

  const result = activityLog.getAll({
    page, pageSize,
    userId: auth.session.user.id,
    userCap,
  });
  return NextResponse.json({
    ...result,
    capped: userCap,
  });
}
