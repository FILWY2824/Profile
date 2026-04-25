# 栖枢 Profile

单容器一键部署的个人/团队站点导航 + 账户中心 + OAuth 2.0 服务器。

## 部署(三步)

```bash
cp .env.example .env
vim .env                       # 至少填上 JWT_SECRET、ADMIN_EMAIL、ADMIN_PASSWORD
docker compose up -d --build
open http://localhost:3000
```

## 数据存储

数据完全保存在 docker 体系内,**不会写到你的工作目录**:

* 容器内挂载点: `/app/data` (借鉴 `chenyme/grok2api` 的目录约定)
* 宿主侧位置: docker 命名卷 `qishu_data`,实际位于
  `/var/lib/docker/volumes/qishu_data/_data` ─ 由 docker daemon 自己管理。
* `docker compose down` **不会**丢数据;只有 `docker compose down -v` 才会
  删除命名卷。

备份:

```bash
docker run --rm -v qishu_data:/data -v $PWD:/backup alpine \
  tar czf /backup/qishu-data.tar.gz -C /data .
```

恢复:

```bash
docker run --rm -v qishu_data:/data -v $PWD:/backup alpine \
  tar xzf /backup/qishu-data.tar.gz -C /data
```

## 内存

容器内 Go 二进制稳态 RSS **25-45 MiB**,容器 limit 设的 100 MiB 是
cold-start / spike 余量。这个数字是怎么压下来的:

* `cmd/qishu/runtime.go` 在 main() 第一时间设
  `GOMEMLIMIT=64MiB` / `GOGC=20` / `GOMAXPROCS=2`,并启动一个
  30s 周期的 `debug.FreeOSMemory()` scavenger ─ 把 free 页强制还给
  内核(`MADV_DONTNEED`)。
* `Dockerfile` 的 `ENV` 又设了一份相同值,双保险。
* `docker-compose.yml` 加 `init: true`(tini-like)。容器收到 SIGTERM 时
  PID 1 会正确转发,进程干净退出,内核立刻回收 RSS 与 page cache ─
  这是修掉"关闭容器后宿主内存不下降"的关键一步。
* `pids_limit: 256` + `read_only: true` 是深度防御,不直接降内存但避免
  失控 fork 把内存撑大。

如果你跑了一段时间观察到 RSS 还是高,先看 `docker stats qishu`(那才是
真实的 cgroup 内存),htop 把 thread 拆成多行只是显示问题,实际只占一份。

## 环境变量速查

* `JWT_SECRET` —— **必填**, ≥32 字符
* `ADMIN_EMAIL` / `ADMIN_PASSWORD` —— 首次启动创建管理员
* `APP_ENV` —— `production` | `development`
* `TRUST_PROXY` —— 反代后设 `1`
* `RESEND_API_KEY` / `RESEND_FROM` —— 邮件; 留空进入 dev 模式
* `TURNSTILE_*` —— Cloudflare 人机验证(可在管理后台开关)
* `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` —— 出站代理(必须包含
  `localhost,127.0.0.1,::1`)
* `GOPROXY` / `NPM_REGISTRY` —— 镜像源(中国大陆环境强烈推荐
  `GOPROXY=https://goproxy.cn,direct`,`NPM_REGISTRY=https://registry.npmmirror.com`)

详细见 `.env.example`。

## 关键改动(相对原版)

### 部署/构建

* **CGO 移除**: 从 `mattn/go-sqlite3` 切到 `modernc.org/sqlite` 纯 Go 驱动。
  `CGO_ENABLED=0`,二进制完全静态,alpine 下不再有 musl/CGO 链接冲突。
* **数据放 `/app/data`(命名卷)**:借鉴 `chenyme/grok2api` 的目录约定,
  数据完全活在 docker 体系内,不写宿主工作目录。
