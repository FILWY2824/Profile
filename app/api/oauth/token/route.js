import { NextResponse } from 'next/server';
import { findOAuthClient, verifyClientSecret, isConfidentialClient } from '@/lib/oauthClients.js';
import { oauthStore } from '@/lib/fileStore.js';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { getSettingInt } from '@/lib/settings.js';

/**
 * POST /api/oauth/token
 *
 * 支持的 grant_type:
 *   • authorization_code
 *   • refresh_token
 *
 * 本版本修复的问题:
 *
 *   [#2] authorization_code 被"提前消费"
 *     旧代码先 consumeCode(把 used 改 1)再校验 clientId / redirect_uri / PKCE,
 *     导致任何参数错误的请求都会烧掉一个合法 code,正常客户端第二次来就
 *     invalid_grant。现在改为:先 findCode(纯读) → 全部校验 → 最后通过
 *     consumeCodeAndIssueTokens 在单个事务里"标 used + 插 token"。
 *     并发去重靠 UPDATE ... WHERE used = 0 的 changes 计数。
 *
 *   [#3] public client 没有强制 PKCE
 *     旧代码只在 codeRecord.codeChallenge 存在时才校验 verifier,意味着
 *     一个 public client 只要 authorize 时不带 code_challenge 就能走"无 PKCE
 *     的 authorization_code flow",等于没有任何抗 code 截获的保护。
 *     现在:若 client 是非机密(public)且 code 没有 codeChallenge,拒绝;
 *     同时只接受 S256,不再允许 plain(deprecated 已多年)。
 *     authorize 端同样做了前置校验,这里是 defense-in-depth。
 *
 *   [refresh_token]
 *     完整实现 refresh_token grant:
 *       - 一次性使用 + rotation(RFC-9700 §4.14)
 *       - reuse detection:重放已用过的 refresh_token 立即撤销整条链
 *       - scope 不允许通过 refresh 扩展,只继承原 token 的 scope
 *       - refresh_token 必须属于声明的 client_id,不允许跨 client 使用
 */
export async function POST(request) {
  try {
    // ── 1. 解析 body ─────────────────────────────────────────────────
    const body = await request.formData().catch(() => null);
    let params;
    if (body) {
      params = Object.fromEntries(body);
    } else {
      params = await request.json();
    }
    const {
      grant_type,
      code,
      redirect_uri,
      client_id,
      client_secret,
      code_verifier,
      refresh_token,
    } = params;

    // ── 2. 客户端认证(两种方式:Basic Auth 优先,form 字段兜底) ──────
    //
    // 原 H3 修复保留:机密客户端若没带 secret / 带错,直接 401;
    //                 public client 不要求 secret,PKCE 是它的安全保障。
    let client;
    let presentedSecret = null;

    const authHeader = request.headers.get('authorization');
    if (authHeader?.startsWith('Basic ')) {
      const decoded = Buffer.from(authHeader.slice(6), 'base64').toString();
      const idx = decoded.indexOf(':');
      const id = idx >= 0 ? decoded.slice(0, idx) : decoded;
      const secret = idx >= 0 ? decoded.slice(idx + 1) : '';
      client = findOAuthClient(id);
      presentedSecret = secret || null;
    } else {
      client = findOAuthClient(client_id);
      presentedSecret = client_secret || null;
    }

    if (!client) {
      return NextResponse.json({ error: 'invalid_client' }, { status: 401 });
    }

    const confidential = isConfidentialClient(client);

    if (confidential) {
      if (!presentedSecret || !verifyClientSecret(client, presentedSecret)) {
        return NextResponse.json({ error: 'invalid_client' }, { status: 401 });
      }
    }
    // public client 的额外安全保障(PKCE)在各 grant 分支里做。

    // ── 3. 按 grant_type 分支 ────────────────────────────────────────

    if (grant_type === 'authorization_code') {
      return handleAuthorizationCode({
        client, confidential, code, redirect_uri, code_verifier,
      });
    }

    if (grant_type === 'refresh_token') {
      return handleRefreshToken({ client, refresh_token });
    }

    return NextResponse.json({ error: 'unsupported_grant_type' }, { status: 400 });
  } catch (err) {
    console.error('OAuth token error:', err);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}

// ───────────────────────────────────────────────────────────────────
// authorization_code grant
// ───────────────────────────────────────────────────────────────────

function handleAuthorizationCode({ client, confidential, code, redirect_uri, code_verifier }) {
  if (!code) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  // 只读取 code 记录,尚未消费 —— 全套校验通过后才 atomic 地消费 + 签发。
  const found = oauthStore.findCode(code);
  if (!found) {
    return NextResponse.json({ error: 'invalid_grant' }, { status: 400 });
  }
  const codeRecord = found.record;

  // 校验绑定关系
  if (codeRecord.clientId !== client.clientId) {
    return NextResponse.json({ error: 'invalid_grant' }, { status: 400 });
  }
  if (codeRecord.redirectUri !== redirect_uri) {
    return NextResponse.json({ error: 'invalid_grant' }, { status: 400 });
  }

  // ── PKCE 校验 ──
  //
  // public client:必须走 PKCE(是它唯一的抗 code 截获手段)
  // confidential client:PKCE 不是必须,但如果 authorize 时带了 code_challenge
  //                     那 token 交换时必须带匹配的 verifier(正常流程)
  //
  // 方法限制:只接受 S256。plain 被 OAuth 2.1 废弃、OAuth 2.0 BCP 也已不推荐
  // —— 它相当于"把 verifier 和 challenge 存成同一个字符串",中间人截获
  // authorize 请求就能重放,失去了 PKCE 的意义。
  if (!confidential && !codeRecord.codeChallenge) {
    return NextResponse.json({ error: 'invalid_grant' }, { status: 400 });
  }
  if (codeRecord.codeChallenge) {
    if (!code_verifier) {
      return NextResponse.json({ error: 'invalid_grant' }, { status: 400 });
    }
    if (codeRecord.codeChallengeMethod !== 'S256') {
      return NextResponse.json({ error: 'invalid_grant' }, { status: 400 });
    }
    const challenge = crypto.createHash('sha256').update(code_verifier).digest('base64url');
    if (challenge !== codeRecord.codeChallenge) {
      return NextResponse.json({ error: 'invalid_grant' }, { status: 400 });
    }
  }

  // ── 全部校验通过 → 在单一事务里消费 code + 签发 token ──
  const accessToken = uuidv4().replace(/-/g, '');
  const refreshTokenVal = uuidv4().replace(/-/g, '');
  const expiresIn = getSettingInt('OAUTH_TOKEN_EXPIRY_SECONDS', 3600);
  const refreshExpiryDays = getSettingInt('OAUTH_REFRESH_TOKEN_EXPIRY_DAYS', 30);

  const result = oauthStore.consumeCodeAndIssueTokens({
    code,
    tokenData: {
      accessToken,
      refreshToken: refreshTokenVal,
      refreshTokenExpiresAt: new Date(Date.now() + refreshExpiryDays * 86400_000).toISOString(),
      clientId: client.clientId,
      userId: codeRecord.userId,
      scope: codeRecord.scope,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    },
  });

  if (!result.ok) {
    // 并发:另一个请求抢先把 code 消费了。两边都合法,但 code 只能兑换一次。
    return NextResponse.json({ error: 'invalid_grant' }, { status: 400 });
  }

  return NextResponse.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: expiresIn,
    refresh_token: refreshTokenVal,
    scope: codeRecord.scope,
  });
}

