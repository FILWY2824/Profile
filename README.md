# 栖枢 Profile

统一的内容入口、用户认证与后台管理平台(Next.js 15 + SQLite)。

## 快速启动

```bash
cp .env.example .env          # 按里面的注释至少填齐:JWT_SECRET / ADMIN_EMAIL / ADMIN_PASSWORD
npm install --ignore-scripts  # 避免 postinstall 在本地乱建数据库(如有需要,下一步再跑 init)
npm run init                  # 初始化 data/app.db + seed .env 到 settings 表 + 创建管理员
npm run dev-seed              # (可选)本地开发示例数据
npm run dev                   # http://localhost:3000
```

**管理员账号**:由 `.env` 的 `ADMIN_EMAIL` / `ADMIN_PASSWORD` 决定。
两者都填了 `scripts/init.js` 才会创建管理员;否则只建库、不建账号,你可以
事后跑 `npm run create-temp-admin` 临时建一个。

**不再有默认账号**。以前的 `admin@qishu.local / Admin@123456` 已经移除 —— 写死
在代码里的默认凭据等同于后门,哪怕你打算事后就改,静默几小时的风险窗也不值得。

首次启动时 `scripts/init.js` 会:
1. 创建 `data/app.db`(SQLite + WAL),建表、建索引、跑 migrations
2. 若存在旧版 `data/*.json` / 日期分区目录,自动迁移
3. 把 `.env` 里受管的配置项(`JWT_SECRET` / `RESEND_*` / `SITE_NAME` / 会话时长 /
   验证码策略 / 反滥用节流 / OAuth 秘钥 / 保留策略 等)一次性写入 `settings` 表
4. 若 `ADMIN_EMAIL` + `ADMIN_PASSWORD` 都给了且用户表里还没有该邮箱,创建管理员

**示例板块与卡片不再由 `init.js` 自动写入**。`npm run dev-seed` 会插入明确标注
为占位符的 example.com 链接,仅供本地开发;生产环境请通过 `/admin/sections` 和
`/admin/cards` 手动创建你真实的内容。

之后每次启动都会增量同步受管配置项 —— 新版加了新键,下次启动就会自动出现在
`/admin/settings`,已有键的值不会被重置。

---

## 技术栈

- Next.js 15 App Router(JavaScript)
- SQLite via `better-sqlite3`(同步、WAL、事务)
- JWT HttpOnly Cookie + bcrypt
- Resend 邮件。未配置 `RESEND_API_KEY` 时:
  - `NODE_ENV=production` → 发邮件接口直接失败(避免"前端看着成功,用户收不到"的静默黑洞)
  - 其他环境 → 退化成"验证码打到 stdout",便于本地调试

---

## 配置的工作方式(⚠ 与旧版不同)

**`.env` 只在首次启动时读取**。之后所有配置一律走 `/admin/settings`:

- 任何字段(JWT_SECRET / RESEND_API_KEY / 会话时长 / 节流阈值 /
  OAuth 客户端 secret / 保留策略 等)改完**立即生效**,不用重启
- 敏感字段默认以 `●●●●●●` 掩码显示,点「查看敏感」切换(此操作被记入审计日志)
- 如果要从零重来:`rm data/app.db && npm run init`

配置项分 7 大类:

| 分类 | 常见键 | 说明 |
|------|--------|------|
| 认证与会话 | `JWT_SECRET` · `SESSION_EXPIRY_DAYS` | 登录会话有效期等 |
| 邮件服务 | `RESEND_API_KEY` · `RESEND_FROM` | Resend 对接 |
| OAuth 接入 | 各 `*_CLIENT_SECRET` · 授权码/Token 有效期 | 每个静态客户端的 secret 自动展示 |
| 验证码策略 | 有效期(分) · 最大尝试次数 | 注册/忘密/改密所有验证码共用 |
| 反滥用节流 | `RL_LOGIN_*` · `RL_REGISTER_*` · `RL_FORGOT_*` · `RL_CHANGE_PW_*` | 每类动作各有 IP / 邮箱两个维度 × MAX + WINDOW_MINUTES |
| 通用 | `SITE_NAME` · `USER_ACTIVITY_LOG_CAP` | 界面与用户可见的行为日志上限 |
| 数据保留策略 | 两类保留天数 | 用于 `/admin/retention` |

---

## 站点图标(卡片 favicon)

- 首次展示卡片时,后端同步抓取目标站点的 favicon 并存进 `favicon_cache`
- **之后永不自动刷新**(之前的"每 N 天后台刷新"已移除,避免请求堆积)
- 管理员在 `/admin/favicons` 可以:
  - 单条刷新 / 清除
  - 立即刷新全部(串行抓取)
