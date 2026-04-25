// auth.go — /api/auth/* 端点。
//
// 改动:
//   1. writeDevEcho 改为只看 cfg.AppEnv == "development",生产环境绝不回显
//      验证码到响应,无论 mailer 是否真的发出了邮件。
//   2. 注册流程把 password hash 从 verification_codes.meta 挪到独立的
//      pending_registrations 表。
//   3. 验证码用 SHA-256 hash 存储,VCodeRepo.VerifyCode 做常量时间比较。
//   4. 验证码消费用 ConsumeIfUnused 原子操作。
package handler

import (
	"context"
	"crypto/rand"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"time"

	"github.com/labstack/echo/v4"

	"github.com/qishu/profile/internal/auth"
	"github.com/qishu/profile/internal/config"
	"github.com/qishu/profile/internal/email"
	"github.com/qishu/profile/internal/middleware"
	"github.com/qishu/profile/internal/model"
	"github.com/qishu/profile/internal/ratelimit"
	"github.com/qishu/profile/internal/repository"
	"github.com/qishu/profile/internal/settings"
	"github.com/qishu/profile/internal/turnstile"
	"github.com/qishu/profile/internal/validator"
)

type AuthHandler struct {
	Cfg       *config.Config
	Signer    *auth.Signer
	Settings  *settings.Store
	Email     *email.Sender
	Turnstile *turnstile.Verifier
	Limiter   ratelimit.Limiter

	Users        *repository.UserRepo
	VCodes       *repository.VCodeRepo
	Pending      *repository.PendingRepo
	LoginHistory *repository.LoginHistoryRepo
	ActivityLog  *repository.ActivityLogRepo
}

func (h *AuthHandler) Register(g *echo.Group) {
	g.POST("/register", h.register)
	g.POST("/register/confirm", h.registerConfirm)
	g.POST("/login", h.login)
	g.POST("/logout", h.logout)
	g.POST("/forgot-password", h.forgotPassword)
	g.POST("/reset-password", h.resetPassword)
	g.POST("/verify-email", h.verifyEmailSend)
	g.POST("/verify-email/confirm", h.verifyEmailConfirm)
	g.GET("/me", h.me)
	g.GET("/turnstile-config", h.turnstileConfig)
}

// ─── Helpers ──────────────────────────────────────────────────────────────

func newCode() string {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		panic(err)
	}
	return fmt.Sprintf("%06d", n.Int64())
}

func (h *AuthHandler) setAuthCookie(c echo.Context, token string) {
	c.SetCookie(&http.Cookie{
		Name:     auth.CookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   h.Cfg.IsProduction(),
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(h.Signer.SessionExpiry().Seconds()),
	})
}

func (h *AuthHandler) clearAuthCookie(c echo.Context) {
	c.SetCookie(&http.Cookie{
		Name: auth.CookieName, Value: "", Path: "/",
		HttpOnly: true, Secure: h.Cfg.IsProduction(),
		SameSite: http.SameSiteLaxMode, MaxAge: -1,
	})
}

func (h *AuthHandler) rl(bucket, key, maxKey, winKey string, defaultMax, defaultWinMin int) ratelimit.Decision {
	return h.Limiter.Allow(bucket, key, ratelimit.Rule{
		Max:    h.Settings.GetInt(maxKey, defaultMax),
		Window: time.Duration(h.Settings.GetInt(winKey, defaultWinMin)) * time.Minute,
	})
}

func (h *AuthHandler) vcodeExpiry() time.Duration {
	mins := h.Settings.GetInt("VERIFICATION_CODE_EXPIRY_MINUTES", 30)
	return time.Duration(mins) * time.Minute
}

// writeDevEcho 关键安全修复:仅在 APP_ENV=development 时回显。
// 生产环境即便 RESEND_API_KEY 没设置,也绝不向响应里塞验证码——避免
// "运维忘填 RESEND key 导致全网用户拿到验证码" 的事故。
func (h *AuthHandler) writeDevEcho(body map[string]any, code string) {
	if !h.Cfg.IsProduction() {
		body["devCode"] = code
	}
}

type publicUser struct {
	ID            string `json:"id"`
	Email         string `json:"email"`
	Name          string `json:"name"`
	Role          string `json:"role"`
	Avatar        string `json:"avatar"`
	Bio           string `json:"bio"`
	EmailVerified bool   `json:"emailVerified"`
}

