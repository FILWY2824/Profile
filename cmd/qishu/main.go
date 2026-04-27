// Command qishu is the single-binary entry point.
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/labstack/echo/v4"

	"github.com/qishu/profile/internal/auth"
	"github.com/qishu/profile/internal/config"
	"github.com/qishu/profile/internal/db"
	"github.com/qishu/profile/internal/email"
	"github.com/qishu/profile/internal/handler"
	appmw "github.com/qishu/profile/internal/middleware"
	"github.com/qishu/profile/internal/ratelimit"
	"github.com/qishu/profile/internal/repository"
	"github.com/qishu/profile/internal/settings"
	"github.com/qishu/profile/internal/turnstile"
)

func main() {
	if err := run(); err != nil {
		log.Fatalf("fatal: %v", err)
	}
}

func run() error {
	// 第一步:把 runtime 内存上限/GC/GOMAXPROCS 调到位,启动 scavenger。
	// 必须在任何其它分配之前完成,避免冷启动期间 RSS 飙得过高。
	scavengeStop := applyRuntimeTuning()

	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("config: %w", err)
	}
	log.Printf("[boot] app_env=%s listen=%s data_dir=%s trust_proxy=%v",
		cfg.AppEnv, cfg.ListenAddr, cfg.DataDir, cfg.TrustProxy)

	// 把 TrustProxy 推给全局 ClientIP — 必须在任何请求处理之前。
	ratelimit.SetTrustProxy(cfg.TrustProxy)

	// DB
	dbPath := filepath.Join(cfg.DataDir, "app.db")
	sqldb, err := db.Open(dbPath)
	if err != nil {
		return fmt.Errorf("db: %w", err)
	}
	defer sqldb.Close()

	// Settings
	envSeed := make(map[string]string)
	for _, m := range settings.Managed {
		if v := os.Getenv(m.Key); v != "" {
			envSeed[m.Key] = v
		}
	}
	store := settings.NewStore(sqldb.DB)
	if err := store.SyncManaged(envSeed); err != nil {
		return fmt.Errorf("settings sync: %w", err)
	}

	// Repositories
	users := repository.NewUserRepo(sqldb.DB)
	vcodes := repository.NewVCodeRepo(sqldb.DB)
	pending := repository.NewPendingRepo(sqldb.DB)
	sections := repository.NewSectionRepo(sqldb.DB)
	cards := repository.NewCardRepo(sqldb.DB)
	loginHist := repository.NewLoginHistoryRepo(sqldb.DB)
	activityLog := repository.NewActivityLogRepo(sqldb.DB)
	favicons := repository.NewFaviconRepo(sqldb.DB)
	oauthClients := repository.NewOAuthClientRepo(sqldb.DB)
	oauthCodes := repository.NewOAuthCodeRepo(sqldb.DB)
	oauthTokens := repository.NewOAuthTokenRepo(sqldb.DB)
	oauthGrants := repository.NewOAuthGrantRepo(sqldb.DB)

	// Services
	sessionDays := store.GetInt("SESSION_EXPIRY_DAYS", 1)
	if sessionDays < 1 {
		sessionDays = 1
	} else if sessionDays > 365 {
		sessionDays = 365
	}
	signer := auth.NewSigner(cfg.JWTSecret, time.Duration(sessionDays)*24*time.Hour)

	// Email/Turnstile 是可热重载的对象,启动时从 settings 读取初值。
	mailer := email.New(
		store.Get("RESEND_API_KEY"),
		store.Get("RESEND_FROM"),
	)
	if !mailer.Configured() {
		log.Println("[boot] email sender NOT configured — 验证码相关接口会返回 503 直到管理员在后台填入 RESEND_API_KEY/RESEND_FROM。")
	}

	tsEnabled := store.GetBool("TURNSTILE_ENABLED")
	tsSendIP := store.GetBool("TURNSTILE_SEND_REMOTEIP")
	ts := turnstile.New(store.Get("TURNSTILE_SECRET_KEY"), tsEnabled)
	// 把 sendRemoteIP 也同步进来 — turnstile.New 没收这个参数,我们 reload 一次。
	ts.Reload(store.Get("TURNSTILE_SECRET_KEY"), tsEnabled, tsSendIP)

	limiter := ratelimit.NewMemoryLimiter(2000)
	stopSweep := make(chan struct{})
	limiter.StartSweep(stopSweep)

	prunerStop := make(chan struct{})
	startPruner(vcodes, pending, loginHist, activityLog, oauthCodes, oauthTokens, store, prunerStop)

	if err := bootstrapAdmin(cfg, users); err != nil {
		log.Printf("[boot] admin bootstrap: %v", err)
	}

	// Echo
	e := echo.New()
	e.HideBanner = true
	e.HidePort = true

	// 1) body limit
	e.Use(bodyLimit(1 << 20))
	// 2) recover
	e.Use(recoverer())
	// 3) request log
	e.Use(requestLogger(cfg))
	// 4) CORS(可选)
	if len(cfg.AllowedOrigins) > 0 {
		e.Use(appmw.CORS(cfg.AllowedOrigins))
	}
	// 5) 安全响应头(全局)
	e.Use(appmw.SecurityHeaders(appmw.SecurityHeadersConfig{
		IsProduction: cfg.IsProduction(),
		// Turnstile 资源放白名单(站点没启用 Turnstile 时也无害)
		CSPExtraScriptSrc:  []string{"https://challenges.cloudflare.com"},
		CSPExtraConnectSrc: []string{"https://challenges.cloudflare.com"},
		CSPExtraFrameSrc:   []string{"https://challenges.cloudflare.com"},
	}))
	// 6) Session(读 cookie / Bearer 解析用户)
	resumeGap := time.Duration(store.GetInt("SESSION_RESUME_GAP_MINUTES", 30)) * time.Minute
	e.Use(appmw.SessionWithConfig(appmw.SessionConfig{
		Signer: signer, Users: users,
		LoginHistory: loginHist,
		ResumeGap:    resumeGap,
	}))
	// 7) CSRF — OAuth 端点白名单(走 client credentials,不能用 cookie 校验)
	e.Use(appmw.CSRF(appmw.CSRFConfig{
		Secure: cfg.IsProduction(),
		SkipPaths: []string{
			"/api/oauth/token",
			"/api/oauth/introspect",
			"/api/oauth/revoke",
			"/api/oauth/userinfo",
		},
	}))

	api := e.Group("/api")
	api.GET("/healthz", func(c echo.Context) error { return c.String(http.StatusOK, "ok") })
	api.HEAD("/healthz", func(c echo.Context) error { return c.NoContent(http.StatusOK) })
	api.GET("/csrf", func(c echo.Context) error {
		// 给 SPA 启动时调用一次,确保 cookie 被下发。中间件已在响应头中
		// 设置过,这里只是显式触发并回 200。
		return c.JSON(http.StatusOK, map[string]any{"ok": true})
	})

	authH := &handler.AuthHandler{
		Cfg: cfg, Signer: signer, Settings: store,
		Email: mailer, Turnstile: ts, Limiter: limiter,
		Users: users, VCodes: vcodes, Pending: pending,
		LoginHistory: loginHist, ActivityLog: activityLog,
	}
	authH.Register(api.Group("/auth"))

	pubH := &handler.PublicHandler{
		Sections: sections, Cards: cards,
		ActivityLog: activityLog, Settings: store,
	}
	pubH.Register(api)

	faviconH := handler.NewFaviconHandler(cards, favicons, activityLog)
	faviconH.RegisterPublic(api)

	accountH := &handler.AccountHandler{
		Cfg: cfg, Settings: store, Email: mailer, Limiter: limiter,
		Users: users, VCodes: vcodes,
		LoginHistory: loginHist, ActivityLog: activityLog,
	}
	accountG := api.Group("/account", appmw.MustAuth)
	accountH.Register(accountG)

	adminG := api.Group("/admin", appmw.MustAdmin)

	(&handler.AdminUsersHandler{
		Users: users, ActivityLog: activityLog,
		OAuthTokens: oauthTokens, OAuthGrants: oauthGrants, OAuthCodes: oauthCodes,
	}).Register(adminG.Group("/users"))

	(&handler.AdminSectionsHandler{
		Sections: sections, ActivityLog: activityLog,
	}).Register(adminG.Group("/sections"))

	(&handler.AdminCardsHandler{
		Cards: cards, ActivityLog: activityLog,
		// 联动:卡片新增 / URL 改动 / 删除时自动更新图标缓存(丢旧 + 抓新)。
		// 见 internal/handler/favicon.go 的 EnsureFreshForOrigin / DropIfOrphan。
		Favicons: faviconH,
	}).Register(adminG.Group("/cards"))

	(&handler.AdminSettingsHandler{
		Settings: store, ActivityLog: activityLog,
		Turnstile: ts, Email: mailer,
	}).Register(adminG.Group("/settings"))

	(&handler.AdminDashboardHandler{
		Users: users, Sections: sections, Cards: cards,
		DataDir: cfg.DataDir,
	}).Register(adminG.Group("/dashboard"))

	(&handler.AdminRuntimeHandler{}).Register(adminG.Group("/runtime"))

	(&handler.AdminAuditHandler{
		LoginHistory: loginHist, ActivityLog: activityLog,
	}).Register(adminG)

	(&handler.AdminRetentionHandler{
		VCodes: vcodes, Pending: pending,
		LoginHistory: loginHist, ActivityLog: activityLog,
		OAuthCodes: oauthCodes, OAuthTokens: oauthTokens,
		Favicons: favicons,
		Settings: store, Audit: activityLog,
	}).Register(adminG.Group("/retention"))

	faviconH.RegisterAdmin(adminG.Group("/favicons"))

	oauthH := &handler.OAuthHandler{
		Settings: store, Clients: oauthClients, Codes: oauthCodes,
		Tokens: oauthTokens, Grants: oauthGrants,
		Users: users, ActivityLog: activityLog,
	}
	oauthH.RegisterPublic(api.Group("/oauth"))
	oauthH.RegisterAuthenticated(api.Group("/oauth", appmw.MustAuth))

	(&handler.AccountGrantsHandler{
		Grants: oauthGrants, Tokens: oauthTokens, Audit: activityLog,
	}).Register(accountG.Group("/oauth-grants"))

	(&handler.AdminOAuthClientsHandler{
		Clients: oauthClients, ActivityLog: activityLog,
		Tokens: oauthTokens, Grants: oauthGrants, Codes: oauthCodes,
	}).Register(adminG.Group("/oauth-clients"))

	registerSPA(e)

	srv := &http.Server{
		Addr:              cfg.ListenAddr,
		Handler:           e,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
		// 8 KiB 头部上限。默认 1 MiB,对一个请求 < 1KB header 的内部服务来说
		// 是巨大的浪费。压低也是 slowloris/慢攻击的二级防御。
		MaxHeaderBytes: 8 << 10,
	}

	errCh := make(chan error, 1)
	go func() {
		log.Printf("[boot] http listening on %s", cfg.ListenAddr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	select {
	case err := <-errCh:
		return err
	case sig := <-stop:
		log.Printf("[boot] received %s, shutting down", sig)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	close(stopSweep)
	close(prunerStop)
	close(scavengeStop)
	return srv.Shutdown(ctx)
}

func bootstrapAdmin(cfg *config.Config, users *repository.UserRepo) error {
	if cfg.AdminEmail == "" || cfg.AdminPassword == "" {
		return nil
	}
	addr := cfg.AdminEmail
	if _, err := users.FindByEmail(addr); err == nil {
		return nil
	}
	hash, err := auth.HashPassword(cfg.AdminPassword)
	if err != nil {
		return err
	}
	_, err = users.Create(repository.CreateInput{
		Email:         addr,
		PasswordHash:  hash,
		Name:          "admin",
		Role:          "admin",
		EmailVerified: true,
	})
	if err != nil {
		return err
	}
	log.Printf("[boot] bootstrap admin created: %s", addr)
	return nil
}
