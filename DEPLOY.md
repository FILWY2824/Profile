# 栖枢 —— 部署与上线指南

面向"一台云服务器 + 域名 + Node.js"的单机部署。适用场景:资源有限的 VPS(1C2G / 2C4G 都够用)。

如果你用的是 Docker / Kubernetes / Serverless,这份文档不直接适用,但所有环境变量和运行时命令是一样的,可以作为参考。

---

## 0. 服务器前置条件

| 项目 | 版本要求 | 备注 |
|---|---|---|
| Node.js | ≥ 18.17(推荐 20 LTS) | better-sqlite3 编译需要 |
| 系统 | Linux (Ubuntu/Debian/CentOS 都行) | Windows 也能跑但本文不覆盖 |
| 内存 | ≥ 512MB 可用 | Next.js build 峰值约 400MB,运行时 80-150MB |
| 磁盘 | ≥ 1GB | Next.js + SQLite + favicon 缓存 |
| 防火墙 | 放行 3000(或你反代的端口) | 如果直接暴露,否则只需放 80/443 |

装 Node.js(Debian/Ubuntu):
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs build-essential python3
```

装 pm2(进程守护):
```bash
sudo npm i -g pm2
```

---

## 1. 拉代码 + 安装依赖

```bash
cd /opt
sudo git clone <你的仓库地址> qishu         # 或直接上传压缩包解压
sudo chown -R $USER:$USER qishu
cd qishu

# 生产安装:用 --ignore-scripts 跳过 postinstall 里的 init.js,
# 等下面 §2 的 .env 填好后再手动 npm run init。这样一旦 init 过程需要读
# 新填的 JWT_SECRET 等值,一定拿得到。
npm install --ignore-scripts
```

后面填好 `.env` 再手动跑:

```bash
npm run init
```

这一步会创建 `data/app.db`,seed `.env` 里的受管配置到 settings 表,并且
**当 `ADMIN_EMAIL` + `ADMIN_PASSWORD` 都非空时**创建初始管理员。示例板块 / 卡片
**不会**自动创建 —— 生产环境请通过 `/admin/sections` 和 `/admin/cards` 手动添加,
或在本地开发时跑 `npm run dev-seed` 灌入标注为占位符的样例。

**`.env` 里的默认凭据(若使用)等会儿必须改:** 登录后立即到 `/admin/users`
改密码,或者再创建一个新管理员把默认的删掉。

---

## 2. 关键配置

### 2.1 生成强 JWT 密钥

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

拷贝输出(≥ 64 字符)。

### 2.2 写 `.env`

在项目根目录创建 `.env`(参考 `.env.example`):

```dotenv
# 生产模式 —— 必填
NODE_ENV=production

# 应用
SITE_NAME=栖枢
SITE_URL=https://你的域名.com

# JWT 密钥 —— 把上一步生成的值贴进来,必须 ≥ 32 字符
JWT_SECRET=你刚生成的那串

# 默认管理员(两者都填了才会创建,只在 init.js 首次运行时生效;之后从 /admin/users 改)
ADMIN_EMAIL=admin@你的域名.com
ADMIN_PASSWORD=一个你记得住的强密码

# 邮件服务 —— 生产环境必填(不配的话注册/忘密接口会 500)
# 现只支持 Resend。想用传统 SMTP 的话,lib/email.js 没实现后备路径,可以
# 后续自己补或者先用 Resend。
RESEND_API_KEY=re_xxxxxxxx
RESEND_FROM=noreply@你的域名.com

# OAuth 静态客户端秘钥(每个 client 对应一个)
QISHU_DEFAULT_CLIENT_SECRET=一段至少 16 位的随机串
```

**注意**:`.env` 里所有的这些值只在 **首次启动时**会被 `init.js` 迁入 `settings` 表。之后你**改** `.env` **不会**自动同步到数据库 —— 以 **`/admin/settings` 页面为准**。首次启动过一次之后,`.env` 可以删;或者保留但需要记住它不是权威来源。

### 2.3 重要:首次改配置的流程

假设 `.env` 里 `JWT_SECRET` 你随便填了个临时值,想正式上线前换个强的:

- 错误做法:改 `.env` 文件,重启服务 → **不生效**,`.env` 只在首次启动 seed
- 正确做法:登录 → `/admin/settings` → 改 `JWT_SECRET` → 保存

---

## 3. 清理示例数据,换成真实卡片

如果 `init.js` 已经灌了默认的 6 张卡片,而你想用不同的卡片:

```bash
# 预览:显示当前 sections 和 cards
node scripts/reseed-cards.js

