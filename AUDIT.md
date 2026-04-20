# 栖枢 —— 上线前代码审查报告

审查日期:2026-04-20
审查范围:所有 `app/` · `lib/` · `components/` · `scripts/` 下的源码
方法:静态审查 + 重点代码 grep + 数据流推演

---

## 摘要

**发现 2 处真实问题,均已修复。**
**发现 3 处需关注但当前不构成风险的点,文末给出部署建议。**
**其余检查项(鉴权、SQL 注入、资源泄漏、XSS、输入校验)无新发现。**

---

## 本次审查中**已修复**的问题

### 🔴 H1. `/api/favicons/image` 可被用作外发请求代理(DoS / SSRF 雏形)

**位置**: `app/api/favicons/image/route.js`

**原描述**:该端点匿名可访问,接收任意 `origin` 参数。对未缓存的 origin 会同步走三道抓取策略(直取 `/favicon.ico` → 解析首页 `<link rel=icon>` → Google s2 fallback),每道最长 8s 超时,**单次请求最糟可挂住接近 24 秒**。

**攻击成本**:一行 curl 循环,用随机子域名塞 `?origin=`。
**攻击收益**:后端被动触发出站请求,worker 占满,CPU/内存飙升。

**修复**:在触发外网 fetch 前,先 `db.findAll('cards')` 检查该 origin 是否被某张卡片引用。未引用直接返回 404。已缓存的 origin 不受影响(正常服务)。

扫描 cards 表的成本极低(<100 行,prepared statement),不做缓存。

### 🟡 M1. 过期 / 已消费的验证码、OAuth 令牌、授权码永远不自动清理

**位置**: `lib/fileStore.js` · `app/api/admin/retention/route.js`

**原描述**:`verificationCodes.pruneExpired()`、`oauthStore.pruneExpired()` 方法存在,但**唯一调用者**是 admin 点"数据清理"页的"立即执行"按钮。正常流量下这三张表会持续增长:

| 表 | 增长速度估算 |
|---|---|
| `verification_codes` | 每个注册/改密/改邮箱动作 +1 条。活跃站点日增几十到几百。 |
| `oauth_tokens` | 每次 OAuth 登录 +1,过期后仍留存。 |
| `oauth_codes` | 每次授权码兑换 +1,被消费后仍留存。 |

**风险**:这些是小表,即便留几万行也不至于崩,但长期会影响 `SELECT` 性能,也让 DB 文件慢慢胀大。云服务器磁盘是按月租的,让它无故膨胀不划算。

**修复**:在 `lib/fileStore.js` 底部加了进程内定时器 —— 启动后 60 秒跑一次,之后每 24 小时跑一次自动 prune。

保护措施:
- `globalThis + Symbol` 单例,Next.js dev 热重载时**不会**重复注册
- `handle.unref()` 保证不阻塞进程退出
- try/catch 包住,出错不影响主流程
- 只在确实清理到记录时才打日志,避免刷屏

---

## 关注但无需立即动作的点

### ⚪ L1. 内存态速率限制 (`lib/rateLimit.js`)

当前基于一个 `Map<key, timestamp[]>`。进程内单机有效,多实例/多进程(pm2 cluster / k8s 多副本)下**每个进程各算各的**,同一个 IP 可以突破预期阈值 × 实例数倍的限额。

对于"单机 pm2 single"的小型部署,这是够用的。**如果将来横向扩展到多实例,必须把 rateLimit 迁到 Redis。**

清理策略已到位:每 10 分钟 `sweepRateLimit` 一次,清掉 1 小时未活动的 bucket。

### ⚪ L2. `db.findAll('users')` 全表扫(dashboard)

`app/api/admin/dashboard/route.js:10` 用 `db.findAll('users')` 拿全量用户再在 JS 里统计。数据量小时没事(<1 万用户 JSON 化后也就几 MB),真的涨到 10 万级会慢。

**缓解建议**:当用户数上来后,把 dashboard 的统计改成 SQL 聚合查询(`COUNT(*) WHERE role = ?` 一类)。不紧急。

### ⚪ L3. JWT secret 回退到开发默认值

`lib/auth.js:39` 在非 production 环境下 `JWT_SECRET` 为空会打印警告并回退到固定字符串。这本身是对的 —— dev 跑不起来比用弱密钥危险。但**上线时必须确保 `NODE_ENV=production` 被正确设置**,否则这个警告会在生产日志里刷屏且密钥弱。

部署文档里会重点强调。

---

## 无发现的检查项

以下方面经过审查,未发现问题:

### 鉴权与会话

- `getSession()` 对 token 验证、用户 active 状态、passwordChangedAt 失效三道都做了
- `requireAdmin()` 同时检查 401/403
- Cookie 配置 `httpOnly + secure(prod) + sameSite=lax`,OAuth flow 用单独的一套 `state` 防 CSRF
- `resolveJwtSecret` 在生产下若 secret 缺失或 < 32 字符会**抛异常阻塞请求**,不静默降级

