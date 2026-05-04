// oauth.go — OAuth2 server endpoints. 修复列表:
//
//   1. appendQuery 改用 net/url.Values 编码,杜绝注入
//   2. 只接受 PKCE S256(删 plain 分支)
//   3. 用户拒绝授权前先校验 redirect_uri 是否在 client 登记表(防开放重定向)
//   4. authorization code 消费走 ConsumeIfUnused 原子操作
//   5. refresh token 轮换走 RotateRefresh 单事务
//   6. introspect 对 refresh token 用 RefreshTokenExpiresAt 判过期
//   7. token 用 SHA-256 hash 存储(repository 层完成)
package handler

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/labstack/echo/v4"

	"github.com/qishu/profile/internal/auth"
	"github.com/qishu/profile/internal/config"
	"github.com/qishu/profile/internal/middleware"
	"github.com/qishu/profile/internal/model"
	"github.com/qishu/profile/internal/repository"
	"github.com/qishu/profile/internal/settings"
	"github.com/qishu/profile/internal/urlsafe"
	"github.com/qishu/profile/internal/validator"
)

type OAuthHandler struct {
	Settings    *settings.Store
	Clients     *repository.OAuthClientRepo
	Codes       *repository.OAuthCodeRepo
	Tokens      *repository.OAuthTokenRepo
	Grants      *repository.OAuthGrantRepo
	Users       *repository.UserRepo
	ActivityLog *repository.ActivityLogRepo
	Signer      *auth.Signer
	Cfg         *config.Config
}

func (h *OAuthHandler) RegisterPublic(g *echo.Group) {
	g.GET("/client-info", h.clientInfo)
	g.POST("/token", h.token)
	g.GET("/userinfo", h.userinfo)
	g.POST("/introspect", h.introspect)
	g.POST("/revoke", h.revoke)
}

// RegisterDiscovery 注册 OIDC Discovery 端点,必须挂载在根路由上
// (即 /.well-known/openid-configuration)。
func (h *OAuthHandler) RegisterDiscovery(e *echo.Echo) {
	e.GET("/.well-known/openid-configuration", h.openIDConfiguration)
}

func (h *OAuthHandler) openIDConfiguration(c echo.Context) error {
	issuer := strings.TrimRight(h.Cfg.SiteURL, "/")
	return c.JSON(http.StatusOK, map[string]any{
		"issuer":                 issuer,
		"authorization_endpoint": issuer + "/api/oauth/authorize",
		"token_endpoint":         issuer + "/api/oauth/token",
		"userinfo_endpoint":      issuer + "/api/oauth/userinfo",
		"introspection_endpoint": issuer + "/api/oauth/introspect",
		"revocation_endpoint":    issuer + "/api/oauth/revoke",
		"response_types_supported":             []string{"code"},
		"grant_types_supported":                []string{"authorization_code", "refresh_token"},
		"subject_types_supported":              []string{"public"},
		"id_token_signing_alg_values_supported": []string{"HS256"},
		"scopes_supported":                     []string{"openid", "profile", "email"},
		"token_endpoint_auth_methods_supported": []string{"client_secret_basic", "client_secret_post"},
		"claims_supported":                     []string{"sub", "name", "preferred_username", "email", "email_verified", "picture"},
		"code_challenge_methods_supported":     []string{"S256"},
	})
}

func (h *OAuthHandler) RegisterAuthenticated(g *echo.Group) {
	g.GET("/authorize/info", h.authorizeInfo)
	g.POST("/authorize/decide", h.authorizeDecide)
}

// ─── Helpers ──────────────────────────────────────────────────────────────

func randomToken() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

