# 栖枢 Profile · 架构文档(重构版 v2.0)

> 从 Next.js 16 + React 19 完全重写为 Go + Vue 3 SPA。
> 目标:常驻内存 < 100MB,单容器部署,API-first 适配未来手机 App。

---

## 1. 技术选型与理由

### 1.1 后端:Go 1.22 + Echo v4 + modernc.org/sqlite

| 选项 | 选择 | 理由 |
|---|---|---|
| 语言 | **Go 1.22** | 静态编译、GC 开销小、常驻内存稳定在 30–80MB、原生 goroutine 并发模型 |
| HTTP 框架 | **Echo v4** | 路由快、中间件生态成熟、learning curve 低;比 Gin 更严格(自动处理 EOF 等边界)|
| SQLite 驱动 | **modernc.org/sqlite** | 纯 Go 实现,**无需 CGO**,Docker 镜像可用 `FROM scratch`,交叉编译零负担 |
| JWT | `golang-jwt/jwt/v5` | 官方维护最活跃的分支,v5 修掉了 v4 的几个已知问题 |
| bcrypt | `golang.org/x/crypto/bcrypt` | 官方库 |
| 输入校验 | `go-playground/validator/v10` | struct tag 驱动,跟 Echo 的 Bind 无缝 |
| UUID | `google/uuid` | v7 支持时间排序的 UUID,索引友好 |

**为什么不是 Fastify + Node**:Node 运行时基线 40–60MB,加 Fastify + better-sqlite3 原生模块,空载已经 80MB+,50 并发必破 100MB 硬线。

**为什么不是 Rust**:开发速度对项目规模(20+ 路由 + OAuth 服务端 + 后台)不划算;Go 已能达到 <100MB 目标。

### 1.2 前端:Vue 3 + Vite + Pinia(阶段 4 交付)

- 编译后的静态文件通过 `//go:embed` 嵌入 Go 二进制
- 开发模式下 Vite dev server 代理到后端(`vite.config.js` 里配 `/api` proxy)
- 生产模式:Go 直接 serve `dist/`,无需 nginx

### 1.3 部署:单容器 Docker + docker-compose

- 多阶段构建:`golang:1.22-alpine` 编译 → `scratch` 运行
- 最终镜像 < 30MB(Go 二进制 ~15MB + 前端静态文件 ~2MB + CA 证书)
- `docker-compose.yml` 把 `data/` 卷挂出来持久化 SQLite
- 环境变量由 `.env` 注入,首次启动自动建库/跑迁移/创建管理员

---

## 2. 目录结构

```
qishu/
├── cmd/qishu/
│   └── main.go                  # 程序入口,装配依赖、启动 HTTP server
├── internal/                    # 业务代码(不对外导出)
│   ├── auth/                    # JWT 签发/校验、bcrypt、会话
│   ├── config/                  # 环境变量与默认值
│   ├── db/                      # SQLite 连接 + 迁移运行器
│   ├── email/                   # Resend HTTP 客户端 + HTML 模板 + 转义
│   ├── handler/                 # Echo HTTP handler(按业务拆文件)
│   │   ├── auth.go              # /api/auth/*
│   │   ├── account.go           # /api/account/*
│   │   ├── homepage.go          # /api/homepage
│   │   ├── admin_users.go       # /api/admin/users
│   │   ├── admin_sections.go    # /api/admin/sections
│   │   ├── admin_cards.go       # /api/admin/cards
│   │   ├── admin_settings.go    # /api/admin/settings
│   │   ├── admin_retention.go   # /api/admin/retention
│   │   ├── admin_favicons.go    # /api/admin/favicons
│   │   ├── admin_dashboard.go   # /api/admin/dashboard
│   │   ├── favicon.go           # /api/favicons/image
│   │   └── oauth.go             # /api/oauth/*
│   ├── middleware/              # CORS、鉴权、限流、CSRF
│   ├── model/                   # 数据库模型 struct
│   ├── ratelimit/               # 进程内令牌桶,带硬上限 + sweep
│   ├── repository/              # DB 查询层(每张表一个 repo)
│   ├── settings/                # 后台可配置项(缓存 + 失效)
│   ├── turnstile/               # Cloudflare Turnstile siteverify
│   ├── urlsafe/                 # URL scheme 白名单守卫
│   ├── ssrf/                    # 出站请求黑段拦截(IPv4/IPv6 私网)
│   ├── validator/               # 输入长度/格式校验
│   └── web/                     # go:embed 前端静态资源
├── web/                         # Vue 3 前端源码(阶段 4)
│   ├── src/
│   ├── package.json
│   └── vite.config.js
├── migrations/                  # .sql 文件,按版本号命名
│   ├── 001_init.sql
│   └── 002_oauth_refresh.sql
├── scripts/                     # 运维脚本(Go 编译)
│   ├── create_admin.go          # 独立小程序:初始化管理员
│   └── seed.go                  # 开发种子数据
├── tests/                       # 单元/集成测试
├── Dockerfile
├── docker-compose.yml
├── Makefile
├── go.mod
├── go.sum
├── .env.example
├── .gitignore
├── ARCHITECTURE.md              # 本文件
└── README.md
```

