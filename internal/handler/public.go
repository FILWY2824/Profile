// public.go — endpoints that are reachable without authentication. Note:
// "without authentication" doesn't mean "without context" — the Session
// middleware still runs and attaches the user if a cookie/Bearer is
// present. The homepage uses that to decide which cards a viewer can see.
package handler

import (
	"net/http"

	"github.com/labstack/echo/v4"

	"github.com/qishu/profile/internal/middleware"
	"github.com/qishu/profile/internal/model"
	"github.com/qishu/profile/internal/repository"
)

type PublicHandler struct {
	Sections *repository.SectionRepo
	Cards    *repository.CardRepo
}

func (h *PublicHandler) Register(g *echo.Group) {
	g.GET("/healthz", h.healthz)
	g.GET("/homepage", h.homepage)
}

func (h *PublicHandler) healthz(c echo.Context) error {
	return c.JSON(http.StatusOK, map[string]any{"status": "ok"})
}

// publicCard is the projection a card takes when the viewer has access.
// lockedCard is what they get when they don't — name + reason, no URL/desc.
// Same JSON shape with a discriminator field `locked` so the FE can render
// either branch from one component.
type publicCard struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description,omitempty"`
	URL         string `json:"url,omitempty"`
	SectionID   string `json:"sectionId,omitempty"`
	SortOrder   int    `json:"order"`
	Permission  string `json:"permission"`
	Locked      bool   `json:"locked,omitempty"`
	LockReason  string `json:"lockReason,omitempty"`
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

	out := make([]publicCard, 0, len(cards))
	for _, card := range cards {
		ok, reason := canSee(card.Permission, user)
		if ok {
			out = append(out, publicCard{
				ID: card.ID, Title: card.Title, Description: card.Description,
				URL: card.URL, SectionID: card.SectionID, SortOrder: card.SortOrder,
				Permission: card.Permission,
			})
		} else {
			out = append(out, publicCard{
				ID: card.ID, Title: card.Title, SectionID: card.SectionID,
				SortOrder: card.SortOrder, Permission: card.Permission,
				Locked: true, LockReason: reason,
			})
		}
	}

	var current any
	if user != nil {
		current = map[string]any{
			"id": user.ID, "email": user.Email, "name": user.Name,
			"role": user.Role, "avatar": user.Avatar,
		}
	}

	return c.JSON(http.StatusOK, map[string]any{
		"sections":    sections,
		"cards":       out,
		"currentUser": current,
	})
}
