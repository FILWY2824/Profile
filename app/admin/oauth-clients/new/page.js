'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Field, Modal, Alert, useToast } from '@/components/ui/index.js';
import { OAUTH_TEMPLATES, getTemplate } from '@/lib/oauthTemplates.js';
import styles from '../../admin.module.css';
import oc from '../oauth-clients.module.css';

const SCOPE_OPTIONS = [
  { key: 'openid',     label: 'openid',     hint: 'OIDC 必选,启用 /userinfo' },
  { key: 'profile',    label: 'profile',    hint: '返回 name / avatar' },
  { key: 'email',      label: 'email',      hint: '返回 email / email_verified' },
  { key: 'qishu.role', label: 'qishu.role', hint: '自定 scope,返回 role 字段(非标准 OIDC)' },
];

const LEVEL_OPTIONS = [
  { value: 0, label: '任何登录用户', hint: '登录即可授权' },
  { value: 1, label: '会员及以上',  hint: '付费 / 会员场景' },
  { value: 2, label: '仅管理员',    hint: '内部工具' },
];

// 默认选中"空白表单"模板;跟 OAUTH_TEMPLATES[0] 对齐。
const DEFAULT_TEMPLATE_ID = 'blank';
const DEFAULT_FORM = getTemplate(DEFAULT_TEMPLATE_ID).form;

