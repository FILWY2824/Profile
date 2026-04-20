/**
 * lib/backup.js — 数据库备份到远端(SFTP)
 * ===========================================================================
 * 全链路:
 *   1) better-sqlite3 的 .backup() 在本地 data/ 目录下生成一个快照文件 ——
 *      这不会锁住在线数据库,读写继续跑;
 *   2) 用 node:zlib 流式 gzip 压缩到 data/backup-work/<job>.db.gz;
 *   3) 用 ssh2 建立 SSH 连接,开 SFTP 子系统,
 *      mkdir -p 远端目标目录,fastPut 本地 .gz 上传;
 *   4) 更新 backup_jobs 表为 success,写入 remotePath 和 bytes;清理本地临时文件。
 *
 * 可取消:run() 前拿一个 AbortSignal;取消会 end() SSH 会话,close() 流,
 * 删临时文件。更新任务状态为 'cancelled'。
 *
 * 同一时间只允许一个 running 任务(getRunningJob() 判一下,API 层也挡),
 * 避免两个并发上传把 backup_jobs 乱成一团,也避免 data/backup-work 被同时
 * 写入相同路径。真的需要并行备份?几乎没有正当用例,拒掉更简单。
 *
 * 为什么不用 child_process 跑系统 scp/sqlite3:
 *   • 跨平台:Windows 上默认没有 scp;Alpine Linux 要装 openssh-client
 *   • 更可控:ssh2 直接给我们连接事件、错误码,便于展示给用户
 *   • 避免命令注入面:host/path 都作为参数,不拼 shell 字符串
 * ===========================================================================
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { pipeline } from 'stream/promises';
import { v4 as uuidv4 } from 'uuid';
import { database } from './database.js';
import { getSetting, getSettingInt } from './settings.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const WORK_DIR = path.join(DATA_DIR, 'backup-work');
const DB_PATH = path.join(DATA_DIR, 'app.db');

// 进程内的活跃任务句柄,便于 cancel 接口调用。
// 结构:{ jobId, abortController, cleanup: () => void }
let activeJob = null;

/** 轻量封装 —— 把状态切换集中一处,别处不直接写 backup_jobs。 */
function updateJob(id, patch) {
  const keys = Object.keys(patch);
  const set = keys.map(k => `${k} = ?`).join(', ');
  const values = keys.map(k => patch[k]);
  database.prepare(`UPDATE backup_jobs SET ${set} WHERE id = ?`).run(...values, id);
}

