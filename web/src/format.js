// format.js — 统一时间/URL 格式化。
//
// 修改 (2026-04):全站时间显示统一按 Asia/Shanghai。后端时间戳是 UTC RFC3339,
// 前端把它转换到中国上海时区显示,与用户/管理员地理位置无关。这样运维在不同
// 时区登录看到的"登录于 14:32"含义一致,审计/审讯不会因时区错位。
//
// 实现细节:Intl.DateTimeFormat 的 timeZone 选项接受 IANA 名,任何现代浏览器
// 都识别 "Asia/Shanghai"。我们封装出 SHANGHAI_FMT_FULL / SHANGHAI_FMT_SHORT,
// 复用同一个实例避免每次重新 new(对长列表渲染有意义)。

const SHANGHAI_TZ = "Asia/Shanghai";

const SHANGHAI_FMT_FULL = new Intl.DateTimeFormat("zh-CN", {
  timeZone: SHANGHAI_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const SHANGHAI_FMT_DATE = new Intl.DateTimeFormat("zh-CN", {
  timeZone: SHANGHAI_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// 把 Intl.DateTimeFormat 的输出再清理一次。zh-CN 默认会输出
// "2026/04/26 14:32:01",我们改成 "2026-04-26 14:32:01" 与日志/SQL 习惯一致。
function normalizeFull(s) {
  return s.replace(/\//g, "-");
}
function normalizeDate(s) {
  return s.replace(/\//g, "-");
}

/**
 * formatTime — 用户列表里"X 分钟前 / X 小时前"的相对时间,7 天以上回退到绝对时间。
 * 绝对时间按 Asia/Shanghai 渲染。
 */
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
  return normalizeFull(SHANGHAI_FMT_FULL.format(d));
}

/**
 * formatDateTime — 强制显示完整日期 + 时间,Asia/Shanghai。
 * 用于审计日志/登录历史这种"必须看到具体时刻"的场景。
 */
export function formatDateTime(s) {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d)) return s;
  return normalizeFull(SHANGHAI_FMT_FULL.format(d));
}

/**
 * formatDate — 仅日期,Asia/Shanghai,主要给侧栏的"今日"用。
 */
export function formatDate(s) {
  const d = s ? new Date(s) : new Date();
  if (isNaN(d)) return "";
  return normalizeDate(SHANGHAI_FMT_DATE.format(d));
}

export function originOf(url) {
  try {
    const u = new URL(url);
    return u.origin.toLowerCase();
  } catch {
    return "";
  }
}
