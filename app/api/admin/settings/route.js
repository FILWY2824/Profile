import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth.js';
import { listSettings, setSettings } from '@/lib/settings.js';
import { validateSettings } from '@/lib/settingsValidation.js';
import { activityLog } from '@/lib/fileStore.js';
import { getClientIp } from '@/lib/rateLimit.js';

/**
 * GET /api/admin/settings?reveal=1  →  返回所有受管配置项
 *   reveal=1 时敏感字段显示原文(供"查看真实密钥"功能),默认掩码。
 * PATCH /api/admin/settings         →  body = { KEY1: value1, KEY2: value2, ... }
 *   只接受白名单内的键(见 MANAGED_SETTINGS),其他键被静默忽略。
 *   值会先通过 validateSettings(#7 修复)做区间/格式/长度校验,整批有
 *   任一项违规则整批拒绝,避免"写了一半"。
 */
export async function GET(request) {
  const auth = await requireAdmin();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { searchParams } = new URL(request.url);
  const reveal = searchParams.get('reveal') === '1';
  const items = listSettings({ reveal });

  if (reveal) {
    // 查看明文属于敏感操作,记一笔行为日志
    activityLog.record({
      userId: auth.session.user.id,
      username: auth.session.user.name,
      email: auth.session.user.email,
      action: 'admin.settings_reveal',
      detail: '查看了敏感配置项明文',
      ip: getClientIp(request),
    });
  }
  return NextResponse.json({ items });
}

export async function PATCH(request) {
  const auth = await requireAdmin();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: '请求体必须是对象' }, { status: 400 });
    }

    // ── 校验(#7) ────────────────────────────────────────────────
    const { errors } = validateSettings(body);
    if (errors.length) {
      return NextResponse.json({
        error: '有配置项值不合法',
        fieldErrors: errors, // 给前端用,便于在对应输入框下标红
      }, { status: 400 });
    }

    // ── "清空就崩"的关键项保护 ────────────────────────────────
    //
    // validateSettings 的原则是"清空放行以便回退默认",但 JWT_SECRET 在
    // 生产环境下没有合理的默认值 —— 清空会让之后所有新会话都用一个弱的
    // 兜底 secret(lib/auth 里的"开发默认值")签名。这里单独挡一下:
    // production 下不允许把 JWT_SECRET 改成空串。
    if (process.env.NODE_ENV === 'production'
        && Object.prototype.hasOwnProperty.call(body, 'JWT_SECRET')
        && (body.JWT_SECRET === '' || body.JWT_SECRET == null)) {
      return NextResponse.json({
        error: '生产环境下 JWT_SECRET 不能清空',
        fieldErrors: [{ key: 'JWT_SECRET', message: '生产环境必须保持非空;要轮换请直接填入新值' }],
      }, { status: 400 });
    }

    setSettings(body);
    activityLog.record({
      userId: auth.session.user.id,
      username: auth.session.user.name,
      email: auth.session.user.email,
      action: 'admin.settings_update',
      detail: `修改了配置项: ${Object.keys(body).join(', ')}`,
      ip: getClientIp(request),
      meta: { keys: Object.keys(body) },
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Update settings error:', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
