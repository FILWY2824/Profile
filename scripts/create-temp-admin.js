#!/usr/bin/env node
/**
 * scripts/create-temp-admin.js —— 一次性临时管理员账号创建器
 * ===========================================================================
 *
 * 场景:你把自己的真实账号注册了(普通用户),但没有任何管理员账号可用,
 *       无法在后台把自己升级成 admin。这个脚本解决那个 bootstrap 问题。
 *
 * 使用流程(**严格按顺序**):
 *
 *   1) 运行这个脚本,它会往 users 表插入一个临时管理员账号:
 *         node scripts/create-temp-admin.js --email temp@example.com --password 'MyPass123!'
 *
 *      脚本会在插入后**自检一次** —— 把刚写进去的 hash 读出来用原密码对一下,
 *      验证"以后用这个密码一定能登录上"。如果这一步失败,脚本会回滚插入并报
 *      错,而不是留一个坏账号在库里。
 *
 *   2) 用这个临时账号登录 /auth/login
 *
 *   3) 在 /admin/users 里把**你的真实账号**改成 role=admin
 *
 *   4) 用你的真实账号登录,然后在 /admin/users 里**删除临时管理员账号**
 *
 *   5) 最后删掉这个脚本文件:
 *         rm scripts/create-temp-admin.js
 *
 *      —— 脚本本身没有权限控制(只要能跑 node 就能造 admin),留在磁盘上
 *      就是一条 bootstrap 后门。用完就删,永远不要上线。
 *
 * 关于"在 Windows 上 --password 'xxx' 登不上"的坑(非常重要):
 *   Windows cmd.exe 不识别单引号作为字符串分隔符,单引号会被作为字面字符传进
 *   argv。如果你在 cmd 里敲 `--password 'abc'`,脚本实际收到的是 `'abc'`(包
 *   含两个引号),bcrypt hash 的也是带引号那版 —— 登录时你不会敲引号,自然
 *   对不上。本脚本会在收到看起来"被引号包住"的密码时主动警告,并在自检时
 *   直接暴露问题。
 *
 *   兼容做法:
 *     • Git Bash / WSL / macOS / Linux —— 用单引号没问题
 *     • Windows cmd.exe ——  改用双引号:node ... --password "MyPass123!"
 *       (密码中含 " 时需 \" 转义)
 *     • PowerShell —— 用单引号(注意 ; 需要用单引号包起来,否则会被识别为
 *       命令分隔符)
 * ===========================================================================
 */
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';

// ── 参数解析(支持 --email / --password 命令行 + 交互式兜底) ────────────
function parseArgs(argv) {
  const out = { email: null, password: null, acceptRisk: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--email') { out.email = argv[++i]; }
    else if (a.startsWith('--email=')) { out.email = a.slice(8); }
    else if (a === '--password') { out.password = argv[++i]; }
    else if (a.startsWith('--password=')) { out.password = a.slice(11); }
    else if (a === '--i-accept-risk') { out.acceptRisk = true; }
    else if (a === '--help' || a === '-h') { out.help = true; }
  }
  return out;
}

const argv = parseArgs(process.argv.slice(2));

if (argv.help) {
  console.log(`用法:
  node scripts/create-temp-admin.js --email <邮箱> --password <密码>
  node scripts/create-temp-admin.js    # 交互式提示输入

可选:
  --i-accept-risk    在 NODE_ENV=production 下也要跑时必须带上这个

⚠️  Windows 用户:cmd.exe 请用双引号 "密码",不要用单引号(会被当作字面字符)

⚠️  这是一个一次性 bootstrap 工具。用完后请立即:
    1) 登录临时账号 → 把你的真实账号升级成 admin
    2) 删除临时账号
    3) rm scripts/create-temp-admin.js
`);
  process.exit(0);
}

