// favicon.go — favicon proxy and admin management.
//
// Two distinct surfaces, deliberately separated:
//
//   PUBLIC READ — GET /api/favicons/image?origin=...
//     Anyone (including anonymous viewers) can hit this. It returns the
//     cached favicon for an origin. Two layers of protection:
//
//       1. Origin must already be referenced by some card (CardRepo
//          .ReferencesOrigin). An attacker cannot ask the server to fetch
//          arbitrary origins — only origins an admin has already vouched
//          for via the cards UI.
//
//       2. Even after the cards-reference check, when we go fetch the icon
//          on a cache miss, the SSRF guard resolves the host first and
//          rejects private/loopback/cloud-metadata addresses. So an admin
//          accidentally adding a card with URL http://169.254.169.254/...
//          still won't leak metadata.
//
//   ADMIN MANAGEMENT — /api/admin/favicons/*
//     Mounted under MustAdmin upstream. Lets admins:
//       - GET   /         see what's been cached and inspect failures
//       - POST  /refresh  force-refetch a single origin (bust cache)
//       - DELETE /:origin remove a cached entry
//
//     Non-admins cannot reach any of these paths — Echo's MustAdmin
//     middleware short-circuits with 403 before the handler runs.
package handler

import (
	"context"
	"crypto/md5"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/labstack/echo/v4"

	"github.com/qishu/profile/internal/repository"
	"github.com/qishu/profile/internal/ssrf"
	"github.com/qishu/profile/internal/urlsafe"
)

// FaviconHandler caps outbound requests at 8 seconds and 256 KB. Both are
// generous defaults — favicons are tiny — but bound the impact of a
// hostile origin returning a slow infinite stream.
const (
	faviconFetchTimeout = 8 * time.Second
	faviconMaxBytes     = 256 * 1024
)

type FaviconHandler struct {
	Cards       *repository.CardRepo
	Favicons    *repository.FaviconRepo
	ActivityLog *repository.ActivityLogRepo

	// In-flight dedup: when 50 viewers hit /favicons/image?origin=X at the
	// same time and the cache is empty, only one outbound fetch should
	// happen. This is the standard "thundering herd" mitigation.
	inflightMu sync.Mutex
	inflight   map[string]*sync.WaitGroup
}

// NewFaviconHandler wires up the inflight map. Required because Go's zero
// value for a map is nil and we can't assign to a nil map.
func NewFaviconHandler(cards *repository.CardRepo, favicons *repository.FaviconRepo, audit *repository.ActivityLogRepo) *FaviconHandler {
	return &FaviconHandler{
		Cards: cards, Favicons: favicons, ActivityLog: audit,
		inflight: make(map[string]*sync.WaitGroup),
	}
}

// RegisterPublic mounts the public read endpoint. Mount under /api (no
// auth middleware required upstream).
func (h *FaviconHandler) RegisterPublic(g *echo.Group) {
	g.GET("/favicons/image", h.image)
}

// RegisterAdmin mounts the admin management endpoints. Mount under
// /api/admin (MustAdmin already in the chain).
func (h *FaviconHandler) RegisterAdmin(g *echo.Group) {
	g.GET("", h.listAdmin)
	g.POST("/refresh", h.refreshAdmin)
	g.DELETE("/:origin", h.deleteAdmin)
}

// canonicalOrigin normalises scheme://host[:port] for cache lookups.
// Returns "" if the input isn't a safe http(s) URL.
func canonicalOrigin(raw string) string {
	if !urlsafe.IsSafeHTTPURL(raw) {
		return ""
	}
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	scheme := strings.ToLower(u.Scheme)
	host := strings.ToLower(u.Host)
	return scheme + "://" + host
}

