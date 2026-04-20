'use client';
import { useEffect, useRef, useState } from 'react';

/**
 * TurnstileWidget —— Cloudflare Turnstile 的 React 封装
 * ---------------------------------------------------------------------------
 * 这个组件之前只存在于 /auth/login 页面里,为了让注册、找回密码也能共用同一
 * 套逻辑,把它抽成了共享组件。
 *
 * 设计与原地实现一致:
 *   • 只在启用时(siteKey 非空)渲染;未启用时 parent 直接不 render 本组件
 *   • 脚本只注入一次(window.__turnstileScriptPromise 做全局去重),多页面
 *     来回切都不会重复加载
 *   • managed + always 模式:访客看到可见的"我不是机器人"复选框,可疑流量
 *     才升级成交互式挑战。和用户要求的"只需点击"一致。
 *   • 登录/注册/找回密码失败后 token 会被 Cloudflare 视为已用,必须 reset。
 *     通过 resetRef 暴露给父组件:
 *         const resetRef = useRef(null);
 *         <TurnstileWidget resetRef={resetRef} ... />
 *         // 登录失败时:resetRef.current?.();
 *     之前用的是 window.__turnstileReset 这种全局挂 ref,跨页面容易互相污染
 *     (同页面有两个 widget 时就坏了),这版改成每个 widget 自己的 ref。
 * ---------------------------------------------------------------------------
 */

const TURNSTILE_SCRIPT =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

function loadTurnstileScript() {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (window.__turnstileScriptPromise) return window.__turnstileScriptPromise;
  window.__turnstileScriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TURNSTILE_SCRIPT;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Turnstile 脚本加载失败'));
    document.head.appendChild(s);
  });
  return window.__turnstileScriptPromise;
}

export default function TurnstileWidget({ siteKey, onToken, onExpire, resetRef }) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    loadTurnstileScript().then(() => {
      if (cancelled || !containerRef.current || !window.turnstile) return;
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        appearance: 'always',
        theme: 'light',
        callback: (token) => onToken?.(token),
        'expired-callback': () => onExpire?.(),
        'error-callback': () => onExpire?.(),
      });
    }).catch(() => {
      // 脚本加载失败 —— 提交按钮会因为 token 为空而保持禁用,用户刷新页面
      // 就能重试。这里不主动弹错,避免网络不稳时刷屏
    });
    return () => {
      cancelled = true;
      try {
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.remove(widgetIdRef.current);
        }
      } catch {}
      widgetIdRef.current = null;
    };
    // siteKey 在同一个 widget 生命周期内稳定
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 把 reset 能力通过 ref 暴露给父组件(比 window 全局挂更干净)
  useEffect(() => {
    if (!resetRef) return;
    resetRef.current = () => {
      try {
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.reset(widgetIdRef.current);
        }
      } catch {}
    };
    return () => { if (resetRef) resetRef.current = null; };
  }, [resetRef]);

  return <div ref={containerRef} style={{ display: 'flex', justifyContent: 'center', margin: '8px 0 -4px' }} />;
}

/**
 * useTurnstile —— 把"拉配置 + 管 token + 提供提交 guard"这一圈打包好。
 * 每个需要 Turnstile 的页面(login/register/forgot)都可以直接用:
 *
 *   const ts = useTurnstile();
 *   // 渲染:
 *   {ts.enabled && ts.siteKey && (
 *     <TurnstileWidget
 *       siteKey={ts.siteKey}
 *       onToken={ts.setToken}
 *       onExpire={ts.clear}
 *       resetRef={ts.resetRef}
 *     />
 *   )}
 *   // 提交前:
 *   if (ts.blocking) return toast.warning('请先完成人机验证');
 *   // body:
 *   body: JSON.stringify({ ..., turnstileToken: ts.enabled ? ts.token : undefined })
 *   // 失败后:ts.reset();
 */
export function useTurnstile() {
  const [config, setConfig] = useState(null);
  const [token, setToken] = useState('');
  const resetRef = useRef(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/auth/turnstile-config')
      .then(r => r.ok ? r.json() : { enabled: false, siteKey: '' })
      .then(cfg => { if (alive) setConfig(cfg); })
      .catch(() => { if (alive) setConfig({ enabled: false, siteKey: '' }); });
    return () => { alive = false; };
  }, []);

  const enabled = !!config?.enabled;
  const siteKey = config?.siteKey || '';
  const blocking = enabled && !token;

  function clear() { setToken(''); }
  function reset() {
    setToken('');
    resetRef.current?.();
  }

  return { config, enabled, siteKey, token, setToken, clear, reset, blocking, resetRef };
}
