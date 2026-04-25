// Package config loads process environment variables once at boot and exposes
// them as a typed struct. Configuration that must be mutable at runtime lives
// in the settings table (package internal/settings) — env vars are seeds only.
package config

import (
	"fmt"
	"os"
	"strings"
)

// Config is the immutable snapshot of process-level configuration taken at
// startup. Anything that should be tunable without a restart goes to the
// settings table, not here.
type Config struct {
	ListenAddr      string
	SiteURL         string
	JWTSecret       string
	AdminEmail      string
	AdminPassword   string
	ResendAPIKey    string
	ResendFrom      string
	AppEnv          string
	DataDir         string
	AllowedOrigins  []string
	TurnstileSite   string
	TurnstileSecret string
}

// Load reads env vars and returns a validated Config. Fails fast in production
// if any hard requirement is missing.
func Load() (*Config, error) {
	c := &Config{
		ListenAddr:      getEnv("LISTEN_ADDR", "0.0.0.0:8080"),
		SiteURL:         getEnv("SITE_URL", "http://localhost:8080"),
		JWTSecret:       strings.TrimSpace(os.Getenv("JWT_SECRET")),
		AdminEmail:      strings.TrimSpace(os.Getenv("ADMIN_EMAIL")),
		AdminPassword:   os.Getenv("ADMIN_PASSWORD"),
		ResendAPIKey:    strings.TrimSpace(os.Getenv("RESEND_API_KEY")),
		ResendFrom:      strings.TrimSpace(os.Getenv("RESEND_FROM")),
		AppEnv:          strings.ToLower(getEnv("APP_ENV", "development")),
		DataDir:         getEnv("DATA_DIR", "./data"),
		TurnstileSite:   strings.TrimSpace(os.Getenv("TURNSTILE_SITE_KEY")),
		TurnstileSecret: strings.TrimSpace(os.Getenv("TURNSTILE_SECRET_KEY")),
	}

	if origins := os.Getenv("ALLOWED_ORIGINS"); origins != "" {
		for _, o := range strings.Split(origins, ",") {
			if trimmed := strings.TrimSpace(o); trimmed != "" {
				c.AllowedOrigins = append(c.AllowedOrigins, trimmed)
			}
		}
	}

	if err := c.validate(); err != nil {
		return nil, err
	}
	return c, nil
}

// IsProduction reports whether the process is running in production mode.
// Several security defaults (cookie Secure flag, strict JWT secret length,
// etc.) flip on when this returns true.
func (c *Config) IsProduction() bool { return c.AppEnv == "production" }

func (c *Config) validate() error {
	// JWT secret: length-checked because the default panic behaviour of
	// jwt.Sign on empty key is confusing, and short keys are easy to brute.
	// 32 bytes is the floor recommended by the HS256 spec authors.
	if len(c.JWTSecret) < 32 {
		if c.IsProduction() {
			return fmt.Errorf("JWT_SECRET must be at least 32 chars in production (got %d)", len(c.JWTSecret))
		}
		// In dev, allow an empty/short secret but warn loudly so tests can
		// still exercise the auth flow without operator ceremony.
		fmt.Fprintln(os.Stderr, "[WARN] JWT_SECRET is weak/empty — DO NOT use this build in production")
		if c.JWTSecret == "" {
			c.JWTSecret = "dev-insecure-secret-do-not-use-in-production-x8b2n4k7q"
		}
	}

	if c.ListenAddr == "" {
		return fmt.Errorf("LISTEN_ADDR is empty")
	}

	return nil
}

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
