// securityheaders.go — 统一安全响应头。
// 顺手挂到 Echo 全局中间件链最外层。
package middleware

import (
	"github.com/labstack/echo/v4"
)

// SecurityHeadersConfig 控制各项响应头是否启用以及自定义内容。
type SecurityHeadersConfig struct {
	// IsProduction 控制是否下发 HSTS。生产环境置 true 才会下发,开发环境
	// 强制 HTTPS 会让本地 http://localhost 调试失败。
	IsProduction bool
	// CSPExtraScriptSrc 让调用方追加额外的 script-src(例如 Cloudflare
	// Turnstile 的 challenges.cloudflare.com)。
	CSPExtraScriptSrc []string
	// CSPExtraConnectSrc 同上,用于 connect-src。
	CSPExtraConnectSrc []string
	// CSPExtraFrameSrc 同上,Turnstile 用 iframe 渲染需要 frame-src。
	CSPExtraFrameSrc []string
}

// SecurityHeaders 返回中间件。
func SecurityHeaders(cfg SecurityHeadersConfig) echo.MiddlewareFunc {
	csp := buildCSP(cfg)
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			h := c.Response().Header()
			h.Set("X-Content-Type-Options", "nosniff")
			h.Set("X-Frame-Options", "DENY")
			h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
			h.Set("Permissions-Policy", "geolocation=(), microphone=(), camera=(), payment=()")
			h.Set("Content-Security-Policy", csp)
			if cfg.IsProduction {
				// max-age=180 days,允许子域,允许 preload
				h.Set("Strict-Transport-Security", "max-age=15552000; includeSubDomains")
			}
			return next(c)
		}
	}
}

func buildCSP(cfg SecurityHeadersConfig) string {
	scriptSrc := "'self'"
	for _, s := range cfg.CSPExtraScriptSrc {
		scriptSrc += " " + s
	}
	connectSrc := "'self'"
	for _, s := range cfg.CSPExtraConnectSrc {
		connectSrc += " " + s
	}
	frameSrc := "'self'"
	for _, s := range cfg.CSPExtraFrameSrc {
		frameSrc += " " + s
	}
	// img-src 放开 data: 是因为 favicon 缓存以 data URL 形式存,前端 <img>
	// 直接渲染。https: 是为远程 logo URL(OAuth client logoUrl)。
	return "default-src 'self'; " +
		"script-src " + scriptSrc + " 'unsafe-inline'; " + // Vue runtime 会注入小段 inline
		"style-src 'self' 'unsafe-inline'; " +
		"img-src 'self' data: https:; " +
		"font-src 'self' data:; " +
		"connect-src " + connectSrc + "; " +
		"frame-src " + frameSrc + "; " +
		"frame-ancestors 'none'; " +
		"base-uri 'self'; " +
		"form-action 'self'"
}
