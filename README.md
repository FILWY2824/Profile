# Alma Portal

一个面向个人服务聚合主页的轻量全栈项目，当前支持：

- 浅色玻璃拟态门户首页
- 邮箱验证码注册
- 邮箱验证码找回密码
- 普通 / 会员 / 管理员角色权限
- 独立管理员后台
- 文件存储版用户、会话与门户配置
- 统一后端受控跳转，前端不暴露真实模块地址
- `Resend` 邮件发送

## 本地启动

1. 安装依赖

```powershell
npm install
```

2. 配置环境变量

- 项目运行配置在 [`.env`](./.env)
- 示例模板在 [`.env.example`](./.env.example)
- 如果要启用真实邮件发送，请填写 `RESEND_API_KEY`
- 发件人默认使用 `MAIL_FROM=admin@teamcy.eu.cc`

3. 启动服务

```powershell
npm start
```

4. 打开地址

- 门户首页：[http://127.0.0.1:8003](http://127.0.0.1:8003)
- 管理后台：[http://127.0.0.1:8003/admin.html](http://127.0.0.1:8003/admin.html)

## Resend 配置

当前项目已经不再使用传统 SMTP 配置，也不依赖 `mail.teamcy.eu.cc:465/587`。

只需要在 [`.env`](./.env) 中填写：

```env
MAIL_FROM=admin@teamcy.eu.cc
MAIL_REPLY_TO=admin@teamcy.eu.cc
RESEND_API_KEY=你的_Resend_API_Key
MAIL_DEV_LOG_CODES=false
```

说明：

- `RESEND_API_KEY` 为空时，系统会走开发模式，把验证码打印到服务端控制台
- `MAIL_DEV_LOG_CODES=true` 适合本地联调
- `MAIL_DEV_LOG_CODES=false` 更适合正式环境，避免验证码落在控制台日志中
- 如果你要从 `admin@teamcy.eu.cc` 发信，Resend 侧需要允许这个发件地址

## 默认管理员

首次启动后，如果数据文件中还没有管理员，系统会自动种子一个默认管理员：

- 用户名：`admin`
- 密码：`Admin@123456`
- 邮箱：`admin@teamcy.eu.cc`

这些值都可以通过 [`.env`](./.env) 修改。

## 目录结构

```text
.
├─ config-app.js
├─ config-env.js
├─ lib-*.js
├─ store-file.js
├─ service-*.js
├─ route-*.js
├─ server-app.js
├─ server.js
├─ front-*.js
├─ admin.html
├─ admin-page.js
├─ admin-console.css
├─ index.html
├─ styles-*.css
└─ data/store.json
```

## 安全说明

- 会话 Cookie 使用 `HttpOnly` 与 `SameSite=Lax`
- 登录、发码、验码、后台写操作都有限流
- 密码使用 `scrypt` 哈希
- 验证码由后端随机生成，并在后端校验
- 门户真实模块地址保存在后端数据文件中，前端仅访问受控入口

## 生产建议

这版适合继续开发和中小规模使用。如果未来要长期承载大量团队成员访问，建议继续演进：

- 用 MySQL / PostgreSQL 替换文件存储
- 用 Redis 替换当前单机内存限流
- 补充操作日志、审计日志和二次验证
- 生产环境开启 HTTPS 与 `SECURE_COOKIES=true`
