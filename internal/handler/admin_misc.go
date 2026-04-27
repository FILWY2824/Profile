package handler

import (
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/labstack/echo/v4"

	"github.com/qishu/profile/internal/email"
	"github.com/qishu/profile/internal/repository"
	"github.com/qishu/profile/internal/settings"
	"github.com/qishu/profile/internal/turnstile"
	"github.com/qishu/profile/internal/validator"
)

type AdminSettingsHandler struct {
	Settings    *settings.Store
	ActivityLog *repository.ActivityLogRepo

	// 关键修复:管理员保存设置后,Turnstile/Email 服务需要立即看到新值,
	// 否则 RESEND_API_KEY / TURNSTILE_* 等改动只对重启后生效。
	Turnstile *turnstile.Verifier
	Email     *email.Sender
}

func (h *AdminSettingsHandler) Register(g *echo.Group) {
	g.GET("", h.list)
	g.PATCH("", h.update)
}

func (h *AdminSettingsHandler) list(c echo.Context) error {
	rows, err := h.Settings.List()
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "查询失败")
	}
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

	allowed := make(map[string]bool, len(settings.Managed))
	for _, m := range settings.Managed {
		allowed[m.Key] = true
	}

	keysWritten := []string{}
	touchTurnstile := false
	touchEmail := false
	for _, u := range in.Updates {
		if !allowed[u.Key] {
			return echo.NewHTTPError(http.StatusBadRequest, "未知的设置键:"+u.Key)
		}
		if strings.HasPrefix(u.Value, "••••") {
			continue
		}
		if len(u.Value) > validator.MaxSettingValueLen {
			return echo.NewHTTPError(http.StatusBadRequest, "value 过长")
		}
		if err := h.Settings.Set(u.Key, u.Value); err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, "保存失败")
		}
		keysWritten = append(keysWritten, u.Key)

		switch u.Key {
		case "TURNSTILE_ENABLED", "TURNSTILE_SECRET_KEY", "TURNSTILE_SITE_KEY", "TURNSTILE_SEND_REMOTEIP":
			touchTurnstile = true
		case "RESEND_API_KEY", "RESEND_FROM":
			touchEmail = true
		}
	}

	// 关键修复:settings 改动后立即热重载相应服务。
	if touchTurnstile && h.Turnstile != nil {
		h.Turnstile.Reload(
			h.Settings.Get("TURNSTILE_SECRET_KEY"),
			h.Settings.GetBool("TURNSTILE_ENABLED"),
			h.Settings.GetBool("TURNSTILE_SEND_REMOTEIP"),
		)
	}
	if touchEmail && h.Email != nil {
		h.Email.Reload(
			h.Settings.Get("RESEND_API_KEY"),
			h.Settings.Get("RESEND_FROM"),
		)
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

	// DataDir 是 sqlite 数据库 + 任何持久化文件落地的目录。dashboard 用它
	// 计算"占用磁盘"。空值时返回 -1,前端按"未知"显示。
	DataDir string
}

func (h *AdminDashboardHandler) Register(g *echo.Group) {
	g.GET("", h.summary)
}

func (h *AdminDashboardHandler) summary(c echo.Context) error {
	usersByRole, err := h.Users.CountByRole()
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "查询失败")
	}
	totalUsers, _ := h.Users.Count()
	sectionCount, _ := h.Sections.Count()
	cardCount, _ := h.Cards.Count()

	disk := dirDiskUsage(h.DataDir)

	return c.JSON(http.StatusOK, map[string]any{
		"users": map[string]any{
			"total":  totalUsers,
			"byRole": usersByRole,
		},
		"sections": sectionCount,
		"cards":    cardCount,
		"disk":     disk,
	})
}

