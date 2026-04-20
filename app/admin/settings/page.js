'use client';
import { useEffect, useState, useCallback } from 'react';
import { Alert, Spinner, useToast, useConfirm, Badge } from '@/components/ui/index.js';
import styles from '../admin.module.css';

const CATEGORIES = {
  auth:         { label: '认证与会话',   order: 1 },
  email:        { label: '邮件服务',     order: 2 },
  oauth:        { label: 'OAuth 接入',   order: 3 },
  verification: { label: '验证码策略',   order: 4 },
  ratelimit:    { label: '反滥用节流',   order: 5 },
  security:     { label: '安全防护',     order: 6 },
  backup:       { label: '数据库备份',   order: 7 },
  general:      { label: '通用',         order: 8 },
  retention:    { label: '数据保留策略', order: 9 },
};

// 某些配置项天然是多行的(比如 SSH 私钥),用 input 会被挤成一行看不到全文。
// 这里用一个最小列表指定"需要用 textarea 渲染"的 key,避免把单行 input
// 全改成 textarea(敲一行 JWT_SECRET 也给 3 行的框,难看)。
const MULTILINE_KEYS = new Set(['BACKUP_PRIVATE_KEY']);

export default function AdminSettings() {
  const toast = useToast();
  const confirm = useConfirm();
  const [items, setItems] = useState([]);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({});

  const load = useCallback(async (reveal = revealed) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/settings${reveal ? '?reveal=1' : ''}`);
      if (!res.ok) throw new Error('加载配置失败');
      const data = await res.json();
      setItems(data.items);
      setDraft(prev => {
        const out = { ...prev };
        for (const it of data.items) {
          if (out[it.key] === undefined) out[it.key] = it.value;
        }
        return out;
      });
    } catch (e) { toast.error(e.message || '加载失败'); }
    finally { setLoading(false); }
  }, [revealed, toast]);

  // 首次加载用 reveal=false —— 显式把空 deps 传进来,让它只跑一次。
  // 后续 toggleReveal / save 会主动调用 load(),不依赖 effect 重跑。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(false); }, []);

  async function toggleReveal() {
    if (!revealed) {
      const ok = await confirm({
        title: '查看敏感信息',
        message: '将显示所有密钥的明文,并记录为一次敏感操作。是否继续?',
        confirmText: '查看明文',
        tone: 'warning',
        confirmClass: 'btn-amber',
      });
      if (!ok) return;
    }
    const next = !revealed;
    setRevealed(next);
    setDraft({});
    await load(next);
  }

  async function save() {
    setSaving(true);
    try {
      const payload = {};
      for (const it of items) {
        const v = draft[it.key];
        if (v !== undefined && v !== it.value) payload[it.key] = v;
      }
      if (Object.keys(payload).length === 0) {
        toast.info('没有修改可保存');
        return;
      }
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '保存失败');
      toast.success(`已保存 ${Object.keys(payload).length} 项配置`);
      setDraft({});
      await load(revealed);
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  }

  const grouped = {};
  for (const it of items) {
    const cat = it.category in CATEGORIES ? it.category : 'general';
    (grouped[cat] = grouped[cat] || []).push(it);
  }
  const orderedCats = Object.keys(grouped).sort(
    (a, b) => (CATEGORIES[a]?.order || 99) - (CATEGORIES[b]?.order || 99)
  );

  const dirty = items.some(it => {
    const v = draft[it.key];
    return v !== undefined && v !== it.value;
  });

  return (
    <div className={styles.stickyPage}>
      {/* 单行顶栏 —— 标题左,操作右 */}
      <div className={styles.stickyTop}>
        <div className={styles.stickyHead}>
          <h1 className={styles.pageTitle}>平台配置</h1>
          <div className={styles.stickyActions}>
            <button className="btn btn-outline btn-sm" onClick={toggleReveal} disabled={loading}>
              {revealed ? '隐藏敏感' : '查看敏感'}
            </button>
            <button className="btn btn-primary btn-sm" onClick={save} disabled={saving || !dirty}>
              {saving ? <Spinner /> : '保存修改'}
            </button>
          </div>
        </div>
      </div>

      {/* 下方内容区滚动 */}
      <div className={styles.scrollArea}>
        <div style={{ marginBottom: 16 }}>
          <Alert type="info">
            此处的配置项在首次部署时由 <code style={{ fontFamily:'var(--font-mono)' }}>.env</code> 自动迁移进数据库。
            之后所有修改都直接写入 settings 表,无需改环境变量也无需重启服务。
          </Alert>
        </div>

        {loading ? (
          <div style={{ display:'flex', justifyContent:'center', padding:40 }}>
            <span className="spinner spinner-dark" style={{ width:24, height:24 }} />
          </div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:18 }}>
            {orderedCats.map(cat => (
              <div key={cat} className={styles.pageCard} style={{ padding:'20px 24px' }}>
                <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14 }}>
                  <h3 style={{ fontFamily:'var(--font-serif)', fontSize:'1.05rem', color:'var(--ink)', fontWeight:600 }}>
                    {CATEGORIES[cat]?.label || cat}
                  </h3>
                  <span style={{ fontSize:'0.72rem', color:'var(--ink-3)' }}>
                    {grouped[cat].length} 项
                  </span>
                </div>
                <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
                  {grouped[cat].map(it => (
                    <div key={it.key} style={{ display:'grid', gridTemplateColumns:'220px 1fr', gap:16, alignItems:'flex-start' }}>
                      <div>
                        <div style={{ fontFamily:'var(--font-mono)', fontSize:'0.82rem', color:'var(--ink)', wordBreak:'break-all', display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                          {it.key}
                          {it.sensitive && <Badge type="amber">敏感</Badge>}
                          {!it.hasValue && <Badge type="gray">未设置</Badge>}
                        </div>
                        <div style={{ fontSize:'0.75rem', color:'var(--ink-3)', marginTop:4, lineHeight:1.5 }}>
                          {it.description}
                        </div>
                      </div>
                      <div>
                        {MULTILINE_KEYS.has(it.key) ? (
                          <textarea
                            className="form-input"
                            value={draft[it.key] ?? it.value}
                            onChange={e => setDraft(d => ({ ...d, [it.key]: e.target.value }))}
                            placeholder={it.sensitive && it.hasValue
                              ? '●●●●●● (已设置,粘贴新内容以覆盖;留空保持不变会被清空)'
                              : '粘贴完整 PEM 文本(-----BEGIN ... -----END ... -----)'}
                            spellCheck={false}
                            rows={6}
                            style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', lineHeight: 1.45, resize: 'vertical' }}
                          />
                        ) : (
                          <input
                            className="form-input"
                            type="text"
                            value={draft[it.key] ?? it.value}
                            onChange={e => setDraft(d => ({ ...d, [it.key]: e.target.value }))}
                            placeholder={it.sensitive && it.hasValue ? '●●●●●● (已设置,输入以覆盖)' : '未设置'}
                            spellCheck={false}
                            style={{ fontFamily: 'var(--font-mono)', fontSize: '0.84rem' }}
                          />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
