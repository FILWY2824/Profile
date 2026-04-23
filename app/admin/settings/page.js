'use client';
import { useEffect, useState, useCallback } from 'react';
import { Alert, Spinner, useToast, Badge } from '@/components/ui/index.js';
import styles from '../admin.module.css';

const CATEGORIES = {
  auth:         { label: '认证与会话',   order: 1 },
  email:        { label: '邮件服务',     order: 2 },
  oauth:        { label: 'OAuth 接入',   order: 3 },
  verification: { label: '验证码策略',   order: 4 },
  ratelimit:    { label: '反滥用节流',   order: 5 },
  security:     { label: '安全防护',     order: 6 },
  general:      { label: '通用',         order: 7 },
  retention:    { label: '数据保留策略', order: 8 },
};

function isDirty(item, draft) {
  const value = draft[item.key];
  if (item.sensitive) return typeof value === 'string' && value.trim() !== '';
  return value !== undefined && value !== item.value;
}

export default function AdminSettings() {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/settings');
      if (!res.ok) throw new Error('加载配置失败');
      const data = await res.json();
      setItems(data.items || []);
      setDraft(prev => {
        const next = { ...prev };
        for (const item of data.items || []) {
          if (next[item.key] !== undefined) continue;
          next[item.key] = item.sensitive ? '' : item.value;
        }
        return next;
      });
    } catch (e) {
      toast.error(e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  async function save() {
    setSaving(true);
    try {
      const payload = {};
      for (const item of items) {
        const value = draft[item.key];
        if (item.sensitive) {
          if (typeof value === 'string' && value.trim() !== '') payload[item.key] = value;
          continue;
        }
        if (value !== undefined && value !== item.value) payload[item.key] = value;
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
      await load();
    } catch (e) {
      toast.error(e.message || '保存失败');
    } finally {
      setSaving(false);
    }
  }

  const grouped = {};
  for (const item of items) {
    const cat = item.category in CATEGORIES ? item.category : 'general';
    (grouped[cat] = grouped[cat] || []).push(item);
  }
  const orderedCats = Object.keys(grouped).sort(
    (a, b) => (CATEGORIES[a]?.order || 99) - (CATEGORIES[b]?.order || 99)
  );

  const dirty = items.some(item => isDirty(item, draft));

  return (
    <div className={styles.stickyPage}>
      <div className={styles.stickyTop}>
        <div className={styles.stickyHead}>
          <h1 className={styles.pageTitle}>平台配置</h1>
          <div className={styles.stickyActions}>
            <button className="btn btn-primary btn-sm" onClick={save} disabled={saving || !dirty}>
              {saving ? <Spinner /> : '保存修改'}
            </button>
          </div>
        </div>
      </div>

      <div className={styles.scrollArea}>
        <div style={{ marginBottom: 16, display:'grid', gap:12 }}>
          <Alert type="info">
            平台配置仍存放在 <code style={{ fontFamily:'var(--font-mono)' }}>settings</code> 表中，
            但敏感字段已改为只写不回显；留空表示保持不变。
          </Alert>
          <Alert type="warning">
            <strong>JWT_SECRET 已从后台移除。</strong>
            它现在只能通过服务器环境变量维护，且生产环境要求至少 64 字符，避免任何后台泄露面。
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
                  {grouped[cat].map(item => (
                    <div key={item.key} style={{ display:'grid', gridTemplateColumns:'220px 1fr', gap:16, alignItems:'flex-start' }}>
                      <div>
                        <div style={{ fontFamily:'var(--font-mono)', fontSize:'0.82rem', color:'var(--ink)', wordBreak:'break-all', display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                          {item.key}
                          {item.sensitive && <Badge type="amber">敏感</Badge>}
                          {!item.hasValue && <Badge type="gray">未设置</Badge>}
                        </div>
                        <div style={{ fontSize:'0.75rem', color:'var(--ink-3)', marginTop:4, lineHeight:1.5 }}>
                          {item.description}
                        </div>
                      </div>
                      <div>
                        <input
                          className="form-input"
                          type="text"
                          value={item.sensitive ? (draft[item.key] ?? '') : (draft[item.key] ?? item.value)}
                          onChange={e => setDraft(d => ({ ...d, [item.key]: e.target.value }))}
                          placeholder={item.sensitive
                            ? (item.hasValue ? '已设置；留空保持不变，输入新值可覆盖' : '未设置')
                            : '未设置'}
                          spellCheck={false}
                          autoComplete="off"
                          style={{ fontFamily: 'var(--font-mono)', fontSize: '0.84rem' }}
                        />
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
