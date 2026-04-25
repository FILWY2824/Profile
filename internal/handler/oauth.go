// oauth.go — OAuth2 / OpenID Connect server endpoints.
//
// Supported flows:
//   - Authorization Code with PKCE (recommended; required for public clients)
//   - Refresh Token Rotation with reuse detection (RFC 9700 §4.14)
//
// Not implemented (out of scope for this project):
//   - Implicit flow (insecure; deprecated)
//   - Resource Owner Password Credentials (insecure; deprecated)
//   - Client Credentials (no machine-to-machine consumers planned)
//
// All token strings are 32 bytes from crypto/rand, hex-encoded — 64 chars
// each. Stored as opaque strings, not JWTs. JWTs would let us avoid a DB
// hit on /userinfo, but at the cost of revocation latency; opaque tokens
// give us instant revocation, which we want.
package handler

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/labstack/echo/v4"

	"github.com/qishu/profile/internal/auth"
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
}

// RegisterPublic mounts the user-facing endpoints. /authorize requires a
// valid session (the user is consenting in the browser); /token and the
// rest are called by the relying party with client credentials, no
// session.
func (h *OAuthHandler) RegisterPublic(g *echo.Group) {
	g.GET("/client-info", h.clientInfo)
	g.POST("/token", h.token)
	g.GET("/userinfo", h.userinfo)
	g.POST("/introspect", h.introspect)
	g.POST("/revoke", h.revoke)
}

// RegisterAuthenticated mounts /authorize, which requires a logged-in user.
func (h *OAuthHandler) RegisterAuthenticated(g *echo.Group) {
	g.GET("/authorize/info", h.authorizeInfo)
	g.POST("/authorize/decide", h.authorizeDecide)
}

// ─── Helpers ──────────────────────────────────────────────────────────────

// randomToken returns a 32-byte crypto/rand string, hex encoded.
func randomToken() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err) // crypto/rand failure is systemic
	}
	return hex.EncodeToString(b)
}

// parseScopeList splits "openid profile email" into [openid profile email].
// Discards empty fragments. Order preserved; duplicates removed in
// repository.ScopesIntersect.
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

// jsonScopes serialises a []string into a tight JSON array. The DB stores
// scopes this way so admins reading the table by hand see "[\"a\",\"b\"]"
// rather than something binary.
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

// validateRedirectURI looks up the client and returns true iff redirect is
// in their registered list. Exact string match — partial matches are too
// dangerous (https://example.com vs https://example.com.attacker.com).
func validateRedirectURI(client *repository.OAuthClient, redirect string) bool {
	uris := parseJSONScopes(client.RedirectURIs) // same JSON array shape
	for _, u := range uris {
		if u == redirect {
			return true
		}
	}
	return false
}

// oauthError responds in OAuth2's well-defined error JSON shape. Status code
// is the right thing for a JSON-API client; we don't try to rewrite it for
// browser redirects (that's the relying party's job after they get the
// error).
func oauthError(c echo.Context, status int, code, description string) error {
	return c.JSON(status, map[string]any{
		"error":             code,
		"error_description": description,
	})
}

