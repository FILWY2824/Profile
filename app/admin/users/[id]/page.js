'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Badge, Spinner, Modal, useToast, useConfirm } from '@/components/ui/index.js';
import PasswordInput from '@/components/ui/PasswordInput.js';
import { fmtDate, fmtDateTime } from '@/lib/time.js';
import styles from '../../admin.module.css';

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

export default function AdminUserDetail() {
  const { id } = useParams();
  const toast = useToast();
  const confirm = useConfirm();

  const [user, setUser] = useState(null);
  const [logins, setLogins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetPassModal, setResetPassModal] = useState(false);
  const [newPass, setNewPass] = useState('');
  const [editForm, setEditForm] = useState({ name:'', role:'user', status:'active', bio:'' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${id}`);
      if (!res.ok) throw new Error('加载用户失败');
      const d = await res.json();
      setUser(d.user);
      setLogins(d.recentLogins || []);
      setEditForm({ name: d.user.name, role: d.user.role, status: d.user.status, bio: d.user.bio || '' });
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  }, [id, toast]);

  useEffect(() => { load(); }, [load]);

  async function doAction(body, successMsg) {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || '操作失败'); return false; }
      if (data.user) setUser(data.user);
      toast.success(successMsg);
      return true;
    } catch { toast.error('网络错误'); return false; }
    finally { setSaving(false); }
  }

  async function handleBan() {
    const ok = await confirm({
      title: '封禁用户',
      message: `确定要封禁 ${user.name} 吗?封禁后该用户将无法登录。`,
      confirmText: '确认封禁',
      tone: 'danger',
    });
    if (ok) await doAction({ action:'ban', banType:'permanent' }, '用户已封禁');
  }
  async function handleUnban() {
    const ok = await confirm({
      title: '解除封禁',
      message: `确定要解封 ${user.name} 吗?`,
      confirmText: '确认解封',
      confirmClass: 'btn-primary',
      tone: 'primary',
    });
    if (ok) await doAction({ action:'unban' }, '用户已解封');
  }

  async function handleSaveProfile(e) {
    e.preventDefault();
    await doAction(editForm, '用户资料已更新');
  }
  async function handleResetPassword(e) {
    e.preventDefault();
    const ok = await doAction({ action:'resetPassword', newPassword: newPass }, '密码已重置');
    if (ok) { setResetPassModal(false); setNewPass(''); }
  }

  if (loading) return (
    <div style={{ display:'flex', justifyContent:'center', padding:'80px' }}>
      <span className="spinner spinner-dark" style={{ width:28, height:28 }} />
    </div>
  );
  if (!user) return <div style={{ padding:32 }}>用户不存在</div>;

  return (
    <div>
      <div className={styles.pageHead}>
        <div>
          <Link href="/admin/users" style={{ fontSize:'0.825rem', color:'var(--ink-3)' }}>← 用户列表</Link>
          <h1 className={styles.pageTitle} style={{ marginTop:4 }}>{user.name}</h1>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          {user.status === 'active'
            ? <button className="btn btn-outline btn-sm" onClick={handleBan}>封禁</button>
            : <button className="btn btn-outline btn-sm" onClick={handleUnban}>解封</button>}
          <button className="btn btn-outline btn-sm" onClick={() => setResetPassModal(true)}>重置密码</button>
        </div>
      </div>

      <div className={styles.pageBody} style={{ display:'grid', gridTemplateColumns:'1fr 300px', gap:20, alignItems:'start' }}>
        <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
          <div className={styles.pageCard} style={{ padding:24 }}>
            <h3 style={{ fontFamily:'var(--font-serif)', marginBottom:16, fontWeight:600 }}>编辑资料</h3>
            <form onSubmit={handleSaveProfile} style={{ display:'flex', flexDirection:'column', gap:14 }}>
              <div className="form-group">
                <label className="form-label">用户名</label>
                <input className="form-input" value={editForm.name}
                       onChange={e => setEditForm(f => ({...f, name: e.target.value}))} required />
              </div>
              <div className="form-group">
                <label className="form-label">角色</label>
                <select className="form-input" value={editForm.role}
                        onChange={e => setEditForm(f => ({...f, role: e.target.value}))}>
                  <option value="user">普通用户</option>
                  <option value="member">会员用户</option>
                  <option value="admin">管理员</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">状态</label>
                <select className="form-input" value={editForm.status}
                        onChange={e => setEditForm(f => ({...f, status: e.target.value}))}>
                  <option value="active">正常</option>
                  <option value="suspended">停用</option>
                  <option value="banned">封禁</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">简介</label>
                <textarea className="form-input" value={editForm.bio}
                          onChange={e => setEditForm(f => ({...f, bio: e.target.value}))}
                          rows={2} style={{ resize:'vertical' }} />
              </div>
              <div>
                <button className="btn btn-primary btn-sm" type="submit" disabled={saving}>
                  {saving ? <Spinner /> : '保存'}
                </button>
              </div>
            </form>
          </div>

          <div className={styles.pageCard}>
            <div style={{ padding:'14px 20px', borderBottom:'1px solid var(--border)', fontWeight:500 }}>最近登录(10条)</div>
            <div style={{ overflowX:'auto' }}>
              <table className="data-table">
                <thead><tr><th>时间</th><th>状态</th><th>IP</th><th>原因</th></tr></thead>
                <tbody>
                  {logins.length === 0 ? (
                    <tr><td colSpan={4} style={{ textAlign:'center', color:'var(--ink-3)', padding:'24px' }}>无记录</td></tr>
                  ) : logins.map(r => (
                    <tr key={r.id}>
                      <td style={{ fontFamily:'var(--font-mono)', fontSize:'0.78rem', whiteSpace:'nowrap' }}>
                        {fmtDateTime(r.timestamp)}
                      </td>
                      <td>{r.success ? <Badge type="green">成功</Badge> : <Badge type="red">失败</Badge>}</td>
                      <td style={{ fontFamily:'var(--font-mono)', fontSize:'0.78rem' }}>{r.ip}</td>
                      <td style={{ fontSize:'0.82rem', color:'var(--ink-3)' }}>{r.reason || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className={styles.pageCard} style={{ padding:20 }}>
          <div style={{ fontFamily:'var(--font-serif)', fontSize:'1rem', marginBottom:16, fontWeight:600 }}>账号信息</div>
          {[
            ['ID', <span key="id" style={{ fontFamily:'var(--font-mono)', fontSize:'0.72rem', wordBreak:'break-all' }}>{user.id}</span>],
            ['邮箱', user.email],
            ['角色', roleBadge(user.role)],
            ['状态', statusBadge(user.status)],
            ['邮箱验证', user.emailVerified ? <Badge type="green">已验证</Badge> : <Badge type="amber">未验证</Badge>],
            ['注册时间', fmtDate(user.createdAt)],
            ['最近登录', user.lastLoginAt ? fmtDateTime(user.lastLoginAt) : '-'],
            ['最近 IP', user.lastLoginIp || '-'],
          ].map(([k, v], i) => (
            <div key={i} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 0', borderBottom:'1px solid var(--border)', gap:8 }}>
              <span style={{ fontSize:'0.78rem', color:'var(--ink-3)', flexShrink:0 }}>{k}</span>
              <span style={{ fontSize:'0.82rem', textAlign:'right' }}>{v}</span>
            </div>
          ))}
        </div>
      </div>

      {resetPassModal && (
        <Modal title="重置密码" onClose={() => setResetPassModal(false)} footer={
          <>
            <button type="button" className="btn btn-outline" onClick={() => setResetPassModal(false)}>取消</button>
            <button type="submit" form="reset-pass-form" className="btn btn-primary" disabled={saving}>
              {saving ? <Spinner /> : '重置'}
            </button>
          </>
        }>
          <form id="reset-pass-form" onSubmit={handleResetPassword}>
            <div className="form-group">
              <label className="form-label">新密码</label>
              <PasswordInput value={newPass}
                             onChange={e => setNewPass(e.target.value)}
                             placeholder="至少 8 位,含大小写、数字、特殊字符"
                             required autoFocus autoComplete="new-password" />
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
