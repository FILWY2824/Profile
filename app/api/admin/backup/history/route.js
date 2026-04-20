import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth.js';
import { listJobs } from '@/lib/backup.js';

/**
 * GET /api/admin/backup/history?limit=100
 *
 * 比 /api/admin/backup 的 recent 字段提供更完整的历史(最多 500 条)。
 * 仅做简单的"最新 N 条",不做分页 —— 备份是低频事件,几十到几百条已经够
 * 管理员翻找,多了反而没意义(真要全量就去看 backup_jobs 表)。
 */
export async function GET(request) {
  const auth = await requireAdmin();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') || '100', 10);
  const items = listJobs({ limit: Number.isFinite(limit) ? limit : 100 });
  return NextResponse.json({ items });
}
