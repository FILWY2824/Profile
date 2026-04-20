import { NextResponse } from 'next/server';
import { db } from '@/lib/db.js';
import { oauthStore } from '@/lib/fileStore.js';
import { findOAuthClient, verifyClientSecret } from '@/lib/oauthClients.js';

/**
 * POST /api/oauth/introspect (RFC 7662)
 *
 * 第 1 轮遗留 #3.3 修复:active:true 的条件以前只看 token 是否过期/被撤销,
 * 不看用户状态、也不看授权(grant)是否被用户撤销。现在和 userinfo 的 validate
 * 语义对齐:
 *   • token 未过期 + 未 revoked + 未 replaced
 *   • 对应 user 存在且 status === 'active'
 *   • 对应 (userId, clientId) 的 oauth_grant 未 revoked
 * 任一不满足 → active: false。
 *
 * 客户端认证保留原逻辑:必须 Basic Auth 且 secret 正确。public client 不支持
 * introspect(它不应该有 secret 可认证,而 introspect 必须认证)。
 */
export async function POST(request) {
  try {
    // ── 客户端认证 ──
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Basic ')) {
      return NextResponse.json({ active: false });
    }
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString();
    const [clientId, clientSecret] = decoded.split(':');
    const client = findOAuthClient(clientId);
    if (!client || !verifyClientSecret(client, clientSecret)) {
      return NextResponse.json({ active: false });
    }

    const body = await request.formData().catch(() => null);
    let token;
    if (body) {
      token = body.get('token');
    } else {
      const json = await request.json().catch(() => ({}));
      token = json.token;
    }

    if (!token) return NextResponse.json({ active: false });

    const result = oauthStore.findToken(token);
    if (!result) return NextResponse.json({ active: false });

    const { record } = result;

    // token 自身状态
    if (record.revoked) return NextResponse.json({ active: false });
    if (record.replaced) return NextResponse.json({ active: false });
    if (new Date(record.expiresAt) < new Date()) return NextResponse.json({ active: false });

    // 属于提问的 client?(防一个 client 去 introspect 别人的 token)
    if (record.clientId !== client.clientId) return NextResponse.json({ active: false });

    // 用户状态
    const user = db.findById('users', record.userId);
    if (!user || user.status !== 'active') return NextResponse.json({ active: false });

    // 授权仍然有效?
    const grant = db.findOne('oauth_grants', { userId: user.id, clientId: record.clientId });
    if (grant?.revoked) return NextResponse.json({ active: false });

    return NextResponse.json({
      active: true,
      sub: user.id,
      username: user.name,
      // 只按 scope 返回 email(和 userinfo 保持一致)
      ...(record.scope?.split(/\s+/).includes('email') ? { email: user.email } : {}),
      scope: record.scope,
      client_id: record.clientId,
      token_type: 'Bearer',
      exp: Math.floor(new Date(record.expiresAt).getTime() / 1000),
      iat: Math.floor(new Date(record.createdAt).getTime() / 1000),
    });
  } catch {
    return NextResponse.json({ active: false });
  }
}
