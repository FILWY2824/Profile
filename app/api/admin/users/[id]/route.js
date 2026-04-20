import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth.js';
import { db } from '@/lib/db.js';
import { hashPassword, validatePasswordStrength } from '@/lib/password.js';
import { loginHistory, activityLog } from '@/lib/fileStore.js';
import { database } from '@/lib/database.js';
import { validateName } from '@/lib/username.js';

const VALID_ROLES = ['user', 'member', 'admin'];
const VALID_STATUSES = ['active', 'suspended', 'banned'];

/**
 * 管理员自锁防护(第 1 轮遗留 #4)
 * ---------------------------------------------------------------------------
 * 原代码只挡了"不能删除自己",但没挡:
 *   a) 把自己降级成 user / member
 *   b) 把自己 ban / suspend 掉
 *   c) 把"最后一个 active admin"降级或停用 —— 这条最危险,一旦发生,整个
 *      后台没人能登,只能连数据库改 hash 救场
 *
 * 这里给出一个共用 guard:
 *   • 如果目标就是当前操作者 → 禁止改 role/status(等同 a + b)
 *   • 如果目标会让系统失去最后一个 active admin → 禁止改 role/status(c)
 * guard 返回 { ok, error, status } 风格,让调用点直接:
 *     const g = guardAdminSelfLock(...)
 *     if (!g.ok) return NextResponse.json({ error: g.error }, { status: g.status })
 * 保持 PATCH handler 的线性流。
 * ---------------------------------------------------------------------------
 */
function countActiveAdmins() {
  const row = database.prepare(
    `SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active'`
  ).get();
  return row?.n || 0;
}

function guardAdminSelfLock({ currentAdminId, target, nextRole, nextStatus }) {
  // 1) 当前管理员自己 —— 不允许改自己的 role/status(改别的字段可以,比如 name/bio)
  if (target.id === currentAdminId) {
    if (nextRole !== undefined && nextRole !== target.role) {
      return { ok: false, error: '不能修改自己的角色(避免自锁)', status: 400 };
    }
    if (nextStatus !== undefined && nextStatus !== target.status) {
      return { ok: false, error: '不能修改自己的状态(避免自锁)', status: 400 };
    }
  }

  // 2) 最后一个 active admin 保护
  // 判断"这次操作会不会让 active admin 归 0":
  //   - 目标当前 role=admin 且 status=active
  //   - 本次要么把 role 改成非 admin,要么把 status 改成非 active
  //   - 并且全库只剩这一个 active admin
  const willLoseAdminness =
    target.role === 'admin' && target.status === 'active'
    && (
      (nextRole !== undefined && nextRole !== 'admin')
      || (nextStatus !== undefined && nextStatus !== 'active')
    );
  if (willLoseAdminness && countActiveAdmins() <= 1) {
    return {
      ok: false,
      error: '这是最后一个处于 active 状态的管理员,不能降级或停用',
      status: 409,
    };
  }

  return { ok: true };
}

function safeUser(u) {
  return {
    id: u.id, email: u.email, name: u.name, role: u.role,
    status: u.status, emailVerified: u.emailVerified,
    bio: u.bio || '', createdAt: u.createdAt, updatedAt: u.updatedAt,
    lastLoginAt: u.lastLoginAt, lastLoginIp: u.lastLoginIp,
  };
}

export async function GET(request, { params }) {
  const auth = await requireAdmin();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const user = db.findById('users', id);
  if (!user) return NextResponse.json({ error: '用户不存在' }, { status: 404 });
  const recentLogins = loginHistory.getRecent(id, 10);
  return NextResponse.json({ user: safeUser(user), recentLogins });
}

