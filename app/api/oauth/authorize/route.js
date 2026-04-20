import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth.js';
import { db } from '@/lib/db.js';
import { findOAuthClient, isConfidentialClient } from '@/lib/oauthClients.js';
import { oauthStore } from '@/lib/fileStore.js';
import { v4 as uuidv4 } from 'uuid';
import { getSettingInt } from '@/lib/settings.js';

/**
 * GET /api/oauth/authorize
 *   - 校验 client_id、redirect_uri、response_type
 *   - 校验 PKCE(public client 强制,只允许 S256)
 *   - 未登录 → 跳转登录(带 redirect 回跳)
 *   - 已登录 + 已授权 → 直接发 code 回跳(RFC 6749 §4.1.1 允许 trusted prior consent)
 *   - 已登录 + 未授权 → 跳转至 /oauth/authorize 同意页
 *   - prompt=consent → 强制显示同意页,即使已授权
 */
export async function GET(request) {
  const url = new URL(request.url);
  const { searchParams } = url;
  const client_id = searchParams.get('client_id');
  const redirect_uri = searchParams.get('redirect_uri');
  const response_type = searchParams.get('response_type');
  const scope = searchParams.get('scope') || 'openid';
  const state = searchParams.get('state') || '';
  const code_challenge = searchParams.get('code_challenge');
  const code_challenge_method = searchParams.get('code_challenge_method') || 'plain';
  const prompt = searchParams.get('prompt') || '';

  if (response_type !== 'code') {
    return NextResponse.json({ error: 'unsupported_response_type' }, { status: 400 });
  }

  const client = findOAuthClient(client_id);
  if (!client || client.status !== 'active') {
    return NextResponse.json({ error: 'invalid_client' }, { status: 400 });
  }

  if (!Array.isArray(client.redirectUris) || !client.redirectUris.includes(redirect_uri)) {
    return NextResponse.json({ error: 'invalid_redirect_uri' }, { status: 400 });
  }

  // ── PKCE 前置校验(#3 修复) ──────────────────────────────────────
  //
  // redirect_uri 已通过白名单校验 —— 从这里往下的错误都按 OAuth 2.0
  // §4.1.2.1 规定,以"重定向 + error 查询参数"的形式回客户端,而不是直接
  // 返回 JSON。因为客户端不会轮询我们的 JSON 响应,它只看 redirect。
  //
  // 规则:
  //   1. 非机密客户端(public)必须带 code_challenge —— 没有 client_secret 时,
  //      PKCE 是对抗 code 截获的唯一屏障
  //   2. 所有客户端若带 code_challenge,method 必须是 S256
  //      (plain 已被 OAuth 2.0 BCP 不推荐,2.1 彻底删除)
  //
  // 这一层通过不代表 token 端可以省略校验 —— 直接调用 /api/oauth/authorize/decide
  // 或伪造请求绕过前端都可能跳过这里,所以 token 端和 decide 端也各自再做一遍
  // (defense in depth)。
  const confidential = isConfidentialClient(client);

  if (!confidential && !code_challenge) {
    const params = new URLSearchParams({
      error: 'invalid_request',
      error_description: 'code_challenge is required for public clients',
      state,
    });
    return NextResponse.redirect(`${redirect_uri}?${params}`);
  }

  if (code_challenge && code_challenge_method !== 'S256') {
    const params = new URLSearchParams({
      error: 'invalid_request',
      error_description: 'code_challenge_method must be S256',
      state,
    });
    return NextResponse.redirect(`${redirect_uri}?${params}`);
  }

  // ── scope 子集校验(第 1 轮遗留 #3.3) ─────────────────────────
  //
  // 原来对请求里的 scope 完全不校验,client 声明里有或没有这个 scope 都照单
  // 全收,userinfo 阶段又无条件返回全部字段 —— 相当于 scope 只是个摆设。
  // 这里强制"请求 scope ⊆ client.scopes":
  //   • 请求里有 client 白名单外的 scope → 拒绝,redirect 回 error=invalid_scope
  //   • openid 缺失 → 由 userinfo 端点拒绝(这里不强求,因为 OAuth 2.0 纯 code
  //     flow 可以不用 OIDC,有些接入方确实不需要身份信息)
  const clientScopes = new Set(client.scopes || []);
  const requestedScopeArr = scope.split(/\s+/).filter(Boolean);
  const unknownScope = requestedScopeArr.find(s => !clientScopes.has(s));
  if (unknownScope) {
    const params = new URLSearchParams({
      error: 'invalid_scope',
      error_description: `scope "${unknownScope}" is not permitted for this client`,
      state,
    });
    return NextResponse.redirect(`${redirect_uri}?${params}`);
  }

  // 未登录 → 登录后回到这里
  const session = await getSession();
  if (!session) {
    const loginUrl = `/auth/login?redirect=${encodeURIComponent(request.url)}`;
    return NextResponse.redirect(new URL(loginUrl, request.url));
  }

  // ── minLevel 服务端强制(第 1 轮遗留 #3.4) ──────────────────
  //
  // 每个 client 可以声明一个 minLevel,只有该级别及以上的用户才能登录这个
  // client。之前 minLevel 只在同意页上当装饰显示,后端没任何拦截 —— 相当于
  // 废字段。现在:
  //   level 映射(越大等级越高):user = 0, member = 1, admin = 2
  //   client.minLevel 是一个数字,用户的 level 必须 >= 它
  //   未满足 → 重定向 OAuth error(access_denied),不继续放行
  const ROLE_LEVEL = { user: 0, member: 1, admin: 2 };
  const userLevel = ROLE_LEVEL[session.user.role] ?? 0;
  const requiredLevel = Number(client.minLevel) || 0;
  if (userLevel < requiredLevel) {
    const params = new URLSearchParams({
      error: 'access_denied',
      error_description: `当前账户等级不足以登录 ${client.name || client.clientId}`,
      state,
    });
    return NextResponse.redirect(`${redirect_uri}?${params}`);
  }

  // 检查是否已存在授权记录(同 user × client × 覆盖 scope)
  const requestedScopes = scope.split(/\s+/).filter(Boolean).sort();
  const existing = db.findOne('oauth_grants', {
    userId: session.user.id,
    clientId: client.clientId,
  });
  const isRevoked = existing?.revoked === true;
  const grantedScopes = (existing?.scopes || []).slice().sort();
  const coversAllScopes = requestedScopes.every(s => grantedScopes.includes(s));

  // 已授权且涵盖所请求权限、且未被用户撤销、且未强制 prompt=consent → 直接发 code
  if (existing && !isRevoked && coversAllScopes && prompt !== 'consent') {
    const code = uuidv4().replace(/-/g, '');
    const codeExpiryMinutes = getSettingInt('OAUTH_CODE_EXPIRY_MINUTES', 10);
    oauthStore.saveCode({
      code,
      clientId: client.clientId,
      userId: session.user.id,
      redirectUri: redirect_uri,
      scope,
      codeChallenge: code_challenge,
      codeChallengeMethod: code_challenge_method,
      expiresAt: new Date(Date.now() + codeExpiryMinutes * 60_000).toISOString(),
    });
    // 更新最后使用时间
    db.updateById('oauth_grants', existing.id, {
      lastUsedAt: new Date().toISOString(),
    });
    const params = new URLSearchParams({ code, state });
    return NextResponse.redirect(`${redirect_uri}?${params}`);
  }

  // 否则 → 跳同意页
  const consentUrl = new URL('/oauth/authorize', request.url);
  consentUrl.search = searchParams.toString();
  return NextResponse.redirect(consentUrl);
}
