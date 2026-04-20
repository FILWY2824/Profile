/**
 * lib/fileStore.js —— 兼容层(SQLite 版)
 * ---------------------------------------------------------------------------
 * 历史原因这个文件叫 "fileStore",现在实际上是高写入量表的访问包装:
 *   • loginHistory       → login_history
 *   • activityLog        → activity_log
 *   • verificationCodes  → verification_codes
 *   • oauthStore         → oauth_codes + oauth_tokens
 *
 * 旧代码在各 API 路由里的调用点一律保持不变;因此下面导出的每个对象方法
 * 签名都与先前完全一致,仅实现从 fs + 按日期分区的 JSON 换到了 SQL。
 * ---------------------------------------------------------------------------
 */

import { database } from './database.js';
import { getSettingInt } from './settings.js';
import { shanghaiStartIso, shanghaiEndIso } from './time.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * 获取验证码的最大尝试次数(所有路由共用同一配置)。
 * 从 settings 表的 VERIFICATION_CODE_MAX_ATTEMPTS 读,默认 5。
 */
export function getVerificationCodeMaxAttempts() {
  const n = getSettingInt('VERIFICATION_CODE_MAX_ATTEMPTS', 5);
  return Math.max(1, n);
}

// ────────────────────────────────────────────────────────────────────────────
// Login History
// ────────────────────────────────────────────────────────────────────────────
export const loginHistory = {
  record(userId, email, ip, userAgent, success, reason = '') {
    database.prepare(
      `INSERT INTO login_history (id, userId, email, ip, userAgent, success, reason, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      uuidv4(),
      userId || null,
      email || null,
      ip || 'unknown',
      userAgent || 'unknown',
      success ? 1 : 0,
      reason || '',
      new Date().toISOString()
    );
  },

  getRecent(userId, limit = 10) {
    const rows = database.prepare(
      `SELECT * FROM login_history WHERE userId = ? ORDER BY timestamp DESC LIMIT ?`
    ).all(userId, limit);
    return rows.map(r => ({ ...r, success: r.success === 1 }));
  },

  /**
   * @param options {
   *   page, pageSize,
   *   userId,                         // 筛选某用户
   *   dateStr,                        // 旧参:某一天(YYYY-MM-DD)—— 保留向后兼容
   *   from, to,                       // 新参:from 至今 / from..to 的 ISO 日期(YYYY-MM-DD)
   *   search,                         // 模糊搜索 email / ip / userAgent / reason
   *   includeAvailableDates           // true 时额外返回 availableDates:string[]
   * }
   */
  getAll({
    page = 1, pageSize = 20, userId = null,
    dateStr = null, from = null, to = null,
    search = null, includeAvailableDates = false,
  } = {}) {
    const args = [];
    const conditions = [];
    if (userId) { conditions.push('userId = ?'); args.push(userId); }
    if (dateStr) {
      // 兼容:按上海时区的当日 00:00~23:59 切 UTC 范围
      conditions.push('timestamp >= ? AND timestamp <= ?');
      args.push(shanghaiStartIso(dateStr), shanghaiEndIso(dateStr));
    } else {
      if (from) { conditions.push('timestamp >= ?'); args.push(shanghaiStartIso(from)); }
      if (to)   { conditions.push('timestamp <= ?'); args.push(shanghaiEndIso(to)); }
    }
    if (search) {
      const like = `%${search.trim()}%`;
      conditions.push('(email LIKE ? OR ip LIKE ? OR userAgent LIKE ? OR reason LIKE ?)');
      args.push(like, like, like, like);
    }
    const whereSql = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';

    const total = database.prepare(
      `SELECT COUNT(*) AS c FROM login_history${whereSql}`
    ).get(...args).c;

    const offset = (page - 1) * pageSize;
    const rows = database.prepare(
      `SELECT * FROM login_history${whereSql} ORDER BY timestamp DESC LIMIT ? OFFSET ?`
    ).all(...args, pageSize, offset);

    const out = {
      items: rows.map(r => ({ ...r, success: r.success === 1 })),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };

    if (includeAvailableDates) {
      // 取当前过滤条件(不含日期自身)下所有存在记录的日期,用于前端禁用空日
      // 时间戳在库里是 UTC ISO,用 datetime(ts, '+8 hours') 转成上海时间再截日
      const dateArgs = [];
      const dateConditions = [];
      if (userId) { dateConditions.push('userId = ?'); dateArgs.push(userId); }
      if (search) {
        const like = `%${search.trim()}%`;
        dateConditions.push('(email LIKE ? OR ip LIKE ? OR userAgent LIKE ? OR reason LIKE ?)');
        dateArgs.push(like, like, like, like);
      }
      const dateWhere = dateConditions.length ? ' WHERE ' + dateConditions.join(' AND ') : '';
      const dateRows = database.prepare(
        `SELECT DISTINCT substr(datetime(timestamp, '+8 hours'), 1, 10) AS d
         FROM login_history${dateWhere} ORDER BY d DESC`
      ).all(...dateArgs);
      out.availableDates = dateRows.map(r => r.d);
    }

    return out;
  },

  /**
   * 按保留天数裁剪。`days === 0` → 清空全部;`days < 0` → 不裁剪;
   * 返回删除行数,供 admin UI 回显。
   */
  prune(days) {
    const d = parseInt(days, 10);
    if (!Number.isFinite(d) || d < 0) return { deleted: 0, skipped: true };
    if (d === 0) {
      const info = database.prepare('DELETE FROM login_history').run();
      return { deleted: info.changes };
    }
    const cutoff = new Date(Date.now() - d * 86400000).toISOString();
    const info = database.prepare(
      'DELETE FROM login_history WHERE timestamp < ?'
    ).run(cutoff);
    return { deleted: info.changes };
  },
};

// ────────────────────────────────────────────────────────────────────────────
// Activity Log
// ────────────────────────────────────────────────────────────────────────────
function buildActivityRecord(args) {
  // 兼容两种签名:
  //   record(userId, username, action, detail, meta)
  //   record({ userId, username, email, action, target, detail, meta, ip })
  const first = args[0];
  if (first && typeof first === 'object' && !Array.isArray(first)) {
    const o = first;
    return {
      id: uuidv4(),
      userId: o.userId || null,
      username: o.username || o.email || 'anonymous',
      email: o.email || '',
      action: o.action || '',
      detail: o.detail || '',
      target: o.target || null,
      ip: o.ip || '',
      meta: JSON.stringify(o.meta || {}),
      timestamp: new Date().toISOString(),
    };
  }
  const [userId, username, action, detail = '', meta = {}] = args;
  return {
    id: uuidv4(),
    userId: userId || null,
    username: username || 'anonymous',
    email: '',
    action: action || '',
    detail: detail || '',
    target: null,
    ip: '',
    meta: JSON.stringify(meta || {}),
    timestamp: new Date().toISOString(),
  };
}

export const activityLog = {
  record(...args) {
    const r = buildActivityRecord(args);
    database.prepare(
      `INSERT INTO activity_log
       (id,userId,username,email,action,detail,target,ip,meta,timestamp)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run(
      r.id, r.userId, r.username, r.email, r.action,
      r.detail, r.target, r.ip, r.meta, r.timestamp
    );
  },

  /**
   * @param options { page, pageSize, userId, dateStr, action, userCap }
   *   userCap: 非 null 时,限制返回的记录总数(用于"普通用户只能看最新 30 条")。
   *            会影响 total 与 totalPages 的计算,保证前端分页控件与实际可见数据一致。
   */
  /**
   * @param options {
   *   page, pageSize,
   *   userId,                         // 筛选某用户
   *   dateStr,                        // 旧参:某一天(保留兼容)
   *   from, to,                       // 新参:起止日期(YYYY-MM-DD)
   *   action,                         // 操作类型过滤
   *   search,                         // 模糊匹配 username / email / detail / ip
   *   userCap,                        // 普通用户看最新 30 条时使用
   *   includeAvailableDates           // 返回 availableDates:string[]
   * }
   */
  getAll({
    page = 1, pageSize = 30,
    userId = null, dateStr = null, from = null, to = null,
    action = null, search = null,
    userCap = null, includeAvailableDates = false,
  } = {}) {
    const args = [];
    const conditions = [];
    if (userId) { conditions.push('userId = ?'); args.push(userId); }
    if (dateStr) {
      conditions.push('timestamp >= ? AND timestamp <= ?');
      args.push(shanghaiStartIso(dateStr), shanghaiEndIso(dateStr));
    } else {
      if (from) { conditions.push('timestamp >= ?'); args.push(shanghaiStartIso(from)); }
      if (to)   { conditions.push('timestamp <= ?'); args.push(shanghaiEndIso(to)); }
    }
    if (action) { conditions.push('action = ?'); args.push(action); }
    if (search) {
      const like = `%${search.trim()}%`;
      conditions.push('(username LIKE ? OR email LIKE ? OR detail LIKE ? OR ip LIKE ?)');
      args.push(like, like, like, like);
    }
    const whereSql = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';

    let total = database.prepare(
      `SELECT COUNT(*) AS c FROM activity_log${whereSql}`
    ).get(...args).c;

    if (userCap && total > userCap) total = userCap;

    const offset = (page - 1) * pageSize;
    const rawLimit = pageSize;
    let effectiveLimit = rawLimit;
    if (userCap) {
      const remain = Math.max(0, userCap - offset);
      effectiveLimit = Math.min(rawLimit, remain);
    }
    let rows = [];
    if (effectiveLimit > 0) {
      rows = database.prepare(
        `SELECT * FROM activity_log${whereSql} ORDER BY timestamp DESC LIMIT ? OFFSET ?`
      ).all(...args, effectiveLimit, offset);
    }

    const out = {
      items: rows.map(r => ({
        ...r,
        meta: safeJson(r.meta),
      })),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };

    if (includeAvailableDates) {
      const dateArgs = [];
      const dateConditions = [];
      if (userId) { dateConditions.push('userId = ?'); dateArgs.push(userId); }
      if (action) { dateConditions.push('action = ?'); dateArgs.push(action); }
      if (search) {
        const like = `%${search.trim()}%`;
        dateConditions.push('(username LIKE ? OR email LIKE ? OR detail LIKE ? OR ip LIKE ?)');
        dateArgs.push(like, like, like, like);
      }
      const dateWhere = dateConditions.length ? ' WHERE ' + dateConditions.join(' AND ') : '';
      const dateRows = database.prepare(
        `SELECT DISTINCT substr(datetime(timestamp, '+8 hours'), 1, 10) AS d
         FROM activity_log${dateWhere} ORDER BY d DESC`
      ).all(...dateArgs);
      out.availableDates = dateRows.map(r => r.d);
    }

    return out;
  },

  prune(days) {
    const d = parseInt(days, 10);
    if (!Number.isFinite(d) || d < 0) return { deleted: 0, skipped: true };
    if (d === 0) {
      const info = database.prepare('DELETE FROM activity_log').run();
      return { deleted: info.changes };
    }
    const cutoff = new Date(Date.now() - d * 86400000).toISOString();
    const info = database.prepare(
      'DELETE FROM activity_log WHERE timestamp < ?'
    ).run(cutoff);
    return { deleted: info.changes };
  },
};

// ────────────────────────────────────────────────────────────────────────────
// Verification Codes
// ────────────────────────────────────────────────────────────────────────────
export const verificationCodes = {
  save(email, code, type, opts = {}) {
    // 如果调用方没指定 expiresMinutes,就读 settings 里的全局配置(默认 30 分钟)
    const defaultExpiry = getSettingInt('VERIFICATION_CODE_EXPIRY_MINUTES', 30);
    const { expiresMinutes = defaultExpiry, meta = null, ip = null } = opts;
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + expiresMinutes * 60000).toISOString();

    // 同一 email+type 的旧未用验证码作废(保持原语义)
    database.prepare(
      `DELETE FROM verification_codes WHERE email = ? AND type = ? AND used = 0`
    ).run(email, type);

    database.prepare(
      `INSERT INTO verification_codes
       (id,email,code,type,ip,meta,attempts,used,expiresAt,createdAt)
       VALUES (?,?,?,?,?,?,0,0,?,?)`
    ).run(uuidv4(), email, code, type, ip, meta ? JSON.stringify(meta) : null, expiresAt, now);
  },

  peek(email, type) {
    const now = new Date().toISOString();
    const row = database.prepare(
      `SELECT * FROM verification_codes
       WHERE email = ? AND type = ? AND used = 0 AND expiresAt > ?
       ORDER BY createdAt DESC LIMIT 1`
    ).get(email, type, now);
    if (!row) return null;
    return { record: hydrateVCode(row), dateStr: row.createdAt.slice(0, 10) };
  },

  incrementAttempts(email, type) {
    const now = new Date().toISOString();
    const row = database.prepare(
      `SELECT id, attempts FROM verification_codes
       WHERE email = ? AND type = ? AND used = 0 AND expiresAt > ?
       ORDER BY createdAt DESC LIMIT 1`
    ).get(email, type, now);
    if (!row) return 0;
    const next = (row.attempts || 0) + 1;
    database.prepare(
      `UPDATE verification_codes SET attempts = ? WHERE id = ?`
    ).run(next, row.id);
    return next;
  },

  find(email, code, type) {
    const now = new Date().toISOString();
    const row = database.prepare(
      `SELECT * FROM verification_codes
       WHERE email = ? AND code = ? AND type = ? AND used = 0 AND expiresAt > ?
       LIMIT 1`
    ).get(email, code, type, now);
    if (!row) return null;
    return { record: hydrateVCode(row), dateStr: row.createdAt.slice(0, 10) };
  },

  markUsed(email, code, type) {
    const info = database.prepare(
      `UPDATE verification_codes SET used = 1
       WHERE email = ? AND code = ? AND type = ? AND used = 0`
    ).run(email, code, type);
    return info.changes > 0;
  },

  /**
   * 作废当前某 email+type 下尚未使用、尚未过期的验证码(M7)。
   *
   * 用在"验证码错误次数超过上限"的场景:我们不希望用户能无限次重试同一条
   * 6 位数字;达到上限后把它置成 used=1,find 就再也找不到这条记录,用户
   * 必须走 resend 重新拿一条。相比直接 DELETE,保留行方便后续审计——
   * 之后也会被 pruneExpired 自动清掉。
   */
  invalidateCurrent(email, type) {
    const now = new Date().toISOString();
    const info = database.prepare(
      `UPDATE verification_codes SET used = 1
       WHERE email = ? AND type = ? AND used = 0 AND expiresAt > ?`
    ).run(email, type, now);
    return info.changes;
  },

  countRecent({ email = null, ip = null, type = null, windowMinutes = 60 }) {
    const since = new Date(Date.now() - windowMinutes * 60000).toISOString();
    const args = [];
    const conditions = [`createdAt >= ?`];
    args.push(since);
    if (type)  { conditions.push('type = ?');  args.push(type); }
    if (email) { conditions.push('email = ?'); args.push(email); }
    if (ip)    { conditions.push('ip = ?');    args.push(ip); }
    const row = database.prepare(
      `SELECT COUNT(*) AS c FROM verification_codes WHERE ${conditions.join(' AND ')}`
    ).get(...args);
    return row?.c || 0;
  },

  generateCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  },

  /** 清理过期验证码(配合定时任务) */
  pruneExpired() {
    const now = new Date().toISOString();
    const info = database.prepare(
      `DELETE FROM verification_codes WHERE expiresAt < ? OR used = 1`
    ).run(now);
    return info.changes;
  },
};

