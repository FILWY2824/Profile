// Package config loads process environment variables once at boot and exposes
// them as a typed struct.
package config

import (
	"fmt"
	"os"
	"strings"
)

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

	// TrustProxy 决定 ratelimit.ClientIP 是否信任 X-Forwarded-For /
	// X-Real-IP / CF-Connecting-IP。直接对外暴露则务必设 false,否则攻击者
	// 可以伪造请求头绕过 IP 限流。部署在反代/Cloudflare 后面则设 true。
	TrustProxy bool
}

// Load reads env vars and returns a validated Config.
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
		TrustProxy:      parseBool(os.Getenv("TRUST_PROXY")),
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

func (c *Config) IsProduction() bool { return c.AppEnv == "production" }

func (c *Config) validate() error {
	if len(c.JWTSecret) < 32 {
		if c.IsProduction() {
			return fmt.Errorf("JWT_SECRET must be at least 32 chars in production (got %d)", len(c.JWTSecret))
		}
		fmt.Fprintln(os.Stderr, "[WARN] JWT_SECRET is weak/empty — DO NOT use this build in production")
		if c.JWTSecret == "" {
			c.JWTSecret = "dev-insecure-secret-do-not-use-in-production-x8b2n4k7q"
		}
	}

	if c.ListenAddr == "" {
		return fmt.Errorf("LISTEN_ADDR is empty")
	}

	if c.IsProduction() && c.TrustProxy {
		fmt.Fprintln(os.Stderr, "[INFO] TRUST_PROXY=1 — 信任前置代理上送的 X-Forwarded-For 等头。请确认服务前面确实有可信代理。")
	}

	return nil
}

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func parseBool(s string) bool {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "1", "true", "yes", "on":
		return true
	}
	return false
}
