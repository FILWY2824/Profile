// Package email sends transactional mail via Resend's HTTP API.
//
// Sender 是一个 wrapper,内部持有当前后端实现(ResendSender 或 ConsoleSender),
// 允许 admin 在管理后台保存 RESEND_API_KEY/RESEND_FROM 后即时生效。
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
	"sync"
	"time"
)

// Sender 对外暴露的接口。Send 调用线程安全,Reload 也线程安全。
type Sender struct {
	mu       sync.RWMutex
	apiKey   string
	from     string
	httpDone *http.Client
}

func New(apiKey, from string) *Sender {
	return &Sender{
		apiKey:   strings.TrimSpace(apiKey),
		from:     strings.TrimSpace(from),
		httpDone: &http.Client{Timeout: 10 * time.Second},
	}
}

// Reload 切换 API Key/From,allowing admin 修改 settings 立即生效。
func (s *Sender) Reload(apiKey, from string) {
	s.mu.Lock()
	s.apiKey = strings.TrimSpace(apiKey)
	s.from = strings.TrimSpace(from)
	s.mu.Unlock()
}

// DevMode 报告当前是否处于开发模式(API Key 留空)。开发模式下 Send 只打日志。
func (s *Sender) DevMode() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.apiKey == ""
}

// Send 发送邮件。dev 模式打 stdout,生产用 Resend HTTP。
func (s *Sender) Send(ctx context.Context, to, subject, htmlBody, textBody string) error {
	s.mu.RLock()
	apiKey := s.apiKey
	from := s.from
	client := s.httpDone
	s.mu.RUnlock()

	if apiKey == "" {
		fmt.Printf("\n--- [DEV EMAIL] ----------------------------------------\n")
		fmt.Printf("To:      %s\n", to)
		fmt.Printf("Subject: %s\n", subject)
		fmt.Printf("%s\n", textBody)
		fmt.Printf("--------------------------------------------------------\n\n")
		return nil
	}

	if from == "" {
		return errors.New("RESEND_FROM 未设置,无法发件")
	}

	body := resendRequest{From: from, To: to, Subject: subject, HTML: htmlBody, Text: textBody}
	buf, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		"https://api.resend.com/emails", bytes.NewReader(buf))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		errMsg, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("resend %d: %s", resp.StatusCode, string(errMsg))
	}
	return nil
}

type resendRequest struct {
	From    string `json:"from"`
	To      string `json:"to"`
	Subject string `json:"subject"`
	HTML    string `json:"html"`
	Text    string `json:"text"`
}

// ─── Templates ────────────────────────────────────────────────────────────

func ComposeVerificationCode(siteName, action, code string, expiryMin int) (subject, htmlBody, textBody string) {
	if siteName == "" {
		siteName = "栖枢"
	}
	subject = "[" + siteName + "] 验证码: " + code
	textBody = fmt.Sprintf(`%s

你正在%s%s。请在 %d 分钟内输入以下验证码:

  %s

如果你并未发起此操作,请忽略本邮件。`, siteName, siteName, action, expiryMin, code)

	htmlBody = `<!doctype html><html><body style="font-family:system-ui,-apple-system,sans-serif;background:#f7fafc;padding:32px;color:#1a202c">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;border:1px solid #e2e8f0">
    <h2 style="margin:0 0 8px 0;font-size:18px;color:#2d3748">` + html.EscapeString(siteName) + `</h2>
    <p style="margin:0 0 16px 0;color:#4a5568">你正在 ` + html.EscapeString(action) + `。请在 ` + fmt.Sprintf("%d", expiryMin) + ` 分钟内输入以下验证码:</p>
    <div style="font-size:32px;font-weight:600;letter-spacing:8px;text-align:center;background:#edf2f7;padding:20px;border-radius:8px;color:#2d3748;font-family:'JetBrains Mono',monospace">` + html.EscapeString(code) + `</div>
    <p style="margin:20px 0 0 0;color:#718096;font-size:13px">如果你并未发起此操作,请忽略本邮件。</p>
  </div>
</body></html>`
	return subject, htmlBody, textBody
}
