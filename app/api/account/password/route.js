import { NextResponse } from 'next/server';
import { requireAuth, clearAuthCookie } from '@/lib/auth.js';
import { db } from '@/lib/db.js';
import { database } from '@/lib/database.js';
import { hashPassword, validatePasswordStrength, verifyPassword } from '@/lib/password.js';
import { verificationCodes, activityLog, getVerificationCodeMaxAttempts } from '@/lib/fileStore.js';
import { sendPasswordResetCode } from '@/lib/email.js';
import { getClientIp, rateLimit } from '@/lib/rateLimit.js';
import { getSettingInt } from '@/lib/settings.js';

/**
 * POST /api/account/password?action=send-code  → 向当前账户邮箱发送验证码
 * POST /api/account/password                   → { code, newPassword } 完成修改
 *
 * 修改策略(简化版):只要求邮箱验证码 + 新密码。
 * 邮箱验证码的前提是已经登录 + 邮箱由用户所有,相当于"会话 + 邮箱双因素",
 * 省去了记旧密码的步骤 —— 与 Google / GitHub 这类提供商近似。
 *
 * 节流上限与窗口由 /admin/settings 的 RL_CHANGE_PW_SEND_* / RL_CHANGE_PW_SUBMIT_* 控制;
 * 验证码尝试次数上限由 VERIFICATION_CODE_MAX_ATTEMPTS 控制。
 */
export async function POST(request) {
  const auth = await requireAuth();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const ip = getClientIp(request);
  const user = auth.session.user;
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  // ── 发送验证码 ──
  if (action === 'send-code') {
    const rl = rateLimit(`change-pw-send:${user.id}`, ip, {
      max: getSettingInt('RL_CHANGE_PW_SEND_MAX', 5),
      windowMs: getSettingInt('RL_CHANGE_PW_SEND_WINDOW_MINUTES', 60) * 60_000,
    });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `验证码发送过于频繁,请 ${rl.retryAfter} 秒后重试` },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
      );
    }
    const code = verificationCodes.generateCode();
    verificationCodes.save(user.email, code, 'change-password', { ip });
    const result = await sendPasswordResetCode(user.email, code);
    return NextResponse.json({
      success: true,
      message: '验证码已发送至您的邮箱',
      ...(process.env.NODE_ENV !== 'production' && result.code && { devCode: result.code }),
    });
  }

  // ── 执行修改 ──
  try {
    const rl = rateLimit(`change-pw-submit:${user.id}`, ip, {
      max: getSettingInt('RL_CHANGE_PW_SUBMIT_MAX', 10),
      windowMs: getSettingInt('RL_CHANGE_PW_SUBMIT_WINDOW_MINUTES', 60) * 60_000,
    });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: '请求过于频繁,请稍后再试' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
      );
    }

    const { code, newPassword } = await request.json();
    if (!code || !newPassword) {
      return NextResponse.json({ error: '验证码和新密码均为必填' }, { status: 400 });
    }

    const strength = validatePasswordStrength(newPassword);
    if (!strength.valid) {
      return NextResponse.json({ error: strength.message }, { status: 400 });
    }

    const fresh = db.findById('users', user.id);
    if (!fresh) return NextResponse.json({ error: '用户不存在' }, { status: 404 });

    // 禁止与旧密码相同 —— 避免"修改密码"实际上没改
    if (verifyPassword(newPassword, fresh.passwordHash)) {
      return NextResponse.json({ error: '新密码不能与旧密码相同' }, { status: 400 });
    }

    // 验证码尝试计数 —— 上限由 settings.VERIFICATION_CODE_MAX_ATTEMPTS 决定
    const pending = verificationCodes.peek(user.email, 'change-password');
    if (pending && (pending.record.attempts || 0) >= getVerificationCodeMaxAttempts()) {
      return NextResponse.json(
        { error: '验证码错误次数过多,请重新发送' }, { status: 429 }
      );
    }

    const found = verificationCodes.find(user.email, code, 'change-password');
    if (!found) {
      verificationCodes.incrementAttempts(user.email, 'change-password');
      return NextResponse.json({ error: '验证码无效或已过期' }, { status: 400 });
    }

    // #9 事务保护:markUsed + 改密码 + 写日志 作为单一事务
    database.transaction(() => {
      verificationCodes.markUsed(user.email, code, 'change-password');
      db.updateById('users', user.id, {
        passwordHash: hashPassword(newPassword),
        passwordChangedAt: new Date().toISOString(),
      });
      activityLog.record({
        userId: user.id, username: user.name, email: user.email,
        action: 'user.change_password', detail: '修改了登录密码', ip,
      });
    })();

    const res = NextResponse.json({ success: true, message: '密码修改成功,请重新登录' });
    clearAuthCookie(res);
    return res;
  } catch (err) {
    console.error('Change password error:', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
