'use client';
import { useEffect, useState, useCallback } from 'react';
import { Badge, Pagination, useToast } from '@/components/ui/index.js';
import DateFilter from '@/components/ui/DateFilter.js';
import { fmtDateTime } from '@/lib/time.js';
import styles from '../admin.module.css';

const ACTION_LABELS = {
  'user.login':              { label: '登录',         type: 'green' },
  'user.logout':             { label: '退出',         type: 'gray'  },
  'user.register':           { label: '注册',         type: 'blue'  },
  'user.change_password':    { label: '改密码',       type: 'amber' },
  'user.reset_password':     { label: '重置密码',     type: 'amber' },
  'update_profile':          { label: '改资料',       type: 'blue'  },
  'oauth.allow':             { label: 'OAuth 授权',   type: 'blue'  },
  'oauth.deny':              { label: 'OAuth 拒绝',   type: 'gray'  },
  'oauth.revoke':            { label: 'OAuth 撤销',   type: 'amber' },
  'admin.user_ban':          { label: '封禁用户',     type: 'red'   },
  'admin.user_unban':        { label: '解封用户',     type: 'green' },
  'admin.reset_password':    { label: '重置密码',     type: 'amber' },
  'admin.user_update':       { label: '编辑用户',     type: 'blue'  },
  'admin.user_delete':       { label: '删除用户',     type: 'red'   },
  'admin.card_create':       { label: '创建卡片',     type: 'green' },
  'admin.card_update':       { label: '编辑卡片',     type: 'blue'  },
  'admin.card_delete':       { label: '删除卡片',     type: 'red'   },
  'admin.settings_update':   { label: '修改配置',     type: 'amber' },
  'admin.settings_reveal':   { label: '查看敏感配置', type: 'amber' },
  'admin.retention_prune':   { label: '数据清理',     type: 'red'   },
  'admin.favicon_refresh':       { label: '刷新图标',     type: 'blue' },
  'admin.favicon_refresh_all':   { label: '全量刷新图标', type: 'blue' },
  'admin.favicon_refresh_batch': { label: '批量刷新图标', type: 'blue' },
  'admin.favicon_clear':         { label: '清除图标',     type: 'gray' },
};

export default function AdminActivityLog() {
  const toast = useToast();
  const [data, setData] = useState({ items: [], total: 0, totalPages: 1, availableDates: [] });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState({ mode: 'all', from: null, to: null });
  const [actionFilter, setActionFilter] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page, pageSize: 30, includeDates: '1' });
      if (search.trim()) p.set('search', search.trim());
      if (actionFilter) p.set('action', actionFilter);
      if (dateFilter.mode === 'day' && dateFilter.from) {
        p.set('from', dateFilter.from);
        p.set('to', dateFilter.from);
      } else if (dateFilter.mode === 'since' && dateFilter.from) {
        p.set('from', dateFilter.from);
      } else if (dateFilter.mode === 'range' && dateFilter.from && dateFilter.to) {
        p.set('from', dateFilter.from);
        p.set('to', dateFilter.to);
      }
      const res = await fetch(`/api/admin/activity-log?${p}`);
      if (!res.ok) throw new Error('加载失败');
      setData(await res.json());
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  }, [page, search, dateFilter, actionFilter, toast]);

  useEffect(() => { load(); }, [load]);

  function handleSearch(e) { e.preventDefault(); setPage(1); }

  return (
    <div className={styles.stickyPage}>
      <div className={styles.stickyTop}>
        <div className={styles.stickyHead}>
          <h1 className={styles.pageTitle}>行为日志</h1>
          <div className={styles.stickyActions}>
            {/* 日期筛选 —— 放最左,弹窗向左展开保证不遮挡 */}
            <DateFilter
              value={dateFilter}
              availableDates={data.availableDates}
              onChange={v => { setDateFilter(v); setPage(1); }}
            />
            <select
              className={styles.filterSelect}
              value={actionFilter}
              onChange={e => { setActionFilter(e.target.value); setPage(1); }}
            >
              <option value="">全部操作</option>
              {Object.entries(ACTION_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
            <form onSubmit={handleSearch} style={{ display:'flex', gap:8, alignItems:'center' }}>
              <input
                className={styles.searchInput}
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="搜索用户 / 邮箱 / 详情 / IP..."
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
              <div style={{ textAlign:'center', padding:'40px', color:'var(--ink-3)' }}>暂无行为记录</div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>时间</th><th>用户</th><th>操作</th><th>详情</th><th>IP</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map(r => {
                    const meta = ACTION_LABELS[r.action] || { label: r.action, type: 'gray' };
                    return (
                      <tr key={r.id}>
                        <td style={{ fontFamily:'var(--font-mono)', fontSize:'0.78rem', whiteSpace:'nowrap' }}>
                          {fmtDateTime(r.timestamp)}
                        </td>
                        <td>
                          <div style={{ fontSize:'0.875rem' }}>{r.email || r.username || '-'}</div>
                        </td>
                        <td><Badge type={meta.type}>{meta.label}</Badge></td>
                        <td style={{ fontSize:'0.85rem', color:'var(--ink-2)', maxWidth:300 }}>{r.detail}</td>
                        <td style={{ fontFamily:'var(--font-mono)', fontSize:'0.78rem', color:'var(--ink-3)' }}>{r.ip || '-'}</td>
                      </tr>
                    );
                  })}
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