func parseScopeList(s string) []string {
	parts := strings.Fields(s)
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func jsonScopes(s []string) string {
	if len(s) == 0 {
		return "[]"
	}
	b, _ := json.Marshal(s)
	return string(b)
}

func parseJSONScopes(j string) []string {
	if j == "" || j == "[]" {
		return nil
	}
	var out []string
	_ = json.Unmarshal([]byte(j), &out)
	return out
}

// validateRedirectURI exact-match check.
func validateRedirectURI(client *repository.OAuthClient, redirect string) bool {
	uris := parseJSONScopes(client.RedirectURIs)
	for _, u := range uris {
		if u == redirect {
			return true
		}
	}
	return false
}

func oauthError(c echo.Context, status int, code, description string) error {
	return c.JSON(status, map[string]any{
		"error":             code,
		"error_description": description,
	})
}

// appendQueryURL 用 net/url 安全拼装 query。值会被 url.QueryEscape。
func appendQueryURL(base string, kv ...string) string {
	u, err := url.Parse(base)
	if err != nil {
		return base
	}
	q := u.Query()
	for i := 0; i+1 < len(kv); i += 2 {
		if kv[i+1] != "" {
			q.Set(kv[i], kv[i+1])
		}
	}
	u.RawQuery = q.Encode()
	return u.String()
}

// ─── /authorize ──────────────────────────────────────────────────────────

type authorizeInfoReq struct {
	ClientID            string
	RedirectURI         string
	Scope               string
	State               string
	CodeChallenge       string
	CodeChallengeMethod string
	ResponseType        string
}

func readAuthorizeReq(c echo.Context) authorizeInfoReq {
	return authorizeInfoReq{
		ClientID:            c.QueryParam("client_id"),
		RedirectURI:         c.QueryParam("redirect_uri"),
		Scope:               c.QueryParam("scope"),
		State:               c.QueryParam("state"),
		CodeChallenge:       c.QueryParam("code_challenge"),
		CodeChallengeMethod: c.QueryParam("code_challenge_method"),
		ResponseType:        c.QueryParam("response_type"),
	}
}

func (h *OAuthHandler) authorizeInfo(c echo.Context) error {
	r := readAuthorizeReq(c)
	if r.ResponseType != "code" {
		return oauthError(c, http.StatusBadRequest, "unsupported_response_type",
			"only response_type=code is supported")
	}

	client, err := h.Clients.FindByClientID(r.ClientID)
	if err != nil || client.Status != "active" {
		return oauthError(c, http.StatusBadRequest, "invalid_client", "未知或停用的客户端")
	}
	if !validateRedirectURI(client, r.RedirectURI) {
		return oauthError(c, http.StatusBadRequest, "invalid_request",
			"redirect_uri 未在客户端登记表中")
	}

	u := middleware.User(c)
	if !meetsLevel(u.Role, client.MinLevel) {
		return oauthError(c, http.StatusForbidden, "access_denied",
			"账号等级不足以授权此应用")
	}

	allowedScopes := parseJSONScopes(client.Scopes)
	requestedScopes := parseScopeList(r.Scope)
	grantedScopes := repository.ScopesIntersect(requestedScopes, allowedScopes)

	preApproved := false
	if existing, err := h.Grants.FindByUserClient(u.ID, client.ClientID); err == nil &&
		!existing.Revoked &&
		scopesEqual(parseJSONScopes(existing.Scopes), grantedScopes) {
		preApproved = true
	}

	return c.JSON(http.StatusOK, map[string]any{
		"client": map[string]any{
			"clientId":    client.ClientID,
			"name":        client.Name,
			"description": client.Description,
			"homepageUrl": urlsafe.SanitizeHTTPURLOrEmpty(client.HomepageURL),
			"logoUrl":     urlsafe.SanitizeHTTPURLOrEmpty(client.LogoURL),
		},
		"requestedScopes": grantedScopes,
		"redirectUri":     r.RedirectURI,
		"state":           r.State,
		"preApproved":     preApproved,
	})
}

func meetsLevel(role string, minLevel int) bool {
	switch role {
	case model.RoleAdmin:
		return true
	case model.RoleMember:
		return minLevel <= 1
	case model.RoleUser:
		return minLevel <= 0
	}
	return false
}

func scopesEqual(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	set := make(map[string]bool, len(a))
	for _, s := range a {
		set[s] = true
	}
	for _, s := range b {
		if !set[s] {
			return false
		}
	}
	return true
}

func (h *OAuthHandler) authorizeDecide(c echo.Context) error {
	type req struct {
		ClientID            string `json:"clientId"`
		RedirectURI         string `json:"redirectUri"`
		Scope               string `json:"scope"`
		State               string `json:"state"`
		CodeChallenge       string `json:"codeChallenge"`
		CodeChallengeMethod string `json:"codeChallengeMethod"`
		Allow               bool   `json:"allow"`
	}
	var in req
	if err := c.Bind(&in); err != nil {
		return oauthError(c, http.StatusBadRequest, "invalid_request", "请求体无效")
	}

	// 关键修复:无论 Allow 还是 Deny,都先校验 client + redirect_uri,防止
	// 攻击者用任意 redirectUri 让我们生成 access_denied 的 302 页面。
	client, err := h.Clients.FindByClientID(in.ClientID)
	if err != nil || client.Status != "active" {
		return oauthError(c, http.StatusBadRequest, "invalid_client", "未知客户端")
	}
	if !validateRedirectURI(client, in.RedirectURI) {
		return oauthError(c, http.StatusBadRequest, "invalid_request", "redirect_uri 不被允许")
	}

	if !in.Allow {
		return c.JSON(http.StatusOK, map[string]any{
			"redirect": appendQueryURL(in.RedirectURI,
				"error", "access_denied",
				"state", in.State,
			),
		})
	}

	u := middleware.User(c)
	if !meetsLevel(u.Role, client.MinLevel) {
		return oauthError(c, http.StatusForbidden, "access_denied", "账号等级不足")
	}

	// PKCE 强制。只接受 S256(原 plain 分支删除)。
	if in.CodeChallenge == "" {
		return oauthError(c, http.StatusBadRequest, "invalid_request",
			"PKCE code_challenge 必填")
	}
	if in.CodeChallengeMethod != "S256" {
		return oauthError(c, http.StatusBadRequest, "invalid_request",
			"code_challenge_method 必须是 S256")
	}

	requested := parseScopeList(in.Scope)
	allowed := parseJSONScopes(client.Scopes)
	scopes := repository.ScopesIntersect(requested, allowed)
	scopeStr := strings.Join(scopes, " ")

	codeStr := randomToken()
	expiry := time.Duration(h.Settings.GetInt("OAUTH_CODE_EXPIRY_MINUTES", 10)) * time.Minute
	if _, err := h.Codes.Create(repository.OAuthCodeInput{
		Code: codeStr, ClientID: in.ClientID, UserID: u.ID,
		RedirectURI: in.RedirectURI, Scope: scopeStr,
		CodeChallenge: in.CodeChallenge, CodeChallengeMethod: "S256",
		ExpiresAt: time.Now().Add(expiry),
	}); err != nil {
		return oauthError(c, http.StatusInternalServerError, "server_error", "授权码生成失败")
	}

	if err := h.Grants.Upsert(u.ID, in.ClientID, client.Name, jsonScopes(scopes)); err != nil {
		return oauthError(c, http.StatusInternalServerError, "server_error", "授权记录失败")
	}

	_ = h.ActivityLog.Record(auditFromCtx(c, "oauth.authorize",
		"授权应用:"+client.Name, in.ClientID))

	return c.JSON(http.StatusOK, map[string]any{
		"redirect": appendQueryURL(in.RedirectURI,
			"code", codeStr,
			"state", in.State,
		),
	})
}

// ─── /token ──────────────────────────────────────────────────────────────

func (h *OAuthHandler) token(c echo.Context) error {
	if err := c.Request().ParseForm(); err != nil {
		return oauthError(c, http.StatusBadRequest, "invalid_request", "无效表单")
	}
	form := c.Request().PostForm
	grantType := form.Get("grant_type")

	clientID, clientSecret := readClientCredentials(c)
	if clientID == "" || clientSecret == "" {
		return oauthError(c, http.StatusUnauthorized, "invalid_client", "缺少客户端凭据")
	}
	client, err := h.Clients.FindByClientID(clientID)
	if err != nil || client.Status != "active" {
		return oauthError(c, http.StatusUnauthorized, "invalid_client", "客户端未知")
	}
	if err := auth.VerifyPassword(client.ClientSecretHash, clientSecret); err != nil {
		return oauthError(c, http.StatusUnauthorized, "invalid_client", "客户端密钥错误")
	}

	switch grantType {
	case "authorization_code":
		return h.tokenAuthorizationCode(c, client, form)
	case "refresh_token":
		return h.tokenRefresh(c, client, form)
	default:
		return oauthError(c, http.StatusBadRequest, "unsupported_grant_type",
			"grant_type 必须是 authorization_code 或 refresh_token")
	}
}

func readClientCredentials(c echo.Context) (string, string) {
	if user, pass, ok := c.Request().BasicAuth(); ok {
		return user, pass
	}
	form := c.Request().PostForm
	return form.Get("client_id"), form.Get("client_secret")
}

func (h *OAuthHandler) tokenAuthorizationCode(c echo.Context, client *repository.OAuthClient, form interface {
	Get(string) string
}) error {
	codeStr := form.Get("code")
	redirectURI := form.Get("redirect_uri")
	verifier := form.Get("code_verifier")

	code, err := h.Codes.FindByPlainCode(codeStr)
	if err != nil {
		return oauthError(c, http.StatusBadRequest, "invalid_grant", "授权码无效")
	}
	// 原子消费 — 这是修复"消费不是原子操作"的关键。
	consumed, err := h.Codes.ConsumeIfUnused(code.ID)
	if err != nil {
		return oauthError(c, http.StatusInternalServerError, "server_error", "授权码处理失败")
	}
	if !consumed {
		// 已被使用过 = 可能是被攻击者重放;按 RFC 6749 §10.5 撤销该 code 之前
		// 颁发的所有 token,防止 race 拿到的 token 被恶意保留。
		_, _ = h.Tokens.RevokeByUserClient(code.UserID, client.ClientID)
		return oauthError(c, http.StatusBadRequest, "invalid_grant", "授权码已使用")
	}
	if expired, _ := time.Parse(time.RFC3339, code.ExpiresAt); time.Now().After(expired) {
		return oauthError(c, http.StatusBadRequest, "invalid_grant", "授权码已过期")
	}
	if code.ClientID != client.ClientID {
		return oauthError(c, http.StatusBadRequest, "invalid_grant", "授权码与客户端不匹配")
	}
	if code.RedirectURI != redirectURI {
		return oauthError(c, http.StatusBadRequest, "invalid_grant", "redirect_uri 与授权时不一致")
	}
	if !verifyPKCE(code.CodeChallenge, code.CodeChallengeMethod, verifier) {
		return oauthError(c, http.StatusBadRequest, "invalid_grant", "PKCE 校验失败")
	}

	access := randomToken()
	refresh := randomToken()
	accessExpiry := time.Duration(h.Settings.GetInt("OAUTH_TOKEN_EXPIRY_SECONDS", 3600)) * time.Second
	refreshExpiry := time.Duration(h.Settings.GetInt("OAUTH_REFRESH_TOKEN_EXPIRY_DAYS", 30)) * 24 * time.Hour

	tok, err := h.Tokens.Create(repository.OAuthTokenInput{
		AccessToken: access, RefreshToken: refresh,
		ClientID: client.ClientID, UserID: code.UserID, Scope: code.Scope,
		ExpiresAt:             time.Now().Add(accessExpiry),
		RefreshTokenExpiresAt: time.Now().Add(refreshExpiry),
	})
	if err != nil {
		return oauthError(c, http.StatusInternalServerError, "server_error", "签发令牌失败")
	}
	_ = h.Grants.UpdateLastUsed(code.UserID, client.ClientID)

	resp := tokenResponseWithPlain(access, refresh, tok.Scope, accessExpiry)

	// 当 scope 包含 openid 时,按 OIDC Core 规范签发 id_token,使第三方应用
	// 能直接从 JWT 中获取用户真实邮箱、名称等身份信息。
	codeScopes := parseScopeList(code.Scope)
	for _, s := range codeScopes {
		if s == "openid" {
			u, uerr := h.Users.FindByID(code.UserID)
			if uerr == nil {
				if idToken, serr := h.signIDToken(u, client.ClientID, codeScopes, accessExpiry); serr == nil {
					resp["id_token"] = idToken
				}
			}
			break
		}
	}

	return c.JSON(http.StatusOK, resp)
}

// verifyPKCE 只支持 S256。
func verifyPKCE(challenge, method, verifier string) bool {
	if verifier == "" || method != "S256" {
		return false
	}
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:]) == challenge
}

