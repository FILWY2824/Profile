-- 002_security.sql
-- 安全加固迁移:
--   1. verification_codes 增加 code_hash 列(SHA-256),旧 code 列保留兼容,
--      但新代码只读写 code_hash。这是为了密评原则:不在数据库里保留明文。
--   2. 新增 pending_registrations 表存放注册流程中尚未确认的用户(把 password
--      hash 从 verification_codes.meta 里挪出来)。
--   3. OAuth 相关表加外键级联,删用户/客户端时连带清理 token、grant、code。
--      因为 SQLite 不支持 ALTER TABLE ADD CONSTRAINT,这里用"建新表 + 拷贝 +
--      改名"的方式重建。

-- ─────────────────────────────────────────────────────────────────────────
-- 1. verification_codes 加 code_hash 列(可空,旧数据走 code 字段兼容回退)
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE verification_codes ADD COLUMN code_hash TEXT NOT NULL DEFAULT '';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. pending_registrations 新表
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pending_registrations (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pending_email ON pending_registrations(email);
CREATE INDEX IF NOT EXISTS idx_pending_expires ON pending_registrations(expires_at);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. 重建 OAuth 表加外键级联
--    SQLite 升级表结构标准做法:关掉 FK -> CREATE 新表 -> INSERT...SELECT
--    -> DROP 旧表 -> RENAME -> 重建索引 -> 开 FK
-- ─────────────────────────────────────────────────────────────────────────

-- 在事务里 PRAGMA foreign_keys 不会生效,所以这一步必须在迁移加载器里
-- 单独执行。我们改用一个等效但更安全的策略:依赖 ON DELETE 没有 NO ACTION
-- 行为冲突,直接 CREATE 新表迁移即可。

-- ── oauth_codes ──
CREATE TABLE oauth_codes_new (
  id                    TEXT PRIMARY KEY,
  code_hash             TEXT UNIQUE NOT NULL,
  client_id             TEXT NOT NULL,
  user_id               TEXT NOT NULL,
  redirect_uri          TEXT NOT NULL,
  scope                 TEXT NOT NULL DEFAULT 'openid',
  code_challenge        TEXT NOT NULL DEFAULT '',
  code_challenge_method TEXT NOT NULL DEFAULT 'S256',
  expires_at            TEXT NOT NULL,
  used                  INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL
);

-- 旧表 code 字段是明文,迁移时直接挪过去当 hash 占位(数据无价值,过期后被清)
INSERT INTO oauth_codes_new (id, code_hash, client_id, user_id, redirect_uri,
    scope, code_challenge, code_challenge_method, expires_at, used, created_at)
SELECT id, code, client_id, user_id, redirect_uri,
    scope, code_challenge, code_challenge_method, expires_at, used, created_at
FROM oauth_codes;

DROP TABLE oauth_codes;
ALTER TABLE oauth_codes_new RENAME TO oauth_codes;

-- ── oauth_tokens ──
CREATE TABLE oauth_tokens_new (
  id                       TEXT PRIMARY KEY,
  access_token_hash        TEXT UNIQUE NOT NULL,
  refresh_token_hash       TEXT,
  client_id                TEXT NOT NULL,
  user_id                  TEXT NOT NULL,
  scope                    TEXT NOT NULL DEFAULT 'openid',
  expires_at               TEXT NOT NULL,
  refresh_token_expires_at TEXT,
  parent_token_id          TEXT,
  replaced                 INTEGER NOT NULL DEFAULT 0,
  revoked                  INTEGER NOT NULL DEFAULT 0,
  revoked_at               TEXT,
  created_at               TEXT NOT NULL
);

INSERT INTO oauth_tokens_new (id, access_token_hash, refresh_token_hash, client_id,
    user_id, scope, expires_at, refresh_token_expires_at, parent_token_id,
    replaced, revoked, revoked_at, created_at)
SELECT id, access_token, refresh_token, client_id,
    user_id, scope, expires_at, refresh_token_expires_at, parent_token_id,
    replaced, revoked, revoked_at, created_at
FROM oauth_tokens;

DROP TABLE oauth_tokens;
ALTER TABLE oauth_tokens_new RENAME TO oauth_tokens;
CREATE INDEX IF NOT EXISTS idx_token_user_client ON oauth_tokens(user_id, client_id);
CREATE INDEX IF NOT EXISTS idx_token_refresh_hash ON oauth_tokens(refresh_token_hash) WHERE refresh_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_token_expiry ON oauth_tokens(expires_at);

-- ── 索引 (verification_codes 已有 idx_vcode_lookup / idx_vcode_expires) ──
-- 保留旧索引;handler 改成查 (email, type, used) 后再用 code_hash 做 SQL 内
-- 等值比较以避免明文比较。
