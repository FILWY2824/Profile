// Package turnstile verifies Cloudflare Turnstile tokens against their
// siteverify endpoint. The pattern mirrors the old JS implementation closely
// so operator mental models carry over. Single rule: only enabled when both
// keys are populated AND the enabled flag is on.
package turnstile

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const verifyURL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

// Verifier is the handle handlers use. Create one at boot; Go's http.Client
// pool keeps outbound connections warm.
type Verifier struct {
	secret  string
	enabled bool
	client  *http.Client
}

// New returns a Verifier. It treats an empty secret or enabled=false as
// "not configured" — Verify will succeed without a network call in that
// case, mirroring the "turnstile feature flag off" semantics.
func New(secret string, enabled bool) *Verifier {
	return &Verifier{
		secret:  strings.TrimSpace(secret),
		enabled: enabled && strings.TrimSpace(secret) != "",
		client:  &http.Client{Timeout: 5 * time.Second},
	}
}

// Enabled reports whether this Verifier will actually contact Cloudflare on
// Verify(). Handlers expose this to the FE so the widget is only rendered
// when needed.
func (v *Verifier) Enabled() bool { return v.enabled }

// Verify asks Cloudflare whether token is valid for remoteIP. If the
// verifier is disabled, returns nil (accept).
//
// Why we pass remoteIP: Cloudflare's rate-limit heuristics weight the
// requesting IP; omitting it gives slightly less accurate results. It's
// optional from Cloudflare's side.
func (v *Verifier) Verify(ctx context.Context, token, remoteIP string) error {
	if !v.enabled {
		return nil
	}
	if token == "" {
		return errors.New("turnstile token missing")
	}

	form := url.Values{}
	form.Set("secret", v.secret)
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
