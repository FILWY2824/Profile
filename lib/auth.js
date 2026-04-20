import jwt from 'jsonwebtoken';
import { cookies } from 'next/headers';
import { db } from './db.js';
import { getSetting, getSettingInt } from './settings.js';

const NODE_ENV = process.env.NODE_ENV;
const DEV_FALLBACK = 'qishu-dev-secret-change-in-production';
const COOKIE_NAME = 'qishu_token';

/**
 * 会话有效期 —— 从 settings 表的 SESSION_EXPIRY_DAYS 读取(默认 7 天)。
 * 每次签发 / 设置 cookie 时都重新读,所以管理员在后台改了这个值后
 * 新签的 token 和 cookie 都会立即用新值;已签发的旧 token 继续按
 * 自己签发时的 exp 生效,直到过期或改了 JWT_SECRET 为止。
 * 范围限制:1 ~ 365 天,超出就 clamp。
 */
function getSessionExpirySeconds() {
  const days = getSettingInt('SESSION_EXPIRY_DAYS', 7);
  const clamped = Math.max(1, Math.min(365, days));
  return clamped * 86400;
}

/**
 * JWT_SECRET 的唯一权威来源是 settings 表(lib/settings.js)。
 * 如果表里没有(例如迁移前尚未启动过 init),会依序回退到 process.env;
 * 生产环境下二者都缺就直接抛错,防止签发可伪造的 Token。
 *
 * 注意:每次请求都重新读一次 —— 这样管理员在后台改了 JWT_SECRET 能
 * 立即生效(所有旧 token 自动失效);成本很低(设置读取内部有缓存)。
 */
function resolveJwtSecret() {
  let secret = getSetting('JWT_SECRET');
  if (!secret) {
    if (NODE_ENV === 'production') {
      throw new Error(
        '[FATAL] JWT_SECRET 未配置。请在 /admin/settings 中设置一个至少 32 位的随机字符串。'
      );
    }
    console.warn('[WARN] JWT_SECRET 未配置,已回退到开发默认值 —— 切勿用于生产!');
    secret = DEV_FALLBACK;
  } else if (NODE_ENV === 'production' && secret.length < 32) {
    throw new Error('[FATAL] 生产环境 JWT_SECRET 长度必须 ≥ 32 字符。');
  }
  return secret;
}

export function signToken(payload) {
  return jwt.sign(payload, resolveJwtSecret(), { expiresIn: getSessionExpirySeconds() });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, resolveJwtSecret());
  } catch {
    return null;
  }
}

export async function getSession() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    if (!token) return null;
    const payload = verifyToken(token);
    if (!payload) return null;
    const user = db.findById('users', payload.userId);
    if (!user || user.status !== 'active') return null;

    // 改密后旧 token 失效
    if (user.passwordChangedAt && payload.iat) {
      const changedAt = Math.floor(new Date(user.passwordChangedAt).getTime() / 1000);
      if (changedAt > payload.iat) return null;
    }
    return { user, payload };
  } catch {
    return null;
  }
}

export async function requireAuth() {
  const session = await getSession();
  if (!session) return { error: '未登录', status: 401 };
  return { session };
}

export async function requireAdmin() {
  const session = await getSession();
  if (!session) return { error: '未登录', status: 401 };
  if (session.user.role !== 'admin') return { error: '无权限', status: 403 };
  return { session };
}

export function setAuthCookie(response, token) {
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: getSessionExpirySeconds(),
    path: '/',
  });
}

export function clearAuthCookie(response) {
  response.cookies.set(COOKIE_NAME, '', {
    httpOnly: true,
    secure: NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });
}

export { COOKIE_NAME };