func (h *OAuthHandler) tokenRefresh(c echo.Context, client *repository.OAuthClient, form interface {
	Get(string) string
}) error {
	refresh := form.Get("refresh_token")
	if refresh == "" {
		return oauthError(c, http.StatusBadRequest, "invalid_request", "缺少 refresh_token")
	}
	old, err := h.Tokens.FindByPlainRefreshToken(refresh)
	if err != nil {
		return oauthError(c, http.StatusBadRequest, "invalid_grant", "refresh_token 无效")
	}
	if old.ClientID != client.ClientID {
		return oauthError(c, http.StatusBadRequest, "invalid_grant", "refresh_token 与客户端不匹配")
	}
	if old.Revoked {
		return oauthError(c, http.StatusBadRequest, "invalid_grant", "refresh_token 已撤销")
	}
	if old.Replaced {
		// 重用检测:RFC 9700 §4.14
		n, _ := h.Tokens.RevokeChain(old.ID)
		_ = h.ActivityLog.Record(model.ActivityLog{
			UserID: old.UserID, Email: "", Action: "oauth.refresh_reuse",
			Detail: "检测到 refresh_token 重用,已撤销整条 token 链",
			Target: client.ClientID,
			Meta:   `{"revokedCount":` + intToStr(n) + `}`,
		})
		return oauthError(c, http.StatusBadRequest, "invalid_grant",
			"refresh_token 重用,会话已撤销")
	}
	if old.RefreshTokenExpiresAt != "" {
		if expired, _ := time.Parse(time.RFC3339, old.RefreshTokenExpiresAt); time.Now().After(expired) {
			return oauthError(c, http.StatusBadRequest, "invalid_grant", "refresh_token 已过期")
		}
	}

	access := randomToken()
	newRefresh := randomToken()
	accessExpiry := time.Duration(h.Settings.GetInt("OAUTH_TOKEN_EXPIRY_SECONDS", 3600)) * time.Second
	refreshExpiry := time.Duration(h.Settings.GetInt("OAUTH_REFRESH_TOKEN_EXPIRY_DAYS", 30)) * 24 * time.Hour

	// 单事务原子轮换。
	tok, err := h.Tokens.RotateRefresh(old.ID, repository.OAuthTokenInput{
		AccessToken: access, RefreshToken: newRefresh,
		ClientID: old.ClientID, UserID: old.UserID, Scope: old.Scope,
		ExpiresAt:             time.Now().Add(accessExpiry),
		RefreshTokenExpiresAt: time.Now().Add(refreshExpiry),
	})
	if err != nil {
		return oauthError(c, http.StatusBadRequest, "invalid_grant", "refresh_token 已被使用,请重新登录")
	}
	_ = h.Grants.UpdateLastUsed(old.UserID, client.ClientID)

	resp := tokenResponseWithPlain(access, newRefresh, tok.Scope, accessExpiry)

	// refresh 时也签发新的 id_token(如 scope 含 openid)
	refreshScopes := parseScopeList(old.Scope)
	for _, s := range refreshScopes {
		if s == "openid" {
			u, uerr := h.Users.FindByID(old.UserID)
			if uerr == nil {
				if idToken, serr := h.signIDToken(u, client.ClientID, refreshScopes, accessExpiry); serr == nil {
					resp["id_token"] = idToken
				}
			}
			break
		}
	}

	return c.JSON(http.StatusOK, resp)
}