---

## 3. 关键设计决策

### 3.1 DB 连接与并发

- **单连接**,`sql.Open("sqlite", "file:data/app.db?_pragma=journal_mode(WAL)&...")`
- 启用 WAL 模式、`foreign_keys=ON`、`busy_timeout=5000`
- `db.SetMaxOpenConns(1)` —— SQLite 写锁串行化;读走 WAL snapshot 不阻塞写
- 所有 SQL 都用 **prepared statement + 参数化**,禁止字符串拼接(防注入)

### 3.2 JWT 与会话

- HTTP-only cookie `qishu_token`,`SameSite=Lax`,生产 `Secure=true`
- Claims:`sub`(user id)、`email`、`role`、标准 `exp/iat`
- **密钥来源**:环境变量 `JWT_SECRET`,启动时校验 ≥ 32 字节;生产下缺失直接 panic
- 会话失效三重检查:
  1. JWT 签名/exp 校验
  2. 用户状态 `active`
  3. `passwordChangedAt > iat` 则失效(密码改了就踢下线)

### 3.3 限流

- 实现见 `internal/ratelimit`:`map[bucket-key][]timestamp` 的滑动窗口
- **桶总量硬上限**(默认 2000),`sync.Map` + 原子计数防内存爆
- `sweepLoop` goroutine 每 10min 清除 1h 未活跃的 bucket
- 按需可换 Redis —— `RateLimiter` 是接口,替换实现即可

### 3.4 安全基线(修复原项目所有已知问题)

| 原编号 | 修复 |
|---|---|
| H1 | `/api/favicons/image` 无匿名访问,先查 cards 表 |
| H5 | `urlsafe.SanitizeHTTPURLOrEmpty` 过滤 `javascript:` 等 scheme |
| H6 | `email.EscapeHTML` 对所有动态字段转义 |
| H7/H8 | `validator.ContentLimits` 硬上限 |
| L1 | 限流桶有上限 + sweep,避免无限增长 |
| M1 | 过期 verification_code / oauth_token 启动 60s 后 + 每 6h 自动清 |
| 新 | **CSRF 双重 token**:状态变更接口额外校验 `X-CSRF-Token` header |
| 新 | **OAuth refresh token reuse detection**:refresh token 被用第二次 → 整链撤销 |
| 新 | **请求体大小限制**:Echo `BodyLimit(1MB)`,防慢速 DoS |
| 新 | **登录时序等时 bcrypt**:用户不存在也走一次假比较,防用户枚举 |

### 3.5 内存预算(目标 RSS < 100MB)

| 来源 | 预估 |
|---|---|
| Go runtime | 8 MB |
| Echo 路由 + middleware | 2 MB |
| SQLite page cache(默认 2MB,保持) | 4 MB |
| 限流 buckets(2000 条 × 64B) | 0.1 MB |
| favicon inflight map | 0.1 MB |
| settings 缓存(~30 键) | 0.01 MB |
| 每请求栈 + heap(50 并发) | 10–30 MB |
| **合计空载** | **~15 MB** |
| **合计 50 并发峰值** | **~45 MB** |

预留 `GOMEMLIMIT=80MiB` 软上限,配合 `GOGC=50` 让 GC 更激进一点,在 VPS 小内存场景下更稳。

### 3.6 容器化

