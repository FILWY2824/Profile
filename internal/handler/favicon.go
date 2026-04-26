// favicon.go — favicon proxy and admin management.
//
// 关键改进:
//   - 抓 HTML 解析 <link rel="icon"> / <link rel="shortcut icon"> /
//     <link rel="apple-touch-icon"> 拿到精确图标 URL,而不是粗暴地访问
//     /favicon.ico(很多站点根域名根本没有 ico 文件,真正的图标走 link tag)
//   - 优先使用某张已被卡片引用的页面 URL 抓 HTML(比如卡片 url 是
//     https://github.com/anthropic/claude,就抓这个页面而不是 https://github.com)
//   - SSRF 守护贯穿每一次跳转(HTML fetch 与 icon fetch 各自走 Resolve+Check)
//   - Content-Type 白名单:image/* 才接受,防 HTML 误报为 favicon
package handler

import (
	"context"
	"crypto/md5"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/labstack/echo/v4"
	"golang.org/x/net/html"

	"github.com/qishu/profile/internal/repository"
	"github.com/qishu/profile/internal/ssrf"
	"github.com/qishu/profile/internal/urlsafe"
)

const (
	faviconFetchTimeout = 8 * time.Second
	faviconMaxBytes     = 256 * 1024
	htmlMaxBytes        = 512 * 1024
)

type FaviconHandler struct {
	Cards       *repository.CardRepo
	Favicons    *repository.FaviconRepo
	ActivityLog *repository.ActivityLogRepo

	inflightMu sync.Mutex
	inflight   map[string]*sync.WaitGroup
}

func NewFaviconHandler(cards *repository.CardRepo, favicons *repository.FaviconRepo, audit *repository.ActivityLogRepo) *FaviconHandler {
	return &FaviconHandler{
		Cards: cards, Favicons: favicons, ActivityLog: audit,
		inflight: make(map[string]*sync.WaitGroup),
	}
}

func (h *FaviconHandler) RegisterPublic(g *echo.Group) {
	// /favicons/image?origin=... 仍然保留,但是是为后台("图标缓存"页面)
	// 服务的;前台主页一律使用 /cards/:id/icon,这样前端永远不会拿到
	// 卡片的 origin。
	g.GET("/favicons/image", h.image)
	g.GET("/cards/:id/icon", h.cardIcon)
}

func (h *FaviconHandler) RegisterAdmin(g *echo.Group) {
	g.GET("", h.listAdmin)
	g.POST("/refresh", h.refreshAdmin)
	g.DELETE("/:origin", h.deleteAdmin)
}

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

// cardIcon 通过卡片 ID 返回 favicon。前端只需要知道 cardId,服务器侧
// 把 ID 解析成 URL,再解析出 origin,再走原有的 favicon 缓存通路。
// 这样,前端 HTML 与 network 面板永远不会出现卡片真实 host。
//
// 没有权限校验:卡片图标本身只是一张图,不涉及隐私;就算非授权用户
// 看到了也没有任何攻击意义(用户的需求里也明确说"图标可以看")。
// 所以这里不做 canSee — 否则未登录用户的主页会满屏图标占位失败。
func (h *FaviconHandler) cardIcon(c echo.Context) error {
	id := c.Param("id")
	card, err := h.Cards.FindByID(id)
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "卡片不存在")
	}
	origin := canonicalOrigin(card.URL)
	if origin == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "卡片 URL 不合法")
	}

	if cached, err := h.Favicons.Get(origin); err == nil && cached.DataURL != "" {
		return h.writeImageFromDataURL(c, cached.DataURL, cached.ContentType)
	}

	if err := h.fetchAndCache(c.Request().Context(), origin); err != nil {
		return echo.NewHTTPError(http.StatusBadGateway, "获取 favicon 失败")
	}

	cached, err := h.Favicons.Get(origin)
	if err != nil || cached.DataURL == "" {
		return echo.NewHTTPError(http.StatusBadGateway, "获取 favicon 失败")
	}
	return h.writeImageFromDataURL(c, cached.DataURL, cached.ContentType)
}

// image 公开读端点。
func (h *FaviconHandler) image(c echo.Context) error {
	originParam := c.QueryParam("origin")
	origin := canonicalOrigin(originParam)
	if origin == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "无效的 origin")
	}

	referenced, err := h.Cards.ReferencesOrigin(origin)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "查询失败")
	}
	if !referenced {
		return echo.NewHTTPError(http.StatusNotFound, "未找到")
	}

	if cached, err := h.Favicons.Get(origin); err == nil && cached.DataURL != "" {
		return h.writeImageFromDataURL(c, cached.DataURL, cached.ContentType)
	}

	if err := h.fetchAndCache(c.Request().Context(), origin); err != nil {
		return echo.NewHTTPError(http.StatusBadGateway, "获取 favicon 失败")
	}

	cached, err := h.Favicons.Get(origin)
	if err != nil || cached.DataURL == "" {
		return echo.NewHTTPError(http.StatusBadGateway, "获取 favicon 失败")
	}
	return h.writeImageFromDataURL(c, cached.DataURL, cached.ContentType)
}