func intToStr(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	neg := n < 0
	if neg {
		n = -n
	}
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

func tokenResponseWithPlain(access, refresh, scope string, accessExpiry time.Duration) map[string]any {
	out := map[string]any{
		"access_token": access,
		"token_type":   "Bearer",
		"expires_in":   int(accessExpiry.Seconds()),
		"scope":        scope,
	}
	if refresh != "" {
		out["refresh_token"] = refresh
	}
	return out
}

// OIDCClaims 是 id_token 中的 JWT payload,遵循 OpenID Connect Core 1.0 规范。
type OIDCClaims struct {
	Email         string `json:"email,omitempty"`
	EmailVerified bool   `json:"email_verified,omitempty"`
	Name          string `json:"name,omitempty"`
	Username      string `json:"preferred_username,omitempty"`
	Picture       string `json:"picture,omitempty"`
	jwt.RegisteredClaims
}

// signIDToken 为 OpenID Connect 签发 id_token JWT。
// 只有请求了 openid scope 才会调用。token 内包含 sub(用户唯一 ID)以及
// 根据 scope 授权的 profile / email 声明,第三方应用从中获取用户真实身份。
func (h *OAuthHandler) signIDToken(u *model.User, clientID string, scopes []string, accessExpiry time.Duration) (string, error) {
	now := time.Now()
	issuer := strings.TrimRight(h.Cfg.SiteURL, "/")

	hasScope := func(s string) bool {
		for _, x := range scopes {
			if x == s {
				return true
			}
		}
		return false
	}

	claims := OIDCClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    issuer,
			Subject:   u.ID,
			Audience:  jwt.ClaimStrings{clientID},
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(accessExpiry)),
			NotBefore: jwt.NewNumericDate(now),
		},
	}

	if hasScope("profile") || hasScope("openid") {
		claims.Name = u.Name
		claims.Username = u.Name
	}
	if hasScope("profile") {
		claims.Picture = u.Avatar
	}
	if hasScope("email") {
		claims.Email = u.Email
		claims.EmailVerified = u.EmailVerified
	}

	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(h.Cfg.JWTSecret))
}

