// admin_users.go — administrator user management. All routes here are
// guarded by middleware.MustAdmin upstream, so handlers can assume the
// caller is an active admin.
//
// Safety check that affects every mutating handler in this file:
// "you must not be able to lock yourself out". That means:
//   - You can't demote the last admin
//   - You can't disable/ban the last admin
//   - You can't delete the last admin
//   - You can't delete yourself outright (separate from the above; even
//     if there are other admins, deleting your own account in flight is
//     too easy to do by accident)
package handler

import (
	"net/http"
	"strings"

	"github.com/labstack/echo/v4"

	"github.com/qishu/profile/internal/auth"
	"github.com/qishu/profile/internal/middleware"
	"github.com/qishu/profile/internal/model"
	"github.com/qishu/profile/internal/repository"
	"github.com/qishu/profile/internal/validator"
)

type AdminUsersHandler struct {
	Users        *repository.UserRepo
	ActivityLog  *repository.ActivityLogRepo
	OAuthTokens  *repository.OAuthTokenRepo
	OAuthGrants  *repository.OAuthGrantRepo
	OAuthCodes   *repository.OAuthCodeRepo
}

func (h *AdminUsersHandler) Register(g *echo.Group) {
	g.GET("", h.list)
	g.POST("", h.create)
	g.PATCH("/:id", h.update)
	g.DELETE("/:id", h.delete)
}

func (h *AdminUsersHandler) list(c echo.Context) error {
	role := c.QueryParam("role")
	status := c.QueryParam("status")
	p := readPagination(c, 10, 500)
	users, err := h.Users.List(role, status, p.Limit, p.Offset)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	total, _ := h.Users.Count()
	return c.JSON(http.StatusOK, map[string]any{
		"items": users, "total": total, "limit": p.Limit, "offset": p.Offset,
	})
}

func (h *AdminUsersHandler) create(c echo.Context) error {
	type req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
		Name     string `json:"name"`
		Role     string `json:"role"`
	}
	var in req
	if err := c.Bind(&in); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "请求体无效")
	}
	in.Email = validator.NormalizeEmail(in.Email)
	in.Name = strings.TrimSpace(in.Name)
	if in.Role == "" {
		in.Role = model.RoleUser
	}

	if err := validator.ValidateEmail(in.Email); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	if err := validator.ValidatePassword(in.Password); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	if err := validator.ValidateName(in.Name); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	if err := validator.ValidateRole(in.Role); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}

	if _, err := h.Users.FindByEmail(in.Email); err == nil {
		return echo.NewHTTPError(http.StatusConflict, "该邮箱已存在")
	}

	hash, err := auth.HashPassword(in.Password)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "密码处理失败")
	}
	u, err := h.Users.Create(repository.CreateInput{
		Email: in.Email, PasswordHash: hash, Name: in.Name,
		Role: in.Role, EmailVerified: true, // admin-created → trust admin
	})
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "创建失败")
	}
	_ = h.ActivityLog.Record(auditFromCtx(c, "admin.user_create",
		"管理员创建用户:"+in.Email, u.ID))
	return c.JSON(http.StatusCreated, u)
}

func (h *AdminUsersHandler) update(c echo.Context) error {
	id := c.Param("id")
	target, err := h.Users.FindByID(id)
	if err != nil {
		return notFoundIfRepoMissing(err)
	}

	type req struct {
		Name   *string `json:"name"`
		Role   *string `json:"role"`
		Status *string `json:"status"`
		Bio    *string `json:"bio"`
	}
	var in req
	if err := c.Bind(&in); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "请求体无效")
	}

	name, role, status, bio := target.Name, target.Role, target.Status, target.Bio
	if in.Name != nil {
		name = strings.TrimSpace(*in.Name)
		if err := validator.ValidateName(name); err != nil {
			return echo.NewHTTPError(http.StatusBadRequest, err.Error())
		}
	}
	if in.Role != nil {
		role = *in.Role
		if err := validator.ValidateRole(role); err != nil {
			return echo.NewHTTPError(http.StatusBadRequest, err.Error())
		}
	}
	if in.Status != nil {
		status = *in.Status
		switch status {
		case model.StatusActive, model.StatusBanned, model.StatusDisabled:
		default:
			return echo.NewHTTPError(http.StatusBadRequest, "status 必须是 active/banned/disabled")
		}
	}
	if in.Bio != nil {
		bio = *in.Bio
		if err := validator.ValidateBio(bio); err != nil {
			return echo.NewHTTPError(http.StatusBadRequest, err.Error())
		}
	}

	// Last-admin safety. Only run the count if this update would remove
	// admin status (demote OR ban OR disable) from a current admin.
	if target.Role == model.RoleAdmin {
		isLosingAdminPower := role != model.RoleAdmin || status != model.StatusActive
		if isLosingAdminPower {
			n, err := h.Users.CountAdmins()
			if err != nil {
				return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
			}
			if n <= 1 {
				return echo.NewHTTPError(http.StatusBadRequest, "不能修改最后一个活跃管理员")
			}
		}
	}

	if err := h.Users.AdminUpdate(id, name, role, status, bio); err != nil {
		return notFoundIfRepoMissing(err)
	}
	_ = h.ActivityLog.Record(auditFromCtx(c, "admin.user_update",
		"管理员修改用户:"+target.Email, id))

	updated, _ := h.Users.FindByID(id)
	return c.JSON(http.StatusOK, updated)
}

func (h *AdminUsersHandler) delete(c echo.Context) error {
	id := c.Param("id")
	target, err := h.Users.FindByID(id)
	if err != nil {
		return notFoundIfRepoMissing(err)
	}

	me := middleware.User(c)
	if me.ID == id {
		return echo.NewHTTPError(http.StatusBadRequest, "不能删除自己")
	}
	if target.Role == model.RoleAdmin {
		n, err := h.Users.CountAdmins()
		if err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
		}
		if n <= 1 {
			return echo.NewHTTPError(http.StatusBadRequest, "不能删除最后一个活跃管理员")
		}
	}

	if err := h.Users.Delete(id); err != nil {
		return notFoundIfRepoMissing(err)
	}

	// 级联清理 OAuth 资源
	if h.OAuthTokens != nil {
		_, _ = h.OAuthTokens.DeleteByUserID(id)
	}
	if h.OAuthGrants != nil {
		_, _ = h.OAuthGrants.DeleteByUserID(id)
	}
	if h.OAuthCodes != nil {
		_, _ = h.OAuthCodes.DeleteByUserID(id)
	}

	_ = h.ActivityLog.Record(auditFromCtx(c, "admin.user_delete",
		"管理员删除用户:"+target.Email, id))
	return c.JSON(http.StatusOK, map[string]any{"success": true})
}
