'use client';
import { useEffect, useMemo, useState } from 'react';
import TopBar from '@/components/layout/TopBar.js';
import { useToast } from '@/components/ui/index.js';
import styles from './page.module.css';

// ────────────────────────────────────────────────────────────────────────────
// Favicon loading
// 图标统一走后端的缓存端点:/api/favicons/image?origin=... —— 首次访问时后端
// 会同步抓取并存库,之后永不自动刷新(避免请求堆积与潜在内存问题),
// 管理员可以在 /admin/favicons 手动刷新或清除缓存。
// 如果后端返回 404(抓取全部失败),<img> 的 onError 会切到字母兜底。
// ────────────────────────────────────────────────────────────────────────────
function getCardOrigin(cardUrl) {
  if (!cardUrl || cardUrl.startsWith('/')) return null;
  try {
    return new URL(cardUrl).origin;
  } catch { return null; }
}

function CardIcon({ card }) {
  const origin = useMemo(() => getCardOrigin(card.url), [card.url]);
  const [failed, setFailed] = useState(false);

  // 站内链接 / 失败 → 字母兜底
  if (!origin || failed) {
    return (
      <div className={styles.cardIcon}>
        <div className={styles.cardIconFallback}>
          {card.title?.[0]?.toUpperCase() || '?'}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.cardIcon}>
      <img
        src={`/api/favicons/image?origin=${encodeURIComponent(origin)}`}
        alt=""
        className={styles.cardIconImg}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    </div>
  );
}

// 将 permission + accessible 映射成人话
function accessLabel(card) {
  const perm = card.permission || 'public';
  if (card.accessible) {
    if (perm === 'public')  return '当前平台可访问';
    if (perm === 'user')    return '当前平台仅限登录用户访问';
    if (perm === 'member')  return '当前平台仅限会员用户访问';
    if (perm === 'admin')   return '当前平台仅限管理员访问';
  }
  // 锁定态文案:用同一组措辞,前端按 lockReason 区分图标
  if (card.lockReason === 'user')   return '当前平台仅限登录用户访问';
  if (card.lockReason === 'member') return '当前平台仅限会员用户访问';
  if (card.lockReason === 'admin')  return '当前平台仅限管理员访问';
  return '当前平台可访问';
}

function LockIcon() {
  return (
    <svg className={styles.lockIcon} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
    </svg>
  );
}

function CardItem({ card }) {
  // isExternal 现在是服务端直接下发的布尔值(见 /api/homepage 的 annotate)。
  // 之所以不再前端推断:锁定卡的 card.url 已被服务端剔除(H1 修复),前端
  // 没有 url 就推不出"外部/内部",必须靠服务端传过来的这个标签。
  const isExternal = !!card.isExternal;
  const locked = card.accessible === false;
  const label = accessLabel(card);
  const kindLabel = isExternal ? '外部' : '内部';

  const body = (
    <>
      <div className={styles.cardHead}>
        <CardIcon card={card} />
        <span className={styles.cardKind}>{kindLabel}</span>
      </div>
      <div className={styles.cardBody}>
        <div className={styles.cardTitle}>{card.title}</div>
        {card.description && <div className={styles.cardDesc}>{card.description}</div>}
        <div className={styles.cardFoot}>
          <span className={`${styles.cardAccessTag} ${locked ? styles.cardAccessTagLocked : ''}`}>
            {locked && <LockIcon />}
            <span>{label}</span>
          </span>
          {!locked && <span className={styles.cardFootArrow}>{isExternal ? '↗' : '→'}</span>}
        </div>
      </div>
    </>
  );

  if (locked) {
    return <div className={`${styles.card} ${styles.cardLocked}`} aria-disabled="true">{body}</div>;
  }
  return (
    <a
      href={card.url}
      target={isExternal ? '_blank' : '_self'}
      rel={isExternal ? 'noopener noreferrer' : undefined}
      className={styles.card}
    >{body}</a>
  );
}

