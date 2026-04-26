// Package middleware holds the Echo middlewares that apply across handlers.
package middleware

import (
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/qishu/profile/internal/auth"
	"github.com/qishu/profile/internal/model"
	"github.com/qishu/profile/internal/ratelimit"
	"github.com/qishu/profile/internal/repository"
)

// Context keys.
const (
	CtxUser   = "qishu:user"
	CtxClaims = "qishu:claims"
)

// SessionConfig 让上层注入 login_history 与"会话恢复阈值",用于
// 把"用户隔一觉过来访问"作为一次新登录写入审计。
type SessionConfig struct {
	Signer       *auth.Signer
	Users        *repository.UserRepo
	LoginHistory *repository.LoginHistoryRepo

	// ResumeGap 控制"距上次活动多久没动作算新登录"。0 表示禁用此功能,
	// 行为退回到老版本(只在密码登录时写一条登录历史)。
	ResumeGap time.Duration
}

// sessionTracker 是一个进程内的小型最近活动表,用 user_id -> last_seen
// 的 map 维护。每次认证请求进来都会更新一次,如果距离上次活动超过
// ResumeGap,则同步写一条 login_history 记录(reason="会话恢复")。
//
// 为什么不直接持久化到 users.last_active_at?因为这玩意会被每个请求
// 写一次,直接写 SQLite 会成为热点。内存里维护就够,丢失了也无所谓。
// 持久化只在阈值跨越时才做(写 login_history)。
type sessionTracker struct {
	mu       sync.Mutex
	lastSeen map[string]time.Time
}

func newSessionTracker() *sessionTracker {
	return &sessionTracker{lastSeen: make(map[string]time.Time)}
}

// observe 返回此次请求与上次活动的时间差(若 user 此前从未被观察过则返回 0)
// 与一个 prevSeen 是否存在的 bool。
func (t *sessionTracker) observe(userID string, now time.Time) (gap time.Duration, hadPrev bool) {
	t.mu.Lock()
	prev, ok := t.lastSeen[userID]
	t.lastSeen[userID] = now
	t.mu.Unlock()
	if !ok {
		return 0, false
	}
	return now.Sub(prev), true
}

// 全局 tracker — 单进程,共享一个。
var globalTracker = newSessionTracker()

// Session attaches the current user to the echo.Context if a valid session
// exists. Does not require auth — handlers that need it call MustAuth on top.
//
// 修改 (2026-04):新增 ResumeGap 触发逻辑 — 用户带着有效 cookie 隔了
// 长时间(默认 30 分钟)再访问,就被视作一次新登录,写入 login_history
// 表。这样用户的"最近登录"页面不会因为只在密码登录时才记录而看起来
// 长期都是同一条记录。
func Session(signer *auth.Signer, users *repository.UserRepo) echo.MiddlewareFunc {
	return SessionWithConfig(SessionConfig{Signer: signer, Users: users})
}

func SessionWithConfig(cfg SessionConfig) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			token := extractToken(c.Request())
			if token == "" {
				return next(c)
			}
			claims, err := cfg.Signer.Verify(token)
			if err != nil {
				return next(c)
			}
			u, err := cfg.Users.FindByID(claims.UserID)
			if err != nil || u.Status != model.StatusActive {
				return next(c)
			}
			if u.PasswordChangedAt != "" && claims.IssuedAt != nil {
				if u.PasswordChangedAt > claims.IssuedAt.Time.UTC().Format("2006-01-02T15:04:05Z07:00") {
					return next(c)
				}
			}
			c.Set(CtxUser, u)
			c.Set(CtxClaims, claims)

			// 会话恢复检测 — 仅对真正"做事"的请求触发。GET /api/auth/me
			// 是 SPA 启动时无脑调一次的,不算用户的有意操作;但这里我们
			// 简单一些:只要请求经过 session 中间件并被认证,就更新最后
			// 活动时间。如果距上次活动超过阈值,就写入登录历史。
			//
			// 这样有个微妙的好处:即便页面 Tab 在后台,SPA 的 polling
			// 也只是把"还活着"这个事实持续刷新,不会重复触发新登录;
			// 而真正离开座位很久后再回来,第一次请求就会被识别。
			if cfg.LoginHistory != nil && cfg.ResumeGap > 0 {
				now := time.Now().UTC()
				gap, hadPrev := globalTracker.observe(u.ID, now)
				if hadPrev && gap >= cfg.ResumeGap {
					_ = cfg.LoginHistory.Record(model.LoginHistory{
						UserID: u.ID, Email: u.Email,
						IP:        ratelimit.ClientIP(c.Request()),
						UserAgent: c.Request().UserAgent(),
						Success:   true, Reason: "会话恢复",
						Timestamp: now.Format(time.RFC3339),
					})
				}
			}

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

// User returns the authenticated user attached by Session, or nil.
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

// MustAdmin requires auth AND role==admin.
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

// CORS issues permissive headers for allowed origins. Strict allowlist —
// never echo arbitrary Origin.
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
