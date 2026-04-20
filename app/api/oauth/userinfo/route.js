import { NextResponse } from 'next/server';
import { db } from '@/lib/db.js';
import { oauthStore } from '@/lib/fileStore.js';

/**
 * GET/POST /api/oauth/userinfo (OIDC)
 *
 * 第 1 轮遗留 #3.3 修复:按 token 上绑定的 scope 裁剪 claims。
 *
 * Claims vs scope 映射(OIDC Core §5.4):
 *   openid  → sub(必返回;没有 openid 视为缺失必要 scope,拒绝)
 *   profile → name, avatar (picture)
 *   email   → email, email_verified
 *   qishu.role → role(自定 scope,非标准 OIDC;默认 client 不授予,需在
 *                     oauth_clients.scopes 里白名单)
 *
 * 注意:role 以前是无条件返回的,现在必须请求方明确申请 qishu.role 才会给。
 * 这是一个 breaking change —— 如果某个接入方以前在代码里读 userinfo.role,
 * 它在这次升级后会拿到 undefined,需要到 oauth-clients.js 里给它加上
 * qishu.role scope。
 */

function getToken(request) {
  const auth = request.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

function validate(token) {
  if (!token) return { ok: false, error: 'invalid_token' };

  const result = oauthStore.findToken(token);
  if (!result) return { ok: false, error: 'invalid_token' };

  const { record } = result;
  if (record.revoked) return { ok: false, error: 'invalid_token' };
  if (new Date(record.expiresAt) < new Date()) return { ok: false, error: 'invalid_token' };

  const user = db.findById('users', record.userId);
  if (!user || user.status !== 'active') return { ok: false, error: 'invalid_token' };

  // 授权被用户撤销 → 立即失效
  const grant = db.findOne('oauth_grants', { userId: user.id, clientId: record.clientId });
  if (grant?.revoked) return { ok: false, error: 'invalid_token' };

  return { ok: true, record, user };
}

/**
 * 按 scope 构造 userinfo 响应。
 *
 * scope 的存储形式是空格分隔字符串(OAuth 规范)。
 * 我们在这里做严格裁剪:没声明的 scope → 对应 claim 不出现在响应里,而非
 * 输出空值。这样第三方应用判断"是否授予此信息"就能用 in 运算符,而不是
 * 既判断存在又判断非空。
 */
function buildUserinfo(user, scopeStr) {
  const scopes = new Set(String(scopeStr || '').split(/\s+/).filter(Boolean));

  // openid 是 OIDC 的最小必要 scope;没有它就不该走 userinfo 端点
  if (!scopes.has('openid')) {
    return null;
  }

  const out = { sub: user.id };

  if (scopes.has('profile')) {
    out.name = user.name;
    out.picture = user.avatar || '';
  }

  if (scopes.has('email')) {
    out.email = user.email;
    out.email_verified = !!user.emailVerified;
  }

  // 自定:qishu.role。非标准 claim,需要 client 明确申请。
  if (scopes.has('qishu.role')) {
    out.role = user.role;
  }

  return out;
}

async function handle(request) {
  const v = validate(getToken(request));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 401 });
  const body = buildUserinfo(v.user, v.record.scope);
  if (!body) {
    // token 没有 openid scope —— 技术上是 invalid_token 给 userinfo 用
    return NextResponse.json({ error: 'insufficient_scope' }, {
      status: 403,
      headers: { 'WWW-Authenticate': 'Bearer error="insufficient_scope", scope="openid"' },
    });
  }
  return NextResponse.json(body);
}

export async function GET(request)  { return handle(request); }
export async function POST(request) { return handle(request); }
