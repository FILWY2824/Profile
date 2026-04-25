// Package settings owns the runtime-configurable key/value store backed by
// the settings table. This is the only place in the code base that the admin
// UI can reach into — env vars are seed-only after first boot.
//
// Read performance matters: settings like rate-limit thresholds are read on
// every request. So we cache the whole table in memory (~30 keys × <1KB =
// <30KB), invalidated on any write from the /api/admin/settings handler.
package settings

import (
	"database/sql"
	"strconv"
	"sync"
	"time"
)

// ManagedKey is the declared definition of a settings row. Every key the
// app recognises lives in this slice; anything else the DB returns is
// treated as legacy and ignored for display, but kept for audit.
type ManagedKey struct {
	Key         string
	Category    string
	Sensitive   bool
	Default     string
	Description string
}

// Managed is the canonical list. Adding a new key means:
//  1) Append here with a sensible Default
//  2) Restart (SyncManaged idempotently seeds the DB row)
//  3) The /admin/settings UI automatically picks it up
//
// Removing a key means leaving it here with a "deprecated" description so
// admins don't panic when the DB still has the row; real cleanup is a DB
// migration.
var Managed = []ManagedKey{
	// ── general ──
	{Key: "SITE_NAME", Category: "general", Default: "栖枢",
		Description: "平台名称(显示在页面标题、邮件内)"},
	{Key: "USER_ACTIVITY_LOG_CAP", Category: "general", Default: "30",
		Description: "普通用户能查看的最近活动日志条数上限。-1 表示不限。"},

	// ── auth ──
	{Key: "SESSION_EXPIRY_DAYS", Category: "auth", Default: "7",
		Description: "登录会话有效期(天)。只对新登录生效,区间 1-365。"},

	// ── email ──
	{Key: "RESEND_API_KEY", Category: "email", Sensitive: true, Default: "",
		Description: "Resend API Key。留空进入开发模式:验证码直接回显到接口响应。"},
	{Key: "RESEND_FROM", Category: "email", Default: "",
		Description: "Resend 发件人地址(如 noreply@example.com)"},

	// ── verification ──
	{Key: "VERIFICATION_CODE_EXPIRY_MINUTES", Category: "verification", Default: "30",
		Description: "邮箱验证码有效期(分钟)"},
	{Key: "VERIFICATION_CODE_MAX_ATTEMPTS", Category: "verification", Default: "5",
		Description: "同一验证码最多可尝试的错误次数"},

	// ── oauth ──
	{Key: "OAUTH_CODE_EXPIRY_MINUTES", Category: "oauth", Default: "10",
		Description: "OAuth 授权码有效期(分钟),建议 ≤ 10"},
	{Key: "OAUTH_TOKEN_EXPIRY_SECONDS", Category: "oauth", Default: "3600",
		Description: "OAuth access_token 有效期(秒)"},
	{Key: "OAUTH_REFRESH_TOKEN_EXPIRY_DAYS", Category: "oauth", Default: "30",
		Description: "OAuth refresh_token 有效期(天)。每次使用后立即轮换(RFC-9700)"},

	// ── retention ──
	{Key: "LOGIN_HISTORY_RETENTION_DAYS", Category: "retention", Default: "30",
		Description: "登录历史保留天数(0 立刻清空;-1 永久保留)"},
	{Key: "ACTIVITY_LOG_RETENTION_DAYS", Category: "retention", Default: "30",
		Description: "活动日志保留天数(0 立刻清空;-1 永久保留)"},

	// ── ratelimit (condensed from the 20+ keys in v1) ──
	// Each pair: max per window in minutes. Two dimensions per action: by IP
	// and by email.
	{Key: "RL_LOGIN_IP_MAX", Category: "ratelimit", Default: "20", Description: "登录:单 IP 限额"},
	{Key: "RL_LOGIN_IP_WINDOW_MINUTES", Category: "ratelimit", Default: "1", Description: "登录:单 IP 限额窗口(分钟)"},
	{Key: "RL_LOGIN_EMAIL_MAX", Category: "ratelimit", Default: "10", Description: "登录:单邮箱限额"},
	{Key: "RL_LOGIN_EMAIL_WINDOW_MINUTES", Category: "ratelimit", Default: "5", Description: "登录:单邮箱限额窗口(分钟)"},
	{Key: "RL_REGISTER_IP_MAX", Category: "ratelimit", Default: "10", Description: "注册:单 IP 发码限额"},
	{Key: "RL_REGISTER_IP_WINDOW_MINUTES", Category: "ratelimit", Default: "60", Description: "注册:单 IP 发码窗口(分钟)"},
	{Key: "RL_REGISTER_EMAIL_MAX", Category: "ratelimit", Default: "5", Description: "注册:单邮箱发码限额"},
	{Key: "RL_REGISTER_EMAIL_WINDOW_MINUTES", Category: "ratelimit", Default: "60", Description: "注册:单邮箱发码窗口(分钟)"},
	{Key: "RL_FORGOT_IP_MAX", Category: "ratelimit", Default: "20", Description: "忘记密码:单 IP 发码限额"},
	{Key: "RL_FORGOT_IP_WINDOW_MINUTES", Category: "ratelimit", Default: "60", Description: "忘记密码:单 IP 发码窗口(分钟)"},
	{Key: "RL_FORGOT_EMAIL_MAX", Category: "ratelimit", Default: "5", Description: "忘记密码:单邮箱发码限额"},
	{Key: "RL_FORGOT_EMAIL_WINDOW_MINUTES", Category: "ratelimit", Default: "60", Description: "忘记密码:单邮箱发码窗口(分钟)"},

	// ── turnstile ──
	{Key: "TURNSTILE_ENABLED", Category: "security", Default: "0",
		Description: "Cloudflare Turnstile 开关(1/0)。关闭前提下无需填 key,打开后必须填齐。"},
	{Key: "TURNSTILE_SITE_KEY", Category: "security", Default: "",
		Description: "Cloudflare Turnstile Site Key(前端使用,公开)"},
	{Key: "TURNSTILE_SECRET_KEY", Category: "security", Sensitive: true, Default: "",
		Description: "Cloudflare Turnstile Secret Key(后端使用)"},
}