* **代理透传**:`docker-compose.yml` 把 `.env` 中的 `HTTP_PROXY` /
  `HTTPS_PROXY` / `NO_PROXY` / `GOPROXY` / `NPM_REGISTRY` 同时作为 build
  args 与运行期环境变量传递。
* **端口 3000**:外部 `3000` -> 容器 `8080`。
* **健康检查**:`/api/healthz` 已注册,docker healthcheck 走 `wget --spider`。
* **容器内存调优**:见上方"内存"段。

### 安全

* **CSRF 防护**:`internal/middleware/csrf.go` 实现 Double Submit Cookie +
  Origin/Referer 校验。OAuth client credentials 端点走路径白名单跳过。
* **统一安全响应头**:HSTS(仅生产)、CSP(允许 Cloudflare Turnstile)、
  X-Content-Type-Options、X-Frame-Options、Referrer-Policy、
  Permissions-Policy。
* **请求体 1MB 限制**:`bodyLimit(1<<20)` 中间件实际启用。
* **生产环境绝不回显验证码**:`writeDevEcho` 只在 `APP_ENV=development`
  下才在响应里塞 `devCode`。即便运维忘填 `RESEND_API_KEY` 也不会泄露。
* **Turnstile / Email 热重载**:管理员保存设置后立即生效,无需重启容器。
* **IP 限流不被伪造头绕过**:`TRUST_PROXY` 开关控制是否信任
  X-Forwarded-For。直接对外部署设 `0`,反代后设 `1`。
* **容器 read_only**:除 `/tmp` 与 `/app/data` 外整个 rootfs 只读。
* **pids_limit: 256**:防失控 fork。

### 验证码与凭据

* 验证码 SHA-256 hash 存储(`code_hash` 列),不再明文。
* `pending_registrations` 单独表:注册流程 password hash 不再塞进
  `verification_codes.meta`。
* 验证码消费原子化:`UPDATE...WHERE used=0` + `RowsAffected==1`。
* OAuth token 全部 hash 存储(`access_token_hash` / `refresh_token_hash`
  / `code_hash`)。

### OAuth 2.0

* `appendQueryURL` 用 `net/url.Values.Encode()`,杜绝 query 注入。
* 删除 PKCE `plain` 分支,只接受 `S256`。
* Deny 前先校验 `redirect_uri`:防开放重定向。
* OAuth code 消费原子:`ConsumeIfUnused(id)` 单条 UPDATE。
* Refresh token 轮换在单事务里:任一失败回滚。
* Introspect 修复:对 refresh token 用 `RefreshTokenExpiresAt` 判过期。
* 级联清理:删用户/客户端时连带删 token / grant / code。

### Favicon

* 抓 HTML 解析 `<link rel="icon">` 拿到精确图标 URL,不再粗暴抓
  `/favicon.ico`。
* Content-Type 白名单:只接受 `image/*`,防 HTML 错误页冒充 favicon。
* SSRF 守卫贯穿每一次拨号(HTML fetch + icon fetch 都走
  `ssrf.ResolveAndCheck`)。
* `CardRepo.ReferencesOrigin` 用 `LIKE origin || '/%' ESCAPE '\\'` +
  等值兜底,修复 `https://a.com` 误命中 `https://a.com.attacker.com` 的
  前缀匹配 bug。

### 前端

完整重做的视觉:**栖枢档案 · Editorial Archive** 风格 ─ 羊皮纸底色
(`#FBF7EE`)、墨黑文字、朱砂红点睛(`#B33A2A`)、青苔次级色。字体用
Fraunces(衬线大标题)+ Source Sans 3(正文)+ JetBrains Mono(键名/序号)
+ Noto Serif SC(中文标题)+ Noto Sans SC(中文正文)。版面有档案号、
卷宗序号、hairline 分隔等编辑感设计语言。

## 开发

```bash
# 后端
go run ./cmd/qishu

# 前端
cd web
npm install
npm run dev   # vite proxy -> :8080
```
