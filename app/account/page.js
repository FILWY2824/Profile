'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import TopBar from '@/components/layout/TopBar.js';
import { Alert, Spinner, Badge, Pagination, useToast, useConfirm } from '@/components/ui/index.js';
import PasswordInput from '@/components/ui/PasswordInput.js';
import { fmtDate, fmtDateTime } from '@/lib/time.js';
import styles from './account.module.css';

const ACTION_LABELS = {
  'user.login': '登录', 'user.logout': '登出',
  'user.register': '注册完成',
  'user.change_password': '修改密码',
  'user.reset_password': '重置密码',
  'account.profile_update': '更新资料',
  'update_profile': '更新资料',
  'oauth.allow': '授权应用',
  'oauth.deny': '拒绝授权',
  'oauth.revoke': '撤销授权',
  'admin.card_create': '创建卡片', 'admin.card_update': '更新卡片', 'admin.card_delete': '删除卡片',
  'admin.user_ban': '封禁用户', 'admin.user_unban': '解封用户',
  'admin.reset_password': '重置密码', 'admin.user_update': '更新用户',
  'admin.user_delete': '删除用户',
  'admin.settings_update': '更新配置',
  'admin.retention_prune': '数据清理',
};

function RoleBadge({ role }) {
  if (role === 'admin')  return <Badge type="blue">管理员</Badge>;
  if (role === 'member') return <Badge type="violet">会员用户</Badge>;
  return <Badge type="gray">普通用户</Badge>;
}

function StatusBadge({ status }) {
  if (status === 'active')    return <Badge type="green">正常</Badge>;
  if (status === 'banned')    return <Badge type="red">封禁</Badge>;
  if (status === 'suspended') return <Badge type="amber">停用</Badge>;
  return <Badge type="gray">{status}</Badge>;
}

