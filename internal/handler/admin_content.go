// admin_content.go — sections and cards. Both are simple CRUD with input
// validation: section slugs are uniqueness-constrained at the DB level and
// regex-checked at the handler level; card URLs go through urlsafe to keep
// `javascript:` style payloads from landing in the DB.
package handler

import (
	"context"
	"net/http"
	"strings"

	"github.com/labstack/echo/v4"

	"github.com/qishu/profile/internal/repository"
	"github.com/qishu/profile/internal/urlsafe"
	"github.com/qishu/profile/internal/validator"
)

type AdminSectionsHandler struct {
	Sections    *repository.SectionRepo
	ActivityLog *repository.ActivityLogRepo
}

func (h *AdminSectionsHandler) Register(g *echo.Group) {
	g.GET("", h.list)
	g.POST("", h.create)
	g.PATCH("/:id", h.update)
	g.DELETE("/:id", h.delete)
}

func (h *AdminSectionsHandler) list(c echo.Context) error {
	out, err := h.Sections.FindAll()
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	return c.JSON(http.StatusOK, map[string]any{"items": out})
}

type sectionReq struct {
	Name        string `json:"name"`
	Slug        string `json:"slug"`
	Description string `json:"description"`
	SortOrder   int    `json:"order"`
}

func (in *sectionReq) validate() error {
	in.Name = strings.TrimSpace(in.Name)
	in.Slug = strings.TrimSpace(in.Slug)
	if err := validator.ValidateLen("板块名", in.Name, 1, validator.MaxSectionNameLen); err != nil {
		return err
	}
	if err := validator.ValidateSlug(in.Slug); err != nil {
		return err
	}
	if err := validator.ValidateLen("板块描述", in.Description, 0, validator.MaxSectionDescLen); err != nil {
		return err
	}
	return nil
}

func (h *AdminSectionsHandler) create(c echo.Context) error {
	var in sectionReq
	if err := c.Bind(&in); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "请求体无效")
	}
	if err := in.validate(); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	if existing, err := h.Sections.FindBySlug(in.Slug); err == nil && existing != nil {
		return echo.NewHTTPError(http.StatusConflict, "slug 已存在")
	}
	s, err := h.Sections.Create(repository.SectionInput{
		Name: in.Name, Slug: in.Slug, Description: in.Description,
		SortOrder: in.SortOrder,
	})
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	_ = h.ActivityLog.Record(auditFromCtx(c, "admin.section_create",
		"创建板块:"+in.Name, s.ID))
	return c.JSON(http.StatusCreated, s)
}

func (h *AdminSectionsHandler) update(c echo.Context) error {
	id := c.Param("id")
	target, err := h.Sections.FindByID(id)
	if err != nil {
		return notFoundIfRepoMissing(err)
	}

	var in sectionReq
	if err := c.Bind(&in); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "请求体无效")
	}
	if err := in.validate(); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	// Slug uniqueness — allow keeping the same slug, reject if it now
	// collides with another row.
	if in.Slug != target.Slug {
		if existing, _ := h.Sections.FindBySlug(in.Slug); existing != nil {
			return echo.NewHTTPError(http.StatusConflict, "slug 已存在")
		}
	}

	s, err := h.Sections.Update(id, repository.SectionInput{
		Name: in.Name, Slug: in.Slug, Description: in.Description,
		SortOrder: in.SortOrder,
	})
	if err != nil {
		return notFoundIfRepoMissing(err)
	}
	_ = h.ActivityLog.Record(auditFromCtx(c, "admin.section_update",
		"更新板块:"+target.Name, id))
	return c.JSON(http.StatusOK, s)
}

func (h *AdminSectionsHandler) delete(c echo.Context) error {
	id := c.Param("id")
	target, err := h.Sections.FindByID(id)
	if err != nil {
		return notFoundIfRepoMissing(err)
	}
	if err := h.Sections.Delete(id); err != nil {
		return notFoundIfRepoMissing(err)
	}
	_ = h.ActivityLog.Record(auditFromCtx(c, "admin.section_delete",
		"删除板块:"+target.Name, id))
	return c.JSON(http.StatusOK, map[string]any{"success": true})
}

// ─── Cards ────────────────────────────────────────────────────────────────

type AdminCardsHandler struct {
	Cards       *repository.CardRepo
	ActivityLog *repository.ActivityLogRepo

	// Favicons 让卡片的 创建/更新/删除 操作能联动图标缓存:
	//   - 新建/改 URL → 删旧 origin(若孤儿)+ 抓新 origin
	//   - 删卡片     → 删 origin(若孤儿)
	// 见 favicon.go 的 EnsureFreshForOrigin / DropIfOrphan。
	// 允许为 nil 以便单元测试不强依赖整个 favicon 抓取链路。
	Favicons *FaviconHandler
}

