import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth.js';
import { db } from '@/lib/db.js';
import { findOAuthClient } from '@/lib/oauthClients.js';
import { oauthStore, activityLog } from '@/lib/fileStore.js';
import { getClientIp } from '@/lib/rateLimit.js';

/**
 * GET /api/account/oauth-grants?page=N
 * 当前用户的 OAuth 授权列表;每页 5 条;已撤销的不在列表中。
 * 返回字段中不再带 scopes 明细(用户看不懂 openid/profile/email 这些),
 * 只保留展示友好的元信息。
 */
export async function GET(request) {
  const auth = await requireAuth();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const pageSize = 5;

  const all = db.findAll('oauth_grants', { userId: auth.session.user.id })
    .filter(g => !g.revoked)
    .sort((a, b) => new Date(b.lastUsedAt || b.grantedAt) - new Date(a.lastUsedAt || a.grantedAt));

  const total = all.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const items = all.slice((page - 1) * pageSize, page * pageSize).map(g => {
    const c = findOAuthClient(g.clientId);
    return {
      id: g.id,
      clientId: g.clientId,
      clientName: c?.name || g.clientName || g.clientId,
      description: c?.description || '',
      homepageUrl: c?.homepageUrl || '',
      logoUrl: c?.logoUrl || '',
      grantedAt: g.grantedAt,
      lastUsedAt: g.lastUsedAt,
    };
  });

  return NextResponse.json({ items, total, page, pageSize, totalPages });
}

/** DELETE ?id=xxx → 撤销某条授权并吊销其所有 token */
export async function DELETE(request) {
  const auth = await requireAuth();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: '缺少 id' }, { status: 400 });

  const grant = db.findById('oauth_grants', id);
  if (!grant || grant.userId !== auth.session.user.id) {
    return NextResponse.json({ error: '授权记录不存在' }, { status: 404 });
  }

  db.updateById('oauth_grants', id, {
    revoked: true,
    revokedAt: new Date().toISOString(),
  });
  const revokedCount = oauthStore.revokeAllByUserAndClient(auth.session.user.id, grant.clientId);

  activityLog.record({
    userId: auth.session.user.id,
    username: auth.session.user.name,
    email: auth.session.user.email,
    action: 'oauth.revoke',
    detail: `撤销对 ${grant.clientName || grant.clientId} 的授权`,
    ip: getClientIp(request),
    meta: { clientId: grant.clientId, tokensRevoked: revokedCount },
  });

  return NextResponse.json({ success: true });
}
