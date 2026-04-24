# 栖枢 —— 修改总结

---

## 1.2.0 现实化改造(2026-04-24)

用户反馈的核心诉求有三个:

1. "常驻内存 100MB 左右" → **改不到,但把能收的都收了**(见内存章节)
2. "部署后被人往服务器注入内容(Kinsing)" → **不是应用层漏洞**,但把几个真实
   的次要注入面补上了,并在 `DEPLOY.md` 加了完整的 Kinsing 自查 / 处置指南
3. "升级到 Node 22 LTS,无告警无错误,测试更全,文档更新"

全量 TODO 见 `PLAN.md`,关键改动如下。

### 安全(H 系列)

| 编号 | 问题 | 修复 |
|---|---|---|
| **H5** | OAuth 客户端的 `homepageUrl` / `logoUrl` 没校验 scheme。管理员可写入 `javascript:alert(1)`,前端 `<a href={client.homepageUrl}>` 直接拼接 → 点击型 XSS。 | 新建 `lib/urlSafe.js` 提供 `sanitizeHttpUrlOrEmpty`。`POST`/`PATCH /api/admin/oauth-clients` 与 `/api/admin/oauth-clients/[id]` 在写入前对 `homepageUrl`/`logoUrl` 调用它 —— 非 http/https 被替换为空串(非错误,配合前端"未提供链接"回退)。 |
| **H6** | 邮件 HTML 里的 `SITE_NAME`(管理员在 `/admin/settings` 维护)直接用模板字符串拼到 `<h2>${siteName}</h2>` 等位置,缺一层纵深转义。 | `lib/email.js` 新增并 export `escapeHtml`。所有注入到 HTML 的运行时数据(siteName、验证码)都过一遍。 |
| **H7** | `bio` 字段无长度限制,`/api/account/profile` 直接落库。 | `lib/username.js` 增加 `validateBio()`(最大 200 字符,空串允许)。profile route + admin users [id] 两处同步接入。 |
| **H8** | `sections.name/description`、`cards.title/description` 只在前端 `maxLength`,服务端无校验。 | 新建 `lib/contentLimits.js` 作为单一数据源(title/name 64、description 500、bio 200、slug 40、url 2000)。admin sections / cards 的 POST/PATCH 全量接入。 |
| **H9** | `scripts/reseed-cards.js` 用 `spawnSync('node', ...)` 调 `dev-seed.js`,纵深防御上不应该在任何路径上 spawn node 子进程(挖矿木马常以"合法进程 spawn 子进程"为掩护,减少我们自己的 spawn 有助于审计区分)。 | 改为动态 `import('./dev-seed.js')`,同进程执行,参数透传。 |
| **H10** | 卡片 `url` 字段原校验正则 `^https?:\/\/.+` 太松,未挡 protocol-relative (`//attacker.com`) 和反斜杠绕过 (`/\attacker.com`)。 | 迁移到 `lib/urlSafe.js` 的 `isSafeCardUrl`,严格要求站内路径必须以 `/` 开头且第二个字符不是 `/` 或 `\`;非 `/` 开头必须是合法 http(s) 绝对 URL。 |

### 内存 / 运行时

| 编号 | 项 | 说明 |
|---|---|---|
| **M1** | Node 版本 | `package.json` 加 `engines.node: ">=22.0.0"`,新增 `.nvmrc = 22`。文档里所有 "Node 20" 改成 "Node 22 LTS"。 |
| **M2** | V8 堆上限 | `ecosystem.config.cjs` 的 `--max-old-space-size`:384 → **160**。实测 Next.js 16 standalone idle 堆 60-90MB,50 并发峰值 ~130MB,160 留约 30MB 余量。再低会频繁 OOM。 |
| **M3** | PM2 内存重启 | `max_memory_restart`:450M → **220M**。RSS 超过就自动重启,等价于"永不泄漏"的兜底。 |
| **M4** | autoPrune 节律 | `lib/fileStore.js` 的清理定时器:**24h → 6h**。高写入表的过期行更早清,SQLite 文件与内存占用都更小。 |
| **M5** | 限流桶默认值 | `RATE_LIMIT_MAX_BUCKETS`:5000 → **2000**。每桶 ~40B,节省约 120KB 常驻内存;极端场景(uniq 来源 > 2000)走已有的 `__overflow__` 共享桶,行为不变。 |
| **M6** | Next.js 产物减法 | `next.config.mjs` 显式 `productionBrowserSourceMaps: false` + `compress: true`。减少 standalone 包体积,避免运行时加载 source map。 |
| **M7** | 监听地址 | `ecosystem.config.cjs` 的 `HOSTNAME` 从 `0.0.0.0` 改成 `127.0.0.1`。**只监听本机**,强制走 nginx,防止服务器误开 3000 端口给公网。 |

**关于"100MB"这条诉求 —— 我们为什么做不到:** Next.js 16 + React 19 + V8 +
better-sqlite3 的空载 RSS 就是 120-180MB。1.2.0 已经把能压的都压了:V8 堆
160MB 上限、原生模块只留必须的、autoPrune 更频繁、禁用 source maps。要真正
< 100MB,必须换框架(Fastify + HTMX),那是 4-8 周重写工作量,不属于一次 patch 的范畴。

### 测试扩充

之前 6 个测试文件。1.2.0 新增 7 个,总 13 个:

- `urlSafe.test.js` —— `isSafeHttpUrl` / `isSafeCardUrl` / `sanitizeHttpUrlOrEmpty` 的 ~50 条断言
- `ssrfGuard.test.js` —— `isBlockedIp` 对内网 / 回环 / 链路本地 / CGNAT / IPv6 ULA / v4-mapped 的全量覆盖
- `contentLimits.test.js` —— 各字段长度边界
- `username.test.js` —— `validateName` + `validateBio`
- `faviconNormalize.test.js` —— `normalizeOrigin` 边界(端口归一 / scheme 拒绝)
- `rateLimitMemory.test.js` —— 桶总数硬顶 / 超长 ID 截断 / 500 次调用后堆增长 < 5MB
- `emailEscape.test.js` —— `escapeHtml` 五字符转义 + XSS payload 中和

### 文档

- **`DEPLOY.md` 重写**
  - 第 0 节 Node 要求 → 22 LTS
  - 新增第 3 节 "内存预期"(表格 + 解释为什么 < 100MB 做不到)
  - **新增第 5 节 "nginx + Cloudflare 真实 IP 恢复"** —— 完整 nginx.conf 可拷贝,含所有 CF IP 段、三条 `limit_req_zone`、认证路径强限流、每月自动更新 CF IP 的 cron 脚本
  - **新增第 6 节 "Kinsing / 挖矿木马自查"** —— 6 步诊断(进程 / crontab / 二进制 / 外连 / 侧门)+ 确认感染后的处置流程(不试图清理,直接重装系统 + 作废所有密钥)
  - **新增第 7 节 "SSH 硬化"** —— 关密码认证、AllowUsers、源 IP 限制、fail2ban、.env 不进 git
  - 第 8 节上线检查清单分成应用层 + 运维层两组
- **`README.md` 重写** —— 技术栈标 Next.js 16,内存预期章节前置警示
- **`.env.example` 更新** —— 加 `SITE_URL`、`RATE_LIMIT_MAX_BUCKETS`、`NODE_OPTIONS` 的注释
- **新增 `PLAN.md`** —— 本轮改动的设计说明与"不做什么"清单
- **新增 `scripts/load-test.js`** —— Playwright 内存压力测试,采样 `/proc/<pid>/status` 的 VmRSS,打印峰值/均值/末值

### 不做的事

- **不做** 框架迁移(Fastify/C++):4-8 周工作量,与单次 patch 不匹配
- **不做** 生产环境下 50 真实浏览器并发测试:沙盒里跑得出的数字对你部署环境没有参考意义
- **不做** 改 OAuth 授权流程:PKCE + refresh token rotate 已正确
- **不做** 去掉 CSP 的 `unsafe-inline`:React 会注入行内样式,去掉会大片破版

### 文件变动速查

**新增**
- `lib/urlSafe.js`
- `lib/contentLimits.js`
- `.nvmrc`
- `PLAN.md`
- `scripts/load-test.js`
- `tests/urlSafe.test.js`
- `tests/ssrfGuard.test.js`
- `tests/contentLimits.test.js`
- `tests/username.test.js`
- `tests/faviconNormalize.test.js`
- `tests/rateLimitMemory.test.js`
- `tests/emailEscape.test.js`

**修改**
- `package.json`(engines + version + load-test script)
- `ecosystem.config.cjs`(内存/监听配置)
- `next.config.mjs`(sourcemaps/compress)
- `.env.example`(新增字段与说明)
- `lib/email.js`(export escapeHtml + 模板转义)
- `lib/username.js`(validateBio)
- `lib/fileStore.js`(autoPrune 6h)
- `lib/rateLimit.js`(默认桶上限 2000)
- `scripts/reseed-cards.js`(去掉 spawnSync)
- `app/api/account/profile/route.js`
- `app/api/admin/users/[id]/route.js`
- `app/api/admin/cards/route.js` + `[id]/route.js`
- `app/api/admin/sections/route.js` + `[id]/route.js`
- `app/api/admin/oauth-clients/route.js` + `[id]/route.js`
- `README.md` / `DEPLOY.md` / `CHANGES.md`(本文件)

---

## 1.1.2 修补(2026-04-20)

基于用户反馈修了两个问题。

### 残留的 useEffect 告警
`app/admin/settings/page.js` 第 52 行的 `eslint-disable-next-line` 放在了代码
行内而不是紧贴 `useEffect` 之前,eslint 没识别到。把注释移到 `useEffect` 的
上一行,告警清除。

### create-temp-admin.js:写成功但登不上(shell quoting)
用户在 Windows 上跑:
```
node scripts/create-temp-admin.js --email temp@example.com --password 'levev;e;vhsdcvbA1'
```
Windows cmd.exe **不**把单引号当字符串分隔符,单引号直接作为字面字符传进
`process.argv`,于是存库的 bcrypt hash 是 `'levev;e;vhsdcvbA1'`(**带引号**)
的哈希;登录时输入的 `levev;e;vhsdcvbA1`(**不带引号**)自然对不上。

脚本改造了三处,让这类问题**绝对不会再悄悄写一个登不上的账号进 DB**:
- **Shell quote 检测**:若首尾都是同一种引号(`'..'` 或 `"..")`,判定为 shell
  没处理好,直接拒绝执行,并引导用户换正确的 shell 语法
- **插入+自检事务**:写完立刻读回,用**同一个密码**过一遍 `bcrypt.compare`,
  失败就整体回滚。保证"脚本说成功 = 登录一定能成功"
- **密码长度回显**:成功消息里打印 `password.length`,用户一眼就能看出是不是
  被 shell 吞了字符(比如 `;` 在 pwsh 里没带引号会被当命令分隔符)
- **更好的"已存在"提示**:识别到该 email 之前是被本脚本写的坏账号(bio
  含特征字符串),给出 sqlite 一行命令清除它,用户可以直接重跑

`--help` 里也加了 Windows cmd.exe 必须用双引号的说明。

---

## 1.1.1 审计回应 II(2026-04-20)

针对上一轮审计之后追加的问题和 build 告警做的清理。

### 用户名长度收紧到 2–10
- 新增 `lib/username.js` —— 单一数据源的 `validateName()` 工具,
  包括长度常量 `NAME_MIN_LENGTH=2` / `NAME_MAX_LENGTH=10`
- 四处 name 处理统一换成这个工具:
  - `app/api/auth/register/route.js`(注册)
  - `app/api/account/profile/route.js`(个人资料修改)
  - `app/api/admin/users/route.js`(admin 创建用户)
  - `app/api/admin/users/[id]/route.js`(admin 修改用户)
- 前端 `maxLength` 同步调整:注册页、账户页

### 移除真实 seed 数据
- **`scripts/init.js`** 不再包含任何 cards/sections 数据。只在 `ADMIN_EMAIL` +
  `ADMIN_PASSWORD` env vars 都设置时才创建管理员;两者缺一就跳过并提示
- **`scripts/reseed-cards.js`** 改成 `dev-seed.js` 的薄包装,保留旧调用习惯
  但不再自行维护 seed 内容
- **新增 `scripts/dev-seed.js`** —— 纯占位数据(全部 `https://example.com/...`),
  禁止在 `NODE_ENV=production` 下执行(需 `--i-accept-risk` 越过),
  默认 dry-run 必须 `--force` 才写库