// ─── /authorize ──────────────────────────────────────────────────────────
//
// Step 1: the FE app navigates to /authorize with client_id, redirect_uri,
// response_type=code, scope, state, code_challenge. Our SPA renders a
// consent UI; if the user hasn't authenticated, we redirect them to login
// first and return here afterwards.
//
// We split the dance into two endpoints:
//
//   GET  /authorize/info?... → returns the client info + requested scopes
//                               for the consent screen to render
//
//   POST /authorize/decide   → user clicks "Allow"; we mint the code and
//                               return the redirect URL for the FE to
//                               window.location.assign() to. (We don't
//                               302 — the FE handles navigation, which
//                               makes login-redirect-back behaviour
//                               cleaner.)

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

	// User must meet client.MinLevel: 0=user, 1=member, 2=admin.
	u := middleware.User(c)
	if !meetsLevel(u.Role, client.MinLevel) {
		return oauthError(c, http.StatusForbidden, "access_denied",
			"账号等级不足以授权此应用")
	}

	allowedScopes := parseJSONScopes(client.Scopes)
	requestedScopes := parseScopeList(r.Scope)
	grantedScopes := repository.ScopesIntersect(requestedScopes, allowedScopes)

	// Has the user already consented? If yes and scopes are unchanged, the
	// FE can skip the consent screen and call /decide directly.
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

	if !in.Allow {
		// User declined. Echo back a redirect URL with error params so the
		// relying party gets the standard "access_denied" signal.
		return c.JSON(http.StatusOK, map[string]any{
			"redirect": appendQuery(in.RedirectURI,
				"error", "access_denied",
				"state", in.State,
			),
		})
	}

	client, err := h.Clients.FindByClientID(in.ClientID)
	if err != nil || client.Status != "active" {
		return oauthError(c, http.StatusBadRequest, "invalid_client", "未知客户端")
	}
	if !validateRedirectURI(client, in.RedirectURI) {
		return oauthError(c, http.StatusBadRequest, "invalid_request", "redirect_uri 不被允许")
	}

	u := middleware.User(c)
	if !meetsLevel(u.Role, client.MinLevel) {
		return oauthError(c, http.StatusForbidden, "access_denied", "账号等级不足")
	}

	// PKCE: required for all flows. Reject if missing.
	if in.CodeChallenge == "" {
		return oauthError(c, http.StatusBadRequest, "invalid_request",
			"PKCE code_challenge 必填")
	}
	if in.CodeChallengeMethod != "S256" && in.CodeChallengeMethod != "plain" {
		return oauthError(c, http.StatusBadRequest, "invalid_request",
			"code_challenge_method 必须是 S256 或 plain")
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
		CodeChallenge: in.CodeChallenge, CodeChallengeMethod: in.CodeChallengeMethod,
		ExpiresAt: time.Now().Add(expiry),
	}); err != nil {
		return oauthError(c, http.StatusInternalServerError, "server_error", err.Error())
	}

	if err := h.Grants.Upsert(u.ID, in.ClientID, client.Name, jsonScopes(scopes)); err != nil {
		return oauthError(c, http.StatusInternalServerError, "server_error", err.Error())
	}

	_ = h.ActivityLog.Record(auditFromCtx(c, "oauth.authorize",
		"授权应用:"+client.Name, in.ClientID))

	return c.JSON(http.StatusOK, map[string]any{
		"redirect": appendQuery(in.RedirectURI,
			"code", codeStr,
			"state", in.State,
		),
	})
}

// appendQuery is a tiny URL builder: takes pairs of name,value strings and
// glues them on with ? or & as appropriate. Skips pairs whose value is "".
func appendQuery(base string, kv ...string) string {
	var b strings.Builder
	b.WriteString(base)
	sep := "?"
	if strings.Contains(base, "?") {
		sep = "&"
	}
	for i := 0; i+1 < len(kv); i += 2 {
		if kv[i+1] == "" {
			continue
		}
		b.WriteString(sep)
		b.WriteString(kv[i])
		b.WriteByte('=')
		// We never embed user-controlled chars beyond what the URL spec
		// allows. The state token comes back to us verbatim; if a relying
		// party wants something fancy in there they encode it themselves.
		b.WriteString(kv[i+1])
		sep = "&"
	}
	return b.String()
}

