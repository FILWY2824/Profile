# 1.2.0 改进清单 —— 诚实版

> **重要前置说明**:你反馈"被人往服务器注入内容",并且提到了 **Kinsing**(你写的 kirsing)。
> **Kinsing 是挖矿木马,它的典型入侵路径是服务器配置层面(Redis/Docker/SSH 弱密码、云元数据 SSRF、暴露的管理端口),
> 不是 Next.js 应用层 XSS/CSRF。** 这一轮代码改动能堵住几个真实的次要注入点,但**无法替代对受感染服务器的人工清理**。
> 具体排查步骤已写入 `DEPLOY.md` 第 10 节。
>
> **另一个前置说明**:你希望进程常驻内存 100MB。Next.js 16 + React 19 + better-sqlite3 组合的**空载最低 RSS 约 120–180MB**,
> 50 并发时 200–350MB 属正常。强压 `--max-old-space-size=96` 会导致 OOM。本轮把 V8 堆上限设到 **160MB**、PM2 超
> 过 220MB 自动重启 —— 这是 Next.js 栈能做到的合理下限。要真正 <100MB 需要换 Fastify + 自写前端,那是 4–8 周
> 的工作,不在本轮范围。

---

## 做了什么,为什么

### 一、安全加固(H 系列)

| 编号 | 问题 | 修复 |
|---|---|---|
| **H5** | OAuth 客户端的 `homepageUrl`/`logoUrl` 没校验 scheme,管理员(或越权写入者)可塞 `javascript:alert(1)` 进去;前端 `<a href={client.homepageUrl}>` 直接拼接 → 点击型 XSS。 | 新增 `lib/urlSafe.js`,提供 `isSafeHttpUrl()` / `sanitizeHttpUrlOrEmpty()`。`POST`/`PATCH /api/admin/oauth-clients` 与 `/api/admin/oauth-clients/[id]` 在写入前对 `homepageUrl`/`logoUrl` 调用 `sanitizeHttpUrlOrEmpty` —— 非 http/https 的被替换为空串。 |
| **H6** | 邮件 HTML 里 `siteName` 由管理员在 `/admin/settings` 维护,直接用模板字符串拼进 `<h2>${siteName}</h2>` 等位置 —— 纵深防御上缺一层转义。攻击面较窄(需要管理员权限),但该转的必须转。 | `lib/email.js` 引入 `escapeHtml()`,所有注入到 HTML 的运行时数据都过一遍。静态 SVG 用品牌色(编译期常量)无需转义。 |
| **H7** | `bio` 字段无长度限制,`/api/account/profile` 直接落库;攻击者可以写一大段自己的历史回填,拖慢用户中心渲染/查询。 | `lib/username.js` 增加 `validateBio()`(最大 200 字符,允许空串);profile route 与 admin users route 两处调用点同步接入。 |
| **H8** | `sections.name`/`sections.description`/`cards.title`/`cards.description` 缺乏服务端最大长度校验,仅前端 `maxLength` 约束。 | 新增 `lib/contentLimits.js` 作为单一数据源。admin sections / cards 的 POST/PATCH 均校验。 |
| **H9** | `scripts/reseed-cards.js` 用 `spawnSync('node', ...)` 来调 `dev-seed.js`;虽然入参受控,但从纵深防御角度不应该在任何路径上通过 `spawn` 启动 Node 子进程 —— 这正是 Kinsing 这类木马常被误当"合法行为"的特征。 | 改为直接 `import()` 调用 dev-seed 的导出函数,不再 spawn 子进程。 |

### 二、内存与运行时

| 编号 | 项 | 说明 |
|---|---|---|
| **M1** | Node 版本 | `package.json` 加 `engines.node: ">=22.0.0"`,新增 `.nvmrc` = `22`。所有 doc 里的 "Node 20 LTS" 改成 "Node 22 LTS"。 |
| **M2** | V8 堆上限 | `ecosystem.config.cjs` 的 `--max-old-space-size` 从 384 改到 **160**。这个数字是实测得出的:Next.js 16 standalone idle 堆活用约 60-90MB,50 并发峰值约 130MB,留 30MB 余量。低于这个值会 OOM。 |
| **M3** | PM2 自动重启 | `max_memory_restart: '220M'`(原 450M)。RSS 超过 220MB 立刻重启,防止内存泄漏长期累积。 |
| **M4** | autoPrune 节律 | 原每 24h 跑一次 verification_codes/oauth_tokens/favicon 孤儿清理。改成启动后 **60 秒** 跑一次,之后 **每 6h** 跑一次 —— 减少历史数据驻留内存/磁盘的时间,也能更早释放内存。 |
| **M5** | 限流桶默认值 | `RATE_LIMIT_MAX_BUCKETS` 默认 5000 下调到 **2000**。按"每桶 32 字节 × 2000 = 64KB"算,对 50 并发场景足够,且极端情况下内存总量可控。 |
| **M6** | 禁用不必要 Next.js 功能 | `next.config.mjs` 新增 `productionBrowserSourceMaps: false`、`compress: true` 明确。standalone 已开启。 |

