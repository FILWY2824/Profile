import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAdmin } from '@/lib/auth.js';
import { db } from '@/lib/db.js';
import { hashPassword } from '@/lib/password.js';
import { listOAuthClients } from '@/lib/oauthClients.js';
import { activityLog } from '@/lib/fileStore.js';
import { getClientIp } from '@/lib/rateLimit.js';

/**
 * GET  /api/admin/oauth-clients         — 列出全部客户端(静态 + 动态合并)
 * POST /api/admin/oauth-clients         — 创建动态客户端,**一次性**返回明文 secret
 *
 * 静态客户端由 config/oauth-clients.js 声明,本接口只读暴露(source=static),
 * 它们的 secret 走 /admin/settings 轮换。动态客户端支持全套 CRUD,本文件负责
 * list + create,单条 get/patch/delete 见 [id]/route.js。
 */

// clientId 合法性:小写字母数字与 - _ . ,长度 3-64。太短容易误撞,太长没意义。
// 不允许大写是为了对齐 OAuth 生态的习惯(Google/GitHub 的 client_id 都是小写)
// 也避免大小写混淆导致"看起来一样但就是查不到"。
const CLIENT_ID_RE = /^[a-z0-9][a-z0-9._-]{2,63}$/;

// 允许的 scope 白名单。请求时只能声明这些,与 config/oauth-clients.js 的
// 约定一致(userinfo 按 scope 裁 claims 的映射在那里)。
const ALLOWED_SCOPES = new Set(['openid', 'profile', 'email', 'qishu.role']);

// 生成一段强随机字符串作为 client_secret 明文。base64url 比 hex 紧凑一点,
// 32 字节 → 43 字符,熵约 256 bit,远超 _CLIENT_SECRET 的最小 16 字符要求。
function generateClientSecret() {
  return crypto.randomBytes(32).toString('base64url');
}

// redirectUris 校验:必须是 http(s):// 开头的绝对 URL。不允许自定义 scheme
// (如 myapp://),目前只针对 web 接入方;将来需要支持原生 App 再扩。
function validateRedirectUri(u) {
  if (typeof u !== 'string' || !u.trim()) return '回调地址不能为空';
  try {
    const url = new URL(u.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return `回调地址必须是 http:// 或 https://,拿到 ${url.protocol}`;
    }
    // 生产环境下 http 非 localhost 禁止 —— 和 sanityCheckStaticClients 同策略
    if (process.env.NODE_ENV === 'production' && url.protocol === 'http:') {
      const host = url.hostname;
      if (!/^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(host)) {
        return `生产环境下非本地回调必须用 https,拿到 ${u}`;
      }
    }
    return null;
  } catch {
    return `${u} 不是合法的 URL`;
  }
}

function validateCreateBody(body) {
  const errors = [];

  const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : '';
  if (!CLIENT_ID_RE.test(clientId)) {
    errors.push({ field: 'clientId', message: 'clientId 必须是 3-64 位小写字母/数字/._- 开头必须是字母或数字' });
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 100) {
    errors.push({ field: 'name', message: '显示名称为必填,不超过 100 字' });
  }

  const redirectUris = Array.isArray(body.redirectUris) ? body.redirectUris : [];
  if (redirectUris.length === 0) {
    errors.push({ field: 'redirectUris', message: '至少配置一条回调地址' });
  }
  for (const u of redirectUris) {
    const err = validateRedirectUri(u);
    if (err) errors.push({ field: 'redirectUris', message: err });
  }

  const scopes = Array.isArray(body.scopes) ? body.scopes : [];
  if (scopes.length === 0) {
    errors.push({ field: 'scopes', message: '至少选择一个 scope(通常包含 openid)' });
  }
  for (const s of scopes) {
    if (!ALLOWED_SCOPES.has(s)) {
      errors.push({ field: 'scopes', message: `未知 scope: ${s}` });
    }
  }

  const minLevel = Number.isInteger(body.minLevel) ? body.minLevel : 0;
  if (minLevel < 0 || minLevel > 2) {
    errors.push({ field: 'minLevel', message: 'minLevel 必须是 0/1/2(user/member/admin)' });
  }

  const description = typeof body.description === 'string' ? body.description.trim() : '';
  if (description.length > 500) {
    errors.push({ field: 'description', message: '描述不超过 500 字' });
  }

  const homepageUrl = typeof body.homepageUrl === 'string' ? body.homepageUrl.trim() : '';
  const logoUrl     = typeof body.logoUrl === 'string' ? body.logoUrl.trim() : '';

  return {
    errors,
    sanitized: {
      clientId, name, description, homepageUrl, logoUrl,
      minLevel, redirectUris: redirectUris.map(u => u.trim()),
      scopes: Array.from(new Set(scopes)),
    },
  };
}

