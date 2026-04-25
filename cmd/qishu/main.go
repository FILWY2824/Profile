// Command qishu is the single-binary entry point. It:
//   1. loads config from env
//   2. opens the SQLite DB (runs migrations implicitly)
//   3. seeds managed settings
//   4. constructs all repositories, services, middleware
//   5. starts Echo with graceful shutdown on SIGINT/SIGTERM
//
// Everything is constructed here and injected into handlers. No init() side
// effects, no package-level globals, no hidden wiring.
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
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("config: %w", err)
	}
	log.Printf("[boot] app_env=%s listen=%s data_dir=%s", cfg.AppEnv, cfg.ListenAddr, cfg.DataDir)

	// DB
	dbPath := filepath.Join(cfg.DataDir, "app.db")
	sqldb, err := db.Open(dbPath)
	if err != nil {
		return fmt.Errorf("db: %w", err)
	}
	defer sqldb.Close()

	// Settings: seed env → DB on first run, then prefer DB on subsequent
	// reads. Pass every env var that matches a Managed key as the seed map.
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
	sections := repository.NewSectionRepo(sqldb.DB)
	cards := repository.NewCardRepo(sqldb.DB)
	loginHist := repository.NewLoginHistoryRepo(sqldb.DB)
	activityLog := repository.NewActivityLogRepo(sqldb.DB)

	// Services
	sessionDays := store.GetInt("SESSION_EXPIRY_DAYS", 7)
	if sessionDays < 1 {
		sessionDays = 1
	} else if sessionDays > 365 {
		sessionDays = 365
	}
	signer := auth.NewSigner(cfg.JWTSecret, time.Duration(sessionDays)*24*time.Hour)

	mailer := email.New(
		store.Get("RESEND_API_KEY"),
		store.Get("RESEND_FROM"),
	)
	if mailer.DevMode() {
		log.Println("[boot] email sender = DEV MODE (codes echoed to stdout and response)")
	}

	tsEnabled := store.GetBool("TURNSTILE_ENABLED")
	ts := turnstile.New(store.Get("TURNSTILE_SECRET_KEY"), tsEnabled)

	limiter := ratelimit.NewMemoryLimiter(2000)
	stopSweep := make(chan struct{})
	limiter.StartSweep(stopSweep)

	// Construct OAuth repos early — startPruner needs them, and several
	// handlers below also reference them.
	oauthClients := repository.NewOAuthClientRepo(sqldb.DB)
	oauthCodes := repository.NewOAuthCodeRepo(sqldb.DB)
	oauthTokens := repository.NewOAuthTokenRepo(sqldb.DB)
	oauthGrants := repository.NewOAuthGrantRepo(sqldb.DB)

	// Periodic retention / prune loop. Small, so it lives in main as an
	// inline goroutine rather than a separate package — future extraction
	// possible if it grows.
	prunerStop := make(chan struct{})
	startPruner(vcodes, loginHist, activityLog, oauthCodes, oauthTokens, store, prunerStop)

	// Bootstrap admin from env (idempotent). Only creates if both vars set
	// and no user with that email exists yet.
	if err := bootstrapAdmin(cfg, users); err != nil {
		log.Printf("[boot] admin bootstrap: %v", err)
	}

	// Echo
	e := echo.New()
	e.HideBanner = true
	e.HidePort = true
	// Hard body cap. 1MB is plenty for any user-facing POST; anything bigger
	// is either pathological or abuse.
	e.Use(bodyLimit(1 << 20))
	e.Use(recoverer())
	e.Use(requestLogger(cfg))
	if len(cfg.AllowedOrigins) > 0 {
		e.Use(appmw.CORS(cfg.AllowedOrigins))
	}
	e.Use(appmw.Session(signer, users))

	api := e.Group("/api")

	authH := &handler.AuthHandler{
		Cfg: cfg, Signer: signer, Settings: store,
		Email: mailer, Turnstile: ts, Limiter: limiter,
		Users: users, VCodes: vcodes,
		LoginHistory: loginHist, ActivityLog: activityLog,
	}
	authH.Register(api.Group("/auth"))

	pubH := &handler.PublicHandler{Sections: sections, Cards: cards}
	pubH.Register(api)

	// Favicon: the public read endpoint mounts on the root /api group (no
	// auth needed); the admin endpoints mount under /api/admin/favicons
	// (auth + admin guard applied below).
	favicons := repository.NewFaviconRepo(sqldb.DB)
	faviconH := handler.NewFaviconHandler(cards, favicons, activityLog)
	faviconH.RegisterPublic(api)

	// Account: per-user endpoints, must be authenticated.
	accountH := &handler.AccountHandler{
		Settings: store, Email: mailer, Limiter: limiter,
		Users: users, VCodes: vcodes,
		LoginHistory: loginHist, ActivityLog: activityLog,
	}
	accountG := api.Group("/account", appmw.MustAuth)
	accountH.Register(accountG)

	// Admin: every route below MustAdmin. We register sub-prefixes inside
	// this group so each handler's Register() adds its own paths.
	adminG := api.Group("/admin", appmw.MustAdmin)

	(&handler.AdminUsersHandler{
		Users: users, ActivityLog: activityLog,
	}).Register(adminG.Group("/users"))

	(&handler.AdminSectionsHandler{
		Sections: sections, ActivityLog: activityLog,
	}).Register(adminG.Group("/sections"))

	(&handler.AdminCardsHandler{
		Cards: cards, ActivityLog: activityLog,
	}).Register(adminG.Group("/cards"))

	(&handler.AdminSettingsHandler{
		Settings: store, ActivityLog: activityLog,
	}).Register(adminG.Group("/settings"))

	(&handler.AdminDashboardHandler{
		Users: users, Sections: sections, Cards: cards,
	}).Register(adminG.Group("/dashboard"))

	(&handler.AdminAuditHandler{
		LoginHistory: loginHist, ActivityLog: activityLog,
	}).Register(adminG)

	(&handler.AdminRetentionHandler{
		VCodes: vcodes, LoginHistory: loginHist, ActivityLog: activityLog,
		Settings: store, Audit: activityLog,
	}).Register(adminG.Group("/retention"))

	faviconH.RegisterAdmin(adminG.Group("/favicons"))

	// ── OAuth2 server ──
	oauthH := &handler.OAuthHandler{
		Settings: store, Clients: oauthClients, Codes: oauthCodes,
		Tokens: oauthTokens, Grants: oauthGrants,
		Users: users, ActivityLog: activityLog,
	}
	oauthH.RegisterPublic(api.Group("/oauth"))
	oauthH.RegisterAuthenticated(api.Group("/oauth", appmw.MustAuth))

	// User-facing grant management lives under /api/account/oauth-grants.
	(&handler.AccountGrantsHandler{
		Grants: oauthGrants, Tokens: oauthTokens, Audit: activityLog,
	}).Register(accountG.Group("/oauth-grants"))

	// Admin OAuth client CRUD.
	(&handler.AdminOAuthClientsHandler{
		Clients: oauthClients, ActivityLog: activityLog,
	}).Register(adminG.Group("/oauth-clients"))

	// SPA last — its catch-all matches anything unmatched above.
	registerSPA(e)

	// Graceful shutdown.
	srv := &http.Server{
		Addr:              cfg.ListenAddr,
		Handler:           e,
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       60 * time.Second,
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
	return srv.Shutdown(ctx)
}

// bootstrapAdmin is an idempotent "create admin on first boot" step. It does
// NOT mutate anything if:
//   - ADMIN_EMAIL or ADMIN_PASSWORD is unset
//   - a user with that email already exists
//
// This matches the operator expectation documented in .env.example — first
// boot with both vars creates; subsequent boots are no-ops.
func bootstrapAdmin(cfg *config.Config, users *repository.UserRepo) error {
	if cfg.AdminEmail == "" || cfg.AdminPassword == "" {
		return nil
	}
	addr := cfg.AdminEmail
	if _, err := users.FindByEmail(addr); err == nil {
		return nil // already exists
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
