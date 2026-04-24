# 栖枢 Profile

统一的内容入口、用户认证与后台管理平台(**Next.js 16 + React 19 + SQLite**)。

**当前版本:1.2.0**(2026-04-24)。主要变化:Node 22 LTS、URL 安全守卫、
内容长度上限、邮件 HTML 转义、更严的内存策略。详见 `CHANGES.md` 与 `PLAN.md`。

---

## 快速启动

```bash
# 确认本机 Node 版本 ≥ 22.0.0(1.2.0 起硬性要求)
node -v

cp .env.example .env          # 至少填齐 JWT_SECRET / SITE_URL / ADMIN_EMAIL / ADMIN_PASSWORD
npm install --ignore-scripts  # 避免 postinstall 在本地乱建数据库
npm run init                  # 初始化 data/app.db + seed .env 到 settings 表 + 创建管理员
npm run dev-seed              # (可选)本地开发示例数据
npm run dev                   # http://localhost:3000
```

**管理员账号**:由 `.env` 的 `ADMIN_EMAIL` / `ADMIN_PASSWORD` 决定。两者都填了
`scripts/init.js` 才会创建管理员;否则只建库、不建账号,事后跑
`npm run create-temp-admin` 临时建一个。

**不再有默认账号**。以前的 `admin@qishu.local / Admin@123456` 已经移除 —— 写死
在代码里的默认凭据等同于后门。

首次启动时 `scripts/init.js` 会:
1. 创建 `data/app.db`(SQLite + WAL),建表、建索引、跑 migrations
2. 若存在旧版 `data/*.json` / 日期分区目录,自动迁移
3. 把 `.env` 里受管配置项一次性写入 `settings` 表
4. 若 `ADMIN_EMAIL` + `ADMIN_PASSWORD` 都给了且用户表里还没有该邮箱,创建管理员

---

## 技术栈

- **Next.js 16 App Router**(JavaScript)
- React 19
- SQLite via `better-sqlite3`(同步、WAL、事务)
- JWT HttpOnly Cookie + bcrypt
- Resend 邮件(未配置时开发态降级到 stdout 回显)

**Node.js 版本要求:≥ 22.0.0 LTS**。`package.json` 的 `engines` 字段会阻止
npm 在更低版本上安装。

---

## 内存占用预期(请先看再部署)

**Next.js 16 + React 19 + better-sqlite3 组合在任何配置下都不可能 < 100MB。**
这是 Node 运行时 + V8 堆 + 原生模块的硬性基线。

| 场景 | RSS 范围 |
|---|---|
| 空载(刚启动) | 120–180 MB |
| 正常使用(1–20 并发) | 150–280 MB |
| 高并发峰值(50 并发) | 200–350 MB |
| pm2 触发 `max_memory_restart` | > 220 MB 持续 |

1.2.0 通过 `--max-old-space-size=160` + `max_memory_restart: 220M` 把这个范围
压到了栈允许的下限。更多细节见 `DEPLOY.md` 第 3 节。

**如果你的 VPS < 512MB 内存,这个栈不合适。** 此时建议选一个更轻的替代方案
(Fastify + HTMX)或者升级内存。

---

## 配置(`/admin/settings`)

**`.env` 只在首次启动时读取**。之后所有配置一律走 `/admin/settings`:

- 任何字段改完**立即生效**,不用重启
- 敏感字段默认以 `●●●●●●` 掩码显示,点「查看敏感」切换(被记入审计日志)
- 如果要从零重来:`rm data/app.db && npm run init`

配置项分 7 大类:认证与会话 / 邮件服务 / OAuth 接入 / 验证码策略 / 反滥用节流 /
通用 / 数据保留策略。

---

## 站点图标(卡片 favicon)

- 首次展示卡片时,后端同步抓取目标站点的 favicon 并存进 `favicon_cache`
- **之后永不自动刷新**(避免请求堆积)
- 管理员在 `/admin/favicons` 可以:单条刷新 / 清除 / 立即刷新全部(串行抓取)
- 抓取失败连续 3 次后自动冷却 24 小时再自愈重试

**孤儿清理**(1.0 新增,1.2.0 节律调整):卡片被删除 / URL 改到另一域名
时,旧的 `favicon_cache` 行立即被清理。`lib/fileStore.js` 的 autoPrune
定时器(现为每 6 小时一次)做兜底兜网。

---

## 数据保留 / 清理

高写入量表(`login_history` / `activity_log` / `verification_codes` /
`oauth_tokens`)在 `/admin/retention` 页面可视化清理。普通 / 会员用户在个人中
心看到的行为日志条数由 `USER_ACTIVITY_LOG_CAP` 决定(默认 30 条,设 -1 解除
限制);管理员不受此限制。

---

## 数据库浏览

`/admin/database` 提供只读表浏览器。敏感列永远以占位符返回。

---