func toPublicUser(u *model.User) publicUser {
	return publicUser{
		ID: u.ID, Email: u.Email, Name: u.Name, Role: u.Role,
		Avatar: u.Avatar, Bio: u.Bio, EmailVerified: u.EmailVerified,
	}
}

// ─── /register ────────────────────────────────────────────────────────────

func (h *AuthHandler) register(c echo.Context) error {
	type req struct {
		Email          string `json:"email"`
		Password       string `json:"password"`
		Name           string `json:"name"`
		TurnstileToken string `json:"turnstileToken"`
	}
	var in req
	if err := c.Bind(&in); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "请求体无效")
	}
	in.Email = validator.NormalizeEmail(in.Email)
	in.Name = strings.TrimSpace(in.Name)

	if err := validator.ValidateEmail(in.Email); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	if err := validator.ValidatePassword(in.Password); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	if err := validator.ValidateName(in.Name); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}

	ip := ratelimit.ClientIP(c.Request())
	if d := h.rl("register:ip", ip, "RL_REGISTER_IP_MAX", "RL_REGISTER_IP_WINDOW_MINUTES", 10, 60); !d.Allowed {
		return rateLimited(c, d)
	}
	if d := h.rl("register:email", in.Email, "RL_REGISTER_EMAIL_MAX", "RL_REGISTER_EMAIL_WINDOW_MINUTES", 5, 60); !d.Allowed {
		return rateLimited(c, d)
	}

	if err := h.Turnstile.Verify(c.Request().Context(), in.TurnstileToken, ip); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "人机验证失败")
	}

	if _, err := h.Users.FindByEmail(in.Email); err == nil {
		return echo.NewHTTPError(http.StatusConflict, "该邮箱已注册")
	}

	hash, err := auth.HashPassword(in.Password)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "密码处理失败")
	}

	// 关键修复:password hash 进 pending_registrations 而不是 vcode.meta。
	expires := time.Now().Add(h.vcodeExpiry())
	if err := h.Pending.Upsert(in.Email, hash, in.Name, expires); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "服务器错误")
	}

	code := newCode()
	if _, err := h.VCodes.Issue(repository.IssueInput{
		Email: in.Email, Code: code, Type: model.VCodeRegister,
		IP: ip, ExpiresAt: expires,
	}); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "服务器错误")
	}

	subject, htmlBody, textBody := email.ComposeVerificationCode(
		h.Settings.Get("SITE_NAME"), "注册账号", code,
		h.Settings.GetInt("VERIFICATION_CODE_EXPIRY_MINUTES", 30),
	)
	_ = h.Email.Send(c.Request().Context(), in.Email, subject, htmlBody, textBody)

	body := map[string]any{"success": true, "message": "验证码已发送,请查收邮件"}
	h.writeDevEcho(body, code)
	return c.JSON(http.StatusOK, body)
}

// ─── /register/confirm ────────────────────────────────────────────────────

func (h *AuthHandler) registerConfirm(c echo.Context) error {
	type req struct {
		Email string `json:"email"`
		Code  string `json:"code"`
	}
	var in req
	if err := c.Bind(&in); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "请求体无效")
	}
	in.Email = validator.NormalizeEmail(in.Email)
	in.Code = strings.TrimSpace(in.Code)

	v, err := h.VCodes.FindActive(in.Email, model.VCodeRegister)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "验证码无效或已过期")
	}
	if expired, _ := time.Parse(time.RFC3339, v.ExpiresAt); time.Now().After(expired) {
		return echo.NewHTTPError(http.StatusBadRequest, "验证码已过期")
	}
	maxAttempts := h.Settings.GetInt("VERIFICATION_CODE_MAX_ATTEMPTS", 5)
	if v.Attempts >= maxAttempts {
		return echo.NewHTTPError(http.StatusBadRequest, "验证码错误次数过多,请重新发送")
	}
	if !h.VCodes.VerifyCode(v.CodeHash, in.Code) {
		_, _ = h.VCodes.IncrementAttempts(v.ID)
		return echo.NewHTTPError(http.StatusBadRequest, "验证码错误")
	}

	// 原子消费验证码
	consumed, err := h.VCodes.ConsumeIfUnused(v.ID)
	if err != nil || !consumed {
		return echo.NewHTTPError(http.StatusBadRequest, "验证码已被使用")
	}

	// 取出 pending_registrations 数据(原子取出 + 删除)
	pending, err := h.Pending.Take(in.Email)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "会话已失效,请重新注册")
	}

	u, err := h.Users.Create(repository.CreateInput{
		Email:         in.Email,
		PasswordHash:  pending.PasswordHash,
		Name:          pending.Name,
		Role:          model.RoleUser,
		EmailVerified: true,
	})
	if err != nil {
		return echo.NewHTTPError(http.StatusConflict, "该邮箱已注册")
	}

	_ = h.ActivityLog.Record(model.ActivityLog{
		UserID: u.ID, Username: u.Name, Email: u.Email,
		Action: "user.register", Detail: "用户注册并验证邮箱",
		IP: ratelimit.ClientIP(c.Request()),
	})

	token, err := h.Signer.Sign(u.ID, u.Email, u.Role)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "签发会话失败")
	}
	h.setAuthCookie(c, token)
	return c.JSON(http.StatusOK, map[string]any{
		"success": true,
		"user":    toPublicUser(u),
	})
}

