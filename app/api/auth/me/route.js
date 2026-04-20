import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth.js';

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const { user } = session;
  return NextResponse.json({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    emailVerified: user.emailVerified,
    bio: user.bio,
    avatar: user.avatar,
    createdAt: user.createdAt,
  });
}
