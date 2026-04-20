import { NextResponse } from 'next/server';
import { db } from '@/lib/db.js';
import { hashPassword, validatePasswordStrength } from '@/lib/password.js';
import { verificationCodes } from '@/lib/fileStore.js';
import { sendVerificationCode } from '@/lib/email.js';
import { getSettingInt } from '@/lib/settings.js';
import { verifyTurnstile, isTurnstileEnabled } from '@/lib/turnstile.js';
import { validateName } from '@/lib/username.js';

/**
 * 注册(第一步):接收 name/email/password → 校验 → 发送验证码。
 * **重点**: 此时并不在数据库中创建用户;待 /api/auth/register/confirm
 * 收到正确的验证码后,才真正落库。
 * 这样即使有人脚本批量请求,也只会积累无效的验证码记录,不会污染 users 表。
 *
 * Turnstile 覆盖:
 *   这个端点在启用 Turnstile 后也会要求 token —— 注册是最容易被"刷验证码 +
 *   刷 Resend 额度"的入口,比登录更需要机器人挑战。
 *   token 由前端 TurnstileWidget 产生,服务端在业务校验之前先过一次
 *   siteverify;未启用时 verifyTurnstile() 直接返回 ok,流程不变。
 */
function getClientIp(request) {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

export async function POST(request) {
  try {
    const ip = getClientIp(request);
    const { email, password, name, turnstileToken } = await request.json();

    if (!email || !password || !name) {
      return NextResponse.json({ error: '所有字段均为必填' }, { status: 400 });
    }

    // Turnstile 机器人防护 —— 放在验证码生成/邮件发送之前,防止脚本刷 Resend 额度。
    if (isTurnstileEnabled()) {
      const tr = await verifyTurnstile(turnstileToken, ip);
      if (!tr.ok) {
        return NextResponse.json({ error: tr.error, code: 'TURNSTILE_FAILED' }, { status: 400 });
      }
    }

    const normalizedEmail = email.toLowerCase().trim();
    const nameCheck = validateName(name);
    if (!nameCheck.valid) {
      return NextResponse.json({ error: nameCheck.message }, { status: 400 });
    }
    const trimmedName = nameCheck.value;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return NextResponse.json({ error: '邮箱格式不正确' }, { status: 400 });
    }

    // 唯一性检查
    const existing = db.findOne('users', { email: normalizedEmail });
    if (existing) {
      return NextResponse.json({ error: '该邮箱已被注册' }, { status: 409 });
    }

    // 密码强度
    const strength = validatePasswordStrength(password);
    if (!strength.valid) {
      return NextResponse.json({ error: strength.message }, { status: 400 });
    }

    // —— 反批量注册节流(上限/窗口由 /admin/settings 的 RL_REGISTER_* 控制) ——
    const emailMax    = getSettingInt('RL_REGISTER_EMAIL_MAX', 5);
    const emailWindow = getSettingInt('RL_REGISTER_EMAIL_WINDOW_MINUTES', 60);
    const ipMax       = getSettingInt('RL_REGISTER_IP_MAX', 10);
    const ipWindow    = getSettingInt('RL_REGISTER_IP_WINDOW_MINUTES', 60);

    const perEmail = verificationCodes.countRecent({
      email: normalizedEmail, type: 'register-pending', windowMinutes: emailWindow,
    });
    if (perEmail >= emailMax) {
      return NextResponse.json(
        { error: `该邮箱请求过于频繁,请 ${emailWindow} 分钟后再试` }, { status: 429 }
      );
    }
    const perIp = verificationCodes.countRecent({
      ip, type: 'register-pending', windowMinutes: ipWindow,
    });
    if (perIp >= ipMax) {
      return NextResponse.json(
        { error: '当前网络请求过于频繁,请稍后再试' }, { status: 429 }
      );
    }

    // 将账号信息(含密码哈希)暂存在验证码 meta 中;落库要等验证成功
    const code = verificationCodes.generateCode();
    verificationCodes.save(normalizedEmail, code, 'register-pending', {
      ip,
      expiresMinutes: 30,
      meta: {
        name: trimmedName,
        passwordHash: hashPassword(password),
      },
    });
    const emailResult = await sendVerificationCode(normalizedEmail, code);

    return NextResponse.json({
      success: true,
      message: '验证码已发送至您的邮箱,请在 30 分钟内完成验证',
      ...(process.env.NODE_ENV !== 'production' && { devCode: emailResult.code }),
    }, { status: 200 });
  } catch (err) {
    console.error('Register (send code) error:', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