## 用户角色

| 角色 | 说明 |
|---|---|
| `user` | 默认普通登录用户 |
| `member` | 会员用户 — 可访问 `permission=member` 卡片 |
| `admin` | 管理员 — 全权限 |

---

## 目录结构

```
qishu/
├── app/
│   ├── page.js / page.module.css      # 首页(逐字风动标题 + 板块卡片)
│   ├── layout.js / globals.css        # Root + 全局样式 + Toast/Confirm Provider
│   ├── auth/                          # 登录/注册/验证/找回密码
│   ├── account/                       # 个人中心
│   ├── admin/                         # 仪表盘 + 用户 + 板块 + 卡片 + ...
│   └── api/                           # 所有后端接口
├── lib/
│   ├── database.js                    # better-sqlite3 + schema + MANAGED_SETTINGS
│   ├── settings.js                    # 配置读写(带缓存)
│   ├── auth.js                        # JWT + cookie(会话时长从 settings 读)
│   ├── password.js                    # bcrypt + 密码强度
│   ├── rateLimit.js                   # 常量内存限流
│   ├── ssrfGuard.js                   # 出站请求的 SSRF 守卫
│   ├── urlSafe.js                     # 【1.2.0】URL scheme 安全校验
│   ├── contentLimits.js               # 【1.2.0】内容字段长度上限
│   ├── email.js                       # Resend + escapeHtml(纵深防御)
│   ├── favicon.js                     # 抓取 / 缓存 / 孤儿清理
│   ├── fileStore.js                   # 高写入表 + autoPrune 定时器
│   └── oauthClients.js                # 静态配置 + 动态 DB 合并
├── components/
│   ├── ui/index.js                    # Toast/Modal/Confirm/...
│   ├── ui/BrandIcon.js                # 品牌图标
│   └── layout/TopBar.js
├── config/oauth-clients.js            # OAuth 静态客户端
├── scripts/
│   ├── init.js                        # 首次启动 / postinstall
│   ├── dev-seed.js                    # 本地占位数据
│   ├── create-temp-admin.js           # Bootstrap 管理员
│   └── load-test.js                   # 【1.2.0】本地压测(Playwright)
├── tests/                             # node --test
├── ecosystem.config.cjs               # pm2 配置(V8 堆上限 + 重启策略)
├── .env.example
├── .nvmrc                             # Node 22
├── PLAN.md                            # 【1.2.0】本轮改动设计说明
├── AUDIT.md                           # 代码审查
├── DEPLOY.md                          # 部署指南(含 nginx + Cloudflare + Kinsing 自查)
└── CHANGES.md                         # 历史改动记录
```

---

## 生产部署

见 `DEPLOY.md`。核心步骤:

1. Node.js 22 LTS 安装好
2. 填 `.env`(`SITE_URL`、`JWT_SECRET ≥ 64 字符`、`RESEND_API_KEY`、`QISHU_DEFAULT_CLIENT_SECRET`)
3. `npm install --ignore-scripts && npm run init`
4. `NODE_OPTIONS="--max-old-space-size=512" npm run build`
5. `pm2 start ecosystem.config.cjs && pm2 save && pm2 startup`
6. nginx 反代 + Cloudflare 真实 IP 恢复(`DEPLOY.md` §5 有完整配置)
7. SSH 硬化 + 防火墙(`DEPLOY.md` §7)
8. **跑一遍 Kinsing 自查清单**(`DEPLOY.md` §6)

---

## 测试

```bash
npm test         # node --test,一次跑完所有 tests/*.test.js
npm run lint     # eslint,零告警
npm run check    # lint + test + build 三合一
```

1.2.0 新增测试:
- `urlSafe.test.js`       URL scheme 守卫
- `ssrfGuard.test.js`     IP 黑段判定
- `contentLimits.test.js` 字段长度边界
- `username.test.js`      name + bio
- `faviconNormalize.test.js`
- `rateLimitMemory.test.js` 限流桶内存硬顶
- `emailEscape.test.js`   邮件 HTML 转义

---

## 第三方接入(OAuth)

静态客户端在 `config/oauth-clients.js` 里声明,秘钥通过 `secretEnv` 关联到
settings 表。动态客户端通过 `/admin/oauth-clients` 自助创建。详见 `AUDIT.md`。

授权码与 access_token 的有效期由 `OAUTH_CODE_EXPIRY_MINUTES` /
`OAUTH_TOKEN_EXPIRY_SECONDS` 控制,管理员可在 `/admin/settings` 调整。

**1.2.0 安全加固:**
- `homepageUrl` / `logoUrl` 字段 写入前过 `sanitizeHttpUrlOrEmpty` —— 非 http(s)
  直接清空(而不是报错),避免 `javascript:alert(1)` 之类注入到 `/oauth/authorize`
  页面的 `<a href={homepageUrl}>` 上。