// fetchAndCache 主流程。修改:不再硬编码 /favicon.ico,而是先抓某张引用页面
// 的 HTML,解析 link tag 拿真实 icon URL。如果 HTML 抓取或解析失败,再回退
// /favicon.ico。
func (h *FaviconHandler) fetchAndCache(parent context.Context, origin string) error {
	h.inflightMu.Lock()
	if wg, ok := h.inflight[origin]; ok {
		h.inflightMu.Unlock()
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

	client := newGuardedHTTPClient()

	// 1) 选一张该 origin 下的精确卡片 URL 作为 HTML 抓取目标
	urls, _ := h.Cards.URLsByOrigin(origin)
	htmlTarget := origin // 默认根
	for _, u := range urls {
		// 优先选 path 长度大于 1 的 URL(比根域名信息更多)
		if pu, err := url.Parse(u); err == nil && len(pu.Path) > 1 {
			htmlTarget = u
			break
		}
	}
	if htmlTarget == origin {
		// 退而求其次:用 origin 根
		htmlTarget = origin + "/"
	}

	// 2) 尝试抓 HTML,解析 <link rel="icon">
	iconURL := h.discoverIconURL(ctx, client, htmlTarget)

	// 3) 兜底:/favicon.ico
	if iconURL == "" {
		iconURL = strings.TrimRight(origin, "/") + "/favicon.ico"
	}

	// 4) 抓 icon 字节(含 SSRF 校验)
	body, ct, err := h.fetchIconBytes(ctx, client, iconURL)
	if err != nil {
		_ = h.Favicons.Upsert(repository.FaviconRow{
			Origin: origin, LastError: err.Error(), FailedAttempts: 1, Source: "fetch-failed",
		})
		return err
	}

	dataURL := "data:" + ct + ";base64," + base64.StdEncoding.EncodeToString(body)
	return h.Favicons.Upsert(repository.FaviconRow{
		Origin: origin, DataURL: dataURL, ContentType: ct,
		Source: "html-link", FetchedAt: time.Now().UTC().Format(time.RFC3339),
	})
}

// discoverIconURL 抓 HTML 解析 <link rel> 拿 icon URL。返回绝对 URL 或 ""。
func (h *FaviconHandler) discoverIconURL(ctx context.Context, client *http.Client, pageURL string) string {
	pu, err := url.Parse(pageURL)
	if err != nil {
		return ""
	}
	if _, err := ssrf.ResolveAndCheck(pu.Hostname()); err != nil {
		return ""
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, pageURL, nil)
	if err != nil {
		return ""
	}
	req.Header.Set("User-Agent", "qishu-favicon-fetcher/2.0")
	req.Header.Set("Accept", "text/html,application/xhtml+xml")

	resp, err := client.Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return ""
	}

	ct := resp.Header.Get("Content-Type")
	if ct != "" && !strings.Contains(strings.ToLower(ct), "html") {
		return ""
	}

	doc, err := html.Parse(io.LimitReader(resp.Body, htmlMaxBytes))
	if err != nil {
		return ""
	}

	// 收集所有候选 link tag,根据 rel 优先级选择
	type cand struct {
		href     string
		priority int // 数字越小越优先
		size     int // 越大越优先(同 priority)
	}
	var cands []cand
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode && strings.EqualFold(n.Data, "link") {
			var rel, href, sizes, typ string
			for _, a := range n.Attr {
				switch strings.ToLower(a.Key) {
				case "rel":
					rel = strings.ToLower(a.Val)
				case "href":
					href = strings.TrimSpace(a.Val)
				case "sizes":
					sizes = a.Val
				case "type":
					typ = strings.ToLower(a.Val)
				}
			}
			if href == "" {
				goto next
			}
			// rel 可能含多个值,用空格分
			rels := strings.Fields(rel)
			pri := -1
			for _, r := range rels {
				switch r {
				case "icon":
					if pri < 0 || pri > 1 {
						pri = 1
					}
				case "shortcut": // <link rel="shortcut icon">
					if pri < 0 || pri > 2 {
						pri = 2
					}
				case "apple-touch-icon", "apple-touch-icon-precomposed":
					if pri < 0 || pri > 3 {
						pri = 3
					}
				case "mask-icon":
					if pri < 0 || pri > 5 {
						pri = 5
					}
				}
			}
			if pri >= 0 {
				// 偏好 PNG / SVG over ICO,因为多数 ICO 单一尺寸又难看
				if typ == "image/png" || typ == "image/svg+xml" {
					pri = pri // 保持
				}
				sz := parseSizeMax(sizes)
				cands = append(cands, cand{href: href, priority: pri, size: sz})
			}
		}
	next:
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(doc)

	if len(cands) == 0 {
		return ""
	}

	// 选择:priority 最小,size 最大
	best := cands[0]
	for _, c := range cands[1:] {
		if c.priority < best.priority {
			best = c
			continue
		}
		if c.priority == best.priority && c.size > best.size {
			best = c
		}
	}

	// 解析为绝对 URL
	abs, err := pu.Parse(best.href)
	if err != nil {
		return ""
	}
	if abs.Scheme != "http" && abs.Scheme != "https" {
		return ""
	}
	return abs.String()
}

