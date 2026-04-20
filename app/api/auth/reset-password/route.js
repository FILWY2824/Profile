import { NextResponse } from 'next/server';
import { db } from '@/lib/db.js';
import { database } from '@/lib/database.js';
import { hashPassword, validatePasswordStrength } from '@/lib/password.js';
import { verificationCodes, activityLog, getVerificationCodeMaxAttempts } from '@/lib/fileStore.js';
import { getClientIp, rateLimit } from '@/lib/rateLimit.js';
import { getSettingInt } from '@/lib/settings.js';

export async function POST(request) {
  try {
    const ip = getClientIp(request);
    const rl = rateLimit('reset-pw:ip', ip, {
      max: getSettingInt('RL_RESET_PW_IP_MAX', 20),
      windowMs: getSettingInt('RL_RESET_PW_IP_WINDOW_MINUTES', 60) * 60_000,
    });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: '请求过于频繁,请稍后再试' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
      );
    }

    const { email, code, newPassword } = await request.json();
    if (!email || !code || !newPassword) {
      return NextResponse.json({ error: '所有字段均为必填' }, { status: 400 });
    }

    const normalizedEmail = String(email).toLowerCase().trim();

    const strength = validatePasswordStrength(newPassword);
    if (!strength.valid) {
      return NextResponse.json({ error: strength.message }, { status: 400 });
    }

    // 尝试次数限制 —— 上限由 settings.VERIFICATION_CODE_MAX_ATTEMPTS 决定
    const pending = verificationCodes.peek(normalizedEmail, 'password-reset');
    const maxAttempts = getVerificationCodeMaxAttempts();
    if (pending && (pending.record.attempts || 0) >= maxAttempts) {
      return NextResponse.json(
        { error: '验证码错误次数过多,请重新发送验证码' }, { status: 429 }
      );
    }

    const found = verificationCodes.find(normalizedEmail, code, 'password-reset');
    if (!found) {
      verificationCodes.incrementAttempts(normalizedEmail, 'password-reset');
      return NextResponse.json({ error: '验证码无效或已过期' }, { status: 400 });
    }

    const user = db.findOne('users', { email: normalizedEmail });
    if (!user) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 });
    }

    // #9 事务保护:markUsed + 改密码 + 写日志 作为单一事务
    database.transaction(() => {
      verificationCodes.markUsed(normalizedEmail, code, 'password-reset');
      db.updateById('users', user.id, {
        passwordHash: hashPassword(newPassword),
        passwordChangedAt: new Date().toISOString(), // 使旧 JWT 立即失效
      });
      activityLog.record({
        userId: user.id, username: user.name, email: user.email,
        action: 'user.reset_password', detail: '通过邮箱验证码重置密码', ip,
      });
    })();

    return NextResponse.json({ success: true, message: '密码重置成功,请重新登录' });
  } catch (err) {
    console.error('Reset password error:', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