// ─── /login ───────────────────────────────────────────────────────────────

func (h *AuthHandler) login(c echo.Context) error {
	type req struct {
		Email          string `json:"email"`
		Password       string `json:"password"`
		TurnstileToken string `json:"turnstileToken"`
	}
	var in req
	if err := c.Bind(&in); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "请求体无效")
	}
	in.Email = validator.NormalizeEmail(in.Email)
	if in.Email == "" || in.Password == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "邮箱和密码不能为空")
	}

	ip := ratelimit.ClientIP(c.Request())
	ua := c.Request().UserAgent()

	if d := h.rl("login:ip", ip, "RL_LOGIN_IP_MAX", "RL_LOGIN_IP_WINDOW_MINUTES", 20, 1); !d.Allowed {
		return rateLimited(c, d)
	}
	if d := h.rl("login:email", in.Email, "RL_LOGIN_EMAIL_MAX", "RL_LOGIN_EMAIL_WINDOW_MINUTES", 10, 5); !d.Allowed {
		return rateLimited(c, d)
	}

	if err := h.Turnstile.Verify(c.Request().Context(), in.TurnstileToken, ip); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "人机验证失败")
	}

	u, _ := h.Users.FindByEmail(in.Email)
	var hash string
	var userID string
	if u != nil {
		hash = u.PasswordHash
		userID = u.ID
	}
	ok := auth.ConstantTimeVerify(hash, in.Password)
	if !ok || u == nil {
		reason := "密码错误"
		if u == nil {
			reason = "用户不存在"
		}
		_ = h.LoginHistory.Record(model.LoginHistory{
			UserID: userID, Email: in.Email, IP: ip, UserAgent: ua,
			Success: false, Reason: reason,
		})
		return echo.NewHTTPError(http.StatusUnauthorized, "邮箱或密码错误")
	}

	if !u.EmailVerified {
		_ = h.LoginHistory.Record(model.LoginHistory{
			UserID: u.ID, Email: u.Email, IP: ip, UserAgent: ua,
			Success: false, Reason: "邮箱未验证",
		})
		return c.JSON(http.StatusForbidden, map[string]any{
			"error": "请先验证邮箱后再登录",
			"code":  "EMAIL_NOT_VERIFIED",
		})
	}
	if u.Status != model.StatusActive {
		_ = h.LoginHistory.Record(model.LoginHistory{
			UserID: u.ID, Email: u.Email, IP: ip, UserAgent: ua,
			Success: false, Reason: "账号不可用",
		})
		return echo.NewHTTPError(http.StatusForbidden, "账号不可用")
	}

	_ = h.LoginHistory.Record(model.LoginHistory{
		UserID: u.ID, Email: u.Email, IP: ip, UserAgent: ua, Success: true,
	})
	_ = h.Users.UpdateLastLogin(u.ID, ip)
	_ = h.ActivityLog.Record(model.ActivityLog{
		UserID: u.ID, Username: u.Name, Email: u.Email,
		Action: "user.login", Detail: "用户登录", IP: ip,
	})

	token, err := h.Signer.Sign(u.ID, u.Email, u.Role)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "签发会话失败")
	}
	h.setAuthCookie(c, token)
	return c.JSON(http.StatusOK, map[string]any{
		"success": true,
		"user":    toPublicUser(u),
	})
}

func (h *AuthHandler) logout(c echo.Context) error {
	h.clearAuthCookie(c)
	return c.JSON(http.StatusOK, map[string]any{"success": true})
}

// ─── /forgot-password ────────────────────────────────────────────────────

