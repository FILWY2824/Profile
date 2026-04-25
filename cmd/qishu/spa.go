// spa.go — serve the embedded Vue SPA.
//
// At build time, web/dist/* is compiled into the binary via go:embed.
// At runtime we serve:
//
//   1. /assets/* and /favicon.ico etc. as static files with long-cache
//      headers (filenames are content-hashed by Vite, so this is safe).
//
//   2. Any non-/api path that doesn't match a real file falls back to
//      index.html — that's the SPA fallback every hash router needs so
//      bookmarks / page reloads on /admin still load the app.
//
//   3. /api/* paths are NEVER touched here; they are served by the API
//      handlers registered in main.go before the SPA handler runs.
//
// Why we read web/dist via embed.FS rather than http.FileServer on disk:
// the binary becomes a single deployable artifact — `scp qishu user@host`
// is the deploy. No "did I copy the assets?" failure mode.
//
// Important invariant: when web/dist/ doesn't exist at build time (e.g.
// developer ran `go build` without first running `npm run build`), the
// embed directive's `all:` prefix would explode. We make the directive
// non-required by using a pattern that tolerates the empty case via a
// sentinel placeholder file (web/dist/.gitkeep). At runtime, if dist
// looks empty, we log a warning and serve a minimal stub so the binary
// is still useful for API-only deployments.

package main

import (
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"strings"

	"github.com/labstack/echo/v4"
)

//go:embed all:web-dist
var spaFS embed.FS

// spaSubFS lifts the embed root one level so paths like /index.html resolve
// directly. We deliberately use the directory name "web-dist" rather than
// "web/dist" so this file's go:embed pattern stays self-contained inside
// cmd/qishu/ — embed cannot reach above its own package directory.
//
// Build flow:
//   1. `npm run build` produces web/dist/
//   2. Build script (Dockerfile or Makefile) copies web/dist/* into
//      cmd/qishu/web-dist/ before running `go build`
//   3. The dev-time .gitkeep below keeps the directory present in source
//      control so a fresh checkout still compiles before anyone has run
//      `npm run build`.
func spaSubFS() (fs.FS, bool) {
	sub, err := fs.Sub(spaFS, "web-dist")
	if err != nil {
		return nil, false
	}
	// "Empty dist" check: if index.html isn't there, the dev forgot to
	// build the SPA. We want a clear signal, not a 404 storm.
	if _, err := fs.Stat(sub, "index.html"); err != nil {
		return nil, false
	}
	return sub, true
}

// registerSPA mounts the SPA handler. Must be called AFTER all API routes
// are registered, because Echo matches in registration order and we use a
// catch-all for the SPA fallback.
func registerSPA(e *echo.Echo) {
	sub, ok := spaSubFS()
	if !ok {
		// API-only mode. Surface a friendly placeholder so curling / from
		// a misconfigured deploy doesn't show "404 Not Found" with no
		// explanation.
		e.GET("/", func(c echo.Context) error {
			return c.HTML(http.StatusOK, apiOnlyStubHTML)
		})
		fmt.Println("[boot] SPA disabled (no embedded web-dist/index.html); running API-only")
		return
	}

	indexBytes, err := fs.ReadFile(sub, "index.html")
	if err != nil {
		fmt.Printf("[boot] SPA disabled (cannot read index.html: %v)\n", err)
		return
	}

	// Static file handler for hashed assets.
	httpFS := http.FS(sub)
	staticHandler := http.FileServer(httpFS)

	// Catch-all. Echo's "*" route only fires when nothing else matches.
	// We register both GET and HEAD because browsers/CDNs sometimes probe
	// asset URLs with HEAD before GET, and 405-ing those would cause
	// confusing prefetch failures.
	spaHandler := func(c echo.Context) error {
		path := c.Request().URL.Path

		// Defensive: a bug in route ordering could let an /api/* request
		// fall through here. Refuse to serve HTML for those — it would
		// confuse JSON clients.
		if strings.HasPrefix(path, "/api/") {
			return echo.NewHTTPError(http.StatusNotFound, "未找到")
		}

		// Probe the embedded FS. The leading "/" must be stripped because
		// fs.FS uses "index.html" not "/index.html".
		probe := strings.TrimPrefix(path, "/")
		if probe == "" {
			probe = "index.html"
		}

		f, err := sub.Open(probe)
		if err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				// SPA fallback — any unknown path serves the app shell so
				// the in-app router can decide. The router itself is
				// hash-based, so technically the path doesn't matter, but
				// users may bookmark deep links.
				return c.HTMLBlob(http.StatusOK, indexBytes)
			}
			return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
		}
		// Directory? Don't auto-list; serve index.html instead.
		stat, _ := f.Stat()
		_ = f.Close()
		if stat != nil && stat.IsDir() {
			return c.HTMLBlob(http.StatusOK, indexBytes)
		}

		// Add a long-cache header for content-hashed asset files. Vite's
		// build emits names like index-DJ5lBmgK.css; safe to cache forever.
		if strings.HasPrefix(probe, "assets/") {
			c.Response().Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}

		// Delegate to net/http's FileServer for proper Content-Type and
		// range-request handling. We strip the leading slash again because
		// FileServer expects URL-relative paths.
		staticHandler.ServeHTTP(c.Response(), c.Request())
		return nil
	}
	e.GET("/*", spaHandler)
	e.HEAD("/*", spaHandler)
}

const apiOnlyStubHTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>栖枢 API</title>
<style>body{font-family:system-ui,-apple-system,"PingFang SC",sans-serif;
max-width:560px;margin:80px auto;padding:0 16px;color:#1a4267;line-height:1.6}
code{background:#f0f5fa;padding:2px 6px;border-radius:4px;font-size:0.9em}</style>
</head><body>
<h1>栖枢 API</h1>
<p>本服务正在以 API-only 模式运行(未嵌入前端 SPA)。</p>
<p>探活: <code>GET /api/healthz</code></p>
<p>若想启用网页 UI,在容器构建时确保 <code>cmd/qishu/web-dist/</code>
含有 Vite 编译后的 <code>index.html</code> 与 <code>assets/</code>。</p>
</body></html>`
