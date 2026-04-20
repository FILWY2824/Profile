import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth.js';
import { database } from '@/lib/database.js';

/**
 * GET /api/admin/database
 * 返回 SQLite 中所有用户表的概览:名字 / 行数 / 列定义 / 索引数量。
 * 供后台数据库可视化页面使用。不返回 sqlite_* 内部表。
 */
const HIDDEN = new Set(['sqlite_sequence', 'sqlite_stat1', '_meta']);

export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const db = database.raw;
  const tables = db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`
  ).all().map(r => r.name).filter(n => !n.startsWith('sqlite_') && !HIDDEN.has(n));

  const overview = tables.map(table => {
    const count = db.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get().c;
    const columns = db.prepare(`PRAGMA table_info("${table}")`).all().map(c => ({
      name: c.name,
      type: c.type,
      notnull: !!c.notnull,
      pk: !!c.pk,
      dflt_value: c.dflt_value,
    }));
    const indexCount = db.prepare(`PRAGMA index_list("${table}")`).all().length;
    return { table, rowCount: count, columns, indexCount };
  });

  return NextResponse.json({ tables: overview });
}
