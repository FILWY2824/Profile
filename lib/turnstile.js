/**
 * lib/turnstile.js — Cloudflare Turnstile 服务端校验
 * ===========================================================================
 * Turnstile 是 Cloudflare 的无图形挑战验证码方案,默认呈现为"我不是机器人"
 * 复选框 —— 绝大多数真人访客只需一次点击就能通过,可疑流量才会被升级成隐
 * 式 / 交互式挑战。整体体验比 reCAPTCHA 安静得多,不会有选红绿灯的那种烦。
 *
 * 设计目标:
 *   • 所有运行时参数(启用开关 / site_key / secret_key)都从 settings 表读,
 *     管理员在 /admin/settings 能随时开关 / 轮换秘钥,不改代码不重启
 *   • 未启用时整个模块是 no-op,登录流程不变,不会因为缺配置而卡住
 *   • 校验失败要明确给出错误码,方便调试
 *
 * 用法(见 app/api/auth/login/route.js):
 *   const tr = await verifyTurnstile(token, ip);
 *   if (!tr.ok) return NextResponse.json({ error: tr.error }, { status: 400 });
 * ===========================================================================
 */

import { getSetting } from './settings.js';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const VERIFY_TIMEOUT_MS = 5_000;

/** 当前是否启用了 Turnstile 保护。前端也通过这个判断要不要渲染 widget。 */
export function isTurnstileEnabled() {
  const flag = getSetting('TURNSTILE_ENABLED');
  const siteKey = getSetting('TURNSTILE_SITE_KEY');
  const secretKey = getSetting('TURNSTILE_SECRET_KEY');
  // 开关打开 + 两个 key 都填了才算真正启用 —— 否则会硬性拒绝所有登录
  return flag === '1' && !!siteKey && !!secretKey;
}

/** 前端用的 siteKey;未启用返回空串,前端据此判断是否渲染 widget。 */
export function getTurnstileSiteKey() {
  if (!isTurnstileEnabled()) return '';
  return getSetting('TURNSTILE_SITE_KEY');
}

/**
 * 校验前端传来的 Turnstile token。
 *
 * 返回:
 *   { ok: true }                              校验通过 / 未启用
 *   { ok: false, error: string, code?: ... }  校验失败
 *
 * 错误原因可能是:token 缺失、token 已被用过、token 过期、secret 错误、
 * 挑战未完成等。Cloudflare 的 error-codes 列表见官方文档,这里不逐一映射,
 * 直接把原始码拼进 error 供排查。
 *
 * 注意:token 是一次性的,同一 token 发两次 siteverify 第二次必失败 —— 这是
 * Cloudflare 的防重放,不是本模块的 bug。登录路由里务必只调用一次。
 */
export async function verifyTurnstile(token, ip) {
  // 未启用:放行。这样本地开发 / 迁移期不需要挂 Turnstile 也能用。
  if (!isTurnstileEnabled()) return { ok: true, skipped: true };

  if (!token || typeof token !== 'string') {
    return { ok: false, error: '人机验证未完成,请点击完成验证后再登录' };
  }

  const secret = getSetting('TURNSTILE_SECRET_KEY');

  const form = new URLSearchParams();
  form.append('secret', secret);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
  try {
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      body: form,
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!res.ok) {
      return { ok: false, error: `人机验证服务不可达(HTTP ${res.status})` };
    }
    const data = await res.json();
    if (data.success) return { ok: true };
    const codes = Array.isArray(data['error-codes']) ? data['error-codes'].join(',') : '';
    return {
      ok: false,
      error: `人机验证失败,请刷新页面重试${codes ? `(${codes})` : ''}`,
      code: codes,
    };
  } catch (err) {
    if (err?.name === 'AbortError') {
      return { ok: false, error: '人机验证超时,请稍后重试' };
    }
    return { ok: false, error: '人机验证异常,请稍后重试' };
  } finally {
    clearTimeout(t);
  }
}
