# 栖枢 —— 部署与上线指南(1.2.0)

面向"一台云服务器 + 域名 + Cloudflare + Node.js 22"的单机部署。
适用场景:资源有限的 VPS(1C2G / 2C4G 都够用)。

> 1.2.0 的关键变化:Node 22 LTS、Cloudflare 真实 IP 恢复、Kinsing 自查、
> 更现实的内存预期、nginx 层速率限制。上一版的内容仍然适用的部分保留。

---

## 0. 服务器前置条件

| 项目 | 版本要求 | 备注 |
|---|---|---|
| Node.js | **≥ 22.0.0 LTS** | 1.2.0 起硬性要求;`package.json` 的 engines 会阻止 npm 在更低版本上安装 |
| 系统 | Linux (Ubuntu 22.04+/Debian 12+) | 旧系统的 glibc 可能跟 Node 22 的预编译原生模块不兼容 |
| 内存 | ≥ 1GB(推荐 2GB) | Next.js build 峰值 ~400MB;运行时 120–350MB(见第 3 节) |
| 磁盘 | ≥ 2GB | Next.js standalone + node_modules + SQLite + favicon 缓存 |
| 防火墙 | **只放行 Cloudflare IP 段进 80/443** + SSH(限源 IP) | 直接暴露 3000 等于开洞,见 §7 |

安装 Node 22 LTS(Debian/Ubuntu):

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs build-essential python3
node -v    # 应显示 v22.x
```

安装 pm2(进程守护):

```bash
sudo npm i -g pm2
```

---

## 1. 拉代码 + 安装依赖

```bash
cd /opt
sudo git clone <你的仓库地址> qishu
sudo chown -R $USER:$USER qishu
cd qishu

# 生产安装:用 --ignore-scripts 跳过 postinstall 里的 init.js,
# 等 §2 的 .env 填好后再手动 npm run init。
npm install --ignore-scripts
```

填好 `.env` 之后:

```bash
npm run init
```

这一步会创建 `data/app.db`,seed `.env` 里的受管配置到 settings 表,并且
**当 `ADMIN_EMAIL` + `ADMIN_PASSWORD` 都非空时**创建初始管理员。示例板块 / 卡片
**不会**自动创建 —— 生产环境请通过 `/admin/sections` 和 `/admin/cards` 手动添加。

---

## 2. 关键配置

参考仓库里的 `.env.example`。必填字段:

| 字段 | 说明 |
|---|---|
| `NODE_ENV=production` | 必填,否则 JWT 秘钥校验、Cookie 的 Secure 标志等会被放宽 |
| `SITE_URL` | **1.2.0 新增建议必填**。用于邮件里的绝对链接等。格式 `https://你的域名` 不带尾斜杠 |
| `JWT_SECRET` | 必填,≥ 64 字符。用 `npm run generate:jwt-secret` 生成 |
| `ADMIN_EMAIL` + `ADMIN_PASSWORD` | init.js 首次建库时用 |
| `RESEND_API_KEY` + `RESEND_FROM` | 生产必填,否则注册/忘密接口会 500 |
| `QISHU_DEFAULT_CLIENT_SECRET` | 默认 OAuth 客户端 secret,≥ 16 字符 |

所有这些值只在**首次启动**由 `init.js` 迁入 `settings` 表。之后改 `.env`
不会同步 —— 权威来源是 `/admin/settings`。

---

## 3. 内存预期(请仔细读)

**Next.js 16 + React 19 + better-sqlite3 这个技术栈的常驻内存不可能 < 100MB。**

真实数据:

| 状态 | RSS | 说明 |
|---|---|---|
| 空载(刚启动,无请求) | 120–180MB | Node 运行时基线(~50MB) + V8 堆(~60MB) + 原生模块(bcryptjs、better-sqlite3) + Next.js runtime |
| 轻载(1–5 并发) | 150–220MB | 正常水位 |
| 中载(10–20 并发) | 180–280MB | 峰值会短时冲高,GC 后回落 |
| 高载(50 并发) | 200–350MB | 1.2.0 的 `--max-old-space-size=160` 会硬顶 V8 堆;RSS 主要受原生模块影响 |
| 内存泄漏已发生 | > 220MB 持续 | pm2 会触发 `max_memory_restart` 自动重启 |

