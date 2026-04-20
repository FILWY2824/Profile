'use client';
import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import TopBar from '@/components/layout/TopBar.js';
import { useToast } from '@/components/ui/index.js';
import styles from './admin.module.css';

const NAV = [
  { href:'/admin',               label:'仪表盘',   icon:'▦' },
  { href:'/admin/users',         label:'用户管理', icon:'◉' },
  { href:'/admin/sections',      label:'板块管理', icon:'⊞' },
  { href:'/admin/cards',         label:'卡片管理', icon:'⊟' },
  { href:'/admin/favicons',      label:'站点图标', icon:'◐' },
  { href:'/admin/oauth-clients', label:'OAuth 客户端', icon:'◎' },
  { href:'/admin/login-history', label:'登录记录', icon:'⇆' },
  { href:'/admin/activity-log',  label:'行为日志', icon:'≡' },
  { href:'/admin/retention',     label:'数据清理', icon:'♺' },
  { href:'/admin/settings',      label:'平台配置', icon:'⚙' },
  { href:'/admin/database',      label:'数据库',   icon:'▥' },
  { href:'/admin/backup',        label:'数据库备份', icon:'⇪' },
];

export default function AdminLayout({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch('/api/auth/me')
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(u => {
        if (!alive) return;
        if (u.role !== 'admin') { toast.error('无权访问此页面'); throw new Error(); }
        setUser(u);
      })
      .catch(() => router.push('/auth/login?redirect=/admin'))
      .finally(() => { if (alive) setChecking(false); });
    return () => { alive = false; };
  }, [router, toast]);

  async function handleLogout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.assign('/');
    } catch { toast.error('退出登录失败'); }
  }

  if (checking) return (
    <>
      <TopBar />
      <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', paddingTop:'var(--topbar-h)' }}>
        <span className="spinner spinner-dark" style={{ width:32, height:32, borderWidth:3 }} />
      </div>
    </>
  );

  return (
    <>
      <TopBar user={user} onLogout={handleLogout} />
      <div className={styles.shell}>
        <aside className={styles.sidebar}>
          <div className={styles.sidebarTop}>
            <div className={styles.sidebarLabel}>后台管理</div>
          </div>
          <nav className={styles.nav}>
            {NAV.map(n => (
              <Link key={n.href} href={n.href}
                    className={`${styles.navItem} ${
                      pathname === n.href || (n.href !== '/admin' && pathname.startsWith(n.href))
                        ? styles.navActive : ''
                    }`}>
                <span className={styles.navIcon}>{n.icon}</span>
                <span>{n.label}</span>
              </Link>
            ))}
          </nav>
          <div className={styles.sidebarBottom}>
            <Link href="/account" className={styles.userChip}>
              <span className={styles.userAvatar}>{user?.name?.[0]?.toUpperCase()}</span>
              <span className={styles.userNameCell}>{user?.name}</span>
            </Link>
          </div>
        </aside>
        <div className={styles.body}>{children}</div>
      </div>
    </>
  );
}
