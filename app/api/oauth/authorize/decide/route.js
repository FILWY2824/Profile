import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth.js';
import { db } from '@/lib/db.js';
import { database } from '@/lib/database.js';
import { findOAuthClient, isConfidentialClient } from '@/lib/oauthClients.js';
import { oauthStore, activityLog } from '@/lib/fileStore.js';
import { v4 as uuidv4 } from 'uuid';
import { getClientIp } from '@/lib/rateLimit.js';
import { getSettingInt } from '@/lib/settings.js';

/**
 * POST /api/oauth/authorize/decide
 * 用户在同意页点击"允许"或"拒绝"后调用。
 * Body: { client_id, redirect_uri, scope, state, code_challenge, code_challenge_method, action }
 *   - action = 'allow' | 'deny'
 * 返回: { redirect: '最终要跳转的第三方 URL' }
 *
 * 本版本修复:
 *   [#3] PKCE 在此端点也做一次前置校验(defense-in-depth)。仅靠 authorize
 *        端点校验不够 —— 攻击者可以绕过前端直接构造 POST 到 decide。
 *   [#4] grant 的 upsert 从"先 findOne,有则 update,没则 insert"改成事务化
 *        upsert。schema 层已经加了 UNIQUE(userId, clientId) 约束兜底;
 *        这里再包一层 better-sqlite3 transaction,让"读现有 scopes → 合并
 *        → 写回"在单进程内串行,避免合并 scope 时丢字段。跨进程并发撞到
 *        UNIQUE 的极窄窗口会抛 SQLITE_CONSTRAINT_UNIQUE,我们重试一次,
 *        重试路径会走 UPDATE 分支。
 */
export async function POST(request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
    }

    const body = await request.json();
    const {
      client_id, redirect_uri,
      scope = 'openid', state = '',
      code_challenge = null, code_challenge_method = 'plain',
      action,
    } = body;

    const client = findOAuthClient(client_id);
    if (!client || client.status !== 'active') {
      return NextResponse.json({ error: 'invalid_client' }, { status: 400 });
    }
    if (!Array.isArray(client.redirectUris) || !client.redirectUris.includes(redirect_uri)) {
      return NextResponse.json({ error: 'invalid_redirect_uri' }, { status: 400 });
    }

    const ip = getClientIp(request);

    // ── 用户拒绝 ──
    if (action === 'deny') {
      const params = new URLSearchParams({ error: 'access_denied', state });
      activityLog.record({
        userId: session.user.id, username: session.user.name, email: session.user.email,
        action: 'oauth.deny', detail: `拒绝授权给 ${client.name || client.clientId}`,
        ip, meta: { clientId: client_id },
      });
      return NextResponse.json({ redirect: `${redirect_uri}?${params}` });
    }

    if (action !== 'allow') {
      return NextResponse.json({ error: 'invalid_action' }, { status: 400 });
    }

    // ── PKCE 前置校验(#3 defense-in-depth) ────────────────────────
    //
    // 和 authorize 端同语义:public client 必须带 code_challenge,且所有
    // 带 challenge 的请求 method 必须是 S256。这里返回 JSON 而不是
    // redirect,因为这是前端同意页发起的 AJAX 调用。
    const confidential = isConfidentialClient(client);
    if (!confidential && !code_challenge) {
      return NextResponse.json({
        error: 'invalid_request',
        error_description: 'code_challenge is required for public clients',
      }, { status: 400 });
    }
    if (code_challenge && code_challenge_method !== 'S256') {
      return NextResponse.json({
        error: 'invalid_request',
        error_description: 'code_challenge_method must be S256',
      }, { status: 400 });
    }

    // ── scope 子集 + minLevel(#3.3 / #3.4,defense-in-depth) ──
    const clientScopes = new Set(client.scopes || []);
    const requestedScopeArr = scope.split(/\s+/).filter(Boolean);
    const unknownScope = requestedScopeArr.find(s => !clientScopes.has(s));
    if (unknownScope) {
      return NextResponse.json({
        error: 'invalid_scope',
        error_description: `scope "${unknownScope}" is not permitted for this client`,
      }, { status: 400 });
    }
    const ROLE_LEVEL = { user: 0, member: 1, admin: 2 };
    const userLevel = ROLE_LEVEL[session.user.role] ?? 0;
    const requiredLevel = Number(client.minLevel) || 0;
    if (userLevel < requiredLevel) {
      return NextResponse.json({
        error: 'access_denied',
        error_description: `当前账户等级不足以登录 ${client.name || client.clientId}`,
      }, { status: 403 });
    }

    // ── 用户允许 ──
    const requestedScopes = scope.split(/\s+/).filter(Boolean);

    // 写入/更新 oauth_grants(user × client 唯一)—— 事务化 upsert
    //
    // better-sqlite3 是同步 API,单进程内 transaction() 会在第一次写入时升级
    // 成 exclusive lock,把"读 + 算合并 scope + 写"这三步串起来,防止中间
    // 被别的请求插队。跨进程并发撞到 UNIQUE 的极小窗口靠外层 try/retry 兜底。
    const upsertGrant = database.transaction(() => {
      const now = new Date().toISOString();
      const existing = db.findOne('oauth_grants', {
        userId: session.user.id,
        clientId: client.clientId,
      });
      if (existing) {
        // 合并 scope(并集),清除撤销标记
        const mergedScopes = Array.from(new Set([
          ...(existing.scopes || []),
          ...requestedScopes,
        ]));
        db.updateById('oauth_grants', existing.id, {
          scopes: mergedScopes,
          revoked: false,
          lastUsedAt: now,
        });
      } else {
        db.insert('oauth_grants', {
          userId: session.user.id,
          clientId: client.clientId,
          clientName: client.name || client.clientId,
          scopes: requestedScopes,
          revoked: false,
          grantedAt: now,
          lastUsedAt: now,
        });
      }
    });

    try {
      upsertGrant();
    } catch (err) {
      // 跨进程并发下两个 INSERT 同时撞 UNIQUE,其中一个会被 SQLite 拒绝。
      // 重试一次,重试路径会看到已经存在的行并走 UPDATE 分支。
      // 其他错误照常抛出,走外层 catch 返回 500。
      if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        upsertGrant();
      } else {
        throw err;
      }
    }

    // 发放授权码 —— 有效期由 settings.OAUTH_CODE_EXPIRY_MINUTES 控制(默认 10 分钟)
    const code = uuidv4().replace(/-/g, '');
    const codeExpiryMinutes = getSettingInt('OAUTH_CODE_EXPIRY_MINUTES', 10);
    oauthStore.saveCode({
      code,
      clientId: client_id,
      userId: session.user.id,
      redirectUri: redirect_uri,
      scope,
      codeChallenge: code_challenge,
      codeChallengeMethod: code_challenge_method,
      expiresAt: new Date(Date.now() + codeExpiryMinutes * 60_000).toISOString(),
    });

    activityLog.record({
      userId: session.user.id, username: session.user.name, email: session.user.email,
      action: 'oauth.allow', detail: `授权给 ${client.name || client.clientId}`,
      ip, meta: { clientId: client_id, scope },
    });

    const params = new URLSearchParams({ code, state });
    return NextResponse.json({ redirect: `${redirect_uri}?${params}` });
  } catch (err) {
    console.error('OAuth decide error:', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
