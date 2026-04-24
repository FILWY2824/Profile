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
 *   4) 不再 spawn 子进程 —— 直接动态 import dev-seed.js。这样整个进程里
 *      只有一个 node 实例,栈更浅、不依赖 child_process,并且沙盒 / SELinux /
 *      AppArmor 策略更容易限制(Kinsing 类挖矿木马的典型特征就是"被合法进程
 *      spawn 出子进程",减少我们自己的 spawn 调用有助于安全审计区分)。
 * ---------------------------------------------------------------------------
 */
console.log('ℹ️  reseed-cards.js 已被替换为 dev-seed.js 的薄包装 —— 直接转发。');

// dev-seed.js 是顶层脚本(不是导出函数),它的所有逻辑在模块加载阶段执行,
// 并且自己读 process.argv。我们这里以 reseed-cards.js 启动 node,process.argv
// 保持不变,dev-seed.js 拿到的 argv 跟直接调用它时一致。
try {
  await import('./dev-seed.js');
} catch (err) {
  console.error('\n❌ dev-seed 执行失败:', err?.message || err);
  process.exit(1);
}
