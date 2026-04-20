import { NextResponse } from 'next/server';
import { db } from '@/lib/db.js';
import { database } from '@/lib/database.js';
import { verificationCodes, getVerificationCodeMaxAttempts } from '@/lib/fileStore.js';
import { sendVerificationCode } from '@/lib/email.js';
import { getClientIp, rateLimit } from '@/lib/rateLimit.js';
import { getSettingInt } from '@/lib/settings.js';

export async function POST(request) {
  try {
    const ip = getClientIp(request);

    // M7 修复:verify-email 既没有 IP/邮箱维度的限流,也没有限制单个验证码
    // 被错误尝试的次数。这两个缺陷各自的风险:
    //   (1) 限流缺失 → 可对同一未验证账户反复触发 resend,导致邮件骚扰;也
    //       可对同一邮箱暴力猜 6 位验证码(最坏 10^6 次)
    //   (2) 尝试次数不控 → 一旦暴力成功就直接把该账户的邮箱验证过了
    //
    // 这里按"IP + 邮箱"两维做窗口限流(和 login / register 同一套套路),并
    // 复用 verificationCodes.incrementAttempts + getVerificationCodeMaxAttempts
    // 来作废超次的验证码。
    const ipRl = rateLimit('verify-email:ip', ip, {
      max: getSettingInt('RL_VERIFY_EMAIL_IP_MAX', 20),
      windowMs: getSettingInt('RL_VERIFY_EMAIL_IP_WINDOW_MINUTES', 10) * 60_000,
    });
    if (!ipRl.allowed) {
      return NextResponse.json(
        { error: `请求过于频繁,请 ${ipRl.retryAfter} 秒后重试` },
        { status: 429, headers: { 'Retry-After': String(ipRl.retryAfter) } }
      );
    }

    const { email, code, resend } = await request.json();

    if (!email) {
      return NextResponse.json({ error: '邮箱不能为空' }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const emailRl = rateLimit('verify-email:email', normalizedEmail, {
      max: getSettingInt('RL_VERIFY_EMAIL_EMAIL_MAX', 10),
      windowMs: getSettingInt('RL_VERIFY_EMAIL_EMAIL_WINDOW_MINUTES', 10) * 60_000,
    });
    if (!emailRl.allowed) {
      return NextResponse.json(
        { error: `该邮箱尝试过多,请 ${emailRl.retryAfter} 秒后重试` },
        { status: 429, headers: { 'Retry-After': String(emailRl.retryAfter) } }
      );
    }

    const user = db.findOne('users', { email: normalizedEmail });
    if (!user) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 });
    }

    if (user.emailVerified) {
      return NextResponse.json({ success: true, message: '邮箱已验证' });
    }

    // Resend code
    if (resend) {
      const newCode = verificationCodes.generateCode();
      verificationCodes.save(normalizedEmail, newCode, 'email-verify', { ip });
      const result = await sendVerificationCode(normalizedEmail, newCode);
      return NextResponse.json({
        success: true,
        message: '验证码已重新发送',
        ...(process.env.NODE_ENV !== 'production' && { devCode: result.code }),
      });
    }

    if (!code) {
      return NextResponse.json({ error: '验证码不能为空' }, { status: 400 });
    }

    const found = verificationCodes.find(normalizedEmail, code, 'email-verify');
    if (!found) {
      // M7:验证码错(或过期)。对当前有效的最新验证码记一次尝试;超过上限
      // 就把它标记作废,用户必须走 resend 重新拿一条。
      const maxAttempts = getVerificationCodeMaxAttempts();
      const attempts = verificationCodes.incrementAttempts(normalizedEmail, 'email-verify');
      if (attempts >= maxAttempts) {
        // 直接作废当前最新未用验证码(markUsed 的等价物 —— 用 find+标记)
        // 简单做法:再发一轮 save 就会把旧的未用码 DELETE 掉,但那样等于免费
        // 给了他一次重发。这里用一条 UPDATE 把它置成 used=1,令下次 find
        // 找不到它。
        verificationCodes.invalidateCurrent?.(normalizedEmail, 'email-verify');
        return NextResponse.json(
          { error: '验证码错误次数过多,已作废,请重新发送' },
          { status: 400 }
        );
      }
      return NextResponse.json({
        error: `验证码无效或已过期(还可尝试 ${Math.max(0, maxAttempts - attempts)} 次)`
      }, { status: 400 });
    }

    // #9 事务保护:markUsed + 更新 emailVerified 作为单一事务,任何一步失败
    // 都要整体回滚,避免出现"验证码被烧但邮箱没标记已验证"的半拉子状态。
    database.transaction(() => {
      verificationCodes.markUsed(normalizedEmail, code, 'email-verify');
      db.updateById('users', user.id, { emailVerified: true });
    })();

    return NextResponse.json({ success: true, message: '邮箱验证成功，请登录' });
  } catch (err) {
    console.error('Verify email error:', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
