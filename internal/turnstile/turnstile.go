// Package turnstile verifies Cloudflare Turnstile tokens.
//
// Reload semantics: Verifier 内部用 sync.RWMutex 包裹 secret/enabled,允许
// admin 在管理后台修改 settings 后即时生效,无需重启容器。
package turnstile

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const verifyURL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

type Verifier struct {
	mu      sync.RWMutex
	secret  string
	enabled bool
	client  *http.Client
}

func New(secret string, enabled bool) *Verifier {
	return &Verifier{
		secret:  strings.TrimSpace(secret),
		enabled: enabled && strings.TrimSpace(secret) != "",
		client:  &http.Client{Timeout: 5 * time.Second},
	}
}

// Reload 在管理员保存设置后调用。无锁竞态:写入持有 Lock,读取走 RLock。
func (v *Verifier) Reload(secret string, enabled bool) {
	s := strings.TrimSpace(secret)
	v.mu.Lock()
	v.secret = s
	v.enabled = enabled && s != ""
	v.mu.Unlock()
}

func (v *Verifier) Enabled() bool {
	v.mu.RLock()
	defer v.mu.RUnlock()
	return v.enabled
}

func (v *Verifier) Verify(ctx context.Context, token, remoteIP string) error {
	v.mu.RLock()
	enabled := v.enabled
	secret := v.secret
	v.mu.RUnlock()

	if !enabled {
		return nil
	}
	if token == "" {
		return errors.New("turnstile token missing")
	}

	form := url.Values{}
	form.Set("secret", secret)
	form.Set("response", token)
	if remoteIP != "" {
		form.Set("remoteip", remoteIP)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, verifyURL,
		bytes.NewBufferString(form.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := v.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	var body struct {
		Success    bool     `json:"success"`
		ErrorCodes []string `json:"error-codes"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return err
	}
	if !body.Success {
		return errors.New("turnstile verification failed: " + strings.Join(body.ErrorCodes, ","))
	}
	return nil
}
