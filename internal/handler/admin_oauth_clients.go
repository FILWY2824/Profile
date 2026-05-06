// admin_oauth_clients.go — admin CRUD for OAuth client registrations.
// Mounted under /api/admin/oauth-clients with MustAdmin upstream.
//
// Two security-critical points worth flagging here:
//
//   - On create, we generate the client_secret server-side, return it
//     ONCE in the response, and store only the bcrypt hash. The admin
//     must copy it; we have no way to show it again. /rotate-secret
//     does the same for refreshes.
//
//   - homepageUrl/logoUrl go through urlsafe.SanitizeHTTPURLOrEmpty
//     before persistence. The consent screen renders these as
//     <a href={homepageUrl}> and <img src={logoUrl}>; an admin (or a
//     compromised admin account) entering `javascript:fetch(...)` would
//     otherwise plant click-XSS for every user who hits /authorize for
//     this client.
package handler

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/labstack/echo/v4"

	"github.com/qishu/profile/internal/auth"
	"github.com/qishu/profile/internal/repository"
	"github.com/qishu/profile/internal/urlsafe"
	"github.com/qishu/profile/internal/validator"
)

type AdminOAuthClientsHandler struct {
	Clients     *repository.OAuthClientRepo
	ActivityLog *repository.ActivityLogRepo
	Tokens      *repository.OAuthTokenRepo
	Grants      *repository.OAuthGrantRepo
	Codes       *repository.OAuthCodeRepo
}

func (h *AdminOAuthClientsHandler) Register(g *echo.Group) {
	g.GET("", h.list)
	g.POST("", h.create)
	g.PATCH("/:id", h.update)
	g.POST("/:id/rotate-secret", h.rotateSecret)
	g.DELETE("/:id", h.delete)
}

// projectClient hides the secret hash from the wire.
func projectClient(c *repository.OAuthClient) map[string]any {
	return map[string]any{
		"id":           c.ID,
		"clientId":     c.ClientID,
		"name":         c.Name,
		"description":  c.Description,
		"homepageUrl":  c.HomepageURL,
		"logoUrl":      c.LogoURL,
		"minLevel":     c.MinLevel,
		"redirectUris": parseJSONStringArray(c.RedirectURIs),
		"scopes":       parseJSONStringArray(c.Scopes),
		"status":       c.Status,
		"createdAt":    c.CreatedAt,
		"updatedAt":    c.UpdatedAt,
	}
}

func parseJSONStringArray(j string) []string {
	if j == "" || j == "[]" {
		return []string{}
	}
	var out []string
	_ = json.Unmarshal([]byte(j), &out)
	if out == nil {
		return []string{}
	}
	return out
}

func (h *AdminOAuthClientsHandler) list(c echo.Context) error {
	rows, err := h.Clients.List()
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	out := make([]map[string]any, 0, len(rows))
	for i := range rows {
		out = append(out, projectClient(&rows[i]))
	}
	return c.JSON(http.StatusOK, map[string]any{"items": out})
}

type oauthClientReq struct {
	ClientID     string   `json:"clientId"`
	Name         string   `json:"name"`
	Description  string   `json:"description"`
	HomepageURL  string   `json:"homepageUrl"`
	LogoURL      string   `json:"logoUrl"`
	MinLevel     int      `json:"minLevel"`
	RedirectURIs []string `json:"redirectUris"`
	Scopes       []string `json:"scopes"`
	Status       string   `json:"status"`
}

func (in *oauthClientReq) validate(forCreate bool) error {
	in.Name = strings.TrimSpace(in.Name)
	in.ClientID = strings.TrimSpace(in.ClientID)

	if forCreate {
		if err := validator.ValidateClientID(in.ClientID); err != nil {
			return err
		}
	}
	if err := validator.ValidateLen("name", in.Name, 1, validator.MaxOAuthClientNameLen); err != nil {
		return err
	}
	if len(in.Description) > validator.MaxOAuthClientDescLen {
		return echo.NewHTTPError(http.StatusBadRequest, "description 过长")
	}
	if in.MinLevel < 0 || in.MinLevel > 2 {
		return echo.NewHTTPError(http.StatusBadRequest, "minLevel 必须是 0/1/2")
	}
	if len(in.RedirectURIs) == 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "至少需要一个 redirectUri")
	}
	for i, u := range in.RedirectURIs {
		if !urlsafe.IsSafeHTTPURL(u) {
			return echo.NewHTTPError(http.StatusBadRequest, "redirectUri["+intToStr(i)+"] 不是合法的 http(s) URL")
		}
	}
	// 校验 scopes 必须是本服务器支持的合法值，防止无效 scope 写入数据库
	// 导致 token scope 交集为空或缺失关键 OIDC 声明。
	for i, s := range in.Scopes {
		s = strings.TrimSpace(s)
		in.Scopes[i] = s
		if s == "" {
			return echo.NewHTTPError(http.StatusBadRequest, "scope 不能为空")
		}
		switch s {
		case "openid", "profile", "email", "offline_access":
			// ok
		default:
			return echo.NewHTTPError(http.StatusBadRequest, "不支持的 scope: "+s)
		}
	}

	if in.Status == "" {
		in.Status = "active"
	}
	switch in.Status {
	case "active", "disabled":
	default:
		return echo.NewHTTPError(http.StatusBadRequest, "status 必须是 active 或 disabled")
	}
	return nil
}

