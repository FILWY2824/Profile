/**
 * lib/settings.js
 * ===========================================================================
 * 所有"运行时可配置"的键值对都走这里。之前散落在 process.env 里的 8 个左右
 * 的变量(JWT_SECRET / SMTP / SITE_NAME / RETENTION 等)现在的唯一权威来源
 * 是 settings 表;.env 只在首次启动时作为种子(见 database.js)。
 *
 * 读取优先级:settings 表 → process.env → 默认值
 * 写入:只写 settings 表,不碰 .env
 * ===========================================================================
 */

import { database, MANAGED_SETTINGS } from './database.js';

// DEFAULTS 从 MANAGED_SETTINGS 自动派生,避免两处维护。
// 每个受管键的 default 字段是它的兜底值;未登记的键默认 ''。
const DEFAULTS = Object.fromEntries(
  MANAGED_SETTINGS.map(s => [s.key, s.default ?? ''])
);

// 小型内存缓存:避免每次读取都打一次 SQL。
// 失效触发两条:
//   (1) 本进程写入时主动 cacheValid=false —— 保证单实例立刻见到新值
//   (2) TTL 过期(下面的 CACHE_TTL_MS) —— 保证多实例/多进程部署时,A 实例
//       写入后 B 实例最多陈旧 CACHE_TTL_MS 毫秒就会重新从 DB 拉一次
// 不走 Redis pub/sub 是因为项目现阶段是"单机 pm2 single"为主,TTL 方案的
// 副作用(每 5 秒一次全表 SELECT)成本极低(表很小,SQLite 本地读取 <1ms),
// 换来了代码和部署的简洁。
const cache = new Map();
let cacheValid = false;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 5_000;

function loadAll() {
  const now = Date.now();
  if (cacheValid && (now - cacheLoadedAt) < CACHE_TTL_MS) return;
  cache.clear();
  const rows = database.prepare('SELECT key, value FROM settings').all();
  for (const r of rows) cache.set(r.key, r.value);
  cacheValid = true;
  cacheLoadedAt = now;
}

/** 读取单个配置项(字符串),不存在回退 env / 默认值 */
export function getSetting(key) {
  loadAll();
  if (cache.has(key)) {
    const v = cache.get(key);
    if (v !== null && v !== undefined && v !== '') return v;
  }
  const envVal = process.env[key];
  if (envVal) return envVal;
  return DEFAULTS[key] || '';
}

/** 读取数值(兜底 0) */
export function getSettingInt(key, fallback = 0) {
  const v = getSetting(key);
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** 保存单个配置项;空字符串被视为"清除",并回退到 env/默认值 */
export function setSetting(key, value) {
  const now = new Date().toISOString();
  const meta = MANAGED_SETTINGS.find(s => s.key === key);
  database.prepare(
    `INSERT INTO settings(key,value,category,description,sensitive,updatedAt)
     VALUES(?,?,?,?,?,?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`
  ).run(
    key,
    value ?? '',
    meta?.category || 'general',
    meta?.description || '',
    meta?.sensitive ? 1 : 0,
    now
  );
  cacheValid = false;
}

/** 一次性批量保存(admin 保存表单用) */
export function setSettings(entries) {
  const now = new Date().toISOString();
  const stmt = database.prepare(
    `INSERT INTO settings(key,value,category,description,sensitive,updatedAt)
     VALUES(?,?,?,?,?,?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`
  );
  const txn = database.transaction(() => {
    for (const [key, value] of Object.entries(entries)) {
      const meta = MANAGED_SETTINGS.find(s => s.key === key);
      if (!meta) continue; // 拒绝未登记的键,防止被塞乱七八糟的数据
      stmt.run(
        key,
        value ?? '',
        meta.category,
        meta.description,
        meta.sensitive ? 1 : 0,
        now
      );
    }
  });
  txn();
  cacheValid = false;
}

/** 列出全部受管配置(用于 admin 页面显示);敏感项默认以 ** 掩码形式返回 */
export function listSettings({ reveal = false } = {}) {
  loadAll();
  return MANAGED_SETTINGS.map(meta => {
    const raw = cache.get(meta.key) ?? '';
    let displayValue = raw;
    if (meta.sensitive && !reveal && raw) {
      displayValue = raw.length <= 4 ? '****' : raw.slice(0, 2) + '****' + raw.slice(-2);
    }
    return {
      key: meta.key,
      value: displayValue,
      hasValue: !!raw,
      category: meta.category,
      description: meta.description,
      sensitive: !!meta.sensitive,
    };
  });
}

/** 仅供 lib/auth.js 初始化时使用:同步拿到 JWT_SECRET,保证不会被掩码 */
export function getJwtSecret() {
  return getSetting('JWT_SECRET') || '';
}
