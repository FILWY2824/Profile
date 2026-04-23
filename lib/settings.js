/**
 * lib/settings.js
 * ===========================================================================
 * 所有运行时可配置项都走这里。
 *
 * 注意:
 *   • settings 表只承载“可在后台维护”的配置
 *   • JWT_SECRET 不再进入数据库,只允许来自进程环境变量
 *   • 敏感项在后台为“只写不回显”;留空表示保持不变
 * ===========================================================================
 */

import { database, MANAGED_SETTINGS } from './database.js';

const DEFAULTS = Object.fromEntries(
  MANAGED_SETTINGS.map(s => [s.key, s.default ?? ''])
);
const META_BY_KEY = new Map(MANAGED_SETTINGS.map(s => [s.key, s]));

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

export function getSettingInt(key, fallback = 0) {
  const v = getSetting(key);
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function setSetting(key, value) {
  const meta = META_BY_KEY.get(key);
  if (!meta) return;

  const normalized = value == null ? '' : String(value);
  if (meta.sensitive && normalized === '') return;

  const now = new Date().toISOString();
  database.prepare(
    `INSERT INTO settings(key,value,category,description,sensitive,updatedAt)
     VALUES(?,?,?,?,?,?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`
  ).run(
    key,
    normalized,
    meta.category,
    meta.description,
    meta.sensitive ? 1 : 0,
    now
  );
  cacheValid = false;
}

export function setSettings(entries) {
  const now = new Date().toISOString();
  const stmt = database.prepare(
    `INSERT INTO settings(key,value,category,description,sensitive,updatedAt)
     VALUES(?,?,?,?,?,?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`
  );
  const txn = database.transaction(() => {
    for (const [key, rawValue] of Object.entries(entries)) {
      const meta = META_BY_KEY.get(key);
      if (!meta) continue;
      const value = rawValue == null ? '' : String(rawValue);
      if (meta.sensitive && value === '') continue;
      stmt.run(
        key,
        value,
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

export function listSettings() {
  loadAll();
  return MANAGED_SETTINGS.map(meta => {
    const raw = cache.get(meta.key) ?? '';
    const displayValue = meta.sensitive && raw
      ? (raw.length <= 4 ? '****' : raw.slice(0, 2) + '****' + raw.slice(-2))
      : raw;
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