**1.2.0 做了什么:**

- `--max-old-space-size=160`:V8 堆上限 160MB,防止堆失控。低于这个值会频繁
  OOM,再高一些会让 pm2 误判。
- `max_memory_restart: 220M`:RSS 触顶就自动重启,等价于"永不泄漏"的保底。
- autoPrune 从 24h 改到 6h:高写入表(activity_log / verification_codes 等)
  的过期行更早清,SQLite 文件也更小。
- RATE_LIMIT_MAX_BUCKETS 默认 5000→2000:桶 Map 的理论上限从 ~200KB 降到 ~80KB。

**如果你坚持要 <100MB**:换框架。参考栈是 Fastify + HTMX/Alpine.js + SQLite
原生驱动。那是 4-8 周的重写,不在本项目的 roadmap。

---

## 4. 构建 & 启动

### 4.1 构建

```bash
NODE_OPTIONS="--max-old-space-size=512" npm run build
```

`--max-old-space-size=512` 只是给 build 期临时抬高,Next.js 构建峰值内存比
运行时高不少。构建完成后产物放在 `.next/standalone/`。

### 4.2 推荐启动方式:pm2 + ecosystem

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup        # 按提示执行输出的一条命令,开机自启
```

`ecosystem.config.cjs` 已经帮你设好:
- `node_args: --max-old-space-size=160`(V8 堆上限)
- `max_memory_restart: 220M`(RSS 触顶重启)
- `HOSTNAME: 127.0.0.1`(**只监听本机**,必须靠 nginx 反代暴露)
- `NODE_ENV: production`

管理:

```bash
pm2 status            # 看 RSS / CPU / 重启次数
pm2 logs qishu        # 实时日志
pm2 monit             # top 风格面板,看内存曲线
pm2 restart qishu
```

### 4.3 备选:systemd

```ini
[Unit]
Description=Qishu Profile
After=network.target

[Service]
Type=simple
User=你的用户
WorkingDirectory=/opt/qishu
Environment=NODE_ENV=production
Environment=HOSTNAME=127.0.0.1
Environment=PORT=3000
Environment=NODE_OPTIONS=--max-old-space-size=160
ExecStart=/usr/bin/node .next/standalone/server.js
Restart=on-failure
RestartSec=5

# 硬性内存限制 —— 超过就 OOM-kill,配合 Restart=on-failure 实现等价于 pm2 的行为
MemoryMax=220M
MemoryHigh=180M

[Install]
WantedBy=multi-user.target
```

---

## 5. nginx 反代 + Cloudflare 真实 IP 恢复

你用 Cloudflare + 防火墙只放 CF IP 进入 80/443。**如果 nginx 不做 `set_real_ip_from`
处理,所有来源 IP 都会变成 CF 的 IP**,会造成:

- 速率限制失效(所有真实用户被当成同一个 IP,几次请求就集体被限流)
- 登录记录 / 行为日志里全是 CF 的 IP
- 审计追查无从下手

Cloudflare 会在每个请求上加一个 `CF-Connecting-IP` 头,里面是真实客户端 IP。
我们要做的是:告诉 nginx 只信任 CF 的源 IP 发来的这个头。

### 5.1 完整 nginx 配置(拷贝即用)

```nginx
# /etc/nginx/conf.d/qishu.conf

# ── Cloudflare 真实 IP 恢复 ─────────────────────────────────────────
# 这一段**必须**放在 server 块外部(也可以单独拆一个 /etc/nginx/cloudflare.conf
# 然后 include,方便每月用脚本更新)。这些网段是 Cloudflare 公开的入口 IP,
# 每隔几个月可能会变,建议设一条 cron 定期从 https://www.cloudflare.com/ips-v4
# 和 https://www.cloudflare.com/ips-v6 拉最新列表。
set_real_ip_from 173.245.48.0/20;
set_real_ip_from 103.21.244.0/22;
set_real_ip_from 103.22.200.0/22;
set_real_ip_from 103.31.4.0/22;
set_real_ip_from 141.101.64.0/18;
set_real_ip_from 108.162.192.0/18;
set_real_ip_from 190.93.240.0/20;
set_real_ip_from 188.114.96.0/20;
set_real_ip_from 197.234.240.0/22;
set_real_ip_from 198.41.128.0/17;
set_real_ip_from 162.158.0.0/15;
set_real_ip_from 104.16.0.0/13;
set_real_ip_from 104.24.0.0/14;
set_real_ip_from 172.64.0.0/13;
set_real_ip_from 131.0.72.0/22;
# IPv6
set_real_ip_from 2400:cb00::/32;
set_real_ip_from 2606:4700::/32;
set_real_ip_from 2803:f800::/32;
set_real_ip_from 2405:b500::/32;
set_real_ip_from 2405:8100::/32;
set_real_ip_from 2a06:98c0::/29;
set_real_ip_from 2c0f:f248::/32;

