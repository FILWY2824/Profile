'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import TopBar from '@/components/layout/TopBar.js';
import styles from '../auth.module.css';
import { Spinner, useToast } from '@/components/ui/index.js';
import PasswordInput from '@/components/ui/PasswordInput.js';
import TurnstileWidget, { useTurnstile } from '@/components/ui/TurnstileWidget.js';

export default function RegisterPage() {
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = useState('form');
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  const ts = useTurnstile();

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  async function sendCode() {
    setDevCode('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          password: form.password,
          turnstileToken: ts.enabled ? ts.token : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        // token 一次性,失败后重置以便用户再试
        if (ts.enabled) ts.reset();
        toast.error(data.error || '发送验证码失败');
        return false;
      }
      if (data.devCode) {
        setDevCode(data.devCode);
        toast.info(`开发模式验证码:${data.devCode}`);
      } else {
        toast.success('验证码已发送至您的邮箱');
      }
      setResendCooldown(60);
      return true;
    } catch {
      if (ts.enabled) ts.reset();
      toast.error('网络错误');
      return false;
    } finally { setLoading(false); }
  }

  async function handleFormSubmit(e) {
    e.preventDefault();
    if (form.password !== form.confirm) { toast.error('两次密码不一致'); return; }
    if (ts.blocking) { toast.warning('请先完成"我不是机器人"的人机验证'); return; }
    const ok = await sendCode();
    if (ok) setStep('verify');
  }

  async function handleVerifySubmit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/auth/register/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.email, code: code.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || '验证码错误'); return; }
      toast.success('注册成功');
      router.push(`/auth/login?registered=1&email=${encodeURIComponent(form.email)}`);
    } catch {
      toast.error('网络错误');
    } finally { setLoading(false); }
  }

  async function handleResend() {
    if (resendCooldown > 0 || loading) return;
    if (ts.blocking) { toast.warning('请先完成人机验证后再重发'); return; }
    await sendCode();
  }

  if (step === 'verify') {
    return (
      <>
        <TopBar />
        <div className={styles.wrap}>
          <div className={styles.box}>
            <h1 className={styles.title}>输入验证码</h1>
            <p className={styles.subtitle}>
              我们已向 <strong style={{ color: 'var(--ink)' }}>{form.email}</strong> 发送了 6 位验证码
            </p>
            {devCode && (
              <div className={styles.devHint}>
                <strong>开发模式 · 验证码</strong>{devCode}
              </div>
            )}
            <form className={styles.form} onSubmit={handleVerifySubmit}>
              <div className="form-group">
                <label className="form-label">验证码</label>
                <input className="form-input" type="text" inputMode="numeric" pattern="[0-9]*"
                       maxLength={6} value={code}
                       onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                       placeholder="6 位数字" required autoFocus
                       style={{ letterSpacing: '0.25em', fontSize: '1.1rem', textAlign: 'center' }} />
              </div>
              {/* 重发需要新的 Turnstile token —— 复用同一个 widget 实例即可 */}
              {ts.enabled && ts.siteKey && (
                <TurnstileWidget
                  siteKey={ts.siteKey}
                  onToken={ts.setToken}
                  onExpire={ts.clear}
                  resetRef={ts.resetRef}
                />
              )}
              <button className="btn btn-primary btn-full btn-lg" type="submit"
                      disabled={loading || code.length !== 6}>
                {loading ? <Spinner /> : '完成注册'}
              </button>
            </form>
            <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
              <button type="button"
                      onClick={() => { setStep('form'); setCode(''); }}
                      style={{ background: 'none', border: 'none', color: 'var(--ink-3)', cursor: 'pointer', padding: 0 }}>
                ← 返回修改信息
              </button>
              <button type="button" onClick={handleResend}
                      disabled={resendCooldown > 0 || loading || ts.blocking}
                      style={{
                        background: 'none', border: 'none', padding: 0,
                        color: (resendCooldown > 0 || ts.blocking) ? 'var(--ink-3)' : 'var(--amber)',
                        cursor: (resendCooldown > 0 || ts.blocking) ? 'not-allowed' : 'pointer',
                        fontWeight: 500,
                      }}>
                {resendCooldown > 0 ? `${resendCooldown}s 后可重发` : '重新发送'}
              </button>
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
          <h1 className={styles.title}>创建账号</h1>
          <p className={styles.subtitle}>加入栖枢平台,下一步将向您的邮箱发送验证码</p>
          <form className={styles.form} onSubmit={handleFormSubmit}>
            <div className="form-group">
              <label className="form-label">用户名</label>
              <input className="form-input" type="text" value={form.name} onChange={set('name')}
                     placeholder="您的名字(最多 10 字)" required autoFocus minLength={2} maxLength={10} />
            </div>
            <div className="form-group">
              <label className="form-label">邮箱</label>
              <input className="form-input" type="email" value={form.email} onChange={set('email')}
                     placeholder="you@example.com" required />
            </div>
            <div className="form-group">
              <label className="form-label">密码</label>
              <PasswordInput value={form.password} onChange={set('password')}
                             placeholder="至少8位,含大小写、数字和特殊字符" required
                             autoComplete="new-password" />
            </div>
            <div className="form-group">
              <label className="form-label">确认密码</label>
              <PasswordInput value={form.confirm} onChange={set('confirm')}
                             placeholder="再次输入密码" required
                             autoComplete="new-password" />
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
          <div className={styles.footer}>已有账号?<Link href="/auth/login">立即登录</Link></div>
        </div>
      </div>
    </>
  );
}
