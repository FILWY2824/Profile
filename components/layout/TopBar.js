'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import BrandIcon from '@/components/ui/BrandIcon.js';

export default function TopBar({ user, onLogout }) {
  const pathname = usePathname();

  return (
    <header style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 200,
      height: 'var(--topbar-h)',
      background: 'rgba(250,248,245,0.93)',
      backdropFilter: 'blur(14px)',
      WebkitBackdropFilter: 'blur(14px)',
      borderBottom: '1px solid var(--border)',
      display: 'flex', alignItems: 'center',
    }}>
      <div style={{
        width: '100%', maxWidth: 1200, margin: '0 auto', padding: '0 32px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        {/* Brand — icon + name */}
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none' }}>
          <BrandIcon size={38} />
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
            <span style={{
              fontFamily: 'var(--font-serif)',
              fontSize: '1.2rem',
              fontWeight: 600,
              color: 'var(--ink)',
              letterSpacing: '-0.01em',
            }}>栖枢</span>
            <span style={{
              fontFamily: 'var(--font-sans)',
              fontSize: '0.68rem',
              color: 'var(--ink-3)',
              letterSpacing: '0.22em',
              marginTop: 3,
              textTransform: 'uppercase',
            }}>Qi · Shu</span>
          </div>
        </Link>

        {/* Right navigation */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
          {user ? (
            <>
              {user.role === 'admin' && (
                <Link href="/admin" className="nav-link">后台管理</Link>
              )}
              <Link href="/account" className="nav-link">{user.name}</Link>
              <button className="btn btn-outline btn-sm" onClick={onLogout}>退出</button>
            </>
          ) : (
            <>
              {pathname !== '/auth/login' && (
                <Link href="/auth/login" className="nav-link">登录</Link>
              )}
              {pathname !== '/auth/register' && (
                <Link href="/auth/register" className="btn btn-primary btn-sm">注册</Link>
              )}
            </>
          )}
        </div>
      </div>
    </header>
  );
}