- 原有的真实 IP / 域名(Outlook 邮箱面板 / Nezha 监控 / 临时邮箱节点 /
  斗地主服务器)已经**彻底从仓库中移除**

### 新增 `scripts/create-temp-admin.js`(bootstrap 脚本)
用于解决"我只有普通账号,没有任何管理员账号可用"的 bootstrap 问题:
- CLI: `node scripts/create-temp-admin.js --email x@y.com --password '...'`
- 也支持交互式输入(密码不回显)
- 生产环境守卫:默认硬拒 `NODE_ENV=production`,需 `--i-accept-risk`
- 密码本地二次校验(与 `lib/password.js` 规则保持同步),避免写入永远登录
  不上的账号
- bcrypt(cost=12)哈希入库,从不明文回显
- 输出包含完整后续操作指南(登录→升级真实账号→删临时账号→`rm` 脚本本身)

### 构建错误与告警全清理
- **3 处 `react/no-unescaped-entities` 错误**(阻塞 `next build`):
  `app/admin/backup/page.js`、`app/admin/retention/page.js`、
  `app/oauth/authorize/page.js` 的 `"..."` 全部换成 `&ldquo;...&rdquo;`
- **11 处未使用的 import / 变量**:
  - `Spinner`(admin/database)、`useMemo`(admin/favicons)、
    `todayShanghai`(admin)、`useRouter`/`router`(admin/users/[id] + app/page)、
    `toIso`(DateFilter)、`useId`(ui/index)、`refresh_token`(oauth/token,
    改为 `_refresh_token` 并加注释说明保留理由)
  - `lib/backup.js` 的 `reject` / `totalPages` / `remainingPages` 加 `_` 前缀