// image is the public read handler.
func (h *FaviconHandler) image(c echo.Context) error {
	originParam := c.QueryParam("origin")
	origin := canonicalOrigin(originParam)
	if origin == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "无效的 origin")
	}

	// Layer 1: must be referenced by at least one card.
	referenced, err := h.Cards.ReferencesOrigin(origin)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	if !referenced {
		// 404 is intentional — don't leak whether we'd accept it if it were
		// referenced.
		return echo.NewHTTPError(http.StatusNotFound, "未找到")
	}

	// Cache hit fast path.
	if cached, err := h.Favicons.Get(origin); err == nil && cached.DataURL != "" {
		return h.writeImageFromDataURL(c, cached.DataURL, cached.ContentType)
	}

	// Cache miss — fetch with thundering-herd dedup.
	if err := h.fetchAndCache(c.Request().Context(), origin); err != nil {
		// Record failure but still respond gracefully — the FE can show a
		// fallback icon.
		return echo.NewHTTPError(http.StatusBadGateway, "获取 favicon 失败")
	}

	cached, err := h.Favicons.Get(origin)
	if err != nil || cached.DataURL == "" {
		return echo.NewHTTPError(http.StatusBadGateway, "获取 favicon 失败")
	}
	return h.writeImageFromDataURL(c, cached.DataURL, cached.ContentType)
}

// fetchAndCache resolves the origin, dials with the SSRF guard, downloads
// up to faviconMaxBytes, and stores the data: URL in the cache table.
//
// One fetch in flight per origin: callers contending for the same origin
// share a sync.WaitGroup and only the first dispatcher hits the network.
func (h *FaviconHandler) fetchAndCache(parent context.Context, origin string) error {
	h.inflightMu.Lock()
	if wg, ok := h.inflight[origin]; ok {
		h.inflightMu.Unlock()
		// Wait for the first fetcher; cache should be populated when we
		// resume.
		wg.Wait()
		return nil
	}
	wg := &sync.WaitGroup{}
	wg.Add(1)
	h.inflight[origin] = wg
	h.inflightMu.Unlock()

	defer func() {
		h.inflightMu.Lock()
		delete(h.inflight, origin)
		h.inflightMu.Unlock()
		wg.Done()
	}()

	ctx, cancel := context.WithTimeout(parent, faviconFetchTimeout)
	defer cancel()

	// Layer 2: SSRF guard. Resolve the host and reject private ranges
	// before we dial.
	u, err := url.Parse(origin)
	if err != nil {
		return err
	}
	host := u.Hostname()
	if _, err := ssrf.ResolveAndCheck(host); err != nil {
		_ = h.Favicons.Upsert(repository.FaviconRow{
			Origin: origin, Source: "ssrf-blocked",
			LastError: err.Error(),
		})
		return err
	}

	client := &http.Client{
		Timeout: faviconFetchTimeout,
		// Dial through a guarded dialer so a redirect mid-fetch can't
		// drop us into a private range.
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
				h, _, _ := net.SplitHostPort(addr)
				if _, err := ssrf.ResolveAndCheck(h); err != nil {
					return nil, err
				}
				var d net.Dialer
				return d.DialContext(ctx, network, addr)
			},
			MaxIdleConns:          5,
			IdleConnTimeout:       30 * time.Second,
			TLSHandshakeTimeout:   5 * time.Second,
			ResponseHeaderTimeout: 5 * time.Second,
		},
	}

	target := strings.TrimRight(origin, "/") + "/favicon.ico"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "qishu-favicon-fetcher/1.0")

	resp, err := client.Do(req)
	if err != nil {
		_ = h.Favicons.Upsert(repository.FaviconRow{
			Origin: origin, LastError: err.Error(), FailedAttempts: 1,
		})
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		_ = h.Favicons.Upsert(repository.FaviconRow{
			Origin: origin, LastError: "http " + resp.Status, FailedAttempts: 1,
		})
		return errors.New("status " + resp.Status)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, faviconMaxBytes))
	if err != nil {
		return err
	}
	if len(body) == 0 {
		return errors.New("empty body")
	}

	ct := resp.Header.Get("Content-Type")
	if ct == "" {
		ct = "image/x-icon"
	}
	dataURL := "data:" + ct + ";base64," + base64.StdEncoding.EncodeToString(body)

	return h.Favicons.Upsert(repository.FaviconRow{
		Origin: origin, DataURL: dataURL, ContentType: ct,
		Source: "fetch", FetchedAt: time.Now().UTC().Format(time.RFC3339),
	})
}

