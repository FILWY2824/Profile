// api.js — fetch wrapper.
// - 自动从 cookie qishu_csrf 读取 CSRF token,放进 X-CSRF-Token 头
// - 401/403 不会跳转,由调用方决定
// - GET 不携带 body

function readCookie(name) {
  const m = document.cookie.match(new RegExp("(?:^|; )" + name.replace(/[$()*+./?[\\\]^{|}]/g, "\\$&") + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : "";
}

async function ensureCSRFCookie() {
  if (readCookie("qishu_csrf")) return;
  // GET /api/csrf 触发后端下发 cookie
  try {
    await fetch("/api/csrf", { credentials: "include" });
  } catch {}
}

async function request(method, path, body, opts = {}) {
  // 非安全方法:确保 CSRF cookie 已就位
  if (method !== "GET" && method !== "HEAD") {
    await ensureCSRFCookie();
  }
  const headers = { ...(opts.headers || {}) };
  if (body !== undefined && body !== null && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  const csrf = readCookie("qishu_csrf");
  if (csrf) {
    headers["X-CSRF-Token"] = csrf;
  }

  const init = {
    method,
    credentials: "include",
    headers,
  };
  if (body !== undefined && body !== null) {
    init.body = body instanceof FormData ? body : JSON.stringify(body);
  }
  const r = await fetch("/api" + path, init);
  const ct = r.headers.get("content-type") || "";
  let payload = null;
  if (ct.includes("application/json")) {
    payload = await r.json().catch(() => null);
  } else {
    payload = await r.text().catch(() => "");
  }
  if (!r.ok) {
    const msg =
      (payload && (payload.message || payload.error_description || payload.error)) ||
      r.statusText ||
      "请求失败";
    const err = new Error(msg);
    err.status = r.status;
    err.body = payload;
    throw err;
  }
  return payload;
}

export const api = {
  get: (p, opts) => request("GET", p, null, opts),
  post: (p, body, opts) => request("POST", p, body, opts),
  patch: (p, body, opts) => request("PATCH", p, body, opts),
  delete: (p, opts) => request("DELETE", p, null, opts),
};

export async function formPost(path, params) {
  await ensureCSRFCookie();
  const body = new URLSearchParams(params).toString();
  const csrf = readCookie("qishu_csrf");
  const r = await fetch("/api" + path, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
    },
    body,
  });
  return r.json();
}
