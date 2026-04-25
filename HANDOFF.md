# 栖枢 — 交接说明(Phase 1 ~ 4 全部完成)

后端三阶段(认证 / 业务 CRUD / OAuth2)+ 前端 Vue 3 SPA(含管理后台、
个人中心、OAuth 同意页)全部完成、编译通过、端到端验证。

```
状态: ✅ 可用版本 1.0.0
代码量:Go 37 文件 ~7700 LOC,Vue 27 文件 ~3000 LOC
内存:负载下 RSS ~36 MB(目标 < 100 MB)
镜像:多阶段 Docker,~25 MB
```

---

## 已实现

### Phase 1 — 骨架与认证 ✅

- `cmd/qishu/main.go` ~250 行,串起所有依赖
- `internal/db` SQLite + WAL,迁移在二进制启动时自动跑
- `internal/auth` bcrypt + JWT(HS256,拒 alg:none)+ `ConstantTimeVerify`
- `internal/middleware` Session/MustAuth/MustAdmin/CORS
- `internal/handler/auth.go` 注册 / 邮箱验证码 / 登录 / 登出 / 忘记密码
- `internal/ratelimit` 内存限流,sweep + 上限 + fail-open
- `internal/email` Dev 模式回显;生产 SMTP
- `internal/turnstile` Cloudflare Turnstile
- `internal/ssrf` 私网 / loopback / cloud-metadata 黑段
- `internal/urlsafe` `javascript:` / `data:` / 控制字符拦截
- `internal/validator` 长度 / 格式集中管理

### Phase 2 — 业务 CRUD ✅

- `handler/public.go` 首页 + 权限阶梯(public / user / member / admin)
- `handler/account.go` 个人中心:profile / 双因子改密 / 登录历史 / 活动
- `handler/admin_users.go` 用户 CRUD,带"最后管理员"安全检查
- `handler/admin_content.go` sections / cards CRUD
- `handler/admin_misc.go` settings / dashboard / 全局审计 / 手动 retention
- `handler/favicon.go` favicon 代理(双层守护:cards 引用 + SSRF 黑段)

### Phase 3 — OAuth2 / OIDC 服务端 ✅

- `repository/oauth.go` clients / codes / tokens / grants
- `handler/oauth.go` authorize / token / userinfo / introspect / revoke
- `handler/admin_oauth_clients.go` 客户端 CRUD,密钥仅展示一次
- 标准:Authorization Code + **PKCE 必填** + Refresh 轮换 + **Refresh 重用 → 整条 chain 撤销**
- 不实现:Implicit、ROPC、Client Credentials(故意)

### Phase 4 — Vue 3 SPA ✅

- Vite 6 + Vue 3 + Tailwind 3 单文件 SPA,gzip 后 ~50 KB
- 自研 hash 路由(无 vue-router 依赖)+ 全局 session store + toast
- 公开首页:section + card 网格,锁定卡片显示锁标志
- 认证页:登录 / 注册(双步邮件码) / 忘记密码(双步)
- 个人中心 5 标签:资料 / 密码 / 登录历史 / 活动日志 / 已授权应用
- OAuth 同意页:logo / 描述 / scope 解释 / 允许或拒绝
- 管理后台 8 标签:概览 / 用户 / 板块 / 卡片 / 图标 / OAuth 应用 / 设置 / 审计
- `cmd/qishu/spa.go` `//go:embed` 把 SPA 嵌进 Go 二进制
- 多阶段 Dockerfile:`node:22-alpine` 编 SPA → `golang:1.22-alpine` 编 Go → `alpine:3.20` 运行时

---

## 安全清单