// Store is the handle handlers depend on. It hides the DB and the cache.
type Store struct {
	db *sql.DB

	mu    sync.RWMutex
	cache map[string]string
	loaded bool
}

func NewStore(db *sql.DB) *Store {
	return &Store{db: db, cache: make(map[string]string)}
}

// SyncManaged idempotently ensures every ManagedKey has a row with the
// expected category/description/sensitive metadata. Never overwrites Value.
// Called at boot. Seeds env-provided values on first run per key.
func (s *Store) SyncManaged(envVals map[string]string) error {
	now := time.Now().UTC().Format(time.RFC3339)
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	insertStmt, err := tx.Prepare(`
		INSERT OR IGNORE INTO settings(key, value, category, description, sensitive, updated_at)
		VALUES(?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	defer insertStmt.Close()

	updateMetaStmt, err := tx.Prepare(`
		UPDATE settings SET category = ?, description = ?, sensitive = ?
		WHERE key = ? AND (category != ? OR description != ? OR sensitive != ?)`)
	if err != nil {
		return err
	}
	defer updateMetaStmt.Close()

	for _, m := range Managed {
		seed := m.Default
		if v, ok := envVals[m.Key]; ok && v != "" {
			seed = v
		}
		sensitiveInt := 0
		if m.Sensitive {
			sensitiveInt = 1
		}
		if _, err := insertStmt.Exec(m.Key, seed, m.Category, m.Description, sensitiveInt, now); err != nil {
			return err
		}
		if _, err := updateMetaStmt.Exec(m.Category, m.Description, sensitiveInt, m.Key, m.Category, m.Description, sensitiveInt); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// loadIfNeeded pulls the full table into the cache. Cheap: one query, ~30
// rows. Called lazily from Get; tests can call directly to prime state.
func (s *Store) loadIfNeeded() error {
	s.mu.RLock()
	if s.loaded {
		s.mu.RUnlock()
		return nil
	}
	s.mu.RUnlock()

	rows, err := s.db.Query("SELECT key, value FROM settings")
	if err != nil {
		return err
	}
	defer rows.Close()

	s.mu.Lock()
	defer s.mu.Unlock()
	s.cache = make(map[string]string)
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return err
		}
		s.cache[k] = v
	}
	s.loaded = true
	return rows.Err()
}

// Get returns the value for key or the ManagedKey default if absent. Never
// errors — if the DB is broken we fall back to defaults rather than 500 on
// every request.
func (s *Store) Get(key string) string {
	_ = s.loadIfNeeded() // silent failure; see doc above
	s.mu.RLock()
	v, ok := s.cache[key]
	s.mu.RUnlock()
	if ok {
		return v
	}
	for _, m := range Managed {
		if m.Key == key {
			return m.Default
		}
	}
	return ""
}

// GetInt parses Get(key) as int, returning fallback on any error.
func (s *Store) GetInt(key string, fallback int) int {
	raw := s.Get(key)
	if raw == "" {
		return fallback
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return n
}

// GetBool treats "1", "true", "yes", "on" as true.
func (s *Store) GetBool(key string) bool {
	switch s.Get(key) {
	case "1", "true", "True", "TRUE", "yes", "on":
		return true
	}
	return false
}

// Set updates a single key and invalidates the cache. Intended to be called
// from the admin settings handler.
func (s *Store) Set(key, value string) error {
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := s.db.Exec(`UPDATE settings SET value = ?, updated_at = ? WHERE key = ?`, value, now, key)
	if err != nil {
		return err
	}
	s.mu.Lock()
	s.cache[key] = value
	s.mu.Unlock()
	return nil
}

// List returns every row, used by the admin UI. Sensitive values are
// returned as-is; handlers are responsible for masking on the wire.
func (s *Store) List() ([]Row, error) {
	rows, err := s.db.Query(`SELECT key, value, category, description, sensitive, updated_at FROM settings ORDER BY category, key`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Row
	for rows.Next() {
		var r Row
		var sensitiveInt int
		if err := rows.Scan(&r.Key, &r.Value, &r.Category, &r.Description, &sensitiveInt, &r.UpdatedAt); err != nil {
			return nil, err
		}
		r.Sensitive = sensitiveInt == 1
		out = append(out, r)
	}
	return out, rows.Err()
}

// Row is the projection the admin handler serialises out.
type Row struct {
	Key         string `json:"key"`
	Value       string `json:"value"`
	Category    string `json:"category"`
	Description string `json:"description"`
	Sensitive   bool   `json:"sensitive"`
	UpdatedAt   string `json:"updatedAt"`
}
