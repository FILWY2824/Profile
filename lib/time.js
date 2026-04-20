/**
 * lib/time.js —— 统一的日期 / 时间格式化与时区工具
 * ---------------------------------------------------------------------------
 * 目的:全站展示的时间和日期都以亚洲/上海(UTC+8)为准,数据库里仍旧存 UTC ISO。
 *
 * 服务端 / 客户端通吃:纯函数,不依赖 fs 或浏览器 API。
 * ---------------------------------------------------------------------------
 */

const SHANGHAI = 'Asia/Shanghai';
const OFFSET_MS = 8 * 3600_000; // +08:00

// ── 展示 ────────────────────────────────────────────────────────────────────

/** 把 ISO 字符串或 Date 格式成 "2026/4/20 上午10:00:00" 风格 */
export function fmtDateTime(iso) {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      timeZone: SHANGHAI,
      hour12: false,
    });
  } catch { return '-'; }
}

/** 只格式化到日(用于注册日、授权日等) */
export function fmtDate(iso) {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleDateString('zh-CN', {
      timeZone: SHANGHAI,
    });
  } catch { return '-'; }
}

// ── 计算 ────────────────────────────────────────────────────────────────────

/** 当前上海日历日期(YYYY-MM-DD) */
export function todayShanghai() {
  const d = new Date(Date.now() + OFFSET_MS);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 把一个上海时区的日历日期(YYYY-MM-DD)转换成当天 00:00:00 的 UTC ISO。
 * 例如 '2026-04-20' → '2026-04-19T16:00:00.000Z' (上海 00:00 = UTC 前一天 16:00)
 * 用于 SQL WHERE timestamp >= ? 的边界。
 */
export function shanghaiStartIso(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - OFFSET_MS).toISOString();
}

/**
 * 当天 23:59:59.999 的 UTC ISO。
 * 例如 '2026-04-20' → '2026-04-20T15:59:59.999Z'。
 * 用于 SQL WHERE timestamp <= ? 的边界。
 */
export function shanghaiEndIso(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999) - OFFSET_MS).toISOString();
}
