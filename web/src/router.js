import { reactive } from "vue";

export const route = reactive({ path: "/", query: {}, params: {} });

export function parseHash() {
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

export function makeMatcher(routes, fallback) {
  return (path) => {
    for (const r of routes) {
      const params = matchPattern(r.path, path);
      if (params !== null)
        return {
          view: r.view,
          params,
          requiresAuth: r.requiresAuth,
          requiresAdmin: r.requiresAdmin,
        };
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
    if (ps[i].startsWith(":")) out[ps[i].slice(1)] = decodeURIComponent(xs[i]);
    else if (ps[i] !== xs[i]) return null;
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
