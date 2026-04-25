// admin_misc.go — small admin endpoints that don't justify their own file:
//   - settings list/update
//   - dashboard counts
//   - global login-history and activity-log read
//   - manual retention prune
//
// All routes here require admin (registered under the admin group in main).
package handler

import (
	"net/http"
	"strings"
	"time"

	"github.com/labstack/echo/v4"

	"github.com/qishu/profile/internal/repository"
	"github.com/qishu/profile/internal/settings"
	"github.com/qishu/profile/internal/validator"
)

type AdminSettingsHandler struct {
	Settings    *settings.Store
	ActivityLog *repository.ActivityLogRepo
}

func (h *AdminSettingsHandler) Register(g *echo.Group) {
	g.GET("", h.list)
	g.PATCH("", h.update)
}

func (h *AdminSettingsHandler) list(c echo.Context) error {
	rows, err := h.Settings.List()
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	// Sensitive values are masked on the wire — UI shows "••••" with a
	// "Reveal" button that calls a separate endpoint. For phase 2 we only
	// implement the masked-list shape; reveal can come in phase 3 if you
	// need it.
	out := make([]settings.Row, 0, len(rows))
	for _, r := range rows {
		if r.Sensitive && r.Value != "" {
			r.Value = "••••••••"
		}
		out = append(out, r)
	}
	return c.JSON(http.StatusOK, map[string]any{"items": out})
}

func (h *AdminSettingsHandler) update(c echo.Context) error {
	type kv struct {
		Key   string `json:"key"`
		Value string `json:"value"`
	}
	type req struct {
		Updates []kv `json:"updates"`
	}
	var in req
	if err := c.Bind(&in); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "请求体无效")
	}
	if len(in.Updates) == 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "无更新项")
	}

	// Acceptlist: only Managed keys can be written. Prevents an attacker
	// (or a buggy FE) from injecting arbitrary key=value pairs.
	allowed := make(map[string]bool, len(settings.Managed))
	for _, m := range settings.Managed {
		allowed[m.Key] = true
	}

	keysWritten := []string{}
	for _, u := range in.Updates {
		if !allowed[u.Key] {
			return echo.NewHTTPError(http.StatusBadRequest, "未知的设置键:"+u.Key)
		}
		// Sentinel: if the FE sends back the masked dots, we don't
		// overwrite — that means the operator didn't change a sensitive
		// field but the form posted everything.
		if strings.HasPrefix(u.Value, "••••") {
			continue
		}
		if len(u.Value) > validator.MaxSettingValueLen {
			return echo.NewHTTPError(http.StatusBadRequest, "value 过长")
		}
		if err := h.Settings.Set(u.Key, u.Value); err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
		}
		keysWritten = append(keysWritten, u.Key)
	}

	if len(keysWritten) > 0 {
		_ = h.ActivityLog.Record(auditFromCtx(c, "admin.settings_update",
			"修改设置:"+strings.Join(keysWritten, ", "), ""))
	}
	return c.JSON(http.StatusOK, map[string]any{
		"success": true, "updated": keysWritten,
	})
}

// ─── Dashboard ────────────────────────────────────────────────────────────

type AdminDashboardHandler struct {
	Users    *repository.UserRepo
	Sections *repository.SectionRepo
	Cards    *repository.CardRepo
}

func (h *AdminDashboardHandler) Register(g *echo.Group) {
	g.GET("", h.summary)
}

func (h *AdminDashboardHandler) summary(c echo.Context) error {
	usersByRole, err := h.Users.CountByRole()
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	totalUsers, _ := h.Users.Count()
	sectionCount, _ := h.Sections.Count()
	cardCount, _ := h.Cards.Count()

	return c.JSON(http.StatusOK, map[string]any{
		"users": map[string]any{
			"total":   totalUsers,
			"byRole":  usersByRole,
		},
		"sections": sectionCount,
		"cards":    cardCount,
	})
}

// ─── Global audit (admin-only) ───────────────────────────────────────────

type AdminAuditHandler struct {
	LoginHistory *repository.LoginHistoryRepo
	ActivityLog  *repository.ActivityLogRepo
}

func (h *AdminAuditHandler) Register(g *echo.Group) {
	g.GET("/login-history", h.loginHistory)
	g.GET("/activity-log", h.activityLog)
}

func (h *AdminAuditHandler) loginHistory(c echo.Context) error {
	p := readPagination(c, 100, 1000)
	rows, err := h.LoginHistory.ListAll(p.Limit, p.Offset)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	return c.JSON(http.StatusOK, map[string]any{
		"items": rows, "limit": p.Limit, "offset": p.Offset,
	})
}

func (h *AdminAuditHandler) activityLog(c echo.Context) error {
	p := readPagination(c, 100, 1000)
	rows, err := h.ActivityLog.ListAll(p.Limit, p.Offset)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	return c.JSON(http.StatusOK, map[string]any{
		"items": rows, "limit": p.Limit, "offset": p.Offset,
	})
}

// ─── Manual retention prune ──────────────────────────────────────────────

type AdminRetentionHandler struct {
	VCodes       *repository.VCodeRepo
	LoginHistory *repository.LoginHistoryRepo
	ActivityLog  *repository.ActivityLogRepo
	Settings     *settings.Store
	Audit        *repository.ActivityLogRepo
}

func (h *AdminRetentionHandler) Register(g *echo.Group) {
	g.POST("/:table/prune", h.prune)
}

// prune runs an immediate cleanup of one table. The :table param maps to:
//   - vcodes        →  VCodeRepo.PruneExpired()
//   - login-history →  LoginHistoryRepo.PruneOlderThan(retention)
//   - activity-log  →  ActivityLogRepo.PruneOlderThan(retention)
// Anything else returns 400.
func (h *AdminRetentionHandler) prune(c echo.Context) error {
	table := c.Param("table")
	var n int64
	var err error
	switch table {
	case "vcodes":
		n, err = h.VCodes.PruneExpired()
	case "login-history":
		retain := h.Settings.GetInt("LOGIN_HISTORY_RETENTION_DAYS", 30)
		if retain < 0 {
			return c.JSON(http.StatusOK, map[string]any{"removed": 0, "message": "保留天数为 -1,跳过"})
		}
		cutoff := time.Now().Add(-time.Duration(retain) * 24 * time.Hour)
		n, err = h.LoginHistory.PruneOlderThan(cutoff)
	case "activity-log":
		retain := h.Settings.GetInt("ACTIVITY_LOG_RETENTION_DAYS", 30)
		if retain < 0 {
			return c.JSON(http.StatusOK, map[string]any{"removed": 0, "message": "保留天数为 -1,跳过"})
		}
		cutoff := time.Now().Add(-time.Duration(retain) * 24 * time.Hour)
		n, err = h.ActivityLog.PruneOlderThan(cutoff)
	default:
		return echo.NewHTTPError(http.StatusBadRequest, "未知的表:"+table)
	}
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	_ = h.Audit.Record(auditFromCtx(c, "admin.retention_prune",
		"手动清理 "+table, ""))
	return c.JSON(http.StatusOK, map[string]any{"success": true, "removed": n})
}