// ───────────────────────────────────────────────────────────────────
// refresh_token grant
// ───────────────────────────────────────────────────────────────────

function handleRefreshToken({ client, refresh_token }) {
  if (!refresh_token) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  // 先粗查 —— 目的只有一个:确认这个 refresh_token 属于当前认证的 client,
  // 不允许 client A 拿 client B 发的 refresh_token 来换 token。
  // rotation 和 reuse 检测的原子逻辑在 rotateRefreshToken 内部。
  //
  // 关于 timing oracle:这里 "token 不存在" 和 "token 属于别的 client" 走了
  // 同一条拒绝路径,返回值也相同;都是 invalid_grant,不给攻击者探测的差异。
  const existing = oauthStore.findByRefreshToken(refresh_token);
  if (!existing || existing.clientId !== client.clientId) {
    return NextResponse.json({ error: 'invalid_grant' }, { status: 400 });
  }

  const newAccess = uuidv4().replace(/-/g, '');
  const newRefresh = uuidv4().replace(/-/g, '');
  const expiresIn = getSettingInt('OAUTH_TOKEN_EXPIRY_SECONDS', 3600);
  const refreshExpiryDays = getSettingInt('OAUTH_REFRESH_TOKEN_EXPIRY_DAYS', 30);

  const result = oauthStore.rotateRefreshToken({
    oldRefreshToken: refresh_token,
    newTokenData: {
      accessToken: newAccess,
      refreshToken: newRefresh,
      refreshTokenExpiresAt: new Date(Date.now() + refreshExpiryDays * 86400_000).toISOString(),
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    },
  });

  if (!result.ok) {
    // 对外统一 invalid_grant,不暴露是"重放"还是"过期 / 撤销" —— 避免信息泄露。
    // 内部审计后续可以在 rotateRefreshToken 里走 activityLog,这里保持外部响应
    // 的最小化。
    return NextResponse.json({ error: 'invalid_grant' }, { status: 400 });
  }

  return NextResponse.json({
    access_token: newAccess,
    token_type: 'Bearer',
    expires_in: expiresIn,
    refresh_token: newRefresh,
    scope: result.scope,
  });
}