func (h *AdminCardsHandler) Register(g *echo.Group) {
	g.GET("", h.list)
	g.POST("", h.create)
	g.PATCH("/:id", h.update)
	g.DELETE("/:id", h.delete)
}

func (h *AdminCardsHandler) list(c echo.Context) error {
	out, err := h.Cards.FindAll()
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	return c.JSON(http.StatusOK, map[string]any{"items": out})
}

type cardReq struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	URL         string `json:"url"`
	SectionID   string `json:"sectionId"`
	SortOrder   int    `json:"order"`
	Permission  string `json:"permission"`
}

func (in *cardReq) validate() (string, error) {
	in.Title = strings.TrimSpace(in.Title)
	in.URL = strings.TrimSpace(in.URL)
	if err := validator.ValidateLen("卡片标题", in.Title, 1, validator.MaxCardTitleLen); err != nil {
		return "", err
	}
	if err := validator.ValidateLen("卡片描述", in.Description, 0, validator.MaxCardDescLen); err != nil {
		return "", err
	}
	if len(in.URL) > validator.MaxCardURLLen {
		return "", echo.NewHTTPError(http.StatusBadRequest, "URL 过长")
	}
	// urlsafe: refuse javascript:, data:, etc. The card's URL renders as a
	// clickable link in the homepage UI — not sanitising here would let
	// admins (or compromised admin accounts) plant click-to-XSS payloads.
	cleanURL := urlsafe.SanitizeHTTPURLOrEmpty(in.URL)
	if cleanURL == "" {
		return "", echo.NewHTTPError(http.StatusBadRequest, "URL 必须是 http(s) 链接")
	}
	if in.Permission == "" {
		in.Permission = "public"
	}
	if err := validator.ValidatePermission(in.Permission); err != nil {
		return "", err
	}
	return cleanURL, nil
}

func (h *AdminCardsHandler) create(c echo.Context) error {
	var in cardReq
	if err := c.Bind(&in); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "请求体无效")
	}
	cleanURL, err := in.validate()
	if err != nil {
		return err
	}
	created, err := h.Cards.Create(repository.CardInput{
		Title: in.Title, Description: in.Description, URL: cleanURL,
		SectionID: in.SectionID, SortOrder: in.SortOrder,
		Permission: in.Permission,
	})
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	_ = h.ActivityLog.Record(auditFromCtx(c, "admin.card_create",
		"创建卡片:"+in.Title, created.ID))
	// 抓新卡片对应 origin 的图标 — 异步,不阻塞响应。用 background ctx,
	// 因为 echo 的请求 ctx 在响应写出后会被 cancel。
	if h.Favicons != nil {
		go h.Favicons.EnsureFreshForOrigin(context.Background(), cleanURL)
	}
	return c.JSON(http.StatusCreated, created)
}

func (h *AdminCardsHandler) update(c echo.Context) error {
	id := c.Param("id")
	target, err := h.Cards.FindByID(id)
	if err != nil {
		return notFoundIfRepoMissing(err)
	}

	var in cardReq
	if err := c.Bind(&in); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "请求体无效")
	}
	cleanURL, err := in.validate()
	if err != nil {
		return err
	}
	// 记下旧 URL,稍后用于决定是否需要丢弃旧 origin 的图标。
	oldURL := target.URL

	updated, err := h.Cards.Update(id, repository.CardInput{
		Title: in.Title, Description: in.Description, URL: cleanURL,
		SectionID: in.SectionID, SortOrder: in.SortOrder,
		Permission: in.Permission,
	})
	if err != nil {
		return notFoundIfRepoMissing(err)
	}
	_ = h.ActivityLog.Record(auditFromCtx(c, "admin.card_update",
		"更新卡片:"+target.Title, id))
	// URL 变了 → 旧 origin 的图标可能成孤儿,新 origin 需要拉一份新图标。
	// URL 没变就不动:重抓没意义,反而浪费一次外网请求。
	if h.Favicons != nil && oldURL != cleanURL {
		go func(oldU, newU string) {
			ctx := context.Background()
			h.Favicons.DropIfOrphan(oldU)
			h.Favicons.EnsureFreshForOrigin(ctx, newU)
		}(oldURL, cleanURL)
	}
	return c.JSON(http.StatusOK, updated)
}

func (h *AdminCardsHandler) delete(c echo.Context) error {
	id := c.Param("id")
	target, err := h.Cards.FindByID(id)
	if err != nil {
		return notFoundIfRepoMissing(err)
	}
	if err := h.Cards.Delete(id); err != nil {
		return notFoundIfRepoMissing(err)
	}
	_ = h.ActivityLog.Record(auditFromCtx(c, "admin.card_delete",
		"删除卡片:"+target.Title, id))
	// 卡片删除后 origin 可能成孤儿 — 异步丢弃缓存即可。
	if h.Favicons != nil {
		go h.Favicons.DropIfOrphan(target.URL)
	}
	return c.JSON(http.StatusOK, map[string]any{"success": true})
}
