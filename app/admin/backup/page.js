'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Alert, Badge, Spinner, useToast, useConfirm } from '@/components/ui/index.js';
import { fmtDateTime } from '@/lib/time.js';
import styles from '../admin.module.css';

/**
 * 数据库备份管理页
 *
 * 三个区:
 *   1) 状态卡 —— 展示当前配置概要(主机/目录/认证方式),以及"未启用 / 已启用·
 *      空闲 / 正在备份"三态;提供 [立即备份] [停止备份] [测试连通性] 按钮
 *   2) 配置提示 —— 如果关键字段没填齐,卡片顶部用 Alert 提示,并附跳转链接到
 *      /admin/settings 的数据库备份分类
 *   3) 历史记录 —— 下表列出最近的备份任务及其状态、上传字节数、远端路径、
 *      失败原因等
 *
 * 设计:整个页面不写任何敏感值(密码/私钥);敏感值的录入与修改统一走
 * /admin/settings。这个页面只管"开关 + 跑一次 + 看历史"。
 */

function StatusBadge({ status }) {
  if (status === 'running')   return <Badge type="amber">进行中</Badge>;
  if (status === 'success')   return <Badge type="gray">成功</Badge>;
  if (status === 'failed')    return <Badge type="amber">失败</Badge>;
  if (status === 'cancelled') return <Badge type="gray">已取消</Badge>;
  return <Badge type="gray">{status}</Badge>;
}

