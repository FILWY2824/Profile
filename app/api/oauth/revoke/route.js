import { NextResponse } from 'next/server';
import { oauthStore } from '@/lib/fileStore.js';
import { findOAuthClient, verifyClientSecret, isConfidentialClient } from '@/lib/oauthClients.js';

/**
 * POST /api/oauth/revoke
 *
 * RFC 7009 Token Revocation。
 *
 * 修复(第 1 轮遗留 #3.2):之前这里是"拿到 token 字符串就直接调 revokeToken",
 * 没有任何客户端认证,也没校验 token 是否属于调用方。意味着任何拿到 token
 * 字符串的人都能主动吊销它 —— 边界过松。
 *
 * 本版本:
 *   1) 客户端认证(和 token endpoint 对齐):
 *      • 机密客户端必须提供有效的 Basic Auth 或 form 里的 client_id/secret
 *      • public 客户端仍可调用(RFC 7009 §2.1 允许),但必须通过 client_id
 *        声明身份,token 必须属于这个 client_id
 *   2) Token 归属校验:token 必须属于当前认证的 client_id,否则拒绝。防止
 *      一个 client 去吊销别的 client 的 token。
 *   3) token_type_hint 支持 access_token / refresh_token 两种查找路径。
 *   4) 不泄露"token 是否存在"—— 错误分支一律返回 200 (RFC 7009 §2.2 要求),
 *      只有认证失败才返回 401。
 */
export async function POST(request) {
  try {
    // ── 解析请求 ───────────────────────────────────────────────
    const body = await request.formData().catch(() => null);
    let token, token_type_hint, client_id, client_secret;
    if (body) {
      token = body.get('token');
      token_type_hint = body.get('token_type_hint');
      client_id = body.get('client_id');
      client_secret = body.get('client_secret');
    } else {
      const json = await request.json().catch(() => ({}));
      token = json.token;
      token_type_hint = json.token_type_hint;
      client_id = json.client_id;
      client_secret = json.client_secret;
    }

    if (!token) {
      return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
    }

    // ── 客户端认证(与 token endpoint 相同逻辑) ──────────────
    let client;
    let presentedSecret = null;

    const authHeader = request.headers.get('authorization');
    if (authHeader?.startsWith('Basic ')) {
      const decoded = Buffer.from(authHeader.slice(6), 'base64').toString();
      const idx = decoded.indexOf(':');
      const id = idx >= 0 ? decoded.slice(0, idx) : decoded;
      const secret = idx >= 0 ? decoded.slice(idx + 1) : '';
      client = findOAuthClient(id);
      presentedSecret = secret || null;
    } else {
      client = findOAuthClient(client_id);
      presentedSecret = client_secret || null;
    }

    if (!client) {
      return NextResponse.json({ error: 'invalid_client' }, { status: 401 });
    }

    if (isConfidentialClient(client)) {
      if (!presentedSecret || !verifyClientSecret(client, presentedSecret)) {
        return NextResponse.json({ error: 'invalid_client' }, { status: 401 });
      }
    }
    // public client 不要求 secret,但上面已经确认 client 存在且 id 由调用方声明。

    // ── 查 token,并校验 "属于当前 client" ────────────────────
    //
    // token_type_hint 是查找提示 —— 先按提示找,没找到退而求其次找另一张表
    // (RFC 7009 §2.1)。我们的 accessToken 和 refreshToken 都在 oauth_tokens
    // 同一张表里,只是对应的列不同,所以直接两种方式都查一遍。
    let record = null;
    if (token_type_hint === 'refresh_token') {
      record = oauthStore.findByRefreshToken(token) || null;
      if (!record) {
        const r = oauthStore.findToken(token);
        record = r?.record || null;
      }
    } else {
      const r = oauthStore.findToken(token);
      record = r?.record || null;
      if (!record) {
        record = oauthStore.findByRefreshToken(token) || null;
      }
    }

    // RFC 7009 §2.2:token 不存在 / 已失效 —— 一律返回成功(200 空体)。
    // 不告诉调用方"这个 token 不存在",避免作为存在性探测的 oracle。
    if (!record) {
      return NextResponse.json({});
    }

    // Token 归属校验:必须属于当前认证的 client,否则按"不存在"处理(RFC 并
    // 未明确要求这一点,但对外仍返回 200 —— 既满足归属约束,又不暴露差异)。
    if (record.clientId !== client.clientId) {
      return NextResponse.json({});
    }

    // ── 执行撤销 ───────────────────────────────────────────────
    // 两种形式都尝试一下,不管 token 是 access 还是 refresh 都能命中。
    oauthStore.revokeToken(token);
    oauthStore.revokeByRefreshToken(token);

    return NextResponse.json({});
  } catch (err) {
    // RFC 7009 要求"即使服务内部失败也返回 200",但我们还是打个日志,运营
    // 能知道 revoke 路径崩过。
    console.error('OAuth revoke error:', err);
    return NextResponse.json({});
  }
}