# 执行:删除所有旧卡片/板块,灌入 scripts/reseed-cards.js 里的默认新集
node scripts/reseed-cards.js --force
```

**如果需要更定制化的卡片集**,直接用管理员账号登录 `/admin/sections` 和 `/admin/cards` 增删改,完全可视化。这个重置脚本只是用来一次性换掉示例数据的。

---

## 4. 构建 & 启动

### 4.1 构建

```bash
npm run build
```

峰值内存约 400MB,时间 30 秒 - 2 分钟。小机器上可以用 `NODE_OPTIONS="--max-old-space-size=512"` 限一下。

### 4.2 启动方式 A:直接跑

```bash
NODE_ENV=production npm start
```

默认监听 3000 端口。`Ctrl+C` 停止,关机后不会自启。**只适合临时测试**。

### 4.3 启动方式 B:pm2(推荐)

```bash
pm2 start npm --name qishu -- start
pm2 save
pm2 startup        # 按提示复制输出命令运行一次,设开机自启
```

管理:
```bash
pm2 status         # 看状态
pm2 logs qishu     # 看日志(实时)
pm2 logs qishu --lines 200   # 看最近 200 行
pm2 restart qishu  # 重启
pm2 stop qishu     # 停止
```

**pm2 会自动重启崩溃的进程**。配合 `ecosystem.config.js` 可以更精细,但单实例小站不需要。

### 4.4 启动方式 C:systemd

如果你嫌装 pm2 多余,可以纯 systemd:

```bash
sudo tee /etc/systemd/system/qishu.service > /dev/null <<'EOF'
[Unit]
Description=Qishu Profile
After=network.target

[Service]
Type=simple
User=你的用户名
WorkingDirectory=/opt/qishu
Environment=NODE_ENV=production
Environment=PATH=/usr/bin:/usr/local/bin
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=5