// ─── /userinfo ───────────────────────────────────────────────────────────

func (h *OAuthHandler) userinfo(c echo.Context) error {
	tok, err := h.requireBearerToken(c)
	if err != nil {
		return err
	}
	u, err := h.Users.FindByID(tok.UserID)
	if err != nil {
		return oauthError(c, http.StatusUnauthorized, "invalid_token", "用户不存在")
	}
	scopes := parseScopeList(tok.Scope)
	hasScope := func(s string) bool {
		for _, x := range scopes {
			if x == s {
				return true
			}
		}
		return false
	}

	out := map[string]any{"sub": u.ID}
	if hasScope("openid") || hasScope("profile") {
		out["name"] = u.Name
		out["preferred_username"] = u.Name
	}
	if hasScope("profile") {
		out["picture"] = u.Avatar
	}
	if hasScope("email") {
		out["email"] = u.Email
		out["email_verified"] = u.EmailVerified
	}
	return c.JSON(http.StatusOK, out)
}

func (h *OAuthHandler) requireBearerToken(c echo.Context) (*repository.OAuthToken, error) {
	authHeader := c.Request().Header.Get("Authorization")
	const p = "Bearer "
	if !strings.HasPrefix(authHeader, p) {
		c.Response().Header().Set("WWW-Authenticate", `Bearer realm="qishu"`)
		return nil, echo.NewHTTPError(http.StatusUnauthorized, "缺少 access_token")
	}
	access := strings.TrimSpace(authHeader[len(p):])
	tok, err := h.Tokens.FindByPlainAccessToken(access)
	if err != nil {
		return nil, echo.NewHTTPError(http.StatusUnauthorized, "access_token 无效")
	}
	if tok.Revoked {
		return nil, echo.NewHTTPError(http.StatusUnauthorized, "access_token 已撤销")
	}
	if expired, _ := time.Parse(time.RFC3339, tok.ExpiresAt); time.Now().After(expired) {
		return nil, echo.NewHTTPError(http.StatusUnauthorized, "access_token 已过期")
	}
	return tok, nil
}

