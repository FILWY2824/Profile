import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth.js';
import { db } from '@/lib/db.js';
import { hashPassword, validatePasswordStrength } from '@/lib/password.js';
import { validateName } from '@/lib/username.js';

const VALID_ROLES = ['user', 'member', 'admin'];

export async function GET(request) {
  const auth = await requireAdmin();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '1');
  const pageSize = parseInt(searchParams.get('pageSize') || '20');
  const search = searchParams.get('search') || '';
  const role = searchParams.get('role') || '';
  const status = searchParams.get('status') || '';

  const result = db.search('users', user => {
    if (search) {
      const q = search.toLowerCase();
      if (!user.email.toLowerCase().includes(q) && !user.name.toLowerCase().includes(q)) return false;
    }
    if (role && user.role !== role) return false;
    if (status && user.status !== status) return false;
    return true;
  });

  const sorted = result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const total = sorted.length;
  const start = (page - 1) * pageSize;
  const items = sorted.slice(start, start + pageSize).map(u => ({
    id: u.id, email: u.email, name: u.name, role: u.role,
    status: u.status, emailVerified: u.emailVerified, createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt, lastLoginIp: u.lastLoginIp,
  }));

  return NextResponse.json({ items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
}

export async function POST(request) {
  const auth = await requireAdmin();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const { email, password, name, role } = await request.json();

    if (!email || !password || !name) {
      return NextResponse.json({ error: '邮箱、密码和用户名均为必填' }, { status: 400 });
    }

    const nameCheck = validateName(name);
    if (!nameCheck.valid) {
      return NextResponse.json({ error: nameCheck.message }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();
    if (db.findOne('users', { email: normalizedEmail })) {
      return NextResponse.json({ error: '该邮箱已被注册' }, { status: 409 });
    }

    const strength = validatePasswordStrength(password);
    if (!strength.valid) return NextResponse.json({ error: strength.message }, { status: 400 });

    const finalRole = VALID_ROLES.includes(role) ? role : 'user';

    const user = db.insert('users', {
      email: normalizedEmail,
      passwordHash: hashPassword(password),
      name: nameCheck.value,
      role: finalRole,
      status: 'active',
      emailVerified: true,
      bio: '',
      avatar: '',
    });

    return NextResponse.json({
      success: true,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