```dockerfile
# 阶段 1:编译前端(阶段 4 交付后加上)
# FROM node:20-alpine AS web-builder
# ...

# 阶段 2:编译 Go
FROM golang:1.22-alpine AS api-builder
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /qishu ./cmd/qishu

# 阶段 3:运行时(scratch 最小化)
FROM scratch
COPY --from=api-builder /qishu /qishu
COPY --from=api-builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
EXPOSE 8080
ENTRYPOINT ["/qishu"]
```

---

## 4. API 路由清单(最终目标)

### 公开

- `GET  /api/healthz` — 健康检查
- `GET  /api/homepage` — 首页 sections + cards(带权限标签)
- `GET  /api/favicons/image?origin=...` — favicon 缓存代理(需被某张卡引用)
- `GET  /api/auth/turnstile-config` — 前端用 Site Key

### 认证

- `POST /api/auth/register` — 提交注册(发验证码)
- `POST /api/auth/register/confirm` — 输入验证码完成注册
- `POST /api/auth/verify-email` — 已登录但未验证 → 重发验证码
- `POST /api/auth/verify-email/confirm` — 提交验证码
- `POST /api/auth/login` — 登录,签发 cookie
- `POST /api/auth/logout`
- `POST /api/auth/forgot-password` — 发重置码
- `POST /api/auth/reset-password` — 提交新密码
- `GET  /api/auth/me` — 当前用户信息

### 个人中心(需登录)

- `GET  /api/account/profile` / `PATCH /api/account/profile`
- `POST /api/account/password/send-code`
- `POST /api/account/password/change`
- `GET  /api/account/login-history`
- `GET  /api/account/activity`
- `GET  /api/account/oauth-grants`
- `DELETE /api/account/oauth-grants/:id`

### 管理员(需 admin 角色)

- 用户:`GET/POST/PATCH/DELETE /api/admin/users`
- 板块:`GET/POST/PATCH/DELETE /api/admin/sections`
- 卡片:`GET/POST/PATCH/DELETE /api/admin/cards`
- 设置:`GET/PATCH /api/admin/settings`
- 仪表盘:`GET /api/admin/dashboard`
- 登录历史:`GET /api/admin/login-history`
- 活动日志:`GET /api/admin/activity-log`
- 数据保留:`POST /api/admin/retention/:table/prune`
- favicon:`GET/POST/DELETE /api/admin/favicons`
- OAuth 客户端:`GET/POST/PATCH/DELETE /api/admin/oauth-clients`

### OAuth2 服务端

- `GET  /api/oauth/authorize` / `POST /api/oauth/authorize/decide`
- `GET  /api/oauth/client-info?client_id=...`
- `POST /api/oauth/token`
- `GET  /api/oauth/userinfo`
- `POST /api/oauth/introspect`
- `POST /api/oauth/revoke`

---

## 5. 分阶段交付规划

| 阶段 | 范围 | 验收 |
|---|---|---|
| **1(本次)** | Go 后端骨架、DB 迁移、完整认证流程(register/login/verify/forgot)、限流、SSRF/URL 守卫、Docker、单测 | `docker compose up` 起服务;curl 打通完整认证链 |
| **2** | 首页 API、管理员 CRUD(users/sections/cards/settings/favicons)、个人中心、retention/dashboard/活动日志/登录历史 | 所有业务 JSON 接口齐全,覆盖率 > 60% |
| **3** | 完整 OAuth2 服务端(含 PKCE + refresh rotation + reuse detection)、OAuth 客户端管理后台 API | 用 `oauth2-cli` 跑完授权码 + refresh 流程 |
| **4** | Vue 3 SPA(首页 + 登录注册 + 个人中心 + 管理后台 + OAuth 授权页),embed 进 Go 二进制 | 浏览器端到端走完所有流程,最终镜像 < 30MB |

---

## 6. 手机 App 适配

本架构**天然 API-first**:

- 所有业务能力都以 JSON REST API 暴露,前端 SPA 就是它的第一个消费者
- 认证用 JWT,cookie 仅 Web 端默认模式;App 客户端可以用 `Authorization: Bearer <token>` 头(中间件已兼容)
- 未来 React Native / Flutter App 开发时,直接复用所有 `/api/*` 路由
- CORS 允许配置受信来源(`ALLOWED_ORIGINS` env),方便 App 端调试

阶段 4 的前端 SPA 会把 API 调用封装成 `src/api/*.ts`,这些封装跟 App 的网络层形态一致,便于后期复用契约。