// ─── /introspect ─────────────────────────────────────────────────────────

func (h *OAuthHandler) introspect(c echo.Context) error {
	if err := c.Request().ParseForm(); err != nil {
		return oauthError(c, http.StatusBadRequest, "invalid_request", "无效表单")
	}
	clientID, clientSecret := readClientCredentials(c)
	client, err := h.Clients.FindByClientID(clientID)
	if err != nil || auth.VerifyPassword(client.ClientSecretHash, clientSecret) != nil {
		return oauthError(c, http.StatusUnauthorized, "invalid_client", "客户端凭据无效")
	}
	tokenStr := c.Request().PostForm.Get("token")
	tokenHint := c.Request().PostForm.Get("token_type_hint") // "access_token" | "refresh_token"
	if tokenStr == "" {
		return c.JSON(http.StatusOK, map[string]any{"active": false})
	}

	// 优先按 hint 查,再回退尝试另一种。
	var tok *repository.OAuthToken
	var isRefresh bool
	if tokenHint == "refresh_token" {
		tok, err = h.Tokens.FindByPlainRefreshToken(tokenStr)
		isRefresh = true
		if err != nil {
			tok, err = h.Tokens.FindByPlainAccessToken(tokenStr)
			isRefresh = false
		}
	} else {
		tok, err = h.Tokens.FindByPlainAccessToken(tokenStr)
		isRefresh = false
		if err != nil {
			tok, err = h.Tokens.FindByPlainRefreshToken(tokenStr)
			isRefresh = true
		}
	}
	if err != nil || tok == nil {
		return c.JSON(http.StatusOK, map[string]any{"active": false})
	}
	if tok.Revoked || tok.ClientID != client.ClientID {
		return c.JSON(http.StatusOK, map[string]any{"active": false})
	}
	if tok.Replaced && isRefresh {
		// 已轮换的 refresh token 不再 active
		return c.JSON(http.StatusOK, map[string]any{"active": false})
	}

	// 修复:refresh token 用 RefreshTokenExpiresAt;access 用 ExpiresAt。
	var expStr string
	if isRefresh {
		expStr = tok.RefreshTokenExpiresAt
	} else {
		expStr = tok.ExpiresAt
	}
	if expStr == "" {
		return c.JSON(http.StatusOK, map[string]any{"active": false})
	}
	exp, err := time.Parse(time.RFC3339, expStr)
	if err != nil || time.Now().After(exp) {
		return c.JSON(http.StatusOK, map[string]any{"active": false})
	}

	tokenType := "Bearer"
	if isRefresh {
		tokenType = "refresh_token"
	}
	return c.JSON(http.StatusOK, map[string]any{
		"active":     true,
		"scope":      tok.Scope,
		"client_id":  tok.ClientID,
		"sub":        tok.UserID,
		"token_type": tokenType,
		"exp":        exp.Unix(),
	})
}

