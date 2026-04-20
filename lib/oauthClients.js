/**
 * OAuth 客户端查询与秘钥校验(静态配置 + 动态 DB 合并视图)
 * ===========================================================================
 * 所有 OAuth 路由 (authorize / token / introspect / client-info / ...) 都
 * 必须走这里的 findOAuthClient / verifyClientSecret,不要再直接调用
 * db.findOne('oauth_clients', ...)。
 *
 * 查找顺序: 静态配置 (config/oauth-clients.js) → 动态 DB (oauth_clients 表)
 * 静态客户端的 clientId 如果与动态记录冲突,静态配置胜出。
 *
 * 秘钥校验的两种形态:
 *   • 静态客户端 — 明文 secret 先查 settings 表,再查 process.env[secretEnv]。
 *     两个都没有视为校验失败(而不是放行)。
 *   • 动态客户端 — 存的是 bcrypt 哈希 (clientSecretHash),用 bcrypt.compareSync。
 * ===========================================================================
 */

import crypto from 'crypto';
import { db } from './db.js';
import { verifyPassword } from './password.js';
import { getSetting } from './settings.js';
import { STATIC_OAUTH_CLIENTS, sanityCheckStaticClients } from '../config/oauth-clients.js';

// 模块加载时跑一次 sanity 检查。NODE_ENV=production 下,这会在发现明文 http://
// 非 localhost redirect URI 时 throw,让服务启动失败 —— 比让 OAuth 在运行时
// 静默异常早发现得多。开发环境下这函数是 no-op。
try {
  sanityCheckStaticClients();
} catch (err) {
  // 让错误往外抛,阻断启动。next build 期间如果 import 到这里也会失败 ——
  // 这是有意的:你不想把一个明文回调的配置打进生产 artifact。
  console.error(err.message);
  throw err;
}

function normalizeStatic(entry) {
  return {
    id: `static:${entry.clientId}`,
    clientId: entry.clientId,
    name: entry.name || entry.clientId,
    description: entry.description || '',
    homepageUrl: entry.homepageUrl || '',
    logoUrl: entry.logoUrl || '',
    minLevel: entry.minLevel ?? 0,
    redirectUris: Array.isArray(entry.redirectUris) ? entry.redirectUris.slice() : [],
    scopes: Array.isArray(entry.scopes) ? entry.scopes.slice() : [],
    status: entry.status || 'active',
    createdAt: '1970-01-01T00:00:00.000Z',
    updatedAt: '1970-01-01T00:00:00.000Z',
    _source: 'static',
    _secretEnv: entry.secretEnv || null,
  };
}

export function findOAuthClient(clientId) {
  if (!clientId) return null;
  const staticEntry = STATIC_OAUTH_CLIENTS.find(c => c.clientId === clientId);
  if (staticEntry) return normalizeStatic(staticEntry);
  const dynamic = db.findOne('oauth_clients', { clientId });
  if (dynamic) return { ...dynamic, _source: 'dynamic' };
  return null;
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) {
    const dummy = Buffer.alloc(ab.length);
    try { crypto.timingSafeEqual(ab, dummy); } catch {}
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

export function verifyClientSecret(client, presentedSecret) {
  if (!client || typeof presentedSecret !== 'string' || !presentedSecret) return false;

  if (client._source === 'static') {
    const envName = client._secretEnv;
    if (!envName) return false;
    // 先看 settings,再看 process.env,都没有 → 失败
    const expected = getSetting(envName) || process.env[envName];
    if (!expected) return false;
    return safeEqual(presentedSecret, expected);
  }

  if (client.clientSecretHash) {
    return verifyPassword(presentedSecret, client.clientSecretHash);
  }
  return false;
}

/**
 * 判断一个 client 是否是"机密客户端"(confidential client) —— 即:在服务端
 * 配置了 client_secret,不能被信任"裸奔"过来的 authorization_code 请求。
 *
 * 判定规则:
 *   • 静态客户端 — 声明了 secretEnv,并且 settings 表 / process.env 里真的
 *     存了一个非空秘钥。单纯声明但未填值的走 public client 路径(比如 SPA)。
 *   • 动态客户端 — clientSecretHash 非空。
 *
 * 在 /api/oauth/token (H3 修复)里,机密客户端必须携带有效 client_secret
 * 或 Basic Auth,否则直接拒绝 —— 即使它带了合法的 authorization_code 也不行。
 */
export function isConfidentialClient(client) {
  if (!client) return false;
  if (client._source === 'static') {
    const envName = client._secretEnv;
    if (!envName) return false;
    const expected = getSetting(envName) || process.env[envName];
    return !!expected;
  }
  return !!client.clientSecretHash;
}

export function listOAuthClients() {
  const staticList = STATIC_OAUTH_CLIENTS.map(normalizeStatic);
  const dynamicList = db.findAll('oauth_clients') || [];
  const staticIds = new Set(staticList.map(c => c.clientId));
  const mergedDynamic = dynamicList
    .filter(c => !staticIds.has(c.clientId))
    .map(c => ({ ...c, _source: 'dynamic' }));
  return [...staticList, ...mergedDynamic];
}
