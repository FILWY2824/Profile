'use client';
import { useEffect, useState, useCallback } from 'react';
import { Badge, Pagination, useToast } from '@/components/ui/index.js';
import { fmtDateTime } from '@/lib/time.js';
import styles from '../admin.module.css';

// ISO-8601 时间戳(带或不带毫秒,带或不带时区后缀)。库里所有日期列都是
// new Date().toISOString() 写入的,所以实际上永远是带 Z 的完整形式。
// 这里放宽一点,兼容手工塞进去的变体。
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/;

function cellValue(v) {
  if (v === null || v === undefined) return <span style={{ color:'var(--ink-3)', fontStyle:'italic', fontSize:'0.78rem' }}>null</span>;
  if (typeof v === 'object') return <code style={{ fontSize:'0.75rem' }}>{JSON.stringify(v)}</code>;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  const s = String(v);
  // 库里存的是 UTC ISO,展示统一转上海时区;原始值放在 title 里,
  // DBA 做诊断需要看原始字符串时 hover 一下就有。
  if (ISO_DATETIME_RE.test(s)) {
    return <span title={s} style={{ color:'var(--ink-2)' }}>{fmtDateTime(s)}</span>;
  }
  if (s.length > 80) {
    return <span title={s}>{s.slice(0, 80)}…</span>;
  }
  return s;
}

export default function AdminDatabase() {
  const toast = useToast();
  const [overview, setOverview] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [rowPage, setRowPage] = useState(1);
  const [rows, setRows] = useState({ items: [], total: 0, totalPages: 1, columns: [] });
  const [rowsLoading, setRowsLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch('/api/admin/database')
      .then(r => { if (!r.ok) throw new Error('加载失败'); return r.json(); })
      .then(d => { if (alive) setOverview(d.tables || []); })
      .catch(e => toast.error(e.message))
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [toast]);

  const loadRows = useCallback(async (table, page) => {
    setRowsLoading(true);
    try {
      const res = await fetch(`/api/admin/database/${table}?page=${page}&pageSize=20`);
      if (!res.ok) throw new Error('加载行数据失败');
      const data = await res.json();
      const columns = overview.find(t => t.table === table)?.columns || [];
      setRows({ items: data.items, total: data.total, totalPages: data.totalPages, columns });
    } catch (e) { toast.error(e.message); }
    finally { setRowsLoading(false); }
  }, [overview, toast]);

  useEffect(() => {
    if (!selected) return;
    loadRows(selected, rowPage);
  }, [selected, rowPage, loadRows]);

  return (
    <div>
      <div className={styles.pageHead}>
        <h1 className={styles.pageTitle}>数据库</h1>
        <span style={{ fontSize:'0.82rem', color:'var(--ink-3)' }}>SQLite · data/app.db</span>
      </div>
      <div className={styles.pageBody}>
        {loading ? (
          <div style={{ display:'flex', justifyContent:'center', padding:40 }}>
            <span className="spinner spinner-dark" style={{ width:24, height:24 }} />
          </div>
        ) : (
          <div style={{ display:'grid', gridTemplateColumns:'minmax(220px, 260px) 1fr', gap:20, alignItems:'start' }}>
            {/* 左侧:表列表 */}
            <div className={styles.pageCard} style={{ padding:'10px 0' }}>
              <div style={{ padding:'10px 18px', borderBottom:'1px solid var(--border)', fontSize:'0.78rem', color:'var(--ink-3)', textTransform:'uppercase', letterSpacing:'0.08em' }}>
                表 ({overview.length})
              </div>
              <div style={{ display:'flex', flexDirection:'column' }}>
                {overview.map(t => (
                  <button
                    key={t.table}
                    type="button"
                    onClick={() => { setSelected(t.table); setRowPage(1); }}
                    style={{
                      padding: '11px 18px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      background: selected === t.table ? 'var(--mist-2)' : 'transparent',
                      border: 'none',
                      borderLeft: selected === t.table ? '2.5px solid var(--amber)' : '2.5px solid transparent',
                      textAlign: 'left',
                      cursor: 'pointer',
                      fontSize: '0.88rem',
                      color: 'var(--ink-2)',
                      borderBottom: '1px solid var(--border)',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    <span>{t.table}</span>
                    <span style={{ fontSize:'0.72rem', color:'var(--ink-3)', fontFamily:'var(--font-sans)' }}>
                      {t.rowCount.toLocaleString()} 行
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* 右侧:所选表详情 */}
            <div className={styles.pageCard}>
              {!selected ? (
                <div style={{ padding:'60px 24px', textAlign:'center', color:'var(--ink-3)' }}>
                  <div style={{ fontSize:'2rem', opacity:0.4, marginBottom:10 }}>▥</div>
                  <div style={{ fontSize:'0.9rem' }}>选择左侧的表来查看数据</div>
                </div>
              ) : (
                <>
                  <div style={{ padding:'16px 20px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:10 }}>
                    <div>
                      <div style={{ fontFamily:'var(--font-mono)', fontSize:'0.95rem', fontWeight:600, color:'var(--ink)' }}>
                        {selected}
                      </div>
                      <div style={{ fontSize:'0.78rem', color:'var(--ink-3)', marginTop:3 }}>
                        共 {rows.total.toLocaleString()} 行 · {rows.columns.length} 列
                      </div>
                    </div>
                    <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                      {(overview.find(t => t.table === selected)?.columns || []).slice(0, 4).map(c => (
                        <Badge key={c.name} type={c.pk ? 'amber' : 'gray'}>
                          {c.name} {c.pk && '★'}
                        </Badge>
                      ))}
                      {rows.columns.length > 4 && <Badge type="gray">+ {rows.columns.length - 4}</Badge>}
                    </div>
                  </div>
                  <div className={styles.tableWrap}>
                    {rowsLoading ? (
                      <div style={{ padding:40, display:'flex', justifyContent:'center' }}>
                        <span className="spinner spinner-dark" style={{ width:24, height:24 }} />
                      </div>
                    ) : rows.items.length === 0 ? (
                      <div style={{ padding:40, textAlign:'center', color:'var(--ink-3)' }}>表为空</div>
                    ) : (
                      <table className="data-table" style={{ fontSize:'0.8rem' }}>
                        <thead>
                          <tr>
                            {rows.columns.map(c => (
                              <th key={c.name} style={{ fontFamily:'var(--font-mono)' }}>
                                {c.name}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {rows.items.map((row, i) => (
                            <tr key={i}>
                              {rows.columns.map(c => (
                                <td key={c.name} style={{ fontFamily:'var(--font-mono)', fontSize:'0.78rem', maxWidth: 260, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                                  {cellValue(row[c.name])}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                  <div className={styles.tableFooter}>
                    <span className={styles.tableCount}>共 {rows.total.toLocaleString()} 行,每页 20</span>
                    <Pagination page={rowPage} totalPages={rows.totalPages} onChange={setRowPage} />
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