// ── 生产环境守卫 ───────────────────────────────────────────────────────────
if (process.env.NODE_ENV === 'production' && !argv.acceptRisk) {
  console.error('❌ 检测到 NODE_ENV=production,拒绝执行。');
  console.error('   理由:这个脚本凭空造一个管理员,生产环境下极其危险。');
  console.error('   如果你真的在生产环境丢失了所有管理员访问,且理解风险,加 --i-accept-risk');
  console.error('   并在操作完成后立即删除本脚本。');
  process.exit(1);
}

// ── 加载 .env(管理员脚本可能依赖 JWT_SECRET 等) ──────────────────────────
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

// ── 交互式输入(仅在 CLI 没给齐时走) ──────────────────────────────────────
function prompt(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function ensureArg(name, interactivePrompt) {
  if (argv[name] != null && argv[name] !== '') return argv[name];
  return (await prompt(interactivePrompt)).trim();
}

// ── shell-quote 自检:cmd.exe 常把单引号当字面字符传进来 ───────────────────
/**
 * 如果密码首尾都是同一种引号字符('a...a' 或 "a...a"),很大概率是 shell 没
 * 去掉引号 —— 这是 Windows cmd.exe 最经典的坑。我们不自动剥掉(万一人家真
 * 的想让密码包含引号呢),而是警告用户确认,并引导他们改成正确的调用方式。
 */
function looksShellQuoted(s) {
  if (!s || s.length < 3) return null;
  const a = s[0], b = s[s.length - 1];
  if ((a === "'" && b === "'") || (a === '"' && b === '"')) return a;
  return null;
}

const email = (await ensureArg('email', '请输入临时管理员邮箱: ')).toLowerCase();
const password = await ensureArg('password', '请输入临时管理员密码(≥8 位,含大小写+数字+特殊字符): ');

// ── 本地校验(避免写入一个永远登录不上的账号) ──────────────────────────
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('❌ 邮箱格式不合法');
  process.exit(1);
}

const quoteChar = looksShellQuoted(password);
if (quoteChar) {
  console.error(`❌ 检测到密码首尾都被 ${quoteChar === "'" ? '单引号' : '双引号'} 包住,`);
  console.error('   这几乎一定是 shell 没把引号当分隔符处理(Windows cmd.exe 最常见)。');
  console.error('   脚本已拒绝继续,避免产生一个你等会儿登不上的账号。');
  console.error('');
  console.error(`   当前收到的密码长度: ${password.length}`);
  console.error(`   首字符: ${quoteChar}   末字符: ${quoteChar}`);
  console.error('');
  console.error('   修复办法(按你用的 shell 选一个):');
  console.error('     • Windows cmd.exe    →  改用双引号  --password "MyPass123!"');
  console.error('     • PowerShell / bash  →  用单引号    --password \'MyPass123!\'');
  console.error('     • 或者省略 --password,让脚本交互式提示你输入(更安全)');
  process.exit(1);
}

// 与 lib/password.js 的 validatePasswordStrength 保持同步的判定规则。
// 为什么不直接 import:避免这个脚本多引入一条依赖链。密码规则不常改,
// 同步成本低。
const STRENGTH_RULES = [
  [/^.{8,}$/, '密码长度至少 8 位'],
  [/[A-Z]/,   '密码必须包含至少一个大写字母'],
  [/[a-z]/,   '密码必须包含至少一个小写字母'],
  [/[0-9]/,   '密码必须包含至少一个数字'],
  [/[^A-Za-z0-9]/, '密码必须包含至少一个特殊字符'],
];
for (const [re, msg] of STRENGTH_RULES) {
  if (!re.test(password)) { console.error(`❌ ${msg}`); process.exit(1); }
}

// ── 引入 DB(会触发 schema + migration 自检,保证表都在) ─────────────────
const { database } = await import('../lib/database.js');
const db = database.raw;

