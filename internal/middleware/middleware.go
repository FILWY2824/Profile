// Package middleware holds the Echo middlewares that apply across handlers.
// They're grouped here (rather than inlined in main) so each has a single
// doc comment and can be unit-tested in isolation.
package middleware

import (
	"errors"
	"net/http"
	"strings"

	"github.com/labstack/echo/v4"
	"github.com/qishu/profile/internal/auth"
	"github.com/qishu/profile/internal/model"
	"github.com/qishu/profile/internal/repository"
)

// Context keys. Exposed as constants so handlers and tests can share them.
const (
	CtxUser   = "qishu:user"
	CtxClaims = "qishu:claims"
)

// Session wires up the Signer + UserRepo. It does NOT require authentication;
// it only attaches the current user to the echo.Context if a valid session
// exists. Handlers that need auth call MustAuth on top.
//
// Supports two credential sources:
//  1. HTTP cookie CookieName — the Web SPA default
//  2. Authorization: Bearer <token> — the future mobile app default and
//     useful for curl testing
//
// Rejected cookies / tokens are silently ignored (no 401 here) — the next
// middleware in the chain decides whether that's fatal.
func Session(signer *auth.Signer, users *repository.UserRepo) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			token := extractToken(c.Request())
			if token == "" {
				return next(c)
			}
			claims, err := signer.Verify(token)
			if err != nil {
				return next(c)
			}
			u, err := users.FindByID(claims.UserID)
			if err != nil || u.Status != model.StatusActive {
				return next(c)
			}
			// password_changed_at > iat ⇒ session signed before the last
			// password change, treat as expired. This is how we kick old
			// sessions after a password reset.
			if u.PasswordChangedAt != "" && claims.IssuedAt != nil {
				if u.PasswordChangedAt > claims.IssuedAt.Time.UTC().Format("2006-01-02T15:04:05Z07:00") {
					return next(c)
				}
			}
			c.Set(CtxUser, u)
			c.Set(CtxClaims, claims)
			return next(c)
		}
	}
}

func extractToken(r *http.Request) string {
	if c, err := r.Cookie(auth.CookieName); err == nil && c.Value != "" {
		return c.Value
	}
	h := r.Header.Get("Authorization")
	if strings.HasPrefix(h, "Bearer ") {
		return strings.TrimSpace(strings.TrimPrefix(h, "Bearer "))
	}
	return ""
}

// User returns the authenticated user attached by Session, or nil if the
// request is anonymous. Never errors — callers decide whether anon is OK.
func User(c echo.Context) *model.User {
	u, _ := c.Get(CtxUser).(*model.User)
	return u
}

// MustAuth rejects anonymous requests with 401.
func MustAuth(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		if User(c) == nil {
			return echo.NewHTTPError(http.StatusUnauthorized, "未登录")
		}
		return next(c)
	}
}

// MustAdmin requires auth AND role==admin. The order matters — we want 401
// for anon and 403 for insufficient role, and different clients handle
// these differently (401 triggers login redirect, 403 shows a "no access"
// page).
func MustAdmin(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		u := User(c)
		if u == nil {
			return echo.NewHTTPError(http.StatusUnauthorized, "未登录")
		}
		if u.Role != model.RoleAdmin {
			return echo.NewHTTPError(http.StatusForbidden, "需管理员权限")
		}
		return next(c)
	}
}

// MustVerifiedEmail gates actions that require a confirmed email beyond
// just being logged in (e.g. changing critical account settings).
var ErrEmailNotVerified = errors.New("email not verified")

func MustVerifiedEmail(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		u := User(c)
		if u == nil {
			return echo.NewHTTPError(http.StatusUnauthorized, "未登录")
		}
		if !u.EmailVerified {
			return echo.NewHTTPError(http.StatusForbidden, "请先验证邮箱")
		}
		return next(c)
	}
}

// CORS issues permissive headers for allowed origins. Unlike Echo's default
// CORS middleware, this one does NOT echo arbitrary Origin headers — it
// checks against an explicit allowlist and falls through otherwise. A
// misconfigured CORS that reflects every Origin is how credentialed requests
// leak across sites.
func CORS(allowed []string) echo.MiddlewareFunc {
	allowSet := make(map[string]struct{}, len(allowed))
	for _, o := range allowed {
		allowSet[o] = struct{}{}
	}
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			origin := c.Request().Header.Get("Origin")
			if origin != "" {
				if _, ok := allowSet[origin]; ok {
					h := c.Response().Header()
					h.Set("Access-Control-Allow-Origin", origin)
					h.Set("Access-Control-Allow-Credentials", "true")
					h.Set("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS")
					h.Set("Access-Control-Allow-Headers", "Content-Type,Authorization,X-CSRF-Token")
					h.Set("Vary", "Origin")
					if c.Request().Method == http.MethodOptions {
						return c.NoContent(http.StatusNoContent)
					}
				}
			}
			return next(c)
		}
	}
}
