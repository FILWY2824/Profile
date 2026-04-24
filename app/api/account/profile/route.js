import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth.js';
import { db } from '@/lib/db.js';
import { activityLog } from '@/lib/fileStore.js';
import { validateName, validateBio } from '@/lib/username.js';

export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { user } = auth.session;
  return NextResponse.json({ id: user.id, email: user.email, name: user.name, role: user.role,
    status: user.status, emailVerified: user.emailVerified, bio: user.bio || '', avatar: user.avatar || '', createdAt: user.createdAt });
}

export async function PATCH(request) {
  const auth = await requireAuth();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { name, bio } = await request.json();
    const nameCheck = validateName(name);
    if (!nameCheck.valid) {
      return NextResponse.json({ error: nameCheck.message }, { status: 400 });
    }
    const bioCheck = validateBio(bio);
    if (!bioCheck.valid) {
      return NextResponse.json({ error: bioCheck.message }, { status: 400 });
    }
    const updated = db.updateById('users', auth.session.user.id, { name: nameCheck.value, bio: bioCheck.value });
    activityLog.record({ userId: auth.session.user.id, email: auth.session.user.email,
      action: 'update_profile', target: 'user', detail: `修改了个人资料` });
    return NextResponse.json({ success: true, user: { name: updated.name, bio: updated.bio } });
  } catch { return NextResponse.json({ error: '服务器错误' }, { status: 500 }); }
}