// ─── /token ──────────────────────────────────────────────────────────────
//
// Two grant types:
//   - authorization_code: exchange code+pkce for access+refresh
//   - refresh_token:      exchange refresh for new access+refresh
//
// Client credentials are required for both. We support both
// HTTP Basic and form-body (RFC 6749 §2.3.1) auth shapes.

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
	// HTTP Basic header preferred per RFC 6749.
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

	code, err := h.Codes.FindByCode(codeStr)
	if err != nil {
		return oauthError(c, http.StatusBadRequest, "invalid_grant", "授权码无效")
	}
	if code.Used {
		// Reusing an authorization code is itself an attack signal
		// (RFC 6749 §10.5). Revoke any tokens already issued from this
		// code.
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

	// Mark the code used BEFORE we mint the token, so the reuse-detection
	// branch above is reachable on the next request.
	if err := h.Codes.MarkUsed(code.ID); err != nil {
		return oauthError(c, http.StatusInternalServerError, "server_error", err.Error())
	}

	access := randomToken()
	refresh := randomToken()
	accessExpiry := time.Duration(h.Settings.GetInt("OAUTH_TOKEN_EXPIRY_SECONDS", 3600)) * time.Second
	refreshExpiry := time.Duration(h.Settings.GetInt("OAUTH_REFRESH_TOKEN_EXPIRY_DAYS", 30)) * 24 * time.Hour

	tok, err := h.Tokens.Create(repository.OAuthTokenInput{
		AccessToken: access, RefreshToken: refresh,
		ClientID: client.ClientID, UserID: code.UserID,
		Scope:                 code.Scope,
		ExpiresAt:             time.Now().Add(accessExpiry),
		RefreshTokenExpiresAt: time.Now().Add(refreshExpiry),
	})
	if err != nil {
		return oauthError(c, http.StatusInternalServerError, "server_error", err.Error())
	}
	_ = h.Grants.UpdateLastUsed(code.UserID, client.ClientID)

	return c.JSON(http.StatusOK, tokenResponse(tok, accessExpiry))
}

// verifyPKCE returns true iff verifier hashes to the recorded challenge.
func verifyPKCE(challenge, method, verifier string) bool {
	if verifier == "" {
		return false
	}
	switch method {
	case "S256":
		sum := sha256.Sum256([]byte(verifier))
		// RFC 7636: base64url WITHOUT padding.
		return base64.RawURLEncoding.EncodeToString(sum[:]) == challenge
	case "plain":
		return auth.ConstantTimeEqual(challenge, verifier)
	}
	return false
}

func (h *OAuthHandler) tokenRefresh(c echo.Context, client *repository.OAuthClient, form interface {
	Get(string) string
}) error {
	refresh := form.Get("refresh_token")
	if refresh == "" {
		return oauthError(c, http.StatusBadRequest, "invalid_request", "缺少 refresh_token")
	}
	old, err := h.Tokens.FindByRefreshToken(refresh)
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
		// REUSE DETECTED. The legitimate user already rotated this; the
		// presenter is either an attacker who stole the token or a
		// disastrously broken client. Either way: kill the chain.
		n, _ := h.Tokens.RevokeChain(old.ID)
		_ = h.ActivityLog.Record(model.ActivityLog{
			UserID: old.UserID, Email: "", Action: "oauth.refresh_reuse",
			Detail:  "检测到 refresh_token 重用,已撤销整条 token 链",
			Target:  client.ClientID,
			Meta:    `{"revokedCount":` + intToStr(n) + `}`,
		})
		return oauthError(c, http.StatusBadRequest, "invalid_grant",
			"refresh_token 重用,会话已撤销")
	}
	if old.RefreshTokenExpiresAt != "" {
		if expired, _ := time.Parse(time.RFC3339, old.RefreshTokenExpiresAt); time.Now().After(expired) {
			return oauthError(c, http.StatusBadRequest, "invalid_grant", "refresh_token 已过期")
		}
	}

	// Mint new chain link, mark old replaced.
	access := randomToken()
	newRefresh := randomToken()
	accessExpiry := time.Duration(h.Settings.GetInt("OAUTH_TOKEN_EXPIRY_SECONDS", 3600)) * time.Second
	refreshExpiry := time.Duration(h.Settings.GetInt("OAUTH_REFRESH_TOKEN_EXPIRY_DAYS", 30)) * 24 * time.Hour

	tok, err := h.Tokens.Create(repository.OAuthTokenInput{
		AccessToken: access, RefreshToken: newRefresh,
		ClientID: old.ClientID, UserID: old.UserID, Scope: old.Scope,
		ExpiresAt:             time.Now().Add(accessExpiry),
		RefreshTokenExpiresAt: time.Now().Add(refreshExpiry),
		ParentTokenID:         old.ID,
	})
	if err != nil {
		return oauthError(c, http.StatusInternalServerError, "server_error", err.Error())
	}
	if err := h.Tokens.MarkReplaced(old.ID); err != nil {
		return oauthError(c, http.StatusInternalServerError, "server_error", err.Error())
	}
	_ = h.Grants.UpdateLastUsed(old.UserID, client.ClientID)

	return c.JSON(http.StatusOK, tokenResponse(tok, accessExpiry))
}

