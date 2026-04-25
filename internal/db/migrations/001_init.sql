-- 001_init.sql
-- Baseline schema. Everything subsequent goes as a new numbered file.
-- All TEXT timestamps are ISO8601 UTC (RFC3339 millis). All booleans are
-- INTEGER 0/1 because SQLite has no native bool type.

CREATE TABLE IF NOT EXISTS users (
  id                 TEXT PRIMARY KEY,
  email              TEXT UNIQUE NOT NULL,
  password_hash      TEXT NOT NULL,
  name               TEXT NOT NULL,
  role               TEXT NOT NULL DEFAULT 'user',    -- user | member | admin
  status             TEXT NOT NULL DEFAULT 'active',  -- active | banned | disabled
  email_verified     INTEGER NOT NULL DEFAULT 0,
  bio                TEXT NOT NULL DEFAULT '',
  avatar             TEXT NOT NULL DEFAULT '',
  last_login_ip      TEXT NOT NULL DEFAULT '',
  last_login_at      TEXT,
  password_changed_at TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_role   ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

CREATE TABLE IF NOT EXISTS sections (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT UNIQUE NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cards (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  url         TEXT NOT NULL,
  section_id  TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  permission  TEXT NOT NULL DEFAULT 'public',  -- public | user | member | admin
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_cards_section ON cards(section_id);

CREATE TABLE IF NOT EXISTS verification_codes (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  code       TEXT NOT NULL,
  type       TEXT NOT NULL,  -- register | email_verify | forgot_password | change_password
  ip         TEXT NOT NULL DEFAULT '',
  meta       TEXT NOT NULL DEFAULT '{}',
  attempts   INTEGER NOT NULL DEFAULT 0,
  used       INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vcode_lookup  ON verification_codes(email, type, used);
CREATE INDEX IF NOT EXISTS idx_vcode_expires ON verification_codes(expires_at);

CREATE TABLE IF NOT EXISTS login_history (
  id         TEXT PRIMARY KEY,
  user_id    TEXT,
  email      TEXT NOT NULL DEFAULT '',
  ip         TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  success    INTEGER NOT NULL,
  reason     TEXT NOT NULL DEFAULT '',
  timestamp  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_user_ts ON login_history(user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_login_ts      ON login_history(timestamp DESC);

CREATE TABLE IF NOT EXISTS activity_log (
  id        TEXT PRIMARY KEY,
  user_id   TEXT,
  username  TEXT NOT NULL DEFAULT '',
  email     TEXT NOT NULL DEFAULT '',
  action    TEXT NOT NULL,
  detail    TEXT NOT NULL DEFAULT '',
  target    TEXT NOT NULL DEFAULT '',
  ip        TEXT NOT NULL DEFAULT '',
  meta      TEXT NOT NULL DEFAULT '{}',
  timestamp TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_user_ts ON activity_log(user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_activity_ts      ON activity_log(timestamp DESC);

CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL DEFAULT '',
  category    TEXT NOT NULL DEFAULT 'general',
  description TEXT NOT NULL DEFAULT '',
  sensitive   INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS favicon_cache (
  origin            TEXT PRIMARY KEY,
  data_url          TEXT NOT NULL DEFAULT '',
  content_type      TEXT NOT NULL DEFAULT 'image/x-icon',
  source            TEXT NOT NULL DEFAULT '',
  fetched_at        TEXT NOT NULL,
  failed_attempts   INTEGER NOT NULL DEFAULT 0,
  last_error        TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS oauth_clients (
  id                  TEXT PRIMARY KEY,
  client_id           TEXT UNIQUE NOT NULL,
  client_secret_hash  TEXT NOT NULL,
  name                TEXT NOT NULL,
  description         TEXT NOT NULL DEFAULT '',
  homepage_url        TEXT NOT NULL DEFAULT '',
  logo_url            TEXT NOT NULL DEFAULT '',
  min_level           INTEGER NOT NULL DEFAULT 0,
  redirect_uris       TEXT NOT NULL DEFAULT '[]',  -- JSON array
  scopes              TEXT NOT NULL DEFAULT '[]',  -- JSON array
  status              TEXT NOT NULL DEFAULT 'active',
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_grants (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  client_id    TEXT NOT NULL,
  client_name  TEXT NOT NULL DEFAULT '',
  scopes       TEXT NOT NULL DEFAULT '[]',
  revoked      INTEGER NOT NULL DEFAULT 0,
  revoked_at   TEXT,
  granted_at   TEXT NOT NULL,
  last_used_at TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_grants_user_client_unique ON oauth_grants(user_id, client_id);

CREATE TABLE IF NOT EXISTS oauth_codes (
  id                    TEXT PRIMARY KEY,
  code                  TEXT UNIQUE NOT NULL,
  client_id             TEXT NOT NULL,
  user_id               TEXT NOT NULL,
  redirect_uri          TEXT NOT NULL,
  scope                 TEXT NOT NULL DEFAULT 'openid',
  code_challenge        TEXT NOT NULL DEFAULT '',
  code_challenge_method TEXT NOT NULL DEFAULT 'plain',
  expires_at            TEXT NOT NULL,
  used                  INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_tokens (
  id                       TEXT PRIMARY KEY,
  access_token             TEXT UNIQUE NOT NULL,
  refresh_token            TEXT,
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
CREATE INDEX IF NOT EXISTS idx_token_user_client ON oauth_tokens(user_id, client_id);
CREATE INDEX IF NOT EXISTS idx_token_refresh     ON oauth_tokens(refresh_token) WHERE refresh_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS _meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
