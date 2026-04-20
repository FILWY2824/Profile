'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { Spinner, Badge, useToast, useConfirm } from '@/components/ui/index.js';
import styles from '../admin.module.css';

function ageLabel(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400_000);
  const h = Math.floor((diff % 86400_000) / 3600_000);
  if (d >= 1) return `${d} 天${h ? ' ' + h + ' 小时' : ''}前`;
  const m = Math.floor(diff / 60_000);
  if (m >= 60) return `${h} 小时前`;
  if (m >= 1)  return `${m} 分钟前`;
  return '刚刚';
}

function sizeLabel(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export default function AdminFavicons() {
  const toast = useToast();
  const confirm = useConfirm();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [refreshAllBusy, setRefreshAllBusy] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);

  // 多选集合 —— 存 origin
  const [selected, setSelected] = useState(() => new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/favicons');
      if (!res.ok) throw new Error('加载失败');
      const d = await res.json();
      setItems(d.items || []);
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  // 选中 origin 必须同步去掉已消失的条目
  useEffect(() => {
    setSelected(prev => {
      const valid = new Set(items.map(i => i.origin));
      const next = new Set();
      for (const o of prev) if (valid.has(o)) next.add(o);
      return next.size === prev.size ? prev : next;
    });
  }, [items]);

  const allCount = items.length;
  const selectedCount = selected.size;
  const allSelected = allCount > 0 && selectedCount === allCount;
  const partial = selectedCount > 0 && !allSelected;

  // header checkbox 的 indeterminate 状态只能用 ref 赋值
  const headerCheckRef = useRef(null);
  useEffect(() => {
    if (headerCheckRef.current) {
      headerCheckRef.current.indeterminate = partial;
    }
  }, [partial]);

  function toggleOne(origin) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(origin)) next.delete(origin); else next.add(origin);
      return next;
    });
  }
  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(items.map(i => i.origin)));
  }
  function clearSelection() { setSelected(new Set()); }

  async function refreshOne(origin) {
    setBusy(origin);
    try {
      const res = await fetch('/api/admin/favicons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'refresh', origin }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || '刷新失败');
      if (d.result?.ok) toast.success(`已刷新:${origin}`);
      else toast.warning(`抓取失败:${d.result?.error || '未知错误'}`);
      load();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(null); }
  }

  async function clearOne(origin) {
    const ok = await confirm({
      title: '清除缓存',
      message: `确定清除 ${origin} 的图标缓存?下次访问首页时会重新抓取。`,
      confirmText: '确认清除',
      tone: 'warning',
      confirmClass: 'btn-amber',
    });
    if (!ok) return;
    setBusy(origin);
    try {
      const res = await fetch('/api/admin/favicons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clear', origin }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || '清除失败');
      toast.success('缓存已清除');
      load();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(null); }
  }

  async function refreshAll() {
    const ok = await confirm({
      title: '立即刷新全部图标',
      message: `将串行抓取 ${items.filter(i => !i.uncached).length} 个站点的 favicon,预计需要数秒到 1 分钟。期间新的前台请求仍可正常访问旧缓存。`,
      confirmText: '开始刷新',
      tone: 'primary',
      confirmClass: 'btn-primary',
    });
    if (!ok) return;
    setRefreshAllBusy(true);
    try {
      const res = await fetch('/api/admin/favicons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'refresh-all' }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || '刷新失败');
      const okCount = (d.results || []).filter(r => r.ok).length;
      const total = (d.results || []).length;
      toast.success(`刷新完成:${okCount}/${total} 成功`);
      load();
    } catch (e) { toast.error(e.message); }
    finally { setRefreshAllBusy(false); }
  }

  async function refreshSelected() {
    const origins = Array.from(selected);
    if (origins.length === 0) return;
    const ok = await confirm({
      title: `批量刷新 ${origins.length} 个站点`,
      message: `将串行抓取选中的 ${origins.length} 个 favicon,预计需要数秒。期间新的前台请求仍可正常访问旧缓存。`,
      confirmText: '开始刷新',
      tone: 'primary',
      confirmClass: 'btn-primary',
    });
    if (!ok) return;
    setBatchBusy(true);
    try {
      const res = await fetch('/api/admin/favicons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'refresh-batch', origins }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || '批量刷新失败');
      const okCount = (d.results || []).filter(r => r.ok).length;
      const total = (d.results || []).length;
      toast.success(`批量刷新完成:${okCount}/${total} 成功`);
      clearSelection();
      load();
    } catch (e) { toast.error(e.message); }
    finally { setBatchBusy(false); }
  }

  return (
    <div className={styles.stickyPage}>
      <div className={styles.stickyTop}>
        <div className={styles.stickyHead}>
          <h1 className={styles.pageTitle}>站点图标</h1>
          <div className={styles.stickyActions}>
            {selectedCount > 0 && (
              <>
                <div className={styles.batchBar}>
                  已选中 <strong>{selectedCount}</strong> 项
                </div>
                <button
                  className="btn btn-amber btn-sm"
                  onClick={refreshSelected}
                  disabled={batchBusy}
                >{batchBusy ? <Spinner /> : '批量刷新选中'}</button>
                <button className="btn btn-ghost btn-sm" onClick={clearSelection} disabled={batchBusy}>
                  取消选择
                </button>
              </>
            )}
            <button className="btn btn-outline btn-sm" onClick={load} disabled={loading}>
              刷新列表
            </button>
            <button className="btn btn-primary btn-sm" onClick={refreshAll} disabled={refreshAllBusy || loading}>
              {refreshAllBusy ? <Spinner /> : '立即刷新全部'}
            </button>
          </div>
        </div>
      </div>

      <div className={styles.scrollArea}>
        {/* 说明卡片 */}
        <div className={styles.pageCard} style={{ padding: '18px 22px', marginBottom: 18 }}>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: '1.02rem', fontWeight: 600, color: 'var(--ink)', marginBottom: 6 }}>
            手动管理
          </div>
          <div style={{ fontSize: '0.82rem', color: 'var(--ink-3)', lineHeight: 1.6 }}>
            平台不再定时抓取外站图标(避免后台请求堆积与潜在的内存问题)。图标在首页首次
            访问时抓取一次并永久保存,之后只在这里手动触发刷新。你可以逐条
            <strong style={{ color: 'var(--ink-2)' }}> 刷新 </strong>、
            <strong style={{ color: 'var(--ink-2)' }}> 清除 </strong>,
            <strong style={{ color: 'var(--ink-2)' }}> 勾选多项后批量刷新 </strong>,
            或点右上角 <strong style={{ color: 'var(--ink-2)' }}> 立即刷新全部 </strong>。
          </div>
        </div>

        {/* 图标列表 */}
        <div className={styles.pageCard}>
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
              <span className="spinner spinner-dark" style={{ width: 24, height: 24 }} />
            </div>
          ) : items.length === 0 ? (
            <div style={{ padding: 48, textAlign: 'center', color: 'var(--ink-3)' }}>
              <div style={{ fontSize: '2rem', opacity: 0.4, marginBottom: 8 }}>✦</div>
              暂无图标缓存 —— 前台加载一次含外链的首页后,本列表就会填满。
            </div>
          ) : (
            <div className={styles.tableWrap}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: 36 }}>
                      <input
                        ref={headerCheckRef}
                        type="checkbox"
                        className={styles.checkbox}
                        checked={allSelected}
                        onChange={toggleAll}
                        aria-label="全选"
                      />
                    </th>
                    <th style={{ width: 48 }}>图标</th>
                    <th>站点</th>
                    <th>来源</th>
                    <th>大小</th>
                    <th>更新于</th>
                    <th>状态</th>
                    <th style={{ width: 180 }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(it => {
                    const hostname = (() => { try { return new URL(it.origin).host; } catch { return it.origin; } })();
                    const isSelected = selected.has(it.origin);
                    return (
                      <tr
                        key={it.origin}
                        style={isSelected ? { background: 'var(--amber-soft)' } : undefined}
                      >
                        <td>
                          <input
                            type="checkbox"
                            className={styles.checkbox}
                            checked={isSelected}
                            onChange={() => toggleOne(it.origin)}
                            aria-label={`选择 ${hostname}`}
                          />
                        </td>
                        <td>
                          {it.hasIcon ? (
                            <img
                              src={`/api/favicons/image?origin=${encodeURIComponent(it.origin)}`}
                              alt=""
                              style={{ width: 22, height: 22, objectFit: 'contain' }}
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <div style={{
                              width: 22, height: 22, borderRadius: 6,
                              background: 'var(--mist-2)', color: 'var(--ink-3)',
                              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: '0.7rem', fontWeight: 600,
                            }}>
                              {hostname[0]?.toUpperCase() || '?'}
                            </div>
                          )}
                        </td>
                        <td>
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', color: 'var(--ink)' }}>
                            {hostname}
                          </div>
                          {it.inUse && <Badge type="green">使用中</Badge>}
                        </td>
                        <td style={{ fontSize: '0.78rem', color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>
                          {it.source || '—'}
                        </td>
                        <td style={{ fontSize: '0.78rem', color: 'var(--ink-3)' }}>
                          {sizeLabel(it.byteSize)}
                        </td>
                        <td style={{ fontSize: '0.78rem', color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
                          {ageLabel(it.fetchedAt)}
                        </td>
                        <td>
                          {it.uncached ? (
                            <Badge type="gray">未抓取</Badge>
                          ) : it.hasIcon ? (
                            <Badge type="green">正常</Badge>
                          ) : it.failedAttempts > 0 ? (
                            <Badge type="red" title={it.lastError}>失败 × {it.failedAttempts}</Badge>
                          ) : (
                            <Badge type="amber">空</Badge>
                          )}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              className="btn btn-outline btn-sm"
                              onClick={() => refreshOne(it.origin)}
                              disabled={busy === it.origin}
                            >
                              {busy === it.origin ? <Spinner /> : '刷新'}
                            </button>
                            {!it.uncached && (
                              <button
                                className="btn btn-ghost btn-sm"
                                style={{ color: 'var(--ruby)' }}
                                onClick={() => clearOne(it.origin)}
                                disabled={busy === it.origin}
                              >
                                清除
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