func (h *AuthHandler) forgotPassword(c echo.Context) error {
	type req struct {
		Email          string `json:"email"`
		TurnstileToken string `json:"turnstileToken"`
	}
	var in req
	if err := c.Bind(&in); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "请求体无效")
	}
	in.Email = validator.NormalizeEmail(in.Email)
	if err := validator.ValidateEmail(in.Email); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}

	ip := ratelimit.ClientIP(c.Request())
	if d := h.rl("forgot:ip", ip, "RL_FORGOT_IP_MAX", "RL_FORGOT_IP_WINDOW_MINUTES", 20, 60); !d.Allowed {
		return rateLimited(c, d)
	}
	if d := h.rl("forgot:email", in.Email, "RL_FORGOT_EMAIL_MAX", "RL_FORGOT_EMAIL_WINDOW_MINUTES", 5, 60); !d.Allowed {
		return rateLimited(c, d)
	}
	if err := h.Turnstile.Verify(c.Request().Context(), in.TurnstileToken, ip); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "人机验证失败")
	}

	body := map[string]any{"success": true, "message": "如该邮箱已注册,重置验证码已发送"}

	u, err := h.Users.FindByEmail(in.Email)
	if err != nil {
		return c.JSON(http.StatusOK, body)
	}

	code := newCode()
	if _, err := h.VCodes.Issue(repository.IssueInput{
		Email: u.Email, Code: code, Type: model.VCodeForgotPassword,
		IP: ip, ExpiresAt: time.Now().Add(h.vcodeExpiry()),
	}); err != nil {
		return c.JSON(http.StatusOK, body)
	}

	subject, htmlBody, textBody := email.ComposeVerificationCode(
		h.Settings.Get("SITE_NAME"), "重置密码", code,
		h.Settings.GetInt("VERIFICATION_CODE_EXPIRY_MINUTES", 30),
	)
	_ = h.Email.Send(c.Request().Context(), u.Email, subject, htmlBody, textBody)

	h.writeDevEcho(body, code)
	return c.JSON(http.StatusOK, body)
}

// ─── /reset-password ─────────────────────────────────────────────────────

func (h *AuthHandler) resetPassword(c echo.Context) error {
	type req struct {
		Email       string `json:"email"`
		Code        string `json:"code"`
		NewPassword string `json:"newPassword"`
	}
	var in req
	if err := c.Bind(&in); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "请求体无效")
	}
	in.Email = validator.NormalizeEmail(in.Email)
	in.Code = strings.TrimSpace(in.Code)
	if err := validator.ValidatePassword(in.NewPassword); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}

	u, err := h.Users.FindByEmail(in.Email)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "验证码无效或已过期")
	}

	v, err := h.VCodes.FindActive(in.Email, model.VCodeForgotPassword)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "验证码无效或已过期")
	}
	if expired, _ := time.Parse(time.RFC3339, v.ExpiresAt); time.Now().After(expired) {
		return echo.NewHTTPError(http.StatusBadRequest, "验证码已过期")
	}
	if v.Attempts >= h.Settings.GetInt("VERIFICATION_CODE_MAX_ATTEMPTS", 5) {
		return echo.NewHTTPError(http.StatusBadRequest, "验证码错误次数过多,请重新发送")
	}
	if !h.VCodes.VerifyCode(v.CodeHash, in.Code) {
		_, _ = h.VCodes.IncrementAttempts(v.ID)
		return echo.NewHTTPError(http.StatusBadRequest, "验证码错误")
	}

	consumed, err := h.VCodes.ConsumeIfUnused(v.ID)
	if err != nil || !consumed {
		return echo.NewHTTPError(http.StatusBadRequest, "验证码已被使用")
	}

	hash, err := auth.HashPassword(in.NewPassword)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "密码处理失败")
	}
	if err := h.Users.SetPassword(u.ID, hash); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "更新密码失败")
	}
	_ = h.ActivityLog.Record(model.ActivityLog{
		UserID: u.ID, Username: u.Name, Email: u.Email,
		Action: "user.password_reset", Detail: "通过邮件重置密码",
		IP: ratelimit.ClientIP(c.Request()),
	})
	return c.JSON(http.StatusOK, map[string]any{"success": true, "message": "密码已重置,请使用新密码登录"})
}

// ─── /verify-email ───────────────────────────────────────────────────────

