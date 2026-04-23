import fs from 'fs';
import path from 'path';

const root = process.cwd();
const standaloneDir = path.join(root, '.next', 'standalone');

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true, force: true });
}

if (!fs.existsSync(standaloneDir)) {
  console.warn('[standalone] .next/standalone 不存在,跳过运行时资源复制');
  process.exit(0);
}

copyDir(path.join(root, 'public'), path.join(standaloneDir, 'public'));
copyDir(path.join(root, '.next', 'static'), path.join(standaloneDir, '.next', 'static'));
console.log('[standalone] 已复制 public 与 .next/static 到 standalone 目录');
