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
	if v := c.Request().Header.Get("CF-Connecting-IP"); v != "" {
		return v
	}
	if v := c.Request().Header.Get("X-Real-IP"); v != "" {
		return v
	}
	return c.RealIP()
}

func startPruner(
	vcodes *repository.VCodeRepo,
	pending *repository.PendingRepo,
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
			if n, err := pending.PruneExpired(); err == nil && n > 0 {
				log.Printf("[prune] pending_registrations removed=%d", n)
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