// dirDiskUsage 把 DataDir 整个走一遍,返回总字节、文件数、子项分布
// (db / wal / shm / 其它),供前端展示。读不到目录返回 totalBytes=-1。
//
// 设计取舍:
//   - 不缓存。dashboard 是低频请求(管理员手动刷),走一遍 stat 比维护
//     缓存 + 失效逻辑简单。即使数据目录上百 MiB,filepath.Walk 也是 ms 级。
//   - 跳过隐藏文件以及目录自身的 size(目录的 Size() 是平台相关的元数据
//     大小,不是内容大小,加进去会让前端总数对不上 du 输出)。
//   - 单独切出 SQLite 三件套 (.db / .db-wal / .db-shm),让管理员一眼
//     看出"主库占多少、WAL 占多少"。
func dirDiskUsage(dataDir string) map[string]any {
	out := map[string]any{
		"path":       dataDir,
		"totalBytes": int64(-1),
		"fileCount":  0,
		"dbBytes":    int64(0),
		"walBytes":   int64(0),
		"shmBytes":   int64(0),
		"otherBytes": int64(0),
	}
	if dataDir == "" {
		return out
	}
	abs, err := filepath.Abs(dataDir)
	if err == nil {
		out["path"] = abs
	}
	if _, err := os.Stat(dataDir); err != nil {
		// 目录不存在或不可读 — 返回 -1 让前端区分"读取失败"与"0 字节"
		return out
	}

	var total int64
	var fileCount int
	var db, wal, shm, other int64
	walkErr := filepath.WalkDir(dataDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			// 单个 entry 读失败时跳过,继续走完整个目录。这样权限被改过
			// 的某一个文件不会让整个统计返回 -1。
			return nil
		}
		if d.IsDir() {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		size := info.Size()
		total += size
		fileCount++

		name := strings.ToLower(d.Name())
		switch {
		case strings.HasSuffix(name, ".db-wal"):
			wal += size
		case strings.HasSuffix(name, ".db-shm"):
			shm += size
		case strings.HasSuffix(name, ".db"):
			db += size
		default:
			other += size
		}
		return nil
	})
	if walkErr != nil {
		// 顶层 walk 失败(目录被删等)— 仍然返回 -1
		return out
	}

	out["totalBytes"] = total
	out["fileCount"] = fileCount
	out["dbBytes"] = db
	out["walBytes"] = wal
	out["shmBytes"] = shm
	out["otherBytes"] = other
	return out
}

// ─── Global audit ────────────────────────────────────────────────────────

type AdminAuditHandler struct {
	LoginHistory *repository.LoginHistoryRepo
	ActivityLog  *repository.ActivityLogRepo
}

func (h *AdminAuditHandler) Register(g *echo.Group) {
	g.GET("/login-history", h.loginHistory)
	g.GET("/activity-log", h.activityLog)
}

func (h *AdminAuditHandler) loginHistory(c echo.Context) error {
	p := readPagination(c, 10, 1000)
	rows, err := h.LoginHistory.ListAll(p.Limit, p.Offset)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "查询失败")
	}
	total, _ := h.LoginHistory.Count()
	return c.JSON(http.StatusOK, map[string]any{
		"items": rows, "total": total, "limit": p.Limit, "offset": p.Offset,
	})
}

func (h *AdminAuditHandler) activityLog(c echo.Context) error {
	p := readPagination(c, 10, 1000)
	rows, err := h.ActivityLog.ListAll(p.Limit, p.Offset)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "查询失败")
	}
	total, _ := h.ActivityLog.Count()
	return c.JSON(http.StatusOK, map[string]any{
		"items": rows, "total": total, "limit": p.Limit, "offset": p.Offset,
	})
}

// ─── Manual retention prune ──────────────────────────────────────────────

type AdminRetentionHandler struct {
	VCodes       *repository.VCodeRepo
	LoginHistory *repository.LoginHistoryRepo
	ActivityLog  *repository.ActivityLogRepo
	Pending      *repository.PendingRepo
	OAuthCodes   *repository.OAuthCodeRepo
	OAuthTokens  *repository.OAuthTokenRepo
	Favicons     *repository.FaviconRepo
	Settings     *settings.Store
	Audit        *repository.ActivityLogRepo
}

func (h *AdminRetentionHandler) Register(g *echo.Group) {
	g.POST("/:table/prune", h.prune)
}

// prune 支持的 table 值:
//
//	vcodes               过期验证码
//	pending              过期待注册
//	login-history        登录历史(按 LOGIN_HISTORY_RETENTION_DAYS)
//	activity-log         活动日志(按 ACTIVITY_LOG_RETENTION_DAYS)
//	oauth-codes          过期 OAuth 授权码
//	oauth-tokens-expired 过期 OAuth access/refresh token
//	favicons             全部图标缓存(没有"过期"概念,直接清空,需要时会
//	                     按需重新抓)
func (h *AdminRetentionHandler) prune(c echo.Context) error {
	table := c.Param("table")
	var n int64
	var err error
	switch table {
	case "vcodes":
		n, err = h.VCodes.PruneExpired()
	case "pending":
		n, err = h.Pending.PruneExpired()
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
	case "oauth-codes":
		if h.OAuthCodes != nil {
			n, err = h.OAuthCodes.PruneExpired()
		}
	case "oauth-tokens-expired":
		if h.OAuthTokens != nil {
			n, err = h.OAuthTokens.PruneExpired()
		}
	case "favicons":
		if h.Favicons != nil {
			n, err = h.Favicons.DeleteAll()
		}
	default:
		return echo.NewHTTPError(http.StatusBadRequest, "未知的表:"+table)
	}
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "清理失败")
	}
	_ = h.Audit.Record(auditFromCtx(c, "admin.retention_prune",
		"手动清理 "+table, ""))
	return c.JSON(http.StatusOK, map[string]any{"success": true, "removed": n})
}
