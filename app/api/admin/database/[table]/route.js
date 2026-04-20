import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth.js';
import { database } from '@/lib/database.js';

/**
 * GET /api/admin/database/[table]?page=1&pageSize=20
 * 返回指定表的分页数据,供后台数据库浏览页面。
 *
 * 安全:
 *   • 表名白名单(不开放内部 _meta / sqlite_*)
 *   • 敏感列(密码哈希、access token、client secret 等)永远不返回明文,
 *     只返回 "●●●●●●" 占位,防止管理员一边查表一边意外把秘钥抄出去。
 *   • table 名来自 URL,所以用 map 映射成硬编码的 SQL,不做字符串拼接。
 */
const ALLOWED_TABLES = new Set([
  'users', 'sections', 'cards',
  'oauth_clients', 'oauth_grants',
  'login_history', 'activity_log',
  'verification_codes', 'oauth_codes', 'oauth_tokens',
  'settings', 'favicon_cache',
  // backup_jobs 是 migration v2 加的,之前漏登记导致点击即 404。
  // 没有敏感列(状态 / 时间 / 字节数等都可见),无需 maskRow 处理。
  'backup_jobs',
]);

// 这些列值只返回占位符
const SENSITIVE_COLUMNS = {
  users: ['passwordHash'],
  oauth_clients: ['clientSecretHash'],
  oauth_tokens: ['accessToken', 'refreshToken'],
  oauth_codes: ['code', 'codeChallenge'],
  verification_codes: ['code'],
  settings: ['value'], // 统一做掩码(视 sensitive 标记决定,见下方)
  // dataUrl 本身不是"机密",但它是 ~2-8KB 的 base64,直接塞进表格会把行撑爆;
  // 这里也走掩码逻辑把它替换成占位符 —— 管理员看 origin / byteSize / source 就够了
  favicon_cache: ['dataUrl'],
};

const DEFAULT_ORDER = {
  users: 'createdAt DESC',
  sections: '"order" ASC',
  cards: '"order" ASC',
  oauth_clients: 'createdAt DESC',
  oauth_grants: 'grantedAt DESC',
  login_history: 'timestamp DESC',
  activity_log: 'timestamp DESC',
  verification_codes: 'createdAt DESC',
  oauth_codes: 'createdAt DESC',
  oauth_tokens: 'createdAt DESC',
  settings: 'key ASC',
  favicon_cache: 'fetchedAt DESC',
  backup_jobs: 'startedAt DESC',
};

function maskRow(table, row) {
  const sensitive = SENSITIVE_COLUMNS[table] || [];
  const out = { ...row };
  for (const c of sensitive) {
    if (out[c]) {
      // settings 表:敏感列由 sensitive=1 标记决定,其他值保留明文
      if (table === 'settings') {
        if (out.sensitive && out.value) out.value = '●●●●●●';
      } else {
        out[c] = '●●●●●●';
      }
    }
  }
  return out;
}

export async function GET(request, { params }) {
  const auth = await requireAdmin();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { table } = await params;
  if (!ALLOWED_TABLES.has(table)) {
    return NextResponse.json({ error: '表不存在或不可访问' }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get('pageSize') || '20', 10)));
  const offset = (page - 1) * pageSize;

  const db = database.raw;
  const total = db.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get().c;
  const orderBy = DEFAULT_ORDER[table] || 'rowid DESC';
  const rows = db.prepare(
    `SELECT * FROM "${table}" ORDER BY ${orderBy} LIMIT ? OFFSET ?`
  ).all(pageSize, offset);

  return NextResponse.json({
    table,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    items: rows.map(r => maskRow(table, r)),
  });
}
