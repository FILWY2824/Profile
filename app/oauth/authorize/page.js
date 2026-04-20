'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Spinner, useToast } from '@/components/ui/index.js';
import styles from './authorize.module.css';

function extractHost(uri) {
  if (!uri) return '';
  try { return new URL(uri).host; } catch { return uri; }
}

function UserAvatar({ user }) {
  if (user?.avatar) return <img src={user.avatar} alt="" className={styles.userAvatarImg} />;
  const letter = user?.name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || '?';
  return <div className={styles.userAvatarLetter}>{letter}</div>;
}

function LockBig() {
  return (
    <svg className={styles.heroIcon} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2"></rect>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
    </svg>
  );
}
function GlobeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none"
         stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"></circle>
      <line x1="2" y1="12" x2="22" y2="12"></line>
      <path d="M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z"></path>
    </svg>
  );
}
function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none"
         stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"></circle>
      <path d="M12 16v-4"></path><path d="M12 8h.01"></path>
    </svg>
  );
}
function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none"
         stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
    </svg>
  );
}
function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
         stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
      <circle cx="12" cy="7" r="4"></circle>
    </svg>
  );
}

function AuthorizeInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();

  const client_id = searchParams.get('client_id');
  const redirect_uri = searchParams.get('redirect_uri');
  const scope = searchParams.get('scope') || 'openid';
  const state = searchParams.get('state') || '';
  const code_challenge = searchParams.get('code_challenge');
  const code_challenge_method = searchParams.get('code_challenge_method') || 'plain';

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [fatal, setFatal] = useState('');
  const [submitting, setSubmitting] = useState(null);
  const [showScopes, setShowScopes] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!client_id) { setFatal('缺少 client_id 参数'); setLoading(false); return; }
    const qs = new URLSearchParams({ client_id, ...(redirect_uri ? { redirect_uri } : {}) });
    fetch(`/api/oauth/client-info?${qs}`)
      .then(async r => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || '读取应用信息失败');
        return j;
      })
      .then(d => {
        if (!alive) return;
        setData(d);
        if (!d.user) {
          const back = `/oauth/authorize?${searchParams.toString()}`;
          router.replace(`/auth/login?redirect=${encodeURIComponent(back)}`);
        }
      })
      .catch(e => { if (alive) setFatal(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client_id, redirect_uri]);

  async function decide(action) {
    setSubmitting(action);
    try {
      const res = await fetch('/api/oauth/authorize/decide', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id, redirect_uri, scope, state,
          code_challenge, code_challenge_method, action,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        toast.error(j.error || '操作失败');
        setSubmitting(null);
        return;
      }
      window.location.href = j.redirect;
    } catch (e) {
      toast.error(String(e?.message || e));
      setSubmitting(null);
    }
  }

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.center}><Spinner /></div>
      </div>
    );
  }

  if (fatal && !data) {
    return (
      <div className={styles.page}>
        <div className={styles.box}>
          <div style={{ padding: 16, color: 'var(--ruby)', textAlign: 'center' }}>
            {fatal}
          </div>
        </div>
      </div>
    );
  }

  if (!data?.user) return null;

  const { client, user } = data;
  const appHost = client.homepageUrl || extractHost(redirect_uri);

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <span className={styles.brandDot} />
          <span className={styles.brandText}>栖枢 Connect</span>
        </div>
      </header>

      <main className={styles.main}>
        <div className={styles.box}>
          <div className={styles.hero}>
            <div className={styles.heroIconWrap}><LockBig /></div>
            <h1 className={styles.title}>{client.name}</h1>
            <p className={styles.subtitle}>请求访问你的 栖枢 账户</p>
          </div>

          <div className={styles.card}>
            <div className={styles.userRow}>
              <UserAvatar user={user} />
              <div className={styles.userInfo}>
                <div className={styles.userName}>{user.name}</div>
                <div className={styles.userSub}>以 <span className={styles.userHandle}>@{user.name}</span> 的身份授权</div>
              </div>
            </div>
          </div>

          <div className={styles.card}>
            <div className={styles.cardLabel}>应用信息</div>
            <div className={styles.metaRow}>
              <GlobeIcon />
              {appHost ? (
                <a href={client.homepageUrl || `https://${extractHost(redirect_uri)}`}
                   target="_blank" rel="noopener noreferrer" className={styles.metaLink}>
                  {appHost}
                </a>
              ) : <span className={styles.metaMuted}>未提供链接</span>}
            </div>
            {client.description && (
              <div className={styles.metaRow}>
                <InfoIcon />
                <span>{client.description}</span>
              </div>
            )}
            <div className={styles.metaRow}>
              <ShieldIcon />
              <span>最低 <strong>{client.minLevel ?? 0}</strong> 级</span>
            </div>
          </div>

          <div className={styles.card}>
            <div className={styles.cardLabel}>将获取以下权限</div>
            <button type="button" className={styles.scopeRow} onClick={() => setShowScopes(s => !s)}>
              <UserIcon />
              <span className={styles.scopeLabel}>
                获取你的用户<strong>基本信息</strong>
              </span>
              <span className={`${styles.scopeCaret} ${showScopes ? styles.scopeCaretOpen : ''}`}>⌄</span>
            </button>
            {showScopes && (
              <div className={styles.scopeDetail}>
                包括:用户名、邮箱、头像、用户等级。不会获取您的密码、私密数据或任何敏感信息。
              </div>
            )}
          </div>

          <div className={styles.actions}>
            <button className={`${styles.btn} ${styles.btnPrimary}`}
                    disabled={!!submitting} onClick={() => decide('allow')}>
              {submitting === 'allow' ? <Spinner /> : '允许'}
            </button>
            <button className={`${styles.btn} ${styles.btnGhost}`}
                    disabled={!!submitting} onClick={() => decide('deny')}>
              {submitting === 'deny' ? <Spinner /> : '取消'}
            </button>
          </div>

          <div className={styles.notice}>
            只有当您信任 <strong>{client.name}</strong> 时,才应该点击&ldquo;允许&rdquo;。
          </div>
        </div>
      </main>
    </div>
  );
}

// useSearchParams() 在 Next.js 15 生产构建时必须位于 Suspense 边界内,否则
// 整页会在预渲染阶段失败(missing-suspense-with-csr-bailout)。
export default function OAuthAuthorizePage() {
  return (
    <Suspense fallback={
      <div className={styles.page}>
        <div className={styles.center}><Spinner /></div>
      </div>
    }>
      <AuthorizeInner />
    </Suspense>
  );
}