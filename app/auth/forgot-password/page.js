'use client';
import { useState } from 'react';
import Link from 'next/link';
import TopBar from '@/components/layout/TopBar.js';
import styles from '../auth.module.css';
import { Spinner, useToast } from '@/components/ui/index.js';
import TurnstileWidget, { useTurnstile } from '@/components/ui/TurnstileWidget.js';

export default function ForgotPasswordPage() {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState('');
  const [loading, setLoading] = useState(false);

  const ts = useTurnstile();

  async function handleSubmit(e) {
    e.preventDefault();
    if (ts.blocking) { toast.warning('请先完成"我不是机器人"的人机验证'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          turnstileToken: ts.enabled ? ts.token : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (ts.enabled) ts.reset();
        toast.error(data.error || '发送失败');
        return;
      }
      if (data.devCode) setDevCode(data.devCode);
      setSent(true);
      toast.success('验证码已发送');
    } catch {
      if (ts.enabled) ts.reset();
      toast.error('网络错误');
    }
    finally { setLoading(false); }
  }

  if (sent) {
    return (
      <>
        <TopBar />
        <div className={styles.wrap}>
          <div className={styles.box}>
            <h1 className={styles.title}>验证码已发送</h1>
            <p className={styles.subtitle}>如该邮箱已注册,您将收到密码重置验证码</p>
            {devCode && <div className={styles.devHint}><strong>开发模式 · 验证码</strong>{devCode}</div>}
            <div style={{ marginTop: 18 }}>
              <Link href={`/auth/reset-password?email=${encodeURIComponent(email)}`}
                    className="btn btn-primary btn-full">
                输入验证码重置密码 →
              </Link>
            </div>
            <div style={{ marginTop:16, display:"flex", justifyContent:"center" }}>
              <Link href="/auth/login" className={styles.footerLink}>← 返回登录</Link>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <TopBar />
      <div className={styles.wrap}>
        <div className={styles.box}>
          <h1 className={styles.title}>找回密码</h1>
          <p className={styles.subtitle}>输入注册邮箱,我们将发送重置验证码</p>
          <form className={styles.form} onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">邮箱</label>
              <input className="form-input" type="email" value={email}
                     onChange={e => setEmail(e.target.value)}
                     placeholder="you@example.com" required autoFocus />
            </div>
            {ts.enabled && ts.siteKey && (
              <TurnstileWidget
                siteKey={ts.siteKey}
                onToken={ts.setToken}
                onExpire={ts.clear}
                resetRef={ts.resetRef}
              />
            )}
            <button className="btn btn-primary btn-full btn-lg" type="submit"
                    disabled={loading || ts.blocking}>
              {loading ? <Spinner /> : (ts.blocking ? '请先完成人机验证' : '发送验证码')}
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