function hydrateVCode(row) {
  return {
    ...row,
    used: row.used === 1,
    meta: row.meta ? safeJson(row.meta) : null,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// OAuth Codes + Tokens
// ────────────────────────────────────────────────────────────────────────────
export const oauthStore = {
  saveCode(codeData) {
    database.prepare(
      `INSERT INTO oauth_codes
       (id,code,clientId,userId,redirectUri,scope,codeChallenge,codeChallengeMethod,expiresAt,used,createdAt)
       VALUES (?,?,?,?,?,?,?,?,?,0,?)`
    ).run(
      uuidv4(),
      codeData.code,
      codeData.clientId,
      codeData.userId,
      codeData.redirectUri,
      codeData.scope || 'openid',
      codeData.codeChallenge || null,
      codeData.codeChallengeMethod || 'plain',
      codeData.expiresAt,
      new Date().toISOString()
    );
  },

  /** 只读取,不标记 used —— 调用方需要先用这个做全套参数校验,再走
   *  consumeCodeAndIssueTokens 原子化地"消费 + 签发"。 */
  findCode(code) {
    const now = new Date().toISOString();
    const row = database.prepare(
      `SELECT * FROM oauth_codes WHERE code = ? AND used = 0 AND expiresAt > ? LIMIT 1`
    ).get(code, now);
    if (!row) return null;
    return {
      record: { ...row, used: row.used === 1 },
      dateStr: row.createdAt.slice(0, 10),
    };
  },

  /**
   * 遗留方法:查到就立刻标记 used。现在已经**不推荐使用** —— 它在上层路由
   * 还没校验完 client_id / redirect_uri / PKCE 之前就烧掉了 code,一次参数错
   * 误就会让正常客户端的合法 code 失效。保留仅为了不把可能的外部依赖打破;
   * OAuth token 端点已改用 findCode + consumeCodeAndIssueTokens。
   */
  consumeCode(code) {
    const found = this.findCode(code);
    if (!found) return null;
    database.prepare(`UPDATE oauth_codes SET used = 1 WHERE code = ?`).run(code);
    return found.record;
  },

  /**
   * 原子化:标记 code 为 used + 插入 token。两步必须同事务,否则会有"code
   * 已消费但 token 没存下来"这种半拉子状态。
   *
   * 并发安全:用 `UPDATE ... WHERE used = 0` 的 changes 计数作为乐观锁 ——
   * 如果同一个 code 两次并发请求打进来,只有第一个的 UPDATE 会 changes=1,
   * 第二个会 changes=0 → 事务抛错 → 返回 CODE_ALREADY_USED,第二个客户端
   * 拿到 invalid_grant。这是对"同一个 code 不能兑换两次"这条 RFC 约束的
   * 数据库层保障。
   *
   * 返回:
   *   { ok: true, id }                       — 成功,id 是新 oauth_tokens 行的 id
   *   { ok: false, reason: 'CODE_ALREADY_USED' } — 并发兑换或已失效
   */
  consumeCodeAndIssueTokens({ code, tokenData }) {
    const txn = database.transaction(() => {
      const info = database.prepare(
        `UPDATE oauth_codes SET used = 1 WHERE code = ? AND used = 0`
      ).run(code);
      if (info.changes !== 1) {
        throw new Error('CODE_ALREADY_USED');
      }
      const id = uuidv4();
      database.prepare(
        `INSERT INTO oauth_tokens
         (id,accessToken,refreshToken,refreshTokenExpiresAt,parentTokenId,
          clientId,userId,scope,expiresAt,revoked,revokedAt,replaced,createdAt)
         VALUES (?,?,?,?,?,?,?,?,?,0,NULL,0,?)`
      ).run(
        id,
        tokenData.accessToken,
        tokenData.refreshToken || null,
        tokenData.refreshTokenExpiresAt || null,
        null,  // 根节点 token 没有父
        tokenData.clientId,
        tokenData.userId,
        tokenData.scope || 'openid',
        tokenData.expiresAt,
        new Date().toISOString()
      );
      return id;
    });
    try {
      return { ok: true, id: txn() };
    } catch (err) {
      if (err.message === 'CODE_ALREADY_USED') {
        return { ok: false, reason: 'CODE_ALREADY_USED' };
      }
      throw err;
    }
  },

  /**
   * 仅供 refresh_token grant 使用。注意故意不过滤 replaced / revoked —— 调用方
   * (rotateRefreshToken)需要看到这些状态来判断是否是重放。
   */
  findByRefreshToken(refreshToken) {
    if (!refreshToken) return null;
    const row = database.prepare(
      `SELECT * FROM oauth_tokens WHERE refreshToken = ? LIMIT 1`
    ).get(refreshToken);
    if (!row) return null;
    return { ...row, revoked: row.revoked === 1, replaced: row.replaced === 1 };
  },

  /**
   * 原子化:用旧 refresh_token 换一对新的 (access_token, refresh_token)。
   *
   * 关键安全语义(遵循 RFC-9700 §4.14 / IETF OAuth 2.0 Security BCP):
   *   1) refresh_token 是**一次性**的。用过一次,旧行立刻 replaced = 1。
   *   2) 如果一个 refresh_token 已经是 replaced 状态却又被提交回来 —— 这意味
   *      着要么有人把它存下来重放,要么客户端 / 网络出了问题导致旧值再次送
   *      出。保守地按"被盗"处理:立即撤销这个 (userId, clientId) 下所有未撤
   *      销的 token(包括新 rotate 出来的链下游)。合法客户端被迫重新授权,
   *      比"放行一次可能的重放"安全得多。
   *   3) 新 token 的 scope 默认继承旧 token 的 scope;不允许借 refresh 扩权。
   *   4) parentTokenId 指向旧行,便于排查链路。
   *
   * 整个读 → 判断 → 写全部放在一个 transaction 里,靠 SQLite 的串行写入语义
   * 防止两个并发 refresh 同时"都觉得自己是第一次用"。better-sqlite3 的
   * transaction 默认 DEFERRED,在写入时升级为 exclusive lock,两次并发里后
   * 一次会阻塞直到前者 commit,再看到 replaced = 1 走 reuse 分支,和我们期
   * 望的"并发去重"行为一致。
   *
   * 返回:
   *   { ok: true,  id, scope, userId, clientId }
   *   { ok: false, reason: 'NOT_FOUND' }         — token 不存在 / 撤销 / 过期
   *   { ok: false, reason: 'REUSE_DETECTED' }    — 检测到重放,链已清
   */
  rotateRefreshToken({ oldRefreshToken, newTokenData }) {
    const txn = database.transaction(() => {
      const row = database.prepare(
        `SELECT * FROM oauth_tokens WHERE refreshToken = ? LIMIT 1`
      ).get(oldRefreshToken);

      if (!row) throw new Error('NOT_FOUND');

      // 重放检测:已经被 rotate 过一次的 refresh_token 又送回来了
      if (row.replaced === 1) {
        const now = new Date().toISOString();
        database.prepare(
          `UPDATE oauth_tokens SET revoked = 1, revokedAt = ?
           WHERE userId = ? AND clientId = ? AND revoked = 0`
        ).run(now, row.userId, row.clientId);
        throw new Error('REUSE_DETECTED');
      }

      if (row.revoked === 1) throw new Error('NOT_FOUND');

      // refresh_token 自己的过期(access_token 过期这里不管,access 过期才是
      // refresh 存在的意义)
      if (row.refreshTokenExpiresAt &&
          new Date(row.refreshTokenExpiresAt) < new Date()) {
        throw new Error('NOT_FOUND');
      }

      // 把旧行标记为 replaced(不是 revoked —— 区别对待,以便之后的 reuse 检测)
      database.prepare(
        `UPDATE oauth_tokens SET replaced = 1 WHERE id = ?`
      ).run(row.id);

      // 插入新行,parentTokenId 指向旧行;scope 继承,不允许扩权
      const newId = uuidv4();
      database.prepare(
        `INSERT INTO oauth_tokens
         (id,accessToken,refreshToken,refreshTokenExpiresAt,parentTokenId,
          clientId,userId,scope,expiresAt,revoked,revokedAt,replaced,createdAt)
         VALUES (?,?,?,?,?,?,?,?,?,0,NULL,0,?)`
      ).run(
        newId,
        newTokenData.accessToken,
        newTokenData.refreshToken,
        newTokenData.refreshTokenExpiresAt || null,
        row.id,
        row.clientId,
        row.userId,
        row.scope,  // 继承,不从参数取 —— 防止 scope 扩权
        newTokenData.expiresAt,
        new Date().toISOString()
      );
      return { id: newId, userId: row.userId, clientId: row.clientId, scope: row.scope };
    });

    try {
      return { ok: true, ...txn() };
    } catch (err) {
      if (err.message === 'REUSE_DETECTED') return { ok: false, reason: 'REUSE_DETECTED' };
      if (err.message === 'NOT_FOUND')      return { ok: false, reason: 'NOT_FOUND' };
      throw err;
    }
  },

  /**
   * 遗留方法:直接插一行 token。目前只被个别老路径使用;新流程请用
   * consumeCodeAndIssueTokens / rotateRefreshToken。
   */
  saveToken(tokenData) {
    database.prepare(
      `INSERT INTO oauth_tokens
       (id,accessToken,refreshToken,refreshTokenExpiresAt,parentTokenId,
        clientId,userId,scope,expiresAt,revoked,revokedAt,replaced,createdAt)
       VALUES (?,?,?,?,?,?,?,?,?,0,NULL,0,?)`
    ).run(
      uuidv4(),
      tokenData.accessToken,
      tokenData.refreshToken || null,
      tokenData.refreshTokenExpiresAt || null,
      tokenData.parentTokenId || null,
      tokenData.clientId,
      tokenData.userId,
      tokenData.scope || 'openid',
      tokenData.expiresAt,
      new Date().toISOString()
    );
  },

  findToken(token) {
    const row = database.prepare(
      `SELECT * FROM oauth_tokens WHERE accessToken = ? LIMIT 1`
    ).get(token);
    if (!row) return null;
    return {
      record: { ...row, revoked: row.revoked === 1, replaced: row.replaced === 1 },
      dateStr: row.createdAt.slice(0, 10),
    };
  },

  revokeToken(token) {
    const info = database.prepare(
      `UPDATE oauth_tokens SET revoked = 1, revokedAt = ? WHERE accessToken = ? AND revoked = 0`
    ).run(new Date().toISOString(), token);
    return info.changes > 0;
  },

  /** 按 refresh_token 撤销(revoke 端点的 token_type_hint=refresh_token 会用到) */
  revokeByRefreshToken(refreshToken) {
    const info = database.prepare(
      `UPDATE oauth_tokens SET revoked = 1, revokedAt = ? WHERE refreshToken = ? AND revoked = 0`
    ).run(new Date().toISOString(), refreshToken);
    return info.changes > 0;
  },

  revokeAllByUserAndClient(userId, clientId) {
    const info = database.prepare(
      `UPDATE oauth_tokens SET revoked = 1, revokedAt = ?
       WHERE userId = ? AND clientId = ? AND revoked = 0`
    ).run(new Date().toISOString(), userId, clientId);
    return info.changes;
  },

  /** 清理过期/已吊销/已 rotate 的 token 与已消费的 code */
  pruneExpired() {
    const now = new Date().toISOString();
    const t = database.prepare(
      // replaced 的行留着有一个用处:重放检测时还能找到它。但 rotate 出去的
      // 继任者也过期/撤销之后,这条老 replaced 记录就没保留价值了,可以清。
      // 这里简化:replaced 超过 refresh_token 有效期(或 14 天兜底)再清。
      `DELETE FROM oauth_tokens
       WHERE (expiresAt < ? AND (replaced = 0 OR replaced IS NULL))
          OR revoked = 1
          OR (replaced = 1 AND createdAt < datetime(?, '-14 days'))`
    ).run(now, now);
    const c = database.prepare(
      `DELETE FROM oauth_codes WHERE expiresAt < ? OR used = 1`
    ).run(now);
    return { tokensDeleted: t.changes, codesDeleted: c.changes };
  },
};

function safeJson(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

// ────────────────────────────────────────────────────────────────────────────
// Auto-prune:定期清理过期的验证码 / 已撤销的 OAuth 令牌 / 已消费的授权码
// + favicon 孤儿缓存。
// 这些表的 prune 方法之前只在管理员点 /admin/retention 时跑,活跃站点一周就能
// 堆几千条垃圾行;这里加一个进程内计时器,每天自动跑一次。
//
// favicon 孤儿(M5):卡片被删除后,对应 origin 的 favicon_cache 行不会被业务
// 路由之外的流程清理。DELETE/PATCH 路由里已经做了及时清理,这里作为兜底,
// 防止历史遗留数据或 bug 绕过了业务路径。
//
// 幂等 & 热重载安全:用 globalThis + Symbol 做单例,Next.js dev 热重载时
// 重载本模块不会重复注册定时器。unref() 保证它不阻塞进程退出。
// ────────────────────────────────────────────────────────────────────────────
if (typeof setInterval !== 'undefined') {
  const G = Symbol.for('qishu.autoPruneTimer');
  if (!globalThis[G]) {
    const run = async () => {
      try {
        const v = verificationCodes.pruneExpired();
        const o = oauthStore.pruneExpired();
        // favicon 孤儿清理 —— lib/favicon.js 懒加载,避免在模块初始化阶段引入
        // 循环依赖风险(favicon.js 也 import database)。
        let faviconOrphans = 0;
        try {
          const mod = await import('./favicon.js');
          const r = mod.pruneOrphans?.();
          faviconOrphans = r?.deleted || 0;
        } catch (err) {
          console.error('[autoPrune] favicon orphans:', err?.message || err);
        }
        const total =
          (v || 0) +
          (o.tokensDeleted || 0) +
          (o.codesDeleted || 0) +
          faviconOrphans;
        if (total > 0) {
          console.log(
            `[autoPrune] 已清理 verification=${v}, oauth_tokens=${o.tokensDeleted}, oauth_codes=${o.codesDeleted}, favicon_orphans=${faviconOrphans}`
          );
        }
      } catch (err) {
        console.error('[autoPrune] 失败:', err?.message || err);
      }
    };
    // 启动后 60 秒跑一次(清掉启动前就过期的),之后每 24 小时再跑
    setTimeout(run, 60_000).unref?.();
    const handle = setInterval(run, 24 * 3600_000);
    handle.unref?.();
    globalThis[G] = handle;
  }
}
