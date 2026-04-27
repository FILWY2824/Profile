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
	// 数据来源是"管理员当前设置的卡片表",不是"已经拉过图标的缓存表"。
	// 这样:
	//   - 管理员刚加的卡片就立刻在这一页可见,不必等到有人访问主页触发懒抓
	//   - 每个卡片的 origin 都明确暴露 + 可点 "刷新",再次保证只针对管理员
	//     设置的当前 URL 抓取(refreshAdmin 还会再校验一次 ReferencesOrigin)
	//   - 老的、已经没有任何卡片再用的 origin(orphan)也仍然显示出来,管理员
	//     可以一眼把它们删掉,避免缓存表里堆历史垃圾
	//
	// 顺序:先列卡片对应的 origin(按 cards 表的出现顺序),再附 orphan。
	allCards, err := h.Cards.FindAll()
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "查询失败")
	}
	cacheRows, err := h.Favicons.List()
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "查询失败")
	}

	// origin → cache row 索引(后面取 contentType / fetchedAt / dataURL 等)
	cacheByOrigin := make(map[string]repository.FaviconRow, len(cacheRows))
	for _, r := range cacheRows {
		cacheByOrigin[r.Origin] = r
	}

	// 收集 distinct origin。先按卡片顺序,后挂 orphan。
	seen := make(map[string]bool)
	orderedOrigins := make([]string, 0)
	for _, card := range allCards {
		origin := canonicalOrigin(card.URL)
		if origin == "" || seen[origin] {
			continue
		}
		seen[origin] = true
		orderedOrigins = append(orderedOrigins, origin)
	}
	for _, r := range cacheRows {
		if seen[r.Origin] {
			continue
		}
		seen[r.Origin] = true
		orderedOrigins = append(orderedOrigins, r.Origin)
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
		// Cached 区分"还没抓过(只在卡片表里)"与"已经有缓存行(可能是 ok / 错 / 空)"。
		// 前端用它来决定是否显示 "删除" 按钮 — 没缓存就没有可删的对象。
		Cached bool      `json:"cached"`
		Cards  []cardRef `json:"cards"`
	}
	out := make([]adminRow, 0, len(orderedOrigins))
	for _, origin := range orderedOrigins {
		// CardsByOrigin 内部 LEFT JOIN sections,直接拿到 title + 板块名。
		// origin 是 distinct 的,所以这里的查询次数 = distinct origin 数,
		// 实际站点很小不必优化成单次 IN 查询。
		refs, _ := h.Cards.CardsByOrigin(origin)
		cards := make([]cardRef, 0, len(refs))
		for _, ref := range refs {
			cards = append(cards, cardRef{Title: ref.Title, SectionName: ref.SectionName})
		}
		row := adminRow{Origin: origin, Cards: cards}
		if cache, ok := cacheByOrigin[origin]; ok {
			row.Cached = true
			row.ContentType = cache.ContentType
			row.Source = cache.Source
			row.FetchedAt = cache.FetchedAt
			row.FailedAttempts = cache.FailedAttempts
			row.LastError = cache.LastError
			row.HasData = cache.DataURL != ""
		}
		out = append(out, row)
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

// ─── Hooks for card-mutation paths ───────────────────────────────────────
//
// 当管理员在"卡片"页面里 创建 / 更新 / 删除 卡片时,我们需要让图标缓存
// 跟着改 — 否则旧的 origin 的图标会一直留在表里(被认为孤儿),新加的 origin
// 又要等到第一次有用户访问主页才被动抓取,管理员看不到反馈。
//
// 这里暴露两个公开方法供 admin_content.go 调用:
//
//   - EnsureFreshForOrigin: 删掉该 origin 现有的缓存并重新抓取一次,确保
//     管理员保存卡片后看到的是最新图标(即使源站偶尔换 favicon)。
//   - DropIfOrphan: 若该 origin 在删除/改 URL 之后已经没有任何卡片引用,
//     就把缓存行删掉,避免堆积"曾经的卡片"的图标。
//
// 调用方应该用 goroutine 异步执行,因为 EnsureFreshForOrigin 走网络
// (8s 超时),不能阻塞管理员的 HTTP 响应。

// canonicalOriginFromURL 提取并 canonicalize 卡片 URL 的 origin。
// admin_content.go 在调用 hook 之前已经走过 urlsafe.SanitizeHTTPURLOrEmpty,
// 这里再做一遍 IsSafeHTTPURL 是出于安全分层(不假设上游一定 sanitize 过)。
func canonicalOriginFromURL(rawURL string) string {
	return canonicalOrigin(rawURL)
}

// EnsureFreshForOrigin 丢弃 origin 现有的缓存(若有),然后重新抓取一次。
// 用于 卡片创建 / 卡片 URL 更新 后,确保新的卡片对应的图标是最新抓回的,
// 而不是某次旧抓取的残留。
//
// 注意:必须用一个独立于 echo 请求的 ctx(请求 ctx 在 response 写完后会被
// cancel,但本函数在 goroutine 里继续跑)。调用方负责传入合适的 parent ctx。
func (h *FaviconHandler) EnsureFreshForOrigin(parent context.Context, rawURL string) {
	origin := canonicalOriginFromURL(rawURL)
	if origin == "" {
		return
	}
	// 直接删旧 — Delete 在没行时返回 ErrNotFound,我们不在乎。
	_ = h.Favicons.Delete(origin)
	// fetchAndCache 内部已经有 inflight 去重 + 8s 超时,这里直接调用即可。
	if err := h.fetchAndCache(parent, origin); err != nil {
		// 失败也无所谓 — fetchAndCache 自己会写一行 lastError 到缓存表,
		// 让管理员在"图标缓存"页面看到。
		// eslint-disable-next-line no-console (Go: log)
		// 不打日志,避免高频改动污染 stderr。
		_ = err
	}
}

// DropIfOrphan 在 origin 已经没有任何卡片引用时把它从缓存表里删掉。
// 用于 卡片删除 / 卡片 URL 改到别的 origin 之后清理孤儿缓存。
func (h *FaviconHandler) DropIfOrphan(rawURL string) {
	origin := canonicalOriginFromURL(rawURL)
	if origin == "" {
		return
	}
	referenced, err := h.Cards.ReferencesOrigin(origin)
	if err != nil || referenced {
		// 查询失败时保守起见保留缓存(下次清理或手动删除即可)
		return
	}
	_ = h.Favicons.Delete(origin)
}