export default function NewOAuthClient() {
  const router = useRouter();
  const toast = useToast();

  const [form, setForm] = useState({ ...DEFAULT_FORM });
  const [selectedTemplate, setSelectedTemplate] = useState(DEFAULT_TEMPLATE_ID);
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [secretModal, setSecretModal] = useState(null);

  function setField(k, v) {
    setForm(f => ({ ...f, [k]: v }));
    // 用户重新编辑就清掉该字段的错误提示
    setFieldErrors(e => {
      if (!e[k]) return e;
      const next = { ...e }; delete next[k]; return next;
    });
  }

  // 一键套用模板:把所有字段都用模板的值替换掉。选"空白表单"就等于清空。
  function applyTemplate(id) {
    const t = getTemplate(id);
    setForm({ ...t.form });
    setSelectedTemplate(id);
    setFieldErrors({});
  }

  function toggleScope(s) {
    setForm(f => ({
      ...f,
      scopes: f.scopes.includes(s) ? f.scopes.filter(x => x !== s) : [...f.scopes, s],
    }));
  }

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setFieldErrors({});
    try {
      const redirectUris = form.redirectUrisText
        .split('\n').map(x => x.trim()).filter(Boolean);

      const body = {
        clientId: form.clientId.trim(),
        name: form.name.trim(),
        description: form.description.trim(),
        homepageUrl: form.homepageUrl.trim(),
        logoUrl: form.logoUrl.trim(),
        minLevel: Number(form.minLevel),
        redirectUris,
        scopes: form.scopes,
      };

      const res = await fetch('/api/admin/oauth-clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
        toast.error(data.error || '创建失败');
        return;
      }

      setSecretModal({
        clientId: data.client.clientId,
        secret: data.clientSecret,
        warning: data.clientSecretWarning,
      });
    } catch (err) {
      toast.error('网络错误');
    } finally {
      setSaving(false);
    }
  }

  async function copySecret(s) {
    try { await navigator.clipboard.writeText(s); toast.success('已复制到剪贴板'); }
    catch { toast.error('复制失败,请手动选中复制'); }
  }

  function dismissSecretAndLeave() {
    setSecretModal(null);
    router.push('/admin/oauth-clients');
  }

  return (
    <div className={styles.stickyPage}>
      <div className={styles.stickyTop}>
        <div className={styles.stickyHead}>
          <div className={oc.titleBlock}>
            <Link href="/admin/oauth-clients" className={oc.breadcrumb}>← 返回列表</Link>
            <h1 className={styles.pageTitle}>新增 OAuth 客户端</h1>
          </div>
        </div>
      </div>

      <div className={styles.scrollArea}>
        <form onSubmit={submit} className={oc.formLayout}>
          {/* ─── 左列:表单主体 ─────────────────────────────────────────── */}
          <div>
            {/* 基础信息 */}
            <div className={oc.sectionCard}>
              <div className={oc.sectionHead}>
                <div className={oc.sectionTitle}>基础信息</div>
                <div className={oc.sectionHint}>应用名与 clientId,展示在用户授权同意页上</div>
              </div>
              <div className={oc.sectionBody}>
                <Field
                  label="clientId"
                  hint="3-64 位小写字母/数字/._-;创建后不可修改"
                  error={fieldErrors.clientId}
                >
                  <input
                    className="form-input"
                    style={{ fontFamily: 'var(--font-mono)' }}
                    value={form.clientId}
                    onChange={e => setField('clientId', e.target.value)}
                    placeholder="my-app"
                    required
                  />
                </Field>

                <Field
                  label="显示名称"
                  hint="展示在同意页上,接入方用户能看见"
                  error={fieldErrors.name}
                >
                  <input
                    className="form-input"
                    value={form.name}
                    onChange={e => setField('name', e.target.value)}
                    placeholder="My Awesome App"
                    required
                  />
                </Field>

                <Field label="描述(可选)" error={fieldErrors.description}>
                  <textarea
                    className="form-input"
                    rows={2}
                    value={form.description}
                    onChange={e => setField('description', e.target.value)}
                    placeholder="在同意页给用户看的一句话简介"
                  />
                </Field>

                <div className={oc.twoCol}>
                  <Field label="应用主页(可选)">
                    <input
                      className="form-input"
                      value={form.homepageUrl}
                      onChange={e => setField('homepageUrl', e.target.value)}
                      placeholder="https://example.com"
                    />
                  </Field>
                  <Field label="Logo URL(可选)">
                    <input
                      className="form-input"
                      value={form.logoUrl}
                      onChange={e => setField('logoUrl', e.target.value)}
                      placeholder="https://.../logo.png"
                    />
                  </Field>
                </div>
              </div>
            </div>

            {/* 访问配置 */}
            <div className={oc.sectionCard}>
              <div className={oc.sectionHead}>
                <div className={oc.sectionTitle}>访问配置</div>
                <div className={oc.sectionHint}>回调地址 + 申请的权限范围</div>
              </div>
              <div className={oc.sectionBody}>
                <Field
                  label="回调地址(redirect_uri)"
                  hint="每行一条。必须是 http(s):// 的绝对地址;生产环境下非 localhost 必须 https"
                  error={fieldErrors.redirectUris}
                >
                  <textarea
                    className="form-input"
                    rows={4}
                    style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}
                    value={form.redirectUrisText}
                    onChange={e => setField('redirectUrisText', e.target.value)}
                    placeholder={'https://app.example.com/oauth/callback\nhttp://localhost:3000/oauth/callback'}
                    required
                  />
                </Field>

                <Field label="Scopes(申请的权限)" error={fieldErrors.scopes}>
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
                <div className={oc.sectionHint}>最低角色门槛 —— 不满足此角色的用户在授权页会被拒绝</div>
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
              创建后会生成一段 <code>client_secret</code> 并<b>仅展示一次</b>。
              请在弹窗出现时立即复制保存;如果不慎关闭或丢失,只能到列表页「轮换秘钥」重新生成
              (会让旧的所有 token 立即失效)。
            </Alert>

            <div className={oc.formActions}>
              <Link href="/admin/oauth-clients" className="btn btn-outline btn-sm">取消</Link>
              <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
                {saving ? '创建中...' : '创建客户端'}
              </button>
            </div>
          </div>

          {/* ─── 右列:模板面板 + 提示 ─────────────────────────────────── */}
          <aside className={oc.sidePanel}>
            <div className={oc.panelCard}>
              <div className={oc.panelTitle}>⚡ 快速模板</div>
              <div className={oc.panelSubtitle}>
                选一个接近你场景的模板,一键填满所有字段,再改细节后提交
              </div>
              <div className={oc.tmplList}>
                {OAUTH_TEMPLATES.map(t => (
                  <button
                    key={t.id}
                    type="button"
                    className={`${oc.tmplBtn} ${selectedTemplate === t.id ? oc.tmplBtnActive : ''}`}
                    onClick={() => applyTemplate(t.id)}
                  >
                    <span className={oc.tmplBtnName}>{t.name}</span>
                    <span className={oc.tmplBtnDesc}>{t.description}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className={oc.panelCard} style={{ background: 'var(--mist)' }}>
              <div className={oc.panelTitle}>💡 小提示</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--ink-2)', lineHeight: 1.65 }}>
                • <b>clientId</b> 只能用小写字母、数字和 <code style={{ fontFamily:'var(--font-mono)' }}>. _ -</code>,创建后不可修改<br />
                • <b>回调地址</b>必须和授权发起方一字不差地匹配,差一个斜杠都不行<br />
                • 生产环境的回调必须是 <code style={{ fontFamily:'var(--font-mono)' }}>https://</code>,localhost 可以用 http
              </div>
            </div>
          </aside>
        </form>
      </div>

      {secretModal && (
        <Modal
          title={`${secretModal.clientId} 创建成功`}
          size="md"
          onClose={dismissSecretAndLeave}
          footer={
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-outline btn-sm" onClick={() => copySecret(secretModal.secret)}>复制秘钥</button>
              <button className="btn btn-primary btn-sm" onClick={dismissSecretAndLeave}>我已保存,返回列表</button>
            </div>
          }
        >
          <div className={oc.secretWarning}>⚠️ {secretModal.warning}</div>
          <div className={oc.secretLabel}>client_id</div>
          <pre className={oc.secretBox} style={{ marginBottom: 12 }}>{secretModal.clientId}</pre>
          <div className={oc.secretLabel}>client_secret</div>
          <pre className={oc.secretBox}>{secretModal.secret}</pre>
        </Modal>
      )}
    </div>
  );
}