// ─── /revoke ─────────────────────────────────────────────────────────────

func (h *OAuthHandler) revoke(c echo.Context) error {
	if err := c.Request().ParseForm(); err != nil {
		return oauthError(c, http.StatusBadRequest, "invalid_request", "无效表单")
	}
	clientID, clientSecret := readClientCredentials(c)
	client, err := h.Clients.FindByClientID(clientID)
	if err != nil || auth.VerifyPassword(client.ClientSecretHash, clientSecret) != nil {
		return oauthError(c, http.StatusUnauthorized, "invalid_client", "客户端凭据无效")
	}
	tokenStr := c.Request().PostForm.Get("token")
	if tokenStr == "" {
		return c.NoContent(http.StatusOK)
	}
	tok, err := h.Tokens.FindByPlainAccessToken(tokenStr)
	if err != nil {
		tok, err = h.Tokens.FindByPlainRefreshToken(tokenStr)
		if err != nil {
			return c.NoContent(http.StatusOK)
		}
	}
	if tok.ClientID != client.ClientID {
		return c.NoContent(http.StatusOK)
	}
	_ = h.Tokens.Revoke(tok.ID)
	return c.NoContent(http.StatusOK)
}

// ─── /client-info ────────────────────────────────────────────────────────

func (h *OAuthHandler) clientInfo(c echo.Context) error {
	cid := c.QueryParam("client_id")
	client, err := h.Clients.FindByClientID(cid)
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "未知客户端")
	}
	return c.JSON(http.StatusOK, map[string]any{
		"clientId":    client.ClientID,
		"name":        client.Name,
		"description": client.Description,
		"homepageUrl": urlsafe.SanitizeHTTPURLOrEmpty(client.HomepageURL),
		"logoUrl":     urlsafe.SanitizeHTTPURLOrEmpty(client.LogoURL),
		"status":      client.Status,
	})
}

