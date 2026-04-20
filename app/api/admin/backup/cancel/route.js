import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth.js';
import { cancelActive, getRunningJob } from '@/lib/backup.js';
import { activityLog } from '@/lib/fileStore.js';
import { getClientIp } from '@/lib/rateLimit.js';

/**
 * POST /api/admin/backup/cancel  →  取消当前正在跑的备份
 *
 * 注意:进程级取消 —— 只在本进程有活跃任务时有效。多实例部署下要取消别的
 * 实例的任务,需要扩成"写取消标志到 DB,各实例自检"的机制。本项目默认
 * 单进程 pm2,当前实现已经够用。
 */
export async function POST(request) {
  const auth = await requireAdmin();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const running = getRunningJob();
  const cancelled = cancelActive();

  if (!cancelled) {
    return NextResponse.json({
      error: running ? '当前实例没有正在运行的备份任务(可能由其他实例发起)'
                     : '当前没有正在运行的备份任务',
    }, { status: 409 });
  }

  activityLog.record({
    userId: auth.session.user.id,
    username: auth.session.user.name,
    email: auth.session.user.email,
    action: 'admin.backup_cancel',
    detail: `取消数据库备份${running ? `(job=${running.id.slice(0, 8)})` : ''}`,
    ip: getClientIp(request),
  });

  return NextResponse.json({ success: true });
}