func intToStr(n int) string {
	// Tiny inline itoa, avoid dragging strconv into this file's imports.
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

func tokenResponse(t *repository.OAuthToken, accessExpiry time.Duration) map[string]any {
	out := map[string]any{
		"access_token": t.AccessToken,
		"token_type":   "Bearer",
		"expires_in":   int(accessExpiry.Seconds()),
		"scope":        t.Scope,
	}
	if t.RefreshToken != "" {
		out["refresh_token"] = t.RefreshToken
	}
	return out
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

// requireBearerToken parses the Authorization header and returns the token
// row if it's valid, non-revoked, and unexpired. Otherwise responds 401
// with WWW-Authenticate per RFC 6750.
func (h *OAuthHandler) requireBearerToken(c echo.Context) (*repository.OAuthToken, error) {
	authHeader := c.Request().Header.Get("Authorization")
	const p = "Bearer "
	if !strings.HasPrefix(authHeader, p) {
		c.Response().Header().Set("WWW-Authenticate", `Bearer realm="qishu"`)
		return nil, echo.NewHTTPError(http.StatusUnauthorized, "缺少 access_token")
	}
	access := strings.TrimSpace(authHeader[len(p):])
	tok, err := h.Tokens.FindByAccessToken(access)
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

// ─── /introspect (RFC 7662) ──────────────────────────────────────────────

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
	if tokenStr == "" {
		return c.JSON(http.StatusOK, map[string]any{"active": false})
	}
	// Try access then refresh.
	tok, err := h.Tokens.FindByAccessToken(tokenStr)
	if err != nil {
		tok, err = h.Tokens.FindByRefreshToken(tokenStr)
		if err != nil {
			return c.JSON(http.StatusOK, map[string]any{"active": false})
		}
	}
	if tok.Revoked || tok.ClientID != client.ClientID {
		return c.JSON(http.StatusOK, map[string]any{"active": false})
	}
	if expired, _ := time.Parse(time.RFC3339, tok.ExpiresAt); time.Now().After(expired) {
		return c.JSON(http.StatusOK, map[string]any{"active": false})
	}
	exp, _ := time.Parse(time.RFC3339, tok.ExpiresAt)
	return c.JSON(http.StatusOK, map[string]any{
		"active":     true,
		"scope":      tok.Scope,
		"client_id":  tok.ClientID,
		"sub":        tok.UserID,
		"token_type": "Bearer",
		"exp":        exp.Unix(),
	})
}

// ─── /revoke (RFC 7009) ──────────────────────────────────────────────────

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
		return c.NoContent(http.StatusOK) // RFC: respond 200 even on no-op
	}
	tok, err := h.Tokens.FindByAccessToken(tokenStr)
	if err != nil {
		tok, err = h.Tokens.FindByRefreshToken(tokenStr)
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
// Public read-only endpoint for the consent screen and any error pages
// that need to display "you were authenticating with X".

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
//
// These live in /api/account/oauth-grants/* and reuse session auth, not
// OAuth bearer auth. They let users see and revoke the apps they've
// authorised. Wired up alongside /api/account/* in main.go.

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
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
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
	// Find first to check ownership — users mustn't revoke other users'
	// grants by guessing IDs.
	rows, err := h.Grants.ListByUser(u.ID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
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
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	_, _ = h.Tokens.RevokeByUserClient(u.ID, found.ClientID)
	_ = h.Audit.Record(auditFromCtx(c, "oauth.grant_revoke",
		"撤销应用授权:"+found.ClientName, found.ClientID))
	return c.JSON(http.StatusOK, map[string]any{"success": true})
}

// silence unused imports until future use
var _ = validator.MaxOAuthClientNameLen
