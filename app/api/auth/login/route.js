import { NextResponse } from 'next/server';
import { db } from '@/lib/db.js';
import { verifyPassword, hashPassword } from '@/lib/password.js';
import { signToken, setAuthCookie } from '@/lib/auth.js';
import { loginHistory, activityLog } from '@/lib/fileStore.js';
import { getClientIp, rateLimit } from '@/lib/rateLimit.js';
import { getSettingInt } from '@/lib/settings.js';
import { verifyTurnstile, isTurnstileEnabled } from '@/lib/turnstile.js';

// 防时序侧信道:账号不存在时也跑一次等时的 bcrypt 比较。
const DUMMY_HASH = hashPassword('__dummy__that_nobody_uses__');

export async function POST(request) {
  try {
    const ip = getClientIp(request);
    const userAgent = request.headers.get('user-agent') || 'unknown';

    const ipRl = rateLimit('login:ip', ip, {
      max: getSettingInt('RL_LOGIN_IP_MAX', 20),
      windowMs: getSettingInt('RL_LOGIN_IP_WINDOW_MINUTES', 1) * 60_000,
    });
    if (!ipRl.allowed) {
      return NextResponse.json(
        { error: `请求过于频繁,请 ${ipRl.retryAfter} 秒后重试` },
        { status: 429, headers: { 'Retry-After': String(ipRl.retryAfter) } }
      );
    }

    const { email, password, turnstileToken } = await request.json();
    if (!email || !password) {
      return NextResponse.json({ error: '邮箱和密码不能为空' }, { status: 400 });
    }

    // Cloudflare Turnstile 机器人防护(若启用)——  放在业务逻辑之前,
    // 确保所有"拿得到 401/403"的路径都被人机挑战保护。未启用时 verifyTurnstile
    // 直接返回 ok:true,不影响流程。
    if (isTurnstileEnabled()) {
      const tr = await verifyTurnstile(turnstileToken, ip);
      if (!tr.ok) {
        return NextResponse.json({ error: tr.error, code: 'TURNSTILE_FAILED' }, { status: 400 });
      }
    }

    const normalizedEmail = String(email).toLowerCase().trim();

    const emailRl = rateLimit('login:email', normalizedEmail, {
      max: getSettingInt('RL_LOGIN_EMAIL_MAX', 10),
      windowMs: getSettingInt('RL_LOGIN_EMAIL_WINDOW_MINUTES', 5) * 60_000,
    });
    if (!emailRl.allowed) {
      return NextResponse.json(
        { error: `该账号尝试过多,请 ${emailRl.retryAfter} 秒后重试` },
        { status: 429, headers: { 'Retry-After': String(emailRl.retryAfter) } }
      );
    }

    const user = db.findOne('users', { email: normalizedEmail });

    const passwordOk = user
      ? verifyPassword(password, user.passwordHash)
      : (verifyPassword(password, DUMMY_HASH), false);

    if (!user || !passwordOk) {
      loginHistory.record(
        user?.id || null, normalizedEmail, ip, userAgent, false,
        user ? '密码错误' : '用户不存在'
      );
      return NextResponse.json({ error: '邮箱或密码错误' }, { status: 401 });
    }

    if (!user.emailVerified) {
      loginHistory.record(user.id, normalizedEmail, ip, userAgent, false, '邮箱未验证');
      return NextResponse.json(
        { error: '请先验证邮箱后再登录', code: 'EMAIL_NOT_VERIFIED' },
        { status: 403 }
      );
    }
    if (user.status !== 'active') {
      const reason = user.status === 'banned' ? '账号已封禁' : '账号不可用';
      loginHistory.record(user.id, normalizedEmail, ip, userAgent, false, reason);
      return NextResponse.json({ error: reason, code: 'ACCOUNT_UNAVAILABLE' }, { status: 403 });
    }

    loginHistory.record(user.id, normalizedEmail, ip, userAgent, true, '');
    activityLog.record({
      userId: user.id, username: user.name, email: user.email,
      action: 'user.login', detail: '用户登录', ip,
    });
    // 记录最近一次登录的 IP + 时间(用于 admin 页面显示)
    db.updateById('users', user.id, {
      lastLoginIp: ip,
      lastLoginAt: new Date().toISOString(),
    });

    const token = signToken({ userId: user.id, email: user.email, role: user.role });
    const response = NextResponse.json({
      success: true,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
    setAuthCookie(response, token);
    return response;
  } catch (err) {
    console.error('Login error:', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
