// public.go — endpoints that are reachable without authentication. Note:
// "without authentication" doesn't mean "without context" — the Session
// middleware still runs and attaches the user if a cookie/Bearer is
// present. The homepage uses that to decide which cards a viewer can see.
//
// 安全策略 (2026-04):
//   - 卡片真实 URL 绝不发到前端。只有授权检查通过后,通过
//     /api/cards/:id/go 端点在服务器侧 302 跳转。这样恶意访问者无法
//     从前端 HTML 反查到内网部署的具体地址 / 端口。
//   - 卡片的 favicon 通过 /api/cards/:id/icon 端点延迟代理,避免暴露
//     "卡片站点的 origin"(同样可能泄漏内网信息)。
package handler

import (
	"net/http"

	"github.com/labstack/echo/v4"

	"github.com/qishu/profile/internal/middleware"
	"github.com/qishu/profile/internal/model"
	"github.com/qishu/profile/internal/repository"
	"github.com/qishu/profile/internal/settings"
)

type PublicHandler struct {
	Sections    *repository.SectionRepo
	Cards       *repository.CardRepo
	ActivityLog *repository.ActivityLogRepo
	Settings    *settings.Store
}

func (h *PublicHandler) Register(g *echo.Group) {
	g.GET("/healthz", h.healthz)
	g.GET("/homepage", h.homepage)
	g.GET("/cards/:id/go", h.cardGo)
}

func (h *PublicHandler) healthz(c echo.Context) error {
	return c.JSON(http.StatusOK, map[string]any{"status": "ok"})
}

// publicCard 是卡片在主页 JSON 里的投影。注意:不再含 url / origin —
// 哪怕是有权限的用户也只拿到一个 id 与基础元信息,要跳转得走
// /api/cards/:id/go,要图标得走 /api/cards/:id/icon。这是一道额外的
// 反信息泄漏护栏:即便有人盯着 devtools network panel 也看不到部署
// 在内网端口的真实路径。
type publicCard struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description,omitempty"`
	SectionID   string `json:"sectionId,omitempty"`
	SortOrder   int    `json:"order"`
	Permission  string `json:"permission"`
	// HostHint 是一个去标识的提示,例如 "github" 或 "gitlab",供前端在
	// 小灰字显示;真实 host 不会出现。空字符串表示没有 hint。
	HostHint string `json:"hostHint,omitempty"`
	Locked   bool   `json:"locked,omitempty"`
	LockReason string `json:"lockReason,omitempty"`
}

// canSee implements the permission ladder:
//
//	public  → everyone
//	user    → any logged-in user
//	member  → user role >= member (member or admin)
//	admin   → admin only
//
// Banned users see only public; the Session middleware already strips
// non-active users from the context, so non-nil u here implies active.
func canSee(perm string, u *model.User) (bool, string) {
	switch perm {
	case model.PermPublic, "":
		return true, ""
	case model.PermUser:
		if u == nil {
			return false, "登录后可见"
		}
		return true, ""
	case model.PermMember:
		if u == nil {
			return false, "登录后可见"
		}
		if u.Role == model.RoleMember || u.Role == model.RoleAdmin {
			return true, ""
		}
		return false, "会员可见"
	case model.PermAdmin:
		if u == nil {
			return false, "登录后可见"
		}
		if u.Role == model.RoleAdmin {
			return true, ""
		}
		return false, "管理员可见"
	}
	// Unknown permission strings are treated as "admin only" — fail closed.
	if u != nil && u.Role == model.RoleAdmin {
		return true, ""
	}
	return false, "受限"
}

// homepage returns sections + permission-projected cards. The current user
// (if any) is included so the FE can render the header without a separate
// /api/auth/me call.
func (h *PublicHandler) homepage(c echo.Context) error {
	user := middleware.User(c)

	sections, err := h.Sections.FindAll()
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "查询板块失败")
	}
	cards, err := h.Cards.FindAll()
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "查询卡片失败")
	}

	siteName := ""
	siteDescription := ""
	if h.Settings != nil {
		siteName = h.Settings.Get("SITE_NAME")
		siteDescription = h.Settings.Get("SITE_DESCRIPTION")
	}

	out := make([]publicCard, 0, len(cards))
	for _, card := range cards {
		ok, reason := canSee(card.Permission, user)
		base := publicCard{
			ID: card.ID, Title: card.Title, SectionID: card.SectionID,
			SortOrder: card.SortOrder, Permission: card.Permission,
		}
		if ok {
			base.Description = card.Description
		} else {
			base.Locked = true
			base.LockReason = reason
		}
		out = append(out, base)
	}

	var current any
	if user != nil {
		current = map[string]any{
			"id": user.ID, "email": user.Email, "name": user.Name,
			"role": user.Role, "avatar": user.Avatar,
		}
	}

	return c.JSON(http.StatusOK, map[string]any{
		"sections":        sections,
		"cards":           out,
		"currentUser":     current,
		"siteName":        siteName,
		"siteDescription": siteDescription,
	})
}

// cardGo 把"点击卡片"翻译成服务器侧 302 跳转。这样:
//
//   - 前端永远拿不到真实 URL,即便用户在 Inspector 里看 fetch 也只能
//     看到 /api/cards/<id>/go 这个不透明 ID。
//   - 权限检查在服务器侧。即使有人猜到了 ID,如果他没有权限,不会
//     被跳转到任何地方。
//   - 我们顺手记一条 audit 日志(用户访问了哪个卡片),管理员能在审计
//     页看到。
func (h *PublicHandler) cardGo(c echo.Context) error {
	id := c.Param("id")
	user := middleware.User(c)

	card, err := h.Cards.FindByID(id)
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "卡片不存在")
	}
	if ok, reason := canSee(card.Permission, user); !ok {
		// 不暴露 reason 给非登录用户(避免枚举差异),但登录用户给 reason
		// 是合理的 — 他们至少知道是因为权限不够。
		if user != nil {
			return echo.NewHTTPError(http.StatusForbidden, reason)
		}
		return echo.NewHTTPError(http.StatusUnauthorized, "请先登录")
	}

	if h.ActivityLog != nil && user != nil {
		// 仅记录登录用户的点击。匿名访客不写 audit(噪声太多)。
		_ = h.ActivityLog.Record(auditFromCtx(c, "card.visit",
			"访问卡片: "+card.Title, card.ID))
	}

	// 302 而不是 301 — 因为权限可能变(用户被降权后,缓存的 301 会
	// 让浏览器永久误跳)。
	return c.Redirect(http.StatusFound, card.URL)
}
