// oauth.go — repositories for the OAuth2 server tables.
//
// Hashing: access_token / refresh_token / code 全部以 SHA-256 hex 形式存储,
// 数据库泄露不会直接暴露有效凭据。校验时把传入的明文 hash 后等值比较。
//
// 原子操作:
//   - ConsumeCodeIfUnused(codeHash) -> 单条 UPDATE...WHERE used=0 + RowsAffected
//   - RotateRefresh(...) -> 单事务里 MarkReplaced + Insert,任一失败回滚
//
// 级联清理:
//   - DeleteTokensByUserID / DeleteTokensByClientID
//   - DeleteCodesByUserID  / DeleteCodesByClientID
//   - DeleteGrantsByUserID / DeleteGrantsByClientID
package repository

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
)

// HashOpaqueToken 用 SHA-256 hex 编码任意不可枚举的不透明 token。32B 随机
// 输入下,SHA-256 抵抗碰撞远超需要。
func HashOpaqueToken(plain string) string {
	sum := sha256.Sum256([]byte(plain))
	return hex.EncodeToString(sum[:])
}

// ─── Clients ──────────────────────────────────────────────────────────────

type OAuthClient struct {
	ID               string `json:"id"`
	ClientID         string `json:"clientId"`
	ClientSecretHash string `json:"-"`
	Name             string `json:"name"`
	Description      string `json:"description"`
	HomepageURL      string `json:"homepageUrl"`
	LogoURL          string `json:"logoUrl"`
	MinLevel         int    `json:"minLevel"`
	RedirectURIs     string `json:"redirectUris"`
	Scopes           string `json:"scopes"`
	Status           string `json:"status"`
	CreatedAt        string `json:"createdAt"`
	UpdatedAt        string `json:"updatedAt"`
}

type OAuthClientRepo struct{ db *sql.DB }

func NewOAuthClientRepo(db *sql.DB) *OAuthClientRepo { return &OAuthClientRepo{db: db} }

const oauthClientCols = `id, client_id, client_secret_hash, name, description,
                          homepage_url, logo_url, min_level, redirect_uris,
                          scopes, status, created_at, updated_at`

