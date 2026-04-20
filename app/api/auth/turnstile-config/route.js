import { NextResponse } from 'next/server';
import { isTurnstileEnabled, getTurnstileSiteKey } from '@/lib/turnstile.js';

/**
 * GET /api/auth/turnstile-config
 *
 * 前端登录页用这个接口判断要不要渲染 Turnstile widget。
 * 只返回公开字段(enabled + siteKey),secretKey 绝不会出现在响应里。
 *
 * 为什么单独一个 endpoint 而不是把 siteKey 塞进首页:
 *   (a) /auth/login 是客户端组件,拿不到 env;
 *   (b) siteKey 管理员可能在 /admin/settings 里随时改,走接口的话自动跟着最新值
 *       走,不用重新打包;
 *   (c) 避免在其他页面(比如首页)也下发登录相关字段。
 */
export async function GET() {
  return NextResponse.json({
    enabled: isTurnstileEnabled(),
    siteKey: getTurnstileSiteKey(),
  });
}