const existing = db.prepare('SELECT id, role, bio FROM users WHERE email = ? LIMIT 1').get(email);
if (existing) {
  console.error(`❌ 该邮箱已存在账号(role=${existing.role})。`);
  // 如果上一次这个脚本写过一个密码对不上的坏账号(常见原因:cmd.exe 的引号
  // 问题),bio 字段会留下明显的痕迹。识别到就告诉用户"怎么清掉那个坏的"。
  if (typeof existing.bio === 'string' && existing.bio.includes('create-temp-admin.js 创建')) {
    console.error('   这个账号是**之前**用本脚本创建的临时管理员。');
    console.error('   如果你是因为上次密码登录不上才重试,请先删掉它再重来:');
    console.error('     方法 A:用你现有的其他管理员账号登录 /admin/users,删除这一条');
    console.error('     方法 B:用 sqlite CLI 直接删:');
    console.error(`              sqlite3 data/app.db "DELETE FROM users WHERE email = '${email}';"`);
  } else {
    console.error('   若要重新创建,请先去 /admin/users 删除,或换一个邮箱。');
  }
  process.exit(1);
}

const t = new Date().toISOString();
const id = uuidv4();
const hash = bcrypt.hashSync(password, 12);

// ── 事务:插入 + 立即读回验证 ────────────────────────────────────────────
// 为什么用事务:如果 bcrypt.compare 在读回时发现对不上(理论上不会,但
// 真的遇到过奇葩情况比如密码里混了 CRLF / NBSP / 零宽字符),我们要能把插
// 入回滚掉。留一个登录不上的死账号比没插入更糟糕 —— 下次用户以为这个邮箱
// 已存在就会去换邮箱再试,而死账号一直留在库里。
const ins = db.prepare(
  `INSERT INTO users
   (id,email,passwordHash,name,role,status,emailVerified,bio,avatar,createdAt,updatedAt)
   VALUES (?,?,?,?,?,?,?,?,?,?,?)`
);
const readBack = db.prepare('SELECT email, passwordHash, role, status, emailVerified FROM users WHERE id = ?');

let verified = false;
const txn = db.transaction(() => {
  ins.run(
    id, email, hash,
    '临时管理员', 'admin', 'active', 1,
    '由 create-temp-admin.js 创建 —— 用于 bootstrap,请尽快删除', '',
    t, t
  );
  const row = readBack.get(id);
  if (!row)                          throw new Error('写入后立即读不到该行 —— DB 未落盘?');
  if (row.email !== email)           throw new Error(`读回的 email 不一致:${row.email} vs ${email}`);
  if (row.role !== 'admin')          throw new Error(`读回的 role 不是 admin:${row.role}`);
  if (row.status !== 'active')       throw new Error(`读回的 status 不是 active:${row.status}`);
  if (row.emailVerified !== 1)       throw new Error(`读回的 emailVerified 不是 1:${row.emailVerified}`);
  if (!bcrypt.compareSync(password, row.passwordHash)) {
    throw new Error('自检:bcrypt 对读回的 hash 和原密码不匹配 —— 拒绝留下坏账号');
  }
  verified = true;
});

try {
  txn();
} catch (err) {
  console.error('❌ 创建失败:', err.message);
  console.error('   事务已回滚,数据库未改动。');
  process.exit(1);
}

if (!verified) {
  console.error('❌ 自检未通过,已回滚');
  process.exit(1);
}

console.log('\n✅ 临时管理员已创建 —— 自检通过(同一密码 bcrypt.compare 成功)');
console.log(`   邮箱:        ${email}`);
console.log(`   角色:        admin`);
console.log(`   密码长度:    ${password.length}`);  // 让用户核对 —— 若不是你预期的长度就是 shell 把引号/特殊符号搞丢了
console.log('');
console.log('⚠️  后续操作(请立刻进行,避免遗留后门):');
console.log('   1) 用上面的邮箱 + 你刚才输入的密码登录 /auth/login');
console.log('   2) 到 /admin/users 把你的真实账号改为 admin');
console.log('   3) 改完后,用真实账号登录,在 /admin/users 删除这个临时管理员');
console.log('   4) 最后在服务器上删除本脚本:');
console.log('        rm scripts/create-temp-admin.js');
console.log('');
