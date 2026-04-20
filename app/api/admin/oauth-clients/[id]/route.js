import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAdmin } from '@/lib/auth.js';
import { db } from '@/lib/db.js';
import { database } from '@/lib/database.js';
import { hashPassword } from '@/lib/password.js';
import { activityLog } from '@/lib/fileStore.js';
import { getClientIp } from '@/lib/rateLimit.js';

/**
 * GET    /api/admin/oauth-clients/[id]           — 单个动态客户端详情(静态返回 400)
 * PATCH  /api/admin/oauth-clients/[id]           — 编辑字段 / 轮换秘钥 / 启停
 * DELETE /api/admin/oauth-clients/[id]           — 删除 + 级联清理 grants/tokens/codes
 *
 * URL 参数 id 对应 oauth_clients.id(uuid),**不是** clientId,因为 clientId
 * 在创建后不可变,用它当路由标识还能接受,但我们为了和其他管理路由风格一致
 * (users/[id] 也是 uuid),统一用 id。前端列表页会把这两个字段都带过去。
 */

const ALLOWED_SCOPES = new Set(['openid', 'profile', 'email', 'qishu.role']);

function generateClientSecret() {
  return crypto.randomBytes(32).toString('base64url');
}

function validateRedirectUri(u) {
  if (typeof u !== 'string' || !u.trim()) return '回调地址不能为空';
  try {
    const url = new URL(u.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return `回调地址必须是 http:// 或 https://`;
    }
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

function safeClient(c) {
  return {
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
    source: 'dynamic',
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

export async function GET(request, { params }) {
  const auth = await requireAdmin();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const client = db.findById('oauth_clients', id);
  if (!client) return NextResponse.json({ error: '客户端不存在' }, { status: 404 });

  return NextResponse.json({ client: safeClient(client) });
}

export async function PATCH(request, { params }) {
  const auth = await requireAdmin();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const client = db.findById('oauth_clients', id);
  if (!client) return NextResponse.json({ error: '客户端不存在' }, { status: 404 });

  try {
    const body = await request.json();
    const { action } = body;

    // ── action = rotate-secret ─────────────────────────────────────
    //
    // 重新生成一个新的 client_secret,存 bcrypt 哈希,同时**立即撤销**该
    // client 下所有未撤销的 access_token / refresh_token —— 因为老 secret
    // 不再能用,对应已发出的 token 也不应再被当成受信任会话。接入方需要用
    // 新 secret 重新走一次授权流程。
    if (action === 'rotate-secret') {
      const newSecret = generateClientSecret();
      const newHash = hashPassword(newSecret);
      database.transaction(() => {
        db.updateById('oauth_clients', id, { clientSecretHash: newHash });
        database.prepare(
          `UPDATE oauth_tokens SET revoked = 1, revokedAt = ?
           WHERE clientId = ? AND revoked = 0`
        ).run(new Date().toISOString(), client.clientId);
      })();
      activityLog.record({
        userId: auth.session.user.id, username: auth.session.user.name, email: auth.session.user.email,
        action: 'admin.oauth_client_rotate_secret', target: 'oauth_client',
        detail: `轮换了 OAuth 客户端 ${client.clientId} 的秘钥(已撤销该客户端所有在用 token)`,
        ip: getClientIp(request),
        meta: { clientId: client.clientId },
      });
      return NextResponse.json({
        success: true,
        clientSecret: newSecret,
        clientSecretWarning: '这是 client_secret 的唯一一次明文展示。请立即复制并安全存储。该 client 下所有在用 token 已全部撤销,接入方需用新 secret 重新走授权流程。',
      });
    }

    // ── action = toggle-status (启停) ───────────────────────────────
    if (action === 'toggle-status') {
      const next = client.status === 'active' ? 'disabled' : 'active';
      db.updateById('oauth_clients', id, { status: next });
      activityLog.record({
        userId: auth.session.user.id, username: auth.session.user.name, email: auth.session.user.email,
        action: 'admin.oauth_client_toggle', target: 'oauth_client',
        detail: `${next === 'active' ? '启用' : '停用'} OAuth 客户端 ${client.clientId}`,
        ip: getClientIp(request),
        meta: { clientId: client.clientId, newStatus: next },
      });
      return NextResponse.json({ success: true, client: safeClient({ ...client, status: next }) });
    }

    // ── 普通字段编辑 ────────────────────────────────────────────────
    //
    // 可以改:name, description, homepageUrl, logoUrl, minLevel, redirectUris, scopes
    // 不能改:clientId(OAuth 规范约定稳定),clientSecretHash(走 rotate-secret),
    //        status(走 toggle-status)。
    const errors = [];
    const updates = {};

    if (body.name !== undefined) {
      const n = String(body.name).trim();
      if (!n || n.length > 100) errors.push({ field: 'name', message: '显示名称为必填,不超过 100 字' });
      else updates.name = n;
    }
    if (body.description !== undefined) {
      const d = String(body.description).trim();
      if (d.length > 500) errors.push({ field: 'description', message: '描述不超过 500 字' });
      else updates.description = d;
    }
    if (body.homepageUrl !== undefined) updates.homepageUrl = String(body.homepageUrl).trim();
    if (body.logoUrl !== undefined)     updates.logoUrl     = String(body.logoUrl).trim();

    if (body.minLevel !== undefined) {
      const lvl = Number(body.minLevel);
      if (![0, 1, 2].includes(lvl)) errors.push({ field: 'minLevel', message: 'minLevel 必须是 0/1/2' });
      else updates.minLevel = lvl;
    }

    if (body.redirectUris !== undefined) {
      if (!Array.isArray(body.redirectUris) || body.redirectUris.length === 0) {
        errors.push({ field: 'redirectUris', message: '至少配置一条回调地址' });
      } else {
        for (const u of body.redirectUris) {
          const err = validateRedirectUri(u);
          if (err) errors.push({ field: 'redirectUris', message: err });
        }
        if (!errors.some(e => e.field === 'redirectUris')) {
          updates.redirectUris = body.redirectUris.map(u => String(u).trim());
        }
      }
    }

    if (body.scopes !== undefined) {
      if (!Array.isArray(body.scopes) || body.scopes.length === 0) {
        errors.push({ field: 'scopes', message: '至少选择一个 scope' });
      } else {
        for (const s of body.scopes) {
          if (!ALLOWED_SCOPES.has(s)) errors.push({ field: 'scopes', message: `未知 scope: ${s}` });
        }
        if (!errors.some(e => e.field === 'scopes')) {
          updates.scopes = Array.from(new Set(body.scopes));
        }
      }
    }

    if (errors.length) {
      return NextResponse.json({ error: '参数不合法', fieldErrors: errors }, { status: 400 });
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: '没有可更新的字段' }, { status: 400 });
    }

    const updated = db.updateById('oauth_clients', id, updates);
    activityLog.record({
      userId: auth.session.user.id, username: auth.session.user.name, email: auth.session.user.email,
      action: 'admin.oauth_client_update', target: 'oauth_client',
      detail: `编辑 OAuth 客户端 ${client.clientId} 的配置`,
      ip: getClientIp(request),
      meta: { clientId: client.clientId, keys: Object.keys(updates) },
    });
    return NextResponse.json({ success: true, client: safeClient(updated) });
  } catch (err) {
    console.error('OAuth client update error:', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  const auth = await requireAdmin();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const client = db.findById('oauth_clients', id);
  if (!client) return NextResponse.json({ error: '客户端不存在' }, { status: 404 });

  // 级联清理 —— 这个 client 相关的所有运行时数据都要一起删,否则会留孤儿行。
  // 所有 DELETE 放在一个事务里,要么都成功要么都回滚。
  const cleanup = database.transaction(() => {
    database.prepare('DELETE FROM oauth_grants WHERE clientId = ?').run(client.clientId);
    database.prepare('DELETE FROM oauth_tokens WHERE clientId = ?').run(client.clientId);
    database.prepare('DELETE FROM oauth_codes  WHERE clientId = ?').run(client.clientId);
    database.prepare('DELETE FROM oauth_clients WHERE id = ?').run(id);
  });
  cleanup();

  activityLog.record({
    userId: auth.session.user.id, username: auth.session.user.name, email: auth.session.user.email,
    action: 'admin.oauth_client_delete', target: 'oauth_client',
    detail: `删除 OAuth 客户端 ${client.clientId}(含级联清理)`,
    ip: getClientIp(request),
    meta: { clientId: client.clientId },
  });

  return NextResponse.json({ success: true });
}