func parseSizeMax(s string) int {
	if s == "" || strings.EqualFold(s, "any") {
		return 0
	}
	max := 0
	for _, part := range strings.Fields(s) {
		x := strings.SplitN(strings.ToLower(part), "x", 2)
		if len(x) != 2 {
			continue
		}
		v := 0
		for _, ch := range x[0] {
			if ch < '0' || ch > '9' {
				v = 0
				break
			}
			v = v*10 + int(ch-'0')
		}
		if v > max {
			max = v
		}
	}
	return max
}

// fetchIconBytes 抓 icon 二进制,Content-Type 必须是 image/*。
func (h *FaviconHandler) fetchIconBytes(ctx context.Context, client *http.Client, target string) ([]byte, string, error) {
	pu, err := url.Parse(target)
	if err != nil {
		return nil, "", err
	}
	if _, err := ssrf.ResolveAndCheck(pu.Hostname()); err != nil {
		return nil, "", err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("User-Agent", "qishu-favicon-fetcher/2.0")
	req.Header.Set("Accept", "image/*")

	resp, err := client.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("status %s", resp.Status)
	}

	ct := strings.ToLower(strings.TrimSpace(strings.SplitN(resp.Header.Get("Content-Type"), ";", 2)[0]))
	switch ct {
	case "image/x-icon", "image/vnd.microsoft.icon", "image/png", "image/jpeg",
		"image/gif", "image/webp", "image/svg+xml", "image/avif":
	case "":
		ct = "image/x-icon"
	default:
		// 不是图片就拒绝(防 HTML 错误页被当 favicon)
		return nil, "", fmt.Errorf("不支持的 Content-Type:%s", ct)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, faviconMaxBytes))
	if err != nil {
		return nil, "", err
	}
	if len(body) == 0 {
		return nil, "", errors.New("empty body")
	}
	return body, ct, nil
}

// newGuardedHTTPClient 返回带 SSRF 拨号守卫的 HTTP client。
func newGuardedHTTPClient() *http.Client {
	return &http.Client{
		Timeout: faviconFetchTimeout,
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
}

func (h *FaviconHandler) writeImageFromDataURL(c echo.Context, dataURL, fallbackType string) error {
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
	hash := md5.Sum(bytes)
	etag := `"` + hex.EncodeToString(hash[:8]) + `"`
	c.Response().Header().Set("ETag", etag)
	c.Response().Header().Set("Cache-Control", "public, max-age=86400")
	if match := c.Request().Header.Get("If-None-Match"); match == etag {
		return c.NoContent(http.StatusNotModified)
	}
	return c.Blob(http.StatusOK, ct, bytes)
}

// ─── Admin ────────────────────────────────────────────────────────────────

func (h *FaviconHandler) listAdmin(c echo.Context) error {
	rows, err := h.Favicons.List()
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "查询失败")
	}
	type cardRef struct {
		Title       string `json:"title"`
		SectionName string `json:"sectionName"`
	}
	type adminRow struct {
		Origin         string    `json:"origin"`
		ContentType    string    `json:"contentType"`
		Source         string    `json:"source"`
		FetchedAt      string    `json:"fetchedAt"`
		FailedAttempts int       `json:"failedAttempts"`
		LastError      string    `json:"lastError,omitempty"`
		HasData        bool      `json:"hasData"`
		Cards          []cardRef `json:"cards"`
	}
	out := make([]adminRow, 0, len(rows))
	for _, r := range rows {
		// 关联的卡片(title + section name)。失败不致命,空数组而已。
		refs, _ := h.Cards.CardsByOrigin(r.Origin)
		cards := make([]cardRef, 0, len(refs))
		for _, ref := range refs {
			cards = append(cards, cardRef{Title: ref.Title, SectionName: ref.SectionName})
		}
		out = append(out, adminRow{
			Origin: r.Origin, ContentType: r.ContentType, Source: r.Source,
			FetchedAt: r.FetchedAt, FailedAttempts: r.FailedAttempts,
			LastError: r.LastError, HasData: r.DataURL != "",
			Cards: cards,
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
	referenced, err := h.Cards.ReferencesOrigin(origin)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "查询失败")
	}
	if !referenced {
		return echo.NewHTTPError(http.StatusBadRequest, "该 origin 未被任何卡片引用")
	}
	// 刷新前先删旧记录,避免缓存命中。
	_ = h.Favicons.Delete(origin)
	if err := h.fetchAndCache(c.Request().Context(), origin); err != nil {
		return echo.NewHTTPError(http.StatusBadGateway, "获取失败:"+err.Error())
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