func (h *AuthHandler) verifyEmailSend(c echo.Context) error {
	type req struct {
		Email string `json:"email"`
	}
	var in req
	if err := c.Bind(&in); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "请求体无效")
	}
	in.Email = validator.NormalizeEmail(in.Email)
	if err := validator.ValidateEmail(in.Email); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}

	ip := ratelimit.ClientIP(c.Request())
	if d := h.rl("verify-email:ip", ip, "RL_REGISTER_IP_MAX", "RL_REGISTER_IP_WINDOW_MINUTES", 10, 60); !d.Allowed {
		return rateLimited(c, d)
	}

	body := map[string]any{"success": true, "message": "若该邮箱存在,验证码已发送"}

	u, err := h.Users.FindByEmail(in.Email)
	if err != nil {
		return c.JSON(http.StatusOK, body)
	}
	if u.EmailVerified {
		return c.JSON(http.StatusOK, map[string]any{"success": true, "message": "邮箱已验证,无需再次操作"})
	}

	code := newCode()
	if _, err := h.VCodes.Issue(repository.IssueInput{
		Email: u.Email, Code: code, Type: model.VCodeEmailVerify,
		IP: ip, ExpiresAt: time.Now().Add(h.vcodeExpiry()),
	}); err != nil {
		return c.JSON(http.StatusOK, body)
	}

	subject, htmlBody, textBody := email.ComposeVerificationCode(
		h.Settings.Get("SITE_NAME"), "验证邮箱", code,
		h.Settings.GetInt("VERIFICATION_CODE_EXPIRY_MINUTES", 30),
	)
	_ = h.Email.Send(c.Request().Context(), u.Email, subject, htmlBody, textBody)
	h.writeDevEcho(body, code)
	return c.JSON(http.StatusOK, body)
}

func (h *AuthHandler) verifyEmailConfirm(c echo.Context) error {
	type req struct {
		Email string `json:"email"`
		Code  string `json:"code"`
	}
	var in req
	if err := c.Bind(&in); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "请求体无效")
	}
	in.Email = validator.NormalizeEmail(in.Email)
	in.Code = strings.TrimSpace(in.Code)

	u, err := h.Users.FindByEmail(in.Email)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "验证失败")
	}
	v, err := h.VCodes.FindActive(in.Email, model.VCodeEmailVerify)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "验证码无效或已过期")
	}
	if expired, _ := time.Parse(time.RFC3339, v.ExpiresAt); time.Now().After(expired) {
		return echo.NewHTTPError(http.StatusBadRequest, "验证码已过期")
	}
	if v.Attempts >= h.Settings.GetInt("VERIFICATION_CODE_MAX_ATTEMPTS", 5) {
		return echo.NewHTTPError(http.StatusBadRequest, "验证码错误次数过多,请重新发送")
	}
	if !h.VCodes.VerifyCode(v.CodeHash, in.Code) {
		_, _ = h.VCodes.IncrementAttempts(v.ID)
		return echo.NewHTTPError(http.StatusBadRequest, "验证码错误")
	}
	consumed, err := h.VCodes.ConsumeIfUnused(v.ID)
	if err != nil || !consumed {
		return echo.NewHTTPError(http.StatusBadRequest, "验证码已被使用")
	}
	if err := h.Users.MarkEmailVerified(u.ID); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "更新失败")
	}
	return c.JSON(http.StatusOK, map[string]any{"success": true, "message": "邮箱已验证"})
}

// ─── /me /turnstile-config ───────────────────────────────────────────────

func (h *AuthHandler) me(c echo.Context) error {
	u := middleware.User(c)
	if u == nil {
		return echo.NewHTTPError(http.StatusUnauthorized, "未登录")
	}
	return c.JSON(http.StatusOK, map[string]any{"user": toPublicUser(u)})
}

func (h *AuthHandler) turnstileConfig(c echo.Context) error {
	return c.JSON(http.StatusOK, map[string]any{
		"enabled": h.Turnstile.Enabled(),
		"siteKey": h.Settings.Get("TURNSTILE_SITE_KEY"),
	})
}

// ─── Shared ─────────────────────────────────────────────────────────────

func rateLimited(c echo.Context, d ratelimit.Decision) error {
	c.Response().Header().Set("Retry-After", itoa(d.RetryAfter))
	return echo.NewHTTPError(http.StatusTooManyRequests,
		fmt.Sprintf("请求过于频繁,请 %d 秒后重试", d.RetryAfter))
}

func itoa(n int) string {
	if n <= 0 {
		return "1"
	}
	return fmt.Sprintf("%d", n)
}

func ctxWithTimeout(d time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), d)
}

var _ = ctxWithTimeout
