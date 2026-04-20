#!/usr/bin/env node
/**
 * scripts/reseed-cards.js —— 兼容旧 npm script;实际请用 dev-seed.js
 * ---------------------------------------------------------------------------
 * 历史原因:原 reseed-cards.js 里直接写了几条真实资源的 URL,把脚本推到仓库
 * 相当于泄露运维信息。经审计已改造为下面的行为:
 *
 *   1) 不再包含任何真实资源的 URL
 *   2) 在 NODE_ENV=production 下硬性拒绝执行(需 --i-accept-risk 才能越过)
 *   3) 不再在自己内部实现 seed 逻辑 —— 全部转发给 dev-seed.js
 *
 * 这样做的好处:
 *   • 旧的 `npm run reseed` 和 `node scripts/reseed-cards.js` 仍然可用,习惯
 *     动作不需要改;
 *   • 真实 seed 改动集中在 dev-seed.js 一处,不会再出现"两个 seed 脚本各写
 *     一套数据 → 其中一个没跟着改 → 行为不一致"的情况
 * ---------------------------------------------------------------------------
 */
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);
const devSeed = path.join(__dirname, 'dev-seed.js');

console.log('ℹ️  reseed-cards.js 已被替换为 dev-seed.js 的薄包装 —— 直接转发参数。');

const result = spawnSync(process.execPath, [devSeed, ...args], {
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
