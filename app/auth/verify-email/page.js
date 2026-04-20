'use client';
import { useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import TopBar from '@/components/layout/TopBar.js';
import styles from '../auth.module.css';
import { Spinner, useToast } from '@/components/ui/index.js';

function VerifyForm() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const email = params.get('email') || '';
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/auth/verify-email', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || '验证失败'); return; }
      toast.success('邮箱验证成功');
      setTimeout(() => router.push('/auth/login'), 800);
    } catch { toast.error('网络错误'); }
    finally { setLoading(false); }
  }

  async function handleResend() {
    setResending(true);
    try {
      const res = await fetch('/api/auth/verify-email', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, resend: true }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || '重发失败'); return; }
      if (data.devCode) toast.info(`开发模式验证码:${data.devCode}`);
      else toast.success('验证码已重新发送');
    } catch { toast.error('网络错误'); }
    finally { setResending(false); }
  }

  return (
    <>
      <TopBar />
      <div className={styles.wrap}>
        <div className={styles.box}>
          <h1 className={styles.title}>验证邮箱</h1>
          <p className={styles.subtitle}>
            验证码已发送至 <strong style={{ color: 'var(--ink)' }}>{email || '您的邮箱'}</strong>
          </p>
          <form className={styles.form} onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">验证码</label>
              <input className="form-input" type="text" value={code}
                     onChange={e => setCode(e.target.value)}
                     placeholder="输入6位验证码" maxLength={6} required autoFocus
                     style={{ fontSize: '1.4rem', letterSpacing: '0.25em', textAlign: 'center' }} />
            </div>
            <button className="btn btn-primary btn-full btn-lg" type="submit" disabled={loading}>
              {loading ? <Spinner /> : '验证'}
            </button>
          </form>
          <div className={styles.footer}>
            没收到?{' '}
            <button onClick={handleResend} disabled={resending}
                    style={{ background: 'none', border: 'none', color: 'var(--amber)', fontWeight: 500, cursor: 'pointer', fontSize: 'inherit' }}>
              {resending ? '发送中...' : '重新发送'}
            </button>
          </div>
          <div style={{ marginTop:16, display:"flex", justifyContent:"center" }}>
            <Link href="/auth/login" className={styles.footerLink}>← 返回登录</Link>
          </div>
        </div>
      </div>
    </>
  );
}

export default function VerifyEmailPage() {
  return <Suspense><VerifyForm /></Suspense>;
}
