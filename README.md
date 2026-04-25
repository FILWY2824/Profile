# 栖枢 Profile

单容器一键部署的个人/团队站点导航 + 账户中心 + OAuth 2.0 服务器。

## 部署(三步走)

```bash
# 1) 复制并编辑环境变量
cp .env.example .env
vim .env   # 至少填上 JWT_SECRET、ADMIN_EMAIL、ADMIN_PASSWORD

# 2) 启动
docker compose up -d --build

# 3) 访问
open http://localhost:3000
```

数据库与所有持久数据落在项目目录下的 `./data/` 内,**不会写入系统目录**。
要重置应用,直接 `rm -rf data/`。

## 关键改动 vs 原版

### 部署/构建

* **CGO 移除**:从 `mattn/go-sqlite3` 切换到 `modernc.org/sqlite` 纯 Go 驱动。
  Dockerfile 用 `CGO_ENABLED=0`,二进制完全静态,不再依赖 musl。原镜像
  里 `linkmode external -extldflags '-static'` 在 alpine 下与 CGO 冲突的
  问题彻底解决。
* **代理透传**:`docker-compose.yml` 把 `.env` 中的 `HTTP_PROXY` /
  `HTTPS_PROXY` / `NO_PROXY` / `GOPROXY` / `NPM_REGISTRY` 同时作为 build
  args 与运行期环境变量传递。中国大陆环境推荐:

  ```
  GOPROXY=https://goproxy.cn,direct
  NPM_REGISTRY=https://registry.npmmirror.com
  ```
* **本地数据卷**:容器 `/data` 挂载到项目同级 `./data` 目录。`DATA_DIR`
  默认值改为 `./data`,直接跑二进制时也不会写到系统目录。
* **端口固定 3000**:`docker-compose.yml` 把容器 `8080` 映射到宿主 `3000`。
* **健康检查路径已存在**:旧版 `/api/healthz` 不存在导致健康检查总是 404,
  新版已注册。

### 安全

* **CSRF 防护**:`internal/middleware/csrf.go` 实现 Double Submit Cookie +
  Origin/Referer 校验。OAuth 客户端凭据端点(`/api/oauth/token` 等)走路径
  白名单跳过。前端 `api.js` 自动从 cookie 读取 `qishu_csrf` 注入
  `X-CSRF-Token` 头。
* **统一安全响应头**:HSTS(仅生产)、CSP(允许 Cloudflare Turnstile)、
  X-Content-Type-Options、X-Frame-Options、Referrer-Policy、
  Permissions-Policy。
* **请求体 1MB 限制**:`bodyLimit(1<<20)` 中间件实际启用。
* **生产环境绝不回显验证码**:`writeDevEcho` 改为只在 `APP_ENV=development`
  下才在响应里塞 `devCode`。即便运维忘填 `RESEND_API_KEY` 也不会泄露。
* **Turnstile / Email 热重载**:管理员保存设置后立即生效,无需重启容器。
* **IP 限流不再被伪造头绕过**:加 `TRUST_PROXY` 开关。直接对外部署设
  `TRUST_PROXY=0`,反代后面设 `1`。

### 验证码与凭据存储

* **验证码改为 SHA-256 hash 存储**(`code_hash` 列),不再明文。
* **`pending_registrations` 新表**:注册流程的 password hash 不再塞进
  `verification_codes.meta`。
* **验证码消费原子化**:`UPDATE...WHERE used=0` + `RowsAffected==1`,杜绝
  并发重放。
* **OAuth token 全部 hash 存储**(`access_token_hash` / `refresh_token_hash`
  / `code_hash`)。

### OAuth 2.0

* `appendQueryURL` 改用 `net/url.Values.Encode()`,杜绝 query 注入。
* **删除 PKCE `plain` 分支**,只接受 `S256`。
* **Deny 前先校验 `redirect_uri`**:防开放重定向。
* **OAuth code 消费原子**:`ConsumeIfUnused(id)` 单条 UPDATE。
* **Refresh token 轮换在单事务里**:`RotateRefresh` 一次完成 mark replaced
  + insert,任一失败回滚。
* **Introspect 修复**:对 refresh token 用 `RefreshTokenExpiresAt` 判过期,
  不再错用 access 的 `expires_at`。
* **级联清理**:删除用户/客户端时连带删 token / grant / code(三个 repo
  各加 `DeleteByUserID` / `DeleteByClientID`)。

### Favicon

* **抓 HTML 解析 `<link rel="icon">` / `<link rel="shortcut icon">` /
  `<link rel="apple-touch-icon">`** 拿到精确图标 URL,不再粗暴抓
  `/favicon.ico`。
* 优先使用某张已被卡片引用的具体页面 URL 作为 HTML 抓取目标。
* Content-Type 白名单:只接受 `image/*`,防 HTML 错误页冒充 favicon。
* SSRF 守卫贯穿每一次拨号(HTML fetch + icon fetch 都走
  `ssrf.ResolveAndCheck`)。
* `CardRepo.ReferencesOrigin` 改为 `LIKE origin || '/%' ESCAPE '\\'` +
  等值兜底,修复 `https://a.com` 误命中 `https://a.com.attacker.com` 的
  前缀匹配 bug。

### Admin 设置 UX

* 左侧分类导航(通用 / 鉴权 / 邮件 / 验证码 / OAuth / 限流 / 安全 / 数据保留)
* 顶部搜索框,支持键名 + 描述模糊搜索
* 修改后的项目高亮(琥珀色背景 + 边框)
* "已修改 N 项"角标和清单
* 每项可单独 "还原"
* 浮动保存条:固定底部居中,显示未保存数 + 全部还原 + 一键保存
* 热重载项有"热加载"绿色徽章

### 前端

完全重新设计的视觉:浅色 + 中性灰 + 青色 accent + 细致阴影。新增页面与
组件全部用 Tailwind utilities + 内置 `.btn-*` / `.input` / `.surface`
等组件类,JetBrains Mono 用于代码与数字。

## 开发

```bash
# 后端
go run ./cmd/qishu

# 前端
cd web
npm install
npm run dev   # 走 vite proxy 指向 :8080
```

## 环境变量速查

* `JWT_SECRET` —— **必填**,≥32 字符
* `ADMIN_EMAIL` / `ADMIN_PASSWORD` —— 首次启动创建管理员
* `APP_ENV` —— `production` | `development`
* `TRUST_PROXY` —— 反代后设 `1`
* `RESEND_API_KEY` / `RESEND_FROM` —— 邮件;留空进入 dev 模式
* `TURNSTILE_*` —— Cloudflare 人机验证(可在管理后台开关)
* `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` —— 出站代理(必须包含
  `localhost,127.0.0.1,::1`)
* `GOPROXY` / `NPM_REGISTRY` —— 镜像源(中国大陆环境强烈推荐)

详细说明见 `.env.example`。
