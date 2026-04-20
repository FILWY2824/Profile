import { NextResponse } from 'next/server';
import { db } from '@/lib/db.js';
import { database } from '@/lib/database.js';
import { verificationCodes, getVerificationCodeMaxAttempts } from '@/lib/fileStore.js';
import { activityLog } from '@/lib/fileStore.js';

/**
 * 注册(第二步):校验验证码 → 创建用户。
 *
 * 事务保护(#9):原本的顺序是
 *   verificationCodes.markUsed(...) → db.insert('users', ...) → activityLog.record
 * 一旦中间失败(比如 users 表因 UNIQUE 冲突 insert 抛错),验证码已经被烧掉,
 * 用户再次提交会看到"未找到待验证的注册请求",但实际上是之前那条 pending
 * 已经被错误地标记了。现在把"标 used + 插 user + 写日志"放在同一事务里:
 * 任意一步失败都会整体回滚,验证码和用户行为日志保持一致。
 */
export async function POST(request) {
  try {
    const { email, code } = await request.json();
    if (!email || !code) {
      return NextResponse.json({ error: '邮箱和验证码均为必填' }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // 二次检查:是否已被注册(防止请求之间的竞态)
    const existing = db.findOne('users', { email: normalizedEmail });
    if (existing) {
      return NextResponse.json({ error: '该邮箱已被注册' }, { status: 409 });
    }

    // 校验尝试次数,防爆破
    const pending = verificationCodes.peek(normalizedEmail, 'register-pending');
    if (!pending) {
      return NextResponse.json(
        { error: '未找到待验证的注册请求,请重新提交注册表单' }, { status: 400 }
      );
    }
    if ((pending.record.attempts || 0) >= getVerificationCodeMaxAttempts()) {
      return NextResponse.json(
        { error: '验证码错误次数过多,请重新提交注册' }, { status: 429 }
      );
    }

    const found = verificationCodes.find(normalizedEmail, code, 'register-pending');
    if (!found) {
      verificationCodes.incrementAttempts(normalizedEmail, 'register-pending');
      return NextResponse.json({ error: '验证码无效或已过期' }, { status: 400 });
    }

    const { meta } = found.record;
    if (!meta?.passwordHash || !meta?.name) {
      return NextResponse.json(
        { error: '注册会话信息丢失,请重新提交注册' }, { status: 400 }
      );
    }

    // 到这里:真正创建用户 —— markUsed + insert + activityLog 作为一个事务单元
    let user;
    database.transaction(() => {
      verificationCodes.markUsed(normalizedEmail, code, 'register-pending');
      user = db.insert('users', {
        email: normalizedEmail,
        passwordHash: meta.passwordHash,
        name: meta.name,
        role: 'user',
        status: 'active',
        emailVerified: true,   // 注册流程完成即已验证
        bio: '',
        avatar: '',
      });
      activityLog.record({
        userId: user.id, username: user.name, email: user.email,
        action: 'user.register', detail: `${user.email} 完成注册`,
      });
    })();

    return NextResponse.json({
      success: true,
      message: '注册成功,请登录',
      userId: user.id,
    });
  } catch (err) {
    console.error('Register confirm error:', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