// writeImageFromDataURL parses a stored data: URL and writes the raw bytes
// with proper Content-Type. Cheaper than re-parsing on every request would
// be to store the bytes binary, but data: URLs make manual SQL inspection
// readable.
func (h *FaviconHandler) writeImageFromDataURL(c echo.Context, dataURL, fallbackType string) error {
	// dataURL format: data:<ct>;base64,<payload>
	const prefix = "data:"
	if !strings.HasPrefix(dataURL, prefix) {
		return echo.NewHTTPError(http.StatusInternalServerError, "缓存数据损坏")
	}
	rest := dataURL[len(prefix):]
	semi := strings.IndexByte(rest, ';')
	comma := strings.IndexByte(rest, ',')
	if semi < 0 || comma < 0 || comma < semi {
		return echo.NewHTTPError(http.StatusInternalServerError, "缓存数据损坏")
	}
	ct := rest[:semi]
	if ct == "" {
		ct = fallbackType
	}
	payload := rest[comma+1:]
	bytes, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "缓存数据损坏")
	}

	// Weak ETag — a hash of the content. Browsers will revalidate when
	// it changes (we never invalidate manually; admin "refresh" overwrites).
	hash := md5.Sum(bytes)
	etag := `"` + hex.EncodeToString(hash[:8]) + `"`
	c.Response().Header().Set("ETag", etag)
	c.Response().Header().Set("Cache-Control", "public, max-age=86400")
	if match := c.Request().Header.Get("If-None-Match"); match == etag {
		return c.NoContent(http.StatusNotModified)
	}
	return c.Blob(http.StatusOK, ct, bytes)
}

// ─── Admin management ────────────────────────────────────────────────────

func (h *FaviconHandler) listAdmin(c echo.Context) error {
	rows, err := h.Favicons.List()
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	// Don't ship the data URL bytes back — admin UI just wants the metadata.
	type adminRow struct {
		Origin         string `json:"origin"`
		ContentType    string `json:"contentType"`
		Source         string `json:"source"`
		FetchedAt      string `json:"fetchedAt"`
		FailedAttempts int    `json:"failedAttempts"`
		LastError      string `json:"lastError,omitempty"`
		HasData        bool   `json:"hasData"`
	}
	out := make([]adminRow, 0, len(rows))
	for _, r := range rows {
		out = append(out, adminRow{
			Origin: r.Origin, ContentType: r.ContentType, Source: r.Source,
			FetchedAt: r.FetchedAt, FailedAttempts: r.FailedAttempts,
			LastError: r.LastError, HasData: r.DataURL != "",
		})
	}
	return c.JSON(http.StatusOK, map[string]any{"items": out})
}

func (h *FaviconHandler) refreshAdmin(c echo.Context) error {
	type req struct {
		Origin string `json:"origin"`
	}
	var in req
	if err := c.Bind(&in); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "请求体无效")
	}
	origin := canonicalOrigin(in.Origin)
	if origin == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "无效的 origin")
	}
	// Even from the admin path, run the cards-referenced check. An admin
	// can still cause an SSRF if they refresh an arbitrary origin without
	// adding a card first; force them to add the card.
	referenced, err := h.Cards.ReferencesOrigin(origin)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	if !referenced {
		return echo.NewHTTPError(http.StatusBadRequest, "该 origin 未被任何卡片引用")
	}
	if err := h.fetchAndCache(c.Request().Context(), origin); err != nil {
		return echo.NewHTTPError(http.StatusBadGateway, err.Error())
	}
	_ = h.ActivityLog.Record(auditFromCtx(c, "admin.favicon_refresh",
		"刷新 favicon:"+origin, origin))
	return c.JSON(http.StatusOK, map[string]any{"success": true})
}

func (h *FaviconHandler) deleteAdmin(c echo.Context) error {
	origin, err := url.QueryUnescape(c.Param("origin"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "无效的 origin")
	}
	if err := h.Favicons.Delete(origin); err != nil {
		return notFoundIfRepoMissing(err)
	}
	_ = h.ActivityLog.Record(auditFromCtx(c, "admin.favicon_delete",
		"删除 favicon 缓存:"+origin, origin))
	return c.JSON(http.StatusOK, map[string]any{"success": true})
}
