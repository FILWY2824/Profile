// account.go — endpoints under /api/account/*. Mounted with MustAuth, so
// every handler can assume middleware.User(c) != nil.
//
// Scope of this file:
//   - GET  /api/account/profile             user reads themselves
//   - PATCH /api/account/profile            user edits name/bio/avatar
//   - POST  /api/account/password/send-code request a code to allow change
//   - POST  /api/account/password/change    submit code + new password
//   - GET   /api/account/login-history      user views their own login history
//   - GET   /api/account/activity           user views their own activity log
//
// Why password change is a two-step flow: a stolen session cookie should
// not let an attacker change the password. Requiring an emailed code means
// the attacker needs the email account too. The code is bound to the
// user's email at the time it's issued — changing email beforehand doesn't
// help an attacker.
package handler

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/labstack/echo/v4"

	"github.com/qishu/profile/internal/auth"
	"github.com/qishu/profile/internal/email"
	"github.com/qishu/profile/internal/middleware"
	"github.com/qishu/profile/internal/model"
	"github.com/qishu/profile/internal/ratelimit"
	"github.com/qishu/profile/internal/repository"
	"github.com/qishu/profile/internal/settings"
	"github.com/qishu/profile/internal/validator"
)

type AccountHandler struct {
	Settings     *settings.Store
	Email        email.Sender
	Limiter      ratelimit.Limiter
	Users        *repository.UserRepo
	VCodes       *repository.VCodeRepo
	LoginHistory *repository.LoginHistoryRepo
	ActivityLog  *repository.ActivityLogRepo
}

func (h *AccountHandler) Register(g *echo.Group) {
	g.GET("/profile", h.getProfile)
	g.PATCH("/profile", h.updateProfile)
	g.POST("/password/send-code", h.passwordSendCode)
	g.POST("/password/change", h.passwordChange)
	g.GET("/login-history", h.loginHistory)
	g.GET("/activity", h.activity)
}

func (h *AccountHandler) getProfile(c echo.Context) error {
	u := middleware.User(c)
	return c.JSON(http.StatusOK, map[string]any{
		"id": u.ID, "email": u.Email, "name": u.Name, "role": u.Role,
		"avatar": u.Avatar, "bio": u.Bio, "emailVerified": u.EmailVerified,
		"lastLoginAt": u.LastLoginAt, "createdAt": u.CreatedAt,
	})
}

func (h *AccountHandler) updateProfile(c echo.Context) error {
	type req struct {
		Name   *string `json:"name"`
		Bio    *string `json:"bio"`
		Avatar *string `json:"avatar"`
	}
	var in req
	if err := c.Bind(&in); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "请求体无效")
	}
	u := middleware.User(c)

	// Patch semantics: only fields present in the body change. Unspecified
	// fields stay as-is. We use *string to distinguish "absent" from
	// "explicitly empty string".
	name, bio, avatar := u.Name, u.Bio, u.Avatar
	if in.Name != nil {
		name = strings.TrimSpace(*in.Name)
		if err := validator.ValidateName(name); err != nil {
			return echo.NewHTTPError(http.StatusBadRequest, err.Error())
		}
	}
	if in.Bio != nil {
		bio = *in.Bio
		if err := validator.ValidateBio(bio); err != nil {
			return echo.NewHTTPError(http.StatusBadRequest, err.Error())
		}
	}
	if in.Avatar != nil {
		avatar = *in.Avatar
		// Avatar is a URL OR a data: URI for small uploads. We accept
		// either and only sanity-check max length here. Rendering side
		// must escape.
		if len(avatar) > 65536 {
			return echo.NewHTTPError(http.StatusBadRequest, "头像数据过大")
		}
	}

	if err := h.Users.UpdateProfile(u.ID, name, bio, avatar); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "更新失败")
	}
	_ = h.ActivityLog.Record(auditFromCtx(c, "account.profile_update", "更新个人资料", ""))
	return c.JSON(http.StatusOK, map[string]any{"success": true})
}