export default function AccountPage() {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();

  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('profile');

  // Profile
  const [profileForm, setProfileForm] = useState({ name: '', bio: '' });
  const [profileLoading, setProfileLoading] = useState(false);

  // Password
  const [passStep, setPassStep] = useState(1);
  const [passCode, setPassCode] = useState('');
  const [passDevCode, setPassDevCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passLoading, setPassLoading] = useState(false);

  // Logins (paginated 10/page)
  const [logins, setLogins] = useState({ items: [], total: 0, totalPages: 1 });
  const [loginPage, setLoginPage] = useState(1);

  // Activity (paginated 10/page, capped at 30 for non-admin)
  const [activity, setActivity] = useState({ items: [], total: 0, totalPages: 1, capped: null });
  const [actPage, setActPage] = useState(1);

  // OAuth grants (paginated 5/page)
  const [grants, setGrants] = useState({ items: [], total: 0, totalPages: 1 });
  const [grantPage, setGrantPage] = useState(1);
  const [grantsLoading, setGrantsLoading] = useState(false);

  // ── initial user fetch ──
  useEffect(() => {
    let alive = true;
    fetch('/api/auth/me')
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(u => {
        if (!alive) return;
        setUser(u);
        setProfileForm({ name: u.name, bio: u.bio || '' });
      })
      .catch(() => router.push('/auth/login?redirect=/account'))
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [router]);

  // ── tab data loaders ──
  const loadLogins = useCallback(async () => {
    try {
      const res = await fetch(`/api/account/login-history?page=${loginPage}`);
      if (!res.ok) throw new Error('加载登录记录失败');
      const data = await res.json();
      setLogins({ items: data.items || [], total: data.total, totalPages: data.totalPages });
    } catch (e) { toast.error(e.message); }
  }, [loginPage, toast]);

  const loadActivity = useCallback(async () => {
    try {
      const res = await fetch(`/api/account/activity?page=${actPage}`);
      if (!res.ok) throw new Error('加载行为日志失败');
      const data = await res.json();
      setActivity({
        items: data.items || [],
        total: data.total,
        totalPages: data.totalPages,
        capped: data.capped,
      });
    } catch (e) { toast.error(e.message); }
  }, [actPage, toast]);

  const loadGrants = useCallback(async () => {
    setGrantsLoading(true);
    try {
      const res = await fetch(`/api/account/oauth-grants?page=${grantPage}`);
      if (!res.ok) throw new Error('加载授权记录失败');
      const data = await res.json();
      setGrants({ items: data.items || [], total: data.total, totalPages: data.totalPages });
    } catch (e) { toast.error(e.message); }
    finally { setGrantsLoading(false); }
  }, [grantPage, toast]);

  useEffect(() => { if (tab === 'logins')   loadLogins();  }, [tab, loadLogins]);
  useEffect(() => { if (tab === 'activity') loadActivity(); }, [tab, loadActivity]);
  useEffect(() => { if (tab === 'grants')   loadGrants();  }, [tab, loadGrants]);

  async function handleLogout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      // 硬跳转,避免客户端状态保留旧用户信息
      window.location.assign('/');
    } catch { toast.error('退出登录失败'); }
  }

  async function saveProfile(e) {
    e.preventDefault();
    setProfileLoading(true);
    try {
      const res = await fetch('/api/account/profile', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profileForm),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || '保存失败'); return; }
      setUser(u => ({ ...u, ...data.user }));
      toast.success('资料已更新');
    } catch (e) { toast.error('网络错误'); }
    finally { setProfileLoading(false); }
  }

  async function sendPassCode() {
    setPassLoading(true);
    try {
      const res = await fetch('/api/account/password?action=send-code', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || '发送失败'); return; }
      setPassStep(2);
      if (data.devCode) {
        setPassDevCode(data.devCode);
        toast.info(`开发模式验证码:${data.devCode}`);
      } else {
        toast.success('验证码已发送至您的注册邮箱');
      }
    } catch { toast.error('网络错误'); }
    finally { setPassLoading(false); }
  }

  async function submitPassword(e) {
    e.preventDefault();
    if (newPassword !== confirmPassword) { toast.error('两次密码不一致'); return; }
    setPassLoading(true);
    try {
      const res = await fetch('/api/account/password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: passCode, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || '修改失败'); return; }
      toast.success('密码修改成功,即将跳转登录...');
      setPassStep(1); setPassCode(''); setNewPassword(''); setConfirmPassword(''); setPassDevCode('');
      setTimeout(() => router.replace('/auth/login?reason=password-changed'), 1200);
    } catch { toast.error('网络错误'); }
    finally { setPassLoading(false); }
  }

  async function revokeGrant(g) {
    const ok = await confirm({
      title: '撤销授权',
      message: `确定要撤销对 "${g.clientName}" 的授权吗?该应用将立即失去访问你账户的权限。`,
      confirmText: '确认撤销',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/account/oauth-grants?id=${encodeURIComponent(g.id)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || '撤销失败'); return; }
      toast.success(`已撤销对 "${g.clientName}" 的授权`);
      loadGrants();
    } catch { toast.error('网络错误'); }
  }

  if (loading) return (
    <>
      <TopBar />
      <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', paddingTop:'var(--topbar-h)' }}>
        <span className="spinner spinner-dark" style={{ width:32, height:32, borderWidth:3 }} />
      </div>
    </>
  );

  return (
    <div className={styles.page}>
      <TopBar user={user} onLogout={handleLogout} />

      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <div className={styles.avatar}>{user?.name?.[0]?.toUpperCase() || '?'}</div>
          <div className={styles.userName}>{user?.name}</div>
          <div className={styles.userEmail}>{user?.email}</div>
          <div style={{ display:'flex', gap:6, flexWrap:'wrap', justifyContent:'center', marginBottom:18 }}>
            <StatusBadge status={user?.status} />
            <RoleBadge role={user?.role} />
          </div>
          <nav className={styles.tabs}>
            {[
              ['profile',  '个人资料'],
              ['password', '修改密码'],
              ['grants',   '已授权应用'],
              ['logins',   '登录记录'],
              ['activity', '行为日志'],
            ].map(([k, v]) => (
              <button
                key={k}
                className={`${styles.tab} ${tab === k ? styles.tabActive : ''}`}
                onClick={() => setTab(k)}
              >{v}</button>
            ))}
          </nav>
        </aside>

        <main className={styles.content}>
          {/* ── Profile ── */}
          {tab === 'profile' && (
            <div className={styles.panel}>
              <h2 className={styles.panelTitle}>个人资料</h2>
              <div className={styles.infoGrid}>
                {[
                  ['账号 ID', <span key="id" style={{fontFamily:'var(--font-mono)',fontSize:'0.78rem',wordBreak:'break-all'}}>{user?.id}</span>],
                  ['邮箱状态', user?.emailVerified ? <Badge type="green">已验证</Badge> : <Badge type="amber">未验证</Badge>],
                  ['注册时间', user?.createdAt ? fmtDate(user.createdAt) : '-'],
                ].map(([k, v], i) => (
                  <div key={i} className={styles.infoRow}>
                    <span className={styles.infoLabel}>{k}</span>
                    <span className={styles.infoValue}>{v}</span>
                  </div>
                ))}
              </div>
              <div className={styles.divider} />
              <form onSubmit={saveProfile} style={{ display:'flex', flexDirection:'column', gap:14 }}>
                <div className="form-group">
                  <label className="form-label">用户名</label>
                  <input className="form-input" value={profileForm.name}
                         onChange={e => setProfileForm(f => ({...f, name: e.target.value}))}
                         required minLength={2} maxLength={10}
                         placeholder="最多 10 字" />
                </div>
                <div className="form-group">
                  <label className="form-label">个人简介</label>
                  <textarea className="form-input" value={profileForm.bio}
                            onChange={e => setProfileForm(f => ({...f, bio: e.target.value}))}
                            rows={3} placeholder="介绍一下自己..." style={{ resize:'vertical' }} />
                </div>
                <div>
                  <button className="btn btn-primary" type="submit" disabled={profileLoading}>
                    {profileLoading ? <Spinner /> : '保存修改'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* ── Password ── */}
          {tab === 'password' && (
            <div className={styles.panel}>
              <h2 className={styles.panelTitle}>修改密码</h2>
              {passStep === 1 ? (
                <div style={{ maxWidth:420 }}>
                  <p style={{ fontSize:'0.875rem', color:'var(--ink-3)', marginBottom:20, lineHeight:1.6 }}>
                    修改密码前需要验证您的身份。点击下方按钮向您的注册邮箱{' '}
                    <strong style={{ color:'var(--ink)' }}>{user?.email}</strong>{' '}
                    发送验证码,验证通过后直接设置新密码即可。
                  </p>
                  <button className="btn btn-primary" onClick={sendPassCode} disabled={passLoading}>
                    {passLoading ? <Spinner /> : '发送验证码'}
                  </button>
                </div>
              ) : (
                <form onSubmit={submitPassword} style={{ display:'flex', flexDirection:'column', gap:14, maxWidth:420 }}>
                  <div className="form-group">
                    <label className="form-label">验证码</label>
                    <input className="form-input" type="text"
                           value={passCode}
                           onChange={e => setPassCode(e.target.value.replace(/\D/g, ''))}
                           placeholder="输入邮件中的 6 位验证码"
                           maxLength={6} required autoFocus
                           style={{ letterSpacing:'0.15em', textAlign:'center' }} />
                    {passDevCode && (
                      <span className="form-hint" style={{ color:'var(--sky)', fontFamily:'var(--font-mono)' }}>
                        开发模式:{passDevCode}
                      </span>
                    )}
                  </div>
                  <div className="form-group">
                    <label className="form-label">新密码</label>
                    <PasswordInput value={newPassword}
                                   onChange={e => setNewPassword(e.target.value)}
                                   placeholder="至少 8 位,含大小写、数字和特殊字符"
                                   required autoComplete="new-password" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">确认新密码</label>
                    <PasswordInput value={confirmPassword}
                                   onChange={e => setConfirmPassword(e.target.value)}
                                   required autoComplete="new-password" />
                  </div>
                  <div style={{ display:'flex', gap:10 }}>
                    <button className="btn btn-primary" type="submit" disabled={passLoading}>
                      {passLoading ? <Spinner /> : '确认修改'}
                    </button>
                    <button type="button" className="btn btn-ghost"
                            onClick={() => { setPassStep(1); setPassCode(''); }}>
                      重新发送
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* ── Grants ── */}
          {tab === 'grants' && (
            <div className={styles.panel}>
              <h2 className={styles.panelTitle}>已授权应用</h2>
              <p style={{ fontSize:'0.85rem', color:'var(--ink-3)', marginBottom:18, lineHeight:1.6 }}>
                这些应用可以使用你的栖枢账号登录。你可以随时撤销授权,撤销后该应用将立即失去访问权限。
              </p>
              {grantsLoading ? (
                <div style={{ padding:'40px 0', textAlign:'center' }}>
                  <span className="spinner spinner-dark" style={{ width:24, height:24, borderWidth:2.5 }} />
                </div>
              ) : grants.items.length === 0 ? (
                <div style={{ padding:'40px 20px', textAlign:'center', color:'var(--ink-3)', background:'var(--mist)', borderRadius:'var(--radius)', border:'1px dashed var(--border)' }}>
                  <div style={{ fontSize:'1.8rem', opacity:0.4, marginBottom:10 }}>🔒</div>
                  <div style={{ fontFamily:'var(--font-serif)', color:'var(--ink-2)' }}>暂无已授权的应用</div>
                  <div style={{ fontSize:'0.8rem', marginTop:4 }}>当你第三方登录时,授权记录会显示在这里</div>
                </div>
              ) : (
                <>
                  <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                    {grants.items.map(g => (
                      <div key={g.id} style={{
                        padding:'16px 18px',
                        border:'1px solid var(--border)',
                        borderRadius:'var(--radius-lg)',
                        background:'var(--surface)',
                        display:'flex', alignItems:'flex-start', gap:14,
                      }}>
                        <div style={{
                          flexShrink:0, width:42, height:42, borderRadius:10,
                          background:'var(--amber-dim)', color:'var(--amber)',
                          display:'flex', alignItems:'center', justifyContent:'center',
                          fontFamily:'var(--font-serif)', fontWeight:700, fontSize:'1.1rem',
                        }}>
                          {g.clientName?.[0]?.toUpperCase() || '?'}
                        </div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontWeight:600, color:'var(--ink)', fontFamily:'var(--font-serif)', fontSize:'1rem' }}>
                            {g.clientName}
                          </div>
                          {g.description && (
                            <div style={{ fontSize:'0.82rem', color:'var(--ink-3)', marginTop:3, lineHeight:1.5 }}>
                              {g.description}
                            </div>
                          )}
                          <div style={{ fontSize:'0.75rem', color:'var(--ink-3)', marginTop:10, display:'flex', gap:14, flexWrap:'wrap' }}>
                            <span>授权于 {g.grantedAt ? fmtDate(g.grantedAt) : '-'}</span>
                            {g.lastUsedAt && <span>最近使用 {fmtDate(g.lastUsedAt)}</span>}
                          </div>
                        </div>
                        <button type="button" className="btn btn-outline btn-sm"
                                onClick={() => revokeGrant(g)} style={{ flexShrink:0 }}>
                          撤销
                        </button>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop:14, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span style={{ fontSize:'0.78rem', color:'var(--ink-3)' }}>共 {grants.total} 条</span>
                    <Pagination page={grantPage} totalPages={grants.totalPages} onChange={setGrantPage} />
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Logins ── */}
          {tab === 'logins' && (
            <div className={styles.panel}>
              <h2 className={styles.panelTitle}>登录记录</h2>
              {logins.items.length === 0 ? (
                <p style={{ color:'var(--ink-3)', fontSize:'0.875rem' }}>暂无登录记录</p>
              ) : (
                <>
                  <div style={{ overflowX:'auto' }}>
                    <table className="data-table">
                      <thead><tr><th>时间</th><th>状态</th><th>IP</th><th>备注</th></tr></thead>
                      <tbody>
                        {logins.items.map(r => (
                          <tr key={r.id}>
                            <td style={{ fontFamily:'var(--font-mono)', fontSize:'0.78rem', whiteSpace:'nowrap' }}>
                              {fmtDateTime(r.timestamp)}
                            </td>
                            <td>{r.success ? <Badge type="green">成功</Badge> : <Badge type="red">失败</Badge>}</td>
                            <td style={{ fontFamily:'var(--font-mono)', fontSize:'0.78rem' }}>{r.ip}</td>
                            <td style={{ color:'var(--ink-3)', fontSize:'0.82rem' }}>{r.reason || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ marginTop:14, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span style={{ fontSize:'0.78rem', color:'var(--ink-3)' }}>共 {logins.total} 条,每页 10 条</span>
                    <Pagination page={loginPage} totalPages={logins.totalPages} onChange={setLoginPage} />
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Activity ── */}
          {tab === 'activity' && (
            <div className={styles.panel}>
              <h2 className={styles.panelTitle}>行为日志</h2>
              {activity.capped && (
                <div style={{ marginBottom:14 }}>
                  <Alert type="info">出于数据保护,仅保留最近 {activity.capped} 条操作记录。</Alert>
                </div>
              )}
              {activity.items.length === 0 ? (
                <p style={{ color:'var(--ink-3)', fontSize:'0.875rem' }}>暂无日志记录</p>
              ) : (
                <>
                  <div style={{ overflowX:'auto' }}>
                    <table className="data-table">
                      <thead><tr><th>时间</th><th>操作</th><th>详情</th><th>IP</th></tr></thead>
                      <tbody>
                        {activity.items.map(r => (
                          <tr key={r.id}>
                            <td style={{ fontFamily:'var(--font-mono)', fontSize:'0.78rem', whiteSpace:'nowrap' }}>
                              {fmtDateTime(r.timestamp)}
                            </td>
                            <td><span className="badge badge-gray">{ACTION_LABELS[r.action] || r.action}</span></td>
                            <td style={{ fontSize:'0.82rem', color:'var(--ink-3)' }}>{r.detail || '-'}</td>
                            <td style={{ fontFamily:'var(--font-mono)', fontSize:'0.76rem', color:'var(--ink-3)' }}>{r.ip || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ marginTop:14, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span style={{ fontSize:'0.78rem', color:'var(--ink-3)' }}>共 {activity.total} 条,每页 10 条</span>
                    <Pagination page={actPage} totalPages={activity.totalPages} onChange={setActPage} />
                  </div>
                </>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
