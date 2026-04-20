'use client';
import { useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import TopBar from '@/components/layout/TopBar.js';
import styles from '../auth.module.css';
import { Spinner, useToast } from '@/components/ui/index.js';
import PasswordInput from '@/components/ui/PasswordInput.js';

function ResetForm() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const emailParam = params.get('email') || '';
  const [form, setForm] = useState({ email: emailParam, code: '', newPassword: '', confirm: '' });
  const [loading, setLoading] = useState(false);
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    if (form.newPassword !== form.confirm) { toast.error('两次密码不一致'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.email, code: form.code, newPassword: form.newPassword }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || '重置失败'); return; }
      toast.success('密码已重置,请登录');
      router.push('/auth/login');
    } catch { toast.error('网络错误'); }
    finally { setLoading(false); }
  }

  return (
    <>
      <TopBar />
      <div className={styles.wrap}>
        <div className={styles.box}>
          <h1 className={styles.title}>重置密码</h1>
          <p className={styles.subtitle}>输入验证码和新密码</p>
          <form className={styles.form} onSubmit={handleSubmit}>
            {!emailParam && (
              <div className="form-group">
                <label className="form-label">邮箱</label>
                <input className="form-input" type="email" value={form.email}
                       onChange={set('email')} required />
              </div>
            )}
            <div className="form-group">
              <label className="form-label">验证码</label>
              <input className="form-input" type="text" value={form.code} onChange={set('code')}
                     placeholder="6位验证码" maxLength={6}
                     style={{ letterSpacing: '0.18em', textAlign: 'center' }}
                     required autoFocus={!!emailParam} />
            </div>
            <div className="form-group">
              <label className="form-label">新密码</label>
              <PasswordInput value={form.newPassword} onChange={set('newPassword')}
                             placeholder="至少 8 位,含大小写、数字和特殊字符"
                             required autoComplete="new-password" />
            </div>
            <div className="form-group">
              <label className="form-label">确认新密码</label>
              <PasswordInput value={form.confirm} onChange={set('confirm')}
                             required autoComplete="new-password" />
            </div>
            <button className="btn btn-primary btn-full btn-lg" type="submit" disabled={loading}>
              {loading ? <Spinner /> : '重置密码'}
            </button>
          </form>
          <div style={{ marginTop:16, display:"flex", justifyContent:"center" }}>
            <Link href="/auth/login" className={styles.footerLink}>← 返回登录</Link>
          </div>
        </div>
      </div>
    </>
  );
}

export default function ResetPasswordPage() {
  return <Suspense><ResetForm /></Suspense>;
}
