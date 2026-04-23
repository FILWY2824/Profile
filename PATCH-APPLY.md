# 补丁应用说明

## 0) 先确认 Node 版本
Next.js 16 需要 Node.js >= 20.9.0。

```bash
node -v
```

如果低于 20.9.0，请先升级 Node 再继续。

## 1) 推荐方式：应用补丁（会正确删除危险旧文件）
> 由于本补丁包含“删除文件”，**优先使用 patch / git apply**，不要只做简单覆盖。

```bash
cd /你的项目根目录

git apply --check qishu-security-memory.patch
git apply qishu-security-memory.patch
```

如果你的工作区里已经有很多本地改动，可先新建分支，或者用 `git apply --reject --whitespace=fix qishu-security-memory.patch` 手工处理冲突。

## 2) 清理旧依赖与旧构建
```bash
rm -rf node_modules .next package-lock.json
```

## 3) 安装依赖
```bash
npm install
```

## 4) 设置新的 JWT_SECRET
生产环境必须放在服务器环境变量或 `.env` 中，且长度至少 64 字符。

生成示例：
```bash
npm run generate:jwt-secret
```

把生成结果写入 `.env`：
```bash
JWT_SECRET=这里替换成你生成的64字符以上随机串
```

## 5) 构建
```bash
npm run build
```

## 6) 使用 PM2 启动（不要再用 `pm2 start npm -- start`）
```bash
pm2 delete qishu || true
pm2 start ecosystem.config.cjs
pm2 save
```

## 7) 观察内存
```bash
pm2 monit
pm2 logs qishu
```

本补丁的运行方式会：
- 直接运行 `.next/standalone/server.js`
- 避免 npm 包装进程
- 设置 Node 堆上限 `--max-old-space-size=384`
- 超过 `450M` 时自动重启

## 8) 首次启动后的强制安全动作
- 旋转管理员密码
- 旋转所有 OAuth client secret
- 旋转邮件服务 API Key
- 检查服务器是否仍存在 `/tmp/kinsing`、异常 `cron`、异常 `systemd` 服务、异常 SSH key
- 若主机已确认被入侵，优先重装系统或从可信快照重建，不建议在被污染系统上“就地继续跑”
