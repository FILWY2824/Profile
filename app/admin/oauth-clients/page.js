'use client';
import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { Badge, EmptyState, Modal, useToast, useConfirm } from '@/components/ui/index.js';
import { fmtDateTime } from '@/lib/time.js';
import styles from '../admin.module.css';
import oc from './oauth-clients.module.css';

const LEVEL_LABEL = { 0: '任何登录用户', 1: '会员及以上', 2: '仅管理员' };

// ── 根据 clientId 生成稳定的 logo 背景色 ───────────────────────────────
// 同一个 clientId 永远拿到同一种颜色,换个角度提高识别度。
const LOGO_COLORS = [
  '#c9622f', '#2b6cb0', '#2f7c5a', '#6a4998',
  '#c03030', '#b3851f', '#14776e', '#8a4c2e',
];
function hashColor(s = '') {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0xffff;
  return LOGO_COLORS[h % LOGO_COLORS.length];
}

function LogoBadge({ clientId, name, logoUrl }) {
  if (logoUrl) {
    return (
      <div className={oc.cardLogo} style={{ background: 'var(--mist-2)' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoUrl} alt="" onError={e => { e.currentTarget.style.display = 'none'; }} />
      </div>
    );
  }
  const letter = (name || clientId || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <div className={oc.cardLogo} style={{ background: hashColor(clientId || name) }}>
      {letter}
    </div>
  );
}

function ClientCard({ c, onToggle, onRotate, onDelete }) {
  const isStatic = c.source === 'static';
  const redirectUris = c.redirectUris || [];
  const scopes = c.scopes || [];

  return (
    <div className={`${oc.card} ${isStatic ? oc.cardStatic : ''}`}>
      <div className={oc.cardHead}>
        <LogoBadge clientId={c.clientId} name={c.name} logoUrl={c.logoUrl} />
        <div className={oc.cardTitle}>
          <div className={oc.cardName}>{c.name || c.clientId}</div>
          <div className={oc.cardId}>{c.clientId}</div>
        </div>
        <div className={oc.cardBadges}>
          {isStatic ? <Badge type="gray">静态</Badge> : <Badge type="blue">动态</Badge>}
          {c.status === 'active'
            ? <Badge type="green">启用</Badge>
            : <Badge type="amber">停用</Badge>}
        </div>
      </div>

      <div className={oc.cardMeta}>
        <div className={oc.cardMetaLabel}>Scopes</div>
        <div className={oc.cardMetaValue}>
          {scopes.length === 0 ? (
            <span className={oc.cardMetaMuted}>未设置</span>
          ) : (
            <div className={oc.cardScopes}>
              {scopes.map(s => <span key={s} className={oc.scopeChip}>{s}</span>)}
            </div>
          )}
        </div>

        <div className={oc.cardMetaLabel}>最低角色</div>
        <div className={oc.cardMetaValue}>{LEVEL_LABEL[Number(c.minLevel) || 0]}</div>

        <div className={oc.cardMetaLabel}>回调</div>
        <div className={`${oc.cardMetaValue} ${oc.cardMetaMono}`}>
          {redirectUris.length === 0 ? (
            <span className={oc.cardMetaMuted}>未设置</span>
          ) : (
            <>
              {redirectUris.slice(0, 2).map(u => (
                <div key={u} title={u} style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {u}
                </div>
              ))}
              {redirectUris.length > 2 && (
                <div className={oc.cardMetaMuted}>…还有 {redirectUris.length - 2} 条</div>
              )}
            </>
          )}
        </div>
      </div>

      <div className={oc.cardFoot}>
        <div className={oc.cardUpdated}>
          {c.updatedAt && c.updatedAt !== '1970-01-01T00:00:00.000Z'
            ? `更新于 ${fmtDateTime(c.updatedAt)}`
            : '—'}
        </div>
        <div className={oc.cardActions}>
          {isStatic ? (
            <span className={oc.cardReadonly}>只读 · 改代码配置</span>
          ) : (
            <>
              <Link className="btn btn-outline btn-sm" href={`/admin/oauth-clients/${c.id}`}>编辑</Link>
              <button className="btn btn-outline btn-sm" onClick={() => onRotate(c)}>轮换秘钥</button>
              <button className="btn btn-outline btn-sm" onClick={() => onToggle(c)}>
                {c.status === 'active' ? '停用' : '启用'}
              </button>
              <button className="btn btn-danger btn-sm" onClick={() => onDelete(c)}>删除</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AdminOAuthClients() {
  const toast = useToast();
  const confirm = useConfirm();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [secretModal, setSecretModal] = useState(null);   // { clientId, secret, warning }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/oauth-clients');
      if (!res.ok) throw new Error('加载客户端列表失败');
      const d = await res.json();
      setItems(d.items || []);
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const stats = useMemo(() => {
    let active = 0, disabled = 0, dynamic = 0, staticCount = 0;
    for (const c of items) {
      if (c.status === 'active') active++;
      else if (c.status === 'disabled') disabled++;
      if (c.source === 'static') staticCount++;
      else dynamic++;
    }
    return { total: items.length, active, disabled, dynamic, staticCount };
  }, [items]);

  async function toggleStatus(c) {
    try {
      const res = await fetch(`/api/admin/oauth-clients/${c.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle-status' }),
      });
      const d = await res.json();
      if (!res.ok) { toast.error(d.error || '操作失败'); return; }
      toast.success(d.client.status === 'active' ? '已启用' : '已停用');
      load();
    } catch { toast.error('网络错误'); }
  }

  async function rotateSecret(c) {
    const ok = await confirm({
      title: '轮换 client_secret',
      message: `该操作会立即撤销 ${c.clientId} 当前所有在用的 access_token / refresh_token,接入方需用新 secret 重新走授权流程。继续吗?`,
      confirmText: '确认轮换',
      tone: 'warning',
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/admin/oauth-clients/${c.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rotate-secret' }),
      });
      const d = await res.json();
      if (!res.ok) { toast.error(d.error || '操作失败'); return; }
      setSecretModal({ clientId: c.clientId, secret: d.clientSecret, warning: d.clientSecretWarning });
    } catch { toast.error('网络错误'); }
  }

  async function deleteClient(c) {
    const ok = await confirm({
      title: `删除 ${c.clientId}`,
      message: '该操作会级联删除这个 client 对应的所有 grant、access_token、refresh_token、已签未用的 authorization code。不可恢复。',
      confirmText: '确认删除',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/admin/oauth-clients/${c.id}`, { method: 'DELETE' });
      const d = await res.json();
      if (!res.ok) { toast.error(d.error || '删除失败'); return; }
      toast.success('已删除');
      load();
    } catch { toast.error('网络错误'); }
  }

  async function copySecret(s) {
    try { await navigator.clipboard.writeText(s); toast.success('已复制到剪贴板'); }
    catch { toast.error('复制失败,请手动选中复制'); }
  }

  return (
    <div className={styles.stickyPage}>
      <div className={styles.stickyTop}>
        <div className={styles.stickyHead}>
          <h1 className={styles.pageTitle}>OAuth 客户端</h1>
          <div className={styles.stickyActions}>
            <Link href="/admin/oauth-clients/new" className="btn btn-primary btn-sm">+ 新增客户端</Link>
          </div>
        </div>
      </div>

      <div className={styles.scrollArea}>
        <div className={oc.introCard}>
          静态客户端来自 <code>config/oauth-clients.js</code>,元数据只能通过改代码调整,
          secret 通过{' '}
          <Link href="/admin/settings" style={{ color:'var(--amber)', textDecoration:'underline' }}>平台配置</Link>
          {' '}轮换。动态客户端在此页全套管理:创建、编辑、启停、轮换秘钥、删除。
        </div>

        {!loading && items.length > 0 && (
          <div className={oc.statsStrip}>
            <div className={oc.statPill}>
              <div className={oc.statPillLabel}>总数</div>
              <div className={oc.statPillValue}>{stats.total}</div>
            </div>
            <div className={oc.statPill}>
              <div className={oc.statPillLabel}>启用中</div>
              <div className={oc.statPillValue} style={{ color:'var(--jade)' }}>{stats.active}</div>
            </div>
            <div className={oc.statPill}>
              <div className={oc.statPillLabel}>已停用</div>
              <div className={oc.statPillValue} style={{ color:'var(--amber)' }}>{stats.disabled}</div>
            </div>
            <div className={oc.statPill}>
              <div className={oc.statPillLabel}>动态 / 静态</div>
              <div className={oc.statPillValue} style={{ fontSize:'1.2rem' }}>
                {stats.dynamic}
                <span style={{ color:'var(--ink-3)', fontSize:'0.95rem', fontWeight:400 }}>
                  {' / '}{stats.staticCount}
                </span>
              </div>
            </div>
          </div>
        )}

        {loading ? (
          <div style={{ display:'flex', justifyContent:'center', padding:'60px' }}>
            <span className="spinner spinner-dark" style={{ width:28, height:28 }} />
          </div>
        ) : items.length === 0 ? (
          <div className={styles.pageCard}>
            <EmptyState
              icon="◎"
              title="还没有 OAuth 客户端"
              desc="点右上角「新增客户端」接入第一个应用"
              action={<Link href="/admin/oauth-clients/new" className="btn btn-primary btn-sm">+ 新增客户端</Link>}
            />
          </div>
        ) : (
          <div className={oc.grid}>
            {items.map(c => (
              <ClientCard
                key={c.id}
                c={c}
                onToggle={toggleStatus}
                onRotate={rotateSecret}
                onDelete={deleteClient}
              />
            ))}
          </div>
        )}
      </div>

      {secretModal && (
        <Modal
          title={`${secretModal.clientId} 的新 client_secret`}
          size="md"
          onClose={() => setSecretModal(null)}
          footer={
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
              <button className="btn btn-outline btn-sm" onClick={() => copySecret(secretModal.secret)}>复制秘钥</button>
              <button className="btn btn-primary btn-sm" onClick={() => setSecretModal(null)}>我已保存</button>
            </div>
          }
        >
          <div className={oc.secretWarning}>⚠️ {secretModal.warning}</div>
          <pre className={oc.secretBox}>{secretModal.secret}</pre>
        </Modal>
      )}
    </div>
  );
}