function insertJob(job) {
  database.prepare(`
    INSERT INTO backup_jobs(id, status, startedAt, finishedAt, bytes, remotePath, error, triggeredBy)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    job.id, job.status, job.startedAt, job.finishedAt,
    job.bytes, job.remotePath, job.error, job.triggeredBy
  );
}

/** 当前是否有正在跑的备份任务(进程级 + DB 级 double-check)。 */
export function getRunningJob() {
  // 优先看进程里的引用 —— 更准确(DB 里可能因进程被强杀而留下僵尸 running)
  if (activeJob) {
    const row = database.prepare('SELECT * FROM backup_jobs WHERE id = ?').get(activeJob.jobId);
    if (row?.status === 'running') return row;
  }
  // 查 DB 里是否有残留 running;若没有进程引用,这一定是僵尸 —— 直接判 failed
  const row = database.prepare(`SELECT * FROM backup_jobs WHERE status = 'running' ORDER BY startedAt DESC LIMIT 1`).get();
  if (row && !activeJob) {
    updateJob(row.id, {
      status: 'failed',
      finishedAt: new Date().toISOString(),
      error: '进程异常退出,该任务被标记为失败',
    });
    return null;
  }
  return row || null;
}

export function listJobs({ limit = 50 } = {}) {
  const rows = database.prepare(
    `SELECT id, status, startedAt, finishedAt, bytes, remotePath, error, triggeredBy
     FROM backup_jobs ORDER BY startedAt DESC LIMIT ?`
  ).all(Math.max(1, Math.min(500, limit)));
  return rows;
}

/**
 * 清理过量历史记录 —— 只保留最新 N 条(N 来自 BACKUP_HISTORY_KEEP)。
 * 不碰远端文件,只删 DB 里的条目 —— 远端文件的生命周期应该在远端管理
 * (例如远端服务器上挂个 find -mtime +30 -delete 的 cron)。
 */
function trimHistory() {
  const keep = getSettingInt('BACKUP_HISTORY_KEEP', 50);
  if (keep <= 0) return;
  database.prepare(`
    DELETE FROM backup_jobs WHERE id IN (
      SELECT id FROM backup_jobs ORDER BY startedAt DESC LIMIT -1 OFFSET ?
    )
  `).run(keep);
}

/** 生成安全的远端文件名 —— 不依赖客户端 locale,纯 UTC 时间戳 */
function makeFilename() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp =
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  return `qishu-${stamp}.db.gz`;
}

/**
 * 读 settings 拼出 SFTP 连接配置,并做基本校验。
 * 不在这里建连接 —— 分离成 connectSsh(),便于"测试连通性"这种不跑完整流程的用例。
 */
export function loadBackupConfig() {
  const cfg = {
    enabled: getSetting('BACKUP_ENABLED') === '1',
    host: getSetting('BACKUP_HOST').trim(),
    port: getSettingInt('BACKUP_PORT', 22),
    username: getSetting('BACKUP_USER').trim(),
    authMethod: (getSetting('BACKUP_AUTH_METHOD') || 'password').trim(),
    password: getSetting('BACKUP_PASSWORD'),
    privateKey: getSetting('BACKUP_PRIVATE_KEY'),
    passphrase: getSetting('BACKUP_PRIVATE_KEY_PASSPHRASE'),
    remoteDir: getSetting('BACKUP_REMOTE_DIR').trim() || '/var/backups/qishu',
  };
  const errors = [];
  if (!cfg.enabled) errors.push('备份功能未启用');
  if (!cfg.host) errors.push('未配置备份服务器地址');
  if (!cfg.username) errors.push('未配置 SFTP 用户名');
  if (cfg.port < 1 || cfg.port > 65535) errors.push('端口号非法');
  if (cfg.authMethod === 'password' && !cfg.password) errors.push('选择密码认证但未配置密码');
  if (cfg.authMethod === 'key' && !cfg.privateKey) errors.push('选择密钥认证但未配置私钥');
  if (!cfg.remoteDir.startsWith('/')) errors.push('远端目录必须是绝对路径');
  return { config: cfg, errors };
}

/**
 * 按配置建立 SSH 连接并返回 ssh2 Client。调用方负责 .end()。
 * 出错时 reject,不会泄漏连接。
 */
function connectSsh(config, { signal } = {}) {
  return new Promise((resolve, reject) => {
    // 动态 import —— 让没装 ssh2 的开发环境不至于一加载 lib 就炸
    import('ssh2').then(({ Client }) => {
      const conn = new Client();
      let settled = false;

      function onAbort() {
        if (settled) return;
        settled = true;
        try { conn.end(); } catch {}
        reject(new Error('已取消'));
      }
      if (signal) {
        if (signal.aborted) return onAbort();
        signal.addEventListener('abort', onAbort, { once: true });
      }

      conn.on('ready', () => {
        if (settled) return;
        settled = true;
        if (signal) signal.removeEventListener('abort', onAbort);
        resolve(conn);
      });
      conn.on('error', (err) => {
        if (settled) return;
        settled = true;
        if (signal) signal.removeEventListener('abort', onAbort);
        reject(new Error(friendlySshError(err)));
      });

      const connectOpts = {
        host: config.host,
        port: config.port,
        username: config.username,
        // 30s 握手超时 —— SSH/SFTP 握手一般 <2s,30s 还没完多半是网络或防火墙问题
        readyTimeout: 30_000,
        keepaliveInterval: 10_000,
      };
      if (config.authMethod === 'key') {
        connectOpts.privateKey = config.privateKey;
        if (config.passphrase) connectOpts.passphrase = config.passphrase;
      } else {
        connectOpts.password = config.password;
      }

      try {
        conn.connect(connectOpts);
      } catch (err) {
        if (settled) return;
        settled = true;
        reject(new Error(friendlySshError(err)));
      }
    }).catch((err) => {
      reject(new Error(`SSH 模块加载失败: ${err.message}`));
    });
  });
}

/** 把 ssh2 的原生错误翻译成对管理员友好的话 —— 原始 code 附在末尾便于排查 */
function friendlySshError(err) {
  const code = err?.level || err?.code || '';
  const msg = err?.message || String(err);
  if (code === 'client-authentication') return `认证失败:用户名或密码/密钥错误 (${code})`;
  if (code === 'client-timeout')        return `连接超时:请检查服务器地址和防火墙 (${code})`;
  if (/ENOTFOUND|EAI_AGAIN/.test(msg))  return `主机名解析失败:${msg}`;
  if (/ECONNREFUSED/.test(msg))         return `连接被拒绝:端口可能未开放或服务未运行`;
  if (/ETIMEDOUT/.test(msg))            return `连接超时:服务器无响应`;
  if (/Cannot parse privateKey/i.test(msg)) return `私钥格式不正确:请检查是否为完整 PEM 文本`;
  return `${msg}${code ? ` (${code})` : ''}`;
}

/** 测试连通性 —— 尝试连接 + 打开 SFTP 子系统,不上传任何数据 */
export async function testConnection() {
  const { config, errors } = loadBackupConfig();
  // 测试允许在"未启用"时跑,方便管理员填好表单后先试连通性再开开关
  const filtered = errors.filter(e => e !== '备份功能未启用');
  if (filtered.length) throw new Error(filtered.join('; '));

  const conn = await connectSsh(config);
  try {
    await new Promise((resolve, reject) => {
      conn.sftp((err, sftp) => {
        if (err) return reject(new Error(friendlySshError(err)));
        // 尝试 stat 远端目录 —— 不存在也不失败,只是作为信息反馈
        sftp.stat(config.remoteDir, (statErr, stats) => {
          sftp.end();
          if (statErr) {
            // ENOENT / no such file —— 远端目录不存在,但连接是通的
            if (/no such file|ENOENT/i.test(statErr.message)) return resolve({ remoteDirExists: false });
            return reject(new Error(`远端目录检查失败: ${statErr.message}`));
          }
          if (!stats.isDirectory()) {
            return reject(new Error(`${config.remoteDir} 存在但不是目录`));
          }
          resolve({ remoteDirExists: true });
        });
      });
    });
    return { ok: true };
  } finally {
    try { conn.end(); } catch {}
  }
}

/** 把 path.posix.join 的功能手写一下:远端永远是 POSIX 路径,不受本地 OS 影响 */
function posixJoin(a, b) {
  const left = a.replace(/\/+$/, '');
  const right = b.replace(/^\/+/, '');
  return `${left}/${right}`;
}

/** 远端 mkdir -p。SFTP 没有 -p,我们自己从根向下逐段尝试创建,已存在就忽略。 */
function sftpMkdirP(sftp, dir) {
  // reject 参数保留是为了对齐 Promise 构造器签名,mkdir -p 的设计是"尽力而为",
  // 即使中间有不存在/权限错,也不在这里失败 —— 真正错误会在后续 fastPut 暴露。
  return new Promise((resolve, _reject) => {
    const parts = dir.split('/').filter(Boolean);
    let cur = '';
    const next = (i) => {
      if (i >= parts.length) return resolve();
      cur = `/${parts.slice(0, i + 1).join('/')}`;
      sftp.mkdir(cur, (err) => {
        // 4 = SSH_FX_FAILURE(许多 server 用它表示"已存在"),11 也见过。
        // 比判码更稳妥的是:mkdir 完 stat 一下 —— 但那太慢。我们直接忽略大多数错,
        // 最后 fastPut 失败会统一报错,诊断点是一致的。
        if (err && !/file exists|already exists|failure/i.test(err.message || '')) {
          // 极端情况下无权限等,依然交给下一步失败反馈
        }
        next(i + 1);
      });
    };
    next(0);
  });
}

/**
 * 真正跑一次备份。
 *
 * @param {object} opts
 * @param {string} opts.triggeredBy  形如 'admin:<userId>'
 * @returns {Promise<{jobId: string}>}  会立即 resolve(不等完成),调用方 polling 状态
 *
 * 设计:这个函数 fire-and-forget —— 同步创建一条 pending 记录,挂一个异步
 * runner 去跑实际工作,调用方拿到 jobId 就返回。前端 polling
 * /api/admin/backup 即可看到 pending → running → success/failed 的状态变化。
 *
 * 为什么不 await 整个流程:
 *   • 备份小文件 1~2s,大文件 10~60s,个别极端场景(网络卡)可能更久;
 *     直接在 API handler 里 await 会把 HTTP 连接挂在那里,Next/代理层可能超时
 *   • polling 模式让前端进度条能动起来,用户体验更好
 */
export async function startBackup({ triggeredBy }) {
  if (activeJob) throw new Error('已有备份任务正在进行,请先等待完成或取消');
  const running = getRunningJob();
  if (running) throw new Error('已有备份任务正在进行,请先等待完成或取消');

  const { config, errors } = loadBackupConfig();
  if (errors.length) throw new Error(errors.join('; '));

  if (!fs.existsSync(DATA_DIR)) throw new Error('本地 data 目录不存在,无法创建快照');
  if (!fs.existsSync(DB_PATH))  throw new Error('找不到数据库文件 data/app.db');
  if (!fs.existsSync(WORK_DIR)) fs.mkdirSync(WORK_DIR, { recursive: true });

  const jobId = uuidv4();
  const now = new Date().toISOString();
  const filename = makeFilename();

  insertJob({
    id: jobId,
    status: 'running', // 直接进 running 状态,前端一拿到就可以展示动画
    startedAt: now,
    finishedAt: null,
    bytes: 0,
    remotePath: '',
    error: '',
    triggeredBy,
  });

  const abortController = new AbortController();
  const cleanupPaths = [];

  activeJob = {
    jobId,
    abortController,
    cleanup: () => {
      for (const p of cleanupPaths) {
        try { fs.unlinkSync(p); } catch {}
      }
    },
  };

  // 异步执行 —— 不 await,让 API 立即返回
  runBackupAsync({ jobId, filename, config, abortController, cleanupPaths })
    .catch((err) => {
      console.error('[backup] unexpected runner error:', err);
    });

  return { jobId };
}

async function runBackupAsync({ jobId, filename, config, abortController, cleanupPaths }) {
  const { signal } = abortController;
  const workSnapshot = path.join(WORK_DIR, `${jobId}.db`);
  const workGz       = path.join(WORK_DIR, `${jobId}.db.gz`);
  cleanupPaths.push(workSnapshot, workGz);

  try {
    // 1) SQLite 在线快照 —— 用 better-sqlite3 原生的 .backup(),不影响在线服务
    await takeSqliteSnapshot(workSnapshot, signal);
    if (signal.aborted) throw new Error('已取消');

    // 2) gzip 压缩(流式,避免整个文件读进内存)
    await pipeline(
      fs.createReadStream(workSnapshot),
      zlib.createGzip({ level: 6 }),  // 6 在压缩率/速度间最平衡;SQLite 压得很好
      fs.createWriteStream(workGz)
    );
    try { fs.unlinkSync(workSnapshot); } catch {}
    cleanupPaths.splice(cleanupPaths.indexOf(workSnapshot), 1);

    if (signal.aborted) throw new Error('已取消');

    // 3) SFTP 上传
    const remotePath = posixJoin(config.remoteDir, filename);
    const bytes = await uploadViaSftp({ config, localPath: workGz, remotePath, signal });

    try { fs.unlinkSync(workGz); } catch {}
    cleanupPaths.splice(cleanupPaths.indexOf(workGz), 1);

    updateJob(jobId, {
      status: 'success',
      finishedAt: new Date().toISOString(),
      bytes,
      remotePath,
    });
  } catch (err) {
    const cancelled = signal.aborted || /已取消/.test(err?.message || '');
    updateJob(jobId, {
      status: cancelled ? 'cancelled' : 'failed',
      finishedAt: new Date().toISOString(),
      error: (err?.message || '未知错误').slice(0, 500),
    });
  } finally {
    if (activeJob?.jobId === jobId) {
      activeJob.cleanup();
      activeJob = null;
    }
    // 清理过量历史记录
    try { trimHistory(); } catch {}
  }
}

/**
 * 用 better-sqlite3 的 .backup() 拷一份当前 DB。
 * 这个方法走的是 SQLite 官方的 online backup API,读写不阻塞业务。
 */
async function takeSqliteSnapshot(destPath, signal) {
  // .backup 是 Promise-based(better-sqlite3 v11 起)
  // progress 回调的两个参数(totalPages / remainingPages)本可以用来做进度条,
  // 但当前 UI 没展位,所以仅把 signal 转成"返回 0 即取消"的约定。参数名加
  // 下划线前缀标记为有意未用。
  await database.raw.backup(destPath, {
    progress: ({ totalPages: _totalPages, remainingPages: _remainingPages }) => {
      if (signal?.aborted) {
        // 返回 0 会让 backup 取消(better-sqlite3 文档的约定),
        // 取消后 .backup 会 throw;外层 try-catch 会把状态落到 cancelled
        return 0;
      }
      return 100; // 每次 100 页一个 batch,大库也不会把线程卡死
    },
  });
}

/** SFTP 上传;返回实际上传字节数(从本地文件 size 得到,且与 fastPut 完成一致) */
async function uploadViaSftp({ config, localPath, remotePath, signal }) {
  const conn = await connectSsh(config, { signal });
  try {
    return await new Promise((resolve, reject) => {
      function onAbort() {
        try { conn.end(); } catch {}
        reject(new Error('已取消'));
      }
      if (signal) {
        if (signal.aborted) return onAbort();
        signal.addEventListener('abort', onAbort, { once: true });
      }

      conn.sftp(async (err, sftp) => {
        if (err) return reject(new Error(friendlySshError(err)));
        try {
          const dir = remotePath.substring(0, remotePath.lastIndexOf('/')) || '/';
          await sftpMkdirP(sftp, dir);

          sftp.fastPut(localPath, remotePath, { concurrency: 4 }, (putErr) => {
            if (signal) signal.removeEventListener('abort', onAbort);
            if (putErr) {
              sftp.end();
              return reject(new Error(`上传失败: ${putErr.message}`));
            }
            sftp.end();
            const size = fs.statSync(localPath).size;
            resolve(size);
          });
        } catch (innerErr) {
          if (signal) signal.removeEventListener('abort', onAbort);
          try { sftp.end(); } catch {}
          reject(innerErr);
        }
      });
    });
  } finally {
    try { conn.end(); } catch {}
  }
}

/** 取消当前正在跑的备份。返回 true 表示确实取消了一个任务。 */
export function cancelActive() {
  if (!activeJob) return false;
  activeJob.abortController.abort();
  return true;
}
