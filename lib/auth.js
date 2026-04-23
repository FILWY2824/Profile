import jwt from 'jsonwebtoken';
import { cookies } from 'next/headers';
import { db } from './db.js';
import { getSettingInt } from './settings.js';

const NODE_ENV = process.env.NODE_ENV;
const DEV_FALLBACK = 'qishu-dev-secret-change-before-production-000000000000000000000000';
const COOKIE_NAME = 'qishu_token';

function getSessionExpirySeconds() {
  const days = getSettingInt('SESSION_EXPIRY_DAYS', 7);
  const clamped = Math.max(1, Math.min(365, days));
  return clamped * 86400;
}

function resolveJwtSecret() {
  const secret = process.env.JWT_SECRET?.trim();
  if (secret) {
    if (NODE_ENV === 'production' && secret.length < 64) {
      throw new Error('[FATAL] 生产环境 JWT_SECRET 长度必须 ≥ 64 字符。');
    }
    return secret;
  }

  if (NODE_ENV === 'production') {
    throw new Error('[FATAL] JWT_SECRET 未配置。请在 .env 或进程环境变量中设置一个至少 64 字符的随机字符串。');
  }

  console.warn('[WARN] JWT_SECRET 未配置,已回退到开发默认值 —— 切勿用于生产!');
  return DEV_FALLBACK;
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