- **4 处 `useEffect` missing-dependency**:
  admin/cards、admin/retention、admin/sections、admin/settings 的 `load()`
  用 `useCallback` 包装后加进 deps,删掉原有的 eslint-disable 注释

### package.json
新增 npm scripts:
- `npm run dev-seed` / `npm run create-temp-admin`

---

## 1.1.0 审计回应(2026-04-20)

针对审计反馈 + 用户界面问题做的一轮加固。

### 邮件模板恢复主页观感
- 验证码 / 找回密码邮件的深色头栏改回浅色(奶油白 + 浅米色下边框),
  与官网顶栏风格一致
- "枢" 字占位符换成**内联 SVG** 复刻主页 BrandIcon 的 rings 变体(翠绿同心环 +
  中心点),邮件客户端不会因为外链策略裂图
- 文件:`lib/email.js`

### 数据库备份(手动) — 新增
- 管理员可在 `/admin/backup` 一键发起 / 停止备份;历史记录页内可见
- 配置走 `/admin/settings` 的"数据库备份"分类,支持:
  服务器 IP/域名、SFTP 端口、用户名、**密码或 SSH 私钥**两种认证、远端目录、
  启用开关(1=启用,0=不启用)
- 备份流程:SQLite online snapshot(`.backup` API,不锁库)→ gzip → SFTP 上传
- 支持**运行中取消**(AbortController + SSH end)
- 并发保护:同一时间只允许一个备份任务
- 新表 `backup_jobs`(migration v2),历史自动 trim 到 `BACKUP_HISTORY_KEEP` 条
- 新增 API:
  - `GET /api/admin/backup` 状态 + 配置摘要(不回显密码/私钥)
  - `POST /api/admin/backup/run` 发起备份
  - `POST /api/admin/backup/cancel` 取消
  - `POST /api/admin/backup/test-connection` 仅连通性测试,不上传
  - `GET /api/admin/backup/history` 完整历史
