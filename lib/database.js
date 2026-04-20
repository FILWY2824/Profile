/**
 * lib/database.js — SQLite via better-sqlite3
 * ===========================================================================
 * 全局唯一的 DB 实例。第一次被引入时:
 *   1) 打开/创建 data/app.db
 *   2) 执行 SCHEMA(若不存在则创建表 + 索引)
 *   3) 迁移旧的 data/*.json + 日期分区文件 → 表(仅首次)
 *   4) 将 .env 中的受管配置项迁移到 settings 表(仅首次)
 *
 * 所有业务代码(api/*、lib/db.js、lib/fileStore.js 等)都通过这里拿
 * prepared statement。不要在业务层手写 SQL 片段——集中在一处便于维护。
 * ===========================================================================
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { STATIC_OAUTH_CLIENTS } from '../config/oauth-clients.js';

// DATA_DIR 默认在项目根 ./data 下。允许测试通过 QISHU_DATA_DIR 覆盖到临时目录,
// 这样测试能开一个干净的 DB,不污染开发/生产的 data/app.db。
const DATA_DIR = process.env.QISHU_DATA_DIR
  ? path.resolve(process.env.QISHU_DATA_DIR)
  : path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'app.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ── 全局单例(热重载下也避免重复打开) ──
const GLOBAL_KEY = '__qishu_sqlite__';
function getDB() {
  if (!globalThis[GLOBAL_KEY]) {
    const db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    applySchema(db);
    runMigrations(db);
    migrateLegacyData(db);
    syncManagedSettings(db);
    globalThis[GLOBAL_KEY] = db;
  }
  return globalThis[GLOBAL_KEY];
}

// ── Schema ──
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  passwordHash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'active',
  emailVerified INTEGER NOT NULL DEFAULT 0,
  bio TEXT NOT NULL DEFAULT '',
  avatar TEXT NOT NULL DEFAULT '',
  lastLoginIp TEXT,
  lastLoginAt TEXT,
  passwordChangedAt TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  "order" INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL,
  sectionId TEXT,
  "order" INTEGER NOT NULL DEFAULT 0,
  permission TEXT NOT NULL DEFAULT 'public',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cards_section ON cards(sectionId);

CREATE TABLE IF NOT EXISTS oauth_clients (
  id TEXT PRIMARY KEY,
  clientId TEXT UNIQUE NOT NULL,
  clientSecretHash TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  homepageUrl TEXT NOT NULL DEFAULT '',
  logoUrl TEXT NOT NULL DEFAULT '',
  minLevel INTEGER NOT NULL DEFAULT 0,
  redirectUris TEXT NOT NULL DEFAULT '[]',
  scopes TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_grants (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  clientId TEXT NOT NULL,
  clientName TEXT NOT NULL DEFAULT '',
  scopes TEXT NOT NULL DEFAULT '[]',
  revoked INTEGER NOT NULL DEFAULT 0,
  revokedAt TEXT,
  grantedAt TEXT NOT NULL,
  lastUsedAt TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_grants_user ON oauth_grants(userId);
CREATE INDEX IF NOT EXISTS idx_grants_user_client ON oauth_grants(userId, clientId);

CREATE TABLE IF NOT EXISTS login_history (
  id TEXT PRIMARY KEY,
  userId TEXT,
  email TEXT,
  ip TEXT NOT NULL DEFAULT '',
  userAgent TEXT NOT NULL DEFAULT '',
  success INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  timestamp TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_user_ts ON login_history(userId, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_login_ts ON login_history(timestamp DESC);

CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY,
  userId TEXT,
  username TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  target TEXT,
  ip TEXT NOT NULL DEFAULT '',
  meta TEXT NOT NULL DEFAULT '{}',
  timestamp TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_user_ts ON activity_log(userId, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_activity_ts ON activity_log(timestamp DESC);

CREATE TABLE IF NOT EXISTS verification_codes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  type TEXT NOT NULL,
  ip TEXT,
  meta TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  used INTEGER NOT NULL DEFAULT 0,
  expiresAt TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vcode_lookup ON verification_codes(email, type, used);
CREATE INDEX IF NOT EXISTS idx_vcode_expires ON verification_codes(expiresAt);

CREATE TABLE IF NOT EXISTS oauth_codes (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  clientId TEXT NOT NULL,
  userId TEXT NOT NULL,
  redirectUri TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'openid',
  codeChallenge TEXT,
  codeChallengeMethod TEXT DEFAULT 'plain',
  expiresAt TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_tokens (
  id TEXT PRIMARY KEY,
  accessToken TEXT UNIQUE NOT NULL,
  refreshToken TEXT,
  clientId TEXT NOT NULL,
  userId TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'openid',
  expiresAt TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  revokedAt TEXT,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_token_user_client ON oauth_tokens(userId, clientId);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'general',
  description TEXT NOT NULL DEFAULT '',
  sensitive INTEGER NOT NULL DEFAULT 0,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS favicon_cache (
  origin TEXT PRIMARY KEY,
  dataUrl TEXT NOT NULL DEFAULT '',
  contentType TEXT NOT NULL DEFAULT 'image/x-icon',
  source TEXT NOT NULL DEFAULT '',
  fetchedAt TEXT NOT NULL,
  failedAttempts INTEGER NOT NULL DEFAULT 0,
  lastError TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS _meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
`;

function applySchema(db) {
  db.exec(SCHEMA);
}

// ────────────────────────────────────────────────────────────────────────────
// 版本化 Schema 迁移(H4)
// ────────────────────────────────────────────────────────────────────────────
// 用 SQLite 自带的 PRAGMA user_version 做全局版本号。每次升级代码时,只要在
// MIGRATIONS 数组末尾追加一个条目即可 —— 启动时 runMigrations 会比对当前
// user_version 与数组长度,把差值里的每一条按序跑一遍,成功后把 user_version
// 推到新值。全部包在事务里,任意一条失败都会整体回滚。
//
// 约定:
//   • 每条 migration 都是幂等风格 —— 能用 `IF NOT EXISTS` / `CREATE INDEX IF
//     NOT EXISTS` 就用;不能的就先 SELECT 一下确认再 ALTER。目的是:哪怕外
//     部手动补过 schema,再跑迁移也不会炸。
//   • up(db) 只拿到 better-sqlite3 句柄,直接 db.exec 或 prepare。不要在里面
//     引用别的业务模块,避免循环依赖。
//   • 绝对不要改已发布的 migration —— 加新版本的方式永远是在数组后追加。
//
// 当前版本:1
//   - 1 对应的就是 SCHEMA 常量里的基线表结构。因为 CREATE TABLE IF NOT EXISTS
//     在 applySchema 里已经保证存在,这一条其实是 no-op,仅用于把 user_version
//     从 0 推到 1,让后续新增迁移有一个基准锚点。
//
// 未来加新列 / 新索引的例子:
//   { version: 2, up(db) {
//       db.exec(`ALTER TABLE users ADD COLUMN phone TEXT NOT NULL DEFAULT ''`);
//       db.exec(`CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone)`);
//   } },
// ────────────────────────────────────────────────────────────────────────────
const MIGRATIONS = [
  { version: 1, up(_db) { /* 基线:由 SCHEMA 保证,空实现 */ } },
  // v2:数据库备份任务表
  // 为什么放在 migration 里而不是加到 SCHEMA:SCHEMA 是"从零建库的基线",
  // 而备份能力是后加的功能,已经上线的实例启动时会走 migration 路径拿到这张
  // 表。新库走 SCHEMA 建完基线后,runMigrations 同样会执行这条 —— 因为
  // CREATE TABLE IF NOT EXISTS 幂等,不会出问题。
  //
  // 字段说明:
  //   • status:'pending' | 'running' | 'success' | 'failed' | 'cancelled'
  //   • startedAt 是任务开始时间;finishedAt 是终态写入时间
  //   • bytes 是本次实际上传的字节数(压缩后大小),成功才有意义
  //   • remotePath 记录最终落在远端的绝对路径,方便排查
  //   • error 用来存失败原因。不存堆栈(可能泄露敏感路径),只留简短的一句话
  //   • triggeredBy:'admin:<userId>' 形式,标明是谁点的"备份"按钮
  { version: 2, up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS backup_jobs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'pending',
        startedAt TEXT NOT NULL,
        finishedAt TEXT,
        bytes INTEGER NOT NULL DEFAULT 0,
        remotePath TEXT NOT NULL DEFAULT '',
        error TEXT NOT NULL DEFAULT '',
        triggeredBy TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_backup_jobs_started ON backup_jobs(startedAt);
      CREATE INDEX IF NOT EXISTS idx_backup_jobs_status ON backup_jobs(status);
    `);
  } },
  // v3:OAuth refresh_token rotation + oauth_grants 唯一约束
  //
  // 3-a) oauth_tokens 扩列 —— 支持 refresh token rotation 与 reuse detection
  //   新列语义:
  //     • refreshTokenExpiresAt — refresh_token 的独立有效期(比 access_token
  //       长得多,默认 30 天)。access_token 到期时,客户端拿 refresh_token 换
  //       新的,整体会话可以持续到 refresh_token 到期才需重新走授权码流程。
  //     • parentTokenId — 本 token 由哪一条旧 token rotate 出来的;NULL 表示
  //       它是 authorization_code 直接兑换出来的根节点。用于链路追溯。
  //     • replaced — 表示"这个 token 已经被 rotate 出继任者",语义区别于
  //       revoked:
  //         - revoked = 1  → 主动吊销,不再有效
  //         - replaced = 1 → 被 rotate 用掉了,不再有效,但如果再看见有人
  //                          拿这个 refresh_token 来换 token,视为重放攻击
  //                          (RFC-9700 §4.14),应立即撤销整条链。
  //
  // 3-b) oauth_grants 去重 + 唯一约束
  //   业务代码(authorize/decide)一直把"每 (userId, clientId) 最多一条 grant"
  //   当成不变式在使用(先 findOne,有则 update,没有则 insert),但 schema 从
  //   未真的强制 —— 两次几乎同时的授权点击在 findOne/insert 之间竞态,就能造
  //   出重复行,后续 scope 合并、撤销、授权列表全部陷入未定义行为。
  //   这里先合并现有重复行的 scopes 到"最近使用"的那条,删掉其余,然后把索
  //   引换成 UNIQUE。之后的 upsert 就可以用 SQL 原子语义了。
  { version: 3, up(db) {
    db.exec(`
      ALTER TABLE oauth_tokens ADD COLUMN refreshTokenExpiresAt TEXT;
      ALTER TABLE oauth_tokens ADD COLUMN parentTokenId TEXT;
      ALTER TABLE oauth_tokens ADD COLUMN replaced INTEGER NOT NULL DEFAULT 0;
      CREATE INDEX IF NOT EXISTS idx_tokens_refresh ON oauth_tokens(refreshToken)
        WHERE refreshToken IS NOT NULL;
    `);

    // 先 dedup oauth_grants,再建唯一索引 —— 有已存在的重复就硬塞 UNIQUE 会报错
    const dupGroups = db.prepare(`
      SELECT userId, clientId FROM oauth_grants
      GROUP BY userId, clientId HAVING COUNT(*) > 1
    `).all();

    for (const g of dupGroups) {
      const rows = db.prepare(`
        SELECT id, scopes, revoked, lastUsedAt, grantedAt FROM oauth_grants
        WHERE userId = ? AND clientId = ?
        ORDER BY COALESCE(lastUsedAt, grantedAt) DESC, id ASC
      `).all(g.userId, g.clientId);

      const keep = rows[0];
      const merged = new Set();
      // 合并策略:scopes 取并集;revoked 只要有一条没撤销就保留为 active
      let revoked = 1;
      for (const r of rows) {
        try {
          const parsed = JSON.parse(r.scopes || '[]');
          if (Array.isArray(parsed)) parsed.forEach(s => merged.add(s));
        } catch { /* 坏的 JSON 直接跳过,不让一条脏数据阻塞迁移 */ }
        if (r.revoked !== 1) revoked = 0;
      }

      db.prepare(`UPDATE oauth_grants SET scopes = ?, revoked = ? WHERE id = ?`)
        .run(JSON.stringify([...merged]), revoked, keep.id);

      for (let i = 1; i < rows.length; i++) {
        db.prepare(`DELETE FROM oauth_grants WHERE id = ?`).run(rows[i].id);
      }
    }

    // 旧的非唯一索引 idx_grants_user_client 在有 UNIQUE 索引后没有独立价值了
    // (查询计划会优先选 UNIQUE),主动 DROP 以免两份索引都被维护。
    db.exec(`
      DROP INDEX IF EXISTS idx_grants_user_client;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_grants_user_client_unique
        ON oauth_grants(userId, clientId);
    `);
  } },
];

function runMigrations(db) {
  const current = db.pragma('user_version', { simple: true }) || 0;
  const target = MIGRATIONS.length > 0
    ? MIGRATIONS[MIGRATIONS.length - 1].version
    : 0;
  if (current >= target) return;

  const pending = MIGRATIONS.filter(m => m.version > current);
  const txn = db.transaction(() => {
    for (const m of pending) {
      try {
        m.up(db);
      } catch (err) {
        throw new Error(`[DB] migration v${m.version} 失败: ${err.message}`);
      }
      // 每条成功后立即推进 user_version,便于从中间版本继续
      db.pragma(`user_version = ${m.version}`);
    }
  });
  try {
    txn();
    console.log(`[DB] schema 已升级 v${current} → v${target}`);
  } catch (err) {
    console.error(err.message);
    throw err;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 首次启动时:把旧的 data/*.json 和日期分区文件迁移进 SQLite
// 迁移成功后写入 _meta('legacy_migrated','1'),之后永远不再重复。
// ────────────────────────────────────────────────────────────────────────────
function migrateLegacyData(db) {
  const marker = db.prepare('SELECT value FROM _meta WHERE key = ?').get('legacy_migrated');
  if (marker) return;

  const now = new Date().toISOString();
  const txn = db.transaction(() => {
    // ── 单文件 JSON 集合 ──
    migrateJsonArray(db, 'users.json', 'users', (u) => ({
      id: u.id || uuidv4(),
      email: u.email,
      passwordHash: u.passwordHash,
      name: u.name,
      role: u.role || 'user',
      status: u.status || 'active',
      emailVerified: u.emailVerified ? 1 : 0,
      bio: u.bio || '',
      avatar: u.avatar || '',
      lastLoginIp: u.lastLoginIp || null,
      lastLoginAt: u.lastLoginAt || null,
      passwordChangedAt: u.passwordChangedAt || null,
      createdAt: u.createdAt || now,
      updatedAt: u.updatedAt || now,
    }));
    migrateJsonArray(db, 'sections.json', 'sections', (s) => ({
      id: s.id || uuidv4(),
      name: s.name,
      slug: s.slug,
      description: s.description || '',
      order: s.order || 0,
      createdAt: s.createdAt || now,
      updatedAt: s.updatedAt || now,
    }));
    migrateJsonArray(db, 'cards.json', 'cards', (c) => ({
      id: c.id || uuidv4(),
      title: c.title,
      description: c.description || '',
      url: c.url,
      sectionId: c.sectionId || null,
      order: c.order || 0,
      permission: c.permission || 'public',
      createdAt: c.createdAt || now,
      updatedAt: c.updatedAt || now,
    }));
    migrateJsonArray(db, 'oauth_clients.json', 'oauth_clients', (c) => ({
      id: c.id || uuidv4(),
      clientId: c.clientId,
      clientSecretHash: c.clientSecretHash || '',
      name: c.name || c.clientId,
      description: c.description || '',
      homepageUrl: c.homepageUrl || '',
      logoUrl: c.logoUrl || '',
      minLevel: c.minLevel ?? 0,
      redirectUris: JSON.stringify(c.redirectUris || []),
      scopes: JSON.stringify(c.scopes || []),
      status: c.status || 'active',
      createdAt: c.createdAt || now,
      updatedAt: c.updatedAt || now,
    }));
    migrateJsonArray(db, 'oauth_grants.json', 'oauth_grants', (g) => ({
      id: g.id || uuidv4(),
      userId: g.userId,
      clientId: g.clientId,
      clientName: g.clientName || '',
      scopes: JSON.stringify(g.scopes || []),
      revoked: g.revoked ? 1 : 0,
      revokedAt: g.revokedAt || null,
      grantedAt: g.grantedAt || now,
      lastUsedAt: g.lastUsedAt || null,
      createdAt: g.createdAt || now,
      updatedAt: g.updatedAt || now,
    }));

    // ── 日期分区目录 ──
    migratePartitionedDir(db, 'login-history', 'login_history', (r) => ({
      id: r.id || uuidv4(),
      userId: r.userId || null,
      email: r.email || null,
      ip: r.ip || '',
      userAgent: r.userAgent || '',
      success: r.success ? 1 : 0,
      reason: r.reason || '',
      timestamp: r.timestamp || now,
    }));
    migratePartitionedDir(db, 'activity-log', 'activity_log', (r) => ({
      id: r.id || uuidv4(),
      userId: r.userId || null,
      username: r.username || '',
      email: r.email || '',
      action: r.action || '',
      detail: r.detail || '',
      target: r.target || null,
      ip: r.ip || '',
      meta: JSON.stringify(r.meta || {}),
      timestamp: r.timestamp || now,
    }));
    migratePartitionedDir(db, 'verification-codes', 'verification_codes', (r) => ({
      id: r.id || uuidv4(),
      email: r.email,
      code: r.code,
      type: r.type,
      ip: r.ip || null,
      meta: r.meta ? JSON.stringify(r.meta) : null,
      attempts: r.attempts || 0,
      used: r.used ? 1 : 0,
      expiresAt: r.expiresAt,
      createdAt: r.createdAt || now,
    }));
    migratePartitionedDir(db, 'oauth-codes', 'oauth_codes', (r) => ({
      id: r.id || uuidv4(),
      code: r.code,
      clientId: r.clientId,
      userId: r.userId,
      redirectUri: r.redirectUri,
      scope: r.scope || 'openid',
      codeChallenge: r.codeChallenge || null,
      codeChallengeMethod: r.codeChallengeMethod || 'plain',
      expiresAt: r.expiresAt,
      used: r.used ? 1 : 0,
      createdAt: r.createdAt || now,
    }));
    migratePartitionedDir(db, 'oauth-tokens', 'oauth_tokens', (r) => ({
      id: r.id || uuidv4(),
      accessToken: r.accessToken,
      refreshToken: r.refreshToken || null,
      clientId: r.clientId,
      userId: r.userId,
      scope: r.scope || 'openid',
      expiresAt: r.expiresAt,
      revoked: r.revoked ? 1 : 0,
      revokedAt: r.revokedAt || null,
      createdAt: r.createdAt || now,
    }));

    db.prepare('INSERT OR REPLACE INTO _meta(key,value) VALUES(?,?)').run('legacy_migrated', '1');
    db.prepare('INSERT OR REPLACE INTO _meta(key,value) VALUES(?,?)').run('migrated_at', now);
  });

  try { txn(); } catch (err) { console.error('[DB] legacy migration failed:', err.message); }
}

function migrateJsonArray(db, filename, table, mapper) {
  const p = path.join(DATA_DIR, filename);
  if (!fs.existsSync(p)) return;
  let arr;
  try { arr = JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return; }
  if (!Array.isArray(arr) || arr.length === 0) return;
  for (const item of arr) {
    const mapped = mapper(item);
    const cols = Object.keys(mapped);
    const placeholders = cols.map(() => '?').join(',');
    const quoted = cols.map(c => c === 'order' ? '"order"' : c).join(',');
    try {
      db.prepare(
        `INSERT OR IGNORE INTO ${table}(${quoted}) VALUES(${placeholders})`
      ).run(...cols.map(c => mapped[c]));
    } catch (e) {
      console.warn(`[DB] migrate ${filename} row skipped:`, e.message);
    }
  }
}

function migratePartitionedDir(db, dirname, table, mapper) {
  const dir = path.join(DATA_DIR, dirname);
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  for (const file of files) {
    let arr;
    try { arr = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8')); } catch { continue; }
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      const mapped = mapper(item);
      const cols = Object.keys(mapped);
      const placeholders = cols.map(() => '?').join(',');
      try {
        db.prepare(
          `INSERT OR IGNORE INTO ${table}(${cols.join(',')}) VALUES(${placeholders})`
        ).run(...cols.map(c => mapped[c]));
      } catch (e) {
        console.warn(`[DB] migrate ${dirname}/${file} row skipped:`, e.message);
      }
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 受管配置项:管理员在 /admin/settings 能看到与修改的全部键值对。
// ────────────────────────────────────────────────────────────────────────────
// 设计要点:
//   • 所有键的"唯一权威来源"是 settings 表;.env 只在 sync 时作为种子。
//   • 每次应用启动都会跑 syncManagedSettings —— 新增的键会自动落库(保值 INSERT OR
//     IGNORE),已存在的键仅同步它的 category/description/sensitive(元数据),
//     不动 value。这样代码里新增一个配置项,下一次启动就能在管理页面看见。
//   • OAuth 客户端的 client_secret 会根据 config/oauth-clients.js 自动注册为
//     敏感项,管理员可以直接在后台轮换,不用改 .env。
// ────────────────────────────────────────────────────────────────────────────
const CORE_MANAGED_SETTINGS = [
  // ── 通用 ──
  { key: 'SITE_NAME',   category: 'general', sensitive: 0, default: '栖枢',
    description: '平台名称(用于界面与邮件)' },
  { key: 'USER_ACTIVITY_LOG_CAP', category: 'general', sensitive: 0, default: '30',
    description: '个人中心能看到的行为日志最多条数(管理员不受限制)。-1 表示不限。' },

  // ── 认证与会话 ──
  { key: 'JWT_SECRET',  category: 'auth', sensitive: 1, default: '',
    description: 'JWT 签名密钥(至少 32 位随机字符串)。修改后所有登录会话立即失效。' },
  { key: 'ADMIN_EMAIL', category: 'auth', sensitive: 0, default: '',
    description: '初始管理员邮箱(仅 scripts/init.js 首次建库时使用,之后改不生效)' },
  { key: 'SESSION_EXPIRY_DAYS', category: 'auth', sensitive: 0, default: '7',
    description: '登录会话有效期(天)。改动只影响之后签发的新 token,区间 1~365。' },

  // ── 邮件服务 ──
  { key: 'RESEND_API_KEY', category: 'email', sensitive: 1, default: '',
    description: 'Resend 邮件服务 API Key。未填时进入开发模式:验证码直接在响应里回显。' },
  { key: 'RESEND_FROM',    category: 'email', sensitive: 0, default: '',
    description: 'Resend 发件人地址(如 noreply@your-domain.com)' },

  // ── 验证码策略 ──
  { key: 'VERIFICATION_CODE_EXPIRY_MINUTES', category: 'verification', sensitive: 0, default: '30',
    description: '邮箱验证码有效期(分钟)。适用于注册、忘密、修改密码等所有验证码类型。' },
  { key: 'VERIFICATION_CODE_MAX_ATTEMPTS',   category: 'verification', sensitive: 0, default: '5',
    description: '同一验证码最多可尝试的错误次数。超过即作废,必须重新发送。' },

  // ── OAuth ──
  { key: 'OAUTH_CODE_EXPIRY_MINUTES',  category: 'oauth', sensitive: 0, default: '10',
    description: 'OAuth authorization_code 有效期(分钟)。交换成 token 后即失效,建议 ≤ 10。' },
  { key: 'OAUTH_TOKEN_EXPIRY_SECONDS', category: 'oauth', sensitive: 0, default: '3600',
    description: 'OAuth access_token 有效期(秒)。默认 3600(1 小时)。' },
  { key: 'OAUTH_REFRESH_TOKEN_EXPIRY_DAYS', category: 'oauth', sensitive: 0, default: '30',
    description: 'OAuth refresh_token 有效期(天)。到期后客户端需重新走授权码流程。refresh_token 每次使用后立即轮换(RFC-9700),旧的失效。' },

  // ── 数据保留策略 ──
  { key: 'LOGIN_HISTORY_RETENTION_DAYS', category: 'retention', sensitive: 0, default: '30',
    description: '登录记录保留天数(0 表示立刻清空全部,-1 表示永久保留)' },
  { key: 'ACTIVITY_LOG_RETENTION_DAYS',  category: 'retention', sensitive: 0, default: '30',
    description: '行为日志保留天数(0 表示立刻清空全部,-1 表示永久保留)' },

  // ── 反滥用节流 ──
  // 每一类动作都有两个维度:按 IP 限,按邮箱(或用户)限。两维度各自独立判断。
  // MAX = 窗口期内允许的最大次数;WINDOW_MINUTES = 滑动窗口长度,单位分钟。
  { key: 'RL_LOGIN_IP_MAX',              category: 'ratelimit', sensitive: 0, default: '20',
    description: '【登录】同一 IP 每窗口期的最大尝试次数' },
  { key: 'RL_LOGIN_IP_WINDOW_MINUTES',   category: 'ratelimit', sensitive: 0, default: '1',
    description: '【登录】同一 IP 的节流窗口(分钟)' },
  { key: 'RL_LOGIN_EMAIL_MAX',           category: 'ratelimit', sensitive: 0, default: '10',
    description: '【登录】同一邮箱每窗口期的最大尝试次数' },
  { key: 'RL_LOGIN_EMAIL_WINDOW_MINUTES', category: 'ratelimit', sensitive: 0, default: '5',
    description: '【登录】同一邮箱的节流窗口(分钟)' },
  { key: 'RL_REGISTER_IP_MAX',           category: 'ratelimit', sensitive: 0, default: '10',
    description: '【注册】同一 IP 每窗口期的最大发码次数' },
  { key: 'RL_REGISTER_IP_WINDOW_MINUTES', category: 'ratelimit', sensitive: 0, default: '60',
    description: '【注册】同一 IP 的节流窗口(分钟)' },
  { key: 'RL_REGISTER_EMAIL_MAX',        category: 'ratelimit', sensitive: 0, default: '5',
    description: '【注册】同一邮箱每窗口期的最大发码次数' },
  { key: 'RL_REGISTER_EMAIL_WINDOW_MINUTES', category: 'ratelimit', sensitive: 0, default: '60',
    description: '【注册】同一邮箱的节流窗口(分钟)' },
  { key: 'RL_FORGOT_IP_MAX',             category: 'ratelimit', sensitive: 0, default: '20',
    description: '【忘记密码】同一 IP 每窗口期的最大发码次数' },
  { key: 'RL_FORGOT_IP_WINDOW_MINUTES',  category: 'ratelimit', sensitive: 0, default: '60',
    description: '【忘记密码】同一 IP 的节流窗口(分钟)' },
  { key: 'RL_FORGOT_EMAIL_MAX',          category: 'ratelimit', sensitive: 0, default: '5',
    description: '【忘记密码】同一邮箱每窗口期的最大发码次数' },
  { key: 'RL_FORGOT_EMAIL_WINDOW_MINUTES', category: 'ratelimit', sensitive: 0, default: '60',
    description: '【忘记密码】同一邮箱的节流窗口(分钟)' },
  { key: 'RL_RESET_PW_IP_MAX',           category: 'ratelimit', sensitive: 0, default: '20',
    description: '【重置密码】同一 IP 每窗口期的最大提交次数' },
  { key: 'RL_RESET_PW_IP_WINDOW_MINUTES', category: 'ratelimit', sensitive: 0, default: '60',
    description: '【重置密码】同一 IP 的节流窗口(分钟)' },
  { key: 'RL_CHANGE_PW_SEND_MAX',        category: 'ratelimit', sensitive: 0, default: '5',
    description: '【修改密码】同一用户每窗口期的最大发码次数' },
  { key: 'RL_CHANGE_PW_SEND_WINDOW_MINUTES', category: 'ratelimit', sensitive: 0, default: '60',
    description: '【修改密码】发码节流窗口(分钟)' },
  { key: 'RL_CHANGE_PW_SUBMIT_MAX',      category: 'ratelimit', sensitive: 0, default: '10',
    description: '【修改密码】同一用户每窗口期的最大提交次数' },
  { key: 'RL_CHANGE_PW_SUBMIT_WINDOW_MINUTES', category: 'ratelimit', sensitive: 0, default: '60',
    description: '【修改密码】提交节流窗口(分钟)' },
  { key: 'RL_VERIFY_EMAIL_IP_MAX',          category: 'ratelimit', sensitive: 0, default: '20',
    description: '【邮箱验证】同一 IP 每窗口期的最大提交(含验证+重发)次数' },
  { key: 'RL_VERIFY_EMAIL_IP_WINDOW_MINUTES', category: 'ratelimit', sensitive: 0, default: '10',
    description: '【邮箱验证】同一 IP 的节流窗口(分钟)' },
  { key: 'RL_VERIFY_EMAIL_EMAIL_MAX',       category: 'ratelimit', sensitive: 0, default: '10',
    description: '【邮箱验证】同一邮箱每窗口期的最大提交次数' },
  { key: 'RL_VERIFY_EMAIL_EMAIL_WINDOW_MINUTES', category: 'ratelimit', sensitive: 0, default: '10',
    description: '【邮箱验证】同一邮箱的节流窗口(分钟)' },

  // ── Cloudflare Turnstile(登录/注册/找回密码的机器人防护) ──
  // 启用后,这三类请求必须带上前端从 Turnstile widget 拿到的 token,服务端
  // 调 Cloudflare 的 siteverify 接口验证。默认打开 —— 但在 SITE_KEY 与
  // SECRET_KEY 都填好之前,lib/turnstile.js 的 isTurnstileEnabled() 会返回
  // false,因此"开关开了但没填 key"不会卡住任何人,只是没有实际保护。
  { key: 'TURNSTILE_ENABLED',   category: 'security', sensitive: 0, default: '1',
    description: 'Cloudflare Turnstile 开关(1=启用,0=关闭)。默认启用,但需要填写 SITE_KEY 与 SECRET_KEY 才生效。作用范围:登录、注册、找回密码。' },
  { key: 'TURNSTILE_SITE_KEY',  category: 'security', sensitive: 0, default: '',
    description: 'Cloudflare Turnstile 的 Site Key(公开,前端使用,形如 0x...)' },
  { key: 'TURNSTILE_SECRET_KEY', category: 'security', sensitive: 1, default: '',
    description: 'Cloudflare Turnstile 的 Secret Key(保密,后端调 siteverify 使用)' },

  // ── 数据库备份(SFTP 上传到远端) ──
  // 备份流程:在本地对 SQLite 做 online snapshot(.backup API,不会锁住
  // 业务),gzip 压缩,走 SFTP(SSH)上传到远端服务器指定目录。每次点击
  // "立即备份"会在 backup_jobs 表里留一条记录,管理页面展示历史与状态。
  //
  // BACKUP_ENABLED:1=启用,0=不启用。不启用时备份按钮灰掉,API 直接拒绝。
  // 认证方式 BACKUP_AUTH_METHOD:'password' | 'key'。key 比 password 安全,
  // 建议生产环境优先用 key。两者都要填时以 AUTH_METHOD 为准。
  // 私钥是多行 PEM 文本,settings 表用 TEXT 存完全没问题,只是注意在后台
  // 渲染时这一项不适合放在单行 input 里(见 admin/backup 页面的多行 textarea)。
  { key: 'BACKUP_ENABLED',        category: 'backup', sensitive: 0, default: '0',
    description: '数据库备份开关(1=启用,0=不启用)。启用前请填齐下面的服务器信息。' },
  { key: 'BACKUP_HOST',           category: 'backup', sensitive: 0, default: '',
    description: '备份服务器的 IP 或域名(如 backup.example.com 或 10.0.0.5)' },
  { key: 'BACKUP_PORT',           category: 'backup', sensitive: 0, default: '22',
    description: 'SFTP 端口,默认 22' },
  { key: 'BACKUP_USER',           category: 'backup', sensitive: 0, default: '',
    description: 'SFTP 登录用户名' },
  { key: 'BACKUP_AUTH_METHOD',    category: 'backup', sensitive: 0, default: 'password',
    description: '认证方式:password(用密码)或 key(用 SSH 私钥)' },
  { key: 'BACKUP_PASSWORD',       category: 'backup', sensitive: 1, default: '',
    description: 'SFTP 登录密码(仅当 AUTH_METHOD=password 时使用)' },
  { key: 'BACKUP_PRIVATE_KEY',    category: 'backup', sensitive: 1, default: '',
    description: 'SSH 私钥(PEM 文本,OpenSSH 或 RSA 格式;仅当 AUTH_METHOD=key 时使用)' },
  { key: 'BACKUP_PRIVATE_KEY_PASSPHRASE', category: 'backup', sensitive: 1, default: '',
    description: 'SSH 私钥的 passphrase(可选,私钥本身带口令时才需要)' },
  { key: 'BACKUP_REMOTE_DIR',     category: 'backup', sensitive: 0, default: '/var/backups/qishu',
    description: '远端保存目录的绝对路径。文件名由系统生成(qishu-YYYYMMDD-HHMMSS.db.gz)' },
  { key: 'BACKUP_HISTORY_KEEP',   category: 'backup', sensitive: 0, default: '50',
    description: '备份历史最多保留多少条记录(每次成功写一条),超出自动清理。0 表示不自动清理。' },
];

// 从 config/oauth-clients.js 动态派生出每个静态 OAuth 客户端的 secret 配置项。
// 这样管理员在 /admin/settings 的「OAuth 接入」分类下能直接看到并修改每个
// 客户端的 client_secret,不用再动 .env 或代码。
function buildOAuthClientSecrets() {
  return (STATIC_OAUTH_CLIENTS || [])
    .filter(c => c && c.secretEnv)
    .map(c => ({
      key: c.secretEnv,
      category: 'oauth',
      sensitive: 1,
      default: '',
      description: `OAuth 客户端「${c.name || c.clientId}」(clientId: ${c.clientId}) 的 client_secret。修改后立即生效,无需重启。`,
    }));
}

const MANAGED_SETTINGS = [...CORE_MANAGED_SETTINGS, ...buildOAuthClientSecrets()];

/**
 * 每次启动都会运行。幂等:
 *   • 对于新增的键:若 settings 表没有,按 env / default 种子一次
 *   • 对于已存在的键:仅同步 category/description/sensitive(元数据),不改 value
 *   • 对于已从代码中删除的键:不做任何事(管理员如需清理,去 /admin/database 处理)
 */
function syncManagedSettings(db) {
  const now = new Date().toISOString();
  const insertStmt = db.prepare(
    'INSERT OR IGNORE INTO settings(key,value,category,description,sensitive,updatedAt) VALUES(?,?,?,?,?,?)'
  );
  const updateMetaStmt = db.prepare(
    `UPDATE settings SET category = ?, description = ?, sensitive = ?
     WHERE key = ? AND (category != ? OR description != ? OR sensitive != ?)`
  );

  const txn = db.transaction(() => {
    for (const s of MANAGED_SETTINGS) {
      const envVal = process.env[s.key];
      const seed   = envVal ?? s.default ?? '';
      insertStmt.run(s.key, seed, s.category, s.description, s.sensitive, now);
      updateMetaStmt.run(
        s.category, s.description, s.sensitive,
        s.key,
        s.category, s.description, s.sensitive
      );
    }
    // 首次标记 —— 保留给可能关心"是否经过首次种子"的调用方
    db.prepare('INSERT OR IGNORE INTO _meta(key,value) VALUES(?,?)').run('env_migrated', '1');
  });
  try { txn(); } catch (err) { console.error('[DB] managed settings sync failed:', err.message); }
}

// ── 暴露给其他模块的 API ──
export const database = {
  /** 取原始 better-sqlite3 实例 —— 仅在低层模块使用 */
  get raw() { return getDB(); },

  /** prepare 快捷方式,内部带缓存 */
  prepare(sql) { return getDB().prepare(sql); },

  /** 一次性运行多条 SQL(无参数) */
  exec(sql) { return getDB().exec(sql); },

  /** 事务包装 */
  transaction(fn) { return getDB().transaction(fn); },
};

// 供迁移逻辑与 API 使用
export { MANAGED_SETTINGS };
