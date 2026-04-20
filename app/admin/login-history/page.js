'use client';
import { useEffect, useState, useCallback } from 'react';
import { Badge, Pagination, useToast } from '@/components/ui/index.js';
import DateFilter from '@/components/ui/DateFilter.js';
import { fmtDateTime } from '@/lib/time.js';
import styles from '../admin.module.css';

export default function AdminLoginHistory() {
  const toast = useToast();
  const [data, setData] = useState({ items: [], total: 0, totalPages: 1, availableDates: [] });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState({ mode: 'all', from: null, to: null });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page, pageSize: 30, includeDates: '1' });
      if (search.trim()) p.set('search', search.trim());
      if (dateFilter.mode === 'day' && dateFilter.from) {
        p.set('from', dateFilter.from);
        p.set('to', dateFilter.from);
      } else if (dateFilter.mode === 'since' && dateFilter.from) {
        p.set('from', dateFilter.from);
      } else if (dateFilter.mode === 'range' && dateFilter.from && dateFilter.to) {
        p.set('from', dateFilter.from);
        p.set('to', dateFilter.to);
      }
      const res = await fetch(`/api/admin/login-history?${p}`);
      if (!res.ok) throw new Error('加载失败');
      setData(await res.json());
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  }, [page, search, dateFilter, toast]);

  useEffect(() => { load(); }, [load]);

  // 搜索 / 日期变化都要重置到第一页 —— 但 useCallback 里已经包含了这些依赖,
  // 这里只在 search 显式提交时重置 page;dateFilter 改变时 setPage(1) 由 onChange 处理
  function handleSearch(e) { e.preventDefault(); setPage(1); }

  return (
    <div className={styles.stickyPage}>
      <div className={styles.stickyTop}>
        <div className={styles.stickyHead}>
          <h1 className={styles.pageTitle}>登录记录</h1>
          <div className={styles.stickyActions}>
            {/* 日期筛选放在操作区最左侧,弹窗向左展开就不会溢出视口 */}
            <DateFilter
              value={dateFilter}
              availableDates={data.availableDates}
              onChange={v => { setDateFilter(v); setPage(1); }}
            />
            <form onSubmit={handleSearch} style={{ display:'flex', gap:8, alignItems:'center' }}>
              <input
                className={styles.searchInput}
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="搜索邮箱 / IP / UA / 备注..."
              />
              <button className="btn btn-outline btn-sm" type="submit">搜索</button>
              {search && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => { setSearch(''); setPage(1); }}
                >清除</button>
              )}
            </form>
            <button className="btn btn-outline btn-sm" onClick={load} disabled={loading}>刷新</button>
          </div>
        </div>
      </div>

      <div className={styles.scrollArea}>
        <div className={styles.pageCard}>
          <div className={styles.tableWrap}>
            {loading ? (
              <div style={{ display:'flex', justifyContent:'center', padding:'40px' }}>
                <span className="spinner spinner-dark" style={{ width:24, height:24 }} />
              </div>
            ) : data.items.length === 0 ? (
              <div style={{ textAlign:'center', padding:'40px', color:'var(--ink-3)' }}>暂无登录记录</div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>时间</th><th>邮箱</th><th>状态</th>
                    <th>IP 地址</th><th>User Agent</th><th>备注</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map(r => (
                    <tr key={r.id}>
                      <td style={{ fontFamily:'var(--font-mono)', fontSize:'0.78rem', whiteSpace:'nowrap' }}>
                        {fmtDateTime(r.timestamp)}
                      </td>
                      <td style={{ fontSize:'0.875rem' }}>{r.email}</td>
                      <td>{r.success ? <Badge type="green">成功</Badge> : <Badge type="red">失败</Badge>}</td>
                      <td style={{ fontFamily:'var(--font-mono)', fontSize:'0.78rem' }}>{r.ip}</td>
                      <td style={{ fontSize:'0.75rem', color:'var(--ink-3)', maxWidth:200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {r.userAgent !== 'unknown' ? r.userAgent : '-'}
                      </td>
                      <td style={{ fontSize:'0.82rem', color: r.reason ? 'var(--ruby)' : 'var(--ink-3)' }}>
                        {r.reason || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className={styles.tableFooter}>
            <span className={styles.tableCount}>共 {data.total} 条记录</span>
            <Pagination page={page} totalPages={data.totalPages} onChange={setPage} />
          </div>
        </div>
      </div>
    </div>
  );
}