# 关键:告诉 nginx 从 CF-Connecting-IP 头里取真实 IP。`X-Forwarded-For`
# 可以被伪造多跳,CF-Connecting-IP 是 Cloudflare 一定重写的,只能信它。
real_ip_header CF-Connecting-IP;
real_ip_recursive on;

# ── 全局速率限制 zone ─────────────────────────────────────────────
# 基于 $binary_remote_addr(经过上面的 set_real_ip_from 处理后已经是真实客户端 IP)。
# 容量:10MB 的 zone 大约能存 80 万个 IP 的状态。
#
# 三个 zone 分用途:
#   api_limit:    普通 API,50 req/s,burst 100
#   auth_limit:   登录/注册/验证码,强限 5 req/s,burst 10 —— 密码爆破防线
#   static_limit: 静态资源与首页,不怎么限
limit_req_zone $binary_remote_addr zone=api_limit:10m    rate=50r/s;
limit_req_zone $binary_remote_addr zone=auth_limit:10m   rate=5r/s;
limit_req_zone $binary_remote_addr zone=static_limit:10m rate=100r/s;

# ── HTTP → HTTPS 301 ────────────────────────────────────────────
server {
    listen 80;
    listen [::]:80;
    server_name 你的域名.com;
    return 301 https://$host$request_uri;
}

# ── HTTPS 主服务 ────────────────────────────────────────────────
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name 你的域名.com;

    ssl_certificate     /etc/letsencrypt/live/你的域名.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/你的域名.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # 避免非法超大 POST 打爆后端
    client_max_body_size 1m;
    client_body_timeout 15s;
    client_header_timeout 15s;

    # 不回显服务器类型,少一点指纹信息
    server_tokens off;

    # ── 认证路径 —— 强限流 ──
    location ~ ^/api/auth/(login|register|forgot-password|reset-password|verify-email|change-password) {
        limit_req zone=auth_limit burst=10 nodelay;
        limit_req_status 429;

        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_connect_timeout 5s;
        proxy_send_timeout    15s;
        proxy_read_timeout    15s;
    }

    # ── OAuth token / authorize —— 中强限流 ──
    location ~ ^/api/oauth/(token|authorize) {
        limit_req zone=auth_limit burst=20 nodelay;

        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }

    # ── 其他一切 —— 普通限流 ──
    location / {
        limit_req zone=api_limit burst=100 nodelay;

        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_connect_timeout 5s;
        proxy_send_timeout    30s;
        proxy_read_timeout    30s;
    }

    # 不响应 .env / .git 等敏感文件的任何路径(哪怕 Next.js 不提供,也拦在外层)
    location ~ /\.(env|git|ht) { deny all; return 404; }
}
```

**为什么这些速率限制**:

- 即便应用内的 `lib/rateLimit.js` 也会限,但它在 **进程内存** 里。nginx 层限
  是**第一道防线**,可以扛住应用进程起不来、或应用 bug 导致绕过等场景。
- 应用层的 `X-Real-IP` / `X-Forwarded-For` header 依赖 nginx 传,我们在上
  面的 `proxy_set_header` 里已经传了。应用侧 `lib/rateLimit.js` 的 `getClientIp`
  会优先读 `X-Real-IP`。

### 5.2 Cloudflare 侧

- 必开:**Always Use HTTPS**
- 必开:**Full (Strict)** SSL mode(自签名证书也要装到源站,LE 会自动搞定)
- 建议开:WAF 里的 "Managed Rules" + "OWASP Core Rule Set"
- 建议开:Rate Limiting Rules(Cloudflare 层面,比 nginx 层更靠前)
- 如果你开了 **Cloudflare Access / Zero Trust**,那 CF-Connecting-IP 的恢复
  就更重要 —— 否则应用只看得到 CF 边缘的 IP。

### 5.3 定期更新 Cloudflare IP 段

CF 的 IP 段偶尔会变。写个 cron(每月一次):

```bash
# /etc/cron.monthly/update-cloudflare-ips.sh
#!/bin/bash
set -e
TMP=/tmp/cf-ips-$$
{
  echo "# Auto-generated. Do not edit by hand."
  curl -fsS https://www.cloudflare.com/ips-v4 | awk '{print "set_real_ip_from " $0 ";"}'
  curl -fsS https://www.cloudflare.com/ips-v6 | awk '{print "set_real_ip_from " $0 ";"}'
} > "$TMP"
mv "$TMP" /etc/nginx/cloudflare-ips.conf
nginx -t && systemctl reload nginx
```

`chmod +x /etc/cron.monthly/update-cloudflare-ips.sh`,
然后在 nginx.conf 的 http 块里 `include /etc/nginx/cloudflare-ips.conf;` 替代硬
编码那一大段。

---

## 6. ⚠️ Kinsing / 挖矿木马自查(如果你怀疑被入侵了)

**Kinsing 不是通过 Next.js 的 XSS/CSRF 入侵的。** 它的典型入侵路径是:

1. 暴露在公网的 Redis(无密码)、Docker API(默认端口 2375)、Kubernetes API
2. SSH 弱密码 / 被盗私钥
3. 同机其他服务的 CVE(Confluence / GitLab / Apache Struts / Log4j 等)
4. 云元数据接口(169.254.169.254)被 SSRF

**仅更新代码不会让已经落户的 Kinsing 消失。** 下面是诊断步骤:

### 6.1 确认存在

```bash
# 最常见的 Kinsing 进程名
ps auxf | grep -iE 'kinsing|kdevtmpfsi|xmrig|kthreaddi|sysupdate|spreadX|donate'

