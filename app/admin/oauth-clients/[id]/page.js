'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Field, Badge, Modal, Alert, useToast, useConfirm } from '@/components/ui/index.js';
import { fmtDateTime } from '@/lib/time.js';
import styles from '../../admin.module.css';
import oc from '../oauth-clients.module.css';

const SCOPE_OPTIONS = [
  { key: 'openid',     label: 'openid',     hint: 'OIDC 必选,启用 /userinfo' },
  { key: 'profile',    label: 'profile',    hint: '返回 name / avatar' },
  { key: 'email',      label: 'email',      hint: '返回 email / email_verified' },
  { key: 'qishu.role', label: 'qishu.role', hint: '自定 scope,返回 role 字段' },
];

const LEVEL_OPTIONS = [
  { value: 0, label: '任何登录用户', hint: '登录即可授权' },
  { value: 1, label: '会员及以上',  hint: '付费 / 会员场景' },
  { value: 2, label: '仅管理员',    hint: '内部工具' },
];

export default function EditOAuthClient() {
  const { id } = useParams();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();

  const [client, setClient] = useState(null);
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [secretModal, setSecretModal] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/oauth-clients/${id}`);
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || '加载失败');
      }
      const d = await res.json();
      setClient(d.client);
      setForm({
        name: d.client.name,
        description: d.client.description || '',
        homepageUrl: d.client.homepageUrl || '',
        logoUrl: d.client.logoUrl || '',
        minLevel: d.client.minLevel ?? 0,
        redirectUrisText: (d.client.redirectUris || []).join('\n'),
        scopes: d.client.scopes || [],
      });
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  }, [id, toast]);
  useEffect(() => { load(); }, [load]);

  function setField(k, v) {
    setForm(f => ({ ...f, [k]: v }));
    setFieldErrors(e => {
      if (!e[k]) return e;
      const next = { ...e }; delete next[k]; return next;
    });
  }

  function toggleScope(s) {
    setForm(f => ({
      ...f,
      scopes: f.scopes.includes(s) ? f.scopes.filter(x => x !== s) : [...f.scopes, s],
    }));
  }

  async function saveChanges(e) {
    e.preventDefault();
    setSaving(true);
    setFieldErrors({});
    try {
      const redirectUris = form.redirectUrisText
        .split('\n').map(x => x.trim()).filter(Boolean);

      const res = await fetch(`/api/admin/oauth-clients/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description.trim(),
          homepageUrl: form.homepageUrl.trim(),
          logoUrl: form.logoUrl.trim(),
          minLevel: Number(form.minLevel),
          redirectUris,
          scopes: form.scopes,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (Array.isArray(data.fieldErrors)) {
          const map = {};
          for (const e of data.fieldErrors) {
            map[e.field] = map[e.field] ? `${map[e.field]}; ${e.message}` : e.message;
          }
          setFieldErrors(map);
        }
        toast.error(data.error || '保存失败');
        return;
      }
      toast.success('已保存');
      setClient(data.client);
    } catch { toast.error('网络错误'); }
    finally { setSaving(false); }
  }

  async function rotateSecret() {
    const ok = await confirm({
      title: '轮换 client_secret',
      message: `该操作会立即撤销 ${client.clientId} 当前所有在用的 access_token / refresh_token,接入方需用新 secret 重新走授权流程。继续吗?`,
      confirmText: '确认轮换',
      tone: 'warning',
    });
    if (!ok) return;

    try {
      const res = await fetch(`/api/admin/oauth-clients/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rotate-secret' }),
      });
      const d = await res.json();
      if (!res.ok) { toast.error(d.error || '操作失败'); return; }
      setSecretModal({ secret: d.clientSecret, warning: d.clientSecretWarning });
    } catch { toast.error('网络错误'); }
  }

  async function toggleStatus() {
    try {
      const res = await fetch(`/api/admin/oauth-clients/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle-status' }),
      });
      const d = await res.json();
      if (!res.ok) { toast.error(d.error || '操作失败'); return; }
      toast.success(d.client.status === 'active' ? '已启用' : '已停用');
      setClient(d.client);
    } catch { toast.error('网络错误'); }
  }

  async function deleteClient() {
    const ok = await confirm({
      title: `删除 ${client.clientId}`,
      message: '该操作会级联删除这个 client 对应的所有 grant、access_token、refresh_token、已签未用的 authorization code。不可恢复。',
      confirmText: '确认删除',
      tone: 'danger',
    });
    if (!ok) return;

    try {
      const res = await fetch(`/api/admin/oauth-clients/${id}`, { method: 'DELETE' });
      const d = await res.json();
      if (!res.ok) { toast.error(d.error || '删除失败'); return; }
      toast.success('已删除');
      router.push('/admin/oauth-clients');
    } catch { toast.error('网络错误'); }
  }

  async function copySecret(s) {
    try { await navigator.clipboard.writeText(s); toast.success('已复制'); }
    catch { toast.error('复制失败'); }
  }

  if (loading) {
    return (
      <div style={{ padding: 40, display: 'flex', justifyContent: 'center' }}>
        <span className="spinner spinner-dark" style={{ width: 24, height: 24 }} />
      </div>
    );
  }
  if (!client || !form) return null;

  return (
    <div className={styles.stickyPage}>
      <div className={styles.stickyTop}>
        <div className={styles.stickyHead}>
          <div className={oc.titleBlock}>
            <Link href="/admin/oauth-clients" className={oc.breadcrumb}>← 返回列表</Link>
            <h1 className={styles.pageTitle}>
              {client.name}
              <span style={{ marginLeft: 10, fontSize: '0.78rem', verticalAlign: 'middle' }}>
                {client.status === 'active'
                  ? <Badge type="green">启用</Badge>
                  : <Badge type="amber">停用</Badge>}
              </span>
            </h1>
            <div className={oc.clientMeta}>
              <span className={oc.clientMetaId}>{client.clientId}</span>
              <span>·</span>
              <span>创建于 {client.createdAt ? fmtDateTime(client.createdAt) : '-'}</span>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.scrollArea}>
        <form onSubmit={saveChanges} className={oc.formLayout}>
          {/* ─── 左列:编辑表单 ─────────────────────────────────────────── */}
          <div>
            {/* 基础信息 */}
            <div className={oc.sectionCard}>
              <div className={oc.sectionHead}>
                <div className={oc.sectionTitle}>基础信息</div>
                <div className={oc.sectionHint}>clientId 创建后不可修改</div>
              </div>
              <div className={oc.sectionBody}>
                <Field label="clientId(不可修改)">
                  <input
                    className="form-input"
                    value={client.clientId}
                    disabled
                    readOnly
                    style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink-3)', background: 'var(--mist)' }}
                  />
                </Field>

                <Field label="显示名称" error={fieldErrors.name}>
                  <input
                    className="form-input"
                    value={form.name}
                    onChange={e => setField('name', e.target.value)}
                    required
                  />
                </Field>

                <Field label="描述(可选)" error={fieldErrors.description}>
                  <textarea
                    className="form-input"
                    rows={2}
                    value={form.description}
                    onChange={e => setField('description', e.target.value)}
                  />
                </Field>

                <div className={oc.twoCol}>
                  <Field label="应用主页(可选)">
                    <input
                      className="form-input"
                      value={form.homepageUrl}
                      onChange={e => setField('homepageUrl', e.target.value)}
                    />
                  </Field>
                  <Field label="Logo URL(可选)">
                    <input
                      className="form-input"
                      value={form.logoUrl}
                      onChange={e => setField('logoUrl', e.target.value)}
                    />
                  </Field>
                </div>
              </div>
            </div>

            {/* 访问配置 */}
            <div className={oc.sectionCard}>
              <div className={oc.sectionHead}>
                <div className={oc.sectionTitle}>访问配置</div>
                <div className={oc.sectionHint}>修改 redirect URI 会影响正在运行的接入方,请确保接入方已同步改动</div>
              </div>
              <div className={oc.sectionBody}>
                <Field
                  label="回调地址(每行一条)"
                  hint="生产下非 localhost 必须 https"
                  error={fieldErrors.redirectUris}
                >
                  <textarea
                    className="form-input"
                    rows={4}
                    style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}
                    value={form.redirectUrisText}
                    onChange={e => setField('redirectUrisText', e.target.value)}
                    required
                  />
                </Field>

                <Field label="Scopes" error={fieldErrors.scopes}>
                  <div className={oc.checkList}>
                    {SCOPE_OPTIONS.map(opt => (
                      <label key={opt.key} className={oc.checkItem}>
                        <input
                          type="checkbox"
                          checked={form.scopes.includes(opt.key)}
                          onChange={() => toggleScope(opt.key)}
                        />
                        <span>
                          <code className={oc.checkLabel}>{opt.label}</code>
                          <span className={oc.checkHint}>{opt.hint}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </Field>
              </div>
            </div>

            {/* 安全策略 */}
            <div className={oc.sectionCard}>
              <div className={oc.sectionHead}>
                <div className={oc.sectionTitle}>安全策略</div>
                <div className={oc.sectionHint}>最低角色门槛</div>
              </div>
              <div className={oc.sectionBody}>
                <Field label="最低角色要求" error={fieldErrors.minLevel}>
                  <div className={oc.radioList}>
                    {LEVEL_OPTIONS.map(opt => (
                      <label
                        key={opt.value}
                        className={`${oc.radioItem} ${Number(form.minLevel) === opt.value ? oc.radioItemActive : ''}`}
                      >
                        <input
                          type="radio"
                          name="minLevel"
                          checked={Number(form.minLevel) === opt.value}
                          onChange={() => setField('minLevel', opt.value)}
                        />
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span className={oc.radioLabel}>{opt.label}</span>
                          <span style={{ fontSize: '0.73rem', color: 'var(--ink-3)' }}>{opt.hint}</span>
                        </div>
                      </label>
                    ))}
                  </div>
                </Field>
              </div>
            </div>

            <Alert type="info">
              client_secret 本页不展示(后台只存 bcrypt 哈希)。丢了的话到右侧「危险操作」轮换秘钥。
            </Alert>

            <div className={oc.formActions}>
              <Link href="/admin/oauth-clients" className="btn btn-outline btn-sm">取消</Link>
              <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
                {saving ? '保存中...' : '保存修改'}
              </button>
            </div>
          </div>

          {/* ─── 右列:客户端操作 + 危险区 ──────────────────────────────── */}
          <aside className={oc.sidePanel}>
            <div className={oc.panelCard}>
              <div className={oc.panelTitle}>客户端操作</div>
              <div className={oc.panelSubtitle}>
                停用后:现有 token 保持有效,但新授权请求会被拒绝
              </div>
              <button
                type="button"
                className="btn btn-outline btn-sm btn-full"
                onClick={toggleStatus}
              >
                {client.status === 'active' ? '停用客户端' : '启用客户端'}
              </button>
            </div>

            <div className={oc.dangerCard}>
              <div className={oc.dangerTitle}>⚠ 危险操作</div>
              <div className={oc.dangerDesc}>
                轮换秘钥会让所有已发出的 token 立即失效;
                删除会级联清除全部 grant 与 token,不可恢复。
              </div>
              <div className={oc.dangerRow}>
                <button
                  type="button"
                  className="btn btn-outline btn-sm btn-full"
                  onClick={rotateSecret}
                >
                  轮换 client_secret
                </button>
                <button
                  type="button"
                  className="btn btn-danger btn-sm btn-full"
                  onClick={deleteClient}
                >
                  删除客户端
                </button>
              </div>
            </div>
          </aside>
        </form>
      </div>

      {secretModal && (
        <Modal
          title={`${client.clientId} 的新 client_secret`}
          size="md"
          onClose={() => setSecretModal(null)}
          footer={
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
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