// passwordSendCode emails a verification code that authorises a follow-up
// password change. Rate-limited per user.
func (h *AccountHandler) passwordSendCode(c echo.Context) error {
	u := middleware.User(c)

	// Hard cap by user — generous for legit retries, tight enough to limit
	// abuse if a session cookie leaks.
	if d := h.Limiter.Allow("acc:pw_code", u.ID, ratelimit.Rule{Max: 3, Window: 30 * time.Minute}); !d.Allowed {
		return rateLimited(c, d)
	}

	code := newCode()
	expiry := time.Duration(h.Settings.GetInt("VERIFICATION_CODE_EXPIRY_MINUTES", 30)) * time.Minute
	_, err := h.VCodes.Issue(repository.IssueInput{
		Email: u.Email, Code: code, Type: model.VCodeChangePassword,
		IP: ratelimit.ClientIP(c.Request()),
		ExpiresAt: time.Now().Add(expiry),
	})
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "发码失败")
	}

	subject, htmlBody, textBody := email.ComposeVerificationCode(
		h.Settings.Get("SITE_NAME"), "修改密码", code,
		h.Settings.GetInt("VERIFICATION_CODE_EXPIRY_MINUTES", 30),
	)
	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()
	_ = h.Email.Send(ctx, u.Email, subject, htmlBody, textBody)

	body := map[string]any{"success": true, "message": "验证码已发送至您的邮箱"}
	if h.Email.DevMode() {
		body["devCode"] = code
	}
	return c.JSON(http.StatusOK, body)
}

func (h *AccountHandler) passwordChange(c echo.Context) error {
	type req struct {
		Code        string `json:"code"`
		OldPassword string `json:"oldPassword"`
		NewPassword string `json:"newPassword"`
	}
	var in req
	if err := c.Bind(&in); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "请求体无效")
	}
	u := middleware.User(c)

	in.Code = strings.TrimSpace(in.Code)
	if err := validator.ValidatePassword(in.NewPassword); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	// Two-factor: code AND old password. Either alone insufficient.
	if !auth.ConstantTimeVerify(u.PasswordHash, in.OldPassword) {
		return echo.NewHTTPError(http.StatusBadRequest, "旧密码错误")
	}

	v, err := h.VCodes.FindActive(u.Email, model.VCodeChangePassword)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "验证码无效或已过期")
	}
	if expired, _ := time.Parse(time.RFC3339, v.ExpiresAt); time.Now().After(expired) {
		return echo.NewHTTPError(http.StatusBadRequest, "验证码已过期")
	}
	if v.Attempts >= h.Settings.GetInt("VERIFICATION_CODE_MAX_ATTEMPTS", 5) {
		return echo.NewHTTPError(http.StatusBadRequest, "验证码错误次数过多,请重新发送")
	}
	if !auth.ConstantTimeEqual(v.Code, in.Code) {
		_, _ = h.VCodes.IncrementAttempts(v.ID)
		return echo.NewHTTPError(http.StatusBadRequest, "验证码错误")
	}

	hash, err := auth.HashPassword(in.NewPassword)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "密码处理失败")
	}
	if err := h.Users.SetPassword(u.ID, hash); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "更新失败")
	}
	_ = h.VCodes.MarkUsed(v.ID)
	_ = h.ActivityLog.Record(auditFromCtx(c, "account.password_change", "用户修改密码", ""))

	return c.JSON(http.StatusOK, map[string]any{
		"success": true,
		"message": "密码已修改,请使用新密码重新登录",
	})
}

// loginHistory shows the current user's recent logins. Capped at 50 by
// default — that's enough for the "recent activity" UX without dumping
// the whole history at once.
func (h *AccountHandler) loginHistory(c echo.Context) error {
	u := middleware.User(c)
	p := readPagination(c, 50, 200)
	rows, err := h.LoginHistory.ListByUser(u.ID, p.Limit)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "查询失败")
	}
	return c.JSON(http.StatusOK, map[string]any{"items": rows})
}

func (h *AccountHandler) activity(c echo.Context) error {
	u := middleware.User(c)
	cap := h.Settings.GetInt("USER_ACTIVITY_LOG_CAP", 30)
	p := readPagination(c, cap, cap)
	if cap > 0 && p.Limit > cap {
		p.Limit = cap
	}
	rows, err := h.ActivityLog.ListByUser(u.ID, p.Limit)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "查询失败")
	}
	return c.JSON(http.StatusOK, map[string]any{"items": rows})
}
