import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth.js';
import { startBackup } from '@/lib/backup.js';
import { activityLog } from '@/lib/fileStore.js';
import { getClientIp } from '@/lib/rateLimit.js';

/**
 * POST /api/admin/backup/run  →  启动一次备份
 *
 * 立即返回 jobId(不等备份完成),前端接下来 polling GET /api/admin/backup
 * 看状态变化。设计理由见 lib/backup.js 的 startBackup() 注释。
 */
export async function POST(request) {
  const auth = await requireAdmin();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const { jobId } = await startBackup({
      triggeredBy: `admin:${auth.session.user.id}`,
    });
    activityLog.record({
      userId: auth.session.user.id,
      username: auth.session.user.name,
      email: auth.session.user.email,
      action: 'admin.backup_start',
      detail: `发起数据库备份(job=${jobId.slice(0, 8)})`,
      ip: getClientIp(request),
    });
    return NextResponse.json({ success: true, jobId });
  } catch (err) {
    // 业务错误(功能未启用 / 配置缺失 / 已有任务)走 400,服务器内部错走 500
    const msg = err?.message || '启动备份失败';
    const isBusiness = /未启用|未配置|已有备份|非法|不存在|绝对路径/.test(msg);
    return NextResponse.json({ error: msg }, { status: isBusiness ? 400 : 500 });
  }
}
