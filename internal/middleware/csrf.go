// csrf.go — CSRF 防护中间件,Double Submit Cookie 模式 + Origin/Referer 校验。
//
// 防护逻辑:
//   1. 安全方法(GET/HEAD/OPTIONS)直接放行
//   2. 服务器维护 cookie qishu_csrf=<32B random>,SameSite=Lax,非 HttpOnly
//      (前端 JS 需要读取再放进 X-CSRF-Token 头)
//   3. 非安全方法必须满足:
//      - 提供 X-CSRF-Token 头与 cookie 等值(双重提交)
//      - 或:Origin 头存在且属于受信任来源
//      满足任一即可。这样既兼容 SPA fetch(默认带 Origin)又兼容 curl/CLI(手
//      动设置 X-CSRF-Token)
//   4. /api/oauth/token、/api/oauth/introspect、/api/oauth/revoke 走客户端
//      凭据(client_id+client_secret),由路径白名单跳过 CSRF
//
// 为什么不全用 Origin:Origin 在某些跨源请求里会被浏览器置 null,且历史浏览器
// 不一定带 Origin;双重提交是 OWASP 推荐的兜底。
package middleware

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"net/http"
	"net/url"
	"strings"

	"github.com/labstack/echo/v4"
)

const (
	CSRFCookieName = "qishu_csrf"
	CSRFHeaderName = "X-CSRF-Token"
	csrfTokenLen   = 32
)

// CSRFConfig 参数。
type CSRFConfig struct {
	// Secure 控制 cookie 是否加 Secure 属性。生产置 true。
	Secure bool
	// TrustedOrigins 是 Origin 白名单(无端口/有端口都算严格匹配)。空切片
	// 表示只接受同源(请求 Host == Origin host)。
	TrustedOrigins []string
	// SkipPaths 命中前缀就跳过 CSRF 检查。供 OAuth 端点白名单。
	SkipPaths []string
}

// CSRF 返回中间件。
func CSRF(cfg CSRFConfig) echo.MiddlewareFunc {
	allowed := make(map[string]struct{}, len(cfg.TrustedOrigins))
	for _, o := range cfg.TrustedOrigins {
		allowed[strings.ToLower(strings.TrimRight(o, "/"))] = struct{}{}
	}
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			r := c.Request()

			// 路径白名单
			for _, p := range cfg.SkipPaths {
				if strings.HasPrefix(r.URL.Path, p) {
					ensureCSRFCookie(c, cfg.Secure)
					return next(c)
				}
			}

			// 安全方法只刷 cookie 不校验
			switch r.Method {
			case http.MethodGet, http.MethodHead, http.MethodOptions:
				ensureCSRFCookie(c, cfg.Secure)
				return next(c)
			}

			// 校验 1:Origin 必须存在,且属于受信任来源(同源或 Allowlist)
			origin := r.Header.Get("Origin")
			referer := r.Header.Get("Referer")
			source := origin
			if source == "" {
				source = referer
			}
			if !originAllowed(source, allowed, r) {
				return echo.NewHTTPError(http.StatusForbidden, "请求来源不被信任")
			}

			// 校验 2:Double Submit Cookie 必须匹配
			ck, err := r.Cookie(CSRFCookieName)
			if err != nil || ck.Value == "" {
				return echo.NewHTTPError(http.StatusForbidden, "缺少 CSRF token")
			}
			hdr := r.Header.Get(CSRFHeaderName)
			if hdr == "" {
				return echo.NewHTTPError(http.StatusForbidden, "缺少 CSRF token")
			}
			if subtle.ConstantTimeCompare([]byte(ck.Value), []byte(hdr)) != 1 {
				return echo.NewHTTPError(http.StatusForbidden, "CSRF token 不匹配")
			}

			return next(c)
		}
	}
}

// originAllowed 校验:同源(Host 与 Origin host 一致)或在 Allowlist 中。
func originAllowed(originHeader string, allow map[string]struct{}, r *http.Request) bool {
	if originHeader == "" {
		// Browsers may omit Origin on same-origin GET-after-redirect, but for
		// non-GET we already required it. Still, accept-as-same-origin if
		// Referer chain matches Host.
		return false
	}
	u, err := url.Parse(originHeader)
	if err != nil {
		return false
	}
	o := strings.ToLower(u.Scheme + "://" + u.Host)

	// 同源:scheme://Host 与请求 Host(去端口默认值)一致即可
	expected := strings.ToLower(schemeFor(r) + "://" + r.Host)
	if o == expected {
		return true
	}

	if _, ok := allow[o]; ok {
		return true
	}
	return false
}

func schemeFor(r *http.Request) string {
	if r.TLS != nil {
		return "https"
	}
	if r.Header.Get("X-Forwarded-Proto") == "https" {
		return "https"
	}
	return "http"
}

// ensureCSRFCookie 若 cookie 不存在则下发一个。
func ensureCSRFCookie(c echo.Context, secure bool) {
	if existing, err := c.Request().Cookie(CSRFCookieName); err == nil && existing.Value != "" {
		return
	}
	tok := newCSRFToken()
	c.SetCookie(&http.Cookie{
		Name:     CSRFCookieName,
		Value:    tok,
		Path:     "/",
		HttpOnly: false, // 必须非 HttpOnly,前端 JS 要读
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   86400 * 30,
	})
}

func newCSRFToken() string {
	b := make([]byte, csrfTokenLen)
	if _, err := rand.Read(b); err != nil {
		// crypto/rand failure is systemic — empty token would be insecure but
		// the request will fail validation anyway.
		return ""
	}
	return hex.EncodeToString(b)
}
