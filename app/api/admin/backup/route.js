import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth.js';
import { loadBackupConfig, getRunningJob, listJobs } from '@/lib/backup.js';

/**
 * GET /api/admin/backup
 *
 * 汇总返回:
 *   • enabled:备份功能是否启用
 *   • configValid:配置是否完整可用(不暴露敏感字段本身)
 *   • configErrors:若不完整,缺哪些字段(文案)
 *   • current:当前是否有 running 任务及其基本信息
 *   • recent:最近 10 条历史
 *
 * 前端页面 polling 这一个端点即可驱动完整 UI,不需要多个 endpoint。
 * 历史分页在另一个端点 /api/admin/backup/history,上限 100 条。
 */
export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { config, errors } = loadBackupConfig();
  const configValid = errors.length === 0 || (errors.length === 1 && errors[0] === '备份功能未启用');
  const current = getRunningJob();
  const recent = listJobs({ limit: 10 });

  return NextResponse.json({
    enabled: config.enabled,
    configValid,
    configErrors: errors,
    // 仅回显非敏感字段,便于前端展示"当前备份到哪台服务器的哪个目录",
    // 但不回显 password / privateKey 本身(它们走 /admin/settings)
    config: {
      host: config.host,
      port: config.port,
      username: config.username,
      authMethod: config.authMethod,
      remoteDir: config.remoteDir,
      hasPassword: !!config.password,
      hasPrivateKey: !!config.privateKey,
    },
    current,
    recent,
  });
}
