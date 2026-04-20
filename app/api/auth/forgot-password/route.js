import { NextResponse } from 'next/server';
import { db } from '@/lib/db.js';
import { verificationCodes } from '@/lib/fileStore.js';
import { sendPasswordResetCode } from '@/lib/email.js';
import { getClientIp, rateLimit } from '@/lib/rateLimit.js';
import { getSettingInt } from '@/lib/settings.js';
import { verifyTurnstile, isTurnstileEnabled } from '@/lib/turnstile.js';

/**
 * 忘记密码 —— 发送重置验证码。
 *
 * 设计要点:
 *   • 账号是否存在都返回同一条成功消息,防止枚举
 *   • 节流失败也返回"成功"措辞,不暴露限流状态给枚举者
 *   • 启用 Turnstile 后会在业务校验之前先过挑战,挡住脚本刷发码
 *     —— 这是邮件服务(Resend 额度、送达声誉)的一道重要防线
 */
export async function POST(request) {
  try {
    const ip = getClientIp(request);
    const { email, turnstileToken } = await request.json();

    if (!email) {
      return NextResponse.json({ error: '邮箱不能为空' }, { status: 400 });
    }
    const normalizedEmail = String(email).toLowerCase().trim();

    // Turnstile 机器人防护 —— 注意:这里失败我们返回明确的错误,不走"静默
    // 成功"伪装。原因:攻击者根本拿不到 token,成功伪装反而会让真实用户在
    // Widget 挂掉时以为自己已经发了邮件。相比之下"账号不存在"那种枚举风险
    // 才需要伪装。
    if (isTurnstileEnabled()) {
      const tr = await verifyTurnstile(turnstileToken, ip);
      if (!tr.ok) {
        return NextResponse.json({ error: tr.error, code: 'TURNSTILE_FAILED' }, { status: 400 });
      }
    }

    // —— 节流:防止攻击者对目标邮箱频繁触发邮件 ——
    const ipRl = rateLimit('forgot:ip', ip, {
      max: getSettingInt('RL_FORGOT_IP_MAX', 20),
      windowMs: getSettingInt('RL_FORGOT_IP_WINDOW_MINUTES', 60) * 60_000,
    });
    if (!ipRl.allowed) {
      return NextResponse.json({ success: true, message: '如果该邮箱已注册,您将收到重置验证码' });
    }
    const emailRl = rateLimit('forgot:email', normalizedEmail, {
      max: getSettingInt('RL_FORGOT_EMAIL_MAX', 5),
      windowMs: getSettingInt('RL_FORGOT_EMAIL_WINDOW_MINUTES', 60) * 60_000,
    });
    if (!emailRl.allowed) {
      // 依然返回成功信息,不暴露限流状态
      return NextResponse.json({ success: true, message: '如果该邮箱已注册,您将收到重置验证码' });
    }

    const user = db.findOne('users', { email: normalizedEmail });

    // 始终返回相同信息 —— 防账号枚举
    if (!user) {
      return NextResponse.json({ success: true, message: '如果该邮箱已注册,您将收到重置验证码' });
    }

    const code = verificationCodes.generateCode();
    verificationCodes.save(normalizedEmail, code, 'password-reset', { ip });
    const result = await sendPasswordResetCode(normalizedEmail, code);

    return NextResponse.json({
      success: true,
      message: '如果该邮箱已注册,您将收到重置验证码',
      ...(process.env.NODE_ENV !== 'production' && { devCode: result.code }),
    });
  } catch (err) {
    console.error('Forgot password error:', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