export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // listOAuthClients 返回 [{ ..., _source: 'static' | 'dynamic' }, ...]
  // 我们在此脱敏:clientSecretHash 永远不回给前端,secretEnv 对静态客户端保留
  // (给管理员一个提示"到 /admin/settings 的哪个键能改这个 secret")。
  const items = listOAuthClients().map(c => ({
    id: c.id,
    clientId: c.clientId,
    name: c.name,
    description: c.description || '',
    homepageUrl: c.homepageUrl || '',
    logoUrl: c.logoUrl || '',
    minLevel: c.minLevel ?? 0,
    redirectUris: c.redirectUris || [],
    scopes: c.scopes || [],
    status: c.status || 'active',
    source: c._source,
    secretEnvKey: c._source === 'static' ? c._secretEnv : null,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }));

  return NextResponse.json({ items });
}

export async function POST(request) {
  const auth = await requireAdmin();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json();
    const { errors, sanitized } = validateCreateBody(body);
    if (errors.length) {
      return NextResponse.json({ error: '参数不合法', fieldErrors: errors }, { status: 400 });
    }

    // clientId 唯一性 —— 动态表 UNIQUE + 静态表不能同名
    const existsDynamic = db.findOne('oauth_clients', { clientId: sanitized.clientId });
    if (existsDynamic) {
      return NextResponse.json(
        { error: 'clientId 已被占用', fieldErrors: [{ field: 'clientId', message: '已存在同名客户端' }] },
        { status: 409 }
      );
    }
    // 静态客户端优先级高于动态,不允许与静态同 id,否则会被静态覆盖
    const { STATIC_OAUTH_CLIENTS } = await import('@/config/oauth-clients.js');
    if (STATIC_OAUTH_CLIENTS.some(c => c.clientId === sanitized.clientId)) {
      return NextResponse.json(
        { error: 'clientId 与静态客户端冲突', fieldErrors: [{ field: 'clientId', message: '这个 id 被代码里的静态客户端占用,请换一个' }] },
        { status: 409 }
      );
    }

    // 生成 secret —— 明文**只**在响应里出现一次,DB 里只存 bcrypt 哈希
    const secret = generateClientSecret();
    const secretHash = hashPassword(secret);

    const created = db.insert('oauth_clients', {
      clientId: sanitized.clientId,
      clientSecretHash: secretHash,
      name: sanitized.name,
      description: sanitized.description,
      homepageUrl: sanitized.homepageUrl,
      logoUrl: sanitized.logoUrl,
      minLevel: sanitized.minLevel,
      redirectUris: sanitized.redirectUris,
      scopes: sanitized.scopes,
      status: 'active',
    });

    activityLog.record({
      userId: auth.session.user.id, username: auth.session.user.name, email: auth.session.user.email,
      action: 'admin.oauth_client_create', target: 'oauth_client',
      detail: `创建 OAuth 客户端 ${sanitized.clientId}`,
      ip: getClientIp(request),
      meta: { clientId: sanitized.clientId, scopes: sanitized.scopes },
    });

    return NextResponse.json({
      success: true,
      client: {
        id: created.id,
        clientId: created.clientId,
        name: created.name,
        source: 'dynamic',
      },
      // clientSecret 明文 —— 只在本次创建响应出现,之后只能轮换才能拿到新的
      clientSecret: secret,
      clientSecretWarning: '这是 client_secret 的唯一一次明文展示。请立即复制并安全存储。之后将无法再查看,只能重新生成(轮换)。',
    }, { status: 201 });
  } catch (err) {
    console.error('Create OAuth client error:', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
