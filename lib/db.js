/**
 * lib/db.js —— 兼容层
 * ---------------------------------------------------------------------------
 * 保持与原 JSON 文件库完全一致的 API(findAll/findOne/findById/insert/
 * updateById/deleteById/count/search),但底层换成 SQLite(lib/database.js)。
 * 这样 app/api/* 的每一条业务代码都不需要改动。
 *
 * 支持的集合 → 表:
 *   users, sections, cards, oauth_clients, oauth_grants
 *
 * JSON 列会在读写时自动序列化/反序列化,布尔字段会在 SQLite INTEGER 与
 * JavaScript boolean 之间转换。
 * ---------------------------------------------------------------------------
 */

import { database } from './database.js';
import { v4 as uuidv4 } from 'uuid';

// 每张表需要反序列化为对象/数组的列
const JSON_COLUMNS = {
  oauth_clients: ['redirectUris', 'scopes'],
  oauth_grants: ['scopes'],
};
// 每张表要在 boolean ↔ 0/1 之间转换的列
const BOOLEAN_COLUMNS = {
  users: ['emailVerified'],
  oauth_grants: ['revoked'],
};
const RESERVED_COLS = new Set(['order']);
const VALID_TABLES = new Set(['users', 'sections', 'cards', 'oauth_clients', 'oauth_grants']);

function quote(col) { return RESERVED_COLS.has(col) ? `"${col}"` : col; }
function assertTable(t) { if (!VALID_TABLES.has(t)) throw new Error(`unknown table: ${t}`); }

function hydrate(table, row) {
  if (!row) return null;
  const out = { ...row };
  for (const col of JSON_COLUMNS[table] || []) {
    if (typeof out[col] === 'string') {
      try { out[col] = JSON.parse(out[col]); } catch { out[col] = null; }
    }
  }
  for (const col of BOOLEAN_COLUMNS[table] || []) {
    if (typeof out[col] === 'number') out[col] = out[col] === 1;
  }
  return out;
}

function dehydrate(table, record) {
  const out = { ...record };
  for (const col of JSON_COLUMNS[table] || []) {
    if (out[col] !== undefined && typeof out[col] !== 'string') {
      out[col] = JSON.stringify(out[col] ?? []);
    }
  }
  for (const col of BOOLEAN_COLUMNS[table] || []) {
    if (typeof out[col] === 'boolean') out[col] = out[col] ? 1 : 0;
  }
  return out;
}

function buildWhere(filter) {
  const keys = Object.keys(filter || {});
  if (!keys.length) return { sql: '', args: [] };
  const parts = [];
  const args = [];
  for (const k of keys) {
    const v = filter[k];
    if (v === null) parts.push(`${quote(k)} IS NULL`);
    else if (typeof v === 'boolean') { parts.push(`${quote(k)} = ?`); args.push(v ? 1 : 0); }
    else { parts.push(`${quote(k)} = ?`); args.push(v); }
  }
  return { sql: ' WHERE ' + parts.join(' AND '), args };
}

export const db = {
  findAll(table, filter = {}) {
    assertTable(table);
    const { sql, args } = buildWhere(filter);
    const rows = database.prepare(`SELECT * FROM ${table}${sql}`).all(...args);
    return rows.map(r => hydrate(table, r));
  },

  findOne(table, filter = {}) {
    assertTable(table);
    const { sql, args } = buildWhere(filter);
    const row = database.prepare(`SELECT * FROM ${table}${sql} LIMIT 1`).get(...args);
    return hydrate(table, row);
  },

  findById(table, id) {
    return this.findOne(table, { id });
  },

  insert(table, record) {
    assertTable(table);
    const now = new Date().toISOString();
    const full = dehydrate(table, {
      id: uuidv4(),
      createdAt: now,
      updatedAt: now,
      ...record,
    });
    full.id = full.id || uuidv4();
    full.createdAt = full.createdAt || now;
    full.updatedAt = full.updatedAt || now;

    const cols = Object.keys(full);
    const placeholders = cols.map(() => '?').join(',');
    database.prepare(
      `INSERT INTO ${table} (${cols.map(quote).join(',')}) VALUES (${placeholders})`
    ).run(...cols.map(c => full[c]));

    return this.findById(table, full.id);
  },

  updateById(table, id, updates) {
    assertTable(table);
    const existing = this.findById(table, id);
    if (!existing) return null;
    const patched = dehydrate(table, {
      ...updates,
      updatedAt: new Date().toISOString(),
    });
    const cols = Object.keys(patched);
    if (!cols.length) return existing;
    const setSql = cols.map(c => `${quote(c)} = ?`).join(', ');
    database.prepare(
      `UPDATE ${table} SET ${setSql} WHERE id = ?`
    ).run(...cols.map(c => patched[c]), id);
    return this.findById(table, id);
  },

  deleteById(table, id) {
    assertTable(table);
    const info = database.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
    return info.changes > 0;
  },

  count(table, filter = {}) {
    assertTable(table);
    const { sql, args } = buildWhere(filter);
    const row = database.prepare(`SELECT COUNT(*) AS c FROM ${table}${sql}`).get(...args);
    return row?.c || 0;
  },

  /** 旧接口:读全集再 JS 过滤。仅用于小集合(users/cards 等)。 */
  search(table, predicate) {
    return this.findAll(table).filter(predicate);
  },
};
