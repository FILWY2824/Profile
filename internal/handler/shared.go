// shared.go — small helpers used by every handler file in this package.
// Goal: keep the per-endpoint code focused on its own logic. Anything that
// shows up in 3+ handlers lives here.
package handler

import (
	"net/http"
	"strconv"

	"github.com/labstack/echo/v4"

	"github.com/qishu/profile/internal/middleware"
	"github.com/qishu/profile/internal/model"
	"github.com/qishu/profile/internal/ratelimit"
	"github.com/qishu/profile/internal/repository"
)

// pagination reads ?limit=&offset= with sane defaults and a hard cap, so a
// hostile client can't request limit=10000000 and exhaust DB memory.
type pagination struct {
	Limit  int
	Offset int
}

func readPagination(c echo.Context, defLimit, maxLimit int) pagination {
	limit, _ := strconv.Atoi(c.QueryParam("limit"))
	if limit <= 0 {
		limit = defLimit
	}
	if limit > maxLimit {
		limit = maxLimit
	}
	offset, _ := strconv.Atoi(c.QueryParam("offset"))
	if offset < 0 {
		offset = 0
	}
	return pagination{Limit: limit, Offset: offset}
}

// auditFromCtx is shorthand for "log this action attributed to the current
// session user". Returns a partly-filled ActivityLog the caller fills in.
func auditFromCtx(c echo.Context, action, detail, target string) model.ActivityLog {
	u := middleware.User(c)
	a := model.ActivityLog{
		Action: action, Detail: detail, Target: target,
		IP: ratelimit.ClientIP(c.Request()),
	}
	if u != nil {
		a.UserID = u.ID
		a.Username = u.Name
		a.Email = u.Email
	}
	return a
}

// AdminMux groups everything an admin handler needs — passing one struct
// instead of 15 parameters keeps the constructor lines reasonable. Each
// admin handler file embeds *AdminMux and only uses the fields it needs.
type AdminMux struct {
	Users        *repository.UserRepo
	Sections     *repository.SectionRepo
	Cards        *repository.CardRepo
	LoginHistory *repository.LoginHistoryRepo
	ActivityLog  *repository.ActivityLogRepo
	Favicons     *repository.FaviconRepo
	VCodes       *repository.VCodeRepo
}

// notFoundIfRepoMissing collapses repository.ErrNotFound to a 404 reply,
// passing other errors through as 500. Saves a try/catch dance in each
// handler.
func notFoundIfRepoMissing(err error) error {
	if err == nil {
		return nil
	}
	if err == repository.ErrNotFound {
		return echo.NewHTTPError(http.StatusNotFound, "未找到")
	}
	return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
}
