// api.js — thin fetch wrapper. Always sends cookies (HttpOnly JWT)
// and surfaces JSON errors as Error objects with .status and .body fields
// so callers can branch cleanly on auth failures vs validation errors.

async function request(method, path, body, opts = {}) {
  const init = {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
  };
  if (body !== undefined && body !== null) {
    init.body = JSON.stringify(body);
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

// formPost is used by /api/oauth/token which requires
// application/x-www-form-urlencoded per RFC 6749. Not used by the SPA
// directly (we don't act as our own OAuth client) but exported for tools.
export async function formPost(path, params) {
  const body = new URLSearchParams(params).toString();
  const r = await fetch("/api" + path, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  return r.json();
}
