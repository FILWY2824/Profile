package main

import (
	"errors"
	"log"
	"net/http"
	"runtime/debug"
	"time"

	"github.com/labstack/echo/v4"

	"github.com/qishu/profile/internal/config"
	"github.com/qishu/profile/internal/repository"
	"github.com/qishu/profile/internal/settings"
)

// bodyLimit rejects request bodies larger than n bytes with 413. Defence
// against slow/large POST abuse at the first layer. Echo has a built-in
// middleware for this, but rolling our own avoids the k/M/G suffix parsing
// quirks.
func bodyLimit(n int64) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			if c.Request().ContentLength > n {
				return echo.NewHTTPError(http.StatusRequestEntityTooLarge, "request body too large")
			}
			c.Request().Body = http.MaxBytesReader(c.Response().Writer, c.Request().Body, n)
			return next(c)
		}
	}
}

// recoverer turns panics into 500 responses with a stack trace in the log.
// Echo ships a Recover middleware, but we log the stack directly to stderr
// in our own format to match the rest of the log output.
func recoverer() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) (err error) {
			defer func() {
				if r := recover(); r != nil {
					log.Printf("[panic] %v\n%s", r, debug.Stack())
					err = echo.NewHTTPError(http.StatusInternalServerError, "服务器错误")
				}
			}()
			return next(c)
		}
	}
}

// requestLogger emits one log line per request. Format is stable for grep:
// [http] method path status latency client-ip. No bodies logged.
func requestLogger(cfg *config.Config) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			start := time.Now()
			err := next(c)
			lat := time.Since(start)

			status := c.Response().Status
			var httpErr *echo.HTTPError
			if errors.As(err, &httpErr) {
				status = httpErr.Code
			}

			log.Printf("[http] %-6s %-30s %d  %s  %s",
				c.Request().Method, c.Request().URL.Path, status, lat.Round(time.Microsecond),
				clientIPForLog(c))
			return err
		}
	}
}

func clientIPForLog(c echo.Context) string {
	// Echo's RealIP respects standard forwarding headers, but we already
	// have ratelimit.ClientIP for the authoritative lookup — here it's
	// just for the log line.
	if v := c.Request().Header.Get("CF-Connecting-IP"); v != "" {
		return v
	}
	if v := c.Request().Header.Get("X-Real-IP"); v != "" {
		return v
	}
	return c.RealIP()
}

// startPruner spins one goroutine that every 6 hours:
//   - drops used/expired verification codes
//   - trims login_history beyond the retention window
//   - trims activity_log beyond the retention window
//   - drops used/expired oauth_codes
//   - drops revoked/replaced/fully-expired oauth_tokens
//
// Does a first pass 60 seconds after start so containers that have been
// rebuilt after a long time-off reclaim space quickly.
func startPruner(
	vcodes *repository.VCodeRepo,
	loginHist *repository.LoginHistoryRepo,
	activityLog *repository.ActivityLogRepo,
	oauthCodes *repository.OAuthCodeRepo,
	oauthTokens *repository.OAuthTokenRepo,
	store *settings.Store,
	stop <-chan struct{},
) {
	go func() {
		runOnce := func() {
			if n, err := vcodes.PruneExpired(); err == nil && n > 0 {
				log.Printf("[prune] verification_codes removed=%d", n)
			}

			retainLogin := store.GetInt("LOGIN_HISTORY_RETENTION_DAYS", 30)
			if retainLogin >= 0 {
				cutoff := time.Now().Add(-time.Duration(retainLogin) * 24 * time.Hour)
				if n, err := loginHist.PruneOlderThan(cutoff); err == nil && n > 0 {
					log.Printf("[prune] login_history removed=%d", n)
				}
			}

			retainAct := store.GetInt("ACTIVITY_LOG_RETENTION_DAYS", 30)
			if retainAct >= 0 {
				cutoff := time.Now().Add(-time.Duration(retainAct) * 24 * time.Hour)
				if n, err := activityLog.PruneOlderThan(cutoff); err == nil && n > 0 {
					log.Printf("[prune] activity_log removed=%d", n)
				}
			}

			if n, err := oauthCodes.PruneExpired(); err == nil && n > 0 {
				log.Printf("[prune] oauth_codes removed=%d", n)
			}
			if n, err := oauthTokens.PruneExpired(); err == nil && n > 0 {
				log.Printf("[prune] oauth_tokens removed=%d", n)
			}
		}

		// Initial short delay so it runs once shortly after boot but doesn't
		// race the first-request path for DB contention.
		first := time.NewTimer(60 * time.Second)
		defer first.Stop()
		select {
		case <-first.C:
			runOnce()
		case <-stop:
			return
		}

		t := time.NewTicker(6 * time.Hour)
		defer t.Stop()
		for {
			select {
			case <-t.C:
				runOnce()
			case <-stop:
				return
			}
		}
	}()
}
