'use client';
import { useState } from 'react';
import { Alert, Badge, Pagination, useToast } from '@/components/ui/index.js';
import { fmtDateTime } from '@/lib/time.js';
import styles from '../admin.module.css';

const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/;

function cellValue(v) {
  if (v === null || v === undefined) return <span style={{ color:'var(--ink-3)', fontStyle:'italic', fontSize:'0.78rem' }}>null</span>;
  if (typeof v === 'object') return <code style={{ fontSize:'0.75rem' }}>{JSON.stringify(v)}</code>;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  const s = String(v);
  if (ISO_DATETIME_RE.test(s)) {
    return <span title={s} style={{ color:'var(--ink-2)' }}>{fmtDateTime(s)}</span>;
  }
  if (s.length > 80) return <span title={s}>{s.slice(0, 80)}…</span>;
  return s;
}

export default function AdminDatabase() {
  const toast = useToast();
  const [overview, setOverview] = useState([]);
  const [loading, setLoading] = useState(false);
  const [overviewLoaded, setOverviewLoaded] = useState(false);
  const [selected, setSelected] = useState(null);
  const [rowPage, setRowPage] = useState(1);
  const [rows, setRows] = useState({ items: [], total: 0, totalPages: 1, columns: [] });
  const [rowsLoading, setRowsLoading] = useState(false);
  const [lastOverviewAt, setLastOverviewAt] = useState(null);
  const [lastRowsAt, setLastRowsAt] = useState(null);

  async function loadOverview() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/database', { cache: 'no-store' });
      if (!res.ok) throw new Error('加载失败');
      const data = await res.json();
      setOverview(data.tables || []);
      setOverviewLoaded(true);
      setLastOverviewAt(new Date().toISOString());
      if (selected && !(data.tables || []).find(t => t.table === selected)) {
        setSelected(null);
        setRows({ items: [], total: 0, totalPages: 1, columns: [] });
      }
    } catch (e) {
      toast.error(e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }

  async function loadRows(table = selected, page = rowPage) {
    if (!table) {
      toast.info('请先选择一张表');
      return;
    }
    setRowsLoading(true);
    try {
      const res = await fetch(`/api/admin/database/${table}?page=${page}&pageSize=20`, { cache: 'no-store' });
      if (!res.ok) throw new Error('加载行数据失败');
      const data = await res.json();
      const columns = overview.find(t => t.table === table)?.columns || [];
      setRows({ items: data.items || [], total: data.total || 0, totalPages: data.totalPages || 1, columns });
      setLastRowsAt(new Date().toISOString());
    } catch (e) {
      toast.error(e.message || '加载行数据失败');
    } finally {
      setRowsLoading(false);
    }
  }

  return (
    <div>
      <div className={styles.pageHead}>
        <h1 className={styles.pageTitle}>数据库</h1>
        <span style={{ fontSize:'0.82rem', color:'var(--ink-3)' }}>SQLite · data/app.db</span>
      </div>
      <div className={styles.pageBody}>
        <div style={{ marginBottom: 16, display:'grid', gap:12 }}>
          <Alert type="warning">
            此页面已改为<strong>纯手动查询</strong>：不会在进入页面、切换表、空闲驻留时自动刷新。
          </Alert>
          <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
            <button className="btn btn-primary btn-sm" onClick={loadOverview} disabled={loading}>
              {loading ? '查询中…' : '查询数据库'}
            </button>
            <button className="btn btn-outline btn-sm" onClick={() => loadRows()} disabled={rowsLoading || !selected}>
              {rowsLoading ? '查询中…' : '查询当前表'}
            </button>
            {lastOverviewAt && (
              <span style={{ fontSize:'0.78rem', color:'var(--ink-3)', alignSelf:'center' }}>
                最近目录查询: {fmtDateTime(lastOverviewAt)}
              </span>
            )}
            {lastRowsAt && (
              <span style={{ fontSize:'0.78rem', color:'var(--ink-3)', alignSelf:'center' }}>
                最近表查询: {fmtDateTime(lastRowsAt)}
              </span>
            )}
          </div>
        </div>

        {!overviewLoaded ? (
          <div className={styles.pageCard} style={{ padding:'48px 28px', textAlign:'center', color:'var(--ink-3)' }}>
            点击上方“查询数据库”后才会向后端读取一次表目录。
          </div>
        ) : (
          <div style={{ display:'grid', gridTemplateColumns:'minmax(220px, 260px) 1fr', gap:20, alignItems:'start' }}>
            <div className={styles.pageCard} style={{ padding:'10px 0' }}>
              <div style={{ padding:'10px 18px', borderBottom:'1px solid var(--border)', fontSize:'0.78rem', color:'var(--ink-3)', textTransform:'uppercase', letterSpacing:'0.08em' }}>
                表 ({overview.length})
              </div>
              <div style={{ display:'flex', flexDirection:'column' }}>
                {overview.map(t => (
                  <button
                    key={t.table}
                    type="button"
                    onClick={() => { setSelected(t.table); setRowPage(1); setRows({ items: [], total: 0, totalPages: 1, columns: t.columns || [] }); setLastRowsAt(null); }}
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

            <div className={styles.pageCard}>
              {!selected ? (
                <div style={{ padding:'60px 24px', textAlign:'center', color:'var(--ink-3)' }}>
                  <div style={{ fontSize:'2rem', opacity:0.4, marginBottom:10 }}>▥</div>
                  <div style={{ fontSize:'0.9rem' }}>选择左侧的表，然后点击“查询当前表”</div>
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
                      <div style={{ padding:40, textAlign:'center', color:'var(--ink-3)' }}>
                        尚未查询到数据。点击“查询当前表”开始读取。
                      </div>
                    ) : (
                      <table className="data-table" style={{ fontSize:'0.8rem' }}>
                        <thead>
                          <tr>
                            {rows.columns.map(c => (
                              <th key={c.name} style={{ fontFamily:'var(--font-mono)' }}>{c.name}</th>
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
                    <Pagination
                      page={rowPage}
                      totalPages={rows.totalPages}
                      onChange={(nextPage) => {
                        setRowPage(nextPage);
                        loadRows(selected, nextPage);
                      }}
                    />
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
