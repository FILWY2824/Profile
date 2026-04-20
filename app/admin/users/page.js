'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Badge, Pagination, EmptyState, useToast } from '@/components/ui/index.js';
import { fmtDateTime } from '@/lib/time.js';
import styles from '../admin.module.css';

function statusBadge(s) {
  if (s === 'active')    return <Badge type="green">正常</Badge>;
  if (s === 'banned')    return <Badge type="red">封禁</Badge>;
  if (s === 'suspended') return <Badge type="amber">停用</Badge>;
  return <Badge type="gray">{s}</Badge>;
}
function roleBadge(r) {
  if (r === 'admin')  return <Badge type="blue">管理员</Badge>;
  if (r === 'member') return <Badge type="violet">会员</Badge>;
  return <Badge type="gray">用户</Badge>;
}

export default function AdminUsers() {
  const toast = useToast();
  const [data, setData] = useState({ items: [], total: 0, totalPages: 1 });
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page, pageSize: 20 });
      if (search) p.set('search', search);
      if (role) p.set('role', role);
      if (status) p.set('status', status);
      const res = await fetch(`/api/admin/users?${p}`);
      if (!res.ok) throw new Error('加载用户失败');
      const d = await res.json();
      setData(d);
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  }, [page, search, role, status, toast]);

  useEffect(() => { load(); }, [load]);

  function handleSearch(e) { e.preventDefault(); setPage(1); load(); }

  return (
    <div className={styles.stickyPage}>
      <div className={styles.stickyTop}>
        <div className={styles.stickyHead}>
          <h1 className={styles.pageTitle}>用户管理</h1>
          <form onSubmit={handleSearch} className={styles.stickyActions}>
            <input className={styles.searchInput} value={search}
                   onChange={e => setSearch(e.target.value)}
                   placeholder="搜索邮箱或用户名..." />
            <select className={styles.filterSelect} value={role}
                    onChange={e => { setRole(e.target.value); setPage(1); }}>
              <option value="">全部角色</option>
              <option value="admin">管理员</option>
              <option value="member">会员用户</option>
              <option value="user">普通用户</option>
            </select>
            <select className={styles.filterSelect} value={status}
                    onChange={e => { setStatus(e.target.value); setPage(1); }}>
              <option value="">全部状态</option>
              <option value="active">正常</option>
              <option value="suspended">停用</option>
              <option value="banned">封禁</option>
            </select>
            <button className="btn btn-outline btn-sm" type="submit">搜索</button>
          </form>
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
              <EmptyState icon="◉" title="暂无用户" desc="没有找到符合条件的用户" />
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>用户名 / 邮箱</th>
                    <th>角色</th>
                    <th>状态</th>
                    <th>邮箱</th>
                    <th>最近登录</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map(u => (
                    <tr key={u.id}>
                      <td>
                        <div style={{ fontWeight:500, fontSize:'0.9rem' }}>{u.name}</div>
                        <div style={{ fontSize:'0.8rem', color:'var(--ink-3)' }}>{u.email}</div>
                      </td>
                      <td>{roleBadge(u.role)}</td>
                      <td>{statusBadge(u.status)}</td>
                      <td>{u.emailVerified ? <Badge type="green">已验证</Badge> : <Badge type="amber">未验证</Badge>}</td>
                      <td style={{ fontFamily:'var(--font-mono)', fontSize:'0.76rem', color:'var(--ink-3)', whiteSpace:'nowrap' }}>
                        {u.lastLoginAt
                          ? <>{fmtDateTime(u.lastLoginAt)}<br/><span style={{ fontSize:'0.72rem' }}>{u.lastLoginIp}</span></>
                          : '-'}
                      </td>
                      <td><Link href={`/admin/users/${u.id}`} className="btn btn-outline btn-sm">详情</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className={styles.tableFooter}>
            <span className={styles.tableCount}>共 {data.total} 名用户</span>
            <Pagination page={page} totalPages={data.totalPages} onChange={setPage} />
          </div>
        </div>
      </div>
    </div>
  );
}
