'use client';
import { useEffect, useState, useCallback } from 'react';
import { Alert, Spinner, useToast, useConfirm, Badge } from '@/components/ui/index.js';
import styles from '../admin.module.css';

const TARGETS = [
  { key: 'login_history',      label: '登录记录',     hasPolicy: true,  description: '用户的每次登录尝试(成功与失败)都会写入此表,按天累积速度相对较快。' },
  { key: 'activity_log',       label: '行为日志',     hasPolicy: true,  description: '所有用户与管理员的操作事件,随使用频率累积,长期容易占用大量空间。' },
  { key: 'verification_codes', label: '验证码',       hasPolicy: false, description: '邮件验证码记录。仅清理已过期或已使用的条目。' },
  { key: 'oauth_tokens',       label: 'OAuth 令牌',   hasPolicy: false, description: '仅清理已过期或已撤销的访问令牌与关联的授权码。' },
];

export default function AdminRetention() {
  const toast = useToast();
  const confirm = useConfirm();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null); // which target is currently being pruned
  const [state, setState] = useState({ policies: {}, counts: {} });
  const [daysByTarget, setDaysByTarget] = useState({});
  const [saveAsDefault, setSaveAsDefault] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/retention');
      if (!res.ok) throw new Error('加载失败');
      const data = await res.json();
      setState(data);
      // 把当前策略回填到表单默认值
      setDaysByTarget(prev => ({
        login_history:      prev.login_history      ?? data.policies.LOGIN_HISTORY_RETENTION_DAYS ?? 30,
        activity_log:       prev.activity_log       ?? data.policies.ACTIVITY_LOG_RETENTION_DAYS  ?? 30,
        verification_codes: prev.verification_codes ?? 0,
        oauth_tokens:       prev.oauth_tokens       ?? 0,
      }));
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  async function runPrune(target) {
    const days = parseInt(daysByTarget[target], 10);
    if (!Number.isFinite(days) || days < 0) {
      toast.error('请输入非负整数天数');
      return;
    }

    const hardDelete = days === 0;
    const targetLabel = TARGETS.find(t => t.key === target)?.label || target;
    const msg = hardDelete
      ? `这将删除 ${targetLabel} 表中的全部数据,且无法恢复。确定继续?`
      : `这将删除 ${targetLabel} 中 ${days} 天之前的所有数据。确定继续?`;

    const ok = await confirm({
      title: hardDelete ? '清空全部数据' : '按保留天数清理',
      message: msg,
      confirmText: hardDelete ? '确认清空' : '确认清理',
      tone: 'danger',
    });
    if (!ok) return;

    setBusy(target);
    try {
      const res = await fetch('/api/admin/retention', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target,
          days,
          saveAsDefault: !!saveAsDefault[target],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '清理失败');
      const deleted = data.results?.[target]?.deleted;
      if (deleted !== undefined) {
        toast.success(`${targetLabel} 已清理,删除 ${deleted} 条记录`);
      } else {
        toast.success('已清理');
      }
      await load();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(null); }
  }

  return (
    <div>
      <div className={styles.pageHead}>
        <h1 className={styles.pageTitle}>数据清理</h1>
        <button className="btn btn-outline btn-sm" onClick={load}>刷新</button>
      </div>
      <div className={styles.pageBody}>
        <div style={{ marginBottom: 16 }}>
          <Alert type="warning">
            设置 <strong>保留天数为 0</strong> 会 <strong>立即清空</strong> 对应表的全部数据;
            大于 0 则保留最近 N 天以内的记录,更早的删除。
            勾选&ldquo;保存为默认策略&rdquo;会将该天数写入 settings 表,作为未来的默认值。
          </Alert>
        </div>

        {loading ? (
          <div style={{ display:'flex', justifyContent:'center', padding:40 }}>
            <span className="spinner spinner-dark" style={{ width:24, height:24 }} />
          </div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
            {TARGETS.map(t => {
              const count = state.counts?.[t.key] ?? 0;
              const policy = t.key === 'login_history'
                ? state.policies?.LOGIN_HISTORY_RETENTION_DAYS
                : t.key === 'activity_log'
                ? state.policies?.ACTIVITY_LOG_RETENTION_DAYS
                : null;
              return (
                <div key={t.key} className={styles.pageCard} style={{ padding:'18px 22px' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', gap:16, flexWrap:'wrap' }}>
                    <div style={{ minWidth:0, flex:1 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', marginBottom:6 }}>
                        <h3 style={{ fontFamily:'var(--font-serif)', fontSize:'1rem', color:'var(--ink)', fontWeight:600 }}>
                          {t.label}
                        </h3>
                        <Badge type="gray">{count.toLocaleString()} 行</Badge>
                        {t.hasPolicy && policy !== undefined && (
                          <Badge type="amber">当前策略:保留 {policy} 天</Badge>
                        )}
                      </div>
                      <div style={{ fontSize:'0.82rem', color:'var(--ink-3)', lineHeight:1.55 }}>
                        {t.description}
                      </div>
                    </div>

                    <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
                      <label style={{ fontSize:'0.82rem', color:'var(--ink-2)', display:'flex', alignItems:'center', gap:8 }}>
                        保留
                        <input
                          type="number"
                          min="0"
                          max="3650"
                          value={daysByTarget[t.key] ?? 30}
                          onChange={e => setDaysByTarget(d => ({ ...d, [t.key]: e.target.value }))}
                          className="form-input"
                          style={{ width: 84, textAlign: 'center' }}
                          disabled={busy === t.key}
                        />
                        天
                      </label>
                      {t.hasPolicy && (
                        <label style={{ fontSize:'0.78rem', color:'var(--ink-3)', display:'flex', alignItems:'center', gap:6 }}>
                          <input
                            type="checkbox"
                            checked={!!saveAsDefault[t.key]}
                            onChange={e => setSaveAsDefault(d => ({ ...d, [t.key]: e.target.checked }))}
                          />
                          保存为默认策略
                        </label>
                      )}
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => runPrune(t.key)}
                        disabled={busy === t.key}
                      >
                        {busy === t.key ? <Spinner /> :
                         parseInt(daysByTarget[t.key], 10) === 0 ? '清空全部' : '执行清理'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
