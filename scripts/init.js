#!/usr/bin/env node
/**
 * scripts/init.js —— 首次部署/安装时运行的 bootstrap 脚本
 * ---------------------------------------------------------------------------
 * 目标(幂等,可反复运行):
 *   1) 手动加载 .env / .env.local 到 process.env(Next.js 的 dev/start 会自己
 *      加载,但 postinstall 直接跑 node 不会 —— 这一步保证首次迁移时能拿到
 *      正确的 ADMIN_EMAIL / ADMIN_PASSWORD / JWT_SECRET / RESEND_* 等)
 *   2) 打开(或创建)data/app.db
 *   3) 触发 schema + 旧 JSON 迁移 + .env→settings 迁移
 *   4) 若 users 表为空或不存在匹配的 ADMIN_EMAIL,创建默认管理员账号
 *
 * ⚠️ 关于示例数据(卡片 / 板块):
 *   这个脚本**不再往数据库里灌任何卡片和板块**。原因:
 *     • 此脚本会在 `npm install` 的 postinstall 阶段自动运行,意味着只要有人
 *       安装了这个项目,就会立刻拿到一套带真实/虚构资源链接的首页
 *     • 真实链接泄露 = 信息泄露;虚构链接也可能被用户当真点进去,把时间浪
 *       费在占位符上
 *     • 同一份代码可能被部署到生产 / 预发 / 本地开发多个环境,一份 seed 不
 *       可能对每一种都合适
 *
 *   如果你需要本地开发用的示例数据,执行:
 *       node scripts/dev-seed.js
 *   该脚本会灌入**明确标注为占位符**的 example.com 链接,绝不触及真实资源。
 * ---------------------------------------------------------------------------
 */
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';

// ── 1) 手动加载 .env 文件(只加载 process.env 中还没有的键,避免覆盖真实环境) ──
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  const content = fs.readFileSync(file, 'utf-8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
const root = process.cwd();
loadEnvFile(path.join(root, '.env'));
loadEnvFile(path.join(root, '.env.local'));

// ── 2)-3) 引入 database.js 触发 schema + migration ──
const { database } = await import('../lib/database.js');
const db = database.raw;

const now = () => new Date().toISOString();

// ── 4) 管理员 ──
// ADMIN_EMAIL / ADMIN_PASSWORD 必须通过 .env 或 shell 环境变量设置。
// 这里没有默认值 —— 原本的 admin@qishu.local / Admin@123456 是"一键装死"的
// 后门,在公开仓库里相当于告诉所有人"请来黑我"。
const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const adminPassword = process.env.ADMIN_PASSWORD || '';

if (!adminEmail || !adminPassword) {
  console.log('ℹ️  未设置 ADMIN_EMAIL / ADMIN_PASSWORD,跳过管理员创建。');
  console.log('   首次部署时,请在 .env 或 shell 中设置后重新运行:');
  console.log('     ADMIN_EMAIL=you@yourdomain.com ADMIN_PASSWORD=\'一个强密码\' node scripts/init.js');
  console.log('   或者跑 scripts/create-temp-admin.js 创建一个临时管理员。');
} else {
  const hasAdmin = db.prepare('SELECT id FROM users WHERE email = ? LIMIT 1').get(adminEmail);
  if (!hasAdmin) {
    const t = now();
    db.prepare(
      `INSERT INTO users
       (id,email,passwordHash,name,role,status,emailVerified,bio,avatar,createdAt,updatedAt)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      uuidv4(), adminEmail, bcrypt.hashSync(adminPassword, 12),
      '管理员', 'admin', 'active', 1, '栖枢平台管理员', '',
      t, t
    );
    console.log(`✅ 管理员已创建: ${adminEmail}`);
    console.log('   (密码仅本次输出,后续请通过登录页使用)');
  } else {
    console.log(`ℹ️  管理员已存在: ${adminEmail}(跳过)`);
  }
}

// ── 5) seed 数据提示 ──
const sectionCount = db.prepare('SELECT COUNT(*) AS c FROM sections').get().c;
const cardCount = db.prepare('SELECT COUNT(*) AS c FROM cards').get().c;
if (sectionCount === 0 && cardCount === 0) {
  console.log('\nℹ️  数据库中没有板块和卡片。');
  console.log('   需要示例数据用于本地开发 → `node scripts/dev-seed.js`');
  console.log('   生产环境请通过 /admin/sections 和 /admin/cards 手动添加。');
} else {
  console.log(`ℹ️  板块 ${sectionCount} 个,卡片 ${cardCount} 张 —— 跳过 seed`);
}

console.log('\n🚀 初始化完成！');
console.log('   npm run dev  →  http://localhost:3000');
if (adminEmail) {
  console.log(`   管理员邮箱: ${adminEmail}`);
}
console.log('   配置项: /admin/settings (原 .env 已迁入 settings 表)');
