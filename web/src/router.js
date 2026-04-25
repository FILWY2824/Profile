// router.js — tiny hash-based router. Why hash and not history-mode?
// Two reasons:
//   1. The Go backend serves the SPA from / and doesn't need to be told
//      to fall back to index.html on deep links — every URL with #/foo
//      hits the root route on the server.
//   2. The OAuth consent flow has the relying party redirect back to
//      something like https://app.com/callback#code=... — keeping our
//      whole frontend in hash space means we can't accidentally trample
//      that.
//
// Routes are defined as a flat array of { path, view } where path is
// either an exact string ("/login") or a pattern with :params
// ("/oauth/authorize"). On a match we return { view, params, query }.

import { ref, reactive, computed } from "vue";

export const route = reactive({
  path: "/",
  query: {},
  params: {},
});

export function parseHash() {
  // location.hash is like "#/foo/bar?x=1"
  let h = window.location.hash || "#/";
  if (h.startsWith("#")) h = h.slice(1);
  if (!h.startsWith("/")) h = "/" + h;
  const qIdx = h.indexOf("?");
  let path = h;
  let queryStr = "";
  if (qIdx >= 0) {
    path = h.slice(0, qIdx);
    queryStr = h.slice(qIdx + 1);
  }
  const query = {};
  if (queryStr) {
    for (const pair of queryStr.split("&")) {
      if (!pair) continue;
      const [k, v = ""] = pair.split("=");
      query[decodeURIComponent(k)] = decodeURIComponent(v);
    }
  }
  return { path, query };
}

export function navigate(path, query) {
  let h = "#" + path;
  if (query) {
    const qs = new URLSearchParams(query).toString();
    if (qs) h += "?" + qs;
  }
  window.location.hash = h;
}

// matchRoute returns the first matching route entry (or fallback) and the
// extracted params. Patterns use ":foo" segments.
export function makeMatcher(routes, fallback) {
  return (path) => {
    for (const r of routes) {
      const params = matchPattern(r.path, path);
      if (params !== null) return { view: r.view, params, requiresAuth: r.requiresAuth, requiresAdmin: r.requiresAdmin };
    }
    return { view: fallback, params: {} };
  };
}

function matchPattern(pattern, path) {
  const ps = pattern.split("/").filter(Boolean);
  const xs = path.split("/").filter(Boolean);
  if (ps.length !== xs.length) return null;
  const out = {};
  for (let i = 0; i < ps.length; i++) {
    if (ps[i].startsWith(":")) {
      out[ps[i].slice(1)] = decodeURIComponent(xs[i]);
    } else if (ps[i] !== xs[i]) {
      return null;
    }
  }
  return out;
}

export function startRouter() {
  const update = () => {
    const { path, query } = parseHash();
    route.path = path;
    route.query = query;
  };
  window.addEventListener("hashchange", update);
  update();
}