# 看 CPU 占用最高的进程(挖矿几乎一定打满 CPU)
top -b -n 1 -o %CPU | head -20

# 所有监听端口 —— 看看有没有不该开的
sudo ss -tlnp
```

### 6.2 找持久化

```bash
# crontab(最常见的持久化点)
crontab -l 2>/dev/null
sudo crontab -l 2>/dev/null
for u in $(cut -f1 -d: /etc/passwd); do
  echo "=== $u ==="
  sudo crontab -l -u "$u" 2>/dev/null
done

# 系统 cron 目录
ls -la /etc/cron.d/ /etc/cron.daily/ /etc/cron.hourly/ /var/spool/cron/crontabs/ 2>/dev/null

# systemd timer / 新增的 service
sudo systemctl list-timers --all
ls -la /etc/systemd/system/*.service /etc/systemd/system/*.timer 2>/dev/null

# rc.local 类启动脚本
cat /etc/rc.local 2>/dev/null
ls -la /etc/init.d/
```

### 6.3 找掉落的二进制

```bash
# Kinsing 通常落在这几个目录
ls -la /tmp /var/tmp /dev/shm /run 2>/dev/null

# 最近 7 天改过 / 创建的可执行文件
find / -xdev -type f -mtime -7 -perm -u+x 2>/dev/null \
    | grep -vE '^/proc|^/sys|^/var/log|^/opt/qishu' | head -50

# 隐藏目录(. 开头 + 可执行)
find / -xdev -type d -name '.*' 2>/dev/null | head -30
```

### 6.4 找外连

```bash
# 活动的 TCP 出站连接
sudo ss -tnp | grep ESTAB

# 解析近期的 DNS 请求(如果装了 systemd-resolved)
sudo journalctl -u systemd-resolved -n 200 | grep -iE 'xmr|mining|pool'
```

### 6.5 找侧门

```bash
# /etc/passwd 里新增的账号
getent passwd | awk -F: '$3 > 999 && $3 < 65534 {print}'

# authorized_keys 里不认识的 key
for home in /root /home/*; do
  echo "=== $home ==="
  cat "$home/.ssh/authorized_keys" 2>/dev/null
done

# sudoers 里的异常配置
sudo cat /etc/sudoers /etc/sudoers.d/* 2>/dev/null
```

### 6.6 如果确认被感染

**不要试图"清理"。** Kinsing 类木马通常会安装多层持久化(crontab + systemd + LD_PRELOAD
库 + 修改 /etc/ld.so.preload 挂钩 + SSH 后门 key),手工清理大概率漏掉某一层,
下次重启又回来。**最稳妥的做法:**

1. 立刻把服务器**下线**(防火墙 DROP 所有出入站)
2. 把 `data/app.db` 复制到本地(防数据丢失),但**假设它也被改过** —— 回头
   跟已知好版本 diff 一遍
3. 在云厂商面板里**重装系统**(不要用备份,备份可能也已污染)
4. 重新按本文档从头部署
5. 把原系统上**所有密码、所有 SSH key、所有 API key、所有 JWT secret 全部作废**
   —— 假设一切都已经泄漏
6. 审计 Cloudflare 账户,看有没有异常登录、新 API token、新 DNS 记录

### 6.7 怎么防下次发生(重点)

- SSH 只允许 key 认证(见 §7)
- 关闭所有不对外提供服务的端口(Redis 只绑 127.0.0.1、Docker API 不要暴露)
- Node / nginx / 系统包每月打一次补丁:`apt update && apt upgrade`
- 启用 `unattended-upgrades` 自动打安全补丁
- 服务器如果有 IPv6 也要关闭不用的服务,别只关 IPv4
- 不在生产服务器上装任何"顺便"的工具(phpMyAdmin / Redis Commander /
  Portainer 都是常见被打入口)

---

## 7. SSH 硬化(非常重要)

Kinsing 以 SSH 暴破入侵最为常见。基础防御:

### 7.1 关掉密码认证

```bash
# /etc/ssh/sshd_config
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
ChallengeResponseAuthentication no
UsePAM yes
AllowUsers your-deploy-user        # 只允许特定用户登录
MaxAuthTries 3
LoginGraceTime 20
```

```bash
sudo sshd -t && sudo systemctl restart ssh
```

### 7.2 SSH 源 IP 限制

如果你能做到(固定办公 IP / 用 Cloudflare Tunnel / 跳板机),**不要把 22 放给全网**。
在防火墙只允许特定源 IP:

```bash
# ufw 示例:只允许你办公网段 ssh
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from 203.0.113.0/24 to any port 22
sudo ufw allow 80,443/tcp
sudo ufw enable
```

如果你必须允许全网 SSH,至少装 fail2ban:

```bash
sudo apt install -y fail2ban
```

默认配置已经会挡 SSH 暴力破解。查看:`sudo fail2ban-client status sshd`。

### 7.3 不要把 `.env` 放进 git

- 在 `.gitignore` 里确认已经有 `.env`
- **如果不小心 commit 过 `.env`,立刻把里面所有密钥 / secret 作废、重新生成**
  —— GitHub / GitLab 的公开仓库会被爬虫在**几分钟内**扫到
- 检查历史:`git log --all --full-history -- .env`

---

## 8. 上线检查清单

按顺序过一遍再打开域名流量:

**应用层**

- [ ] `.env` 里 `NODE_ENV=production`
- [ ] `.env` 里 `JWT_SECRET` 是随机 ≥ 64 字符,不是示例值
- [ ] `.env` 里 `SITE_URL` 填了实际域名,不带尾 `/`
- [ ] `.env` 里 `RESEND_API_KEY` 已填,注册个测试账号能真的收到邮件
- [ ] `.env` 里所有 `*_CLIENT_SECRET` ≥ 16 字符
- [ ] `.env` 没被 commit 到 git(`git check-ignore .env` 输出 `.env`)
- [ ] 登录默认管理员 → 改密码(或 `/admin/users` 删掉再建一个新的)
- [ ] `config/oauth-clients.js` 里 `redirectUris` 已从 `http://localhost:*` 换
      成你的真实 `https://` 回调
- [ ] `/admin/database` 能正常打开所有表

**运维层**

- [ ] `node -v` 输出 ≥ 22.0.0
- [ ] pm2 启动后,`pm2 status` 里 qishu 是 online,memory < 220M
- [ ] pm2 `startup` 已执行(开机自启)
- [ ] `data/app.db` 每日自动备份(cron + `sqlite3 .backup`)
- [ ] nginx 配置里 `set_real_ip_from` + `real_ip_header CF-Connecting-IP` 全段存在
- [ ] nginx 的三条 `limit_req_zone` 都在 http 块中
- [ ] `/api/auth/login` 打超过 10 次能 429(nginx 层生效)
- [ ] SSH 已经关掉密码认证,只接受 key
- [ ] 服务器防火墙只允许 CF IP 段访问 80/443,SSH 限源 IP 或装了 fail2ban
- [ ] Cloudflare 侧 SSL 是 Full (Strict),Always Use HTTPS 开启
- [ ] 跑过一遍 §6 的 Kinsing 自查,都是干净的

---

## 9. 日常运维

### 看日志

```bash
pm2 logs qishu --lines 500
sudo tail -f /var/log/nginx/access.log /var/log/nginx/error.log
```

### 备份数据库

```bash
# /etc/cron.d/qishu-backup
0 3 * * * deploy sqlite3 /opt/qishu/data/app.db ".backup /backups/qishu-$(date +\%F).db" && find /backups -name 'qishu-*.db' -mtime +7 -delete
```

### 内存监控

```bash
pm2 monit                  # 实时
pm2 describe qishu         # 单次快照含 RSS
ps -o pid,rss,command -p $(pgrep -f 'standalone/server.js')   # 最直接
```

如果 RSS 持续 >200MB(不是短时峰值),搜 `pm2 logs qishu | grep -i 'memory'`
看看是不是触发了 restart。几天内没有触发就说明内存是稳的。

### 升级

```bash
cd /opt/qishu
git pull
npm install --ignore-scripts
NODE_OPTIONS="--max-old-space-size=512" npm run build
pm2 restart qishu
```

`scripts/init.js` 幂等,重跑不会覆盖现有数据。

---

## 10. 常见问题

**Q: `npm install` 报 `better-sqlite3` 编译失败**
A: Node 22 下需要新的 node-gyp + python3。`sudo apt install build-essential python3`,重试。

**Q: pm2 每隔几分钟就 `restart`,日志里有 `memory` 字样**
A: 进程命中了 `max_memory_restart: 220M`。常见原因:
  (a) 内存泄漏(git log 看最近是不是改过 autoPrune 逻辑)
  (b) 并发打到 >100,属正常峰值,把 `max_memory_restart` 暂时上调到 300M
  (c) 代码里引入了大内存依赖(某个新加的 npm 包很重)

**Q: 所有请求的 IP 都是 162.158.x.x 这类**
A: nginx 没做 Cloudflare IP 恢复。见 §5.1。

**Q: 管理员忘记密码**
A:
```bash
cd /opt/qishu
node scripts/create-temp-admin.js --email temp@你的域名.com --password "一个新强密码"
# 登录后,去 /admin/users 升级原账号或者把原账号删掉
```

---

## 11. 目录结构速查

```
qishu/
├── app/                  Next.js App Router(页面 + API)
├── components/           共享组件
├── lib/                  业务逻辑 / DB / 鉴权 / 设置
│   ├── urlSafe.js        【1.2.0 新】URL scheme 守卫
│   ├── contentLimits.js  【1.2.0 新】内容字段长度上限
│   └── ...
├── public/               静态文件(favicon 等)
├── scripts/
│   ├── init.js           首次部署自动跑(postinstall)
│   ├── dev-seed.js       本地开发灌占位数据
│   └── load-test.js      【1.2.0 新】本地内存压力测试(Playwright)
├── data/
│   └── app.db            SQLite 数据库(备份这个就够了)
├── ecosystem.config.cjs  pm2 配置(内存上限、重启策略)
├── .env                  环境变量(仅首次启动 seed)
├── .nvmrc                Node 22
├── package.json          engines.node: ">=22.0.0"
├── PLAN.md               【1.2.0 新】本轮改动的设计说明
├── AUDIT.md              代码审查报告
├── DEPLOY.md             本文件
└── CHANGES.md            历史改动记录
```

祝上线顺利。遇事先看 pm2 日志 → nginx error.log → `/admin/settings`,再来翻代码。
