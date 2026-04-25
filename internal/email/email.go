// Package email sends transactional mail via Resend's HTTP API. There are
// exactly three templates in the project (register verification, password
// reset, password change) and they share a small amount of layout HTML.
//
// When ResendAPIKey is empty the sender enters "dev mode": it logs the
// intended recipient + code to stdout instead of making a network call,
// and returns the code so the handler can echo it in the HTTP response.
// This is the cheapest way to let a local dev/test environment exercise
// the full verify flow without a real mail account.
//
// Hard rules:
//   - Every dynamic field rendered into HTML goes through htmlEscape().
//     Siblings of this rule are how most mail-templating code ships XSS
//     via "reset links" containing dangerous characters in the user's name.
//   - No JS, no tracking pixels. The mail is text + a single CTA link.
package email

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"strings"
	"time"
)

// Sender is the injectable interface. Production uses ResendSender; tests
// and dev use ConsoleSender.
type Sender interface {
	Send(ctx context.Context, to, subject, html, text string) error
	// DevMode reports whether this sender is a no-op echo. Handlers use this
	// to decide whether to include the verification code in the JSON reply
	// (extremely useful during manual testing; never true in production).
	DevMode() bool
}

// New returns the right sender for the configured state.
func New(apiKey, from string) Sender {
	if apiKey == "" {
		return &ConsoleSender{}
	}
	return &ResendSender{apiKey: apiKey, from: from, http: &http.Client{Timeout: 10 * time.Second}}
}

// ConsoleSender is the dev-mode sink: prints what would have been sent and
// returns nil.
type ConsoleSender struct{}

func (c *ConsoleSender) Send(_ context.Context, to, subject, _, text string) error {
	fmt.Printf("\n--- [DEV EMAIL] ----------------------------------------\n")
	fmt.Printf("To:      %s\n", to)
	fmt.Printf("Subject: %s\n", subject)
	fmt.Printf("%s\n", text)
	fmt.Printf("--------------------------------------------------------\n\n")
	return nil
}

func (c *ConsoleSender) DevMode() bool { return true }

// ResendSender is the production implementation.
type ResendSender struct {
	apiKey string
	from   string
	http   *http.Client
}

type resendRequest struct {
	From    string `json:"from"`
	To      string `json:"to"`
	Subject string `json:"subject"`
	HTML    string `json:"html"`
	Text    string `json:"text"`
}

func (r *ResendSender) Send(ctx context.Context, to, subject, htmlBody, textBody string) error {
	if r.from == "" {
		return errors.New("RESEND_FROM not configured")
	}
	body, err := json.Marshal(resendRequest{
		From: r.from, To: to, Subject: subject, HTML: htmlBody, Text: textBody,
	})
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.resend.com/emails", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+r.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := r.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("resend %d: %s", resp.StatusCode, strings.TrimSpace(string(b)))
	}
	return nil
}

func (r *ResendSender) DevMode() bool { return false }

// EscapeHTML is exported so handlers that build small ad-hoc HTML (e.g. the
// OAuth consent page) can reuse the same escape rules.
func EscapeHTML(s string) string {
	return html.EscapeString(s)
}

// ─── Templates ──────────────────────────────────────────────────────────
// Each Compose* function returns (subject, html, text). Templates are plain
// string concatenation — there isn't enough variation to warrant text/template
// and going with literals keeps grep-for-this-copy navigation easy.

// ComposeVerificationCode renders the email for register / email-change / etc.
// `purpose` is free-form text like "注册栖枢账号" that appears in the body.
func ComposeVerificationCode(siteName, purpose, code string, expiresMinutes int) (subject, htmlBody, textBody string) {
	safe := EscapeHTML(siteName)
	safePurpose := EscapeHTML(purpose)
	safeCode := EscapeHTML(code) // code is numeric but escape anyway as belt+braces

	subject = fmt.Sprintf("[%s] 验证码:%s", siteName, code)

	htmlBody = fmt.Sprintf(`<!DOCTYPE html>
<html lang="zh"><head><meta charset="UTF-8"><title>%s</title></head>
<body style="font-family:-apple-system,Segoe UI,sans-serif;background:#f6f7f9;padding:40px 20px;margin:0">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 2px 10px rgba(0,0,0,0.05)">
    <h2 style="margin:0 0 16px;color:#1a1a1a">%s</h2>
    <p style="color:#555;line-height:1.6">你正在 <b>%s</b> %s。请在 <b>%d 分钟</b>内输入以下验证码:</p>
    <div style="font-size:32px;font-weight:700;letter-spacing:6px;text-align:center;margin:24px 0;padding:20px;background:#f0f4ff;border-radius:8px;color:#1a5fff;font-family:ui-monospace,monospace">%s</div>
    <p style="color:#888;font-size:13px;line-height:1.6;margin-top:24px">如果你并没有发起此操作,请忽略此邮件 — 无需任何操作。</p>
  </div>
</body></html>`, safe, safe, safe, safePurpose, expiresMinutes, safeCode)

	textBody = fmt.Sprintf(`%s

你正在 %s %s。
请在 %d 分钟内输入以下验证码:

    %s

如果你并没有发起此操作,请忽略此邮件。`, siteName, siteName, purpose, expiresMinutes, code)
	return
}