- 抓取失败连续 3 次后自动冷却 24 小时再自愈重试

---

## 数据保留 / 清理

高写入量表(`login_history` / `activity_log` / `verification_codes` / `oauth_tokens`)在 `/admin/retention` 页面可视化清理:

- 输入天数 → 删除更早记录
- 输入 **0** → 清空全部(有二次确认,不可恢复)
- 勾「保存为默认策略」→ 天数写入 `settings` 表

普通 / 会员用户在个人中心看到的行为日志条数由 `USER_ACTIVITY_LOG_CAP` 决定
(默认 30 条,设 -1 解除限制);管理员不受此限制。

---

## 数据库浏览

`/admin/database` 提供只读表浏览器:

- 左侧:所有表 + 行数
- 右侧:选中表的分页数据(每页 20)
- 敏感列(`passwordHash` / `accessToken` / `clientSecret` 等)永远以占位符返回

---

## 用户角色

| 角色     | 说明                                       |
|----------|--------------------------------------------|
| `user`   | 默认普通登录用户                           |
| `member` | 会员用户 — 可访问 `permission=member` 卡片 |
| `admin`  | 管理员 — 全权限                            |

---

## 项目结构

```
qishu/
├── app/
│   ├── page.js / page.module.css      # 首页(逐字风动标题 + 板块卡片)
│   ├── layout.js / globals.css        # Root + 全局样式 + Toast/Confirm Provider
│   ├── auth/                          # 登录/注册/验证/找回密码
│   ├── account/                       # 个人中心(分页 / 新密码流)
│   ├── admin/                         # 仪表盘 + 用户 + 板块 + 卡片 +
│   │                                  # 登录记录 + 行为日志 + 数据清理 +
│   │                                  # 平台配置 + 图标候选 + 数据库
│   └── api/                           # 所有后端接口
├── lib/
│   ├── database.js                    # better-sqlite3 + schema + MANAGED_SETTINGS
│   ├── settings.js                    # 配置读写(带缓存),DEFAULTS 从 MANAGED 派生
│   ├── db.js                          # 兼容层(findAll/findOne/…)
│   ├── fileStore.js                   # 高写入量表的包装 + 验证码最大尝试辅助
│   ├── auth.js                        # JWT + cookie(会话时长从 settings 读)
│   ├── password.js / rateLimit.js     # (rateLimit 内部定时器已 .unref,不阻塞进程退出)
│   ├── email.js                       # Resend(降级开发模式)
│   ├── favicon.js                     # 抓取 / 缓存(无自动刷新,只管理员触发)
│   └── oauthClients.js                # 静态配置 + 动态 DB 合并
├── components/
│   ├── ui/index.js                    # Toast/Modal/Confirm/…
│   ├── ui/BrandIcon.js                # 5 组候选图标(variant 属性切换)
│   └── layout/TopBar.js
├── config/oauth-clients.js            # 每条静态客户端的 secretEnv 会自动注册到 settings
├── scripts/init.js                    # 首次启动 / postinstall
├── public/icon.svg                    # favicon(默认 rings 变体)
└── .env.example
```

---

## 生产部署

1. 复制 `.env.example` → `.env`,改 `JWT_SECRET`(≥32 位)和 `RESEND_*`
2. `npm run build && npm start`
3. 登录管理员 → `/admin/settings` 修改默认密码和密钥
4. 保证 `data/` 目录挂载到持久化存储卷 —— `data/app.db` 是单点 SSOT
5. 备份时记得处理 WAL:`sqlite3 data/app.db ".backup '/path/to/backup.db'"`(会自动合并 `-wal`)

---

## 第三方接入(OAuth)

静态客户端仍然在 `config/oauth-clients.js` 里声明,秘钥通过 `secretEnv` 关联到
settings 表。**每条静态客户端的 secretEnv 在启动时会自动注册为受管配置项**,
管理员进 `/admin/settings` → 「OAuth 接入」就能看到并轮换:

```js
{
  clientId: 'my-app',
  name: '我的应用',
  redirectUris: ['https://example.com/cb'],
  scopes: ['openid', 'profile', 'email'],
  secretEnv: 'MY_APP_SECRET',  // 首次启动时 .env 的同名变量会迁入 settings;
                               // 管理员在后台改 MY_APP_SECRET 即可轮换
}
```

授权码与 access_token 的有效期也由 `OAUTH_CODE_EXPIRY_MINUTES` /
`OAUTH_TOKEN_EXPIRY_SECONDS` 控制,管理员可在同一个页面调整。
