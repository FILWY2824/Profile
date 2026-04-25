# 栖枢 Profile(重构版)

Next.js 16 → Go 1.22 + Vue 3 SPA 的完全重写。
单容器一键部署、API-first 以便未来手机 App 复用。

**当前版本:1.0.0(后端 + 前端全部完成)**

> 详细交接见 [`HANDOFF.md`](./HANDOFF.md)。

---

## 状态一览

| Phase | 内容 | 状态 |
|-------|------|------|
| 1 | 骨架 + 认证(注册 / 登录 / JWT / 限流 / 邮件验证码) | ✅ |
| 2 | 业务 CRUD(首页权限过滤 / 个人中心 / 管理员 / favicon / 审计) | ✅ |
| 3 | OAuth2 + OIDC 服务端(Authorization Code + PKCE + Refresh 轮换) | ✅ |
| 4 | Vue 3 SPA(同意页 / 登录页 / 个人中心 / 管理后台) | ✅ |

代码量:Go 37 文件 ~7700 LOC + Vue 27 文件 ~3000 LOC。
负载下 RSS ~36 MB,完全满足 < 100 MB 目标。

---

## 快速开始

### Docker(推荐)

```bash
cp .env.example .env
# 至少填:JWT_SECRET、ADMIN_EMAIL、ADMIN_PASSWORD
docker compose up --build -d
```

打开 `http://localhost:8080/`,使用 `.env` 里的 ADMIN_EMAIL / ADMIN_PASSWORD 登录。

### 本地直跑(开发)

```bash
# 终端 1:后端
go mod tidy
JWT_SECRET=$(head -c 48 /dev/urandom | base64) \
ADMIN_EMAIL=admin@example.com \
ADMIN_PASSWORD=AdminPass123 \
APP_ENV=development \
go run ./cmd/qishu

# 终端 2:前端(热更新)
cd web && npm install && npm run dev
# 打开 http://localhost:5173/
```

### 单文件二进制构建

```bash
cd web && npm install && npm run build && cd ..
cp -r web/dist/* cmd/qishu/web-dist/
go build -ldflags="-s -w" -o qishu ./cmd/qishu
# ./qishu 即程序,~14 MB 单文件
```

---

## 技术栈

- **后端**:Go 1.22 + Echo v4 + SQLite(WAL)
- **前端**:Vue 3 + Vite 6 + Tailwind 3,`go:embed` 进二进制
- **部署**:多阶段 Docker(node → go → alpine),~25 MB 镜像
- **OAuth**:自研服务端(Code + PKCE + RFC 9700 refresh 轮换 + 重用检测)

---

## 架构要点

- **API-first**:所有业务能力都是 JSON REST。SPA 与未来 App 是同一套 API 的两个消费者
- **单连接 SQLite**:写走唯一 connection、WAL 并发读;无 ORM
- **JWT + HttpOnly cookie**:SPA 默认;App 可用 `Authorization: Bearer`
- **运行时可配置**:阈值 / 凭据 / 限流规则在 `settings` 表,改完立即生效
- **内存硬顶**:`GOMEMLIMIT=80MiB`,容器级 `memory: 150M` 兜底
- **OAuth 撤销即时**:opaque token + DB 查询(不用 JWT)

完整设计见 [`ARCHITECTURE.md`](./ARCHITECTURE.md)。

---

## 目录速览

```
qishu/
├── HANDOFF.md               ← 详细交接,先读
├── ARCHITECTURE.md          ← 架构与决策
├── Dockerfile               ← 三阶段构建
├── docker-compose.yml
├── Makefile
├── .env.example             ← 环境变量模板
├── go.mod
├── cmd/qishu/
│   ├── main.go              ← DI 装配
│   ├── helpers.go           ← bootstrap / pruner / signer
│   ├── spa.go               ← //go:embed + SPA fallback
│   └── web-dist/            ← 构建期填充
├── internal/                ← 14 个包(auth / config / db / handler / ...)
└── web/                     ← Vue 3 SPA(8 页 + 5 + 8 标签)
    └── src/
        ├── App.vue
        ├── components/
        │   ├── account/   (5 tabs)
        │   └── admin/     (8 tabs)
        └── pages/         (8 pages)
```

---

## 常用命令(Makefile)

```bash
make help        # 看全部
make build       # 编译到 ./bin/qishu(需先 npm run build)
make run         # 本地直跑
make test        # go test ./...
make docker      # 构建镜像
make docker-up   # docker compose up -d
make docker-logs # 跟日志
```

---

## API 路由速查

### 公开
```
GET  /api/healthz
GET  /api/homepage                     # 带权限过滤
GET  /api/favicons/image?origin=...    # 双层防护
GET  /api/oauth/client-info            # 同意页用
```

### 认证
```
POST /api/auth/register
POST /api/auth/register/confirm
POST /api/auth/login
POST /api/auth/logout
POST /api/auth/forgot-password
POST /api/auth/reset-password
GET  /api/auth/me
```

### 个人中心(需登录)
```
GET   /api/account/profile
PATCH /api/account/profile
POST  /api/account/password/send-code
POST  /api/account/password/change
GET   /api/account/login-history
GET   /api/account/activity
GET   /api/account/oauth-grants
DELETE /api/account/oauth-grants/:id
```

### OAuth2 / OIDC 服务端
```
GET  /api/oauth/authorize/info              (需登录)
POST /api/oauth/authorize/decide            (需登录)
POST /api/oauth/token                       # code → token / refresh → token
GET  /api/oauth/userinfo                    # OIDC claims (Bearer)
POST /api/oauth/introspect                  # RFC 7662
POST /api/oauth/revoke                      # RFC 7009
```

### 管理员(需 admin)
```
GET   /api/admin/dashboard
*     /api/admin/users           CRUD
*     /api/admin/sections        CRUD
*     /api/admin/cards           CRUD
*     /api/admin/oauth-clients   CRUD + /:id/rotate-secret
GET   /api/admin/settings
PATCH /api/admin/settings
GET   /api/admin/login-history
GET   /api/admin/activity-log
POST  /api/admin/retention/:table/prune
GET   /api/admin/favicons
POST  /api/admin/favicons/refresh
DELETE /api/admin/favicons/:origin
```

---

## 安全审查继承

原审查 H1/H5/H6/H7/H8/L1/M1 全部修复,见 [`HANDOFF.md`](./HANDOFF.md) 的安全清单。
新增防御:JWT alg:none 拒绝、用户枚举防护、忘记密码不泄露存在性、
请求体 1MB 上限、OAuth refresh 重用 chain 撤销、PKCE 必填、
OAuth 客户端密钥仅展示一次、SPA `/api/*` 路径不返回 HTML。

---

## 许可证

参照原项目。

---

## 鸣谢

从原仓库的 Next.js 版本(1.2.x)重构而来。
