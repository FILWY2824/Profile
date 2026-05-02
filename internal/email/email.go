// Package email sends transactional mail via Resend's HTTP API.
//
// 安全策略修改 (2026-04):
//   - 移除"开发模式 stdout 回显验证码"的旧行为。任何环境下,如果
//     RESEND_API_KEY 未配置,Send 都返回 ErrNotConfigured,调用方
//     必须把这个错误转成对终端用户可见的 503 + 提示文案
//     "服务器未配置邮件发送服务,请联系管理员"。
//   - 验证码绝对不会被回显到 HTTP 响应体或服务器日志中。
//
// 模板美化 (2026-05):
//   - 验证码邮件改用柔绿玻璃风格,与产品主题一致;邮件顶部显示
//     "栖枢"产品图标(emerald 渐变方块 + 白色 sparkle),保证品牌识别。
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

// ErrNotConfigured 表示当前没有可用的邮件发送通道(RESEND_API_KEY 留空)。
// 所有依赖发送邮件验证码的 handler 收到这个错误时,必须直接告诉用户:
// 邮件服务尚未配置,请联系管理员;不要静默吞掉。
var ErrNotConfigured = errors.New("email sender not configured")

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

// Configured 报告当前是否已配置 API Key + From。
func (s *Sender) Configured() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.apiKey != "" && s.from != ""
}

// Send 发送邮件。如果 RESEND_API_KEY 未配置,直接返回 ErrNotConfigured —
// 不再回退到 stdout 打日志,也不再"静默成功"。
func (s *Sender) Send(ctx context.Context, to, subject, htmlBody, textBody string) error {
	s.mu.RLock()
	apiKey := s.apiKey
	from := s.from
	client := s.httpDone
	s.mu.RUnlock()

	if apiKey == "" {
		return ErrNotConfigured
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

// 验证码邮件模板 — 柔绿玻璃风格,与产品主题一致(详见 web/index.html)。
//
// 构成:
//  1. 顶部品牌图标(emerald 渐变圆角方块 + 白色 sparkle)+ 站点名
//  2. 白色卡片承载正文与验证码块
//  3. 验证码块用极浅薄荷底,大号 monospace 数字 + letter-spacing
//
// 邮件客户端兼容:
//   - 使用 <table> 布局而非 flex/grid,Outlook 桌面也能渲染
//   - 品牌图标的渐变在 Outlook 桌面下会被忽略,所以同时给 td 写
//     bgcolor + background-color fallback,最差情况也能显示纯品牌色
//   - 中心 sparkle 是 inline <svg>,Outlook 会忽略,但底色块仍在,
//     不会破坏整体视觉
func ComposeVerificationCode(siteName, action, code string, expiryMin int) (subject, htmlBody, textBody string) {
	if siteName == "" {
		siteName = "Qi Shu"
	}
	if action == "" {
		action = "完成账号验证"
	}
	subject = "[" + siteName + "] 验证码: " + code

	textBody = fmt.Sprintf(`%s

你正在%s%s。请在 %d 分钟内输入以下验证码:

  %s

如果你并未发起此操作,请忽略本邮件。`, siteName, siteName, action, expiryMin, code)

	site := html.EscapeString(siteName)
	act := html.EscapeString(action)
	c := html.EscapeString(code)
	htmlBody = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>` + site + ` 验证码</title></head>
<body style="margin:0;padding:0;background:#F4FBF6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft Yahei',sans-serif;color:#1F3B2A">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F4FBF6">
  <tr><td align="center" style="padding:40px 16px">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%">
      <tr><td align="center" style="padding-bottom:20px">` + brandIconHTML(56) + `</td></tr>
      <tr><td align="center" style="padding:0 0 28px 0">
        <div style="font-size:18px;font-weight:600;letter-spacing:0.5px;color:#0F4A33">` + site + `</div>
      </td></tr>
      <tr><td style="background:#FFFFFF;border:1px solid rgba(15,36,25,0.08);border-radius:18px;padding:36px 36px 32px 36px;box-shadow:0 12px 32px -16px rgba(15,36,25,0.10)">
        <div style="font-size:15px;line-height:1.7;color:#1F3B2A;margin:0 0 8px 0">你好,</div>
        <div style="font-size:15px;line-height:1.7;color:#1F3B2A;margin:0 0 22px 0">你正在 <strong style="color:#047857">` + site + `</strong> ` + act + `。请在 <strong>` + fmt.Sprintf("%d", expiryMin) + ` 分钟</strong>内输入以下验证码完成验证:</div>
        <div style="background:linear-gradient(180deg,#ECFDF5 0%,#F4FBF6 100%);background-color:#ECFDF5;border:1px solid rgba(16,185,129,0.25);border-radius:14px;padding:24px;text-align:center">
          <div style="font-family:'JetBrains Mono','SF Mono',Menlo,Consolas,monospace;font-size:34px;font-weight:600;letter-spacing:10px;color:#064E3B;line-height:1">` + c + `</div>
          <div style="font-size:11px;color:#6B7C73;margin-top:10px;letter-spacing:0.5px">VERIFICATION CODE</div>
        </div>
        <div style="font-size:13px;line-height:1.7;color:#6B7C73;margin:22px 0 0 0">为了你的账号安全,请勿向任何人转发此验证码。如果你并未发起此操作,可放心忽略本邮件,你的账号不会受到任何影响。</div>
      </td></tr>
      <tr><td align="center" style="padding:20px 8px 0 8px">
        <div style="font-size:12px;color:#94A39A;line-height:1.6">本邮件由系统自动发送,请勿直接回复。<br>© ` + site + `</div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`
	return subject, htmlBody, textBody
}

// brandIconHTML 渲染品牌图标 — emerald 渐变圆角方块 + 中心白色 sparkle,
// 用 <table bgcolor=...><svg/></table> 双层兜底,Outlook 桌面忽略 SVG 时
// 仍能显示纯品牌色块。
func brandIconHTML(size int) string {
	radius := size / 4
	starSize := int(float64(size) * 0.62)
	return fmt.Sprintf(`<table role="presentation" align="center" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto;border-collapse:separate"><tr><td bgcolor="#10B981" width="%d" height="%d" align="center" valign="middle" style="width:%dpx;height:%dpx;background:linear-gradient(135deg,#34D399 0%%,#10B981 55%%,#047857 100%%);background-color:#10B981;border-radius:%dpx;text-align:center;vertical-align:middle;line-height:0;box-shadow:0 6px 18px -6px rgba(16,185,129,0.55)"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="%d" height="%d" style="display:inline-block;vertical-align:middle" aria-hidden="true"><path d="M32 18 L34 30 L46 32 L34 34 L32 46 L30 34 L18 32 L30 30 Z" fill="#ffffff"/></svg></td></tr></table>`,
		size, size, size, size, radius, starSize, starSize)
}