function formatBytes(n) {
  if (!n || n <= 0) return '—';
  if (n < 1024)           return `${n} B`;
  if (n < 1024 * 1024)    return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3)      return `${(n / 1024 / 1024).toFixed(2)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function authMethodLabel(m) {
  if (m === 'key')      return '密钥';
  if (m === 'password') return '密码';
  return m || '—';
}

export default function AdminBackup() {
  const toast = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false); // 本次点击是否处于 pending
  const [testing, setTesting] = useState(false);

  // polling 用 —— 有活跃任务时 1.5s 一次,否则 10s 一次
  const pollRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/backup', { cache: 'no-store' });
      if (!res.ok) throw new Error('加载备份信息失败');
      const json = await res.json();
      setData(json);
      return json;
    } catch (e) {
      toast.error(e.message);
      return null;
    }
  }, [toast]);

  useEffect(() => {
    let alive = true;
    (async () => {
      await load();
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [load]);

  // 动态 polling —— 频率根据是否有 running 调整
  useEffect(() => {
    if (!data) return;
    if (pollRef.current) clearTimeout(pollRef.current);
    const hasRunning = !!data.current;
    pollRef.current = setTimeout(async () => {
      await load();
    }, hasRunning ? 1500 : 10_000);
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, [data, load]);

  async function handleRun() {
    if (running) return;
    if (!data?.enabled) {
      toast.warning('请先在平台配置中将 BACKUP_ENABLED 置为 1');
      return;
    }
    if (!data.configValid) {
      toast.error('配置不完整,请先去平台配置完成必填字段');
      return;
    }
    const ok = await confirm({
      title: '立即备份',
      message: `将向 ${data.config.host}:${data.config.port} 的 ${data.config.remoteDir} 上传当前数据库的快照。确认发起?`,
      confirmText: '开始备份',
      tone: 'warning',
    });
    if (!ok) return;

    setRunning(true);
    try {
      const res = await fetch('/api/admin/backup/run', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || '启动失败');
      toast.success('备份已发起,进度见下方');
      await load();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setRunning(false);
    }
  }

  async function handleCancel() {
    const ok = await confirm({
      title: '停止当前备份',
      message: '取消后本次备份的远端文件(若已部分写入)可能残留,需自行清理。继续?',
      confirmText: '停止备份',
      tone: 'warning',
      confirmClass: 'btn-amber',
    });
    if (!ok) return;
    try {
      const res = await fetch('/api/admin/backup/cancel', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || '取消失败');
      toast.success('已请求取消,状态将在 1-2 秒后刷新');
      await load();
    } catch (e) {
      toast.error(e.message);
    }
  }

  async function handleTest() {
    if (testing) return;
    setTesting(true);
    try {
      const res = await fetch('/api/admin/backup/test-connection', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || '测试失败');
      toast.success('连通性测试通过');
    } catch (e) {
      toast.error(`测试失败:${e.message}`);
    } finally {
      setTesting(false);
    }
  }

  if (loading || !data) {
    return (
      <div>
        <div className={styles.pageHead}>
          <h1 className={styles.pageTitle}>数据库备份</h1>
        </div>
        <div style={{ display:'flex', justifyContent:'center', padding:40 }}>
          <span className="spinner spinner-dark" style={{ width:24, height:24 }} />
        </div>
      </div>
    );
  }

  const cur = data.current;
  const cfgMissing = !data.configValid;
  const featureOff = !data.enabled;

  return (
    <div>
      <div className={styles.pageHead}>
        <h1 className={styles.pageTitle}>数据库备份</h1>
        <span style={{ fontSize:'0.82rem', color:'var(--ink-3)' }}>
          手动将 data/app.db 快照上传到远端 SFTP
        </span>
      </div>

      <div className={styles.pageBody}>
        {/* 配置提示 */}
        {(featureOff || cfgMissing) && (
          <div style={{ marginBottom: 16 }}>
            <Alert type={featureOff ? 'info' : 'warning'}>
              {featureOff ? (
                <>
                  备份功能当前为&ldquo;<strong>不启用</strong>&rdquo;状态。需要使用时,请到{' '}
                  <Link href="/admin/settings" style={{ color:'var(--amber)', textDecoration:'underline' }}>平台配置</Link>
                  {' '}的&ldquo;数据库备份&rdquo;分类填写服务器信息并将 BACKUP_ENABLED 改为 1。
                </>
              ) : (
                <>
                  配置不完整:{data.configErrors.filter(e => e !== '备份功能未启用').join('、')}。
                  请到{' '}
                  <Link href="/admin/settings" style={{ color:'var(--amber)', textDecoration:'underline' }}>平台配置</Link>
                  {' '}补齐。
                </>
              )}
            </Alert>
          </div>
        )}

        {/* 状态与操作卡 */}
        <div className={styles.pageCard} style={{ padding:'20px 24px', marginBottom: 16 }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr auto', gap: 20, alignItems:'flex-start' }}>
            <div>
              <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
                <h3 style={{ fontFamily:'var(--font-serif)', fontSize:'1.05rem', color:'var(--ink)', fontWeight:600, margin:0 }}>
                  当前状态
                </h3>
                {featureOff
                  ? <Badge type="gray">不启用</Badge>
                  : cur
                    ? <Badge type="amber">正在备份</Badge>
                    : <Badge type="gray">空闲</Badge>
                }
              </div>
              <dl style={{ margin:0, display:'grid', gridTemplateColumns:'110px 1fr', rowGap:6, columnGap:12, fontSize:'0.85rem' }}>
                <dt style={{ color:'var(--ink-3)' }}>服务器</dt>
                <dd style={{ margin:0, color:'var(--ink)', fontFamily:'var(--font-mono)' }}>
                  {data.config.host ? `${data.config.host}:${data.config.port}` : <span style={{ color:'var(--ink-3)' }}>未配置</span>}
                </dd>
                <dt style={{ color:'var(--ink-3)' }}>用户</dt>
                <dd style={{ margin:0, color:'var(--ink)', fontFamily:'var(--font-mono)' }}>
                  {data.config.username || <span style={{ color:'var(--ink-3)' }}>未配置</span>}
                </dd>
                <dt style={{ color:'var(--ink-3)' }}>认证方式</dt>
                <dd style={{ margin:0, color:'var(--ink)' }}>
                  {authMethodLabel(data.config.authMethod)}
                  {data.config.authMethod === 'password' && !data.config.hasPassword && (
                    <span style={{ marginLeft:8, color:'var(--amber)', fontSize:'0.78rem' }}>(密码未填)</span>
                  )}
                  {data.config.authMethod === 'key' && !data.config.hasPrivateKey && (
                    <span style={{ marginLeft:8, color:'var(--amber)', fontSize:'0.78rem' }}>(私钥未填)</span>
                  )}
                </dd>
                <dt style={{ color:'var(--ink-3)' }}>远端目录</dt>
                <dd style={{ margin:0, color:'var(--ink)', fontFamily:'var(--font-mono)', wordBreak:'break-all' }}>
                  {data.config.remoteDir}
                </dd>
                {cur && (
                  <>
                    <dt style={{ color:'var(--ink-3)' }}>当前任务</dt>
                    <dd style={{ margin:0, color:'var(--ink)', fontFamily:'var(--font-mono)', fontSize:'0.78rem' }}>
                      {cur.id.slice(0, 8)} · 开始于 {fmtDateTime(cur.startedAt)}
                    </dd>
                  </>
                )}
              </dl>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:8, minWidth: 150 }}>
              {cur ? (
                <button className="btn btn-amber btn-sm" onClick={handleCancel}>
                  停止备份
                </button>
              ) : (
                <button className="btn btn-primary btn-sm"
                        onClick={handleRun}
                        disabled={running || featureOff || cfgMissing}>
                  {running ? <Spinner /> : '立即备份'}
                </button>
              )}
              <button className="btn btn-outline btn-sm"
                      onClick={handleTest}
                      disabled={testing || !data.config.host || !data.config.username}>
                {testing ? <Spinner /> : '测试连通性'}
              </button>
              <Link href="/admin/settings" className="btn btn-outline btn-sm" style={{ textAlign:'center' }}>
                编辑配置
              </Link>
            </div>
          </div>
        </div>

        {/* 历史记录 */}
        <div className={styles.pageCard}>
          <div style={{ padding:'14px 20px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <h3 style={{ fontFamily:'var(--font-serif)', fontSize:'0.98rem', color:'var(--ink)', fontWeight:600, margin:0 }}>
              最近的备份记录
            </h3>
            <span style={{ fontSize:'0.78rem', color:'var(--ink-3)' }}>
              {data.recent.length} / 10
            </span>
          </div>
          <div className={styles.tableWrap}>
            {data.recent.length === 0 ? (
              <div style={{ padding:36, textAlign:'center', color:'var(--ink-3)', fontSize:'0.88rem' }}>
                暂无历史记录
              </div>
            ) : (
              <table className="data-table" style={{ fontSize:'0.82rem' }}>
                <thead>
                  <tr>
                    <th>状态</th>
                    <th>开始时间</th>
                    <th>完成时间</th>
                    <th>大小</th>
                    <th>远端路径 / 失败原因</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map(j => (
                    <tr key={j.id}>
                      <td><StatusBadge status={j.status} /></td>
                      <td style={{ fontFamily:'var(--font-mono)', fontSize:'0.76rem' }}>
                        {fmtDateTime(j.startedAt)}
                      </td>
                      <td style={{ fontFamily:'var(--font-mono)', fontSize:'0.76rem' }}>
                        {j.finishedAt ? fmtDateTime(j.finishedAt) : '—'}
                      </td>
                      <td style={{ fontFamily:'var(--font-mono)', fontSize:'0.76rem' }}>
                        {formatBytes(j.bytes)}
                      </td>
                      <td style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.76rem',
                        color: (j.status === 'failed' || j.status === 'cancelled') ? 'var(--amber)' : 'var(--ink-2)',
                        maxWidth: 420,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                          title={j.error || j.remotePath}>
                        {j.error || j.remotePath || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