func scanOAuthClient(row interface{ Scan(dest ...any) error }) (*OAuthClient, error) {
	var c OAuthClient
	if err := row.Scan(&c.ID, &c.ClientID, &c.ClientSecretHash, &c.Name,
		&c.Description, &c.HomepageURL, &c.LogoURL, &c.MinLevel,
		&c.RedirectURIs, &c.Scopes, &c.Status, &c.CreatedAt, &c.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &c, nil
}

func (r *OAuthClientRepo) FindByID(id string) (*OAuthClient, error) {
	row := r.db.QueryRow(`SELECT `+oauthClientCols+` FROM oauth_clients WHERE id = ?`, id)
	return scanOAuthClient(row)
}

func (r *OAuthClientRepo) FindByClientID(clientID string) (*OAuthClient, error) {
	row := r.db.QueryRow(`SELECT `+oauthClientCols+` FROM oauth_clients WHERE client_id = ?`, clientID)
	return scanOAuthClient(row)
}

func (r *OAuthClientRepo) List() ([]OAuthClient, error) {
	rows, err := r.db.Query(`SELECT ` + oauthClientCols + ` FROM oauth_clients ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []OAuthClient
	for rows.Next() {
		c, err := scanOAuthClient(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

type OAuthClientInput struct {
	ClientID         string
	ClientSecretHash string
	Name             string
	Description      string
	HomepageURL      string
	LogoURL          string
	MinLevel         int
	RedirectURIs     string
	Scopes           string
	Status           string
}

func (r *OAuthClientRepo) Create(in OAuthClientInput) (*OAuthClient, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	id := uuid.NewString()
	if in.Status == "" {
		in.Status = "active"
	}
	if in.RedirectURIs == "" {
		in.RedirectURIs = "[]"
	}
	if in.Scopes == "" {
		in.Scopes = "[]"
	}
	_, err := r.db.Exec(`
		INSERT INTO oauth_clients (id, client_id, client_secret_hash, name,
		    description, homepage_url, logo_url, min_level, redirect_uris,
		    scopes, status, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, in.ClientID, in.ClientSecretHash, in.Name, in.Description,
		in.HomepageURL, in.LogoURL, in.MinLevel, in.RedirectURIs,
		in.Scopes, in.Status, now, now)
	if err != nil {
		return nil, err
	}
	return r.FindByID(id)
}

func (r *OAuthClientRepo) Update(id string, in OAuthClientInput) (*OAuthClient, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	res, err := r.db.Exec(`
		UPDATE oauth_clients SET name = ?, description = ?, homepage_url = ?,
		    logo_url = ?, min_level = ?, redirect_uris = ?, scopes = ?,
		    status = ?, updated_at = ?
		WHERE id = ?`,
		in.Name, in.Description, in.HomepageURL, in.LogoURL, in.MinLevel,
		in.RedirectURIs, in.Scopes, in.Status, now, id)
	if err != nil {
		return nil, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, ErrNotFound
	}
	return r.FindByID(id)
}

func (r *OAuthClientRepo) RotateSecret(id, newHash string) error {
	now := time.Now().UTC().Format(time.RFC3339)
	res, err := r.db.Exec(
		`UPDATE oauth_clients SET client_secret_hash = ?, updated_at = ? WHERE id = ?`,
		newHash, now, id,
	)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *OAuthClientRepo) Delete(id string) error {
	res, err := r.db.Exec(`DELETE FROM oauth_clients WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// ─── Authorization codes (hashed) ────────────────────────────────────────

type OAuthCode struct {
	ID                  string
	CodeHash            string
	ClientID            string
	UserID              string
	RedirectURI         string
	Scope               string
	CodeChallenge       string
	CodeChallengeMethod string
	ExpiresAt           string
	Used                bool
	CreatedAt           string
}

type OAuthCodeRepo struct{ db *sql.DB }

func NewOAuthCodeRepo(db *sql.DB) *OAuthCodeRepo { return &OAuthCodeRepo{db: db} }

type OAuthCodeInput struct {
	Code                string // 明文,本函数内做 hash
	ClientID            string
	UserID              string
	RedirectURI         string
	Scope               string
	CodeChallenge       string
	CodeChallengeMethod string
	ExpiresAt           time.Time
}

func (r *OAuthCodeRepo) Create(in OAuthCodeInput) (*OAuthCode, error) {
	id := uuid.NewString()
	now := time.Now().UTC().Format(time.RFC3339)
	if in.Scope == "" {
		in.Scope = "openid"
	}
	if in.CodeChallengeMethod == "" {
		in.CodeChallengeMethod = "S256"
	}
	hash := HashOpaqueToken(in.Code)
	_, err := r.db.Exec(`
		INSERT INTO oauth_codes (id, code_hash, client_id, user_id, redirect_uri,
		    scope, code_challenge, code_challenge_method, expires_at, used, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
		id, hash, in.ClientID, in.UserID, in.RedirectURI, in.Scope,
		in.CodeChallenge, in.CodeChallengeMethod,
		in.ExpiresAt.UTC().Format(time.RFC3339), now)
	if err != nil {
		return nil, err
	}
	return r.findByID(id)
}

func (r *OAuthCodeRepo) findByID(id string) (*OAuthCode, error) {
	row := r.db.QueryRow(`
		SELECT id, code_hash, client_id, user_id, redirect_uri, scope,
		       code_challenge, code_challenge_method, expires_at, used, created_at
		FROM oauth_codes WHERE id = ?`, id)
	var c OAuthCode
	var used int
	if err := row.Scan(&c.ID, &c.CodeHash, &c.ClientID, &c.UserID, &c.RedirectURI,
		&c.Scope, &c.CodeChallenge, &c.CodeChallengeMethod, &c.ExpiresAt,
		&used, &c.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	c.Used = used == 1
	return &c, nil
}

// FindByPlainCode 用明文反查(SHA-256 hash 比较)。
func (r *OAuthCodeRepo) FindByPlainCode(plain string) (*OAuthCode, error) {
	hash := HashOpaqueToken(plain)
	row := r.db.QueryRow(`
		SELECT id, code_hash, client_id, user_id, redirect_uri, scope,
		       code_challenge, code_challenge_method, expires_at, used, created_at
		FROM oauth_codes WHERE code_hash = ?`, hash)
	var c OAuthCode
	var used int
	if err := row.Scan(&c.ID, &c.CodeHash, &c.ClientID, &c.UserID, &c.RedirectURI,
		&c.Scope, &c.CodeChallenge, &c.CodeChallengeMethod, &c.ExpiresAt,
		&used, &c.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	c.Used = used == 1
	return &c, nil
}

// ConsumeIfUnused 原子标记 used=1。返回是否本次调用真的消费成功。
// 这是修复"OAuth code 消费不是原子操作"的关键 — 之前是 SELECT...UPDATE 两
// 步,可被并发请求两次都通过 SELECT 后再各自 UPDATE,造成重放。
func (r *OAuthCodeRepo) ConsumeIfUnused(id string) (bool, error) {
	res, err := r.db.Exec(`UPDATE oauth_codes SET used = 1 WHERE id = ? AND used = 0`, id)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n == 1, nil
}

func (r *OAuthCodeRepo) PruneExpired() (int64, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	res, err := r.db.Exec(
		`DELETE FROM oauth_codes WHERE used = 1 OR expires_at < ?`, now)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// 级联清理:删除用户/客户端时调用
func (r *OAuthCodeRepo) DeleteByUserID(userID string) (int64, error) {
	res, err := r.db.Exec(`DELETE FROM oauth_codes WHERE user_id = ?`, userID)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

func (r *OAuthCodeRepo) DeleteByClientID(clientID string) (int64, error) {
	res, err := r.db.Exec(`DELETE FROM oauth_codes WHERE client_id = ?`, clientID)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// ─── Access + refresh tokens (hashed) ────────────────────────────────────

type OAuthToken struct {
	ID                    string
	AccessTokenHash       string
	RefreshTokenHash      string
	ClientID              string
	UserID                string
	Scope                 string
	ExpiresAt             string
	RefreshTokenExpiresAt string
	ParentTokenID         string
	Replaced              bool
	Revoked               bool
	RevokedAt             string
	CreatedAt             string
}

type OAuthTokenRepo struct{ db *sql.DB }

func NewOAuthTokenRepo(db *sql.DB) *OAuthTokenRepo { return &OAuthTokenRepo{db: db} }

type OAuthTokenInput struct {
	AccessToken           string // 明文
	RefreshToken          string // 明文,可空
	ClientID              string
	UserID                string
	Scope                 string
	ExpiresAt             time.Time
	RefreshTokenExpiresAt time.Time
	ParentTokenID         string
}

func (r *OAuthTokenRepo) Create(in OAuthTokenInput) (*OAuthToken, error) {
	id := uuid.NewString()
	now := time.Now().UTC().Format(time.RFC3339)
	accessHash := HashOpaqueToken(in.AccessToken)
	var refreshHash sql.NullString
	if in.RefreshToken != "" {
		refreshHash = sql.NullString{String: HashOpaqueToken(in.RefreshToken), Valid: true}
	}
	var refreshExpiry sql.NullString
	if !in.RefreshTokenExpiresAt.IsZero() {
		refreshExpiry = sql.NullString{
			String: in.RefreshTokenExpiresAt.UTC().Format(time.RFC3339), Valid: true,
		}
	}
	var parent sql.NullString
	if in.ParentTokenID != "" {
		parent = sql.NullString{String: in.ParentTokenID, Valid: true}
	}
	_, err := r.db.Exec(`
		INSERT INTO oauth_tokens (id, access_token_hash, refresh_token_hash, client_id,
		    user_id, scope, expires_at, refresh_token_expires_at,
		    parent_token_id, replaced, revoked, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`,
		id, accessHash, refreshHash, in.ClientID, in.UserID, in.Scope,
		in.ExpiresAt.UTC().Format(time.RFC3339), refreshExpiry, parent, now)
	if err != nil {
		return nil, err
	}
	return r.findByID(id)
}

const oauthTokenCols = `id, access_token_hash, COALESCE(refresh_token_hash, ''), client_id, user_id,
                        scope, expires_at, COALESCE(refresh_token_expires_at, ''),
                        COALESCE(parent_token_id, ''), replaced, revoked,
                        COALESCE(revoked_at, ''), created_at`

func scanOAuthToken(row interface{ Scan(dest ...any) error }) (*OAuthToken, error) {
	var t OAuthToken
	var replaced, revoked int
	if err := row.Scan(&t.ID, &t.AccessTokenHash, &t.RefreshTokenHash, &t.ClientID,
		&t.UserID, &t.Scope, &t.ExpiresAt, &t.RefreshTokenExpiresAt,
		&t.ParentTokenID, &replaced, &revoked, &t.RevokedAt, &t.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	t.Replaced = replaced == 1
	t.Revoked = revoked == 1
	return &t, nil
}

func (r *OAuthTokenRepo) findByID(id string) (*OAuthToken, error) {
	row := r.db.QueryRow(`SELECT `+oauthTokenCols+` FROM oauth_tokens WHERE id = ?`, id)
	return scanOAuthToken(row)
}

// FindByPlainAccessToken 通过明文反查 token 行(SHA-256 hash 等值)。
func (r *OAuthTokenRepo) FindByPlainAccessToken(plain string) (*OAuthToken, error) {
	hash := HashOpaqueToken(plain)
	row := r.db.QueryRow(`SELECT `+oauthTokenCols+` FROM oauth_tokens WHERE access_token_hash = ?`, hash)
	return scanOAuthToken(row)
}

func (r *OAuthTokenRepo) FindByPlainRefreshToken(plain string) (*OAuthToken, error) {
	hash := HashOpaqueToken(plain)
	row := r.db.QueryRow(`SELECT `+oauthTokenCols+` FROM oauth_tokens WHERE refresh_token_hash = ?`, hash)
	return scanOAuthToken(row)
}

// RotateRefresh 在单事务里:校验 old.replaced=0 -> 标记 replaced -> 插入新 token。
// 这是修复"refresh token 轮换不是原子操作"的关键。
func (r *OAuthTokenRepo) RotateRefresh(oldID string, in OAuthTokenInput) (*OAuthToken, error) {
	tx, err := r.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	// 1) 标记 old replaced=1,但前提条件 replaced=0 AND revoked=0,RowsAffected=1
	res, err := tx.Exec(`UPDATE oauth_tokens SET replaced = 1
		WHERE id = ? AND replaced = 0 AND revoked = 0`, oldID)
	if err != nil {
		return nil, err
	}
	n, _ := res.RowsAffected()
	if n != 1 {
		return nil, errors.New("refresh token already rotated or revoked")
	}

	// 2) 插入新 token,parent_token_id 指向 old
	id := uuid.NewString()
	now := time.Now().UTC().Format(time.RFC3339)
	accessHash := HashOpaqueToken(in.AccessToken)
	var refreshHash sql.NullString
	if in.RefreshToken != "" {
		refreshHash = sql.NullString{String: HashOpaqueToken(in.RefreshToken), Valid: true}
	}
	var refreshExpiry sql.NullString
	if !in.RefreshTokenExpiresAt.IsZero() {
		refreshExpiry = sql.NullString{
			String: in.RefreshTokenExpiresAt.UTC().Format(time.RFC3339), Valid: true,
		}
	}
	parent := sql.NullString{String: oldID, Valid: true}
	if _, err := tx.Exec(`
		INSERT INTO oauth_tokens (id, access_token_hash, refresh_token_hash, client_id,
		    user_id, scope, expires_at, refresh_token_expires_at,
		    parent_token_id, replaced, revoked, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`,
		id, accessHash, refreshHash, in.ClientID, in.UserID, in.Scope,
		in.ExpiresAt.UTC().Format(time.RFC3339), refreshExpiry, parent, now); err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return r.findByID(id)
}

func (r *OAuthTokenRepo) Revoke(id string) error {
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := r.db.Exec(
		`UPDATE oauth_tokens SET revoked = 1, revoked_at = ? WHERE id = ?`,
		now, id,
	)
	return err
}

// RevokeChain 与之前一样,撤销整条 parent_token_id 链。
func (r *OAuthTokenRepo) RevokeChain(startID string) (int, error) {
	visited := map[string]bool{startID: true}
	current := startID
	for {
		var parent sql.NullString
		err := r.db.QueryRow(
			`SELECT parent_token_id FROM oauth_tokens WHERE id = ?`, current,
		).Scan(&parent)
		if err != nil || !parent.Valid || parent.String == "" || visited[parent.String] {
			break
		}
		visited[parent.String] = true
		current = parent.String
	}
	queue := make([]string, 0, len(visited))
	for id := range visited {
		queue = append(queue, id)
	}
	for len(queue) > 0 {
		head := queue[0]
		queue = queue[1:]
		rows, err := r.db.Query(
			`SELECT id FROM oauth_tokens WHERE parent_token_id = ?`, head,
		)
		if err != nil {
			return 0, err
		}
		var children []string
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return 0, err
			}
			if !visited[id] {
				visited[id] = true
				children = append(children, id)
			}
		}
		rows.Close()
		queue = append(queue, children...)
	}
	now := time.Now().UTC().Format(time.RFC3339)
	for id := range visited {
		if _, err := r.db.Exec(
			`UPDATE oauth_tokens SET revoked = 1, revoked_at = ? WHERE id = ?`,
			now, id,
		); err != nil {
			return 0, err
		}
	}
	return len(visited), nil
}

func (r *OAuthTokenRepo) RevokeByUserClient(userID, clientID string) (int64, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	res, err := r.db.Exec(
		`UPDATE oauth_tokens SET revoked = 1, revoked_at = ?
		 WHERE user_id = ? AND client_id = ? AND revoked = 0`,
		now, userID, clientID,
	)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

func (r *OAuthTokenRepo) PruneExpired() (int64, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	res, err := r.db.Exec(`
		DELETE FROM oauth_tokens
		WHERE (revoked = 1 AND revoked_at < ?)
		   OR (replaced = 1 AND created_at < ?)
		   OR (expires_at < ? AND COALESCE(refresh_token_expires_at, '') < ?)`,
		time.Now().Add(-7*24*time.Hour).UTC().Format(time.RFC3339),
		time.Now().Add(-7*24*time.Hour).UTC().Format(time.RFC3339),
		now, now)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

func (r *OAuthTokenRepo) DeleteByUserID(userID string) (int64, error) {
	res, err := r.db.Exec(`DELETE FROM oauth_tokens WHERE user_id = ?`, userID)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

func (r *OAuthTokenRepo) DeleteByClientID(clientID string) (int64, error) {
	res, err := r.db.Exec(`DELETE FROM oauth_tokens WHERE client_id = ?`, clientID)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// ─── Grants ──────────────────────────────────────────────────────────────

type OAuthGrant struct {
	ID         string `json:"id"`
	UserID     string `json:"userId"`
	ClientID   string `json:"clientId"`
	ClientName string `json:"clientName"`
	Scopes     string `json:"scopes"`
	Revoked    bool   `json:"revoked"`
	RevokedAt  string `json:"revokedAt,omitempty"`
	GrantedAt  string `json:"grantedAt"`
	LastUsedAt string `json:"lastUsedAt,omitempty"`
	CreatedAt  string `json:"createdAt"`
	UpdatedAt  string `json:"updatedAt"`
}

type OAuthGrantRepo struct{ db *sql.DB }

func NewOAuthGrantRepo(db *sql.DB) *OAuthGrantRepo { return &OAuthGrantRepo{db: db} }

func (r *OAuthGrantRepo) Upsert(userID, clientID, clientName, scopesJSON string) error {
	now := time.Now().UTC().Format(time.RFC3339)
	id := uuid.NewString()
	_, err := r.db.Exec(`
		INSERT INTO oauth_grants (id, user_id, client_id, client_name, scopes,
		    revoked, granted_at, last_used_at, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
		ON CONFLICT(user_id, client_id) DO UPDATE SET
		    client_name = excluded.client_name,
		    scopes = excluded.scopes,
		    revoked = 0,
		    revoked_at = NULL,
		    last_used_at = excluded.last_used_at,
		    updated_at = excluded.updated_at`,
		id, userID, clientID, clientName, scopesJSON, now, now, now, now)
	return err
}

func (r *OAuthGrantRepo) FindByUserClient(userID, clientID string) (*OAuthGrant, error) {
	row := r.db.QueryRow(`
		SELECT id, user_id, client_id, client_name, scopes, revoked,
		       COALESCE(revoked_at, ''), granted_at, COALESCE(last_used_at, ''),
		       created_at, updated_at
		FROM oauth_grants WHERE user_id = ? AND client_id = ?`, userID, clientID)
	var g OAuthGrant
	var revoked int
	if err := row.Scan(&g.ID, &g.UserID, &g.ClientID, &g.ClientName, &g.Scopes,
		&revoked, &g.RevokedAt, &g.GrantedAt, &g.LastUsedAt,
		&g.CreatedAt, &g.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	g.Revoked = revoked == 1
	return &g, nil
}

func (r *OAuthGrantRepo) ListByUser(userID string) ([]OAuthGrant, error) {
	rows, err := r.db.Query(`
		SELECT id, user_id, client_id, client_name, scopes, revoked,
		       COALESCE(revoked_at, ''), granted_at, COALESCE(last_used_at, ''),
		       created_at, updated_at
		FROM oauth_grants WHERE user_id = ? AND revoked = 0
		ORDER BY last_used_at DESC, granted_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []OAuthGrant
	for rows.Next() {
		var g OAuthGrant
		var revoked int
		if err := rows.Scan(&g.ID, &g.UserID, &g.ClientID, &g.ClientName,
			&g.Scopes, &revoked, &g.RevokedAt, &g.GrantedAt, &g.LastUsedAt,
			&g.CreatedAt, &g.UpdatedAt); err != nil {
			return nil, err
		}
		g.Revoked = revoked == 1
		out = append(out, g)
	}
	return out, rows.Err()
}

func (r *OAuthGrantRepo) Revoke(id string) error {
	now := time.Now().UTC().Format(time.RFC3339)
	res, err := r.db.Exec(
		`UPDATE oauth_grants SET revoked = 1, revoked_at = ?, updated_at = ? WHERE id = ?`,
		now, now, id,
	)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *OAuthGrantRepo) UpdateLastUsed(userID, clientID string) error {
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := r.db.Exec(
		`UPDATE oauth_grants SET last_used_at = ?, updated_at = ?
		 WHERE user_id = ? AND client_id = ?`,
		now, now, userID, clientID,
	)
	return err
}

func (r *OAuthGrantRepo) DeleteByUserID(userID string) (int64, error) {
	res, err := r.db.Exec(`DELETE FROM oauth_grants WHERE user_id = ?`, userID)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

func (r *OAuthGrantRepo) DeleteByClientID(clientID string) (int64, error) {
	res, err := r.db.Exec(`DELETE FROM oauth_grants WHERE client_id = ?`, clientID)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// ScopesIntersect returns the requested scopes that are also in allowed.
func ScopesIntersect(requested, allowed []string) []string {
	allow := make(map[string]bool, len(allowed))
	for _, s := range allowed {
		allow[s] = true
	}
	out := make([]string, 0, len(requested))
	seen := make(map[string]bool, len(requested))
	for _, s := range requested {
		s = strings.TrimSpace(s)
		if s == "" || seen[s] || !allow[s] {
			continue
		}
		seen[s] = true
		out = append(out, s)
	}
	return out
}