export default function HomePage() {
  const toast = useToast();
  const [user, setUser] = useState(null);
  const [sections, setSections] = useState([]);
  const [ungrouped, setUngrouped] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch('/api/auth/me').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/homepage').then(async r => {
        if (!r.ok) throw new Error('加载首页内容失败');
        return r.json();
      }),
    ])
      .then(([u, home]) => {
        if (!alive) return;
        setUser(u);
        setSections(home?.sections || []);
        setUngrouped(home?.ungrouped || []);
      })
      .catch(err => {
        if (!alive) return;
        toast.error(err?.message || '加载首页失败,请刷新重试');
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // toast is stable via useMemo inside provider; safe to omit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleLogout() {
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST' });
      if (!res.ok) throw new Error('退出登录失败');
      toast.success('已退出登录');
      // 硬跳转回首页,确保卡片、顶栏等所有客户端状态都按"未登录"重新渲染
      // (router.refresh 只刷新 server components,useState 里的旧数据还在)
      setTimeout(() => { window.location.assign('/'); }, 200);
    } catch (err) {
      toast.error(err?.message || '退出登录失败');
    }
  }

  const visibleSections = sections.filter(s => s.cards?.length > 0);
  const hasContent = visibleSections.length > 0 || ungrouped.length > 0;

  // ── 标题逐字吹动(丝滑版) ──
  // 6 个字依次 stagger,每字 0.42s 错开。整条动画周期 6.5s,活跃窗口 28%,
  // 使用 cubic-bezier(0.4,0,0.2,1) 缓动,去掉了上一版的 skew —— 现在是
  // "风从左往右拂过"而不是"抖一下就停"。详见 page.module.css 里的注释。
  const textChars = Array.from('欢迎使用');
  const brandChars = Array.from('栖枢');
  const STAGGER_SECONDS = 0.42;

  return (
    <div className={styles.page}>
      <TopBar user={user} onLogout={handleLogout} />

      <header className={styles.hero}>
        <div className={styles.heroInner}>
          <div className={styles.heroTitleRow}>
            <span className={styles.heroBadge}>
              <span className={styles.heroBadgeDot} />
              平台入口
            </span>
            <h1 className={styles.heroTitle}>
              <span className={styles.heroWord}>
                {textChars.map((ch, i) => (
                  <span
                    key={`t-${i}`}
                    className={`${styles.heroChar} ${styles.heroCharText}`}
                    style={{ animationDelay: `${i * STAGGER_SECONDS}s` }}
                  >{ch}</span>
                ))}
              </span>
              <span className={styles.heroWord + ' ' + styles.heroBrandWord}>
                {brandChars.map((ch, i) => (
                  <span
                    key={`b-${i}`}
                    className={`${styles.heroChar} ${styles.heroCharBrand}`}
                    style={{ animationDelay: `${(textChars.length + i) * STAGGER_SECONDS}s` }}
                  >{ch}</span>
                ))}
              </span>
            </h1>
          </div>
          <p className={styles.heroSub}>统一的内容入口、用户认证与管理平台</p>
        </div>
      </header>

      <main className={styles.main}>
        {loading ? (
          <div style={{ display:'flex', justifyContent:'center', padding:'60px 0' }}>
            <span className="spinner spinner-dark" style={{ width:28, height:28, borderWidth:3 }} />
          </div>
        ) : !hasContent ? (
          <div style={{ textAlign:'center', padding:'60px 0', color:'var(--ink-3)' }}>
            <div style={{ fontSize:'2.5rem', marginBottom:12, opacity:.35 }}>✦</div>
            <div style={{ fontFamily:'var(--font-serif)', color:'var(--ink-2)', marginBottom:6 }}>暂无入口内容</div>
            {user?.role === 'admin' && (
              <a href="/admin/cards" className="btn btn-outline btn-sm" style={{ marginTop:12, display:'inline-flex' }}>去添加卡片</a>
            )}
          </div>
        ) : (
          <>
            {visibleSections.map(section => (
              <section key={section.id} className={styles.section}>
                <div className={styles.sectionHeader}>
                  <h2 className={styles.sectionTitle}>{section.name}</h2>
                  {section.description && <p className={styles.sectionDesc}>{section.description}</p>}
                </div>
                <div className={styles.grid}>
                  {section.cards.map(card => <CardItem key={card.id} card={card} />)}
                </div>
              </section>
            ))}
            {ungrouped.length > 0 && (
              <section className={styles.section}>
                <div className={styles.sectionHeader}>
                  <h2 className={styles.sectionTitle}>其他</h2>
                </div>
                <div className={styles.grid}>
                  {ungrouped.map(card => <CardItem key={card.id} card={card} />)}
                </div>
              </section>
            )}
          </>
        )}
      </main>

      <footer className={styles.footer}>
        <span>栖枢平台</span>
        <span className={styles.footerDot}>·</span>
        <span>统一用户认证中心</span>
      </footer>
    </div>
  );
}