# 内存上限 —— 超过就 OOM 重启,避免拖垮整个 VPS
MemoryMax=400M

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now qishu
sudo systemctl status qishu
```

---

## 5. 反向代理 + HTTPS

**强烈建议**前面放一层 nginx/Caddy,理由:
- Cookie 的 `secure` 标志要求 HTTPS,否则登录 cookie 不带 `Secure` 就不够安全
- Next.js 内置 HTTPS 配置麻烦,反代层处理更干净

### Caddy(最简单)

```caddyfile
你的域名.com {
  reverse_proxy localhost:3000
  encode gzip
}
```

`sudo caddy reload` 就行,证书自动申请续期。

### nginx

```nginx
server {
    listen 80;
    server_name 你的域名.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name 你的域名.com;

    ssl_certificate     /etc/letsencrypt/live/你的域名.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/你的域名.com/privkey.pem;

    client_max_body_size 10m;  # 预留给将来可能的头像上传

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

注意两个转发头 `X-Real-IP` 和 `X-Forwarded-For` —— `lib/rateLimit.js` 的 `getClientIp()` 会读这俩,没有的话所有请求会归到 "unknown" 共享同一个速率桶。

---

## 6. 上线检查清单

照着过一遍再把端口开出去:

- [ ] `.env` 里 `NODE_ENV=production`
- [ ] `.env` 里 `JWT_SECRET` 是随机 ≥ 32 字符,不是示例值
- [ ] `.env` 里 `RESEND_API_KEY` 已填,并且在 `/admin/settings` 里能看到(掩码形式)
- [ ] `.env` 里 `QISHU_DEFAULT_CLIENT_SECRET`(及其他 `*_CLIENT_SECRET`)≥ 16 字符
- [ ] `config/oauth-clients.js` 里的 `redirectUris` 已经从 `http://localhost:*` 换成
      你的真实域名的 `https://` 回调 —— 启动时 sanityCheckStaticClients 会扫,漏了
      直接阻止启动,但最好自己先看一遍
- [ ] 登录默认管理员 → 改密码,或者 `/admin/users` 直接删掉再创一个新管理员
- [ ] 注册一个测试账号,真的收到验证码邮件再算过
- [ ] 前面挂了 HTTPS 反代
- [ ] `/admin/database` 能打开所有表且不报错
- [ ] `/admin/favicons` → 点一下"立即刷新全部",确认外网抓取能成功
- [ ] 浏览器看首页,所有卡片图标正常显示
- [ ] pm2 / systemd 配了开机自启
- [ ] 服务器防火墙只放行 80/443(和 SSH);3000 不对外
- [ ] (OAuth 接入方)客户端已经更新到"使用 PKCE (S256) + refresh_token 以
      轮换方式使用"的接法 —— 这一版强制了 public client 必须带 S256 PKCE,
      且 refresh_token 每次用完立刻轮换,旧的不可再用

---

## 7. 日常运维

### 看日志

```bash
pm2 logs qishu --lines 500
# or
sudo journalctl -u qishu -n 500 -f
```

### 备份数据库

SQLite 文件就一个,备份就是复制。在线状态下也可以安全拷贝(有 WAL):

```bash
sqlite3 /opt/qishu/data/app.db ".backup /backup/qishu-$(date +%F).db"
```

推荐做每日 cron,保留最近 7 天。

### 清理历史数据

进 `/admin/retention`:
- **登录记录**:建议保留 30-90 天
- **行为日志**:建议保留 30-90 天
- **验证码 / OAuth 令牌**:自动清理(新增,每 24 小时),也可手动立即执行

### 升级

```bash
cd /opt/qishu
git pull
npm install
npm run build
pm2 restart qishu
```

`scripts/init.js` 是幂等的,重跑不会覆盖现有数据。

---

## 8. 常见问题

**Q: `npm install` 报 `better-sqlite3` 编译失败**
A: 缺 `build-essential` 和 `python3`。装上再试。

**Q: 启动后 500 错误,日志里 `[FATAL] JWT_SECRET 未配置`**
A: `NODE_ENV=production` 下 JWT_SECRET 是必填。写进 `.env` 然后重启。

**Q: `[WARN] JWT_SECRET 未配置,已回退到开发默认值 —— 切勿用于生产!` 一直刷屏**
A: `NODE_ENV` 没设成 `production`。pm2 用户用 `pm2 start ... --env production` 或者在 `.env` 里写清楚。

**Q: 注册用户时收不到验证码邮件**
A: 检查 `/admin/settings` 里 `RESEND_API_KEY` 与 `RESEND_FROM`。Resend 免费账户要
先在它们控制台验证域名。`NODE_ENV=production` 且 `RESEND_API_KEY` 为空时,接口
会直接 500(避免静默假成功),pm2 日志里会有明显错误。开发环境下不配邮件时,
验证码会被打到 stdout,pm2 logs 能直接看到。

**Q: 访问 `http://服务器IP:3000/` 能通,但通过域名访问 cookie 不持久**
A: HTTPS 没配好。`lib/auth.js` 在 production 下会给 cookie 加 `Secure` 标志,纯 HTTP 下浏览器会丢弃。

**Q: 管理员忘记密码**
A: 服务器上直接跑:
```bash
cd /opt/qishu
node -e "
import('bcryptjs').then(async bc => {
  const { database } = await import('./lib/database.js');
  const hash = bc.default.hashSync('新密码123', 12);
  database.prepare('UPDATE users SET passwordHash=? WHERE email=?').run(hash, 'admin@qishu.local');
  console.log('改好了');
});
"
```

---

## 9. 目录结构速查

```
qishu/
├── app/                  Next.js App Router(页面 + API)
├── components/           共享组件
├── lib/                  业务逻辑 / DB / 鉴权 / 设置
├── public/               静态文件(favicon 等)
├── scripts/
│   ├── init.js           首次部署自动跑(postinstall)
│   └── reseed-cards.js   手动清卡片重灌
├── data/
│   └── app.db            SQLite 数据库(备份这个就够了)
├── .env                  环境变量(只影响首次启动的 seed)
├── package.json
├── AUDIT.md              代码审查报告(本次新增)
├── DEPLOY.md             本文件
└── CHANGES.md            历史改动记录
```

有问题先看 pm2 日志,再看 `/admin/settings` 是不是配错了,最后再来翻代码。祝上线顺利。