export async function PATCH(request, { params }) {
  const auth = await requireAdmin();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const user = db.findById('users', id);
  if (!user) return NextResponse.json({ error: '用户不存在' }, { status: 404 });

  try {
    const body = await request.json();
    const { action } = body;
    const adminUser = auth.session.user;

    if (action === 'ban') {
      const status = body.banType === 'permanent' ? 'banned' : 'suspended';
      const g = guardAdminSelfLock({
        currentAdminId: adminUser.id, target: user, nextStatus: status,
      });
      if (!g.ok) return NextResponse.json({ error: g.error }, { status: g.status });

      const updated = db.updateById('users', id, { status });
      activityLog.record({
        userId: adminUser.id, email: adminUser.email,
        action: 'admin.user_ban', target: 'user',
        detail: `${status === 'banned' ? '永久封禁' : '临时停用'}用户 ${user.email}`,
      });
      return NextResponse.json({ success: true, user: safeUser(updated) });
    }
    if (action === 'unban') {
      const updated = db.updateById('users', id, { status: 'active' });
      activityLog.record({
        userId: adminUser.id, email: adminUser.email,
        action: 'admin.user_unban', target: 'user', detail: `解封用户 ${user.email}`,
      });
      return NextResponse.json({ success: true, user: safeUser(updated) });
    }
    if (action === 'resetPassword') {
      const { newPassword } = body;
      if (!newPassword) return NextResponse.json({ error: '新密码不能为空' }, { status: 400 });
      const strength = validatePasswordStrength(newPassword);
      if (!strength.valid) return NextResponse.json({ error: strength.message }, { status: 400 });
      db.updateById('users', id, {
        passwordHash: hashPassword(newPassword),
        passwordChangedAt: new Date().toISOString(),
      });
      activityLog.record({
        userId: adminUser.id, email: adminUser.email,
        action: 'admin.reset_password', target: 'user',
        detail: `重置了用户 ${user.email} 的密码`,
      });
      return NextResponse.json({ success: true, message: '密码已重置' });
    }

    // 普通字段更新
    const { name, role, status, bio } = body;
    const updates = {};
    if (name !== undefined) {
      const nameCheck = validateName(name);
      if (!nameCheck.valid) {
        return NextResponse.json({ error: nameCheck.message }, { status: 400 });
      }
      updates.name = nameCheck.value;
    }
    if (role && VALID_ROLES.includes(role)) updates.role = role;
    if (status && VALID_STATUSES.includes(status)) updates.status = status;
    if (bio !== undefined) updates.bio = bio.trim();

    // 自锁防护:对 role/status 变更走 guard
    if (updates.role !== undefined || updates.status !== undefined) {
      const g = guardAdminSelfLock({
        currentAdminId: adminUser.id,
        target: user,
        nextRole: updates.role,
        nextStatus: updates.status,
      });
      if (!g.ok) return NextResponse.json({ error: g.error }, { status: g.status });
    }

    const updated = db.updateById('users', id, updates);
    activityLog.record({
      userId: adminUser.id, email: adminUser.email,
      action: 'admin.user_update', target: 'user',
      detail: `编辑了用户 ${user.email} 的资料`,
    });
    return NextResponse.json({ success: true, user: safeUser(updated) });
  } catch {
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  const auth = await requireAdmin();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  if (id === auth.session.user.id) return NextResponse.json({ error: '不能删除自己的账号' }, { status: 400 });
  const user = db.findById('users', id);
  if (!user) return NextResponse.json({ error: '用户不存在' }, { status: 404 });

  // 最后一个 active admin 保护:哪怕不是自己,也不能把全库最后一个可登录的
  // 管理员删掉。等同于 role→非admin 或 status→非active 的前置守卫,把 delete
  // 看作"status = deleted"的极端形式。
  if (user.role === 'admin' && user.status === 'active' && countActiveAdmins() <= 1) {
    return NextResponse.json(
      { error: '这是最后一个处于 active 状态的管理员,不能删除' },
      { status: 409 }
    );
  }

  // M6:级联清理这个用户的所有关联数据。
  //
  // 历史上 schema 没加外键约束(而且 SQLite 里 PRAGMA foreign_keys 也是后开的),
  // 所以直接 `DELETE FROM users WHERE id=?` 会留下一堆孤儿行:
  //   • oauth_grants           —— 用户授权过的第三方应用
  //   • oauth_tokens           —— 活跃 / 已撤销的 access_token
  //   • oauth_codes            —— 未兑换的 authorization_code
  //   • login_history          —— 登录成功 / 失败记录
  //   • activity_log           —— 行为日志(以 userId 关联的行)
  //   • verification_codes     —— 用邮箱定位,不以 userId 关联
  //
  // 用一个事务整体原子化,避免"删了一半进程挂了 → 下次重启看起来该用户还在
  // 但 token 已失效"这种中间态。
  //
  // verification_codes 以 email 为主键域关联(不是 userId),所以单独按邮箱清。
  // activity_log / login_history 里 userId 对应的行直接按列清即可。
  const userEmail = user.email;
  const cascadeTxn = database.transaction(() => {
    database.prepare('DELETE FROM oauth_grants WHERE userId = ?').run(id);
    database.prepare('DELETE FROM oauth_tokens WHERE userId = ?').run(id);
    database.prepare('DELETE FROM oauth_codes  WHERE userId = ?').run(id);
    database.prepare('DELETE FROM login_history WHERE userId = ?').run(id);
    database.prepare('DELETE FROM activity_log WHERE userId = ?').run(id);
    if (userEmail) {
      database.prepare('DELETE FROM verification_codes WHERE email = ?').run(userEmail);
    }
    database.prepare('DELETE FROM users WHERE id = ?').run(id);
  });
  cascadeTxn();

  activityLog.record({
    userId: auth.session.user.id, email: auth.session.user.email,
    action: 'admin.user_delete', target: 'user', detail: `删除了用户 ${user.email}(含级联清理)`,
  });
  return NextResponse.json({ success: true });
}