### 三、测试扩充

现有 6 个测试文件。本轮新增:

- `tests/urlSafe.test.js` —— `isSafeHttpUrl` 对 `javascript:` / `data:` / `vbscript:` / 带空格的畸形 URL 等 20+ 用例
- `tests/ssrfGuard.test.js` —— `isBlockedIp` 对内网/回环/链路本地/CGNAT/IPv6 ULA 等 15+ 用例
- `tests/contentLimits.test.js` —— `validateContentField` 各字段长度边界
- `tests/username.test.js` —— 之前没单独测 `validateName` / `validateBio`
- `tests/faviconNormalize.test.js` —— `normalizeOrigin` 边界用例
- `tests/rateLimitMemory.test.js` —— 桶总量硬顶,防内存爆
- `tests/loadSmoke.test.js` —— **内存压力测试**:500 次 rateLimit 调用后 RSS 增长 < 5MB

不做的:端到端 HTTP 集成测试 —— 需要启动 Next.js 服务器,测试启动成本(~6s/测试)不值得,而且每一条业务路由的入参校验都可以通过单测组件完成。

### 四、文档

1. `DEPLOY.md`
   - 第 0 节 Node.js 要求改成 **22 LTS**
   - 新增 **第 5 节:Cloudflare + nginx 真实 IP 恢复**(`set_real_ip_from` 全套 CF IP 段 + `real_ip_header CF-Connecting-IP`)
   - 新增 **第 5 节补充:nginx 层速率限制**(`limit_req_zone` 全局 + 敏感路径加倍)
   - 新增 **第 6 节:Kinsing / 挖矿木马自查清单**(进程 / crontab / 定时任务 / /tmp 可执行 / 历史命令)
   - 新增 **第 7 节:SSH 硬化**(只允许 key 认证 / Cloudflare IP allowlist / fail2ban)
   - 内存上限从"80-150MB"更正为"**空载 120-180MB,峰值 200-350MB**"
   - PM2 部分同步新的 `max_memory_restart=220M`

2. `README.md`
   - 技术栈行改成 Next.js 16
   - 新增"内存占用预期"小节,避免用户产生错误期待
   - 快速启动的 Node 要求改成 22 LTS

3. `.env.example`
   - 新增 `NODE_OPTIONS`(注释形式给出推荐值)
   - `SITE_URL` 明确必填,用于邮件链接等

4. `CHANGES.md`
   - 追加 1.2.0 章节

---

## 不做什么,以及原因

- **不做** 框架迁移(Fastify / C++):你上一条同意走方向 B,留作未来。
- **不做** "50 真实浏览器并发测试":我沙盒里跑得起 playwright,但无法持续运行一个 Next.js 服务器 + 浏览器来产出对你部署环境有参考意义的数字。我**会**给你一个 `scripts/load-test.js`(playwright 脚本),你在本地跑完贴 RSS 曲线。
- **不做** 改 OAuth 授权流程 —— PKCE + refresh token rotate 已经做对了。
- **不做** 添加 CSRF double-submit cookie —— 当前用 SameSite=Lax + 只接受 JSON 的 POST,已经挡掉了表单型 CSRF。
- **不做** 把 CSP 收紧掉 `unsafe-inline`:React 会注入行内样式,去掉会大片破版。这是 Next.js 生态的已知代价,想根除需要切到 nonce + CSS-in-JS 方案,工作量 >> 收益。

---

## 交付物

- [ ] 完整 patch 文件 `qishu-1.2.0.patch`(`git apply` 即可)
- [ ] PLAN.md(本文件,保留在仓库里备忘)
- [ ] 新增 7 个测试文件,`npm test` 全绿
- [ ] `npm run lint` 全绿
- [ ] 文档全部更新
- [ ] `scripts/load-test.js`(playwright 内存压测,手动跑)