| 项 | 状态 |
|----|------|
| favicon SSRF 双层防御 | ✓ cards 引用 + ssrf 黑段 |
| OAuth 客户端字段 XSS | ✓ urlsafe 净化 |
| 邮件 HTML 注入 | ✓ EscapeHTML |
| 长度限制集中管理 | ✓ validator 包 |
| 限流内存上限 | ✓ NewMemoryLimiter(2000) + sweep |
| 过期数据清理 | ✓ startPruner 6h 周期,含 oauth |
| 用户枚举 | ✓ dummy hash + 常时比较 |
| JWT alg:none | ✓ 拒绝 |
| 忘记密码用户存在性 | ✓ 不泄露 |
| 请求体 1MB 上限 | ✓ |
| OAuth refresh 重用 | ✓ RevokeChain |
| OAuth PKCE 必填 | ✓ |
| OAuth 客户端密钥 | ✓ 仅展示一次,bcrypt |
| SPA 路径泄露 | ✓ /api/* 永不返回 HTML |

## Favicon 权限语义(明确)

**只有管理员可以管理 favicon。** 写入接口在 `MustAdmin` 守护下:

```
GET    /api/admin/favicons              # 看缓存列表(含失败原因)
POST   /api/admin/favicons/refresh      # 强制刷新
DELETE /api/admin/favicons/:origin      # 删除缓存
```

普通用户只能访问公开读图接口 `GET /api/favicons/image?origin=...`,
受双层防护:
1. origin 必须已被某张卡片引用(`CardRepo.ReferencesOrigin`)
2. 缓存未命中时,出站抓取前 `ssrf.ResolveAndCheck` 拒私网

---

## 端到端验证结果

| 阶段 | 验证项 | RSS |
|------|--------|-----|
| 1 | 注册 / 确认 / 登录 / me / 错密 401 | 39.8 MB |
| 2 | 4 张不同权限的卡片 + javascript URL 拒绝 + 匿名 / Bob 视角 locked + 403 admin 隔离 | 32.9 MB |
| 3 | 完整 PKCE 流程 + 错 verifier 拒绝 + refresh 轮换 + 重用 chain 撤销 + 用户撤销 grant | 34.2 MB |
| 4 | SPA 嵌入 + asset GET/HEAD + 5 个深链 fallback + /api/* 仍 JSON | 35.9 MB |

---

## 运行

### 本地直跑(开发)

```bash
# 后端
go mod tidy
JWT_SECRET=$(head -c 48 /dev/urandom | base64) \
ADMIN_EMAIL=admin@example.com \
ADMIN_PASSWORD=AdminPass123 \
APP_ENV=development \
go run ./cmd/qishu
# 监听 :8080,SPA 此时未嵌入 → 显示 API-only 提示页

# 前端(另开终端,带热更新)
cd web
npm install
npm run dev
# 监听 :5173,/api 反代到 :8080
```

### 容器(一键部署)

```bash
cp .env.example .env
# 至少填:JWT_SECRET、ADMIN_EMAIL、ADMIN_PASSWORD
docker compose up --build -d
docker compose logs -f
# 监听 :8080,SPA 已嵌入 → 直接是完整网页应用
```

### 生产构建一体二进制

```bash
cd web && npm install && npm run build && cd ..
cp -r web/dist/* cmd/qishu/web-dist/
go build -ldflags="-s -w" -o qishu ./cmd/qishu
# qishu 这个 ~14 MB 单文件即程序,scp 到服务器即用
```

---

## 测试

```bash
go test ./...
```

`internal/auth`、`ratelimit`、`ssrf`、`urlsafe`、`validator` 各有单测;
handler 层目前没有单测(下一阶段补)。

---

## 目录速览

```
qishu/
├── README.md                   ← 概览,先读
├── HANDOFF.md                  ← 本文档
├── ARCHITECTURE.md             ← 架构详细
├── Dockerfile                  ← 三阶段:node → go → alpine
├── docker-compose.yml          ← 含 healthcheck + memory cap
├── Makefile                    ← make build / test / docker-up
├── .env.example                ← 环境变量模板,cp 到 .env
├── go.mod                      ← 干净版,需要 go mod tidy
├── cmd/qishu/
│   ├── main.go                 ← DI 装配
│   ├── helpers.go              ← bootstrapAdmin / startPruner / signer
│   ├── spa.go                  ← //go:embed + SPA fallback
│   └── web-dist/               ← 构建期由 SPA 阶段填充
├── internal/                   ← 14 个包,见 README
└── web/                        ← Vue 3 SPA 源码
    ├── package.json
    ├── vite.config.js
    ├── tailwind.config.js
    ├── index.html
    └── src/
        ├── App.vue             ← 路由表
        ├── main.js
        ├── router.js           ← hash 路由
        ├── api.js              ← fetch 封装
        ├── session.js          ← 全局用户态
        ├── toast.js
        ├── format.js
        ├── style.css
        ├── components/
        │   ├── NavBar.vue
        │   ├── Toaster.vue
        │   ├── Modal.vue
        │   ├── CardTile.vue
        │   ├── PermissionBadge.vue
        │   ├── account/    (5 tabs)
        │   └── admin/      (8 tabs)
        └── pages/          (8 pages)
```

---

## 后续可做(非阻塞)

- handler 层单测(目前只有 leaf 包有)
- e2e 浏览器测试(Playwright)
- i18n(目前中文硬编码)
- 暗色主题(Tailwind 已有 dark: 工具类,加切换即可)
- 应用指标(Prometheus /metrics)
- WebAuthn 二次因素登录
