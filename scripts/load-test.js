#!/usr/bin/env node
/**
 * scripts/load-test.js —— 本地内存压力测试(手动运行)
 * ---------------------------------------------------------------------------
 * 用法:
 *   1. 另一个终端先启动应用:
 *        NODE_ENV=production npm run build
 *        pm2 start ecosystem.config.cjs
 *      (或 `node .next/standalone/server.js` 直接跑)
 *   2. 运行此脚本:
 *        npm install --save-dev playwright   # 首次需装
 *        npx playwright install chromium     # 首次需装
 *        node scripts/load-test.js
 *
 * 做什么:
 *   • 开 N 个独立的 Chromium 上下文,每个上下文 open 一个 page
 *   • 每个 page 循环做"首页 → /auth/login → 返回首页"等浏览场景
 *   • 每 2 秒采样一次目标进程的 RSS,曲线打印到 stdout
 *   • 跑满 duration 秒后退出,给出峰值 / 均值 / 末值
 *
 * 不做什么:
 *   • 不替代生产负载测试(生产环境 latency、网络、CF 都会影响)
 *   • 不自动判定"内存是否合格" —— 数字打印出来由你判断
 *
 * 参数:
 *   --users N         默认 20(50 在 2GB VPS 上容易把其他服务挤掉)
 *   --duration SEC    默认 60
 *   --base URL        默认 http://127.0.0.1:3000
 *   --pid PID         手动指定要监控的进程 PID(否则从 pm2 或 ps 查找)
 * ---------------------------------------------------------------------------
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

// ── 参数解析 ───────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, v, i, arr) => {
    if (v.startsWith('--')) acc.push([v.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);
const USERS    = parseInt(args.users || '20', 10);
const DURATION = parseInt(args.duration || '60', 10);
const BASE     = args.base || 'http://127.0.0.1:3000';
const PID      = args.pid ? parseInt(args.pid, 10) : null;

console.log(`── Load test ──`);
console.log(`  users:    ${USERS}`);
console.log(`  duration: ${DURATION}s`);
console.log(`  base URL: ${BASE}`);

// ── 目标进程 PID ──────────────────────────────────────────────────────────
function findPid() {
  if (PID) return PID;
  // 尝试匹配 standalone/server.js
  const out = spawnSync('pgrep', ['-f', 'standalone/server.js']);
  const pid = out?.stdout?.toString().trim().split('\n')[0];
  return pid ? parseInt(pid, 10) : null;
}

const targetPid = findPid();
if (!targetPid) {
  console.error('\n❌ 找不到目标进程。请先启动应用,或用 --pid <PID> 指定。');
  process.exit(1);
}
console.log(`  target PID: ${targetPid}\n`);

// ── RSS 采样 ──────────────────────────────────────────────────────────────
function getRssMB(pid) {
  try {
    // Linux:/proc/<pid>/status 的 VmRSS,单位 kB
    const status = readFileSync(`/proc/${pid}/status`, 'utf-8');
    const m = status.match(/^VmRSS:\s+(\d+)\s+kB/m);
    if (!m) return null;
    return parseInt(m[1], 10) / 1024;   // → MB
  } catch { return null; }
}

const samples = [];
let sampler;

function startSampler() {
  sampler = setInterval(() => {
    const rss = getRssMB(targetPid);
    if (rss == null) return;
    samples.push({ t: Date.now(), rss });
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    process.stdout.write(`\r  [${elapsed.toString().padStart(3)}s] RSS=${rss.toFixed(1)}MB  samples=${samples.length}`);
  }, 2000);
}

// ── 虚拟用户 ──────────────────────────────────────────────────────────────
async function vuser(i, deadline) {
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    let loops = 0;
    while (Date.now() < deadline) {
      try {
        await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 10_000 });
        await page.waitForTimeout(300);
        await page.goto(BASE + '/auth/login', { waitUntil: 'domcontentloaded', timeout: 10_000 });
        await page.waitForTimeout(200);
        loops++;
      } catch (err) {
        // 不 abort,继续循环;真实用户也会在错误里继续用
      }
    }
    return { i, loops };
  } finally {
    await browser.close();
  }
}

// ── 主流程 ────────────────────────────────────────────────────────────────
const startTime = Date.now();
startSampler();
const deadline = startTime + DURATION * 1000;

const results = await Promise.all(
  Array.from({ length: USERS }, (_, i) => vuser(i, deadline))
);

clearInterval(sampler);
process.stdout.write('\n\n');

// ── 汇总 ──────────────────────────────────────────────────────────────────
const rssVals = samples.map(s => s.rss);
const min = Math.min(...rssVals);
const max = Math.max(...rssVals);
const avg = rssVals.reduce((a, b) => a + b, 0) / rssVals.length;
const last = rssVals[rssVals.length - 1];
const totalLoops = results.reduce((a, r) => a + r.loops, 0);

console.log('── 结果 ──');
console.log(`  虚拟用户完成循环数:  ${totalLoops}`);
console.log(`  单用户平均循环:      ${(totalLoops / USERS).toFixed(1)}`);
console.log(`  RSS 采样数:          ${samples.length}`);
console.log(`  RSS 最低:            ${min.toFixed(1)} MB`);
console.log(`  RSS 最高(峰值):     ${max.toFixed(1)} MB`);
console.log(`  RSS 平均:            ${avg.toFixed(1)} MB`);
console.log(`  RSS 结束时:          ${last.toFixed(1)} MB`);
console.log('');
console.log('⚠️  这个数字是你本地机器的测量值。真实生产(Cloudflare + nginx + 不同 CPU)');
console.log('    数字会不同,但趋势一致 —— 主要用来判断「有没有内存泄漏」(连续跑几轮');
console.log('    RSS 结束值应该趋于稳定,而不是一路上升)。');