### SQL 注入

所有数据库访问都走 `database.prepare(...).all(args)` / `.run(args)`,参数化查询。唯一拼接表名的地方是 `app/api/admin/database/[table]/route.js`,但 table 名先过 `ALLOWED_TABLES` 白名单,拼接安全。

### 内存泄漏

| 来源 | 清理机制 | 状态 |
|---|---|---|
| `buckets` Map (rateLimit) | `setInterval` 每 10 分钟 sweep,`unref()` | ✓ |
| `inflight` Map (favicon) | `try { await } finally { delete }` | ✓ |
| `cache` Map (settings) | 写入时 `cacheValid=false`,size 固定(~20 键) | ✓ |
| Toast 定时器 | 每个 toast 有独立 timer,`timersRef` 跟踪,unmount 全清 | ✓ |
| `verification_codes` 行 | 自动 prune(本次新增) | ✓ |
| `oauth_codes/tokens` 行 | 自动 prune(本次新增) | ✓ |
| `login_history` 行 | 按 `LOGIN_HISTORY_RETENTION_DAYS` 保留,可 admin 手动裁剪 | ⚠️ 手动 |
| `activity_log` 行 | 同上 | ⚠️ 手动 |
| `favicon_cache` 行 | 不过期(卡片删除后需 admin 手动清) | ⚠️ 手动 |

**login_history / activity_log / favicon_cache 建议手动清理的理由**:这三类都有审计价值,admin 应该主动决定保留多久。平台配置里有 `LOGIN_HISTORY_RETENTION_DAYS` / `ACTIVITY_LOG_RETENTION_DAYS` 两个设置,配合 `/admin/retention` 页可以随时执行。不加自动化是为了防止管理员忘了调保留天数结果日志自动被清光。

### 事件监听器

所有 `addEventListener` 都在 `useEffect` 内成对 `removeEventListener`。审查点:
- `components/ui/DateFilter.js:108-109` ✓
- `components/ui/index.js:28`(Modal) ✓

### 数据库连接

- better-sqlite3 单 connection 挂到 `globalThis[GLOBAL_KEY]`,开启 WAL 模式 + `busy_timeout=5000` + `foreign_keys=ON`
- Next.js 热重载不会重新开 connection(受 globalThis 保护)
- 无需显式 close —— 进程退出时 OS 回收

### XSS

所有动态内容经 React 渲染,无 `dangerouslySetInnerHTML`。grep 过了。

### 输入校验

卡片/板块 POST 路由都有基本校验(必填字段 + slug 格式正则)。注册流程有邮箱格式 + 密码复杂度检查(`lib/password.js`)。

---

## 建议

### 上线前必做

1. **设置强 `JWT_SECRET`**(≥ 32 字符随机),在 `.env` 或部署后立刻去 `/admin/settings` 修改 —— 生产模式下这是硬性要求,不然 `lib/auth.js` 会抛 500
2. **修改默认管理员密码** —— `init.js` 创建的 `Admin@123456` 只用于首次登录,立刻改
3. **配置邮件发送**(`RESEND_API_KEY` 或 `SMTP_*`) —— 不然验证码发不出去,新用户注册会卡死
4. **设定 NODE_ENV=production**(由 `pm2`/`systemd` 保证) —— 不然走 dev fallback
5. **配置反向代理 + HTTPS**(nginx/Caddy 都行) —— Cookie 的 `secure` 标志要求 HTTPS
6. **跑一遍 `npm run reseed -- --force`** 清掉示例卡片,换成真实数据

### 上线后建议

1. 首周观察 `/admin/retention` 里的各表行数,确认 auto-prune 生效
2. 在 `/admin/settings` 根据实际流量调整 `LOGIN_HISTORY_RETENTION_DAYS` / `ACTIVITY_LOG_RETENTION_DAYS`,建议 30~90 天
3. 定期(每月)去 `/admin/favicons` 看一眼,清理已删卡片留下的图标缓存

### 以后如果流量上来

1. 把 `rateLimit.js` 迁 Redis(上面 L1)
2. 把 dashboard 的用户统计改成 SQL 聚合(上面 L2)
3. 考虑把 `favicon_cache.dataUrl` 从 SQLite text 移到磁盘文件(目前每张 icon 2-8KB 存在 DB 里,上百张起 DB 会变大;读取时仍然可以走 API)

---

## 变更文件(仅本轮审查)

- `app/api/favicons/image/route.js` —— DoS 修复
- `lib/fileStore.js` —— 自动 prune 调度
- `scripts/init.js` —— 真实卡片 seed 替换示例数据
- `scripts/reseed-cards.js`(新)—— 带 --force 的重置工具
- `package.json` —— 加 `npm run reseed`