// ─── Account: list/revoke own grants ─────────────────────────────────────

type AccountGrantsHandler struct {
	Grants *repository.OAuthGrantRepo
	Tokens *repository.OAuthTokenRepo
	Audit  *repository.ActivityLogRepo
}

func (h *AccountGrantsHandler) Register(g *echo.Group) {
	g.GET("", h.list)
	g.DELETE("/:id", h.revoke)
}

func (h *AccountGrantsHandler) list(c echo.Context) error {
	u := middleware.User(c)
	rows, err := h.Grants.ListByUser(u.ID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "查询失败")
	}
	out := make([]map[string]any, 0, len(rows))
	for _, g := range rows {
		out = append(out, map[string]any{
			"id":         g.ID,
			"clientId":   g.ClientID,
			"clientName": g.ClientName,
			"scopes":     parseJSONScopes(g.Scopes),
			"grantedAt":  g.GrantedAt,
			"lastUsedAt": g.LastUsedAt,
		})
	}
	return c.JSON(http.StatusOK, map[string]any{"items": out})
}

func (h *AccountGrantsHandler) revoke(c echo.Context) error {
	u := middleware.User(c)
	id := c.Param("id")
	rows, err := h.Grants.ListByUser(u.ID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "查询失败")
	}
	var found *repository.OAuthGrant
	for i := range rows {
		if rows[i].ID == id {
			found = &rows[i]
			break
		}
	}
	if found == nil {
		return echo.NewHTTPError(http.StatusNotFound, "未找到")
	}
	if err := h.Grants.Revoke(found.ID); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "撤销失败")
	}
	_, _ = h.Tokens.RevokeByUserClient(u.ID, found.ClientID)
	_ = h.Audit.Record(auditFromCtx(c, "oauth.grant_revoke",
		"撤销应用授权:"+found.ClientName, found.ClientID))
	return c.JSON(http.StatusOK, map[string]any{"success": true})
}

// silence unused
var _ = validator.MaxOAuthClientNameLen
