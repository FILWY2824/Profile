import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth.js';
import { testConnection } from '@/lib/backup.js';
import { activityLog } from '@/lib/fileStore.js';
import { getClientIp } from '@/lib/rateLimit.js';

/**
 * POST /api/admin/backup/test-connection  →  只做连接测试,不上传任何数据
 *
 * 允许在"备份功能未启用"状态下使用 —— 管理员可能刚填好配置,想在打开开关前
 * 先确认一下 SFTP 确实通。参见 lib/backup.js 的 testConnection()。
 */
export async function POST(request) {
  const auth = await requireAdmin();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    await testConnection();
    activityLog.record({
      userId: auth.session.user.id,
      username: auth.session.user.name,
      email: auth.session.user.email,
      action: 'admin.backup_test',
      detail: '测试备份服务器连通性 —— 成功',
      ip: getClientIp(request),
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err?.message || '连接测试失败';
    activityLog.record({
      userId: auth.session.user.id,
      username: auth.session.user.name,
      email: auth.session.user.email,
      action: 'admin.backup_test',
      detail: `测试备份服务器连通性 —— 失败: ${msg.slice(0, 200)}`,
      ip: getClientIp(request),
    });
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
