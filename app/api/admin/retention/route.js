import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth.js';
import { loginHistory, activityLog, verificationCodes, oauthStore } from '@/lib/fileStore.js';
import { getSettingInt, setSetting } from '@/lib/settings.js';
import { activityLog as actLog } from '@/lib/fileStore.js';
import { getClientIp } from '@/lib/rateLimit.js';

/**
 * POST /api/admin/retention
 * body: { target: 'login_history'|'activity_log'|'verification_codes'|'oauth_tokens'|'all', days?: number, saveAsDefault?: boolean }
 *   - days >= 0 的整数:裁剪超过该天数的记录;days=0 → 清空全部
 *   - days < 0(如 -1):视为不裁剪,跳过
 *   - saveAsDefault=true 时,把 days 作为保留策略写入 settings 表,
 *     (当前没定时任务,但将来可由后台定时 worker 消费)
 *
 * 响应回显每个目标被删除的条数。
 */
const TARGETS = ['login_history', 'activity_log', 'verification_codes', 'oauth_tokens'];

export async function POST(request) {
  const auth = await requireAdmin();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const { target, days, saveAsDefault } = await request.json();
    if (!target) return NextResponse.json({ error: '缺少 target' }, { status: 400 });
    if (target !== 'all' && !TARGETS.includes(target)) {
      return NextResponse.json({ error: '不支持的 target' }, { status: 400 });
    }
    if (typeof days !== 'number' || !Number.isFinite(days)) {
      return NextResponse.json({ error: 'days 必须是数字' }, { status: 400 });
    }
    if (days < 0) {
      return NextResponse.json({ error: 'days 不能为负数' }, { status: 400 });
    }

    const results = {};
    const run = (key) => {
      switch (key) {
        case 'login_history':     results[key] = loginHistory.prune(days); break;
        case 'activity_log':      results[key] = activityLog.prune(days); break;
        case 'verification_codes': results[key] = { deleted: verificationCodes.pruneExpired() }; break;
        case 'oauth_tokens':      results[key] = oauthStore.pruneExpired(); break;
      }
    };
    if (target === 'all') TARGETS.forEach(run);
    else run(target);

    if (saveAsDefault) {
      if (target === 'login_history' || target === 'all') {
        setSetting('LOGIN_HISTORY_RETENTION_DAYS', String(days));
      }
      if (target === 'activity_log' || target === 'all') {
        setSetting('ACTIVITY_LOG_RETENTION_DAYS', String(days));
      }
    }

    actLog.record({
      userId: auth.session.user.id,
      username: auth.session.user.name,
      email: auth.session.user.email,
      action: 'admin.retention_prune',
      detail: `清理数据:${target} (${days} 天)`,
      ip: getClientIp(request),
      meta: { target, days, results, saveAsDefault: !!saveAsDefault },
    });

    return NextResponse.json({ success: true, results });
  } catch (err) {
    console.error('Retention prune error:', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}

/**
 * GET /api/admin/retention
 * 当前保留策略 + 每个目标的行数,供 UI 展示。
 */
export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { database } = await import('@/lib/database.js');
  const db = database.raw;

  return NextResponse.json({
    policies: {
      LOGIN_HISTORY_RETENTION_DAYS: getSettingInt('LOGIN_HISTORY_RETENTION_DAYS', 30),
      ACTIVITY_LOG_RETENTION_DAYS: getSettingInt('ACTIVITY_LOG_RETENTION_DAYS', 30),
    },
    counts: {
      login_history: db.prepare('SELECT COUNT(*) AS c FROM login_history').get().c,
      activity_log: db.prepare('SELECT COUNT(*) AS c FROM activity_log').get().c,
      verification_codes: db.prepare('SELECT COUNT(*) AS c FROM verification_codes').get().c,
      oauth_tokens: db.prepare('SELECT COUNT(*) AS c FROM oauth_tokens').get().c,
      oauth_codes: db.prepare('SELECT COUNT(*) AS c FROM oauth_codes').get().c,
    },
  });
}
