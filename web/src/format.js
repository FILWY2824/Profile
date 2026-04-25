export function formatTime(s) {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d)) return s;
  const now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return Math.floor(diff / 60) + " 分钟前";
  if (diff < 86400) return Math.floor(diff / 3600) + " 小时前";
  if (diff < 86400 * 7) return Math.floor(diff / 86400) + " 天前";
  return d.toLocaleString("zh-CN", { hour12: false });
}

export function formatDateTime(s) {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d)) return s;
  return d.toLocaleString("zh-CN", { hour12: false });
}

export function originOf(url) {
  try {
    const u = new URL(url);
    return u.origin.toLowerCase();
  } catch {
    return "";
  }
}