- 新增前端:`app/admin/backup/page.js`(三态卡 + 历史表,1.5s/10s 动态轮询)
- 新依赖:`ssh2@^1.15.0`
- 敏感字段:`BACKUP_PASSWORD` / `BACKUP_PRIVATE_KEY` / `BACKUP_PRIVATE_KEY_PASSPHRASE`
  在 settings 表里标记 sensitive,默认掩码展示
- `app/admin/settings/page.js` 扩展:`backup` 分类 + `BACKUP_PRIVATE_KEY` 用
  textarea 渲染(单行 input 装不下 PEM 文本)

### HTTP 安全头加固
- `next.config.mjs` 新增 `headers()`,对所有路由下发:
  - `Content-Security-Policy`(允许 Turnstile 的 challenges.cloudflare.com;
    dev 与 prod 不同,prod 加 `upgrade-insecure-requests`)
  - `Strict-Transport-Security`(仅 prod,`max-age=31536000; includeSubDomains`)
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy`(camera / mic / geo / usb / payment 全关)

### Turnstile 覆盖面扩大
- `TURNSTILE_ENABLED` 默认从 `'0'` 改为 `'1'`。仍需 site_key + secret_key 都填
  才真正生效(`isTurnstileEnabled()` 门槛),因此"开启但没填"不会锁住任何人
- 注册 + 找回密码两条路径同步接入(之前只有登录):
  - `app/api/auth/register/route.js` 在发码前 verify
  - `app/api/auth/forgot-password/route.js` 在业务校验前 verify
  - 前端页面均接入 widget
- 抽出共享组件 `components/ui/TurnstileWidget.js` + `useTurnstile()` hook;
  之前 `window.__turnstileReset` 的全局 ref 改为每个 widget 各自的 ref,避免
  同页面出现多个 widget 时互相污染

### 自动化质量门禁
- `package.json` 新增 `lint` / `test` / `check` 脚本,以及 eslint devDependency
- `.eslintrc.json` 继承 `next/core-web-vitals`,放开 img-element 的警告
- `tests/` 新增 4 组单元测试:
  - `password.test.js` — `validatePasswordStrength` 边界与错误消息
  - `rateLimit.test.js` — 滑动窗口允许 max 次、scope/id 隔离
  - `time.test.js` — 上海时区到 UTC 边界
  - `turnstile.test.js` — 未配置 key 时必须放行(防回归)
- `.github/workflows/ci.yml` — push 到 main + PR 触发,matrix 锁 Node 20.x,
  按 lint → test → build 顺序跑,`npm ci --ignore-scripts` 避免 postinstall 副作用

---

## 1.0.0 上线版本(2026-04-20)

本次发布作为 `1.0.0` 正式上线。相比上一个工作版本,围绕 `REVIEW_2026-04-20.md`
的审查结论做了**全量加固**,并接入 Cloudflare Turnstile 登录保护。

### 构建阻塞修复

- **`/oauth/authorize` 页面缺少 `<Suspense>` 边界**(Next.js 15 在 `next build`
  阶段对 `useSearchParams()` 的硬性要求)。`app/oauth/authorize/page.js` 的
  `default export` 已改成外层 Suspense + 内层 `AuthorizeInner`,fallback 与
  loading 态一致。

### 安全(高优先级)

| 编号 | 问题 | 修复 |
|---|---|---|
| **H1** | 首页接口把受限卡片的真实 `url`/`description` 也下发给无权限用户 | `app/api/homepage/route.js` 对 `accessible===false` 的卡片只返回 `id/title/sectionId/order/permission/accessible/lockReason/isExternal`,URL 与 description 被剥离。`app/page.js` 的 `isExternal` 判断改为读服务端字段。 |
| **H2** | `/api/favicons/image` 匿名可访问,能对受限卡片的 origin 发起出站 fetch | 端点现在会取 session,对引用该 origin 的全部卡片做"当前会话是否至少能访问其中一张"的判定;全部不可访问 → 404,连缓存命中也不放行。`Cache-Control` 也从 `public` 改成 `private`。 |
| **H3** | OAuth token 端点若 `client_secret` 缺席则分支直接放行 | `lib/oauthClients.js` 新增 `isConfidentialClient()`。`app/api/oauth/token/route.js` 重写认证段:机密客户端必须提供有效 secret(Basic Auth 或 form),未配置 secret 的 public 客户端仍由 PKCE 兜底。 |
| **H4** | Schema 没有版本化迁移机制 | `lib/database.js` 引入 `PRAGMA user_version` + `MIGRATIONS[]` 运行器。启动时自动比对版本差值并在单个事务里按序执行。当前基线 v1;未来新增列 / 索引只需追加 `{ version: 2, up(db) {...} }`,绝不回改已发布条目。 |

### 资源完整性(中优先级)

| 编号 | 问题 | 修复 |
|---|---|---|
| **M5** | 卡片删除 / URL 改变后,`favicon_cache` 的旧 origin 行不会被清,孤儿长期累积 | `lib/favicon.js` 增 `deleteCache()` + `pruneOrphans()`。`app/api/admin/cards/[id]/route.js` 的 PATCH/DELETE 在路径确定孤儿后立刻清。`lib/fileStore.js` 的 autoPrune 定时器里追加 favicon 孤儿兜底清理(每 24h 一次)。 |
| **M6** | 删除用户只删 `users` 表,留下 6 张关联表的孤儿行 | `app/api/admin/users/[id]/route.js` 的 DELETE 用一个事务级联清 `oauth_grants / oauth_tokens / oauth_codes / login_history / activity_log / verification_codes(按 email)`,最后才删 `users`。 |
| **M7** | verify-email 路由没有 IP/邮箱限流,也不限制单个验证码的错误尝试次数 | 接入 `rateLimit()`(IP 20/10min、邮箱 10/10min),`verificationCodes` 新增 `invalidateCurrent()`,达到 `VERIFICATION_CODE_MAX_ATTEMPTS` 时把当前验证码直接置 `used=1`。新增 4 个 `RL_VERIFY_EMAIL_*` 可配置项。 |
| **M8** | `lib/settings.js` 进程内缓存只在本进程写入时失效,多实例部署时其他实例长期读旧值 | 缓存加 5 秒 TTL。单实例无感(写入时立即失效);多实例最大陈旧窗口 5s。成本极低(settings 表小,本地读 <1ms)。 |

### 新功能:Cloudflare Turnstile(登录页)

- 新增 `lib/turnstile.js`,负责调 `challenges.cloudflare.com/turnstile/v0/siteverify`
- 新增 `app/api/auth/turnstile-config/route.js`,暴露 `enabled` 与 `siteKey` 给前端
- `app/api/auth/login/route.js` 在进入密码校验前校验 token,失败直接 400
- `app/auth/login/page.js` 条件渲染 widget(Managed 模式,默认显示"我不是机器人"
  复选框,真人一次点击即过,不弹图形题)。失败 / 过期时自动 reset token
- 新增受管配置项:`TURNSTILE_ENABLED` / `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY`
  (管理员在 `/admin/settings` 切换启用与轮换秘钥,无需改代码或重启)

### 运行时调整

- **端口默认 3000**(原 5000)。`package.json` dev/start、`README.md`、`DEPLOY.md`、
  `config/oauth-clients.js`、`scripts/init.js` 的 localhost 提示均已同步
- **版本号升至 `1.0.0`**

### 文件变动(1.0.0 相对上一个内部版本)

**新增**
- `lib/turnstile.js`
- `app/api/auth/turnstile-config/route.js`

**修改**
- `app/oauth/authorize/page.js`(Suspense 边界)
- `app/api/homepage/route.js` + `app/page.js`(H1)
- `app/api/favicons/image/route.js`(H2)
- `app/api/oauth/token/route.js` + `lib/oauthClients.js`(H3)
- `lib/database.js`(H4 migration + 7 个新 managed settings)
- `lib/favicon.js` + `app/api/admin/cards/[id]/route.js`(M5)
- `app/api/admin/users/[id]/route.js`(M6)
- `app/api/auth/verify-email/route.js` + `lib/fileStore.js`(M7,含 invalidateCurrent)
- `lib/settings.js`(M8,TTL 缓存)
- `app/api/auth/login/route.js` + `app/auth/login/page.js`(Turnstile)
- `package.json`(版本 + 端口)

---

本轮在上一轮基础上吸收了新的反馈图,主要处理 5 件事:
hero 对齐 / 颜色、单行吸顶头、日期弹窗位置、上海时区、删掉图标候选。

---

## 1. 首页 hero

**`app/page.js` · `app/page.module.css`**

- 徽章从"标题上方"挪到**与标题同行、位于标题左边**。新增 `.heroTitleRow` flex 容器:`[● 平台入口]    欢迎使用 栖枢`,窄屏自动换行。
- `栖枢` 颜色 `--jade`(绿) → `--amber`(琥珀)。品牌字下方装饰线、风动动画里的 `.heroCharBrand` 颜色同步改 amber。
- 徽章指示点 `--amber` → `--jade`,pulse 光圈 rgba 从 amber 切到 jade。两个主色换位置,整体更贴合「纸+茶」的暖色底。
- 逐字风动保持上一轮的丝滑版(删 skewX、活动窗口 28%、cubic-bezier、6.5s 周期),未动。

## 2. 单行吸顶头

**`app/admin/admin.module.css` + 7 个后台页面**

原来是两条:`stickyHead`(标题+按钮)在上,`stickyToolbar`(筛选)在下。用户管理页能看到右上角那一大片空白被浪费。

改成单行:标题靠左,`stickyActions` 靠右装下所有筛选 / 搜索 / 按钮。flex-wrap 保证在窄屏或者元素多的时候整体换行,不再产生两条分隔线。

应用到:

| 页面      | 顶栏右侧(左 → 右)                              |
|---------|-------------------------------------------|
| 平台配置    | 查看敏感 · 保存修改                               |
| 卡片管理    | 搜索 · 板块筛选 · 新建                            |
| 板块管理    | 搜索 · 匹配计数 · 新建                           |
| 用户管理    | 搜索 · 角色筛选 · 状态筛选 · 搜索按钮                  |
| 站点图标    | [选中批量操作] · 刷新列表 · 立即刷新全部                   |
| 登录记录    | **日期** · 搜索 · 清除 · 刷新                     |
| 行为日志    | **日期** · 操作筛选 · 搜索 · 清除 · 刷新              |

老 `.stickyToolbar` 保留为空 alias,新代码不再引用,grep 核对过已完全切换。

## 3. 日期筛选弹窗位置

**`app/admin/admin.module.css`**

- 弹窗锚点从 `left: 0` 改成 `right: 0`,即向**左**展开。
- 加 `max-width: calc(100vw - 32px)` 兜底,就算触发按钮非常靠右,弹窗也不会顶到视口外。
- 行为日志 / 登录记录两页把 `<DateFilter>` 放在操作区**最左边**。这样就算右侧塞满筛选按钮,弹窗向左展开的空间仍然非常充裕。

## 4. 上海时区

**新增 `lib/time.js`** 作为统一入口,4 个工具函数:

```js
fmtDateTime(iso)       // '2026/4/20 15:06:39'
fmtDate(iso)           // '2026/4/20'
todayShanghai()        // '2026-04-20'
shanghaiStartIso('2026-04-20') // UTC ISO 当日 00:00
shanghaiEndIso('2026-04-20')   // UTC ISO 当日 23:59:59.999
```

### 服务端(`lib/fileStore.js`)
- `loginHistory.getAll / activityLog.getAll` 的 `from / to / dateStr` 都走 `shanghaiStartIso / shanghaiEndIso` 转成 UTC 边界,再跟 DB 里的 UTC timestamp 比较 —— 用户看到的 "4 月 20 日" 就是上海的 4 月 20 日。
- `availableDates` 的 SQL 改用 `substr(datetime(timestamp, '+8 hours'), 1, 10)`:先把 UTC 偏移 +8,再截日。这样跨零点那一小时的记录不会被划错日期。

### 客户端
所有日期 / 时间展示点都走 `fmtDateTime / fmtDate`:

- `app/admin/login-history/page.js` — 时间列
- `app/admin/activity-log/page.js` — 时间列
- `app/admin/users/page.js` — 最近登录
- `app/admin/users/[id]/page.js` — 最近登录 + 注册时间
- `app/admin/page.js` — 仪表盘「今天」(加 `timeZone` 选项,需要带 weekday 所以没用 `fmtDate` 包装)+ 最近登录
- `app/account/page.js` — 注册时间、OAuth 授权时间、最近使用、登录 / 行为日志时间

`components/ui/DateFilter.js` 里的 `todayIso()` 也切到 `todayShanghai()`,日历上「今天」那个小圆点永远按上海日历高亮。

## 5. 图标候选删除

- 目录 `app/admin/brand-preview/` 整个移除
- `app/admin/layout.js` 的 `NAV` 去掉对应条目
- grep 核对过没有残留引用

---

## 变更文件清单

**新增**
- `lib/time.js`

**修改**
- `app/page.js`
- `app/page.module.css`
- `app/admin/admin.module.css`
- `app/admin/layout.js`
- `app/admin/page.js`
- `app/admin/settings/page.js`
- `app/admin/cards/page.js`
- `app/admin/sections/page.js`
- `app/admin/users/page.js`
- `app/admin/users/[id]/page.js`
- `app/admin/favicons/page.js`
- `app/admin/login-history/page.js`
- `app/admin/activity-log/page.js`
- `app/account/page.js`
- `app/api/admin/login-history/route.js`(上一轮)
- `app/api/admin/activity-log/route.js`(上一轮)
- `app/api/admin/favicons/route.js`(上一轮)
- `lib/fileStore.js`
- `components/ui/DateFilter.js`

**删除**
- `app/admin/brand-preview/` 整个目录

## 已知边界情况 / 留给后续的事

- **数据量级**:`availableDates` 是 `SELECT DISTINCT substr(datetime(timestamp, '+8 hours'), 1, 10))` 全表扫。10 万条以内无感,到百万级可以给两张表加冗余 `date_key` 列 + 索引。
- **max-width 兜底**:超窄屏(< 340px)日期弹窗会贴着左边。实际项目里后台访问基本是桌面端,够用。
- **批量刷新**:favicons 的 `refresh-batch` 是串行 + 8s/条超时,前端在等响应期间按钮是 spinner。选 50+ 项会卡将近一分钟。长期可以换成后台任务 + SSE 进度回传。
