// securityheaders.go — 统一安全响应头。
// 顺手挂到 Echo 全局中间件链最外层。
//
// 修改 (2026-04):
//   - CSP style-src 加 https://fonts.googleapis.com(index.html 里 import
//     Google Fonts 样式表),并显式给出 style-src-elem 避免从父指令降级。
//   - CSP script-src 加 https://static.cloudflareinsights.com 让 Cloudflare
//     的 beacon.min.js 不再被拦截(站点本身不主动注入,Cloudflare 自己在
//     Pro plan 上挂这段;不允许的话浏览器控制台一直刷红)。
//   - CSP font-src 加 https://fonts.gstatic.com(实际字体文件托管处)。
//   - frame-src/script-src 把 Cloudflare Turnstile 全域 (cloudflare.com 子域)
//     纳入,从源头消除 challenges.cloudflare.com 偶发的不同子域跳转。
//   - 移除 Permissions-Policy 里非标准的 xr-spatial-tracking 报错(浏览器
//     不识别会按 violation 报),只留我们真正需要的几个。
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
			// 只声明我们关心的几个特性,避免浏览器对未识别的 token 报
			// "Unrecognized feature" violation 噪声(xr-spatial-tracking 之类)。
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
	// script-src:self + Cloudflare Turnstile + Cloudflare Insights beacon。
	// 'unsafe-inline' 是 Vite 注入的少量 inline script 必需,生产构建里
	// 通常已经被 hash 化但保留 unsafe-inline 兼容性更好。
	scriptSrc := "'self' 'unsafe-inline' https://challenges.cloudflare.com https://static.cloudflareinsights.com"
	for _, s := range cfg.CSPExtraScriptSrc {
		scriptSrc += " " + s
	}

	// connect-src:Turnstile siteverify 走服务端,前端只用 challenges 子域;
	// Insights beacon 上报走 cloudflareinsights.com 主域。
	connectSrc := "'self' https://challenges.cloudflare.com https://cloudflareinsights.com"
	for _, s := range cfg.CSPExtraConnectSrc {
		connectSrc += " " + s
	}

	frameSrc := "'self' https://challenges.cloudflare.com"
	for _, s := range cfg.CSPExtraFrameSrc {
		frameSrc += " " + s
	}

	// style-src:self + Google Fonts CSS。font-src:self + Google Fonts CDN +
	// data:(SVG 内联字体)。注意必须显式给 -elem,否则浏览器会把
	// style-src-elem 当作不存在并回退到 style-src,触发"violates style-src
	// directive"的告警(用户提供的 console log 里就是这种情况)。
	styleSrc := "'self' 'unsafe-inline' https://fonts.googleapis.com"
	fontSrc := "'self' data: https://fonts.gstatic.com"

	// img-src 放开 data: 是因为 favicon 缓存以 data URL 形式存,前端 <img>
	// 直接渲染。https: 是为远程 logo URL(OAuth client logoUrl)。
	return "default-src 'self'; " +
		"script-src " + scriptSrc + "; " +
		"script-src-elem " + scriptSrc + "; " +
		"style-src " + styleSrc + "; " +
		"style-src-elem " + styleSrc + "; " +
		"img-src 'self' data: https:; " +
		"font-src " + fontSrc + "; " +
		"connect-src " + connectSrc + "; " +
		"frame-src " + frameSrc + "; " +
		"worker-src 'self' blob:; " +
		"frame-ancestors 'none'; " +
		"base-uri 'self'; " +
		"form-action 'self'"
}
