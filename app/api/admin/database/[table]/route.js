import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth.js';
import { database } from '@/lib/database.js';

const ALLOWED_TABLES = new Set([
  'users', 'sections', 'cards',
  'oauth_clients', 'oauth_grants',
  'login_history', 'activity_log',
  'verification_codes', 'oauth_codes', 'oauth_tokens',
  'settings', 'favicon_cache',
]);

const SENSITIVE_COLUMNS = {
  users: ['passwordHash'],
  oauth_clients: ['clientSecretHash'],
  oauth_tokens: ['accessToken', 'refreshToken'],
  oauth_codes: ['code', 'codeChallenge'],
  verification_codes: ['code'],
  settings: ['value'],
  favicon_cache: ['dataUrl'],
};

const DEFAULT_ORDER = {
  users: 'createdAt DESC',
  sections: '"order" ASC',
  cards: '"order" ASC',
  oauth_clients: 'createdAt DESC',
  oauth_grants: 'createdAt DESC',
  login_history: 'timestamp DESC',
  activity_log: 'timestamp DESC',
  verification_codes: 'createdAt DESC',
  oauth_codes: 'createdAt DESC',
  oauth_tokens: 'createdAt DESC',
  settings: 'key ASC',
  favicon_cache: 'fetchedAt DESC',
};

function maskRow(table, row) {
  const sensitive = SENSITIVE_COLUMNS[table] || [];
  const out = { ...row };
  for (const column of sensitive) {
    if (!out[column]) continue;
    if (table === 'settings') {
      if (out.sensitive && out.value) out.value = '●●●●●●';
    } else {
      out[column] = '●●●●●●';
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
