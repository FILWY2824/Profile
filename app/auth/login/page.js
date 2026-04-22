'use client';
// ============================================================================
// 项目内路径: app/auth/login/page.js
// 文件名:     page.js
// ============================================================================

import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import TopBar from '@/components/layout/TopBar.js';
import styles from '../auth.module.css';
import { Spinner, useToast } from '@/components/ui/index.js';
import PasswordInput from '@/components/ui/PasswordInput.js';
import TurnstileWidget, { useTurnstile } from '@/components/ui/TurnstileWidget.js';

/**
 * 把 URL 里的 redirect 参数收窄成"必须是本站内相对路径"。
 *
 * 攻击面:如果直接 router.push(searchParams.get('redirect')),
 * 攻击者构造 /auth/login?redirect=https://evil.com/fake-qishu 之后发给受害者,
 * 登录成功后受害者被跳到钓鱼站,整个登录态接着可能在那里被骗去输二次验证等。
 *
 * 规则:
 *   • 必须以 '/' 开头,且不能以 '//' 开头(后者是 protocol-relative URL,
 *     浏览器会跳到外站)。
 *   • 不能包含 '\\'(IE/旧浏览器会把反斜杠当路径分隔,解析歧义)。
 *   • 不能包含协议前缀。
 *   • 解码后仍需通过上述规则(防止 %2f%2f 这类绕过)。
 * 不通过时回落到 '/'。
 */
function safeRedirect(raw) {
  if (!raw || typeof raw !== 'string') return '/';
  let r = raw.trim();
  try { r = decodeURIComponent(r); } catch { /* 解码失败就用原串 */ }
  if (!r.startsWith('/')) return '/';
  if (r.startsWith('//')) return '/';
  if (r.startsWith('/\\') || r.includes('\\')) return '/';
  if (/^\/*[a-z][a-z0-9+.-]*:/i.test(r)) return '/';   // 带 scheme
  return r;
}

/**
 * 登录页。Turnstile 相关的 widget 与 hook 已被抽到
 * components/ui/TurnstileWidget.js,注册页 / 找回密码页共用同一套。
 */
function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const redirect = safeRedirect(searchParams.get('redirect'));
  const justRegistered = searchParams.get('registered') === '1';
  const reason = searchParams.get('reason') || '';
  const [form, setForm] = useState({
    email: searchParams.get('email') || '',
    password: '',
  });
  const [loading, setLoading] = useState(false);
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const ts = useTurnstile();

  // 注册成功/改密后的一次性状态提示,toast 方式更克制
  useEffect(() => {
    if (justRegistered) toast.info('注册成功,请使用邮箱和密码登录');
    else if (reason === 'password-changed') toast.info('密码已修改,请使用新密码登录');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    if (ts.blocking) {
      toast.warning('请先完成"我不是机器人"的人机验证');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          turnstileToken: ts.enabled ? ts.token : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === 'EMAIL_NOT_VERIFIED') {
          toast.warning('请先验证邮箱');
          router.push(`/auth/verify-email?email=${encodeURIComponent(form.email)}`);
          return;
        }
        // 任何登录失败都让 Turnstile token 失效(Cloudflare 的 token 是一次性的,
        // 复用必失败)—— 主动 reset 让用户直接看到可重试的 widget
        if (ts.enabled) ts.reset();
        toast.error(data.error || '登录失败');
        return;
      }
      toast.success('登录成功');
      router.push(redirect);
    } catch {
      if (ts.enabled) ts.reset();
      toast.error('网络错误,请稍后重试');
    } finally { setLoading(false); }
  }

  return (
    <>
      <TopBar />
      <div className={styles.wrap}>
        <div className={styles.box}>
          <h1 className={styles.title}>欢迎回来</h1>
          <p className={styles.subtitle}>登录您的栖枢账号</p>
          <form className={styles.form} onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">邮箱</label>
              <input className="form-input" type="email" value={form.email}
                     onChange={set('email')} placeholder="you@example.com" required autoFocus />
            </div>
            <div className="form-group">
              <label className="form-label">密码</label>
              <PasswordInput value={form.password} onChange={set('password')}
                             placeholder="输入密码" required autoComplete="current-password" />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: -6 }}>
              <Link href="/auth/forgot-password" style={{ fontSize: '0.82rem', color: 'var(--amber)' }}>忘记密码?</Link>
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
              {loading ? <Spinner /> : (ts.blocking ? '请先完成人机验证' : '登录')}
            </button>
          </form>
          <div className={styles.footer}>
            还没有账号?<Link href="/auth/register">立即注册</Link>
          </div>
        </div>
      </div>
    </>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}