func (h *AdminOAuthClientsHandler) create(c echo.Context) error {
	var in oauthClientReq
	if err := c.Bind(&in); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "请求体无效")
	}
	if err := in.validate(true); err != nil {
		return err
	}
	if existing, _ := h.Clients.FindByClientID(in.ClientID); existing != nil {
		return echo.NewHTTPError(http.StatusConflict, "client_id 已存在")
	}

	// Generate the secret server-side. 32 bytes URL-safe = 43 chars.
	secret, secretHash := generateClientSecret()

	created, err := h.Clients.Create(repository.OAuthClientInput{
		ClientID:         in.ClientID,
		ClientSecretHash: secretHash,
		Name:             in.Name,
		Description:      in.Description,
		HomepageURL:      urlsafe.SanitizeHTTPURLOrEmpty(in.HomepageURL),
		LogoURL:          urlsafe.SanitizeHTTPURLOrEmpty(in.LogoURL),
		MinLevel:         in.MinLevel,
		RedirectURIs:     mustJSON(in.RedirectURIs),
		Scopes:           mustJSON(in.Scopes),
		Status:           in.Status,
	})
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	_ = h.ActivityLog.Record(auditFromCtx(c, "admin.oauth_client_create",
		"创建 OAuth 客户端:"+in.Name, created.ID))

	resp := projectClient(created)
	resp["clientSecret"] = secret
	resp["_warning"] = "此密钥仅展示一次,请妥善保存"
	return c.JSON(http.StatusCreated, resp)
}

func (h *AdminOAuthClientsHandler) update(c echo.Context) error {
	id := c.Param("id")
	target, err := h.Clients.FindByID(id)
	if err != nil {
		return notFoundIfRepoMissing(err)
	}
	var in oauthClientReq
	if err := c.Bind(&in); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "请求体无效")
	}
	in.ClientID = target.ClientID // immutable on update
	if err := in.validate(false); err != nil {
		return err
	}

	updated, err := h.Clients.Update(id, repository.OAuthClientInput{
		Name:         in.Name,
		Description:  in.Description,
		HomepageURL:  urlsafe.SanitizeHTTPURLOrEmpty(in.HomepageURL),
		LogoURL:      urlsafe.SanitizeHTTPURLOrEmpty(in.LogoURL),
		MinLevel:     in.MinLevel,
		RedirectURIs: mustJSON(in.RedirectURIs),
		Scopes:       mustJSON(in.Scopes),
		Status:       in.Status,
	})
	if err != nil {
		return notFoundIfRepoMissing(err)
	}
	_ = h.ActivityLog.Record(auditFromCtx(c, "admin.oauth_client_update",
		"更新 OAuth 客户端:"+target.Name, id))
	return c.JSON(http.StatusOK, projectClient(updated))
}

func (h *AdminOAuthClientsHandler) rotateSecret(c echo.Context) error {
	id := c.Param("id")
	target, err := h.Clients.FindByID(id)
	if err != nil {
		return notFoundIfRepoMissing(err)
	}
	secret, secretHash := generateClientSecret()
	if err := h.Clients.RotateSecret(id, secretHash); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	_ = h.ActivityLog.Record(auditFromCtx(c, "admin.oauth_client_rotate",
		"轮换 OAuth 客户端密钥:"+target.Name, id))
	return c.JSON(http.StatusOK, map[string]any{
		"clientId":     target.ClientID,
		"clientSecret": secret,
		"_warning":     "此密钥仅展示一次,请妥善保存",
	})
}

func (h *AdminOAuthClientsHandler) delete(c echo.Context) error {
	id := c.Param("id")
	target, err := h.Clients.FindByID(id)
	if err != nil {
		return notFoundIfRepoMissing(err)
	}
	if err := h.Clients.Delete(id); err != nil {
		return notFoundIfRepoMissing(err)
	}
	// 级联清理
	if h.Tokens != nil {
		_, _ = h.Tokens.DeleteByClientID(target.ClientID)
	}
	if h.Grants != nil {
		_, _ = h.Grants.DeleteByClientID(target.ClientID)
	}
	if h.Codes != nil {
		_, _ = h.Codes.DeleteByClientID(target.ClientID)
	}
	_ = h.ActivityLog.Record(auditFromCtx(c, "admin.oauth_client_delete",
		"删除 OAuth 客户端:"+target.Name, id))
	return c.JSON(http.StatusOK, map[string]any{"success": true})
}

// generateClientSecret returns (plaintext, bcryptHash). The plaintext is
// 32 random bytes base64-url encoded — 43 characters, URL-safe, no
// padding to keep curl-friendly.
func generateClientSecret() (plain, hash string) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	plain = base64.RawURLEncoding.EncodeToString(b)
	h, err := auth.HashPassword(plain)
	if err != nil {
		panic(err)
	}
	return plain, h
}

func mustJSON(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return "[]"
	}
	return string(b)
}
