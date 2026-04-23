import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth.js';
import { listSettings, setSettings } from '@/lib/settings.js';
import { validateSettings } from '@/lib/settingsValidation.js';
import { activityLog } from '@/lib/fileStore.js';
import { getClientIp } from '@/lib/rateLimit.js';

const FORBIDDEN_KEYS = new Set(['JWT_SECRET']);

function isForbiddenKey(key) {
  return FORBIDDEN_KEYS.has(key) || key.startsWith('BACKUP_');
}

export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json({ items: listSettings() });
}

export async function PATCH(request) {
  const auth = await requireAdmin();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: '请求体必须是对象' }, { status: 400 });
    }

    const keys = Object.keys(body);
    const forbiddenKeys = keys.filter(isForbiddenKey);
    if (forbiddenKeys.length) {
      return NextResponse.json({
        error: '包含不可修改的高敏感配置项',
        fieldErrors: forbiddenKeys.map(key => ({ key, message: '该项只能通过服务器环境变量或代码发布流程维护' })),
      }, { status: 400 });
    }

    const { errors } = validateSettings(body);
    if (errors.length) {
      return NextResponse.json({
        error: '有配置项值不合法',
        fieldErrors: errors,
      }, { status: 400 });
    }

    setSettings(body);
    activityLog.record({
      userId: auth.session.user.id,
      username: auth.session.user.name,
      email: auth.session.user.email,
      action: 'admin.settings_update',
      detail: `修改了配置项: ${keys.join(', ')}`,
      ip: getClientIp(request),
      meta: { keys },
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Update settings error:', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
