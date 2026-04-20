'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge, useToast } from '@/components/ui/index.js';
import { fmtDateTime } from '@/lib/time.js';
import styles from './admin.module.css';

export default function AdminDashboard() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [retention, setRetention] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch('/api/admin/dashboard').then(r => r.ok ? r.json() : Promise.reject(new Error('仪表盘数据加载失败'))),
      fetch('/api/admin/retention').then(r => r.ok ? r.json() : null).catch(() => null),
    ])
      .then(([d, r]) => { if (!alive) return; setData(d); setRetention(r); })
      .catch(err => { if (alive) toast.error(err?.message || '加载失败'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [toast]);

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:'80px' }}>
      <span className="spinner spinner-dark" style={{ width:28, height:28, borderWidth:3 }} />
    </div>
  );

  const s = data?.stats || {};
  return (
    <div>
      <div className={styles.pageHead}>
        <h1 className={styles.pageTitle}>仪表盘</h1>
        <span style={{ fontSize:'0.8rem', color:'var(--ink-3)' }}>
          {new Date().toLocaleDateString('zh-CN', {
            timeZone: 'Asia/Shanghai',
            year:'numeric', month:'long', day:'numeric', weekday:'long',
          })}
        </span>
      </div>
      <div className={styles.pageBody}>
        <div className={styles.statsGrid}>
          {[
            { label:'总用户数', value: s.totalUsers,     sub: `${s.adminUsers || 0} 管理员 · ${s.memberUsers || 0} 会员` },
            { label:'活跃用户', value: s.activeUsers,    sub:'正常状态' },
            { label:'封禁/停用', value: s.bannedUsers,    sub:'受限账号' },
            { label:'板块数',   value: s.totalSections,  sub:'已配置板块' },
            { label:'卡片数',   value: s.totalCards,     sub: `${s.ungroupedCards || 0} 未分组` },
          ].map((stat, i) => (
            <div key={i} className={styles.statCard}>
              <div className={styles.statLabel}>{stat.label}</div>
              <div className={styles.statValue}>{stat.value ?? '-'}</div>
              <div className={styles.statSub}>{stat.sub}</div>
            </div>
          ))}
        </div>

        {/* 保留策略速览 + 捷径 */}
        {retention && (
          <div className={styles.pageCard} style={{ padding:'18px 22px', marginBottom:22 }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:12 }}>
              <div>
                <div style={{ fontFamily:'var(--font-serif)', fontSize:'1.02rem', fontWeight:600, color:'var(--ink)', marginBottom:6 }}>
                  数据保留概览
                </div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:10, fontSize:'0.82rem', color:'var(--ink-2)' }}>
                  <Badge type="gray">登录记录 {retention.counts?.login_history?.toLocaleString?.() ?? '-'} 行</Badge>
                  <Badge type="gray">行为日志 {retention.counts?.activity_log?.toLocaleString?.() ?? '-'} 行</Badge>
                  <Badge type="amber">保留策略 {retention.policies?.LOGIN_HISTORY_RETENTION_DAYS ?? 30}/{retention.policies?.ACTIVITY_LOG_RETENTION_DAYS ?? 30} 天</Badge>
                </div>
              </div>
              <Link href="/admin/retention" className="btn btn-outline btn-sm">前往数据清理 →</Link>
            </div>
          </div>
        )}

        <div className={styles.pageCard}>
          <div style={{ padding:'16px 20px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <span style={{ fontWeight:500, fontSize:'0.925rem' }}>最近登录记录</span>
            <Link href="/admin/login-history" style={{ fontSize:'0.78rem', color:'var(--amber)' }}>查看全部 →</Link>
          </div>
          <div className={styles.tableWrap}>
            <table className="data-table">
              <thead><tr><th>邮箱</th><th>时间</th><th>状态</th><th>IP</th><th>原因</th></tr></thead>
              <tbody>
                {(data?.recentLogins || []).length === 0 ? (
                  <tr><td colSpan={5} style={{ textAlign:'center', color:'var(--ink-3)', padding:'28px' }}>暂无记录</td></tr>
                ) : (data?.recentLogins || []).map(r => (
                  <tr key={r.id}>
                    <td style={{ fontSize:'0.875rem' }}>{r.email}</td>
                    <td style={{ fontFamily:'var(--font-mono)', fontSize:'0.8rem', whiteSpace:'nowrap' }}>
                      {fmtDateTime(r.timestamp)}
                    </td>
                    <td>{r.success ? <Badge type="green">成功</Badge> : <Badge type="red">失败</Badge>}</td>
                    <td style={{ fontFamily:'var(--font-mono)', fontSize:'0.8rem' }}>{r.ip}</td>
                    <td style={{ color:'var(--ink-3)', fontSize:'0.85rem' }}>{r.reason || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
