#!/usr/bin/env node
/**
 * scripts/dev-seed.js —— 往数据库灌入纯占位示例数据(仅供本地开发)
 * ---------------------------------------------------------------------------
 * 用法:
 *   node scripts/dev-seed.js                # 预览会做什么,不动数据库
 *   node scripts/dev-seed.js --force        # 真正执行
 *
 * ⚠️ 安全要求:
 *   • 所有 URL 必须是 example.com 系的占位符,绝对不允许写任何真实资源地址
 *   • 本脚本在 NODE_ENV=production 下会硬性拒绝执行;若确认要在生产用
 *     (几乎不可能合理),需要加 --i-accept-risk
 *   • seed 会先清空 sections & cards 两张表 —— 只动这两张,不影响 users /
 *     settings / 日志 / OAuth 等其它数据
 *
 * 如果你想换成自家的真实数据:
 *   直接去 /admin/sections 和 /admin/cards 的管理界面加卡,不要改这个文件。
 *   把真实地址写进脚本意味着它会跟着仓库分发,审查和审计都会非常麻烦。
 * ---------------------------------------------------------------------------
 */
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

// ── 环境守卫 ───────────────────────────────────────────────────────────────
// 生产环境绝对不允许无意间跑这个脚本。加 --i-accept-risk 才能越过,
// 但连这个 flag 的名字都在提醒你"这不是一个正常操作"。
const args = process.argv.slice(2);
const force = args.includes('--force');
const acceptRisk = args.includes('--i-accept-risk');
if (process.env.NODE_ENV === 'production' && !acceptRisk) {
  console.error('❌ 检测到 NODE_ENV=production,已拒绝执行 dev seed。');
  console.error('   dev-seed 会删除所有 sections & cards 并写入占位数据。');
  console.error('   如果你真的理解并要继续,请加上 --i-accept-risk 重新运行。');
  process.exit(1);
}

// ── .env 加载(和 init.js 同款) ───────────────────────────────────────────
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

const { database } = await import('../lib/database.js');
const db = database.raw;
const now = () => new Date().toISOString();

// ── 定义 seed(全部 example.com 占位) ─────────────────────────────────────
// 这里的所有 URL 都指向 example.com。任何尝试改成真实域名的 PR 都应被驳回。
const SECTIONS = [
  { slug: 'demo-public',  name: '公开入口(示例)', desc: '任何访客均可访问的示例卡片',    order: 1 },
  { slug: 'demo-user',    name: '登录后可见(示例)', desc: '需要登录的示例卡片',            order: 2 },
  { slug: 'demo-member',  name: '会员专区(示例)', desc: '仅会员可见的示例卡片',           order: 3 },
  { slug: 'demo-admin',   name: '管理员专区(示例)', desc: '仅管理员可见的示例卡片',         order: 4 },
];

const CARDS = [
  // ── 公开(示例) ──
  { title: '示例外链 A', desc: '这是一张公开占位卡片,点击跳转到 example.com',
    url: 'https://example.com/a', section: 'demo-public', order: 1, perm: 'public' },
  { title: '示例外链 B', desc: '另一张公开占位卡片',
    url: 'https://example.com/b', section: 'demo-public', order: 2, perm: 'public' },

  // ── 登录后可见(示例) ──
  { title: '登录后可见 A', desc: '需要登录才能访问的示例卡片',
    url: 'https://example.com/user/a', section: 'demo-user', order: 1, perm: 'user' },

  // ── 会员专区(示例) ──
  { title: '会员卡片 A', desc: '仅会员可访问的示例链接',
    url: 'https://example.com/member/a', section: 'demo-member', order: 1, perm: 'member' },

  // ── 管理员专区(示例) ──
  { title: '管理员卡片 A', desc: '仅管理员可见的示例链接',
    url: 'https://example.com/admin/a', section: 'demo-admin', order: 1, perm: 'admin' },
];

// ── 当前状态展示 ───────────────────────────────────────────────────────────
const oldSections = db.prepare('SELECT id, name, slug FROM sections ORDER BY "order"').all();
const oldCards = db.prepare('SELECT id, title, url FROM cards').all();

console.log('\n当前数据库中:');
console.log(`  · sections: ${oldSections.length} 个`);
for (const s of oldSections) console.log(`      - ${s.name} (${s.slug})`);
console.log(`  · cards: ${oldCards.length} 张`);
for (const c of oldCards) console.log(`      - ${c.title} → ${c.url}`);

console.log('\n将写入的占位数据:');
console.log(`  · sections: ${SECTIONS.length} 个(全部带 "示例" 字样)`);
console.log(`  · cards: ${CARDS.length} 张(全部指向 example.com)`);

if (!force) {
  console.log('\n⚠️  dry-run 模式 —— 以上数据不会被改动。');
  console.log('   加上 --force 执行真正的重置:\n');
  console.log('   node scripts/dev-seed.js --force\n');
  process.exit(0);
}

// ── 真正执行 ─────────────────────────────────────────────────────────────
const t = now();
const sectionIds = Object.fromEntries(SECTIONS.map(s => [s.slug, uuidv4()]));

const insSection = db.prepare(
  `INSERT INTO sections (id,name,slug,description,"order",createdAt,updatedAt)
   VALUES (?,?,?,?,?,?,?)`
);
const insCard = db.prepare(
  `INSERT INTO cards (id,title,description,url,sectionId,"order",permission,createdAt,updatedAt)
   VALUES (?,?,?,?,?,?,?,?,?)`
);

const txn = db.transaction(() => {
  // 先删卡片再删板块(外键顺序)
  db.prepare('DELETE FROM cards').run();
  db.prepare('DELETE FROM sections').run();

  for (const s of SECTIONS) {
    insSection.run(sectionIds[s.slug], s.name, s.slug, s.desc, s.order, t, t);
  }
  for (const c of CARDS) {
    insCard.run(uuidv4(), c.title, c.desc, c.url, sectionIds[c.section], c.order, c.perm, t, t);
  }
});

try {
  txn();
  console.log('\n✅ dev seed 完成');
  console.log(`   写入 ${SECTIONS.length} 个板块 / ${CARDS.length} 张示例卡片。`);
  console.log('   所有链接都是 example.com 占位,请用 /admin/cards 替换为你自己的内容。\n');
} catch (err) {
  console.error('\n❌ 失败:', err.message);
  console.error('   事务已回滚,旧数据保留。\n');
  process.exit(1);
}
